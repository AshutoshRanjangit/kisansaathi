import React from "react";
import { Terminal, Network, Mic, Zap, Cpu, ShieldCheck, Loader2, ArrowRight } from "lucide-react";
import AgentGraph from "./AgentGraph.jsx";
import { NODE_META, StatusIcon, Pill, SectionTitle, graphNodeFor } from "./ui.jsx";

export function graphState(steps) {
  const visited = new Set();
  const selfCorrect = new Set();
  steps.forEach((s) => {
    const g = graphNodeFor(s);
    visited.add(g);
    if (s.node === "self_correct") selfCorrect.add(g);
  });
  return { visited: [...visited], selfCorrect };
}

export default function TraceView({ steps, running, result, error, onOpenDashboard }) {
  const { visited, selfCorrect } = graphState(steps);
  const totalMs = result?.total_ms ?? steps.reduce((n, s) => n + (s.ms || 0), 0);
  const corrections = steps.filter((s) => s.node === "self_correct").length;
  const guard = steps.find((s) => s.node === "guardrail");
  const heard = result?.plan?.transcript;
  const visible = steps.filter((s) => s.node !== "fetch_weather" && s.node !== "fetch_mandi");
  const subSteps = steps.filter((s) => s.node === "fetch_weather" || s.node === "fetch_mandi");
  const ranked = steps.filter((s) => s.node === "rank_markets").slice(-1)[0];

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center gap-3 px-5 py-3">
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-sm">
          <Mic size={16} className="text-red-500" />
          <span className="text-slate-500">Heard:</span>
          <b className="hi truncate">{heard ? `“${heard}”` : running ? "…" : "—"}</b>
        </span>
        <Pill tone={running ? "dark" : "green"}>
          {running ? <><Loader2 size={12} className="animate-spin" /> Running agent graph…</> : "● Complete"}
        </Pill>
        <Pill tone="amber"><Zap size={12} /> {(totalMs / 1000).toFixed(2)}s total</Pill>
        <Pill tone="slate"><Cpu size={12} /> {result?.model || "Gemini"}</Pill>
      </div>

      {error && <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <section className="card p-5">
          <SectionTitle
            icon={Terminal}
            en="Agent Reasoning Trace"
            hi="एजेंट निष्पादन क्रम · हर कदम लाइव"
            right={<Pill tone="green">{steps.length} steps</Pill>}
          />
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat k="Steps run" v={steps.length} />
            <Stat k="Mandis ranked" v={ranked ? ranked.detail.split(" ")[0] : "—"} sub={ranked?.detail.match(/within (.+?),/)?.[1]} />
            <Stat k="Self-corrections" v={corrections} tone={corrections ? "amber" : undefined} />
            <Stat k="Guardrail" v={guard ? (guard.detail.startsWith("REJECTED") ? "Replaced" : "Passed") : "—"} tone={guard?.detail.startsWith("REJECTED") ? "amber" : undefined} />
          </div>

          <ol className="relative mt-5 space-y-3 before:absolute before:left-[13px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-forest-100">
            {visible.map((s, i) => {
              const meta = NODE_META[s.node] || { en: s.node, tag: "" };
              const sc = s.node === "self_correct";
              return (
                <li key={i} className="fade-up relative flex gap-3">
                  <span className="relative z-10 mt-2.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white ring-4 ring-paper">
                    <StatusIcon status={s.status} selfCorrect={sc} size={20} />
                  </span>
                  <div className={`flex-1 rounded-xl border p-3 ${sc ? "border-amber-300 bg-amber-50" : s.node === "guardrail" ? "border-forest-600/40 bg-forest-50" : "border-slate-200 bg-white"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <b className={sc ? "text-amber-800" : "text-slate-900"}>{meta.en}</b>
                      {meta.tag && <span className={`mono rounded px-1.5 py-0.5 text-[10px] ${sc ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-500"}`}>{meta.tag}</span>}
                      <span className="mono ml-auto rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-500">{s.ms} ms</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{s.detail}</div>
                    {s.node === "fetch_parallel" && subSteps.length > 0 && (
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        {subSteps.map((x, j) => (
                          <div key={j} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                            <div className="mono flex items-center gap-1.5 font-medium text-slate-700">
                              <StatusIcon status={x.status} size={13} /> {NODE_META[x.node].en}
                              <span className="ml-auto text-slate-400">{x.ms} ms</span>
                            </div>
                            <div className="mt-1 text-slate-600">{x.detail}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
            {running && (
              <li className="relative flex gap-3">
                <span className="relative z-10 mt-1 grid h-7 w-7 place-items-center rounded-full bg-white ring-4 ring-paper">
                  <Loader2 size={18} className="animate-spin text-forest-600" />
                </span>
                <div className="flex-1 rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-400">Working…</div>
              </li>
            )}
          </ol>
          {result && (
            <button onClick={onOpenDashboard} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-forest-800 py-3 font-semibold text-white hover:bg-forest-700">
              View verified advisory <ArrowRight size={18} />
            </button>
          )}
        </section>

        <section className="card h-fit p-5 lg:sticky lg:top-[132px]">
          <SectionTitle icon={Network} en="Agent Execution Graph" hi="LangGraph · इस प्रश्न का वास्तविक मार्ग" />
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <AgentGraph visited={visited} selfCorrect={selfCorrect} active={running ? graphNodeFor(steps[steps.length - 1] || { node: "planner", detail: "" }) : null} />
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
            <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-forest-800" /> Executed ({visited.length})</span>
            <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-amber-500" /> Self-correction ({selfCorrect.size})</span>
            <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-slate-300 bg-slate-100" /> Not needed</span>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-forest-100 bg-forest-50/60 p-3 text-xs text-forest-800">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            The LLM only plans and writes text with placeholders. Every number is computed in Python from live API responses and verified before display.
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ k, v, sub, tone }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200"}`}>
      <div className="label text-[10px]">{k}</div>
      <div className={`mt-1 text-xl font-bold ${tone === "amber" ? "text-amber-700" : "text-slate-900"}`}>{v}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
