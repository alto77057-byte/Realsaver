// Netlify function: POST /api/photo {action:'upload', id, image, w, h, style, consent}  |  GET /api/photo?id=...
const LIMIT = parseInt(process.env.PHOTO_DAILY_LIMIT || '1', 10);      // free photos per visitor per day
const GLIMIT = parseInt(process.env.PHOTO_GLOBAL_LIMIT || '25', 10);   // photos for the whole site per day
const R = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
const STYLES = ['glow', 'diya', 'rangoli', 'fireworks', 'festive', 'nepali', 'card', 'custom'];
const LOOKS = ['nepali', 'saree', 'lehenga', 'kashmiri', 'punjabi', 'arabic', 'bengali', 'hanbok', 'custom'];
const clean = t => String(t || '').replace(/[^\p{L}\p{N}\s,.'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
const BAD = /\b(child|children|kid|kids|baby|toddler|teen|teens|teenager|minor|underage|schoolgirl|little girl|boy|nude|naked|sexy|lingerie|bikini|bra|cleavage|topless|revealing|erotic)\b/i;
async function flagged(text) {
  try {
    const r = await fetch('https://api.openai.com/v1/moderations', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (process.env.OPENAI_API_KEY || '') }, body: JSON.stringify({ model: 'omni-moderation-latest', input: text }) });
    if (!r.ok) return true;
    const d = await r.json(); return !!(d.results && d.results[0] && d.results[0].flagged);
  } catch (e) { return true; }
}

async function redis(cmd) {
  const r = await fetch(R.url, { method: 'POST', headers: { Authorization: `Bearer ${R.token}` }, body: JSON.stringify(cmd) });
  return (await r.json()).result;
}
const getJ = async k => { const v = await redis(['GET', k]); return v ? JSON.parse(v) : null; };
const setJ = (k, v, ttl) => redis(['SET', k, JSON.stringify(v), 'EX', ttl]);
const cnt = async k => parseInt((await redis(['GET', k])) || '0', 10);
const incr = async (k, ttl) => { const n = await redis(['INCR', k]); if (n === 1) await redis(['EXPIRE', k, ttl]); return n; };
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

// safety check before any edit: no photos of children
async function check(dataUrl) {
  if (!process.env.OPENAI_API_KEY) return 'error';
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-6-luna', max_completion_tokens: 1000,
        messages: [
          { role: 'system', content: 'You check photos for a photo-editing website. Reply ONLY with JSON like {"minor":false}. Set "minor" to true if anyone visible in the photo looks like they could be under 18.' },
          { role: 'user', content: [{ type: 'text', text: 'Check this photo.' }, { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }] }
        ]
      })
    });
    if (!r.ok) { console.error('check error', r.status, (await r.text()).slice(0, 200)); return 'error'; }
    const d = await r.json(); const t = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    const m = t.match(/\{[\s\S]*\}/); if (!m) return 'error';
    return JSON.parse(m[0]).minor === true ? 'minor' : 'ok';
  } catch (e) { console.error('check failed', e.message); return 'error'; }
}

exports.handler = async (event) => {
  if (!R.url || !R.token) return json(503, { error: 'The photo studio is not ready yet.' });
  if (event.httpMethod === 'GET') {
    const id = String((event.queryStringParameters || {}).id || '');
    if (!/^[a-z0-9]{8,40}$/.test(id)) return json(400, { error: 'Missing id.' });
    const meta = await getJ('res:' + id);
    if (!meta) return json(200, { status: 'working' });
    if (meta.status === 'done') {
      let img = ''; for (let i = 0; i < meta.parts; i++) img += (await redis(['GET', `resp:${id}:${i}`])) || '';
      return json(200, { status: 'done', image: img });
    }
    return json(200, meta);
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch {}
  const id = String(b.id || '');
  const ip = event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const key = `photo:${day}:${ip}`, gkey = `photo-all:${day}`;
  if (b.action === 'generate' && /^[a-z0-9]{8,40}$/.test(id)) {
    if (!LOOKS.includes(b.look)) return json(400, { error: 'Bad request.' });
    const extra = clean(b.extra);
    if (b.look === 'custom' && !extra) return json(400, { error: 'Describe the photo you want.' });
    if (extra && (BAD.test(extra) || (await flagged(extra)))) return json(400, { error: "That detail can't be used. Please keep it simple and respectful." });
    if ((await cnt(gkey)) >= GLIMIT) return json(503, { error: 'The photo studio is at capacity for today. Please try again tomorrow.' });
    if ((await cnt(key)) >= LIMIT) return json(429, { error: 'Your free photo for today is used. Come back tomorrow.', limit: true });
    await incr(key, 86400); await incr(gkey, 86400);
    await setJ('img:' + id, { mode: 'generate', look: b.look, extra, ip, day }, 900); await setJ('res:' + id, { status: 'working' }, 900);
    return json(200, { ok: true, remaining: Math.max(0, LIMIT - (await cnt(key))) });
  }
  if (b.action !== 'upload' || !/^[a-z0-9]{8,40}$/.test(id)) return json(400, { error: 'Bad request.' });
  if (!b.consent) return json(400, { error: 'Please tick the box to confirm.' });
  const image = String(b.image || '');
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 750000) return json(400, { error: 'Could not read that photo. Try another one.' });
  const style = STYLES.includes(b.style) ? b.style : 'glow';

  if ((await cnt(gkey)) >= GLIMIT) return json(503, { error: 'The photo studio is at capacity for today. Please try again tomorrow.' });
  if ((await cnt(key)) >= LIMIT) return json(429, { error: 'Your free photo for today is used. Come back tomorrow.', limit: true });

  const scene = style === 'custom' ? clean(b.scene) : '';
  if (style === 'custom') {
    if (!scene) return json(400, { error: 'Describe the photo you want.' });
    if (BAD.test(scene) || (await flagged(scene))) return json(400, { error: "That detail can't be used. Please keep it simple and respectful." });
  }

  const verdict = await check(image);
  if (verdict === 'minor') return json(400, { error: "Photos of children can't be edited here." });
  if (verdict !== 'ok') return json(503, { error: 'Could not check the photo. Try again.' });

  await incr(key, 86400); await incr(gkey, 86400); // reserved now, given back if the edit fails
  await setJ('img:' + id, { image, w: +b.w || 1, h: +b.h || 1, style, scene, ip, day }, 900);
  await setJ('res:' + id, { status: 'working' }, 900);
  return json(200, { ok: true, remaining: Math.max(0, LIMIT - (await cnt(key))) });
};
