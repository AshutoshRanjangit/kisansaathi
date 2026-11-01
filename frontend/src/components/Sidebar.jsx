import React, { useState } from "react";
import { MapPin, Truck, Volume2, Flame, Loader2, CheckCircle2, AlertTriangle, LocateFixed, Sprout, RotateCcw } from "lucide-react";
import { warmup } from "../api.js";

export const CROPS = [
  ["Tomato", "🍅", "टमाटर"], ["Wheat", "🌾", "गेहूं"], ["Paddy", "🌱", "धान"], ["Potato", "🥔", "आलू"],
  ["Onion", "🧅", "प्याज"], ["Mustard", "🌼", "सरसों"], ["Cotton", "☁️", "कपास"], ["Maize", "🌽", "मक्का"],
  ["Cauliflower", "🥦", "फूलगोभी"], ["Brinjal", "🍆", "बैंगन"], ["Green Chilli", "🌶️", "हरी मिर्च"], ["Garlic", "🧄", "लहसुन"],
];

export default function Sidebar({ profile, setProfile, place, geo = {}, onLocate, known = {}, onReset }) {
  const [warm, setWarm] = useState(null);
  const [warming, setWarming] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const set = (k, v) => setProfile((p) => ({ ...p, [k]: v }));

  async function doWarm() {
    setWarming(true);
    try { setWarm(await warmup(profile)); } catch (e) { setWarm({ ok: false, error: String(e) }); }
    setWarming(false);
  }

  const crops = showAll ? CROPS : CROPS.slice(0, 6);
  const custom = !CROPS.some(([c]) => c === profile.crop);

  return (
    <aside className="card order-2 h-fit p-5 lg:order-1 lg:sticky lg:top-[132px]">
      <div className="mb-4 flex items-center justify-between border-b border-emerald-500/10 pb-3">
        <div>
          <div className="text-lg font-bold text-slate-100">Farm Profile</div>
          <div className="hi text-xs text-slate-400">खेत की जानकारी</div>
        </div>
      </div>

      <div className="label mb-1.5">Location / <span className="hi normal-case">स्थान</span></div>
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-[#0f201b]/60 px-3 py-2 focus-within:border-emerald-400">
          <MapPin size={18} className="text-emerald-400" />
          <input
            value={profile.location}
            onChange={(e) => setProfile((p) => ({ ...p, location: e.target.value, coords: null }))}
            className="w-full bg-transparent text-[15px] outline-none"
            placeholder={geo.status === "locating" ? "Detecting your location…" : "Village / town, district"}
          />
          <button
            onClick={onLocate}
            title="Use my current location (GPS)"
            className="shrink-0 rounded-md p-1 text-emerald-400 hover:bg-forest-50"
          >
            {geo.status === "locating" ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={18} />}
          </button>
        </div>
        <div className="mono mt-2 text-[11px] text-slate-400">
          {profile.coords
            ? `📍 Live GPS · ${profile.coords.lat.toFixed(4)}°N, ${profile.coords.lon.toFixed(4)}°E` +
              (profile.coords.accuracy ? ` · ±${Math.round(profile.coords.accuracy)} m` : "")
            : geo.status === "denied"
              ? "Location permission denied — type your village, district (or tap ⌖ to retry)"
              : geo.status === "error" || geo.status === "unsupported"
                ? "GPS unavailable — type your village, district"
                : profile.location ? "Typed location · resolved on next query" : "Allow location access or type your village"}
          {place && !profile.coords && ` · ${place.district || ""}, ${place.state || ""}`}
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-emerald-500/15 p-3">
        <div className="flex items-center justify-between">
          <div className="label">Learned from you / <span className="hi normal-case">आपसे जानकारी</span></div>
          {Object.keys(known).length > 0 && (
            <button onClick={onReset} className="flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:underline">
              <RotateCcw size={12} /> New chat
            </button>
          )}
        </div>
        <div className="mt-2 space-y-1.5 text-sm">
          <div className="flex items-center gap-2 whitespace-nowrap"><Sprout size={15} className="text-emerald-400" /> Crop / <span className="hi">फसल</span>:
            <b className="ml-auto">{known.crop || <span className="font-normal text-slate-500">agent will ask</span>}</b></div>
          <div className="flex items-center gap-2 whitespace-nowrap"><Truck size={15} className="text-emerald-400" /> Transport / <span className="hi">भाड़ा</span>:
            <b className="ml-auto text-right">
              {known.cost_per_qtl_km
                ? `₹${known.cost_per_qtl_km}/qtl/km`
                : known.transport_unknown ? <span className="font-normal text-slate-400">not given</span>
                : <span className="font-normal text-slate-500">asked if you sell</span>}
            </b></div>
          {known.cost_per_km && known.load_quintals && (
            <div className="text-right text-[11px] text-slate-400">₹{known.cost_per_km}/km ÷ {known.load_quintals} qtl per trip</div>
          )}
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-center justify-between rounded-xl px-1 py-1">
        <span className="flex items-center gap-2 text-sm">
          <Volume2 size={16} className="text-emerald-400" />
          <span>Speak answer <span className="hi block text-xs text-slate-400">बोलकर जवाब दें</span></span>
        </span>
        <input type="checkbox" checked={profile.speak} onChange={(e) => set("speak", e.target.checked)} className="h-5 w-5 accent-forest-700" />
      </label>

      <button
        onClick={doWarm}
        disabled={warming}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-forest-50 px-3 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-forest-100"
      >
        {warming ? <Loader2 size={16} className="animate-spin" /> : <Flame size={16} className="text-orange-500" />}
        Warm up live cache <span className="hi font-normal">(डेटा लोड करें)</span>
      </button>
      {warm && (
        <div className={`mt-2 flex gap-1.5 text-xs ${warm.ok ? "text-emerald-400" : "text-rose-400"}`}>
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
