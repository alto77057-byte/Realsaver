// Netlify function: /api/download  (Instagram, Facebook and TikTok, one endpoint)
//   POST { url }   -> free method succeeds: full result immediately
//                   -> needs Apify: { run, url, platform, remaining } to poll
//   GET  ?run=ID    -> { status:'working' } | { status:'done', ...result } | { status:'failed', error }
// Env: APIFY_TOKEN, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
// Optional actors:  APIFY_ACTOR (default apify~instagram-scraper)
//                   FB_ACTOR    (default memo23~facebook-video-downloader)   — only used if the free Facebook method fails
//                   TT_ACTOR    (default mu0i~tiktok-video-downloader)       — only used if the free TikTok method fails
// Optional limits:  FREE_DAILY_LIMIT (default 5), CACHE_TTL (default 3600),
//                   DOWNLOAD_MAX_USD (default 0.05), FB_MAX_USD (default 0.08), TT_MAX_USD (default 0.03)
const ACTOR = process.env.APIFY_ACTOR || 'apify~instagram-scraper';
const FB_ACTOR = process.env.FB_ACTOR || 'memo23~facebook-video-downloader';
const TT_ACTOR = process.env.TT_ACTOR || 'mu0i~tiktok-video-downloader';
const TW_ACTOR = process.env.TW_ACTOR || 'api402~x-twitter-media-downloader';
const LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || '5', 10);
const TTL = parseInt(process.env.CACHE_TTL || '3600', 10); // media links expire, keep short
const MAX_USD = process.env.DOWNLOAD_MAX_USD || '0.05';
const FB_MAX_USD = process.env.FB_MAX_USD || '0.08';
const TT_MAX_USD = process.env.TT_MAX_USD || '0.03';
const TW_MAX_USD = process.env.TW_MAX_USD || '0.01';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
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
async function fetchT(url, opts, ms) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 8000);
  try { return await fetch(url, Object.assign({}, opts, { signal: c.signal })); } finally { clearTimeout(t); }
}

// ---------- Instagram ----------
function normalizeIG(input) {
  try {
    const u = new URL(String(input).trim());
    if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    return m ? `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/` : null;
  } catch { return null; }
}
function shapeIG(d) {
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

// ---------- Facebook ----------
const FB_HOSTS = /(^|\.)(facebook\.com|fb\.watch|fb\.com|fb\.me)$/;
function normalizeFB(input) {
  try { const u = new URL(String(input).trim()); return FB_HOSTS.test(u.hostname) ? u.toString() : null; } catch { return null; }
}
function shapeFB(d) {
  if (!d || !d.downloadUrl) return { items: [], caption: '', hashtags: [], owner: '' };
  return {
    items: [{ type: 'video', url: d.downloadUrl, thumb: d.thumbnailUrl || '' }],
    caption: d.title || '', hashtags: [], owner: d.ownerName || '',
    meta: { w: null, h: null, dur: d.durationSec || null, plays: d.viewCount || null },
  };
}
// Facebook's own video embed page often ships the real file URL in the HTML, with no browser needed.
// Works for many public videos/reels; when it doesn't, the caller falls back to Apify.
async function freeFacebook(url) {
  const embed = 'https://www.facebook.com/plugins/video.php?href=' + encodeURIComponent(url) + '&show_text=false';
  const r = await fetchT(embed, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } }, 8000);
  if (!r.ok) return null;
  const html = await r.text();
  const hd = html.match(/"browser_native_hd_url":"([^"]*)"/);
  const sd = html.match(/"browser_native_sd_url":"([^"]*)"/);
  const raw = (hd && hd[1]) || (sd && sd[1]) || '';
  if (!raw) return null;
  let videoUrl; try { videoUrl = JSON.parse('"' + raw + '"'); } catch { return null; }
  if (!/^https?:\/\//.test(videoUrl)) return null;
  const title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '').replace(/\s*\|\s*Facebook\s*$/i, '').trim();
  return { items: [{ type: 'video', url: videoUrl, thumb: '' }], caption: title, hashtags: [], owner: '' };
}

