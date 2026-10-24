// Netlify function: POST /api/stories { username } ->  { items:[{type,url,thumb}], caption, hashtags, owner, remaining }
const ACTOR = process.env.STORIES_ACTOR || 'data_direct~instagram-user-stories-scraper';
const LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || '5', 10);
const TTL = parseInt(process.env.STORIES_TTL || '300', 10); // media links expire, keep short
const R = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
const mem = globalThis.__rs || (globalThis.__rs = new Map()); // fallback; use Upstash on serverless

async function redis(cmd) {
  const r = await fetch(R.url, { method: 'POST', headers: { Authorization: `Bearer ${R.token}` }, body: JSON.stringify(cmd) });
  return (await r.json()).result;
}
async function getKey(k) {
  if (R.url) { const v = await redis(['GET', k]); return v ? JSON.parse(v) : null; }
  const e = mem.get(k); return e && e.exp > Date.now() ? e.v : null;
}
async function setKey(k, v, ttl) {
  if (R.url) return redis(['SET', k, JSON.stringify(v), 'EX', ttl]);
  mem.set(k, { v, exp: Date.now() + ttl * 1000 });
}
async function incr(k, ttl) {
  if (R.url) { const n = await redis(['INCR', k]); if (n === 1) await redis(['EXPIRE', k, ttl]); return n; }
  const e = mem.get(k); const n = (e && e.exp > Date.now() ? e.v : 0) + 1;
  mem.set(k, { v: n, exp: e && e.exp > Date.now() ? e.exp : Date.now() + ttl * 1000 }); return n;
}
async function count(k) {
  if (R.url) return parseInt((await redis(['GET', k])) || '0', 10);
  const e = mem.get(k); return e && e.exp > Date.now() ? e.v : 0;
}

const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const NONE = 'No active stories right now. The account may be private or has no story.';

function userFrom(input) {
  let s = String(input || '').trim();
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/(?:stories\/)?([A-Za-z0-9._]{1,30})/);
      s = m ? m[1] : '';
    }
  } catch { return null; }
  s = s.replace(/^@/, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return null;
  return ['p', 'reel', 'reels', 'tv', 'explore', 'stories'].includes(s.toLowerCase()) ? null : s.toLowerCase();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch {}
  const user = userFrom(body.username);
  if (!user) return json(400, { error: 'Type a valid Instagram username, like natgeo.' });

  const ip = event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const limitKey = `lim:${day}:${ip}`;

  const hit = await getKey('stories:' + user);
  if (hit) {
    if (!hit.items.length) return json(404, { error: NONE });
    return json(200, { ...hit, cached: true, remaining: Math.max(0, LIMIT - (await count(limitKey))) });
  }
  if ((await count(limitKey)) >= LIMIT)
    return json(429, { error: `Daily free limit of ${LIMIT} reached. Come back tomorrow or upgrade.`, limit: true });

  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user })
    });
    if (!r.ok) throw new Error('apify ' + r.status);
    const data = await r.json();
    const items = (Array.isArray(data) ? data : []).filter(x => x && (x.video_url || x.thumbnail_url)).map(x => {
      const vid = !!(x.is_video && x.video_url);
      return { type: vid ? 'video' : 'image', url: vid ? x.video_url : x.thumbnail_url, thumb: x.thumbnail_url || '', date: x.date_timestamp || null, exp: x.expires_at_timestamp || null, w: x.width || null, h: x.height || null };
    }).sort((a, b) => (a.date || 0) - (b.date || 0));
    const out = { items, username: user };
    await setKey('stories:' + user, out, TTL);
    await incr(limitKey, 86400);
    if (!items.length) return json(404, { error: NONE });
    return json(200, { ...out, cached: false, remaining: Math.max(0, LIMIT - (await count(limitKey))) });
  } catch (e) {
    return json(502, { error: 'Could not load stories right now. Try again in a moment.' });
  }
};
    
