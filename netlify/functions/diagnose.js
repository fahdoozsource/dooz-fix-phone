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
- اتكلم بالعامية المصرية البسيطة زي فني حقيقي، من غير عناوين ولا رموز ولا نجوم.
- اكتب بإملاء سليم وحروف صحيحة وكلمات مفهومة، وراجع كلامك قبل ما تبعته، ومتكتبش كلمات مقطوعة أو مكررة أو فيها حروف غلط.
- ردودك قصيرة: من ٣ لـ ٥ سطور بالكتير.
- في أول رد: اذكر أقرب سببين أو تلاتة للعطل بالاختصار، وبعدها اسأل سؤال واحد بس يقربك من السبب الحقيقي.
- في كل رد بعد كده: استنتج من إجابة العميل، استبعد أو أكد سبب، وبعدها اسأل سؤال واحد تاني لو لسه محتاج.
- اسأل أسئلة فني فعلًا: الشاشة أو القطعة اللي اتغيرت أصلية ولا كوبي؟ العطل بدأ إمتى؟ جربت إيه قبل كده؟ وقع منه أو دخله مية؟ الشاحن والكابل أصليين؟
- لما توصل لتشخيص واضح: قول السبب المرجح، الحل خطوة بخطوة، وهل ينفع يتصلح في البيت ولا لازم ورشة، والتكلفة التقريبية بالجنيه المصري، ومدى خطورة العطل.
- لو العميل بعت صورة: حللها بدقة، اقرأ أي رسالة خطأ أو كود ظاهر فيها، وقوله المشكلة إيه والحل إيه بخطوات واضحة. لو الصورة مش واضحة اطلب منه يصورها تاني.
- لو الحل في إعدادات الجهاز: اشرح المسار بالظبط بالترتيب، مثلًا: افتح الإعدادات، بعدين البطارية، بعدين وضع توفير الطاقة. وراعي إن أسماء القوائم بتختلف حسب الماركة وإصدار النظام.
- لو الحل محتاج فتح الجهاز أو لحام في البوردة: اشرح مكان العطل بالكلام بوضوح، ونبّه إن دا شغل ورش متخصصة.
- متخترعش معلومات. لو مش متأكد قول إنك مش متأكد.
- متقولش إنك ذكاء اصطناعي ومتكررش كلام قلته قبل كده.
`;

  const history = (messages || []).map(m => {
    const parts = [];
    if (m.text) parts.push({ text: m.text });
    if (m.image && m.image.data) {
      parts.push({ inlineData: { mimeType: m.image.mimeType || 'image/jpeg', data: m.image.data } });
    }
    if (parts.length === 0) parts.push({ text: ' ' });
    return { role: m.role === 'user' ? 'user' : 'model', parts };
  });

  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=' + KEY,
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
      : 'معنديش إجابة دلوقتي، جرب تاني.';

    return { statusCode: 200, body: JSON.stringify({ answer }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'حصل خطأ في السيرفر' }) };
  }
};
