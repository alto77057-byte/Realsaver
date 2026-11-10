// Netlify function: /api/stories
//   POST { username }        -> cached hit: full result immediately
//                             -> cache miss: { run, username, remaining } to poll
//   GET  ?run=ID             -> { status:'working' } | { status:'done', ...result } | { status:'failed', error }
// Env: APIFY_TOKEN, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
// Optional: STORIES_ACTOR (default data_direct~instagram-user-stories-scraper),
//           FREE_DAILY_LIMIT (default 5), STORIES_TTL (default 300), STORIES_MAX_USD (default 0.05)
const ACTOR = process.env.STORIES_ACTOR || 'data_direct~instagram-user-stories-scraper';
const LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || '5', 10);
const TTL = parseInt(process.env.STORIES_TTL || '300', 10); // media links expire, keep short
const MAX_USD = process.env.STORIES_MAX_USD || '0.05';
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
  } catch (e) { return null; }
  s = s.replace(/^@/, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return null;
  return ['p', 'reel', 'reels', 'tv', 'explore', 'stories'].includes(s.toLowerCase()) ? null : s.toLowerCase();
}

function parseInput(input) {
  const s = String(input || '').trim();
  const m = s.match(/instagram\.com\/stories\/(?!highlights)([^/?#]+)\/(\d{6,})/i);
  const highlight = /instagram\.com\/stories\/highlights\//i.test(s) || /instagram\.com\/s\//i.test(s);
  return { user: highlight ? null : userFrom(s), id: m ? m[2] : '', highlight };
}

exports.handler = async (event) => {
  if (!process.env.APIFY_TOKEN || !R.url || !R.token) return json(503, { error: 'The stories tool is not ready yet.' });

  // ---------- poll ----------
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    const run = String(q.run || '');
    if (!/^[A-Za-z0-9]{10,30}$/.test(run)) return json(400, { error: 'Bad request.' });
    const job = await getKey('sjob:' + run);
    if (!job) return json(404, { error: 'This request expired. Please try again.' });

    try {
      const rr = await fetch(`https://api.apify.com/v2/actor-runs/${run}?token=${process.env.APIFY_TOKEN}`);
      if (!rr.ok) throw new Error('status ' + rr.status);
      const st = (await rr.json()).data || {};
      if (['READY', 'RUNNING'].includes(st.status)) return json(200, { status: 'working' });

      const fail = async (msg) => { await decr(job.limitKey); await delKey('sjob:' + run); return json(200, { status: 'failed', error: msg }); };
      if (st.status !== 'SUCCEEDED') return await fail('Instagram did not respond in time. Please try again.');

      const ir = await fetch(`https://api.apify.com/v2/datasets/${st.defaultDatasetId}/items?token=${process.env.APIFY_TOKEN}&format=json&clean=1&limit=100`);
      const data = await ir.json();
      if (data && data[0] && data[0].error) return await fail('Instagram blocked this request just now. Please try again in a minute.');
      const items = (Array.isArray(data) ? data : []).filter(x => x && (x.video_url || x.thumbnail_url)).map(x => {
        const vid = !!(x.is_video && x.video_url);
        return { id: String(x.media_id || (String(x.url || '').match(/stories\/[^/]+\/(\d+)/) || [])[1] || ''), type: vid ? 'video' : 'image', url: vid ? x.video_url : x.thumbnail_url, thumb: x.thumbnail_url || '', date: x.date_timestamp || null, exp: x.expires_at_timestamp || null, w: x.width || null, h: x.height || null };
      }).sort((a, b) => (a.date || 0) - (b.date || 0));

      const out = { items, username: job.user };
      await setKey('stories:' + job.user, out, TTL);
      await delKey('sjob:' + run);
      if (!items.length) { await decr(job.limitKey); return json(200, { status: 'failed', error: NONE }); }
      const pick = job.id ? { wanted: true, selected: items.findIndex(it => it.id && it.id === job.id) } : {};
      return json(200, { status: 'done', ...out, ...pick, cached: false, remaining: Math.max(0, LIMIT - (await count(job.limitKey))) });
    } catch (e) {
      return json(200, { status: 'working' }); // transient Apify/network hiccup: let the client keep polling
    }
  }

  // ---------- start ----------
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const inp = parseInput(body.username);
  if (inp.highlight) return json(400, { error: 'Highlight links are not supported. Paste the username to see active stories.' });
  const user = inp.user;
  if (!user) return json(400, { error: 'Type a valid Instagram username, like natgeo.' });
  const pick = d => (inp.id ? { wanted: true, selected: d.items.findIndex(it => it.id && it.id === inp.id) } : {});

  const ip = event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const limitKey = `lim:${day}:${ip}`;

  const hit = await getKey('stories:' + user);
  if (hit) {
    if (!hit.items.length) return json(404, { error: NONE });
    return json(200, { status: 'done', ...hit, ...pick(hit), cached: true, remaining: Math.max(0, LIMIT - (await count(limitKey))) });
  }

  const used = await incr(limitKey, 86400);
  if (used > LIMIT) { await decr(limitKey); return json(429, { error: `Daily free limit of ${LIMIT} reached. Come back tomorrow or upgrade.`, limit: true }); }

  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${process.env.APIFY_TOKEN}&timeout=90&maxTotalChargeUsd=${encodeURIComponent(MAX_USD)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user }),
    });
    if (!r.ok) throw new Error('apify ' + r.status);
    const run = ((await r.json()).data || {}).id;
    if (!run) throw new Error('no run id');
    await setKey('sjob:' + run, { limitKey, user, id: inp.id || '' }, 300);
    return json(200, { run, username: user, remaining: Math.max(0, LIMIT - used) });
  } catch (e) {
    await decr(limitKey);
    return json(502, { error: 'Could not load stories right now. Try again in a moment.' });
  }
};
