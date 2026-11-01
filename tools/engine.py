"""Deterministic agronomy + market engine. The LLM never computes numbers: every figure the
farmer sees is produced here, rounded (integers; VPD 1 decimal) and then templated into text."""
import math
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from core.config import now_ist

# Agronomic spray thresholds (standard pesticide-application guidance).
SPRAY_RULES = {
    "max_rain_probability_pct": 20,
    "max_wind_kmh": 15,
    "min_temp_c": 10,
    "max_temp_c": 32,
    "vpd_range_kpa": (0.3, 1.6),
    "rain_free_hours_after": 4,
    "min_window_hours": 2,
}
# Root-zone volumetric soil-moisture bands for a typical loam (field capacity ~0.30 m³/m³).
SOIL_BANDS = {"dry_below": 0.17, "moist_above": 0.27}
ROAD_FACTOR = 1.3  # straight-line -> road distance

DAY_HI = ["सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"]


def _fmt_time(ts: str, lang: str = "en") -> str:
    dt = datetime.fromisoformat(ts)
    if lang == "hi":
        return f"{DAY_HI[dt.weekday()]} {dt.strftime('%H:%M')}"
    return dt.strftime("%a %H:%M")


def _now_index(times: list[str]) -> int:
    now = now_ist().strftime("%Y-%m-%dT%H:00")
    for i, t in enumerate(times):
        if t >= now:
            return i
    return max(len(times) - 1, 0)


def _val(hourly: dict, key: str, i: int):
    arr = hourly.get(key) or []
    return arr[i] if 0 <= i < len(arr) else None


def _rainy(hourly, i) -> bool:
    pp = _val(hourly, "precipitation_probability", i) or 0
    pr = _val(hourly, "precipitation", i) or 0
    return pp >= 50 or pr >= 0.2


