"""Two-level cache: in-memory TTL cache + disk persistence of the last successful LIVE response.

The disk files are only ever written from real API responses (never committed to git),
so a fallback always serves real data with its original fetch timestamp.
"""
import json
import threading
import time
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)
_disk_lock = threading.Lock()


def read_json(name: str):
    path = CACHE_DIR / name
    try:
        with _disk_lock:
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_json(name: str, data) -> None:
    path = CACHE_DIR / name
    tmp = path.with_suffix(".tmp")
    try:
        with _disk_lock:
            tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            tmp.replace(path)
    except Exception:
        pass  # cache is best-effort, never fatal


class TTLCache:
    def __init__(self):
        self._data = {}
        self._lock = threading.Lock()

    def get(self, key, ttl_seconds):
        with self._lock:
            hit = self._data.get(key)
        if hit and time.time() - hit[0] < ttl_seconds:
            return hit[1]
        return None

    def set(self, key, value):
        with self._lock:
            self._data[key] = (time.time(), value)


MEM = TTLCache()
