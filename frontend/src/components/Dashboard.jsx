import React, { useState } from "react";
import { Compass, SprayCan, Droplets, Store, ShieldCheck, Network, ArrowRight, CloudSun, Search, AlertTriangle, Activity, Database } from "lucide-react";
import AgentGraph from "./AgentGraph.jsx";
import { graphState } from "./TraceView.jsx";
import { SprayPanel, IrrigationPanel, MandiPanel, SourcesPanel } from "./Panels.jsx";
import { Pill, inr } from "./ui.jsx";

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

  // ---- presentation-only derivations (read existing result fields; no new logic/state)
  const TONE = { ok: "bg-emerald-500", warn: "bg-[#f59e0b]", bad: "bg-[#f43f5e]", na: "bg-slate-700" };
  const irrTone = { no_need: "ok", wait_rain: "ok", irrigate_soon: "warn", irrigate_now: "bad" }[a.irrigation?.code] || "na";
  const signals = [
    ["Spray", a.spray ? (a.spray.windows?.length ? "ok" : "warn") : "na"],
    ["Irrigation", irrTone],
    ["Market", result.ranked?.length ? "ok" : (result.plan?.crop ? "bad" : "na")],
    ["Weather feed", result.current ? "ok" : "bad"],
    ["Guardrail", rejected ? "warn" : guard ? "ok" : "na"],
  ];
  const count = (t) => signals.filter(([, v]) => v === t).length;
  const best = a.market?.best;

  return (
    <div className="space-y-5">
      {result.status === "need_location" && (
        <div className="card flex gap-2 border-amber-500/40 bg-amber-500/10 p-4 text-amber-300"><AlertTriangle size={18} /> Location not found — edit it in the Farm Profile and ask again.</div>
      )}

      {/* Page title row (AgrixAI style) */}
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <div className="text-3xl font-bold tracking-tight text-slate-100">
            {result.place ? result.place.name : "Advisory"} <span className="text-emerald-400">·</span> {result.commodity || result.plan?.crop || "—"}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 font-mono text-xs text-slate-400">
            {result.place && <span className="text-cyan-400">{result.place.lat?.toFixed(4)}°N {result.place.lon?.toFixed(4)}°E</span>}
            {result.place && <span>{[result.place.district, result.place.state].filter(Boolean).join(", ")}</span>}
            <span>{(result.total_ms / 1000).toFixed(2)}s · {steps.length} steps</span>
          </div>
        </div>
        <Pill tone={rejected ? "amber" : "green"}><ShieldCheck size={13} /> {rejected ? "LLM draft replaced by verified template" : "Decision ready · verified"}</Pill>
      </div>

      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        {/* ---------- Column 1: metric tallies + actionable points ---------- */}
        <div className="space-y-5">
          <section className="card p-4">
            <div className="label flex items-center gap-1.5"><Activity size={13} /> Field signal health</div>
            <div className="mt-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-[#0a1310]">
              {signals.map(([name, t]) => (
                <div key={name} title={`${name}: ${t}`} className={`flex-1 transition-all duration-200 ease-in-out ${TONE[t]} ${t === "bad" ? "animate-pulse" : ""}`} />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1 text-center text-[11px]">
              <div><div className="font-mono text-lg text-emerald-400">{count("ok")}</div><div className="text-slate-400">Healthy</div></div>
              <div><div className="font-mono text-lg text-[#f59e0b]">{count("warn")}</div><div className="text-slate-400">Stressed</div></div>
              <div><div className="font-mono text-lg text-[#f43f5e]">{count("bad")}</div><div className="text-slate-400">Critical</div></div>
            </div>
            <div className="mt-3 space-y-1.5 border-t border-emerald-500/10 pt-3 text-xs">
              {signals.map(([name, t]) => (
                <div key={name} className="flex items-center justify-between">
                  <span className="text-slate-400">{name}</span>
                  <span className={`h-2 w-2 rounded-full ${TONE[t]}`} />
                </div>
              ))}
            </div>
          </section>

          <section className="card p-4">
            <div className="label">Live readings</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                ["Temp", result.current ? `${Math.round(result.current.temperature_2m)}°C` : "—"],
                ["Wind", result.current ? `${Math.round(result.current.wind_speed_10m)} km/h` : "—"],
                ["Root moist.", a.irrigation?.root_zone_moisture_pct != null ? `${a.irrigation.root_zone_moisture_pct}%` : "—"],
                ["VPD", result.current?.vapour_pressure_deficit != null ? `${result.current.vapour_pressure_deficit.toFixed(1)} kPa` : "—"],
                ["Rain 3d", a.irrigation ? `${a.irrigation.rain_next_3d_mm} mm` : "—"],
                ["ET₀ 3d", a.irrigation ? `${a.irrigation.et0_next_3d_mm} mm` : "—"],
              ].map(([k, v]) => (
                <div key={k} className="glass-inset px-2.5 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
                  <div className="font-mono text-sm text-cyan-400">{v}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2.5">
            {(adv.actions || []).slice(0, 3).map((act, i) => {
              const Icon = TILE_ICONS[i] || Store;
              return (
                <div key={i} className="card p-3.5 hover:-translate-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><Icon size={16} /></span>
                    <b className={`text-sm ${lang === "hi" ? "hi" : ""}`}>{act.title}</b>
                  </div>
                  <p className={`mt-2 text-xs leading-relaxed text-slate-300 ${lang === "hi" ? "hi" : ""}`}>{act.detail}</p>
                </div>
              );
            })}
          </section>
        </div>

        {/* ---------- Column 2: centerpiece diagnostic viewport ---------- */}
        <section className="card mesh scanline relative overflow-hidden p-5 md:p-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.10),_transparent_65%)]" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><Compass size={20} /></span>
              <div>
                <div className="label">Advisory for {result.place ? `${result.place.name}, ${result.place.district || ""}` : "—"} · {result.commodity || result.plan?.crop}</div>
                <div className="text-xl font-bold">Advisory / <span className="hi">सलाह</span></div>
              </div>
            </div>

            <blockquote className={`mt-5 rounded-2xl border border-emerald-500/25 bg-[#0a1310]/70 p-5 text-xl font-semibold leading-relaxed text-slate-100 shadow-glow md:text-2xl ${lang === "hi" ? "hi" : ""}`}>
              {adv.summary}
            </blockquote>

            {result.tts && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/20 bg-[#09120e]/80 p-3">
                <span className="px-2 text-sm">🔊 {lang === "hi" ? "हिंदी आवाज़" : "Voice"} <span className="font-mono text-xs text-slate-500">· {result.tts_engine}</span></span>
                <audio controls autoPlay src={`data:audio/mp3;base64,${result.tts}`} className="h-10 flex-1" />
              </div>
            )}

            {best && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="glass-inset p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">Best mandi</div><div className="truncate text-sm font-semibold">{best.market}</div></div>
                <div className="glass-inset p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">Price</div><div className="font-mono text-lg text-emerald-400">{inr(best.net_price ?? best.modal_price)}<span className="text-xs text-slate-500">/qtl</span></div></div>
                <div className="glass-inset p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">Distance</div><div className="font-mono text-lg text-cyan-400">{best.distance_km ?? "—"}<span className="text-xs text-slate-500"> km</span></div></div>
              </div>
            )}

            {adv.tip && <div className={`mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300 ${lang === "hi" ? "hi" : ""}`}>💡 {adv.tip}</div>}
            {result.warnings?.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {result.warnings.map((w, i) => <div key={i} className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"><AlertTriangle size={14} className="shrink-0" />{w}</div>)}
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-emerald-500/10 pt-3 text-xs text-slate-400">
              <span className="flex items-center gap-1 text-emerald-400"><ShieldCheck size={14} /> All figures from live sources</span>
              <span>Written by: {adv.by}</span>
              <span className="font-mono text-cyan-400">{(result.total_ms / 1000).toFixed(2)}s</span>
            </div>
          </div>
        </section>

        {/* ---------- Column 3: dense log frame ---------- */}
        <div className="space-y-5">
          <section className="card h-fit p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold"><Network size={16} className="text-emerald-400" /> Agent Trace</span>
              <Pill tone="dark">{(result.total_ms / 1000).toFixed(2)}s</Pill>
            </div>
            <div className="glass-inset mt-3 p-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Pipeline</span><b className="font-mono text-emerald-400">{steps.length} steps</b></div>
              <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-[#0a1310]">
                {steps.map((st, i) => (
                  <div key={i} className={`flex-1 ${st.status === "fail" ? "bg-[#f43f5e]" : st.status === "warn" ? "bg-[#f59e0b]" : "bg-emerald-500"}`} />
                ))}
              </div>
              <div className="mt-2 font-mono text-[11px] text-slate-500">{[...selfCorrect].length ? `${steps.filter((s) => s.node === "self_correct").length} self-correction loop(s)` : "no self-correction needed"}</div>
            </div>
            <div className="mt-3 rounded-xl border border-emerald-500/10 bg-[#070d0b]/60 p-2">
              <AgentGraph visited={visited} selfCorrect={selfCorrect} />
            </div>
            <button onClick={onOpenTrace} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-sm font-semibold text-emerald-300 transition-all duration-200 ease-in-out hover:bg-emerald-500 hover:text-slate-950">
              <Search size={15} /> View detailed trace <ArrowRight size={15} />
            </button>
          </section>

          <section className="card p-4">
            <div className="label flex items-center gap-1.5"><Database size={13} /> Run metadata</div>
            <dl className="mt-3 space-y-1.5 font-mono text-[11px]">
              {[
                ["model", result.model || "template"],
                ["commodity", result.commodity || "—"],
                ["mandis", result.ranked?.length ?? 0],
                ["transport", result.cost_per_qtl_km ? `₹${result.cost_per_qtl_km}/qtl/km` : "not given"],
                ["spray_windows", a.spray?.windows?.length ?? 0],
                ["irrigation", a.irrigation?.code || "—"],
                ["sources", (result.sources || []).length],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-emerald-500/5 pb-1">
                  <dt className="text-slate-500">{k}</dt><dd className="truncate text-cyan-400">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-emerald-500/10 bg-[#09120e]/60 p-2">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out ${tab === id ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:bg-emerald-500/10 hover:text-slate-100"}`}>
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
