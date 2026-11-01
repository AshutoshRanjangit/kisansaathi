import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, ArrowRight, MessageCircleQuestion, CloudSun, Droplets, IndianRupee, Loader2 } from "lucide-react";
import { startRecording } from "../recorder.js";
import { Pill, inr } from "./ui.jsx";

const EXAMPLES = [
  ["🍅", "कल टमाटर पर दवा छिड़कूं? और कहाँ बेचूं?", "Spray + sell tomato"],
  ["🌾", "क्या आज गेहूं में सिंचाई करनी चाहिए?", "Irrigate wheat?"],
  ["🌱", "Where should I sell my paddy for the best price?", "Best paddy mandi"],
];

export default function AskView({ onAsk, running, result, chat = [], pending = null }) {
  const [text, setText] = useState("");
  const [rec, setRec] = useState(null);
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState("");
  const timer = useRef();

  useEffect(() => () => clearInterval(timer.current), []);

  async function toggleMic() {
    setMicError("");
    if (rec) {
      clearInterval(timer.current);
      const blob = await rec.stop();
      setRec(null);
      onAsk("", blob);
      setText("");
      return;
    }
    try {
      const r = await startRecording();
      setRec(r);
      setSecs(0);
      timer.current = setInterval(() => { setSecs((s) => s + 0.1); setLevel(r.level()); }, 100);
    } catch (e) {
      setMicError("Microphone blocked — allow mic access or type your question.");
    }
  }

  const cur = result?.current;
  const irr = result?.analysis?.irrigation;
  const best = result?.analysis?.market?.best;
  const gain = result?.analysis?.market?.extra_gain_per_qtl;

  return (
    <div className="space-y-6">
      <section className="card relative overflow-hidden px-6 py-10 text-center md:px-12">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-forest-50/70 to-transparent" />
        <Pill tone="slate" className="relative">🎙️ Voice or text · हिंदी / English · Gemini multimodal</Pill>

        <div className="relative mx-auto mt-8 grid place-items-center">
          <button
            onClick={toggleMic}
            disabled={running}
            className={`grid h-32 w-32 place-items-center rounded-full text-white transition ${
              rec ? "mic-rec bg-red-600" : "mic-ring bg-forest-800 hover:bg-forest-700"
            } disabled:opacity-50`}
            style={rec ? { transform: `scale(${1 + level * 0.12})` } : undefined}
          >
            <span className="flex flex-col items-center gap-1">
              {rec ? <Square size={30} fill="white" /> : running ? <Loader2 size={34} className="animate-spin" /> : <Mic size={36} />}
              <span className="text-[11px] font-semibold tracking-wider">
                {rec ? `${secs.toFixed(1)}s · STOP` : running ? "THINKING" : "TAP TO SPEAK"}
              </span>
            </span>
          </button>
        </div>
        <h1 className="relative mt-6 text-3xl font-extrabold text-slate-900 md:text-4xl">
          <span className="hi">बोलकर पूछें</span> <span className="font-light text-slate-400">/ Tap to speak</span>
        </h1>
        <p className="hi relative mx-auto mt-2 max-w-2xl text-slate-500">
          छिड़काव का सही समय, सिंचाई, और नज़दीकी मंडियों का शुद्ध भाव — सब लाइव डेटा से
        </p>
        {micError && <p className="relative mt-2 text-sm text-red-600">{micError}</p>}

        {chat.length > 0 && (
          <div className="relative mx-auto mt-6 max-w-3xl space-y-2 text-left">
            {chat.slice(-6).map((m, i) => (
              <div key={i} className={`flex ${m.role === "farmer" ? "justify-end" : "justify-start"}`}>
                <div className={`hi max-w-[85%] rounded-2xl px-4 py-2 text-[15px] ${
                  m.role === "farmer" ? "bg-forest-800 text-white" : "border border-forest-100 bg-forest-50 text-slate-900"}`}>
                  {m.role === "agent" ? "🤖 " : ""}{m.text}
                </div>
              </div>
            ))}
            {pending?.tts && <audio autoPlay src={`data:audio/mp3;base64,${pending.tts}`} className="hidden" />}
          </div>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); if (!running && text.trim()) { onAsk(text, null); setText(""); } }}
          className="relative mx-auto mt-8 flex max-w-3xl flex-col gap-2 rounded-2xl border border-forest-100 bg-white p-2 shadow-card sm:flex-row"
        >
          <div className="flex flex-1 items-center gap-2 px-3">
            <MessageCircleQuestion size={20} className="text-forest-700" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={pending ? "अपना जवाब लिखें या बोलें… / Type or speak your answer…" : "कल टमाटर पर दवा छिड़कूं? और कहाँ बेचूं?"}
              className="hi w-full bg-transparent py-3 text-lg outline-none"
            />
          </div>
          <button
            disabled={running}
            className="flex items-center justify-center gap-2 rounded-xl bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-700 disabled:opacity-60"
          >
            Ask KisanSaathi <span className="hi">(पूछें)</span> <ArrowRight size={18} />
          </button>
        </form>

        <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2">
          <span className="label mr-1">Try:</span>
          {EXAMPLES.map(([e, q, en]) => (
            <button
              key={q}
              disabled={running}
              onClick={() => { setText(""); onAsk(q, null, true); }}
              className="hi rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-forest-600"
            >
              {e} {q} <span className="text-forest-700">({en})</span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="label flex items-center gap-1.5"><CloudSun size={14} /> Live weather / <span className="hi">मौसम</span></span>
            <Pill tone="slate">Open-Meteo</Pill>
          </div>
          {cur ? (
            <>
              <div className="mt-3 text-4xl font-bold">{Math.round(cur.temperature_2m)}°C</div>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-sm">
                <div><div className="text-xs text-slate-500">Humidity</div><b>{Math.round(cur.relative_humidity_2m)}%</b></div>
                <div><div className="text-xs text-slate-500">Wind</div><b>{Math.round(cur.wind_speed_10m)} km/h</b></div>
              </div>
            </>
          ) : <Empty />}
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="label flex items-center gap-1.5"><Droplets size={14} /> Soil moisture / <span className="hi">नमी</span></span>
            {irr && <Pill tone={irr.code === "irrigate_now" ? "amber" : "green"}>{irr.code.replace("_", " ")}</Pill>}
          </div>
          {irr ? (
            <>
              <div className="mt-3 text-4xl font-bold">{irr.root_zone_moisture_pct ?? "—"}%<span className="ml-2 text-sm font-normal text-slate-500">root zone</span></div>
              <div className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-700">{irr.decision}</div>
            </>
          ) : <Empty />}
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="label flex items-center gap-1.5"><IndianRupee size={14} /> Best net mandi / <span className="hi">मंडी</span></span>
            <Pill tone="slate">Agmarknet</Pill>
          </div>
          {best ? (
            <>
              <div className="mt-3 text-4xl font-bold">{inr(best.net_price ?? best.modal_price)}<span className="ml-1 text-sm font-normal text-slate-500">/qtl net</span></div>
              <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
                <b>{best.market}</b> · {best.distance_km ?? "—"} km
                {gain ? <span className="ml-2 text-forest-700">+{inr(gain)} vs nearest</span> : null}
              </div>
            </>
          ) : <Empty />}
        </div>
      </section>
    </div>
  );
}

function Empty() {
  return <div className="mt-4 text-sm text-slate-400">Ask a question to load live data for your farm.</div>;
}
