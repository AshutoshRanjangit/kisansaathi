"""LangGraph nodes. LLM is used in exactly two places (planner, synthesizer); everything in
between is deterministic tool execution with explicit verification / self-correction."""
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor

from agent.guardrails import IRRIGATION_HI, render, template_draft, verify_draft
from agent.prompts import PLANNER_PROMPT, SYNTH_PROMPT
from agent.state import AgentState, step
from core.llm import LLMError, active_model, generate_json, llm_available
from tools import engine
from tools.geocode import geocode_districts, geocode_place
from tools.mandi import fetch_state
from tools.names import HINDI_CROPS, NEIGHBOURS, match_commodity, state_candidates
from tools.weather import get_forecast

RADII = [50, 120, 250, None]  # km; None = whole state
ALL_INTENTS = ["spray", "irrigation", "sell", "weather"]
DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def _ms(t0):
    return (time.perf_counter() - t0) * 1000


# --------------------------------------------------------------------------- 1. planner
def planner(state: AgentState) -> dict:
    t0 = time.perf_counter()
    query = (state.get("query") or "").strip()
    audio = state.get("audio")
    ui_lang = state.get("ui_lang", "auto")
    plan, how, warnings = None, "", []

    if llm_available() and (query or audio):
        try:
            plan = generate_json(
                PLANNER_PROMPT.format(query=query.replace('"', "'"), ui_crop=state.get("ui_crop") or "",
                                      ui_location=state.get("ui_location") or ""),
                audio=audio, audio_mime=state.get("audio_mime", "audio/wav"))
            how = f"Gemini ({active_model()}) parsed " + ("voice" if audio else "text")
        except LLMError as exc:
            warnings.append(f"Planner LLM failed ({exc}); used rule-based parser.")
    elif audio and not llm_available():
        warnings.append("Voice needs the Gemini key; using sidebar crop & location.")

    if not plan:  # deterministic fallback parser
        crop = state.get("ui_crop")
        for hi, en in HINDI_CROPS.items():
            if hi in query:
                crop = en
        plan = {"transcript": query, "language": "hi" if DEVANAGARI.search(query) else "en",
                "crop": crop, "location": None, "intents": ALL_INTENTS, "question": query or "general advisory"}
        how = how or "rule-based parser"

    plan["crop"] = plan.get("crop") or state.get("ui_crop")
    plan["location"] = plan.get("location") or state.get("ui_location")
    plan["intents"] = [i for i in (plan.get("intents") or ALL_INTENTS) if i in ALL_INTENTS] or ALL_INTENTS
    if ui_lang in ("hi", "en"):
        plan["language"] = ui_lang
    plan["language"] = "hi" if plan.get("language") == "hi" else "en"

    return {"plan": plan, "warnings": warnings,
            "trace": [step("planner", f"{how}: crop={plan['crop']}, place={plan['location']}, "
                                      f"intents={','.join(plan['intents'])}, lang={plan['language']}", _ms(t0))]}


# --------------------------------------------------------------------------- 2. locate
def locate(state: AgentState) -> dict:
    t0 = time.perf_counter()
    loc = state["plan"].get("location")
    try:
        candidates = geocode_place(loc) if loc else []
    except Exception as exc:
        return {"status": "need_location", "warnings": [f"Geocoder unavailable: {exc}"],
                "trace": [step("locate", f"geocoder error: {exc}", _ms(t0), "fail")]}
    if not candidates:
        return {"status": "need_location", "place_candidates": [],
                "warnings": [f"Could not find '{loc}' — please type village, district."],
                "trace": [step("locate", f"no match for '{loc}'", _ms(t0), "fail")]}
    place = candidates[0]
    return {"status": "ok", "place": place, "place_candidates": candidates[:5],
            "sources": [{"name": "Open-Meteo Geocoding API", "detail": f"{place['name']}, {place['district']}, {place['state']}"}],
            "trace": [step("locate", f"{place['name']}, {place.get('district')}, {place.get('state')} "
                                     f"({place['lat']:.3f}, {place['lon']:.3f})", _ms(t0))]}


