import React, { useEffect, useState } from "react";
import { Sprout } from "lucide-react";

const TABS = [
  { id: "home", en: "Home", hi: "होम" },
  { id: "ask", en: "Ask", hi: "पूछें" },
  { id: "trace", en: "Live Trace", hi: "ट्रेस" },
  { id: "dashboard", en: "Dashboard", hi: "डैशबोर्ड" },
];

function Dot({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "animate-pulse bg-[#f43f5e] shadow-[0_0_8px_#f43f5e]"}`} />
      {label}
    </span>
  );
}

export default function Header({ view, setView, health, lang, setLang, hasResult, running }) {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-[1000] border-b border-emerald-950/40 bg-[#09120e]/60 text-slate-100 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-glow">
            <Sprout size={22} />
          </span>
          <div>
            <div className="text-lg font-bold leading-none tracking-tight">
              Kisan<span className="text-emerald-400">Saathi</span> <span className="hi text-sm font-medium text-slate-400">किसानसाथी</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">Live weather · soil · mandi prices — every number verified</div>
          </div>
        </div>

        <nav className="order-3 flex w-full gap-1 overflow-x-auto rounded-full border border-emerald-500/15 bg-[#0a1310]/70 p-1 lg:order-none lg:w-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={`flex items-center whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out ${
                view === t.id ? "bg-emerald-500 text-slate-950 shadow-glow" : "text-slate-400 hover:bg-emerald-500/10 hover:text-slate-100"
              }`}
            >
              {t.en} <span className="hi ml-1 opacity-70">/ {t.hi}</span>
              {t.id === "trace" && running && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#f59e0b]" />}
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-3 rounded-full border border-emerald-500/15 bg-[#0a1310]/70 px-3 py-1.5">
            <Dot ok label="Weather" />
            <Dot ok label="Soil" />
            <Dot ok={health?.data_gov} label="Mandi" />
            <Dot ok={health?.gemini} label="Gemini" />
            <span className="font-mono rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-cyan-400">{clock} IST</span>
          </div>
          <div className="flex items-center rounded-full border border-emerald-500/15 bg-[#0a1310]/70 p-0.5"
            title="Language of the advisory & voice reply. Auto = reply in the language you ask in.">
            <span className="px-2 text-slate-500">Reply</span>
            {[["auto", "Auto"], ["hi", "हिंदी"], ["en", "English"]].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setLang(id)}
                className={`rounded-full px-3 py-1 font-medium transition-all duration-200 ease-in-out ${lang === id ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-slate-100"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
