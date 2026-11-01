import React, { useEffect, useState } from "react";
import {
  MapPin, CalendarDays, Clock, Wind, Thermometer, Droplets, Gauge, Sprout, ArrowUpRight, LocateFixed,
  SprayCan, CloudRain, Store, Loader2, Mic, Waves, Sun, CloudSun, CloudDrizzle, AlertTriangle,
} from "lucide-react";
import { getOverview } from "../api.js";
import { inr } from "./ui.jsx";

// translucent dark glass for cards that float over the aerial photo
const GLASS = "rounded-2xl border border-white/10 bg-[#0b1712]/55 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,.35)] transition-all duration-200 ease-in-out hover:border-emerald-400/30";
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => (deg == null ? "—" : COMPASS[Math.round(deg / 45) % 8]);
const hhmm = (ts) => (ts ? ts.slice(11, 16) : "—");
const day = (ts, opts = { weekday: "short" }) => (ts ? new Date(ts).toLocaleDateString("en-IN", opts) : "");
const r0 = (v) => (v == null ? "—" : Math.round(v));
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);

function CardTitle({ title, sub, onOpen }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="text-[15px] font-semibold tracking-tight text-slate-100">{title}</div>
        {sub && <div className="mt-0.5 text-[11px] leading-snug text-slate-400">{sub}</div>}
      </div>
      {onOpen && (
        <button onClick={onOpen} className="rounded-full p-1 text-slate-400 transition-all duration-200 ease-in-out hover:bg-white/10 hover:text-emerald-300">
          <ArrowUpRight size={16} />
        </button>
      )}
    </div>
  );
}

function ScoreGauge({ value = 0, label }) {
  const v = Math.max(0, Math.min(10, value));
  const a0 = Math.PI, a1 = Math.PI * (1 - v / 10);
  const P = (a, r = 70) => [100 + r * Math.cos(a), 100 - r * Math.sin(a)];
  const [x0, y0] = P(a0), [x1, y1] = P(a1), [xe, ye] = P(0);
  const tone = v >= 7 ? "#a3e635" : v >= 5 ? "#f59e0b" : "#f43f5e";
  return (
    <svg viewBox="0 0 200 118" className="w-full">
      <defs>
        <linearGradient id="gaugeGrad" x1="0" x2="1">
          <stop offset="0%" stopColor="#84cc16" /><stop offset="100%" stopColor="#ecfccb" />
        </linearGradient>
      </defs>
      <path d={`M${x0},${y0} A70,70 0 0 1 ${xe},${ye}`} stroke="rgba(255,255,255,.08)" strokeWidth="14" fill="none" strokeLinecap="round" />
      <path d={`M${x0},${y0} A70,70 0 0 1 ${x1},${y1}`} stroke="url(#gaugeGrad)" strokeWidth="14" fill="none" strokeLinecap="round" />
      <text x="100" y="92" textAnchor="middle" fontSize="28" fontWeight="600" fill="#f1f5f9" fontFamily="JetBrains Mono, monospace">{v.toFixed(1)}</text>
      <text x="100" y="110" textAnchor="middle" fontSize="11" fill={tone} fontFamily="Inter, sans-serif">{label}</text>
    </svg>
  );
}

function Metric({ icon: Icon, label, value, min, max, tone = "text-slate-100" }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-300"><Icon size={16} /></span>
      <div className="min-w-0">
        <div className="text-[10px] text-slate-400">{label}</div>
        <div className={`font-mono text-xl leading-tight ${tone}`}>{value}</div>
        {(min != null || max != null) && <div className="font-mono text-[9px] text-slate-500">Max {max} · Min {min}</div>}
      </div>
    </div>
  );
}

const CELL = { good: "bg-lime-400", caution: "bg-[#f59e0b]", avoid: "bg-[#f43f5e]", night: "bg-white/10" };
const WX_ICON = (code, rain) => (rain >= 2 || (code >= 51 && code < 70) ? CloudDrizzle : code >= 80 ? CloudRain : code >= 2 ? CloudSun : Sun);

