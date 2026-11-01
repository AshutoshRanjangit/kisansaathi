"""Live mandi prices: data.gov.in Agmarknet 'Current Daily Price of Various Commodities from
Various Markets (Mandi)'. One state-level pull (paginated), cached in memory for 15 min and
persisted to disk so a NIC outage still serves the last REAL pull with its timestamp."""
from core.cache import MEM, read_json, write_json
from core.config import get_secret, now_iso
from core.http import FetchError, get_json

RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
URL = f"https://api.data.gov.in/resource/{RESOURCE_ID}"
PAGE = 1000
MAX_PAGES = 5


def _slug(state: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in state.lower())


def _pull(state: str) -> list[dict]:
    key = get_secret("DATA_GOV_API_KEY")
    if not key:
        raise FetchError("DATA_GOV_API_KEY not configured")
    records, offset = [], 0
    for _ in range(MAX_PAGES):
        data = get_json(URL, {"api-key": key, "format": "json", "limit": PAGE, "offset": offset,
                              "filters[state.keyword]": state}, timeout=12)
        page = data.get("records") or []
        records.extend(page)
        total = int(data.get("total") or 0)
        offset += PAGE
        if len(page) < PAGE or offset >= total:
            break
    for r in records:  # prices arrive as numbers or strings
        for f in ("min_price", "max_price", "modal_price"):
            try:
                r[f] = float(r.get(f))
            except (TypeError, ValueError):
                r[f] = None
    return records


def fetch_state(candidates: list[str]) -> dict:
    """Try each spelling of the state; returns
    {records, state, cache, fetched_at, source} — raises FetchError if nothing real is available."""
    errors = []
    for state in candidates:
        mem_key = f"mandi::{state}"
        hit = MEM.get(mem_key, ttl_seconds=900)
        if hit:
            return {**hit, "cache": "memory (≤15 min old)"}
        try:
            records = _pull(state)
        except Exception as exc:
            errors.append(f"{state}: {exc}")
            continue
        if records:
            out = {"records": records, "state": state, "fetched_at": now_iso(),
                   "source": "data.gov.in · Agmarknet daily mandi prices", "cache": "live"}
            MEM.set(mem_key, out)
            write_json(f"mandi_{_slug(state)}.json", out)
            return out
        errors.append(f"{state}: 0 records today")
    for state in candidates:  # disk fallback: last real pull
        disk = read_json(f"mandi_{_slug(state)}.json")
        if disk and disk.get("records"):
            return {**disk, "cache": f"disk fallback — live call failed ({'; '.join(errors)})"}
    raise FetchError("; ".join(errors) or "no state given")
