from operator import add
from typing import Annotated, Any, Optional, TypedDict


class AgentState(TypedDict, total=False):
    # inputs
    query: str
    audio: Optional[bytes]
    audio_mime: str
    ui_location: str
    ui_crop: str
    ui_lang: str  # auto | hi | en
    cost_per_qtl_km: float

    # working memory
    plan: dict
    place: dict
    place_candidates: list
    weather: dict
    mandi: dict
    commodity: Optional[str]
    commodity_alternatives: list
    neighbours_tried: bool
    district_coords: dict
    radius_idx: int
    market_table: list
    ranked: list
    analysis: dict
    facts: dict
    draft: dict
    advisory: dict
    status: str

    # append-only logs (LangGraph reducers)
    trace: Annotated[list, add]
    warnings: Annotated[list, add]
    sources: Annotated[list, add]


def step(node: str, detail: str, ms: float = 0, status: str = "ok", **extra) -> dict[str, Any]:
    return {"node": node, "detail": detail, "ms": int(ms), "status": status, **extra}
