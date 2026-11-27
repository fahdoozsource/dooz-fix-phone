exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'مفتاح جيميناي غير مضاف في إعدادات نيتلفاي' }) };
  }

  let data;
  try { data = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'بيانات غير صحيحة' }) }; }

  const { brand, model, os, fault, desc } = data;

  const prompt = `
أنت فني صيانة هواتف خبير. المستخدم عنده مشكلة:
- الماركة: ${brand}
- الموديل: ${model}
- إصدار النظام: ${os || 'غير محدد'}
- نوع العيب: ${fault}
- الوصف: ${desc}

ابحث على الإنترنت (منتديات، يوتيوب، سوشيال ميديا، فيديوهات فنيين الصيانة) عن نفس المشكلة لنفس الموديل، وكيف حلها أصحاب الهواتف والفنيين.
لو المشكلة من إعدادات أو ميزة، اشرح المسار الدقيق للإعداد في إصدار النظام الحالي لهذا الموديل، ونبه لو المسار اتغير من إصدار أندرويد أو iOS أقدم.

أرجع الإجابة بالعربية بهذا الترتيب:
1) التشخيص الأرجح للعطل
2) حلول جربها بنفسك خطوة بخطوة
3) الحل النهائي لو الحلول المنزلية ما نفعت
4) لو العطل هاردوير: حدد مكان العطل بالظبط في الجهاز (مثلاً مكان مكون معين على البوردة) وقل للمستخدم ماذا يقول لفني الصيانة
5) تكلفة تقريبية إن أمكن ودرجة خطورة العطل

كن دقيقاً ولا تخترع معلومات، ولو مش متأكد قل ذلك.
`;

  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=' + KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }]
        })
      }
    );
    const json = await res.json();

    if (!res.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: (json.error && json.error.message) || 'خطأ من جيميناي' }) };
    }

    const cand = json.candidates && json.candidates[0];
    const answer = cand && cand.content && cand.content.parts
      ? cand.content.parts.map(p => p.text || '').join('')
      : 'ما لقيتش إجابة';

    const chunks = (cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
    const sources = chunks
      .filter(c => c.web)
      .map(c => ({ title: c.web.title, url: c.web.uri }));

    return { statusCode: 200, body: JSON.stringify({ answer, sources }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'حصل خطأ في السيرفر' }) };
  }
};
