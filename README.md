# 🌾 KisanSaathi — Agentic, voice-first farm advisor

**Forge Gen-AI Buildathon · Theme 2 · PS 2.1 — Multilingual Agritech & Resource Advisory Assistant**

A farmer asks in Hindi or English, by voice or text: *"कल टमाटर पर दवा छिड़कूं? और कहाँ बेचूं?"*
(Should I spray my tomatoes tomorrow, and where should I sell?)
A LangGraph agent pulls **live** weather, soil moisture, evapotranspiration and **today's mandi prices**,
checks and corrects its own data gaps, computes the answer **in deterministic Python**, and replies in
plain Hindi or English with a neural voice. Every number shown or spoken is traceable to a live source.

## What makes it different
| | Typical farm chatbot | KisanSaathi |
|---|---|---|
| Numbers | LLM writes them (can hallucinate) | LLM writes **placeholders only**. Python fills every number, and a guardrail rejects any figure the LLM invents |
| Spraying | "Avoid spraying in rain" | Exact safe **time windows** from hourly rain probability, wind, temperature and **vapour-pressure deficit** |
| Irrigation | Generic tips | Root-zone **soil moisture** plus 3-day **rain vs FAO-56 ET₀** water balance gives irrigate now / soon / hold |
| Selling | One mandi price | Every mandi trading the crop today, ranked by **net ₹/quintal after the farmer's own transport cost** |
| Failures | Crashes or makes things up | Self-correction loops (neighbouring states, wider radius), disk fallback of the last real pull, honest warnings |

## Architecture
```mermaid
flowchart TB
    IN["🎙️ Voice / ⌨️ Text (Hindi · English)"] --> P["Planner · Gemini<br/>speech→intent, crop, place"]
    P --> L["Geocode farmer<br/>Open-Meteo Geocoding"]
    L -- not found --> S
    L --> F{{"Parallel fetch"}}
    F --> W["Weather + soil moisture + VPD + ET₀<br/>Open-Meteo Forecast API"]
    F --> M["Today's mandi prices (state pull)<br/>data.gov.in · Agmarknet"]
    W & M --> C["Verify commodity<br/>rapidfuzz vs today's traded list"]
    C -- not traded --> N["Self-correct:<br/>pull neighbouring states"] --> C
    C --> G["Geocode mandi districts<br/>parallel + disk cache"]
    G --> R["Rank by net price<br/>haversine × 1.3, user ₹/qtl/km"]
    R -- "< 3 mandis" --> X["Self-correct:<br/>radius 50→120→250 km→state"] --> R
    R --> E["Deterministic engine<br/>spray windows · irrigation · market summary"]
    E --> S["Synthesizer · Gemini<br/>writes text with {placeholders}"]
    S --> GR["Guardrail<br/>reject unverified numbers → template"]
    GR --> OUT["Advisory card · agent graph · map · edge-tts voice"]
```

**Design principle: the LLM reasons and explains, Python calculates.** Gemini is used in only two nodes
(planner, synthesizer). Every node in between is deterministic and logged to the live **Agent Trace** in the UI.

### Components
| Layer | File | Notes |
|---|---|---|
| UI | `app.py` | Streamlit; live node-by-node trace, run-specific graph view, charts, pydeck map |
| Agent | `agent/graph.py`, `agent/nodes.py` | LangGraph `StateGraph` with conditional self-correction edges |
| Guardrail | `agent/guardrails.py` | placeholder rendering, ±1 / ±1 % number verification, deterministic HI/EN templates |
| Tools | `tools/weather.py`, `tools/mandi.py`, `tools/geocode.py` | timeout + retry + memory TTL cache + disk fallback of last **live** response |
| Engine | `tools/engine.py` | spray windows, irrigation decision, net-price market ranking |
| Voice | `core/voice.py` | Gemini native audio for speech input; edge-tts `hi-IN-SwaraNeural` output (worker thread), gTTS fallback |

### Live data sources (no mock data anywhere)
| Data | Source |
|---|---|
| Mandi prices (today) | data.gov.in resource `9ef84268-d588-465a-a308-a864a43d0070`, *Current Daily Price of Various Commodities from Various Markets (Mandi)*, Agmarknet / DMI |
| Hourly weather, VPD, FAO-56 ET₀, 4-layer soil moisture, soil temperature | Open-Meteo Forecast API |
| Geocoding (farmer + mandi districts) | Open-Meteo Geocoding API |

`.cache/` is created at runtime only from real API responses (git-ignored), so an outage serves the last
real pull **labelled with its fetch time**.

### Decision rules (deterministic)
- **Spray window:** daylight, rain probability ≤ 20 %, wind ≤ 15 km/h, 10–32 °C, VPD 0.3–1.6 kPa, no rain in the next 4 h, at least 2 consecutive hours.
- **Irrigation:** hold if 3-day rain ≥ 80 % of 3-day ET₀ (and ≥ 5 mm); irrigate now if root-zone moisture < 0.17 m³/m³; irrigate soon if < 0.27 and the 3-day balance is below −8 mm; otherwise no need.
- **Market:** FAQ-grade modal price (median across grades otherwise); road km = 1.3 × great-circle distance; net = modal − km × user's ₹/qtl/km.

## Run locally
```bash
pip install -r requirements.txt
cp .streamlit/secrets.toml.example .streamlit/secrets.toml   # add your keys
uvicorn server:app --port 8000          # React UI + API at http://localhost:8000
```
The React frontend (`frontend/`, Vite + Tailwind + Recharts + Leaflet) is pre-built into `frontend/dist`
and served by FastAPI. To change the UI: `cd frontend && npm install && npm run dev` (proxies `/api` to :8000),
then `npm run build`.

Keys: `DATA_GOV_API_KEY` (data.gov.in → My Account → Generate Key), `GEMINI_API_KEY` (Google AI Studio).
Without a Gemini key the app still runs: rule-based planner + deterministic templates.
A Streamlit version of the same agent is kept in `app.py` (`streamlit run app.py`).

### API
| Endpoint | Purpose |
|---|---|
| `GET /api/health` | which live sources are configured |
| `POST /api/warmup` | pre-fetch live weather + mandi data for a location |
| `POST /api/ask` | runs the agent; streams each graph node as Server-Sent Events, then the final result |

## Deploy (Render, free tier)
1. Push this repo to GitHub (public).
2. render.com → New → Blueprint → pick the repo (uses `render.yaml`), then set `DATA_GOV_API_KEY` and `GEMINI_API_KEY`.
3. Free instances sleep when idle: open the URL a minute before judging, then click **Warm up live cache** for each demo location.

## Limitations (honest)
- Soil moisture is model-derived (Open-Meteo), not an in-field sensor.
- Mandi distances use district HQ coordinates × road factor, not turn-by-turn routing.
- Agmarknet publishes only the current day; early in the morning fewer mandis may have reported.
