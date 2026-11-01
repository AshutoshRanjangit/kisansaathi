import React, { useState } from "react";
import { MapPin, Truck, Volume2, Flame, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { warmup } from "../api.js";

export const CROPS = [
  ["Tomato", "🍅", "टमाटर"], ["Wheat", "🌾", "गेहूं"], ["Paddy", "🌱", "धान"], ["Potato", "🥔", "आलू"],
  ["Onion", "🧅", "प्याज"], ["Mustard", "🌼", "सरसों"], ["Cotton", "☁️", "कपास"], ["Maize", "🌽", "मक्का"],
  ["Cauliflower", "🥦", "फूलगोभी"], ["Brinjal", "🍆", "बैंगन"], ["Green Chilli", "🌶️", "हरी मिर्च"], ["Garlic", "🧄", "लहसुन"],
];

export default function Sidebar({ profile, setProfile, place }) {
  const [warm, setWarm] = useState(null);
  const [warming, setWarming] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const set = (k, v) => setProfile((p) => ({ ...p, [k]: v }));

  async function doWarm() {
    setWarming(true);
    try { setWarm(await warmup(profile.location)); } catch (e) { setWarm({ ok: false, error: String(e) }); }
    setWarming(false);
  }

  const crops = showAll ? CROPS : CROPS.slice(0, 6);
  const custom = !CROPS.some(([c]) => c === profile.crop);

  return (
    <aside className="card order-2 h-fit p-5 lg:order-1 lg:sticky lg:top-[132px]">
      <div className="mb-4 flex items-center justify-between border-b border-forest-50 pb-3">
        <div>
          <div className="text-lg font-bold text-slate-900">Farm Profile</div>
          <div className="hi text-xs text-slate-500">खेत की जानकारी</div>
        </div>
      </div>

      <div className="label mb-1.5">Location / <span className="hi normal-case">स्थान</span></div>
      <div className="rounded-xl border border-forest-100 bg-forest-50/40 p-3">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 focus-within:border-forest-600">
          <MapPin size={18} className="text-forest-700" />
          <input
            value={profile.location}
            onChange={(e) => set("location", e.target.value)}
            className="w-full bg-transparent text-[15px] outline-none"
            placeholder="Village / town, district"
          />
        </div>
        <div className="mono mt-2 text-[11px] text-slate-500">
          {place ? `${place.lat.toFixed(3)}°N, ${place.lon.toFixed(3)}°E · ${place.district || ""}, ${place.state || ""}` : "Resolved on next query"}
        </div>
      </div>

      <div className="mt-5 flex items-baseline justify-between">
        <div className="label">Crop / <span className="hi normal-case">फसल चुनें</span></div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {crops.map(([c, emoji, hi]) => (
          <button
            key={c}
            onClick={() => set("crop", c)}
            className={`flex items-center gap-1.5 truncate rounded-xl border px-2.5 py-2 text-left text-sm transition ${
              profile.crop === c ? "border-forest-800 bg-forest-800 text-white" : "border-slate-200 bg-white hover:border-forest-600"
            }`}
          >
            <span>{emoji}</span>
            <span className="truncate">{c} <span className="hi opacity-80">({hi})</span></span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => setShowAll((s) => !s)} className="text-xs font-semibold text-forest-700 hover:underline">
          {showAll ? "− Fewer crops" : "+ More crops / अन्य फसलें"}
        </button>
        <input
          value={custom ? profile.crop : ""}
          onChange={(e) => set("crop", e.target.value)}
          placeholder="Other crop…"
          className="ml-auto w-28 rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-forest-600"
        />
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium"><Truck size={16} /> Transport / <span className="hi">भाड़ा</span></span>
          <span className="text-lg font-bold text-forest-800">₹{profile.cost.toFixed(1)}</span>
        </div>
        <div className="mt-1 text-xs text-slate-500">per quintal per km (your own cost)</div>
        <input
          type="range" min="0.1" max="3" step="0.1" value={profile.cost}
          onChange={(e) => set("cost", parseFloat(e.target.value))}
          className="mt-2 w-full accent-forest-700"
        />
      </div>

      <label className="mt-4 flex cursor-pointer items-center justify-between rounded-xl px-1 py-1">
        <span className="flex items-center gap-2 text-sm">
          <Volume2 size={16} className="text-forest-700" />
          <span>Speak answer <span className="hi block text-xs text-slate-500">बोलकर जवाब दें</span></span>
        </span>
        <input type="checkbox" checked={profile.speak} onChange={(e) => set("speak", e.target.checked)} className="h-5 w-5 accent-forest-700" />
      </label>

      <button
        onClick={doWarm}
        disabled={warming}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-forest-100 bg-forest-50 px-3 py-2.5 text-sm font-semibold text-forest-800 hover:bg-forest-100"
      >
        {warming ? <Loader2 size={16} className="animate-spin" /> : <Flame size={16} className="text-orange-500" />}
        Warm up live cache <span className="hi font-normal">(डेटा लोड करें)</span>
      </button>
      {warm && (
        <div className={`mt-2 flex gap-1.5 text-xs ${warm.ok ? "text-forest-700" : "text-red-600"}`}>
          {warm.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
          <span>
            {warm.ok
              ? `${warm.mandi_records ?? 0} live mandi records (${warm.mandi_state ?? "—"}) · weather ${warm.weather}`
              : warm.error}
          </span>
        </div>
      )}
    </aside>
  );
}
