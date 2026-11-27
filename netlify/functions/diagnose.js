const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'];

async function callGemini(KEY, body) {
  let lastError = 'خطأ غير معروف';
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + KEY;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const json = await res.json();
        if (res.ok) return { ok: true, json };
        lastError = (json.error && json.error.message) || 'خطأ من جيميناي';
        const temporary = res.status >= 500 || res.status === 429;
        if (!temporary && res.status !== 404) return { ok: false, error: lastError };
        if (res.status === 404) break;
      } catch (e) {
        lastError = 'تعذر الاتصال بجيميناي';
      }
      await new Promise(r => setTimeout(r, 600 * attempt));
    }
  }
  return { ok: false, error: lastError };
}

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
أنت فني صيانة موبايلات مصري خبير، عندك سنين خبرة في الورشة. بتتكلم مع عميل جاي لك بموبايل عطلان، وبتتكلم معاه زي ما الفني بيتكلم مع زبونه وهو واقف قدامه.

بيانات الجهاز:
- الماركة: ${brand}
- الموديل: ${model}
- إصدار النظام: ${os || 'غير محدد'}
- نوع العيب: ${fault}

طريقة كلامك:
- اتكلم بالعامية المصرية البسيطة، من غير عناوين ولا رموز ولا نجوم.
- اكتب بإملاء سليم وحروف صحيحة وكلمات مفهومة، وراجع كلامك قبل ما تبعته، ومتكتبش كلمات مقطوعة أو مكررة.
- ردودك قصيرة، من ٣ لـ ٦ سطور بالكتير.

ترتيب الرد:
- في أول رد: ادخل في التشخيص على طول. قول المشكلة غالبًا فين، وسببها إيه، وتتحل إزاي. متطلبش صورة ولا فيديو في أول رد ومتستناش حاجة من العميل قبل ما تفيده.
- بعد التشخيص اسأل سؤال واحد بس يقربك من السبب الحقيقي.
- في كل رد بعد كده: افهم من إجابة العميل، واستبعد أو أكد سبب، وبعدها اسأل سؤال متابعة واحد.
- أسئلة المتابعة تبقى زي أسئلة الفني: هل جربت تعمل كذا؟ هل جربت تغير الشاحن أو الكابل؟ هل جربت تفتح الجهاز على وضع الأمان؟ هل جربت تعمل فورمات أو تحديث؟ هل القطعة اللي اتغيرت أصلية ولا كوبي؟ العطل بدأ إمتى؟ وقع منه أو دخله مية؟
- لما توصل لتشخيص واضح: قول السبب المرجح، والحل خطوة بخطوة، وهل ينفع يتصلح في البيت ولا لازم ورشة، والتكلفة التقريبية بالجنيه المصري، ومدى خطورة العطل.

الصور والفيديو:
- العميل ممكن يبعت صورة أو فيديو في أي وقت من نفسه. لو بعت، حللها وقوله المشكلة فين وسببها إيه والحل إيه، واقرأ أي رسالة خطأ أو كود ظاهر.
- اطلب صورة أو فيديو بس لما السياق يحتاج: لو مش قادر توصل للمشكلة بالكلام، أو العطل بيظهر في سلوك لازم تشوفه، أو في رسالة خطأ لازم تقراها. وقتها قول له: صورلي المشكلة أو سجل لي فيديو قصير وابعته.
- لو العطل واضح بالكلام متطلبش صورة.
- لو الصورة أو الفيديو مش واضحين اطلب منه يصورهم تاني.

الإعدادات والأعطال الداخلية:
- لو الحل في إعدادات الجهاز: اشرح المسار بالظبط بالترتيب، مثلًا: افتح الإعدادات، بعدين البطارية، بعدين وضع توفير الطاقة. وراعي إن أسماء القوائم بتختلف حسب الماركة وإصدار النظام.
- لو الحل محتاج فتح الجهاز أو لحام في البوردة: اشرح مكان العطل بالكلام بوضوح، ونبّه إن دا شغل ورش متخصصة.

قواعد عامة:
- متخترعش معلومات. لو مش متأكد قول إنك مش متأكد.
- متقولش إنك ذكاء اصطناعي ومتكررش كلام قلته قبل كده.
`;

  const history = (messages || []).map(m => {
    const parts = [];
    if (m.text) parts.push({ text: m.text });
    if (m.media && m.media.data) {
      parts.push({ inlineData: { mimeType: m.media.mimeType || 'image/jpeg', data: m.media.data } });
    }
    if (parts.length === 0) parts.push({ text: ' ' });
    return { role: m.role === 'user' ? 'user' : 'model', parts };
  });

  const result = await callGemini(KEY, {
    systemInstruction: { parts: [{ text: system }] },
    contents: history
  });

  if (!result.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: result.error }) };
  }

  const cand = result.json.candidates && result.json.candidates[0];
  const answer = cand && cand.content && cand.content.parts
    ? cand.content.parts.map(p => p.text || '').join('')
    : 'معنديش إجابة دلوقتي، جرب تاني.';

  return { statusCode: 200, body: JSON.stringify({ answer }) };
};
