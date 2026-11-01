export async function getHealth() {
  const r = await fetch("/api/health");
  return r.json();
}

function formOf(fields) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== "") fd.append(k, String(v));
  });
  return fd;
}

export async function reverseGeocode(lat, lon) {
  const r = await fetch(`/api/reverse?lat=${lat}&lon=${lon}`);
  return r.json();
}

export async function warmup(profile) {
  const fd = formOf({ location: profile.location, lat: profile.coords?.lat, lon: profile.coords?.lon });
  const r = await fetch("/api/warmup", { method: "POST", body: fd });
  return r.json();
}

/** Streams agent steps (Server-Sent Events over a POST response). */
export async function askAgent(fields, audioBlob, onEvent) {
  const fd = formOf(fields);
  if (audioBlob) fd.append("audio", audioBlob, "question.wav");
  const res = await fetch("/api/ask", { method: "POST", body: fd });
  if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith("data: ")) onEvent(JSON.parse(chunk.slice(6)));
    }
  }
}

export async function getOverview(profile) {
  const q = new URLSearchParams();
  if (profile.coords) { q.set("lat", profile.coords.lat); q.set("lon", profile.coords.lon); }
  else q.set("location", profile.location || "");
  const r = await fetch(`/api/overview?${q.toString()}`);
  return r.json();
}
