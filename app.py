"""KisanSaathi — agentic, voice-first farm advisory (Forge Gen-AI buildathon, PS 2.1)."""
import time

import pandas as pd
import pydeck as pdk
import streamlit as st

from agent.graph import NODE_LABELS, build_graph, to_dot
from core.config import get_secret
from core.llm import llm_available
from core.voice import text_to_speech
from tools.geocode import geocode_place
from tools.mandi import fetch_state
from tools.names import COMMON_CROPS, state_candidates
from tools.weather import get_forecast

st.set_page_config(page_title="KisanSaathi", page_icon="🌾", layout="wide")

LIST_KEYS = {"trace", "warnings", "sources"}
STATUS_ICON = {"ok": "✅", "warn": "⚠️", "fail": "❌"}


@st.cache_resource
def get_graph():
    return build_graph()


# ------------------------------------------------------------------ sidebar
with st.sidebar:
    st.header("🌾 Farm profile")
    location = st.text_input("Village / town, district", value="Ganaur, Sonipat",
                             help="e.g. 'Karnal', 'Barwala, Hisar', 'Nashik'")
    crop_choice = st.selectbox("Crop", COMMON_CROPS + ["Other…"], index=0)
    crop = st.text_input("Crop name", value="") if crop_choice == "Other…" else crop_choice
    lang_label = st.radio("Reply language", ["Auto", "हिंदी", "English"], horizontal=True)
    ui_lang = {"Auto": "auto", "हिंदी": "hi", "English": "en"}[lang_label]
    cost = st.slider("Transport cost (₹ per quintal per km)", 0.1, 3.0, 0.5, 0.1,
                     help="Your own trucking cost — used to compute net price after transport. "
                          "Set it to what you actually pay.")
    speak = st.toggle("Speak the answer (Hindi/English voice)", value=True)

    st.divider()
    st.caption("**Live data status**")
    st.caption(f"{'🟢' if get_secret('DATA_GOV_API_KEY') else '🔴'} data.gov.in key · "
               f"{'🟢' if llm_available() else '🟡'} Gemini key")
    if st.button("🔥 Warm up live cache", help="Pre-fetches live mandi + weather data for this location "
                                             "so the demo is instant and survives an API outage."):
        with st.spinner("Fetching live data…"):
            try:
                place = geocode_place(location)[0]
                get_forecast(place["lat"], place["lon"])
                m = fetch_state(state_candidates(place["state"]))
                st.success(f"Cached {len(m['records'])} live mandi records for {m['state']} + weather.")
            except Exception as exc:
                st.error(f"Warm-up failed: {exc}")

# ------------------------------------------------------------------ header + input
st.title("🌾 KisanSaathi")
st.caption("Voice-first farm advisor · live weather, soil moisture, evapotranspiration & mandi prices · "
           "every number verified against live sources")

c1, c2 = st.columns([3, 2])
with c1:
    query = st.text_input("Ask in Hindi or English",
                          placeholder="कल टमाटर पर दवा छिड़कूं? और कहाँ बेचूं?  /  Should I irrigate my wheat?")
with c2:
    audio = st.audio_input("…or speak (Hindi / English)") if hasattr(st, "audio_input") else None
ask = st.button("Ask KisanSaathi", type="primary", width="stretch")

# ------------------------------------------------------------------ run agent
if ask:
    if not (query or audio or crop):
        st.warning("Type or speak a question, or pick a crop.")
        st.stop()
    inputs = {
        "query": query or "", "audio": audio.getvalue() if audio else None,
        "audio_mime": getattr(audio, "type", None) or "audio/wav",
        "ui_location": location, "ui_crop": crop, "ui_lang": ui_lang, "cost_per_qtl_km": cost,
        "trace": [], "warnings": [], "sources": [],
    }
    final = dict(inputs)
    t_start = time.perf_counter()
    with st.status("Agent working…", expanded=True) as status_box:
        for update in get_graph().stream(inputs, stream_mode="updates"):
            for node, delta in update.items():
                for k, v in (delta or {}).items():
                    if k in LIST_KEYS:
                        final[k] = final.get(k, []) + list(v)
                    else:
                        final[k] = v
                for t in (delta or {}).get("trace", []):
                    st.write(f"{STATUS_ICON.get(t['status'], '•')} **{t['node']}** — {t['detail']} "
                             f"`{t['ms']} ms`")
        status_box.update(label=f"Done in {time.perf_counter() - t_start:.1f}s", state="complete", expanded=False)

    adv = final.get("advisory", {})
    if speak and adv.get("summary"):
        audio_bytes, engine_name = text_to_speech(adv["summary"], final.get("plan", {}).get("language", "hi"))
        final["tts"] = (audio_bytes, engine_name)
    st.session_state["result"] = final

# ------------------------------------------------------------------ results
res = st.session_state.get("result")
if not res:
    st.info("👆 Ask a question, e.g. **“कल टमाटर पर दवा छिड़कूं? और कहाँ बेचूं?”** — the agent fetches live "
            "weather, soil and mandi data, checks it, and answers with a verified plan.")
    st.stop()

adv = res.get("advisory", {})
plan = res.get("plan", {})
left, right = st.columns([3, 2])
with left:
    if plan.get("transcript") and res.get("audio"):
        st.caption(f"🎙️ Heard: “{plan['transcript']}”")
    st.subheader("📋 Advisory")
    st.markdown(f"#### {adv.get('summary', '')}")
    tts = res.get("tts")
    if tts and tts[0]:
        st.audio(tts[0], format="audio/mp3")
        st.caption(f"Voice: {tts[1]}")
    for a in adv.get("actions", []):
        st.markdown(f"**{a['title']}** — {a['detail']}")
    if adv.get("tip"):
        st.info(adv["tip"])
    st.caption(f"🛡️ Written by: {adv.get('by', '—')} · all figures computed from live tool outputs")
    for w in res.get("warnings", []):
        st.warning(w)