# --------------------------------------------------------------------------- 3. parallel fetch
def fetch_data(state: AgentState) -> dict:
    t0 = time.perf_counter()
    place = state["place"]
    out = {"trace": [], "warnings": [], "sources": []}

    def wx():
        s = time.perf_counter()
        try:
            return get_forecast(place["lat"], place["lon"]), None, _ms(s)
        except Exception as exc:
            return None, str(exc), _ms(s)

    def md():
        s = time.perf_counter()
        try:
            return fetch_state(state_candidates(place.get("state"))), None, _ms(s)
        except Exception as exc:
            return None, str(exc), _ms(s)

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_wx, f_md = pool.submit(wx), pool.submit(md)
        weather, wx_err, wx_ms = f_wx.result()
        mandi, md_err, md_ms = f_md.result()

    if weather:
        out["weather"] = weather
        out["trace"].append(step("fetch_weather", f"Open-Meteo forecast + soil moisture + VPD + ET₀ "
                                                  f"[{weather['cache']}]", wx_ms))
        out["sources"].append({"name": weather["source"], "detail": f"fetched {weather['fetched_at']} · {weather['cache']}"})
    else:
        out["trace"].append(step("fetch_weather", f"FAILED: {wx_err}", wx_ms, "fail"))
        out["warnings"].append("Weather service unavailable — spray & irrigation advice skipped.")

    if mandi:
        out["mandi"] = mandi
        stale = mandi["cache"] != "live" and not mandi["cache"].startswith("memory")
        out["trace"].append(step("fetch_mandi", f"{len(mandi['records'])} price records for {mandi['state']} "
                                                f"[{mandi['cache']}]", md_ms, "warn" if stale else "ok"))
        out["sources"].append({"name": mandi["source"], "detail": f"{mandi['state']} · fetched {mandi['fetched_at']} · {mandi['cache']}"})
        if stale:
            out["warnings"].append(f"Live mandi API down — showing last real pull from {mandi['fetched_at']}.")
    else:
        out["mandi"] = {"records": [], "state": place.get("state"), "cache": "none"}
        out["trace"].append(step("fetch_mandi", f"FAILED: {md_err}", md_ms, "fail"))
    out["trace"].insert(0, step("fetch_parallel", "weather ∥ mandi fetched concurrently", _ms(t0)))
    return out


# --------------------------------------------------------------------------- 4. commodity verification
def resolve_commodity(state: AgentState) -> dict:
    t0 = time.perf_counter()
    crop = state["plan"].get("crop")
    records = state.get("mandi", {}).get("records", [])
    available = sorted({r["commodity"] for r in records if r.get("commodity")})
    match, score, alts = match_commodity(crop, available)
    if match:
        return {"commodity": match, "commodity_alternatives": alts,
                "trace": [step("verify_commodity", f"'{crop}' → '{match}' (fuzzy score {score}) among "
                                                   f"{len(available)} commodities traded today", _ms(t0))]}
    return {"commodity": None, "commodity_alternatives": alts,
            "trace": [step("verify_commodity", f"'{crop}' not traded today in loaded states "
                                               f"(closest: {', '.join(alts[:3]) or 'none'})", _ms(t0), "warn")]}


def route_commodity(state: AgentState) -> str:
    if state.get("commodity"):
        return "geocode_mandis"
    if not state.get("neighbours_tried") and state["plan"].get("crop"):
        return "expand_states"
    return "engine"


def expand_states(state: AgentState) -> dict:
    t0 = time.perf_counter()
    home = state.get("mandi", {}).get("state") or (state_candidates(state["place"].get("state")) or [""])[0]
    neighbours = NEIGHBOURS.get(home, [])[:3]
    records = list(state.get("mandi", {}).get("records", []))
    loaded = []

    def pull(n):
        try:
            return n, fetch_state([n])
        except Exception:
            return n, None

    with ThreadPoolExecutor(max_workers=3) as pool:
        for name, res in pool.map(pull, neighbours):
            if res:
                records += res["records"]
                loaded.append(f"{name} ({len(res['records'])})")
    mandi = {**state.get("mandi", {}), "records": records}
    return {"mandi": mandi, "neighbours_tried": True,
            "trace": [step("self_correct", f"Self-correction: searching neighbouring states → "
                                           f"{', '.join(loaded) or 'none reachable'}", _ms(t0),
                           "ok" if loaded else "warn")]}