// ---------- TikTok ----------
const TT_HOSTS = /(^|\.)(tiktok\.com)$/;
function normalizeTT(input) {
  try { const u = new URL(String(input).trim()); return TT_HOSTS.test(u.hostname) ? u.toString() : null; } catch { return null; }
}
function shapeTT(d) {
  if (!d) return { items: [], caption: '', hashtags: [], owner: '' };
  const url = d.play || d.hdplay || d.wmplay;
  if (!url) return { items: [], caption: '', hashtags: [], owner: '' };
  const caption = d.title || d.description || '';
  return {
    items: [{ type: 'video', url, thumb: d.cover || '' }],
    caption, hashtags: (caption.match(/#[\p{L}\p{N}_]+/gu) || []),
    owner: (d.author && (d.author.unique_id || d.author.uniqueId)) || d.authorUniqueId || '',
    meta: { w: null, h: null, dur: d.duration || null, plays: d.play_count || null },
  };
}
// A long-standing free public resolver. No Apify, no browser. Falls back to Apify on failure.
async function freeTikTok(url) {
  const r = await fetchT('https://www.tikwm.com/api/?url=' + encodeURIComponent(url) + '&hd=1', { headers: { 'User-Agent': UA } }, 8000);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || j.code !== 0 || !j.data) return null;
  return shapeTT(j.data);
}

// ---------- Twitter / X ----------
const TW_HOSTS = /(^|\.)(twitter\.com|x\.com)$/;
function normalizeTW(input) {
  try {
    const u = new URL(String(input).trim());
    return TW_HOSTS.test(u.hostname) && /\/status(es)?\/\d+/.test(u.pathname) ? u.toString() : null;
  } catch { return null; }
}
function tweetId(url) { const m = String(url).match(/\/status(?:es)?\/(\d+)/); return m ? m[1] : null; }
function shapeTWJson(d) {
  // d is the syndication API's tweet JSON
  const items = [];
  const media = (d.mediaDetails || []);
  media.forEach(m => {
    if (m.type === 'photo') { items.push({ type: 'image', url: m.media_url_https, thumb: m.media_url_https }); return; }
    const variants = (m.video_info && m.video_info.variants || []).filter(v => v.content_type === 'video/mp4' && v.bitrate);
    if (!variants.length) return;
    variants.sort((a, b) => b.bitrate - a.bitrate);
    items.push({ type: 'video', url: variants[0].url, thumb: m.media_url_https || '' });
  });
  const caption = d.text || d.full_text || '';
  return { items, caption, hashtags: (caption.match(/#[\p{L}\p{N}_]+/gu) || []), owner: (d.user && d.user.screen_name) || '' };
}
function shapeTWApify(d) {
  if (!d || !d.media || !d.media.length) return { items: [], caption: '', hashtags: [], owner: '' };
  const items = d.media.map(m => ({ type: m.type === 'video' ? 'video' : 'image', url: m.url, thumb: m.thumbnail_url || m.url }));
  const caption = d.text || '';
  return { items, caption, hashtags: (caption.match(/#[\p{L}\p{N}_]+/gu) || []), owner: '' };
}
// X's own public syndication endpoint (what embedded tweets use). No login, no browser, no Apify.
async function freeTwitter(url) {
  const id = tweetId(url); if (!id) return null;
  const token = Math.floor(Math.random() * 1e9).toString(36);
  const r = await fetchT(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`, { headers: { 'User-Agent': UA } }, 8000);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || j.__typename === 'TweetTombstone' || !j.id_str) return null;
  return shapeTWJson(j);
}

const DL_TOKEN = process.env.APIFY_DOWNLOAD_TOKEN || process.env.APIFY_TOKEN;
function withApifyAuth(out) {
  (out.items || []).forEach(it => {
    try {
      const u = new URL(it.url);
      if (/(^|\.)apify\.com$/.test(u.hostname) && !u.searchParams.has('token')) u.searchParams.set('token', DL_TOKEN);
      it.url = u.toString();
    } catch (e) {}
  });
  return out;
}
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (!process.env.APIFY_TOKEN || !R.url || !R.token) return json(503, { error: 'The download tool is not ready yet.' });

  // ---------- poll (Apify fallback jobs only — the free methods never reach this) ----------
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
      if (st.status !== 'SUCCEEDED') return await fail('The video site did not respond in time. Please try again.');

      const ir = await fetch(`https://api.apify.com/v2/datasets/${st.defaultDatasetId}/items?token=${process.env.APIFY_TOKEN}&format=json&clean=1&limit=1`);
      const data = await ir.json();
      const row = data && data[0];

      let out;
      if (job.platform === 'facebook') {
        if (row && row.error) return await fail('Could not read that Facebook video. It may be private, deleted, or region-locked.');
        out = row ? shapeFB(row) : null;
      } else if (job.platform === 'tiktok') {
        if (row && row.error) return await fail('Could not read that TikTok video. It may be private or deleted.');
        out = row ? shapeTT(row) : null;
      } else if (job.platform === 'twitter') {
        if (row && row.error) return await fail('Could not read that post. It may be private, deleted, or age-restricted.');
        out = row ? shapeTWApify(row) : null;
      } else {
        if (row && row.error) return await fail('Instagram blocked this request just now. Please try again in a minute.');
        out = row ? shapeIG(row) : null;
      }
      if (!out || !out.items.length) return await fail('No media found. The post may be private or deleted.');
      out = withApifyAuth(out);

      await setKey('post:' + job.url, out, TTL);
      await delKey('djob:' + run);
      return json(200, { status: 'done', ...out, platform: job.platform, cached: false, remaining: Math.max(0, LIMIT - (await count(job.limitKey))) });
    } catch (e) {
      return json(200, { status: 'working' }); // transient Apify/network hiccup: let the client keep polling
    }
  }

  // ---------- start ----------
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const raw = String(body.url || '').trim();

  let platform = null, url = null;
  if ((url = normalizeIG(raw))) platform = 'instagram';
  else if ((url = normalizeFB(raw))) platform = 'facebook';
  else if ((url = normalizeTT(raw))) platform = 'tiktok';
  else if ((url = normalizeTW(raw))) platform = 'twitter';
  if (!url) return json(400, { error: 'Paste a public Instagram, Facebook, TikTok or X/Twitter link.' });

  const ip = event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const limitKey = `lim:${day}:${ip}`;

  const hit = await getKey('post:' + url);
  if (hit) return json(200, { status: 'done', ...hit, platform, cached: true, remaining: Math.max(0, LIMIT - (await count(limitKey))) });

  const used = await incr(limitKey, 86400);
  if (used > LIMIT) { await decr(limitKey); return json(429, { error: `Daily free limit of ${LIMIT} reached. Come back tomorrow or upgrade.`, limit: true }); }
  const remaining = Math.max(0, LIMIT - used);

  // ---- free, no-Apify methods first ----
  try {
    if (platform === 'facebook') {
      const out = await freeFacebook(url);
      if (out && out.items.length) { await setKey('post:' + url, out, TTL); return json(200, { status: 'done', ...out, platform, cached: false, remaining }); }
    } else if (platform === 'tiktok') {
      const out = await freeTikTok(url);
      if (out && out.items.length) { await setKey('post:' + url, out, TTL); return json(200, { status: 'done', ...out, platform, cached: false, remaining }); }
    } else if (platform === 'twitter') {
      const out = await freeTwitter(url);
      if (out && out.items.length) { await setKey('post:' + url, out, TTL); return json(200, { status: 'done', ...out, platform, cached: false, remaining }); }
    }
  } catch (e) { /* fall through to Apify below */ }

  // ---- Apify fallback (always used for Instagram; used for Facebook/TikTok only if the free method failed) ----
  const actor = platform === 'facebook' ? FB_ACTOR : platform === 'tiktok' ? TT_ACTOR : platform === 'twitter' ? TW_ACTOR : ACTOR;
  const maxUsd = platform === 'facebook' ? FB_MAX_USD : platform === 'tiktok' ? TT_MAX_USD : platform === 'twitter' ? TW_MAX_USD : MAX_USD;
  const input = platform === 'facebook' ? { videoUrls: [url], metadataOnly: false }
    : platform === 'tiktok' ? { urls: [url] }
    : platform === 'twitter' ? { tweetUrls: [url] }
    : { directUrls: [url], resultsType: 'posts', resultsLimit: 1, addParentData: false };

  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?token=${process.env.APIFY_TOKEN}&timeout=90&maxTotalChargeUsd=${encodeURIComponent(maxUsd)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!r.ok) throw new Error('apify ' + r.status);
    const run = ((await r.json()).data || {}).id;
    if (!run) throw new Error('no run id');
    await setKey('djob:' + run, { limitKey, url, platform }, 300);
    return json(200, { run, url, platform, remaining });
  } catch (e) {
    await decr(limitKey);
    return json(502, { error: 'Could not start this download. Try again in a moment.' });
  }
};
