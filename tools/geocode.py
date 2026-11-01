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


NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse"
BDC_REVERSE = "https://api.bigdatacloud.net/data/reverse-geocode-client"


def reverse_geocode(lat: float, lon: float) -> dict:
    """GPS coordinates -> {name, lat, lon, district, state, source}. Nominatim first (rich village
    names), BigDataCloud keyless endpoint as fallback. Cached on disk by ~100 m grid cell."""
    key = f"r::{round(lat, 3)}::{round(lon, 3)}"
    with _lock:
        if key in _cache:
            return {**_cache[key], "lat": lat, "lon": lon}
    place = None
    try:
        d = get_json(NOMINATIM_REVERSE, {"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 14,
                                         "accept-language": "en", "addressdetails": 1}, timeout=6, retries=1)
        a = d.get("address") or {}
        if a.get("state"):
            place = {
                "name": a.get("village") or a.get("town") or a.get("city") or a.get("suburb")
                        or a.get("hamlet") or a.get("county") or d.get("name") or "Your location",
                "district": a.get("state_district") or a.get("county") or a.get("city_district"),
                "state": a.get("state"), "source": "OpenStreetMap Nominatim (reverse)",
            }
    except Exception:
        pass
    if not place:
        try:
            d = get_json(BDC_REVERSE, {"latitude": lat, "longitude": lon, "localityLanguage": "en"},
                         timeout=6, retries=1)
            admin = (d.get("localityInfo") or {}).get("administrative") or []
            district = next((x.get("name") for x in admin if x.get("adminLevel") == 5), None)
            if d.get("principalSubdivision"):
                place = {"name": d.get("locality") or d.get("city") or "Your location", "district": district,
                         "state": d.get("principalSubdivision"), "source": "BigDataCloud (reverse)"}
        except Exception:
            pass
    if not place:
        raise ValueError("reverse geocoding unavailable")
    if place.get("district"):
        place["district"] = place["district"].replace(" District", "").replace(" district", "").strip()
    with _lock:
        _cache[key] = place
        snapshot = dict(_cache)
    write_json(_FILE, snapshot)
    return {**place, "lat": lat, "lon": lon, "population": 0}