# --------------------------------------------------------------------------- spraying
def spray_windows(hourly: dict, horizon_h: int = 48) -> dict:
    r = SPRAY_RULES
    times = hourly["time"]
    i0 = _now_index(times)
    end = min(len(times), i0 + horizon_h)
    ok_flags, blockers, timeline = [], Counter(), []
    for i in range(i0, end):
        reasons = []
        if _val(hourly, "is_day", i) == 0:
            reasons.append("night")
        pp = _val(hourly, "precipitation_probability", i)
        if pp is None or pp > r["max_rain_probability_pct"]:
            reasons.append("rain chance")
        wind = _val(hourly, "wind_speed_10m", i)
        if wind is None or wind > r["max_wind_kmh"]:
            reasons.append("wind")
        temp = _val(hourly, "temperature_2m", i)
        if temp is None or not (r["min_temp_c"] <= temp <= r["max_temp_c"]):
            reasons.append("temperature")
        vpd = _val(hourly, "vapour_pressure_deficit", i)
        if vpd is None or not (r["vpd_range_kpa"][0] <= vpd <= r["vpd_range_kpa"][1]):
            reasons.append("evaporation (VPD)")
        if any(_rainy(hourly, j) for j in range(i + 1, min(len(times), i + 1 + r["rain_free_hours_after"]))):
            reasons.append("rain soon after")
        ok_flags.append((i, not reasons))
        timeline.append({"time": times[i], "ok": not reasons,
                         "reason": (reasons[0] if reasons else ""),
                         "rain_pct": int(pp or 0), "wind_kmh": None if wind is None else round(wind)})
        for reason in set(reasons) - {"night"}:
            blockers[reason] += 1

    windows, run = [], []
    for i, ok in ok_flags + [(None, False)]:
        if ok:
            run.append(i)
            continue
        if len(run) >= r["min_window_hours"]:
            def avg(k):
                vals = [_val(hourly, k, j) for j in run if _val(hourly, k, j) is not None]
                return sum(vals) / len(vals) if vals else None
            windows.append({
                "start": times[run[0]],
                "end": (datetime.fromisoformat(times[run[-1]]) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"),
                "hours": len(run),
                "avg_wind_kmh": round(avg("wind_speed_10m")),
                "avg_temp_c": round(avg("temperature_2m")),
                "avg_vpd_kpa": round(avg("vapour_pressure_deficit"), 1),
                "max_rain_prob_pct": int(max((_val(hourly, "precipitation_probability", j) or 0) for j in run)),
            })
        run = []

    next_rain = None
    for i in range(i0, end):
        if _rainy(hourly, i):
            next_rain = {"time": times[i],
                         "probability_pct": int(_val(hourly, "precipitation_probability", i) or 0),
                         "mm": round(_val(hourly, "precipitation", i) or 0, 1)}
            break
    return {"windows": windows[:4], "blockers": [b for b, _ in blockers.most_common(3)],
            "next_rain": next_rain, "horizon_h": horizon_h, "rules": r, "timeline": timeline}


# --------------------------------------------------------------------------- irrigation
def irrigation_advice(hourly: dict, daily: dict) -> dict:
    i0 = _now_index(hourly["time"])
    surface = _val(hourly, "soil_moisture_0_to_1cm", i0)
    root_layers = [_val(hourly, k, i0) for k in ("soil_moisture_3_to_9cm", "soil_moisture_9_to_27cm")]
    root_layers = [v for v in root_layers if v is not None]
    root = sum(root_layers) / len(root_layers) if root_layers else None
    rain3 = sum(v or 0 for v in (daily.get("precipitation_sum") or [])[:3])
    et3 = sum(v or 0 for v in (daily.get("et0_fao_evapotranspiration") or [])[:3])
    balance = rain3 - et3

    if root is None:
        decision, code = "Soil moisture unavailable — check soil by hand before irrigating", "unknown"
    elif rain3 >= 0.8 * et3 and rain3 >= 5:
        decision, code = "Hold irrigation — expected rain covers crop water demand", "wait_rain"
    elif root < SOIL_BANDS["dry_below"]:
        decision, code = "Irrigate within 24 hours — root zone is dry", "irrigate_now"
    elif root < SOIL_BANDS["moist_above"] and balance < -8:
        decision, code = "Plan irrigation in 1–2 days — moisture falling, little rain expected", "irrigate_soon"
    else:
        decision, code = "No irrigation needed now — root zone has adequate moisture", "no_need"

    return {
        "decision": decision, "code": code,
        "root_zone_moisture_pct": None if root is None else round(root * 100),
        "surface_moisture_pct": None if surface is None else round(surface * 100),
        "soil_temp_c": None if _val(hourly, "soil_temperature_0cm", i0) is None else round(_val(hourly, "soil_temperature_0cm", i0)),
        "rain_next_3d_mm": round(rain3),
        "et0_next_3d_mm": round(et3),
        "water_balance_3d_mm": round(balance),
        "bands": SOIL_BANDS,
    }


# --------------------------------------------------------------------------- markets
def haversine_km(lat1, lon1, lat2, lon2) -> float:
    rad = math.radians
    dlat, dlon = rad(lat2 - lat1), rad(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def market_table(rows: list[dict], user_lat, user_lon, district_coords: dict, cost_per_qtl_km: float):
    """One row per market: FAQ-grade modal price (else median), road distance, transport, net."""
    by_market = defaultdict(list)
    for r in rows:
        if r.get("modal_price"):
            by_market[(r["market"], r["district"], r["state"])].append(r)
    table = []
    for (market, district, state), rs in by_market.items():
        faq = [x for x in rs if (x.get("grade") or "").upper() == "FAQ"]
        modal = faq[0]["modal_price"] if faq else statistics.median(x["modal_price"] for x in rs)
        coords = district_coords.get(district)
        dist = None
        if coords:
            dist = round(haversine_km(user_lat, user_lon, coords["lat"], coords["lon"]) * ROAD_FACTOR)
        transport = None if dist is None else round(dist * cost_per_qtl_km)
        table.append({
            "market": market, "district": district, "state": state,
            "modal_price": round(modal),
            "min_price": round(min((x["min_price"] for x in rs if x.get("min_price") is not None), default=0)),
            "max_price": round(max((x["max_price"] for x in rs if x.get("max_price") is not None), default=0)),
            "distance_km": dist, "transport_cost": transport,
            "net_price": None if transport is None else round(modal) - transport,
            "lat": coords["lat"] if coords else None, "lon": coords["lon"] if coords else None,
            "arrival_date": rs[0].get("arrival_date"),
        })
    return table


def rank_markets(table: list[dict], radius_km):
    if radius_km is None:
        pool = list(table)
    else:
        pool = [m for m in table if m["distance_km"] is not None and m["distance_km"] <= radius_km]
    pool.sort(key=lambda m: (m["net_price"] is not None, m["net_price"] or m["modal_price"]), reverse=True)
    for i, m in enumerate(pool, 1):
        m["rank"] = i
    return pool


def market_summary(ranked: list[dict]) -> dict:
    with_dist = [m for m in ranked if m["distance_km"] is not None]
    if not ranked:
        return {}
    best = ranked[0]
    nearest = min(with_dist, key=lambda m: m["distance_km"]) if with_dist else None
    gain = None
    if nearest and best.get("net_price") is not None and nearest.get("net_price") is not None:
        gain = best["net_price"] - nearest["net_price"]
    return {"best": best, "nearest": nearest, "extra_gain_per_qtl": gain}