with right:
    st.subheader("🧠 Agent graph (this run)")
    visited = [t["node"] for t in res.get("trace", [])]
    alias = {"fetch_weather": "fetch_data", "fetch_mandi": "fetch_data", "fetch_parallel": "fetch_data",
             "verify_commodity": "resolve_commodity", "engine": "engine"}
    nodes_hit = {alias.get(n, n) for n in visited}
    if any("neighbouring states" in t["detail"] for t in res.get("trace", [])):
        nodes_hit.add("expand_states")
    if any("widening search" in t["detail"] for t in res.get("trace", [])):
        nodes_hit.add("widen_radius")
    st.graphviz_chart(to_dot([n for n in NODE_LABELS if n in nodes_hit]), width="stretch")
    st.caption("🟢 executed · 🟠 self-correction loop fired · ⚪ not needed")

analysis = res.get("analysis", {})
tab_spray, tab_irr, tab_mkt, tab_trace, tab_src = st.tabs(
    ["🌦️ Spray windows", "💧 Irrigation & soil", "💰 Mandi ranking", "🔍 Agent trace", "📚 Sources"])

with tab_spray:
    sp = analysis.get("spray")
    if sp:
        if sp["windows"]:
            st.dataframe(pd.DataFrame(sp["windows"]), width="stretch", hide_index=True)
        else:
            st.warning(f"No safe window in the next {sp['horizon_h']} h. Blocked by: {', '.join(sp['blockers'])}")
        if sp.get("next_rain"):
            st.caption(f"Next rain: {sp['next_rain']['time']} · {sp['next_rain']['probability_pct']}% · "
                       f"{sp['next_rain']['mm']} mm")
        st.caption(f"Rules: {sp['rules']}")
        wx = res.get("weather")
        if wx:
            h = pd.DataFrame(wx["hourly"]).head(48).set_index("time")
            st.line_chart(h[["precipitation_probability", "wind_speed_10m"]])
            st.line_chart(h[["vapour_pressure_deficit"]])
    else:
        st.info("Weather data unavailable.")

with tab_irr:
    irr = analysis.get("irrigation")
    if irr:
        st.markdown(f"### {irr['decision']}")
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Root-zone moisture", f"{irr['root_zone_moisture_pct']}%")
        m2.metric("Rain next 3 days", f"{irr['rain_next_3d_mm']} mm")
        m3.metric("Crop demand ET₀ (3 d)", f"{irr['et0_next_3d_mm']} mm")
        m4.metric("Water balance", f"{irr['water_balance_3d_mm']} mm")
        st.caption(f"Soil temperature (surface): {irr['soil_temp_c']} °C · moisture bands (m³/m³): {irr['bands']} · "
                   "soil moisture is model-derived (Open-Meteo), ET₀ = FAO-56 Penman-Monteith.")
        wx = res.get("weather")
        if wx:
            h = pd.DataFrame(wx["hourly"]).head(72).set_index("time")
            st.line_chart(h[["soil_moisture_0_to_1cm", "soil_moisture_3_to_9cm", "soil_moisture_9_to_27cm"]])
    else:
        st.info("Weather/soil data unavailable.")

with tab_mkt:
    ranked = res.get("ranked") or []
    if ranked:
        st.caption(f"Commodity matched: **{res.get('commodity')}** · prices ₹/quintal · "
                   f"transport at ₹{res.get('cost_per_qtl_km')}/qtl/km (your setting) · road ≈ 1.3 × straight line")
        df = pd.DataFrame(ranked)[["rank", "market", "district", "state", "modal_price", "distance_km",
                                   "transport_cost", "net_price", "arrival_date"]]
        st.dataframe(df, width="stretch", hide_index=True)
        pts = [m for m in ranked if m.get("lat")]
        place = res.get("place", {})
        if pts and place:
            mdf = pd.DataFrame(pts)
            mdf["color"] = [[22, 163, 74, 200] if m["rank"] == 1 else [37, 99, 235, 160] for m in pts]
            farm = pd.DataFrame([{"lat": place["lat"], "lon": place["lon"], "market": "Your farm"}])
            st.pydeck_chart(pdk.Deck(
                map_provider="carto", map_style="light",
                initial_view_state=pdk.ViewState(latitude=place["lat"], longitude=place["lon"], zoom=7),
                layers=[
                    pdk.Layer("ScatterplotLayer", mdf, get_position="[lon, lat]", get_fill_color="color",
                              get_radius=6000, pickable=True),
                    pdk.Layer("ScatterplotLayer", farm, get_position="[lon, lat]", get_fill_color=[220, 38, 38, 230],
                              get_radius=5000, pickable=True),
                ],
                tooltip={"text": "{market}\nnet ₹{net_price}/qtl · {distance_km} km"}))
    else:
        st.info("No mandi data for this crop today.")

with tab_trace:
    st.dataframe(pd.DataFrame(res.get("trace", [])), width="stretch", hide_index=True)
    with st.expander("Planner output"):
        st.json(plan)
    with st.expander("Verified facts passed to the writer"):
        st.json(res.get("facts", {}))

with tab_src:
    for s in res.get("sources", []):
        st.markdown(f"- **{s['name']}** — {s['detail']}")
    st.caption("Mandi: data.gov.in resource 9ef84268-d588-465a-a308-a864a43d0070 (Agmarknet, DMI). "
               "Weather/soil/ET₀/VPD: api.open-meteo.com. Geocoding: geocoding-api.open-meteo.com.")
