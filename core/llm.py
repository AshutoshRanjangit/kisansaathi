"""Thin Gemini wrapper (google-genai). Returns parsed JSON; raises LLMError on failure."""
import json
import re

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


def _models():
    order = [_working, get_secret("GEMINI_MODEL")] + _discover()[:4] + ["gemini-flash-latest"]
    seen, out = set(), []
    for m in order:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def _parse_json(text: str) -> dict:
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    return json.loads(text)


def generate_json(prompt: str, audio: bytes | None = None, audio_mime: str = "audio/wav",
                  temperature: float = 0.2) -> dict:
    if not llm_available():
        raise LLMError("GEMINI_API_KEY not configured")
    from google.genai import types

    contents = []
    if audio:
        contents.append(types.Part.from_bytes(data=audio, mime_type=audio_mime))
    contents.append(prompt)
    config = types.GenerateContentConfig(temperature=temperature, response_mime_type="application/json")

    global _working
    errors = []
    for model in _models():
        try:
            resp = _get_client().models.generate_content(model=model, contents=contents, config=config)
            result = _parse_json(resp.text)
            _working = model
            return result
        except Exception as exc:
            errors.append(f"{model}: {str(exc)[:120]}")
    raise LLMError(" | ".join(errors[-3:]) or "no Gemini model available")
