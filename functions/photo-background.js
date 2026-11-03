// Netlify BACKGROUND function (the name ends in -background, so it may run for minutes): POST { id }
const R = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
async function redis(cmd) {
  const r = await fetch(R.url, { method: 'POST', headers: { Authorization: `Bearer ${R.token}` }, body: JSON.stringify(cmd) });
  return (await r.json()).result;
}
const getJ = async k => { const v = await redis(['GET', k]); return v ? JSON.parse(v) : null; };
const setJ = (k, v, ttl) => redis(['SET', k, JSON.stringify(v), 'EX', ttl]);

const BASE = "Edit this photo for a Diwali celebration. Keep the person's face, facial features, expression, skin tone, hair, body shape and pose exactly as in the original photo. Do not beautify, slim, lighten the skin or change who the person is. Keep everything respectful and modest. Do not add any text, letters or watermarks. The result must look natural, realistic and high quality. If there is no person in the photo, keep the main subject unchanged. ";
const STYLE = {
  glow: 'Style: Diwali glow portrait. Add warm golden festive lighting on the subject and a softly blurred background full of glowing diyas and fairy lights (bokeh). Keep the subject\'s own clothes.',
  diya: 'Style: Diya evening. Place the subject in a cozy evening scene beside rows of lit clay diyas on a ledge and the floor, with a warm candle-like glow and soft shadows.',
  rangoli: 'Style: Rangoli courtyard. Place the subject in a festive courtyard with a large colorful rangoli on the floor, marigold garlands, hanging lanterns and warm lights.',
  fireworks: 'Style: Fireworks night. Place the subject in front of a night sky filled with colorful fireworks, with warm festive light falling on them.',
  festive: 'Style: Traditional festive outfit. Dress the person in an elegant, modest traditional Indian festive outfit (a saree or lehenga in rich colors with gold borders) and subtle festive jewelry, in a warm Diwali setting with diyas. Keep the face, hair and pose unchanged.',
  card: 'Style: Diwali greeting card. Place the photo inside a decorative Diwali greeting-card layout with a border of marigold flowers, diyas and fairy lights, and leave a clean, plain, empty area along the bottom for text. Do NOT write any text.'
};

const GEN_BASE = 'A beautiful, respectful, wholesome portrait of a fictional adult woman in her late twenties (not a real person, not a celebrity), fully and modestly dressed. Warm, high-quality cinematic festive lighting, vibrant colors, rich detailed fabric textures, a warm and expressive face, front view, full body, sharp 4K detail. No text, letters, logos or watermarks. ';
const LOOK = {
  nepali: 'Traditional Nepali festival outfit: a richly embroidered deep red cholo blouse with intricate golden floral patterns, a dark green and black traditional embroidered waistcoat, a long flowing black ankle-length skirt decorated with red and gold ethnic geometric borders, a vibrant red patuka waist sash, layered traditional golden necklaces, small gold earrings, colorful glass bangles, a small red tika on the forehead, and black hair in two neat braids decorated with red ribbons and flowers. Authentic Nepali Himalayan cultural attire in a festive Himalayan village setting.',
  saree: 'Elegant Indian Diwali look: a royal red and gold silk saree with a rich zari border and a matching embroidered blouse, temple-style gold jewelry, a small bindi, glass bangles, and hair in a neat bun with jasmine flowers, standing among glowing diyas and marigold garlands.',
  lehenga: 'Festive lehenga look: a maroon and gold embroidered lehenga choli with a flowing dupatta, maang tikka, jhumka earrings, stacked bangles and a small bindi, hair in a soft braid with flowers, in a decorated courtyard with diyas and rangoli.',
  kashmiri: 'Traditional Kashmiri look: a long embroidered pheran in deep teal and maroon with fine golden tilla thread embroidery at the neck and cuffs, a matching headscarf, silver jewelry with large jhumka earrings, with a snowy mountain and lake backdrop at golden hour.',
  punjabi: 'Punjabi festive look: a bright yellow and pink salwar kameez with a colorful hand-embroidered phulkari dupatta, golden jhumkas, glass bangles and a paranda tassel in a long braid, in a sunny mustard-field setting.',
  arabic: 'Elegant modest Arabian festive look: an embroidered kaftan-style dress in emerald and gold with fine detailing, a matching soft headscarf and gold jewelry, in a warm lantern-lit courtyard with ornate arches.',
  bengali: 'Bengali festive look: a traditional white saree with a bright red border, a red blouse, gold jewelry, white and red shell bangles, a red bindi and long dark hair with flowers, in a festive pandal with warm lights.',
  hanbok: 'Korean hanbok look: a graceful pastel pink jeogori jacket and a flowing lavender chima skirt with delicate embroidery, hair in an elegant low bun with a decorative hairpin, in a traditional hanok courtyard at golden hour.'
};

