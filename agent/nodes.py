"""LangGraph nodes. LLM is used in exactly two places (planner, synthesizer); everything in
between is deterministic tool execution with explicit verification / self-correction."""
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor

from agent.guardrails import IRRIGATION_HI, render, template_draft, verify_draft
from agent.prompts import ASK_PROMPT, PLANNER_PROMPT, SYNTH_PROMPT
from agent.state import AgentState, step
from core.config import now_ist
from core.llm import LLMError, active_model, generate_json, llm_available
from tools import engine
from tools.geocode import geocode_districts, geocode_place, reverse_geocode
from tools.mandi import fetch_state
from tools.names import COMMON_CROPS, HINDI_CROPS, NEIGHBOURS, match_commodity, state_candidates
from tools.weather import get_forecast

RADII = [50, 120, 250, None]  # km; None = whole state
ALL_INTENTS = ["spray", "irrigation", "sell", "weather"]
DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def _ms(t0):
    return (time.perf_counter() - t0) * 1000


# --------------------------------------------------------------------------- 1. planner
DONT_KNOW = re.compile(r"(pata nahi|pata nahin|पता नहीं|मालूम नहीं|nahi pata|don'?t know|dont know|not sure|skip|no idea)", re.I)
NUM = re.compile(r"\d+(?:\.\d+)?")
EN_CROPS = {c.lower(): c for c in COMMON_CROPS}


def _rule_parse(query: str, asked: str | None) -> dict:
    """Deterministic fallback when Gemini is unavailable."""
    q = query.strip()
    crop = None
    for hi, en in HINDI_CROPS.items():
        if hi in q:
            crop = en
    for low, en in EN_CROPS.items():
        if re.search(rf"\b{re.escape(low)}\b", q.lower()):
            crop = en
    if not crop and asked == "crop" and q and len(q.split()) <= 3:
        crop = q  # treat a short answer as the crop name; fuzzy-matched against mandi data later
    transport = {"cost_per_km": None, "load_quintals": None, "cost_per_qtl_km": None, "unknown": False}
    if asked == "transport":
        if DONT_KNOW.search(q):
            transport["unknown"] = True
        else:
            nums = [float(n) for n in NUM.findall(q)]
            if len(nums) >= 2:
                transport["cost_per_km"], transport["load_quintals"] = nums[0], nums[1]
            elif len(nums) == 1:
                transport["cost_per_km"] = nums[0]
    elif asked == "transport_load":
        nums = [float(n) for n in NUM.findall(q)]
        if nums:
            transport["load_quintals"] = nums[0]
        elif DONT_KNOW.search(q):
            transport["unknown"] = True
    location = q if asked == "location" and q else None
    low = q.lower()
    intents = [i for i, pat in INTENT_WORDS.items() if re.search(pat, low)]
    answering = bool(asked) and bool(q)
    mode = "advisory" if (intents or answering) else "chat"
    if mode == "advisory" and not intents and crop:
        intents = ["spray", "irrigation", "weather"]
    lang = ("hi" if DEVANAGARI.search(q) else "en") if q else None
    reply = ""
    if mode == "chat":
        reply = ("मैं किसानसाथी हूँ — आपका खेती सहायक। मैं आज के मौसम, मिट्टी की नमी, छिड़काव के सही समय, सिंचाई और मंडी भाव "
                 "लाइव डेटा से बता सकता हूँ। आप किस फसल के बारे में पूछना चाहेंगे?") if lang == "hi" else (
                 "I'm KisanSaathi, your farming assistant. I can check today's weather, soil moisture, safe spray times, "
                 "irrigation and live mandi prices for your crop. Which crop would you like help with?")
    return {"transcript": q, "language": lang, "crop": crop, "mode": mode, "reply": reply,
            "location": location, "intents": intents, "question": q or "general advisory", "transport": transport}


INTENT_WORDS = {
    "spray": r"spray|छिड़|छिड|दवा|कीटनाशक|pesticide",
    "irrigation": r"irrigat|सिंचाई|पानी दे|पानी कब|water my|watering",
    "sell": r"sell|बेच|मंडी|mandi|price|rate|भाव|दाम|market",
    "weather": r"weather|मौसम|बारिश|rain|forecast",
}


