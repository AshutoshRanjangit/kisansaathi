import React from "react";

// Mirrors agent/graph.py exactly (same nodes + edges).
const W = 340;
const NODES = {
  planner: { x: 120, y: 24, label: "Planner · Gemini" },
  check_slots: { x: 120, y: 74, label: "Know crop/place/cost?" },
  ask_farmer: { x: 270, y: 74, label: "Ask farmer", side: true },
  locate: { x: 120, y: 124, label: "Geocode farmer" },
  fetch_data: { x: 120, y: 174, label: "Parallel fetch ∥" },
  resolve_commodity: { x: 120, y: 224, label: "Verify commodity" },
  expand_states: { x: 270, y: 224, label: "Neighbour states", side: true },
  geocode_mandis: { x: 120, y: 274, label: "Geocode mandis" },
  rank_markets: { x: 120, y: 324, label: "Rank net price" },
  widen_radius: { x: 270, y: 324, label: "Widen radius", side: true },
  engine: { x: 120, y: 374, label: "Deterministic engine" },
  synthesize: { x: 120, y: 424, label: "Synthesizer · Gemini" },
  guardrail: { x: 120, y: 474, label: "Guardrail verifier" },
};
const EDGES = [
  ["planner", "check_slots"], ["check_slots", "locate"], ["check_slots", "ask_farmer", "loop"], ["locate", "fetch_data"], ["fetch_data", "resolve_commodity"],
  ["resolve_commodity", "geocode_mandis"], ["geocode_mandis", "rank_markets"], ["rank_markets", "engine"],
  ["engine", "synthesize"], ["synthesize", "guardrail"],
  ["resolve_commodity", "expand_states", "loop"], ["rank_markets", "widen_radius", "loop"],
  ["locate", "synthesize", "skipL"], ["resolve_commodity", "engine", "skipL2"],
];
const NW = 150, SW = 120, NH = 32;

export default function AgentGraph({ visited, selfCorrect, active }) {
  const seen = new Set(visited);
  const color = (k) => {
    if (active === k) return { fill: "#fde68a", stroke: "#b45309", text: "#78350f" };
    if (selfCorrect.has(k)) return { fill: "#f59e0b", stroke: "#b45309", text: "#1f2937" };
    if (seen.has(k)) return { fill: "#14532d", stroke: "#14532d", text: "#ffffff" };
    return { fill: "#f3f4f6", stroke: "#d1d5db", text: "#6b7280" };
  };
  const hot = (a, b) => seen.has(a) && seen.has(b);

  return (
    <svg viewBox={`0 0 ${W + 20} 500`} className="w-full">
      <defs>
        {["g", "a", "s"].map((id) => (
          <marker key={id} id={`arrow-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={id === "g" ? "#16a34a" : id === "a" ? "#d97706" : "#cbd5e1"} />
          </marker>
        ))}
      </defs>
      {EDGES.map(([a, b, kind]) => {
        const A = NODES[a], B = NODES[b];
        // conditional skip edges are "taken" only when the normal path was not
        const isHot = kind === "skipL" ? hot(a, b) && !seen.has("fetch_data")
          : kind === "skipL2" ? hot(a, b) && !seen.has("geocode_mandis")
          : hot(a, b);
        const loopHot = kind === "loop" && selfCorrect.has(b);
        const stroke = loopHot ? "#d97706" : isHot ? "#16a34a" : "#cbd5e1";
        const marker = loopHot ? "a" : isHot ? "g" : "s";
        const sw = isHot || loopHot ? 2 : 1.2;
        let d;
        if (kind === "loop") {
          const y1 = A.y - 6, y2 = A.y + 6;
          return (
            <g key={a + b}>
              <path d={`M${A.x + NW / 2},${y1} L${B.x - SW / 2},${y1}`} stroke={stroke} strokeWidth={sw} fill="none" markerEnd={`url(#arrow-${marker})`} />
              <path d={`M${B.x - SW / 2},${y2} L${A.x + NW / 2},${y2}`} stroke={stroke} strokeWidth={sw} fill="none" strokeDasharray="4 3" markerEnd={`url(#arrow-${marker})`} />
            </g>
          );
        }
        if (kind === "skipL") d = `M${A.x - NW / 2},${A.y} C${A.x - NW / 2 - 40},${A.y} ${B.x - NW / 2 - 40},${B.y} ${B.x - NW / 2},${B.y}`;
        else if (kind === "skipL2") d = `M${A.x - NW / 2},${A.y + 4} C${A.x - NW / 2 - 22},${A.y + 4} ${B.x - NW / 2 - 22},${B.y - 4} ${B.x - NW / 2},${B.y - 4}`;
        else d = `M${A.x},${A.y + NH / 2} L${B.x},${B.y - NH / 2}`;
        return <path key={a + b} d={d} stroke={stroke} strokeWidth={sw} fill="none" strokeDasharray={kind ? "4 3" : undefined} markerEnd={`url(#arrow-${marker})`} />;
      })}
      {Object.entries(NODES).map(([k, n]) => {
        const c = color(k);
        const w = n.side ? SW : NW;
        return (
          <g key={k}>
            <rect x={n.x - w / 2} y={n.y - NH / 2} width={w} height={NH} rx="9" fill={c.fill} stroke={c.stroke} strokeWidth="1.5" />
            <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="11.5" fontWeight="600" fill={c.text} fontFamily="Inter, sans-serif">
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
