// Netlify function: /api/download
//   POST { url }   -> cached hit: full result immediately
//                   -> cache miss: { run, url, remaining } to poll
//   GET  ?run=ID&url=... -> { status:'working' } | { status:'done', ...result } | { status:'failed', error }
// Env: APIFY_TOKEN, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
// Optional: APIFY_ACTOR (default apify~instagram-scraper), FREE_DAILY_LIMIT (default 5),
//           CACHE_TTL (default 3600), DOWNLOAD_MAX_USD (default 0.05)
const ACTOR = process.env.APIFY_ACTOR || 'apify~instagram-scraper';
const LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || '5', 10);
const TTL = parseInt(process.env.CACHE_TTL || '3600', 10); // media links expire, keep short
const MAX_USD = process.env.DOWNLOAD_MAX_USD || '0.05';
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
async function delKey(k) { if (R.url) return redis(['DEL', k]); mem.delete(k); }
async function incr(k, ttl) {
  if (R.url) { const n = await redis(['INCR', k]); if (n === 1) await redis(['EXPIRE', k, ttl]); return n; }
  const e = mem.get(k); const n = (e && e.exp > Date.now() ? e.v : 0) + 1;
  mem.set(k, { v: n, exp: e && e.exp > Date.now() ? e.exp : Date.now() + ttl * 1000 }); return n;
}
async function decr(k) {
  if (R.url) return redis(['DECR', k]);
  const e = mem.get(k); if (e) e.v = Math.max(0, e.v - 1);
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
  if (!process.env.APIFY_TOKEN || !R.url || !R.token) return json(503, { error: 'The download tool is not ready yet.' });

  // ---------- poll ----------
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    const run = String(q.run || '');
    if (!/^[A-Za-z0-9]{10,30}$/.test(run)) return json(400, { error: 'Bad request.' });
    const job = await getKey('djob:' + run);
    if (!job) return json(404, { error: 'This request expired. Please try again.' });

    try {
      const rr = await fetch(`https://api.apify.com/v2/actor-runs/${run}?token=${process.env.APIFY_TOKEN}`);
      if (!rr.ok) throw new Error('status ' + rr.status);
      const st = (await rr.json()).data || {};
      if (['READY', 'RUNNING'].includes(st.status)) return json(200, { status: 'working' });

      const fail = async (msg) => { await decr(job.limitKey); await delKey('djob:' + run); return json(200, { status: 'failed', error: msg }); };
      if (st.status !== 'SUCCEEDED') return await fail('Instagram did not respond in time. Please try again.');

      const ir = await fetch(`https://api.apify.com/v2/datasets/${st.defaultDatasetId}/items?token=${process.env.APIFY_TOKEN}&format=json&clean=1&limit=1`);
      const data = await ir.json();
      const row = data && data[0];
      if (row && row.error) return await fail('Instagram blocked this request just now. Please try again in a minute.');
      const out = row ? shape(row) : null;
      if (!out || !out.items.length) return await fail('No media found. The post may be private or deleted.');

      await setKey('post:' + job.url, out, TTL);
      await delKey('djob:' + run);
      return json(200, { status: 'done', ...out, cached: false, remaining: Math.max(0, LIMIT - (await count(job.limitKey))) });
    } catch (e) {
      return json(200, { status: 'working' }); // transient Apify/network hiccup: let the client keep polling
    }
  }

  // ---------- start ----------
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const url = normalize(body.url);
  if (!url) return json(400, { error: 'Paste a public Instagram reel or post link.' });

  const ip = event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const limitKey = `lim:${day}:${ip}`;

  const hit = await getKey('post:' + url);
  if (hit) return json(200, { status: 'done', ...hit, cached: true, remaining: Math.max(0, LIMIT - (await count(limitKey))) });

  const used = await incr(limitKey, 86400);
  if (used > LIMIT) { await decr(limitKey); return json(429, { error: `Daily free limit of ${LIMIT} reached. Come back tomorrow or upgrade.`, limit: true }); }

  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${process.env.APIFY_TOKEN}&timeout=90&maxTotalChargeUsd=${encodeURIComponent(MAX_USD)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directUrls: [url], resultsType: 'posts', resultsLimit: 1, addParentData: false }),
    });
    if (!r.ok) throw new Error('apify ' + r.status);
    const run = ((await r.json()).data || {}).id;
    if (!run) throw new Error('no run id');
    await setKey('djob:' + run, { limitKey, url }, 300);
    return json(200, { run, url, remaining: Math.max(0, LIMIT - used) });
  } catch (e) {
    await decr(limitKey);
    return json(502, { error: 'Could not start this download. Try again in a moment.' });
  }
};
