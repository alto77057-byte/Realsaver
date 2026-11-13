// Netlify Function (v2, streaming): GET /api/file?u=<media url>&n=<name>&dl=1
//   Most hosts: 302 redirect straight to the CDN file (no bandwidth used, no size limit).
//   X/Twitter's video CDN (twimg.com) blocks a plain redirect because it requires a
//   twitter.com/x.com referer that a browser's follow-up request won't carry — so for
//   that host only, this function fetches the file itself and STREAMS it straight through
//   (no buffering, no base64), so there's no practical size limit on the video itself.
const ALLOWED = [
  'cdninstagram.com', 'fbcdn.net',                 // Instagram, and Facebook's own CDN
  'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokv.com', 'ibyteimg.com', 'tikwm.com', // TikTok (direct + free resolver)
  'twimg.com',                                     // X / Twitter's own CDN (video.twimg.com, pbs.twimg.com)
  'apify.com',                                     // Apify-hosted fallback files (e.g. the Facebook downloader)
];
const okHost = h => ALLOWED.some(d => h === d || h.endsWith('.' + d));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export default async (req) => {
  try {
    const q = new URL(req.url).searchParams;
    const raw = q.get('u');
    if (!raw) return new Response('Bad request', { status: 400 });
    const u = new URL(raw);
    if (!okHost(u.hostname)) return new Response('Bad host', { status: 400 });

    if (/(^|\.)twimg\.com$/.test(u.hostname)) {
      const r = await fetch(u.toString(), { headers: { 'User-Agent': UA, Referer: 'https://x.com/' } });
      if (!r.ok || !r.body) return new Response('Could not fetch that file from X right now.', { status: 502 });
      const headers = { 'Content-Type': r.headers.get('content-type') || 'video/mp4', 'Cache-Control': 'no-store' };
      if (q.get('dl') === '1') headers['Content-Disposition'] = `attachment; filename="${(q.get('n') || 'video.mp4').replace(/[^\w.\-]/g, '_')}"`;
      return new Response(r.body, { status: 200, headers }); // streamed straight through, not buffered
    }

    if (q.get('dl') === '1') {
      u.searchParams.set('dl', '1');                         // Instagram/Facebook CDN convention
      if (/(^|\.)apify\.com$/.test(u.hostname)) u.searchParams.set('attachment', 'true'); // Apify's own convention
    }
    return Response.redirect(u.toString(), 302);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
};