def _season(dt) -> str:
    m = dt.month
    if m in (10, 11, 12, 1, 2):
        return "Rabi sowing/growing season (winter)"
    if m in (3, 4, 5):
        return "Zaid season (summer) / Rabi harvest"
    return "Kharif season (monsoon)"


def _merge_slots(known: dict, plan: dict, asked: str | None) -> dict:
    slots = dict(known or {})
    if plan.get("crop"):
        slots["crop"] = plan["crop"]
    if plan.get("location"):
        slots["location"] = plan["location"]
    new_intents = [i for i in (plan.get("intents") or []) if i in ALL_INTENTS]
    if new_intents and (not asked or not slots.get("intents")):  # a fresh request sets the goal; an answer keeps it
        slots["intents"] = new_intents
        slots["question"] = plan.get("question") or slots.get("question")
    elif new_intents:
        slots["intents"] = list(dict.fromkeys((slots.get("intents") or []) + new_intents))
    slots["language"] = plan.get("language") or slots.get("language") or "en"
    t = plan.get("transport") or {}
    for k in ("cost_per_km", "load_quintals", "cost_per_qtl_km"):
        try:
            if t.get(k) is not None and float(t[k]) > 0:
                slots[k] = float(t[k])
        except (TypeError, ValueError):
            pass
    if t.get("unknown"):
        slots["transport_unknown"] = True
    if not slots.get("cost_per_qtl_km") and slots.get("cost_per_km") and slots.get("load_quintals"):
        slots["cost_per_qtl_km"] = round(slots["cost_per_km"] / slots["load_quintals"], 3)
    return slots


def planner(state: AgentState) -> dict:
    t0 = time.perf_counter()
    query = (state.get("query") or "").strip()
    audio = state.get("audio")
    asked = state.get("asked") or None
    known = state.get("known") or {}
    ui_lang = state.get("ui_lang", "auto")
    plan, how, warnings = None, "", []

    if llm_available() and (query or audio):
        history = "\n".join(f"{m.get('role', '?')}: {m.get('text', '')}" for m in (state.get("history") or [])[-8:]) or "(none)"
        try:
            now = now_ist()
            place = (known.get("location") or state.get("ui_place_label") or state.get("ui_location") or
                     ("GPS coordinates %.3f, %.3f" % (state["ui_lat"], state["ui_lon"]) if state.get("ui_lat") is not None else "unknown"))
            plan = generate_json(
                PLANNER_PROMPT.format(query=query.replace('"', "'"), known=json.dumps(known, ensure_ascii=False),
                                      asked=asked or "nothing", history=history, today=now.strftime("%d %B %Y"),
                                      season=_season(now), place=place),
                audio=audio, audio_mime=state.get("audio_mime", "audio/wav"),
                budget_s=18 if audio else 12)
            how = f"Gemini ({active_model()}) understood " + ("voice" if audio else "text")
        except LLMError as exc:
            warnings.append(f"Gemini planner unavailable ({exc}) — used rule-based parser.")
    elif audio and not llm_available():
        warnings.append("Voice needs the Gemini key — please type your answer.")

    if not plan:
        plan = _rule_parse(query, asked)
        how = how or "rule-based parser"

    slots = _merge_slots(known, plan, asked)
    plan["mode"] = "chat" if plan.get("mode") == "chat" else "advisory"
    plan["crop"] = slots.get("crop")
    plan["intents"] = [i for i in (slots.get("intents") or []) if i in ALL_INTENTS]
    if plan["mode"] == "advisory" and not plan["intents"]:
        plan["intents"] = ["spray", "irrigation", "weather"]  # crop check-up without selling
    plan["question"] = slots.get("question") or plan.get("question")
    plan["language"] = ui_lang if ui_lang in ("hi", "en") else ("hi" if slots.get("language") == "hi" else "en")

    # Location priority: place named in the conversation > device GPS > place typed in the app
    named = (slots.get("location") or "").strip()
    if named:
        plan["location"], plan["location_source"] = named, "named by farmer"
    elif state.get("ui_lat") is not None and state.get("ui_lon") is not None:
        plan["location"], plan["location_source"] = None, "device GPS"
    elif (state.get("ui_location") or "").strip():
        plan["location"], plan["location_source"] = state["ui_location"].strip(), "typed in app"
    else:
        plan["location"], plan["location_source"] = None, "none"

    cost = slots.get("cost_per_qtl_km")
    known_txt = [f"crop={plan['crop'] or '?'}", f"place={plan['location'] or plan['location_source']}",
                 f"transport={'₹%s/qtl/km' % cost if cost else ('not given' if slots.get('transport_unknown') else '?')}"]
    return {"plan": plan, "slots": slots, "cost_per_qtl_km": cost, "warnings": warnings,
            "trace": [step("planner", f"{how}: mode={plan['mode']}, {', '.join(known_txt)}, intents={','.join(plan['intents']) or '-'}, "
                                      f"lang={plan['language']}", _ms(t0))]}


