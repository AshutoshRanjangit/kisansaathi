import React, { useEffect, useState } from "react";
import { Sprout } from "lucide-react";

const TABS = [
  { id: "ask", en: "1. Ask", hi: "प्रश्न" },
  { id: "trace", en: "2. Live Trace", hi: "एजेंट ट्रेस" },
  { id: "dashboard", en: "3. Advisory Dashboard", hi: "सलाह डैशबोर्ड" },
];

function Dot({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
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
    <header className="z-[1000] bg-forest-950 text-white md:sticky md:top-0">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-forest-700">
            <Sprout size={22} />
          </span>
          <div>
            <div className="text-lg font-bold leading-none">
              KisanSaathi <span className="hi text-sm font-medium text-forest-100">किसानसाथी</span>
            </div>
            <div className="mt-1 text-xs text-forest-100/80">Live weather · soil · mandi prices — every number verified</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-3 rounded-full border border-white/15 bg-white/5 px-3 py-1.5">
            <Dot ok label="Weather" />
            <Dot ok label="Soil" />
            <Dot ok={health?.data_gov} label="Mandi" />
            <Dot ok={health?.gemini} label="Gemini" />
            <span className="mono rounded-md bg-white/10 px-1.5 py-0.5">{clock} IST</span>
          </div>
          <div className="flex items-center rounded-full border border-white/15 bg-white/5 p-0.5"
            title="Language of the advisory & voice reply. Auto = reply in the language you ask in.">
            <span className="px-2 text-white/60">Reply in</span>
            {[["auto", "Auto"], ["hi", "हिंदी"], ["en", "English"]].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setLang(id)}
                className={`rounded-full px-3 py-1 font-medium transition ${lang === id ? "bg-emerald-400 text-forest-950" : "text-white/80 hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <nav className="border-t border-white/10 bg-forest-900">
        <div className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-4 md:px-8">
          {TABS.map((t) => {
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={`my-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${
                  view === t.id ? "bg-emerald-500 text-forest-950" : "text-white/80 hover:bg-white/10"
                }`}
              >
                {t.en} / <span className="hi">{t.hi}</span>
                {t.id === "trace" && running && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-300" />}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
