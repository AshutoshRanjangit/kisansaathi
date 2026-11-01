"""HTTP helper with timeout, retry and exponential backoff."""
import time

import requests


class FetchError(Exception):
    pass


SESSION = requests.Session()
SESSION.headers["User-Agent"] = "KisanSaathi/1.0 (Forge Gen-AI buildathon)"


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
    raise FetchError(str(last_err))