# --------------------------------------------------------------------------- 5. mandi geocoding
def geocode_mandis(state: AgentState) -> dict:
    t0 = time.perf_counter()
    rows = [r for r in state["mandi"]["records"] if r.get("commodity") == state["commodity"]]
    pairs = [(r["district"], r["state"]) for r in rows if r.get("district")]
    coords = geocode_districts(pairs)
    table = engine.market_table(rows, state["place"]["lat"], state["place"]["lon"], coords,
                                state.get("cost_per_qtl_km", 0.5))
    located = sum(1 for c in coords.values() if c)
    return {"district_coords": coords, "market_table": table, "radius_idx": 0,
            "trace": [step("geocode_mandis", f"{len(table)} mandis; {located}/{len(coords)} districts "
                                             f"geocoded in parallel (disk-cached)", _ms(t0))]}


# --------------------------------------------------------------------------- 6. rank + radius verifier
def rank_markets(state: AgentState) -> dict:
    t0 = time.perf_counter()
    radius = RADII[state.get("radius_idx", 0)]
    ranked = engine.rank_markets([dict(m) for m in state.get("market_table", [])], radius)
    label = f"{radius} km" if radius else "whole state(s)"
    return {"ranked": ranked,
            "trace": [step("rank_markets", f"{len(ranked)} mandis within {label}, ranked by net price "
                                           f"after transport", _ms(t0), "ok" if len(ranked) >= 3 else "warn")]}


def route_rank(state: AgentState) -> str:
    if len(state.get("ranked", [])) < 3 and state.get("radius_idx", 0) < len(RADII) - 1:
        return "widen_radius"
    return "engine"


def widen_radius(state: AgentState) -> dict:
    i = state.get("radius_idx", 0)
    new = RADII[i + 1]
    return {"radius_idx": i + 1,
            "trace": [step("self_correct", f"Self-correction: too few mandis within {RADII[i]} km → "
                                           f"widening search to {new or 'whole state'}{' km' if new else ''}")]}


# --------------------------------------------------------------------------- 7. deterministic engine
def run_engine(state: AgentState) -> dict:
    t0 = time.perf_counter()
    lang = state["plan"]["language"]
    analysis, facts, warnings = {}, {}, []
    place = state.get("place", {})
    facts["location"] = ", ".join(x for x in (place.get("name"), place.get("district")) if x) or "—"
    facts["crop"] = state.get("commodity") or state["plan"].get("crop") or "—"

    wx = state.get("weather")
    if wx:
        spray = engine.spray_windows(wx["hourly"])
        irr = engine.irrigation_advice(wx["hourly"], wx["daily"])
        analysis.update(spray=spray, irrigation=irr)
        w = spray["windows"]
        fmt = lambda ts: engine._fmt_time(ts, lang)
        if w:
            facts["spray_window"] = f"{fmt(w[0]['start'])}–{w[0]['end'][-5:]}"
            facts["spray_wind"] = w[0]["avg_wind_kmh"]
            facts["spray_rain_prob"] = w[0]["max_rain_prob_pct"]
            facts["spray_vpd"] = w[0]["avg_vpd_kpa"]
            if len(w) > 1:
                facts["spray_window_2"] = f"{fmt(w[1]['start'])}–{w[1]['end'][-5:]}"
        else:
            facts["spray_window"] = "none in next 48 h" if lang == "en" else "अगले 48 घंटे में नहीं"
        facts["spray_blockers"] = ", ".join(spray["blockers"]) or "—"
        nr = spray["next_rain"]
        facts["next_rain"] = (f"{fmt(nr['time'])} ({nr['probability_pct']}%)" if nr
                              else ("none expected in 48 h" if lang == "en" else "48 घंटे में नहीं"))
        facts["root_moisture_pct"] = irr["root_zone_moisture_pct"] if irr["root_zone_moisture_pct"] is not None else "unavailable"
        facts["rain_3d_mm"] = irr["rain_next_3d_mm"]
        facts["et0_3d_mm"] = irr["et0_next_3d_mm"]
        facts["irrigation_decision"] = IRRIGATION_HI[irr["code"]] if lang == "hi" else irr["decision"]
    else:
        warnings.append("Spray/irrigation advice unavailable (no weather data).")

    ranked = state.get("ranked") or []
    if ranked:
        summary = engine.market_summary(ranked)
        analysis["market"] = summary
        b, n = summary["best"], summary["nearest"]
        facts.update(best_mandi=b["market"], best_mandi_district=b["district"], best_modal_price=b["modal_price"],
                     best_net_price=b["net_price"] if b["net_price"] is not None else b["modal_price"],
                     best_distance_km=b["distance_km"] if b["distance_km"] is not None else "—",
                     price_date=b.get("arrival_date") or "—")
        if n:
            facts.update(nearest_mandi=n["market"], nearest_net_price=n["net_price"])
        if summary.get("extra_gain_per_qtl"):
            facts["extra_gain"] = summary["extra_gain_per_qtl"]
    elif state["plan"].get("crop"):
        warnings.append(f"No mandi prices found today for {state['plan']['crop']}.")

    return {"analysis": analysis, "facts": facts, "warnings": warnings,
            "trace": [step("engine", f"deterministic: {len((analysis.get('spray') or {}).get('windows', []))} spray windows, "
                                     f"irrigation={analysis.get('irrigation', {}).get('code', 'n/a')}, "
                                     f"{len(ranked)} mandis ranked", _ms(t0))]}


