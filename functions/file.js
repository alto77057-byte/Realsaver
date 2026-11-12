// Netlify function: GET /api/file?u=<media url>&n=<name>&dl=1 -> redirects to the CDN file (no bandwidth used)
const ALLOWED = [
  'cdninstagram.com', 'fbcdn.net',                 // Instagram, and Facebook's own CDN
  'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokv.com', 'ibyteimg.com', 'tikwm.com', // TikTok (direct + free resolver)
  'twimg.com',                                     // X / Twitter's own CDN (video.twimg.com, pbs.twimg.com)
  'apify.com',                                     // Apify-hosted fallback files (e.g. the Facebook downloader)
];
const okHost = h => ALLOWED.some(d => h === d || h.endsWith('.' + d));

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const u = new URL(q.u);
    if (!okHost(u.hostname)) return { statusCode: 400, body: 'Bad host' };
    if (q.dl === '1') {
      u.searchParams.set('dl', '1');                         // Instagram/Facebook CDN convention
      if (/(^|\.)apify\.com$/.test(u.hostname)) u.searchParams.set('attachment', 'true'); // Apify's own convention
    }
    return { statusCode: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store' }, body: '' };
  } catch { return { statusCode: 400, body: 'Bad request' }; }
};
