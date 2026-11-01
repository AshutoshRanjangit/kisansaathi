import React, { useState } from "react";
import { Compass, SprayCan, Droplets, Store, ShieldCheck, Network, ArrowRight, CloudSun, Search, AlertTriangle } from "lucide-react";
import AgentGraph from "./AgentGraph.jsx";
import { graphState } from "./TraceView.jsx";
import { SprayPanel, IrrigationPanel, MandiPanel, SourcesPanel } from "./Panels.jsx";
import { Pill } from "./ui.jsx";

const TILE_ICONS = [SprayCan, Droplets, Store, CloudSun];

export default function Dashboard({ result, steps, onOpenTrace }) {
  const [tab, setTab] = useState("mandi");
  const adv = result.advisory || {};
  const { visited, selfCorrect } = graphState(steps);
  const guard = steps.find((s) => s.node === "guardrail");
  const rejected = guard?.detail.startsWith("REJECTED");
  const a = result.analysis || {};
  const lang = result.plan?.language;

  const tabs = [
    ["spray", "🌦️ Spray windows"], ["irrigation", "💧 Irrigation & soil"],
    ["mandi", `💰 Mandi ranking${result.ranked?.length ? ` · ${result.ranked.length}` : ""}`], ["sources", "🔍 Sources & facts"],
  ];

  return (
    <div className="space-y-5">
      {result.status === "need_location" && (
        <div className="card flex gap-2 border-amber-300 bg-amber-50 p-4 text-amber-900"><AlertTriangle size={18} /> Location not found — edit it in the Farm Profile and ask again.</div>
      )}
      <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <section className="card p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-forest-50 text-forest-700"><Compass size={20} /></span>
              <div>
                <div className="label">Advisory for {result.place ? `${result.place.name}, ${result.place.district || ""}` : "—"} · {result.commodity || result.plan?.crop}</div>
                <div className="text-xl font-bold">Advisory / <span className="hi">सलाह</span></div>
              </div>
            </div>
            <Pill tone={rejected ? "amber" : "green"}><ShieldCheck size={13} /> {rejected ? "LLM draft replaced by verified template" : "Decision ready · verified"}</Pill>
          </div>

          <blockquote className={`mt-5 rounded-2xl border border-forest-100 bg-forest-50/50 p-5 text-xl font-semibold leading-relaxed text-slate-900 md:text-2xl ${lang === "hi" ? "hi" : ""}`}>
            {adv.summary}
          </blockquote>

          {result.tts && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-forest-950 p-3 text-white">
              <span className="px-2 text-sm">🔊 {lang === "hi" ? "हिंदी आवाज़" : "Voice"} <span className="text-white/60">· {result.tts_engine}</span></span>
              <audio controls autoPlay src={`data:audio/mp3;base64,${result.tts}`} className="h-10 flex-1" />
            </div>
          )}

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {(adv.actions || []).slice(0, 3).map((act, i) => {
              const Icon = TILE_ICONS[i] || Store;
              return (
                <div key={i} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-forest-800 text-white"><Icon size={16} /></span>
                    <b className={lang === "hi" ? "hi" : ""}>{act.title}</b>
                  </div>
                  <p className={`mt-2 text-sm text-slate-700 ${lang === "hi" ? "hi" : ""}`}>{act.detail}</p>
                </div>
              );
            })}
          </div>
          {adv.tip && <div className={`mt-3 rounded-xl bg-wheat-100 px-4 py-2.5 text-sm text-amber-900 ${lang === "hi" ? "hi" : ""}`}>💡 {adv.tip}</div>}
          {result.warnings?.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {result.warnings.map((w, i) => <div key={i} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle size={14} className="shrink-0" />{w}</div>)}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1 text-forest-700"><ShieldCheck size={14} /> All figures from live sources</span>
            <span>Written by: {adv.by}</span>
            <span className="mono">{(result.total_ms / 1000).toFixed(2)}s</span>
          </div>
        </section>

        <section className="card h-fit p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-semibold"><Network size={18} /> Agent Trace</span>
            <Pill tone="dark">{(result.total_ms / 1000).toFixed(2)}s</Pill>
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 p-3 text-sm">
            <div className="flex justify-between"><span>Pipeline</span><b className="text-forest-700">{steps.length} steps complete</b></div>
            <div className="mt-2 h-1.5 rounded-full bg-forest-600" />
            <div className="mono mt-2 text-xs text-slate-500">{[...selfCorrect].length ? `${steps.filter((s) => s.node === "self_correct").length} self-correction loop(s)` : "no self-correction needed"}</div>
          </div>
          <div className="mt-3 rounded-xl bg-slate-50 p-2">
            <AgentGraph visited={visited} selfCorrect={selfCorrect} />
          </div>
          <button onClick={onOpenTrace} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-forest-950 py-2.5 text-sm font-semibold text-white hover:bg-forest-800">
            <Search size={15} /> View detailed trace <ArrowRight size={15} />
          </button>
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="flex gap-1 overflow-x-auto bg-forest-950 px-3 pt-3">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`whitespace-nowrap rounded-t-xl px-4 py-2.5 text-sm font-medium ${tab === id ? "bg-white text-forest-900" : "text-white/75 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="p-5">
          {tab === "spray" && <SprayPanel spray={a.spray} series={result.series} />}
          {tab === "irrigation" && <IrrigationPanel irr={a.irrigation} series={result.series} />}
          {tab === "mandi" && <MandiPanel ranked={result.ranked} market={a.market} place={result.place} cost={result.cost_per_qtl_km} commodity={result.commodity} />}
          {tab === "sources" && <SourcesPanel sources={result.sources || []} trace={result.trace || []} facts={result.facts || {}} />}
        </div>
      </section>
    </div>
  );
}
