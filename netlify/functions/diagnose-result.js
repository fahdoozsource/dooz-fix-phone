// دالة صغيرة: الصفحة تسأل بها عن نتيجة التشخيص كل كام ثانية
const { connectLambda, getStore } = require('@netlify/blobs');

function respond(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event) => {
  const id = String((event.queryStringParameters && event.queryStringParameters.id) || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    return respond(400, { status: 'error', error: 'رقم الطلب غير صحيح' });
  }

  try {
    connectLambda(event);
    const store = getStore('diagnose-jobs');
    const job = await store.get(id, { type: 'json' });
    if (!job) return respond(200, { status: 'pending' });
    return respond(200, job);
  } catch (e) {
    return respond(500, { status: 'pending' });
  }
};
