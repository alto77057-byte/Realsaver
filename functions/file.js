// Netlify function: GET /api/file?u=<media url>&n=<name>&dl=1 -> redirects to the CDN file (no bandwidth used)
exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const u = new URL(q.u);
    if (!/(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname)) return { statusCode: 400, body: 'Bad host' };
    if (q.dl === '1') u.searchParams.set('dl', '1');
    return { statusCode: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store' }, body: '' };
  } catch { return { statusCode: 400, body: 'Bad request' }; }
};
