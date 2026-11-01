"""Geocoding via Open-Meteo Geocoding API (keyless, no strict per-IP block like Nominatim).
Results are cached permanently on disk; district centroids are resolved in parallel."""
import threading
from concurrent.futures import ThreadPoolExecutor

from rapidfuzz import fuzz

from core.cache import read_json, write_json
from core.http import get_json
from tools.names import clean_district

URL = "https://geocoding-api.open-meteo.com/v1/search"
_FILE = "geocode_cache.json"
_cache = read_json(_FILE) or {}
_lock = threading.Lock()


def _search(name: str, count: int = 10) -> list[dict]:
    key = f"q::{name.strip().lower()}"
    with _lock:
        if key in _cache:
            return _cache[key]
    data = get_json(URL, {"name": name, "count": count, "language": "en", "format": "json",
                          "countryCode": "IN"}, timeout=6)
    results = [
        {
            "name": r.get("name"),
            "lat": r["latitude"],
            "lon": r["longitude"],
            "state": r.get("admin1"),
            "district": r.get("admin2"),
            "population": r.get("population") or 0,
        }
        for r in (data.get("results") or [])
    ]
    with _lock:
        _cache[key] = results
        snapshot = dict(_cache)
    write_json(_FILE, snapshot)
    return results


def geocode_place(text: str) -> list[dict]:
    """'Ganaur, Sonipat, Haryana' -> candidates ranked by how well the extra parts match."""
    parts = [p.strip() for p in (text or "").split(",") if p.strip()]
    if not parts:
        return []
    results = _search(parts[0])
    hints = [p.lower() for p in parts[1:]]

    def score(r):
        s = 0
        for h in hints:
            for field in (r.get("district"), r.get("state")):
                if field and fuzz.partial_ratio(h, field.lower()) >= 85:
                    s += 1
        return (s, r.get("population", 0))

    return sorted(results, key=score, reverse=True)


def geocode_district(district: str, state: str):
    """District centroid proxy (district HQ town). Returns {'lat','lon'} or None."""
    key = f"d::{district.lower()}::{state.lower()}"
    with _lock:
        if key in _cache:
            return _cache[key]
    names = [clean_district(district)]
    if "(" in district:
        names.append(district[district.find("(") + 1: district.find(")")].strip())
    found = None
    for name in filter(None, names):
        try:
            results = _search(name)
        except Exception:
            continue
        in_state = [r for r in results if r.get("state") and fuzz.ratio(r["state"].lower(), state.lower()) >= 80]
        if in_state:
            best = max(in_state, key=lambda r: r.get("population", 0))
            found = {"lat": best["lat"], "lon": best["lon"]}
            break
    if found:
        with _lock:
            _cache[key] = found
            snapshot = dict(_cache)
        write_json(_FILE, snapshot)
    return found


def geocode_districts(pairs: list[tuple[str, str]]) -> dict:
    """Parallel geocoding of unique (district, state) pairs -> {district: coords|None}."""
    unique = list(dict.fromkeys(pairs))
    with ThreadPoolExecutor(max_workers=8) as pool:
        coords = list(pool.map(lambda p: geocode_district(*p), unique))
    return {d: c for (d, _), c in zip(unique, coords)}
