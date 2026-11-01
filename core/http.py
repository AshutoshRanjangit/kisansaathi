"""HTTP helper with timeout, retry and exponential backoff.
Error messages are sanitised: they never contain URLs or query strings (which may carry API keys)."""
import re
import time

import requests


class FetchError(Exception):
    pass


SESSION = requests.Session()
SESSION.headers["User-Agent"] = "KisanSaathi/1.0 (Forge Gen-AI buildathon)"

_SECRET_RE = re.compile(r"(api[-_]?key=)[^&\s'\"]+", re.I)


def _describe(exc: Exception) -> str:
    """Short, key-free description of a network failure."""
    if isinstance(exc, FetchError):
        return str(exc)
    if isinstance(exc, requests.Timeout):
        return "timeout"
    if isinstance(exc, requests.ConnectionError):
        msg = str(exc)
        if "No route to host" in msg:
            return "connection refused (no route to host)"
        if "Name or service not known" in msg or "getaddrinfo" in msg:
            return "DNS lookup failed"
        return "connection failed"
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        return f"HTTP {exc.response.status_code}"
    return _SECRET_RE.sub(r"\1***", type(exc).__name__ + ": " + str(exc))[:160]


def get_json(url: str, params=None, timeout: float = 8, retries: int = 2, backoff: float = 0.7):
    last_err = None
    for attempt in range(retries + 1):
        try:
            resp = SESSION.get(url, params=params, timeout=timeout)
            if resp.status_code in (429, 500, 502, 503, 504):
                raise FetchError(f"HTTP {resp.status_code}")
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:  # network error, timeout, bad JSON, 5xx
            last_err = exc
            if attempt < retries:
                time.sleep(backoff * (2**attempt))
    raise FetchError(_describe(last_err))