# --------------------------------------------------------------------------- 1b. slot check: ask the farmer?
def _missing_slot(state: AgentState) -> str | None:
    plan, slots = state["plan"], state.get("slots") or {}
    if not plan.get("crop"):
        return "crop"
    if plan.get("location_source") == "none":
        return "location"
    # transport cost is optional: never block an answer on it (it only refines net-price ranking when given)
    if slots.get("cost_per_km") and not slots.get("load_quintals") and not slots.get("cost_per_qtl_km") \
            and not slots.get("transport_unknown") and state.get("asked") != "transport_load":
        return "transport_load"
    return None


def check_slots(state: AgentState) -> dict:
    missing = _missing_slot(state)
    if missing:
        return {"status": "need_info", "asked": missing,
                "trace": [step("check_slots", f"missing '{missing}' → ask the farmer before fetching data", 0, "warn")]}
    return {"asked": None, "trace": [step("check_slots", "crop, location and transport known → proceed", 0)]}


def route_slots(state: AgentState) -> str:
    return "ask_farmer" if state.get("status") == "need_info" else "locate"


def route_mode(state: AgentState) -> str:
    return "converse" if state["plan"].get("mode") == "chat" else "check_slots"


def converse(state: AgentState) -> dict:
    """Open conversation: Gemini already answered in the planner call (one LLM round-trip)."""
    plan = state["plan"]
    reply = (plan.get("reply") or "").strip()
    if not reply:
        reply = _rule_parse("", None)["reply"] if plan.get("language") != "hi" else (
            "मैं किसानसाथी हूँ। मैं मौसम, सिंचाई, छिड़काव और मंडी भाव में आपकी मदद कर सकता हूँ। बताइए, किस फसल के बारे में पूछना है?")
    return {"status": "chat", "asked": None,
            "advisory": {"summary": reply, "actions": [], "tip": "", "verified": True,
                         "by": f"Gemini ({active_model()}) conversation" if plan.get("reply") else "assistant"},
            "trace": [step("converse", "general conversation — answered directly, no live data needed", 0)]}


QUESTIONS = {
    "crop": ("आप किस फसल के बारे में पूछ रहे हैं? (जैसे टमाटर, गेहूं, धान)",
             "Which crop is this about? (e.g. tomato, wheat, paddy)"),
    "location": ("आपका खेत किस गाँव/कस्बे और ज़िले में है? (या लोकेशन की अनुमति दें)",
                 "Where is your farm — village/town and district? (or allow location access)"),
    "transport": ("मंडी तक माल ले जाने में गाड़ी (ट्रैक्टर/ट्रक) का किराया प्रति किलोमीटर कितना लगता है, और एक बार में कितने क्विंटल ले जाते हैं? "
                  "पता न हो तो 'पता नहीं' कहें।",
                  "To compare mandis after transport: what does your vehicle (tractor/truck) cost per km, and how many quintals "
                  "do you carry per trip? Say 'don't know' to skip."),
    "transport_load": ("एक बार में गाड़ी में कितने क्विंटल माल जाता है?", "How many quintals do you carry per trip?"),
}
MISSING_DESC = {
    "crop": "which crop they are asking about",
    "location": "their village/town and district (or they can allow location access)",
    "transport": "their vehicle/transport cost in rupees per km and how many quintals they carry per trip "
                 "(needed to compare mandis after transport); they may say they don't know",
    "transport_load": "how many quintals they carry per trip",
}


