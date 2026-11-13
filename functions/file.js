// Netlify function: GET /api/file?u=<media url>&n=<name>&dl=1
//   Most hosts: 302 redirect straight to the CDN file (no bandwidth used).
//   X/Twitter's video CDN (twimg.com) blocks a plain redirect because it requires a
//   twitter.com/x.com referer that a browser's follow-up request won't carry — so for
//   that host only, this function fetches the file itself and streams it back.
//   (Buffered: capped at ~6 MB by Netlify's response limit — fine for ordinary tweet
//   clips, but a very long/high-bitrate X video could fail here.)
const ALLOWED = [
  'cdninstagram.com', 'fbcdn.net',                 // Instagram, and Facebook's own CDN
  'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokv.com', 'ibyteimg.com', 'tikwm.com', // TikTok (direct + free resolver)
  'twimg.com',                                     // X / Twitter's own CDN (video.twimg.com, pbs.twimg.com)
  'apify.com',                                     // Apify-hosted fallback files (e.g. the Facebook downloader)
];
const okHost = h => ALLOWED.some(d => h === d || h.endsWith('.' + d));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_BYTES = 6 * 1024 * 1024;

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const u = new URL(q.u);
    if (!okHost(u.hostname)) return { statusCode: 400, body: 'Bad host' };

    if (/(^|\.)twimg\.com$/.test(u.hostname)) {
      const r = await fetch(u.toString(), { headers: { 'User-Agent': UA, Referer: 'https://x.com/' } });
      if (!r.ok) return { statusCode: 502, body: 'Could not fetch that file from X right now.' };
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) return { statusCode: 413, body: 'This video is too large to download here — try again later or ask for a smaller clip.' };
      const headers = { 'Content-Type': r.headers.get('content-type') || 'video/mp4', 'Cache-Control': 'no-store' };
      if (q.dl === '1') headers['Content-Disposition'] = `attachment; filename="${(q.n || 'video.mp4').replace(/[^\w.\-]/g, '_')}"`;
      return { statusCode: 200, headers, body: buf.toString('base64'), isBase64Encoded: true };
    }

    if (q.dl === '1') {
      u.searchParams.set('dl', '1');                         // Instagram/Facebook CDN convention
      if (/(^|\.)apify\.com$/.test(u.hostname)) u.searchParams.set('attachment', 'true'); // Apify's own convention
    }
    return { statusCode: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store' }, body: '' };
  } catch { return { statusCode: 400, body: 'Bad request' }; }
};
