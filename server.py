"""FastAPI backend for the React frontend.

  GET  /api/health   → which live sources are configured
  POST /api/warmup   → pre-fetch live weather + mandi data for a location
  POST /api/ask      → runs the LangGraph agent and streams each node as Server-Sent Events,
                       then a final 'result' event (advisory, analysis, ranking, TTS audio)

The built React app (frontend/dist) is served from '/', so the whole product is one deployable.
Run:  uvicorn server:app --port 8000
"""
import base64
import json
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from agent.graph import build_graph
from core.config import get_secret, now_iso
from core.llm import active_model, llm_available
from core.voice import text_to_speech
from tools.geocode import geocode_place
from tools.mandi import fetch_state
from tools.names import COMMON_CROPS, state_candidates
from tools.weather import get_forecast

app = FastAPI(title="KisanSaathi API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
GRAPH = build_graph()
LIST_KEYS = {"trace", "warnings", "sources"}
SERIES_KEYS = ["temperature_2m", "relative_humidity_2m", "precipitation_probability", "precipitation",
               "wind_speed_10m", "vapour_pressure_deficit", "soil_moisture_0_to_1cm",
               "soil_moisture_3_to_9cm", "soil_moisture_9_to_27cm"]


@app.get("/api/health")
def health():
    return {"data_gov": bool(get_secret("DATA_GOV_API_KEY")), "gemini": llm_available(),
            "model": active_model(), "time": now_iso(), "crops": COMMON_CROPS}


@app.post("/api/warmup")
def warmup(location: str = Form(...)):
    try:
        place = geocode_place(location)[0]
    except Exception as exc:
        return JSONResponse({"ok": False, "error": f"Location not found: {exc}"}, status_code=200)
    out = {"ok": True, "place": place}
    try:
        wx = get_forecast(place["lat"], place["lon"])
        out["weather"] = wx["cache"]
    except Exception as exc:
        out["weather"] = f"failed: {exc}"
    try:
        m = fetch_state(state_candidates(place["state"]))
        out.update(mandi_records=len(m["records"]), mandi_state=m["state"], mandi=m["cache"])
    except Exception as exc:
        out["mandi"] = f"failed: {exc}"
    return out


def _now_index(times):
    from tools.engine import _now_index as idx
    return idx(times)


def _compact(final: dict, t_start: float) -> dict:
    wx = final.get("weather") or {}
    series, current = None, None
    if wx.get("hourly"):
        h = wx["hourly"]
        i0 = _now_index(h["time"])
        sl = slice(i0, i0 + 72)
        series = {"time": h["time"][sl], **{k: (h.get(k) or [])[sl] for k in SERIES_KEYS}}
        current = {k: (h.get(k) or [None] * (i0 + 1))[i0] for k in
                   ("temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation_probability",
                    "vapour_pressure_deficit")}
    adv = final.get("advisory") or {}
    return {
        "plan": final.get("plan"), "place": final.get("place"), "status": final.get("status"),
        "advisory": adv, "analysis": final.get("analysis") or {}, "facts": final.get("facts") or {},
        "ranked": final.get("ranked") or [], "commodity": final.get("commodity"),
        "cost_per_qtl_km": final.get("cost_per_qtl_km"), "trace": final.get("trace", []),
        "warnings": final.get("warnings", []), "sources": final.get("sources", []),
        "series": series, "current": current, "model": active_model(),
        "total_ms": int((time.perf_counter() - t_start) * 1000),
    }


@app.post("/api/ask")
async def ask(query: str = Form(""), location: str = Form("Ganaur, Sonipat"), crop: str = Form("Tomato"),
              lang: str = Form("auto"), cost: float = Form(0.5), speak: bool = Form(True),
              audio: UploadFile | None = File(None)):
    audio_bytes = await audio.read() if audio else None
    inputs = {"query": query, "audio": audio_bytes or None,
              "audio_mime": (audio.content_type if audio else None) or "audio/wav",
              "ui_location": location, "ui_crop": crop, "ui_lang": lang, "cost_per_qtl_km": cost,
              "trace": [], "warnings": [], "sources": []}

    def events():
        t_start = time.perf_counter()
        final = dict(inputs)
        try:
            for update in GRAPH.stream(inputs, stream_mode="updates"):
                for _node, delta in update.items():
                    for k, v in (delta or {}).items():
                        final[k] = final.get(k, []) + list(v) if k in LIST_KEYS else v
                    for t in (delta or {}).get("trace", []):
                        yield f"data: {json.dumps({'type': 'step', 'step': t}, ensure_ascii=False)}\n\n"
            result = _compact(final, t_start)
            summary = (result["advisory"] or {}).get("summary")
            if speak and summary:
                audio_mp3, engine_name = text_to_speech(summary, (result["plan"] or {}).get("language", "hi"))
                if audio_mp3:
                    result["tts"] = base64.b64encode(audio_mp3).decode()
                result["tts_engine"] = engine_name
            yield f"data: {json.dumps({'type': 'result', 'result': result}, ensure_ascii=False, default=str)}\n\n"
        except Exception as exc:  # never leave the UI hanging
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


DIST = Path(__file__).resolve().parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        file = DIST / path
        return FileResponse(file if path and file.is_file() else DIST / "index.html")
