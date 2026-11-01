import React from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { Lightbulb, Info, Database, CheckCircle2 } from "lucide-react";
import MandiMap from "./MandiMap.jsx";
import { Pill, fmtTime, inr } from "./ui.jsx";

const hourLabel = (t) => {
  const d = new Date(t);
  return d.getHours() === 0 ? d.toLocaleDateString("en-IN", { weekday: "short" }) : `${String(d.getHours()).padStart(2, "0")}h`;
};

const CELL = {
  ok: ["bg-forest-600", "Safe to spray"],
  night: ["bg-slate-200", "Night"],
  "rain chance": ["bg-blue-400", "Rain chance"],
  "rain soon after": ["bg-blue-300", "Rain soon after"],
  wind: ["bg-amber-400", "Wind > 15 km/h"],
  temperature: ["bg-orange-400", "Temp out of range"],
  "evaporation (VPD)": ["bg-yellow-300", "High evaporation (VPD)"],
};

export function SprayPanel({ spray, series }) {
  if (!spray) return <NoData />;
  const tl = spray.timeline || [];
  const chart = series ? series.time.slice(0, 48).map((t, i) => ({
    t: hourLabel(t), rain: series.precipitation_probability[i], wind: series.wind_speed_10m[i],
    vpd: series.vapour_pressure_deficit[i],
  })) : [];
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <b>48-hour spray timeline</b>
          {spray.windows[0] ? <Pill>Safe: {fmtTime(spray.windows[0].start)} → {spray.windows[0].end.slice(-5)}</Pill> : <Pill tone="amber">No safe window</Pill>}
        </div>
        <div className="flex gap-[2px] overflow-x-auto rounded-xl border border-slate-200 p-2">
          {tl.map((h, i) => {
            const key = h.ok ? "ok" : h.reason;
            const [cls, label] = CELL[key] || ["bg-slate-300", h.reason];
            return (
              <div key={i} className="flex min-w-[14px] flex-1 flex-col items-center gap-1" title={`${fmtTime(h.time)} · ${label} · rain ${h.rain_pct}% · wind ${h.wind_kmh} km/h`}>
                <div className={`h-9 w-full rounded-[4px] ${cls}`} />
                <span className="text-[9px] text-slate-400">{i % 6 === 0 ? hourLabel(h.time) : ""}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
          {Object.entries(CELL).map(([k, [cls, label]]) => (
            <span key={k} className="flex items-center gap-1.5"><i className={`h-3 w-3 rounded ${cls}`} />{label}</span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {spray.windows.length ? spray.windows.slice(0, 3).map((w, i) => (
          <div key={i} className={`rounded-xl border p-3 ${i === 0 ? "border-forest-600 bg-forest-50" : "border-slate-200"}`}>
            <div className="label">{i === 0 ? "Best window" : `Window ${i + 1}`}</div>
            <div className="mt-1 text-lg font-bold">{fmtTime(w.start)} – {w.end.slice(-5)}</div>
            <div className="mt-1 text-xs text-slate-600">Wind {w.avg_wind_kmh} km/h · {w.avg_temp_c}°C · VPD {w.avg_vpd_kpa} kPa · rain ≤ {w.max_rain_prob_pct}%</div>
          </div>
        )) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 md:col-span-3">
            No safe window in the next {spray.horizon_h} h — blocked by: {spray.blockers.join(", ")}
          </div>
        )}
      </div>
      {spray.next_rain && (
        <div className="text-sm text-slate-600">🌧️ Next rain: <b>{fmtTime(spray.next_rain.time)}</b> · {spray.next_rain.probability_pct}% · {spray.next_rain.mm} mm</div>
      )}

      {chart.length > 0 && (
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={chart} margin={{ left: -18, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2ef" />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} interval={5} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="rain" name="Rain chance %" stroke="#3b82f6" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="wind" name="Wind km/h" stroke="#f59e0b" dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <Rules text={`Rules: daylight · rain ≤ ${spray.rules.max_rain_probability_pct}% · wind ≤ ${spray.rules.max_wind_kmh} km/h · ${spray.rules.min_temp_c}–${spray.rules.max_temp_c}°C · VPD ${spray.rules.vpd_range_kpa.join("–")} kPa · no rain for ${spray.rules.rain_free_hours_after} h after · VPD & rain from Open-Meteo`} />
    </div>
  );
}

function Gauge({ pct, bands }) {
  const max = 50;
  const v = Math.max(0, Math.min(max, pct ?? 0));
  const ang = (x) => Math.PI * (1 - x / max);
  const pt = (x, r) => [100 + r * Math.cos(ang(x)), 100 - r * Math.sin(ang(x))];
  const arc = (a, b, color) => {
    const [x1, y1] = pt(a, 80), [x2, y2] = pt(b, 80);
    return <path d={`M${x1},${y1} A80,80 0 0 1 ${x2},${y2}`} stroke={color} strokeWidth="16" fill="none" />;
  };
  const dry = bands.dry_below * 100, wet = bands.moist_above * 100;
  const [nx, ny] = pt(v, 62);
  return (
    <svg viewBox="0 0 200 118" className="w-full max-w-[240px]">
      {arc(0, dry, "#fca5a5")}{arc(dry, wet, "#86efac")}{arc(wet, max, "#93c5fd")}
      <line x1="100" y1="100" x2={nx} y2={ny} stroke="#14532d" strokeWidth="4" strokeLinecap="round" />
      <circle cx="100" cy="100" r="6" fill="#14532d" />
      <text x="100" y="92" textAnchor="middle" fontSize="0" />
      <text x="20" y="116" fontSize="9" fill="#64748b">dry</text>
      <text x="164" y="116" fontSize="9" fill="#64748b">wet</text>
    </svg>
  );
}

export function IrrigationPanel({ irr, series }) {
  if (!irr) return <NoData />;
  const chart = series ? series.time.map((t, i) => ({
    t: hourLabel(t),
    surface: pctOrNull(series.soil_moisture_0_to_1cm[i]),
    shallow: pctOrNull(series.soil_moisture_3_to_9cm[i]),
    root: pctOrNull(series.soil_moisture_9_to_27cm[i]),
  })) : [];
  const tone = irr.code === "irrigate_now" ? "amber" : irr.code === "irrigate_soon" ? "amber" : "green";
  return (
    <div className="space-y-5">
      <div className={`rounded-xl border p-4 text-lg font-semibold ${tone === "amber" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-forest-600/40 bg-forest-50 text-forest-900"}`}>
        💧 {irr.decision}
      </div>
      <div className="grid items-center gap-4 md:grid-cols-[260px_1fr]">
        <div className="flex flex-col items-center rounded-xl border border-slate-200 p-3">
          <Gauge pct={irr.root_zone_moisture_pct} bands={irr.bands} />
          <div className="-mt-2 text-3xl font-bold">{irr.root_zone_moisture_pct ?? "—"}%</div>
          <div className="text-xs text-slate-500">Root-zone moisture (3–27 cm, vol.)</div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi k="Rain next 3 days" v={`${irr.rain_next_3d_mm} mm`} />
          <Kpi k="Crop demand ET₀ (3 d)" v={`${irr.et0_next_3d_mm} mm`} />
          <Kpi k="Water balance" v={`${irr.water_balance_3d_mm} mm`} tone={irr.water_balance_3d_mm < 0 ? "red" : "green"} />
          <Kpi k="Surface soil temp" v={irr.soil_temp_c != null ? `${irr.soil_temp_c}°C` : "—"} />
        </div>
      </div>
      {chart.length > 0 && (
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={chart} margin={{ left: -18, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2ef" />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} interval={7} />
              <YAxis tick={{ fontSize: 10 }} unit="%" />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="surface" name="0–1 cm" stroke="#f59e0b" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="shallow" name="3–9 cm" stroke="#16a34a" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="root" name="9–27 cm" stroke="#1d4ed8" dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <Rules text="Soil moisture is model-derived (Open-Meteo). ET₀ = FAO-56 Penman-Monteith. Decision rules: hold if 3-day rain ≥ 80% of ET₀; irrigate now if root zone < 17%; irrigate soon if < 27% and balance < −8 mm." />
    </div>
  );
}

export function MandiPanel({ ranked, market, place, cost, commodity }) {
  if (!ranked?.length) return <NoData text="No mandi has reported this crop today in your state or neighbouring states." />;
  const gain = market?.extra_gain_per_qtl;
  const best = market?.best;
  return (
    <div className="space-y-4">
      {best && (
        <div className="flex items-start gap-3 rounded-xl border border-forest-100 bg-forest-50/60 p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-forest-800 text-white"><Lightbulb size={18} /></span>
          <div>
            <div className="font-semibold text-slate-900">
              {gain ? <>Extra <span className="text-forest-700">{inr(gain)}/qtl</span> vs your nearest mandi ({market.nearest.market}) — sell at {best.market}.</>
                : <>{best.market} gives the best net price — and it is also your nearest mandi.</>}
            </div>
            <div className="mt-1 text-xs text-slate-600">Commodity matched: <b>{commodity}</b> · {cost ? `transport ₹${cost}/qtl/km (from your answer)` : "transport cost not given — ranked by mandi price"} · road ≈ 1.3 × straight-line distance</div>
          </div>
        </div>
      )}
      <div className="grid gap-4">
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="bg-forest-950 text-left text-[11px] uppercase tracking-wider text-forest-50">
              <tr>{["Rank", "Mandi · District", "Modal", "Dist.", "Transport", "Net ₹/qtl", "Date"].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {ranked.slice(0, 12).map((m) => (
                <tr key={m.market + m.district} className={`border-t border-slate-100 ${m.rank === 1 ? "bg-forest-50" : ""}`}>
                  <td className="px-3 py-2.5 font-semibold">{m.rank === 1 ? "⭐ 1" : m.rank}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{m.market}</div>
                    <div className="text-xs text-slate-500">{m.district}{m.state ? `, ${m.state}` : ""}</div>
                  </td>
                  <td className="mono px-3 py-2.5">{inr(m.modal_price)}</td>
                  <td className="mono px-3 py-2.5">{m.distance_km != null ? `${m.distance_km} km` : "—"}</td>
                  <td className="mono px-3 py-2.5 text-red-600">{m.transport_cost != null ? `−${inr(m.transport_cost)}` : "—"}</td>
                  <td className="mono px-3 py-2.5 font-bold text-forest-800">{inr(m.net_price)}</td>
                  <td className="mono px-3 py-2.5 text-xs text-slate-500">{m.arrival_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-slate-200 p-2">
          <MandiMap place={place} mandis={ranked} />
        </div>
      </div>
      <Rules text="Prices: today's Agmarknet arrivals (₹/quintal, FAQ grade where reported, otherwise median across grades). Mandi location = district HQ." />
    </div>
  );
}

export function SourcesPanel({ sources, trace, facts }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <b className="flex items-center gap-2"><Database size={16} /> Data sources used in this answer</b>
        {sources.map((s, i) => (
          <div key={i} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="mono text-[11px] text-slate-500">{s.detail}</div>
            </div>
            <Pill tone={/fallback|disk/.test(s.detail) ? "amber" : "green"}><CheckCircle2 size={12} />{/fallback|disk/.test(s.detail) ? "cached" : "live"}</Pill>
          </div>
        ))}
      </div>
      <div>
        <b className="flex items-center gap-2"><Info size={16} /> Verified facts given to the writer</b>
        <pre className="mono mt-2 max-h-80 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-emerald-200">
          {JSON.stringify(facts, null, 2)}
        </pre>
        <div className="mt-2 text-xs text-slate-500">{trace.length} trace steps recorded for this run.</div>
      </div>
    </div>
  );
}

const pctOrNull = (v) => (v == null ? null : Math.round(v * 1000) / 10);
function Kpi({ k, v, tone }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-[11px] text-slate-500">{k}</div>
      <div className={`mono mt-1 text-lg font-semibold ${tone === "red" ? "text-red-600" : ""}`}>{v}</div>
    </div>
  );
}
function Rules({ text }) {
  return <div className="flex gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500"><Info size={14} className="mt-0.5 shrink-0" />{text}</div>;
}
function NoData({ text = "Data unavailable for this run." }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{text}</div>;
}