# --------------------------------------------------------------------------- 8. synthesizer
def synthesize(state: AgentState) -> dict:
    t0 = time.perf_counter()
    plan = state.get("plan", {})
    lang = plan.get("language", "en")
    if state.get("status") == "need_location":
        msg = ("कृपया अपना गाँव/कस्बा और ज़िला लिखें (जैसे: Ganaur, Sonipat)।" if lang == "hi"
               else "Please type your village/town and district (e.g. Ganaur, Sonipat).")
        return {"draft": {"summary": msg, "actions": [], "tip": ""}, "facts": {},
                "trace": [step("synthesize", "asked farmer to clarify location", _ms(t0), "warn")]}

    facts = state.get("facts", {})
    analysis = state.get("analysis", {})
    if llm_available():
        try:
            draft = generate_json(SYNTH_PROMPT.format(
                language_name="Hindi (Devanagari script)" if lang == "hi" else "simple English",
                intents=", ".join(plan.get("intents", [])), question=plan.get("question", ""),
                facts=json.dumps({f"{{{k}}}": v for k, v in facts.items()}, ensure_ascii=False, indent=1),
                irrigation_decision=analysis.get("irrigation", {}).get("decision", "unavailable"),
                blockers=", ".join(analysis.get("spray", {}).get("blockers", [])) or "none",
                warnings="; ".join(state.get("warnings", [])) or "none"), temperature=0.3)
            return {"draft": {**draft, "_by": "llm"},
                    "trace": [step("synthesize", f"Gemini ({active_model()}) wrote advisory with placeholders "
                                                 f"(no raw numbers)", _ms(t0))]}
        except LLMError as exc:
            note = f"LLM failed ({exc}) → deterministic template"
    else:
        note = "no LLM key → deterministic template"
    return {"draft": {**template_draft(facts, analysis, lang), "_by": "template"},
            "trace": [step("synthesize", note, _ms(t0), "warn")]}


# --------------------------------------------------------------------------- 9. guardrail
def guardrail(state: AgentState) -> dict:
    t0 = time.perf_counter()
    draft = state.get("draft", {})
    facts = state.get("facts", {})
    lang = state.get("plan", {}).get("language", "en")
    if draft.get("_by") == "llm":
        bad = verify_draft(draft, facts)
        if bad:
            fallback = template_draft(facts, state.get("analysis", {}), lang)
            return {"advisory": {**render(fallback, facts), "verified": True, "by": "template (guardrail)"},
                    "trace": [step("guardrail", f"REJECTED LLM draft: unverified numbers {bad[:5]} → "
                                                f"replaced with verified template", _ms(t0), "warn")]}
        detail = "PASSED: LLM wrote 0 unverified numbers; all figures filled from tool outputs"
        by = "Gemini + verified facts"
    else:
        detail = "template draft — all figures filled from tool outputs"
        by = "deterministic template"
    return {"advisory": {**render(draft, facts), "verified": True, "by": by},
            "trace": [step("guardrail", detail, _ms(t0))]}


def route_location(state: AgentState) -> str:
    return "fetch_data" if state.get("status") == "ok" else "synthesize"