exports.handler = async (event) => {
  let id = ''; try { id = String(JSON.parse(event.body || '{}').id || ''); } catch {}
  if (!/^[a-z0-9]{8,40}$/.test(id) || !R.url) return;
  if ((await redis(['SET', 'lock:' + id, '1', 'NX', 'EX', 900])) === null) return; // already being made
  const job = await getJ('img:' + id);
  const fail = async msg => {
    await setJ('res:' + id, { status: 'error', message: msg }, 900);
    if (job) { try { await redis(['DECR', `photo:${job.day}:${job.ip}`]); await redis(['DECR', `photo-all:${job.day}`]); } catch {} } // give the free photo back
  };
  if (!job) return setJ('res:' + id, { status: 'error', message: 'The photo expired. Please try again.' }, 900);
  const KEY = process.env.OPENAI_API_KEY;
  if (!KEY) return fail('The photo studio is not ready yet.');
  const gen = job.mode === 'generate';
  const w = job.w, h = job.h, size = gen ? '1024x1536' : h > w * 1.15 ? '1024x1536' : w > h * 1.15 ? '1536x1024' : '1024x1024';
  const bytes = gen ? null : Buffer.from(job.image.split(',')[1], 'base64');

  async function edit(withCompression) {
    if (gen) {
      const body = { model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2', prompt: GEN_BASE + (LOOK[job.look] || LOOK.nepali) + (job.extra ? ' Extra detail: ' + job.extra + '.' : ''), size, quality: process.env.PHOTO_QUALITY || 'medium', n: 1, output_format: 'jpeg' };
      if (withCompression) body.output_compression = 80;
      return fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    const fd = new FormData();
    fd.append('model', process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2');
    fd.append('prompt', BASE + (STYLE[job.style] || STYLE.glow));
    fd.append('size', size); fd.append('quality', process.env.PHOTO_QUALITY || 'medium'); fd.append('n', '1'); fd.append('output_format', 'jpeg');
    if (withCompression) fd.append('output_compression', '80');
    fd.append('image', new Blob([bytes], { type: 'image/jpeg' }), 'photo.jpg');
    return fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY }, body: fd });
  }
  try {
    let r = await edit(true), data = await r.json().catch(() => ({}));
    if (r.status === 400 && /compression/i.test(JSON.stringify(data))) { r = await edit(false); data = await r.json().catch(() => ({})); }
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || '';
      console.error('image edit error', r.status, msg.slice(0, 300));
      if (r.status === 403 || /verif/i.test(msg)) return fail('The photo studio is not unlocked on this account yet.');
      if (r.status === 429) return fail('The photo studio is busy right now. Try again in a minute.');
      if (r.status === 400 && /safety|moderation|policy/i.test(msg)) return fail("This photo can't be edited (safety rules). Try another photo.");
      return fail('Could not create the photo. Please try again.');
    }
    const b64 = data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) return fail('Could not create the photo. Please try again.');
    const mime = b64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
    const img = `data:${mime};base64,${b64}`, CH = 300000, n = Math.ceil(img.length / CH);
    for (let i = 0; i < n; i++) await redis(['SET', `resp:${id}:${i}`, img.slice(i * CH, (i + 1) * CH), 'EX', 900]);
    await setJ('res:' + id, { status: 'done', parts: n }, 900);
    await redis(['DEL', 'img:' + id]); // the uploaded photo is deleted as soon as the edit is done
  } catch (e) { console.error('photo failed', e.message); return fail('Could not create the photo. Please try again.'); }
};
  
