// Browser helper: turn an uploaded reel (video) or post image into small payloads for /api/comments.
const MAX_W = 768;

function toJpeg(src, w, h) {
  const s = Math.min(1, MAX_W / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

async function imageFrame(file) {
  const bmp = await createImageBitmap(file);
  return [toJpeg(bmp, bmp.width, bmp.height)];
}

async function videoFrames(file, n = 4) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error('video')); });
    const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
    const out = [];
    for (let i = 0; i < n; i++) {
      v.currentTime = d * (i + 0.5) / n; // middle of each of n equal segments
      await new Promise(ok => { v.onseeked = ok; });
      out.push(toJpeg(v, v.videoWidth, v.videoHeight));
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}

// First 60 s, 16 kHz mono WAV (about 1.9 MB). Returns null if the browser can't decode it.
async function videoAudio(file, maxSec = 60) {
  try {
    const buf = await file.arrayBuffer();
    const dec = await new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf);
    const len = Math.min(dec.duration, maxSec) * 16000 | 0;
    const off = new OfflineAudioContext(1, len, 16000);
    const src = off.createBufferSource(); src.buffer = dec; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const wav = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const w = (o, s) => [...s].forEach((ch, i) => wav.setUint8(o + i, ch.charCodeAt(0)));
    w(0, 'RIFF'); wav.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt ');
    wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
    wav.setUint32(24, 16000, true); wav.setUint32(28, 32000, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
    w(36, 'data'); wav.setUint32(40, pcm.length * 2, true);
    pcm.forEach((x, i) => wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
    const bytes = new Uint8Array(wav.buffer); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return 'data:audio/wav;base64,' + btoa(bin);
  } catch { return null; }
}

// Usage: const r = await generateComments({ caption, tone, file });
async function generateComments({ caption = '', tone = 'friendly', file = null }) {
  const body = { text: caption, tone };
  if (file) {
    if (file.type.startsWith('image/')) body.images = await imageFrame(file);
    else if (file.type.startsWith('video/')) {
      body.images = await videoFrames(file, 4);
      if (caption.trim().length < 40) body.audio = await videoAudio(file); // only needed when the caption is thin
    }
  }
  const res = await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json(); // { items, transcript?, remaining } or { error }
        }
