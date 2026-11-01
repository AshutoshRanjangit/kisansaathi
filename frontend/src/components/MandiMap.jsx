import React from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet";

export default function MandiMap({ place, mandis }) {
  if (!place) return null;
  const pts = mandis.filter((m) => m.lat && m.lon);
  const bounds = [[place.lat, place.lon], ...pts.map((m) => [m.lat, m.lon])];
  return (
    <MapContainer
      bounds={bounds.length > 1 ? bounds : undefined}
      center={bounds.length > 1 ? undefined : [place.lat, place.lon]}
      zoom={8}
      boundsOptions={{ padding: [30, 30] }}
      scrollWheelZoom={false}
      className="h-[340px] w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {pts.slice(0, 3).map((m) => (
        <Polyline key={`l-${m.market}`} positions={[[place.lat, place.lon], [m.lat, m.lon]]}
          pathOptions={{ color: m.rank === 1 ? "#16a34a" : "#64748b", weight: m.rank === 1 ? 3 : 1.5, dashArray: "6 6" }} />
      ))}
      {pts.map((m) => (
        <CircleMarker key={m.market} center={[m.lat, m.lon]} radius={m.rank === 1 ? 11 : 8}
          pathOptions={{ color: "#fff", weight: 2, fillColor: m.rank === 1 ? "#16a34a" : "#2563eb", fillOpacity: 0.95 }}>
          <Tooltip direction="top" permanent={m.rank <= 3}>
            <b>#{m.rank} {m.market}</b>
            {m.net_price != null ? ` · net ₹${m.net_price}` : ""}
          </Tooltip>
        </CircleMarker>
      ))}
      <CircleMarker center={[place.lat, place.lon]} radius={9} pathOptions={{ color: "#fff", weight: 2, fillColor: "#dc2626", fillOpacity: 1 }}>
        <Tooltip direction="right" offset={[10, 0]} permanent>🚜 Your farm</Tooltip>
      </CircleMarker>
    </MapContainer>
  );
}
