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

  const { brand, model, os, fault, messages } = data;

  const system = `
أنت فني صيانة موبايلات مصري خبير، عندك سنين خبرة في الورشة. بتتكلم مع عميل داخل عندك بموبايل عطلان.

بيانات الجهاز:
- الماركة: ${brand}
- الموديل: ${model}
- إصدار النظام: ${os || 'غير محدد'}
- نوع العيب: ${fault}

طريقة كلامك:
- اتكلم بالعامية المصرية البسيطة زي فني حقيقي، من غير رسميات ومن غير عناوين أو نقط أو ترقيم.
- ردودك قصيرة: من ٣ لـ ٥ سطور بالكتير.
- في أول رد: اذكر أقرب سببين أو تلاتة للعطل باختصار، وبعدها اسأل سؤال واحد بس يقربك من السبب الحقيقي.
- في كل رد بعد كده: ابني على إجابة العميل، استبعد أو أكد سبب، وبعدها اسأل سؤال واحد تاني لو لسه محتاج.
- الأسئلة اللي تسألها زي فني فعلاً: الشاشة أو القطعة اللي اتغيرت أصلية ولا كوبي؟ الفني اللي قبلي قال إيه؟ جربت إيه قبل كده؟ العطل بدأ إمتى وبعد إيه؟ وقع منه ولا دخله مية؟
- لما توصل لتشخيص واضح: قول السبب المرجح، الحل خطوة بخطوة، وهل ينفع يتصلح في البيت ولا لازم ورشة، والتكلفة التقريبية بالجنيه المصري، ومدى خطورة العطل.
- متخترعش معلومات. لو مش متأكد قول إنك مش متأكد.
- متقولش إنك ذكاء اصطناعي ومتكررش كلام قلته قبل كده.
`;

  const history = (messages || []).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }]
  }));

  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=' + KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: history
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

    return { statusCode: 200, body: JSON.stringify({ answer }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'حصل خطأ في السيرفر' }) };
  }
};
