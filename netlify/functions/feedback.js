// دالة استقبال الاقتراحات والموديلات الناقصة والمشاكل غير المحلولة
// بتحفظهم في Netlify Forms (تشوفهم من لوحة نيتلفاي > Forms)
// ولو فشل، بتحفظ نسخة احتياطية في Netlify Blobs
const { connectLambda, getStore } = require('@netlify/blobs');

const ALLOWED_TYPES = new Set(['suggestion', 'missing-model', 'unsolved']);

function clip(v, n) {
  return String(v == null ? '' : v).trim().slice(0, n);
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'تعذر الإرسال' });
  }

  let data = {};
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'تعذر الإرسال' });
  }

  const type = clip(data.type, 30);
  if (!ALLOWED_TYPES.has(type)) {
    return json(400, { error: 'تعذر الإرسال' });
  }

  const entry = {
    type,
    brand: clip(data.brand, 80),
    model: clip(data.model, 100),
    contact: clip(data.contact, 200),
    message: clip(data.message, 2000),
    conversation: clip(data.conversation, 6000)
  };

  // لازم يكون فيه محتوى فعلي
  if (!entry.message && !entry.model && !entry.conversation) {
    return json(400, { error: 'اكتب البيانات المطلوبة أولًا.' });
  }

  // ===== 1) Netlify Forms =====
  let savedToForms = false;
  try {
    const host = (event.headers && (event.headers['x-forwarded-host'] || event.headers.host)) || '';
    const siteUrl = process.env.URL || (host ? 'https://' + host : '');

    if (siteUrl) {
      const form = new URLSearchParams();
      form.set('form-name', 'feedback');
      Object.keys(entry).forEach((k) => form.set(k, entry[k]));

      const res = await fetch(siteUrl + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(8000)
      });
      savedToForms = res.ok || (res.status >= 300 && res.status < 400);
    }
  } catch (e) {
    savedToForms = false;
  }

  // ===== 2) نسخة احتياطية في Blobs (لو Forms فشل) =====
  if (!savedToForms) {
    try {
      connectLambda(event);
      const store = getStore('feedback');
      const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      await store.setJSON(id, Object.assign({}, entry, { at: Date.now() }));
      return json(200, { ok: true, backup: true });
    } catch (e) {
      return json(500, { error: 'تعذر الإرسال' });
    }
  }

  return json(200, { ok: true });
};
