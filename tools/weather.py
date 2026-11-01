"""Weather + soil + agro-meteorology from the Open-Meteo Forecast API (keyless).
VPD and FAO-56 ET0 are computed by Open-Meteo itself; soil moisture is model-derived."""
from core.cache import MEM, read_json, write_json
from core.config import now_iso
from core.http import FetchError, get_json

URL = "https://api.open-meteo.com/v1/forecast"

HOURLY = [
    "temperature_2m", "relative_humidity_2m", "precipitation_probability", "precipitation",
    "wind_speed_10m", "wind_gusts_10m", "vapour_pressure_deficit", "et0_fao_evapotranspiration",
    "soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "soil_moisture_3_to_9cm",
    "soil_moisture_9_to_27cm", "soil_temperature_0cm", "is_day", "wind_direction_10m", "cloud_cover",
]
DAILY = [
    "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
    "precipitation_probability_max", "et0_fao_evapotranspiration", "weather_code",
]


def get_forecast(lat: float, lon: float) -> dict:
    key = f"wx2_{round(lat, 2)}_{round(lon, 2)}"
    hit = MEM.get(key, ttl_seconds=1800)
    if hit:
        return {**hit, "cache": "memory (≤30 min old)"}
    params = {
        "latitude": lat, "longitude": lon, "hourly": ",".join(HOURLY), "daily": ",".join(DAILY),
        "timezone": "Asia/Kolkata", "forecast_days": 7,
    }
    try:
        data = get_json(URL, params, timeout=8)
        out = {
            "hourly": data["hourly"], "daily": data["daily"], "units": data.get("hourly_units", {}),
            "fetched_at": now_iso(), "source": "Open-Meteo Forecast API", "cache": "live",
        }
        MEM.set(key, out)
        write_json(f"{key}.json", out)
        return out
    except Exception as exc:
        disk = read_json(f"{key}.json")
        if disk:
            return {**disk, "cache": f"disk fallback (live call failed: {exc})"}
        raise FetchError(f"Open-Meteo unavailable: {exc}")