def ask_farmer(state: AgentState) -> dict:
    t0 = time.perf_counter()
    slot = state.get("asked") or "crop"
    lang = state["plan"].get("language", "en")
    text, by = None, "template"
    if llm_available():
        history = "\n".join(f"{m.get('role', '?')}: {m.get('text', '')}" for m in (state.get("history") or [])[-6:])
        history += f"\nfarmer: {state['plan'].get('transcript') or state.get('query') or ''}"
        try:
            out = generate_json(ASK_PROMPT.format(missing=MISSING_DESC[slot], history=history,
                                                  language_name="Hindi (Devanagari)" if lang == "hi" else "simple English"),
                                temperature=0.5, budget_s=8)
            text, by = (out.get("question") or "").strip() or None, f"Gemini ({active_model()})"
        except LLMError:
            pass
    if not text:
        hi, en = QUESTIONS[slot]
        text = hi if lang == "hi" else en
    return {"advisory": {"summary": text, "actions": [], "tip": "", "verified": True, "by": f"agent question · {by}", "question": True},
            "trace": [step("ask_farmer", f"asked the farmer about {slot} ({by})", _ms(t0))]}


# --------------------------------------------------------------------------- 2. locate
def locate(state: AgentState) -> dict:
    t0 = time.perf_counter()
    plan = state["plan"]
    if plan.get("location_source") == "device GPS":
        lat, lon = float(state["ui_lat"]), float(state["ui_lon"])
        try:
            place = reverse_geocode(lat, lon)
        except Exception as exc:
            return {"status": "need_location", "warnings": [f"Could not identify your GPS location ({exc}) — please type your village, district."],
                    "trace": [step("locate", f"reverse geocoding failed for ({lat:.3f}, {lon:.3f})", _ms(t0), "fail")]}
        return {"status": "ok", "place": place, "place_candidates": [place],
                "sources": [{"name": place.get("source", "Reverse geocoding"),
                             "detail": f"device GPS → {place['name']}, {place.get('district')}, {place['state']}"}],
                "trace": [step("locate", f"device GPS ({lat:.3f}, {lon:.3f}) → {place['name']}, "
                                         f"{place.get('district')}, {place['state']}", _ms(t0))]}

    loc = plan.get("location")
    if not loc:
        return {"status": "need_location", "place_candidates": [],
                "warnings": ["No location yet — allow location access or type your village, district."],
                "trace": [step("locate", "no GPS and no place given", _ms(t0), "fail")]}
    try:
        candidates = geocode_place(loc)
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
            "trace": [step("locate", f"{plan.get('location_source')}: {place['name']}, {place.get('district')}, "
                                     f"{place.get('state')} ({place['lat']:.3f}, {place['lon']:.3f})", _ms(t0))]}


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
                                state.get("cost_per_qtl_km"))
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
    if ranked and "sell" in state["plan"].get("intents", []):
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
        if state.get("cost_per_qtl_km"):
            facts["net_label"] = "भाड़ा घटाकर" if lang == "hi" else "after transport"
        else:
            facts["net_label"] = "(भाड़ा शामिल नहीं)" if lang == "hi" else "(transport not included)"
            warnings.append("Mandis ranked by price with distance shown — tell me your vehicle cost per km and load to rank by net earnings.")
    elif state["plan"].get("crop"):
        warnings.append(f"No mandi prices found today for {state['plan']['crop']}.")

    analysis["intents"] = state["plan"].get("intents", [])
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
                warnings="; ".join(state.get("warnings", [])) or "none"), temperature=0.3, budget_s=20)
            if not str(draft.get("summary") or "").strip():
                raise LLMError("empty draft")
            return {"draft": {**draft, "_by": "llm"},
                    "trace": [step("synthesize", f"Gemini ({active_model()}) wrote advisory with placeholders "
                                                 f"(no raw numbers)", _ms(t0))]}
        except LLMError as exc:
            note = f"Gemini unavailable ({exc}) → verified deterministic template"
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