export default function Home({ profile, setProfile, geo = {}, onLocate, onAskQuestion, health }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(new Date());
  const [typed, setTyped] = useState("");

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  const key = profile.coords ? `${profile.coords.lat.toFixed(3)},${profile.coords.lon.toFixed(3)}` : profile.location;
  useEffect(() => {
    if (!profile.coords && !profile.location) return;
    let alive = true;
    setLoading(true); setErr("");
    getOverview(profile)
      .then((d) => { if (alive) { if (d.ok) setData(d); else setErr(d.error || "Could not load live data"); } })
      .catch((e) => alive && setErr(`Server unreachable: ${e.message}`))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const place = data?.place;
  const cur = data?.current || {};
  const rng = data?.range48 || {};
  const spray = data?.spray;
  const irr = data?.irrigation;
  const ready = data?.readiness;
  const mandi = data?.mandi;
  const daily = data?.daily;
  const hours = data?.spray_hours || [];
  const goodHours = hours.filter((h) => h.status === "good").length;
  const nextWin = spray?.windows?.[0];
  const nowIso = new Date(now.getTime() + 5.5 * 3600e3).toISOString().slice(0, 16);
  const winNow = nextWin && nextWin.start <= nowIso && nowIso < nextWin.end;
  const maxModal = Math.max(1, ...(mandi?.top || []).map((m) => m.max));

  const tasks = [
    {
      icon: SprayCan, title: nextWin ? "Spray window" : "Hold spraying",
      time: nextWin ? `${day(nextWin.start)} ${hhmm(nextWin.start)} – ${nextWin.end.slice(11, 16)}` : "next 48 h",
      badge: nextWin ? (winNow ? ["Now", "emerald"] : ["Upcoming", "amber"]) : ["Avoid", "rose"],
      q: "Should I spray my crop in the next two days?",
    },
    {
      icon: Droplets, title: irr ? irr.decision.split(" — ")[0] : "Irrigation",
      time: irr ? `root zone ${irr.root_zone_moisture_pct ?? "—"}% · ET₀ ${irr.et0_next_3d_mm} mm / 3 d` : "—",
      badge: irr ? ({ irrigate_now: ["Urgent", "rose"], irrigate_soon: ["Soon", "amber"] }[irr.code] || ["On track", "emerald"]) : ["—", "slate"],
      q: "Do I need to irrigate my field now?",
    },
    {
      icon: CloudRain, title: spray?.next_rain ? "Rain expected" : "No rain expected",
      time: spray?.next_rain ? `${day(spray.next_rain.time)} ${hhmm(spray.next_rain.time)} · ${spray.next_rain.probability_pct}%` : "in the next 48 h",
      badge: spray?.next_rain ? ["Plan", "amber"] : ["Clear", "emerald"],
      q: "What will the weather be like for my field this week?",
    },
  ];
  const BADGE = {
    emerald: "border-emerald-400/30 bg-emerald-500/15 text-emerald-300",
    amber: "border-amber-400/30 bg-amber-500/15 text-amber-300",
    rose: "border-rose-400/30 bg-rose-500/15 text-rose-300",
    slate: "border-white/10 bg-white/5 text-slate-300",
  };

  const needsLocation = !profile.coords && !profile.location;

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,.55)]">
      {/* aerial background */}
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url(/bg-fields.jpg)" }} />
      <div className="absolute inset-0 bg-gradient-to-b from-[#06110c]/70 via-[#06110c]/35 to-[#06110c]/85" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(4,8,6,.65)_100%)]" />

      <div className="relative grid grid-cols-1 gap-4 p-3 md:p-6 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        {/* ---------------- left column ---------------- */}
        <div className="min-w-0 space-y-4">
          <div className="px-1 pb-1 pt-2">
            <div className="flex items-end gap-2">
              <h1 className="text-3xl font-semibold tracking-tight text-white drop-shadow">{place ? place.name : "Your field"}</h1>
              {place && <span className="mb-1 font-mono text-[10px] leading-tight text-slate-300">{place.lat.toFixed(4)}° N<br />{place.lon.toFixed(4)}° E</span>}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-200"><MapPin size={13} />
              {place ? [place.district, place.state].filter(Boolean).join(", ") : profile.location || "Locating…"}
            </div>
            <div className="mt-1 flex items-center gap-3 font-mono text-[11px] text-slate-300">
              <span className="flex items-center gap-1"><CalendarDays size={12} />{now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
              <span className="flex items-center gap-1"><Clock size={12} />{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>

          <div className={`${GLASS} p-4`}>
            <CardTitle title="Field Readiness Score" sub="Mean of 4 live indicators: soil moisture, water balance, spray opportunity, heat stress" />
            {ready ? (
              <>
                <div className="mx-auto mt-2 max-w-[220px]"><ScoreGauge value={ready.score} label={ready.label} /></div>
                <div className="mt-1 grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                  {Object.entries(ready.parts).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between rounded-lg bg-white/5 px-2 py-1">
                      <span className="truncate text-slate-400">{k.replace("_", " ")}</span>
                      <span className={v >= 7 ? "text-lime-300" : v >= 5 ? "text-amber-300" : "text-rose-300"}>{v}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : <Skeleton h="h-36" />}
          </div>

          <div className={`${GLASS} p-4`}>
            <CardTitle title="Weather Conditions" sub="Real-time conditions for smarter field decisions" onOpen={() => onAskQuestion("What will the weather be like for my field this week?")} />
            {data?.current ? (
              <>
                <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${(cur.wind_speed_10m ?? 0) <= 15 ? BADGE.emerald : BADGE.amber}`}>
                  <Wind size={12} /> {(cur.wind_speed_10m ?? 0) <= 15 ? "Wind OK for spraying" : "Too windy to spray"}
                </span>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="font-mono text-3xl text-white">{r0(cur.wind_speed_10m)}</span>
                  <span className="text-xs text-slate-300">km/h · {compass(cur.wind_direction_10m)}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                    <Thermometer size={14} className="text-slate-300" />
                    <div className="mt-1 text-[10px] text-slate-400">Temperature</div>
                    <div className="font-mono text-lg text-cyan-300">{r0(cur.temperature_2m)}°C</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                    <Droplets size={14} className="text-slate-300" />
                    <div className="mt-1 text-[10px] text-slate-400">Humidity</div>
                    <div className="font-mono text-lg text-cyan-300">{r0(cur.relative_humidity_2m)}%</div>
                  </div>
                </div>
              </>
            ) : <Skeleton h="h-40" />}
          </div>
        </div>

        {/* ---------------- centre column ---------------- */}
        <div className="flex min-w-0 flex-col justify-between gap-4 xl:min-h-[560px]">
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            {data?.weather_source && <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 font-mono text-[10px] text-slate-300 backdrop-blur">● live · Open-Meteo {data.weather_source === "live" ? "" : `(${data.weather_source})`}</span>}
            {mandi && <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 font-mono text-[10px] text-slate-300 backdrop-blur">● Agmarknet {mandi.date || ""} · {mandi.records} records</span>}
            <button onClick={onLocate} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] text-slate-200 backdrop-blur transition-all duration-200 ease-in-out hover:border-emerald-400/40">
              {geo.status === "locating" ? <Loader2 size={12} className="animate-spin" /> : <LocateFixed size={12} />} {profile.coords ? "Live GPS" : "Use my location"}
            </button>
          </div>

          {/* centre call-to-action / states */}
          <div className="grid flex-1 place-items-center py-4 xl:py-6">
            {needsLocation ? (
              <div className={`${GLASS} max-w-md p-6 text-center`}>
                <MapPin className="mx-auto text-emerald-300" />
                <div className="mt-2 text-lg font-semibold">Where is your farm?</div>
                <p className="mt-1 text-sm text-slate-300">Allow location access, or type your village and district.</p>
                <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) setProfile((p) => ({ ...p, location: typed.trim(), coords: null })); }} className="mt-4 flex gap-2">
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Village, district"
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
                  <button className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">Go</button>
                </form>
                <button onClick={onLocate} className="mt-3 text-xs text-emerald-300 hover:underline">⌖ Use my location</button>
              </div>
            ) : err ? (
              <div className={`${GLASS} flex max-w-md items-start gap-2 p-5 text-sm text-amber-200`}><AlertTriangle size={18} className="shrink-0" />{err}</div>
            ) : (
              <button onClick={() => onAskQuestion("")}
                className="group flex flex-col items-center gap-3 rounded-3xl px-8 py-6 text-center transition-all duration-200 ease-in-out hover:bg-black/20">
                <span className="mic-ring grid h-20 w-20 place-items-center rounded-full bg-emerald-500 text-slate-950 shadow-glow transition-transform duration-200 group-hover:scale-105">
                  {loading ? <Loader2 size={30} className="animate-spin" /> : <Mic size={32} />}
                </span>
                <span className="text-2xl font-semibold text-white drop-shadow"><span className="hi">किसानसाथी से पूछें</span></span>
                <span className="text-sm text-slate-200">Ask by voice — spraying, irrigation, mandi prices, what to grow</span>
              </button>
            )}
          </div>

          {/* daily tasks */}
          <div className={`${GLASS} p-4`}>
            <CardTitle title="Today's Field Tasks" sub="Recommended from live weather, soil and spray conditions — tap one to ask the agent" />
            <div className="mt-3 grid gap-2.5 md:grid-cols-3">
              {tasks.map((t) => (
                <button key={t.title} onClick={() => onAskQuestion(t.q)}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-3 text-left transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:border-emerald-400/30">
                  <div className="flex items-center justify-between">
                    <t.icon size={16} className="text-slate-300" />
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${BADGE[t.badge[1]]}`}>{t.badge[0]}</span>
                  </div>
                  <div className="mt-2 font-mono text-[10px] text-slate-400">{data ? t.time : "…"}</div>
                  <div className="mt-0.5 truncate text-[15px] font-semibold text-white">{data ? t.title : "Loading…"}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 7-day strip */}
          <div className={`${GLASS} flex items-stretch gap-1 overflow-x-auto p-2`}>
            {daily?.time ? daily.time.map((d, i) => {
              const rain = daily.precipitation_sum?.[i] ?? 0;
              const Icon = WX_ICON(daily.weather_code?.[i] ?? 0, rain);
              return (
                <div key={d} className={`flex min-w-[64px] flex-1 flex-col items-center rounded-xl px-2 py-2 ${i === 0 ? "bg-emerald-500/15 ring-1 ring-emerald-400/30" : ""}`}>
                  <div className={`text-[11px] ${i === 0 ? "font-semibold text-white" : "text-slate-400"}`}>{i === 0 ? "Today" : day(d)}</div>
                  <Icon size={18} className={rain >= 2 ? "my-1 text-cyan-300" : "my-1 text-amber-200"} />
                  <div className="font-mono text-[11px] text-slate-100">{r0(daily.temperature_2m_max?.[i])}° <span className="text-slate-500">{r0(daily.temperature_2m_min?.[i])}°</span></div>
                  <div className="font-mono text-[9px] text-cyan-300/80">{rain ? `${rain.toFixed(1)} mm` : "dry"}</div>
                </div>
              );
            }) : <Skeleton h="h-16" />}
          </div>
        </div>

        {/* ---------------- right column ---------------- */}
        <div className="min-w-0 space-y-4">
          <div className={`${GLASS} p-4`}>
            <CardTitle title="Field Health Map" sub="Live micro-climate for your field and hour-by-hour spray suitability" onOpen={() => onAskQuestion("Should I spray my crop in the next two days?")} />
            {data?.current ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4">
                  <Metric icon={Droplets} label="Humidity" value={`${r0(cur.relative_humidity_2m)}%`} max={`${r0(rng.relative_humidity_2m?.max)}%`} min={`${r0(rng.relative_humidity_2m?.min)}%`} />
                  <Metric icon={Thermometer} label="Temperature" value={`${r0(cur.temperature_2m)}°C`} max={`${r0(rng.temperature_2m?.max)}°`} min={`${r0(rng.temperature_2m?.min)}°`} />
                  <Metric icon={Waves} label="Root-zone moisture" value={pct(cur.soil_moisture_9_to_27cm)} max={pct(rng.soil_moisture_9_to_27cm?.max)} min={pct(rng.soil_moisture_9_to_27cm?.min)} tone="text-cyan-300" />
                  <Metric icon={Gauge} label="Vapour pressure deficit" value={`${cur.vapour_pressure_deficit?.toFixed(1) ?? "—"}`} max={rng.vapour_pressure_deficit?.max?.toFixed(1)} min={rng.vapour_pressure_deficit?.min?.toFixed(1)} />
                </div>
                <div className="mt-5 flex items-center justify-between text-[11px]">
                  <span className="text-slate-300">Spray suitability · next 48 h</span>
                  <span className={goodHours ? "text-lime-300" : "text-rose-300"}>{goodHours ? `${goodHours} good hours` : "No safe hours"}</span>
                </div>
                <div className="mt-2 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px]">
                  {hours.map((h) => (
                    <div key={h.time} title={`${day(h.time)} ${hhmm(h.time)} · ${h.status}${h.reasons.length && h.status !== "night" ? ` (${h.reasons.join(", ")})` : ""}`}
                      className={`aspect-square rounded-[3px] ${CELL[h.status]} ${h.status === "avoid" && h.reasons.includes("rain") ? "animate-pulse" : ""}`} />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-400">
                  {[["good", "Good"], ["caution", "Caution"], ["avoid", "Avoid"], ["night", "Night"]].map(([k, l]) => (
                    <span key={k} className="flex items-center gap-1"><i className={`h-2 w-2 rounded-sm ${CELL[k]}`} />{l}</span>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-slate-300">
                  <span>{nextWin ? `Best window: ${day(nextWin.start)} ${hhmm(nextWin.start)}–${nextWin.end.slice(11, 16)}` : "Wait for a better window"}</span>
                  <span className="rounded-md border border-lime-400/40 bg-lime-400/15 px-1.5 py-0.5 font-mono text-[9px] text-lime-300">AI insight</span>
                </div>
              </>
            ) : <Skeleton h="h-72" />}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <div className={`${GLASS} p-4`}>
              <CardTitle title="Mandi Pulse" sub={mandi ? `Today in ${mandi.state} · ${mandi.commodities} crops` : "Live Agmarknet prices"} onOpen={() => onAskQuestion("Where should I sell my crop for the best price?")} />
              {mandi?.top?.length ? (
                <div className="mt-3 space-y-2.5">
                  {mandi.top.slice(0, 5).map((m) => (
                    <div key={m.commodity}>
                      <div className="flex items-baseline justify-between text-[11px]">
                        <span className="truncate text-slate-200">{m.commodity.replace(/\(.*?\)/g, "")}</span>
                        <span className="font-mono text-emerald-300">{inr(m.modal)}</span>
                      </div>
                      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="bg-gradient-to-r from-lime-500 to-emerald-300" style={{ width: `${(m.modal / maxModal) * 100}%` }} />
                      </div>
                      <div className="mt-0.5 font-mono text-[9px] text-slate-500">{m.markets} mandis · {inr(m.min)}–{inr(m.max)}/qtl</div>
                    </div>
                  ))}
                </div>
              ) : data?.mandi_error ? <div className="mt-3 text-xs text-amber-300">Mandi feed unavailable right now</div> : <Skeleton h="h-40" />}
            </div>

            <div className={`${GLASS} relative overflow-hidden p-4`}>
              <div className="absolute inset-x-0 bottom-0 h-24 bg-cover bg-center opacity-40" style={{ backgroundImage: "url(/bg-tractor.jpg)" }} />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-transparent to-[#0b1712]" />
              <div className="relative">
                <CardTitle title="Soil Condition" sub="Know your soil before you water" onOpen={() => onAskQuestion("Do I need to irrigate my field now?")} />
                {data?.current ? (
                  <div className="mt-3 space-y-2">
                    {[["0–1 cm", cur.soil_moisture_0_to_1cm], ["3–9 cm", cur.soil_moisture_3_to_9cm], ["9–27 cm", cur.soil_moisture_9_to_27cm]].map(([d, v]) => (
                      <div key={d}>
                        <div className="flex justify-between font-mono text-[10px]"><span className="text-slate-400">{d}</span><span className="text-cyan-300">{pct(v)}</span></div>
                        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div className={`h-full ${v < 0.17 ? "bg-[#f43f5e]" : v < 0.27 ? "bg-[#f59e0b]" : "bg-cyan-400"}`} style={{ width: `${Math.min(100, (v || 0) / 0.45 * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="rounded-lg bg-black/30 px-2 py-1.5"><div className="text-[9px] text-slate-400">Soil temp</div><div className="font-mono text-sm text-slate-100">{r0(cur.soil_temperature_0cm)}°C</div></div>
                      <div className="rounded-lg bg-black/30 px-2 py-1.5"><div className="text-[9px] text-slate-400">ET₀ today</div><div className="font-mono text-sm text-slate-100">{daily?.et0_fao_evapotranspiration?.[0]?.toFixed(1) ?? "—"} mm</div></div>
                    </div>
                    {irr && <div className="pt-1 text-[11px] leading-snug text-slate-200"><Sprout size={12} className="mr-1 inline text-lime-300" />{irr.decision}</div>}
                  </div>
                ) : <Skeleton h="h-40" />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Skeleton({ h = "h-24" }) {
  return <div className={`mt-3 w-full animate-pulse rounded-xl bg-white/5 ${h}`} />;
}
