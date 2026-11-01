"""Thin Gemini wrapper (google-genai). Returns parsed JSON; raises LLMError on failure."""
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout

from core.config import get_secret


class LLMError(Exception):
    pass


_client = None


def llm_available() -> bool:
    return bool(get_secret("GEMINI_API_KEY"))


def _get_client():
    global _client
    if _client is None:
        from google import genai
        from google.genai import types

        _client = genai.Client(
            api_key=get_secret("GEMINI_API_KEY"),
            http_options=types.HttpOptions(timeout=40_000),
        )
    return _client


_discovered = None
_working = None  # first model that answered successfully; tried first afterwards
_SKIP = ("image", "tts", "live", "audio", "embedding", "exp", "learnlm", "robotics", "computer")


def _version(name: str) -> float:
    m = re.search(r"(\d+(?:\.\d+)?)", name)
    return float(m.group(1)) if m else 0.0


def _discover() -> list[str]:
    """Ask the API which Flash models this key can call (so retired model names never break the app)."""
    global _discovered
    if _discovered is None:
        names = []
        try:
            for m in _get_client().models.list():
                name = (getattr(m, "name", "") or "").replace("models/", "")
                actions = getattr(m, "supported_actions", None) or []
                if "flash" in name and (not actions or "generateContent" in actions) \
                        and not any(s in name for s in _SKIP):
                    names.append(name)
        except Exception:
            pass
        # newest version first; prefer full over lite, stable over preview
        names.sort(key=lambda n: (_version(n), "lite" not in n, "preview" not in n), reverse=True)
        _discovered = names
    return _discovered


def active_model() -> str | None:
    return _working


_exhausted: dict[str, float] = {}  # model -> time until which its quota is known to be used up


def _models():
    order = [_working, get_secret("GEMINI_MODEL")] + _discover()[:10] + ["gemini-flash-latest", "gemini-flash-lite-latest"]
    seen, out, now = set(), [], time.time()
    for m in order:
        if m and m not in seen and _exhausted.get(m, 0) < now:
            seen.add(m)
            out.append(m)
    return out


def _parse_json(text: str) -> dict:
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    return json.loads(text)


_POOL = ThreadPoolExecutor(max_workers=4)
_cooldown_until = 0.0  # circuit breaker: skip Gemini briefly after it was overloaded


def _short(exc: Exception) -> str:
    s = str(exc)
    for code, label in (("503", "overloaded (503)"), ("504", "timed out (504)"), ("429", "quota exceeded (429)"),
                        ("404", "model not found (404)"), ("401", "invalid key (401)"), ("403", "forbidden (403)")):
        if code in s:
            return label
    if isinstance(exc, FuturesTimeout):
        return "no reply in time"
    return type(exc).__name__


def generate_json(prompt: str, audio: bytes | None = None, audio_mime: str = "audio/wav",
                  temperature: float = 0.2, budget_s: float = 20.0, max_models: int = 2) -> dict:
    """Bounded call: at most `max_models` models and `budget_s` seconds in total, so a busy
    Gemini can never stall the agent — callers fall back to deterministic logic instead."""
    global _working, _cooldown_until
    if not llm_available():
        raise LLMError("GEMINI_API_KEY not configured")
    if time.time() < _cooldown_until:
        raise LLMError("Gemini temporarily skipped (circuit breaker after recent failures)")
    from google.genai import types

    contents = []
    if audio:
        contents.append(types.Part.from_bytes(data=audio, mime_type=audio_mime))
    contents.append(prompt)
    config = types.GenerateContentConfig(temperature=temperature, response_mime_type="application/json")

    deadline = time.time() + budget_s
    errors, slow_failures = [], 0
    for model in _models():
        remaining = deadline - time.time()
        if remaining < 2 or slow_failures >= max_models:
            break
        future = _POOL.submit(_get_client().models.generate_content, model=model, contents=contents, config=config)
        try:
            resp = future.result(timeout=remaining)
            result = _parse_json(resp.text)
            _working = model
            return result
        except Exception as exc:
            why = _short(exc)
            errors.append(f"{model}: {why}")
            if "quota" in why or "not found" in why:
                # free-tier quota is per model: mark this one and move straight on to the next
                _exhausted[model] = time.time() + (600 if "quota" in why else 3600)
                if _working == model:
                    _working = None
            else:
                slow_failures += 1
    if errors and all("quota" in e for e in errors) and not _models():
        _cooldown_until = time.time() + 600
        raise LLMError("Gemini free-tier quota used up on every available model")
    if errors and all("quota" in e for e in errors):
        raise LLMError(f"Gemini quota used up on {len(errors)} model(s) tried")
    if errors and all(("overloaded" in e or "timed out" in e or "no reply" in e) for e in errors):
        _cooldown_until = time.time() + 60
        raise LLMError("Gemini busy")
    raise LLMError("; ".join(errors[-3:]) or "no time left for Gemini")
