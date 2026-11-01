import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";

export const NODE_META = {
  planner: { en: "Planner (Gemini)", hi: "योजना", tag: "INTENT_PARSE" },
  check_slots: { en: "Check what's known", hi: "जानकारी जाँच", tag: "SLOT_CHECK" },
  ask_farmer: { en: "Ask the farmer", hi: "किसान से प्रश्न", tag: "CLARIFY" },
  locate: { en: "Geocode farmer", hi: "स्थान", tag: "GEO_RESOLVE" },
  fetch_parallel: { en: "Parallel fetch", hi: "समानांतर डेटा", tag: "ASYNC_JOIN" },
  fetch_weather: { en: "Weather + soil feed", hi: "मौसम व मिट्टी", tag: "OPEN_METEO" },
  fetch_mandi: { en: "Mandi price feed", hi: "मंडी भाव", tag: "AGMARKNET" },
  verify_commodity: { en: "Verify commodity", hi: "फसल मिलान", tag: "FUZZY_MATCH" },
  self_correct: { en: "Self-correction", hi: "स्व-सुधार", tag: "AUTONOMOUS_FALLBACK" },
  geocode_mandis: { en: "Geocode mandis", hi: "मंडी स्थान", tag: "GEO_PARALLEL" },
  rank_markets: { en: "Rank by net price", hi: "शुद्ध भाव", tag: "NET_PRICE" },
  engine: { en: "Deterministic engine", hi: "गणना इंजन", tag: "VPD · ET₀ · ₹" },
  synthesize: { en: "Synthesizer (Gemini)", hi: "सलाह लेखन", tag: "PLACEHOLDER_GEN" },
  guardrail: { en: "Guardrail verifier", hi: "सत्यापन", tag: "ZERO_HALLUCINATION" },
};

export function graphNodeFor(step) {
  if (step.node.startsWith("fetch_")) return "fetch_data";
  if (step.node === "verify_commodity") return "resolve_commodity";
  if (step.node === "self_correct") return step.detail.includes("neighbouring") ? "expand_states" : "widen_radius";
  return step.node;
}

export function StatusIcon({ status, selfCorrect, size = 18 }) {
  if (selfCorrect) return <RefreshCw size={size} className="text-amber-600" />;
  if (status === "fail") return <XCircle size={size} className="text-red-600" />;
  if (status === "warn") return <AlertTriangle size={size} className="text-amber-500" />;
  return <CheckCircle2 size={size} className="text-forest-600" />;
}

export function Pill({ children, tone = "green", className = "" }) {
  const tones = {
    green: "bg-forest-50 text-forest-700 border-forest-100",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
    dark: "bg-forest-900 text-forest-50 border-forest-900",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function SectionTitle({ icon: Icon, en, hi, right }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-forest-50 text-forest-700">
            <Icon size={18} />
          </span>
        )}
        <div>
          <div className="font-semibold text-slate-900 leading-tight">{en}</div>
          {hi && <div className="hi text-xs text-slate-500">{hi}</div>}
        </div>
      </div>
      {right}
    </div>
  );
}

export const fmtTime = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("en-IN", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
};

export const inr = (n) => (n === null || n === undefined || n === "—" ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);
