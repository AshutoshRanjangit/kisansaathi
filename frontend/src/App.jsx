import React, { useEffect, useState } from "react";
import Header from "./components/Header.jsx";
import Sidebar from "./components/Sidebar.jsx";
import AskView from "./components/AskView.jsx";
import TraceView from "./components/TraceView.jsx";
import Dashboard from "./components/Dashboard.jsx";
import { askAgent, getHealth } from "./api.js";

function EmptyState({ what, hi, onAsk }) {
  return (
    <div className="card grid min-h-[420px] place-items-center p-10 text-center">
      <div>
        <div className="text-5xl">🌾</div>
        <div className="mt-4 text-xl font-bold text-slate-900">No question asked yet</div>
        <div className="hi mt-1 text-slate-500">अभी तक कोई प्रश्न नहीं पूछा गया</div>
        <p className="mx-auto mt-3 max-w-md text-sm text-slate-600">
          The {what} (<span className="hi">{hi}</span>) fills in live as soon as you ask KisanSaathi a question.
        </p>
        <button onClick={onAsk} className="mt-6 rounded-xl bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-forest-700">
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
  const [profile, setProfile] = useState({ location: "Ganaur, Sonipat", crop: "Tomato", cost: 0.5, speak: true });
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getHealth().then(setHealth).catch(() => setHealth({})); }, []);

  async function onAsk(query, audioBlob) {
    if (running) return;
    setRunning(true);
    setError("");
    setSteps([]);
    setView("trace");
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      await askAgent(
        { query: query || "", location: profile.location, crop: profile.crop, lang, cost: profile.cost, speak: profile.speak },
        audioBlob,
        (ev) => {
          if (ev.type === "step") setSteps((s) => [...s, ev.step]);
          if (ev.type === "result") {
            setResult(ev.result);
            setTimeout(() => setView("dashboard"), 900);
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
    <div className="min-h-screen bg-paper">
      <Header view={view} setView={setView} health={health} lang={lang} setLang={setLang} hasResult={!!result} running={running} />
      <main className="mx-auto grid max-w-[1440px] gap-6 px-4 py-6 md:px-8 lg:grid-cols-[320px_1fr]">
        <Sidebar profile={profile} setProfile={setProfile} place={result?.place} />
        <div className="order-1 min-w-0 lg:order-2">
          {view === "ask" && <AskView onAsk={onAsk} running={running} result={result} />}
          {view === "trace" && (steps.length || running || error
            ? <TraceView steps={steps} running={running} result={running ? null : result} error={error} onOpenDashboard={() => setView("dashboard")} />
            : <EmptyState what="agent trace" hi="एजेंट ट्रेस" onAsk={() => setView("ask")} />)}
          {view === "dashboard" && (result
            ? <Dashboard result={result} steps={result.trace || steps} onOpenTrace={() => setView("trace")} />
            : <EmptyState what="advisory dashboard" hi="सलाह डैशबोर्ड" onAsk={() => setView("ask")} />)}
        </div>
      </main>
      <footer className="mt-8 bg-forest-950 px-4 py-4 text-center text-xs text-forest-100/80 md:px-8">
        KisanSaathi · Live data: Agmarknet (data.gov.in) · Open-Meteo (weather, soil moisture, ET₀, VPD) · Built for Forge Gen-AI Buildathon
      </footer>
    </div>
  );
}
