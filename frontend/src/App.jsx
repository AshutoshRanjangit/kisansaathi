import React, { useEffect, useState } from "react";
import Header from "./components/Header.jsx";
import Sidebar from "./components/Sidebar.jsx";
import AskView from "./components/AskView.jsx";
import TraceView from "./components/TraceView.jsx";
import Dashboard from "./components/Dashboard.jsx";
import { askAgent, getHealth, reverseGeocode } from "./api.js";

function EmptyState({ what, hi, onAsk }) {
  return (
    <div className="card grid min-h-[420px] place-items-center p-10 text-center">
      <div>
        <div className="text-5xl">🌾</div>
        <div className="mt-4 text-xl font-bold text-slate-100">No question asked yet</div>
        <div className="hi mt-1 text-slate-400">अभी तक कोई प्रश्न नहीं पूछा गया</div>
        <p className="mx-auto mt-3 max-w-md text-sm text-slate-300">
          The {what} (<span className="hi">{hi}</span>) fills in live as soon as you ask KisanSaathi a question.
        </p>
        <button onClick={onAsk} className="mt-6 rounded-xl bg-forest-800 px-6 py-3 font-semibold text-slate-950 hover:bg-forest-700">
          Ask a question / <span className="hi">प्रश्न पूछें</span>
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [view, setView] = useState("ask");
  const [lang, setLang] = useState("auto");
  const [profile, setProfile] = useState({ location: "", coords: null, speak: true });
  // Conversation memory: what the agent has learned from the farmer, and its last question
  const [known, setKnown] = useState({});
  const [asked, setAsked] = useState(null);
  const [chat, setChat] = useState([]);
  const [pending, setPending] = useState(null);
  function resetChat() { setKnown({}); setAsked(null); setChat([]); setPending(null); }
  const [geo, setGeo] = useState({ status: "idle" });
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getHealth().then(setHealth).catch(() => setHealth({})); }, []);

  // Live location: ask the device for GPS, then name the place via reverse geocoding (no hard-coded default).
  function locateMe() {
    if (!navigator.geolocation) { setGeo({ status: "unsupported" }); return; }
    setGeo({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        setProfile((p) => ({ ...p, coords: { lat, lon, accuracy } }));
        setGeo({ status: "ok" });
        try {
          const r = await reverseGeocode(lat, lon);
          if (r.ok) {
            const label = [r.place.name, r.place.district].filter(Boolean).join(", ");
            setProfile((p) => (p.coords && p.coords.lat === lat ? { ...p, location: label } : p));
          }
        } catch { /* name is cosmetic; coordinates are what the agent uses */ }
      },
      (err) => setGeo({ status: err.code === 1 ? "denied" : "error", message: err.message }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 },
    );
  }
  useEffect(() => { locateMe(); }, []);

  async function onAsk(query, audioBlob, fresh = false) {
    if (running) return;
    const k = fresh ? {} : known, a = fresh ? null : asked, h = fresh ? [] : chat;
    if (fresh) resetChat();
    setRunning(true);
    setError("");
    setSteps([]);
    setView("ask"); // the whole query stays on one conversation screen
    // show the farmer's turn immediately (voice transcript replaces the placeholder when it arrives)
    setChat([...h, { role: "farmer", text: query || "🎙️ …", voice: !!audioBlob }]);
    try {
      await askAgent(
        { query: query || "", location: profile.coords ? "" : profile.location, lat: profile.coords?.lat, lon: profile.coords?.lon,
          history: JSON.stringify(h), known: JSON.stringify(k), asked: a || "", lang, speak: profile.speak },
        audioBlob,
        (ev) => {
          if (ev.type === "step") setSteps((s) => [...s, ev.step]);
          if (ev.type === "result") {
            const r = ev.result;
            const said = query || r.plan?.transcript || "🎙️";
            const isQuestion = r.status === "need_info";
            setChat([...h, { role: "farmer", text: said, voice: !!audioBlob },
              { role: "agent", text: r.advisory?.summary || "", kind: isQuestion ? "question" : "answer",
                tts: r.tts || null, result: isQuestion ? null : r }]);
            setKnown(r.slots || {});
            setAsked(r.asked || null);
            if (isQuestion) {
              setPending(r);
            } else {
              setPending(null);
              setResult(r);
            }
          }
          if (ev.type === "error") setError(`Agent error: ${ev.error}`);
        },
      );
    } catch (e) {
      setError(`Could not reach the KisanSaathi server: ${e.message}`);
    }
    setRunning(false);
  }

  return (
    <div className="min-h-screen bg-[#070d0b] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#0d221a] via-[#070d0b] to-[#040605] text-slate-100">
      <Header view={view} setView={setView} health={health} lang={lang} setLang={setLang} hasResult={!!result} running={running} />
      <main className="mx-auto grid max-w-[1440px] gap-6 px-4 py-6 md:px-8 lg:grid-cols-[320px_1fr]">
        <Sidebar profile={profile} setProfile={setProfile} place={result?.place} geo={geo} onLocate={locateMe} known={known} onReset={resetChat} />
        <div className="order-1 min-w-0 lg:order-2">
          {view === "ask" && <AskView onAsk={onAsk} running={running} result={result} chat={chat} pending={pending} steps={steps} error={error}
            onReset={resetChat} onOpenDashboard={() => setView("dashboard")} onOpenTrace={() => setView("trace")} />}
          {view === "trace" && (steps.length || running || error
            ? <TraceView steps={steps} running={running} result={running ? null : result} error={error} onOpenDashboard={() => setView("dashboard")} />
            : <EmptyState what="agent trace" hi="एजेंट ट्रेस" onAsk={() => setView("ask")} />)}
          {view === "dashboard" && (result
            ? <Dashboard result={result} steps={result.trace || steps} onOpenTrace={() => setView("trace")} />
            : <EmptyState what="advisory dashboard" hi="सलाह डैशबोर्ड" onAsk={() => setView("ask")} />)}
        </div>
      </main>
      <footer className="mt-8 border-t border-emerald-950/40 bg-[#09120e]/60 px-4 py-4 text-center font-mono text-[11px] text-slate-500 backdrop-blur-md md:px-8">
        KisanSaathi · Live data: Agmarknet (data.gov.in) · Open-Meteo (weather, soil moisture, ET₀, VPD) · Built for Forge Gen-AI Buildathon
      </footer>
    </div>
  );
}
