// Netlify function: POST /api/download { url } ->  { items:[{type,url,thumb}], caption, hashtags, owner, remaining }
const ACTOR = process.env.APIFY_ACTOR || 'apify~instagram-scraper';
const LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || '5', 10);
const TTL = parseInt(process.env.CACHE_TTL || '3600', 10); // media links expire, keep short
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

function normalize(input) {
  try {
    const u = new URL(String(input).trim());
    if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    return m ? `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/` : null;
  } catch { return null; }
}

function shape(d) {
  const items = [];
  const kids = d.childPosts && d.childPosts.length ? d.childPosts : null;
  if (kids) kids.forEach(c => items.push(c.videoUrl ? { type: 'video', url: c.videoUrl, thumb: c.displayUrl } : { type: 'image', url: c.displayUrl, thumb: c.displayUrl }));
  else if (d.videoUrl) items.push({ type: 'video', url: d.videoUrl, thumb: d.displayUrl });
  else if (d.images && d.images.length) d.images.forEach(i => items.push({ type: 'image', url: i, thumb: i }));
  else if (d.displayUrl) items.push({ type: 'image', url: d.displayUrl, thumb: d.displayUrl });
  const caption = d.caption || '';
  const hashtags = d.hashtags && d.hashtags.length ? d.hashtags.map(h => '#' + String(h).replace(/^#/, '')) : (caption.match(/#[\p{L}\p{N}_]+/gu) || []);
  return { items, caption, hashtags, owner: d.ownerUsername || '', meta: { w: d.dimensionsWidth || null, h: d.dimensionsHeight || null, dur: d.videoDuration || null, plays: d.videoPlayCount || null } };
}

const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch {}
  const url = normalize(body.url);
  if (!url) return json(400, { error: 'Paste a public Instagram reel or post link.' });

  const ip = event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const limitKey = `lim:${day}:${ip}`;

  const hit = await getKey('post:' + url);
  if (hit) return json(200, { ...hit, cached: true, remaining: Math.max(0, LIMIT - (await count(limitKey))) });

  if ((await count(limitKey)) >= LIMIT)
    return json(429, { error: `Daily free limit of ${LIMIT} reached. Come back tomorrow or upgrade.`, limit: true });

  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directUrls: [url], resultsType: 'posts', resultsLimit: 1, addParentData: false })
    });
    if (!r.ok) throw new Error('apify ' + r.status);
    const data = await r.json();
    const out = data && data[0] ? shape(data[0]) : null;
    if (!out || !out.items.length) return json(404, { error: 'No media found. The post may be private or deleted.' });
    await setKey('post:' + url, out, TTL);
    await incr(limitKey, 86400);
    return json(200, { ...out, cached: false, remaining: Math.max(0, LIMIT - (await count(limitKey))) });
  } catch (e) {
    return json(502, { error: 'Could not fetch this post right now. Try again in a moment.' });
  }
};
