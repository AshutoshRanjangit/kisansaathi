// Records microphone audio as 16 kHz mono WAV (a format Gemini accepts natively).
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let level = 0;
  proc.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    let sum = 0;
    for (let i = 0; i < data.length; i += 64) sum += Math.abs(data[i]);
    level = Math.min(1, (sum / (data.length / 64)) * 6);
  };
  source.connect(proc);
  proc.connect(ctx.destination);
  return {
    level: () => level,
    async stop() {
      proc.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      const rate = ctx.sampleRate;
      await ctx.close();
      return encodeWav(chunks, rate, 16000);
    },
  };
}

function encodeWav(chunks, inRate, outRate) {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(length);
  let off = 0;
  chunks.forEach((c) => { merged.set(c, off); off += c.length; });
  const ratio = inRate / outRate;
  const outLen = Math.floor(length / ratio);
  const samples = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = start; j < end; j++) s += merged[j];
    const v = Math.max(-1, Math.min(1, s / Math.max(1, end - start)));
    samples[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, outRate, true); dv.setUint32(28, outRate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data");
  dv.setUint32(40, samples.length * 2, true);
  new Int16Array(buf, 44).set(samples);
  return new Blob([buf], { type: "audio/wav" });
}
