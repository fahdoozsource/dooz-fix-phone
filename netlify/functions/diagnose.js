const MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.7-flash'];
const MAX_USER_MESSAGES = 11; // الرسالة الأولى + 10 رسائل متابعة
const MAX_IMAGES_PER_SESSION = 5;
const MAX_TEXT_LENGTH = 2000;

function sanitizeBase64(data) {
  if (typeof data !== 'string') return '';
  const cleaned = data.includes(',') ? data.split(',')[1] : data;
  return cleaned.trim();
}

async function callGemini(KEY, body) {
  let lastError = 'خطأ غير معروف';
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const url =
          'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(model) +
          ':generateContent?key=' +
          encodeURIComponent(KEY);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        let json = {};
        try {
          json = await res.json();
        } catch (_) {
          json = {};
        }

        if (res.ok) {
          return { ok: true, json };
        }

        lastError =
          '[' +
          model +
          ' / ' +
          res.status +
          '] ' +
          ((json && json.error && json.error.message) || 'خطأ من جيميناي');

        if (res.status === 404) {
          break;
        }

        const temporary = res.status >= 500 || res.status === 429;
        if (!temporary) {
          return { ok: false, error: lastError };
        }
      } catch (e) {
        lastError = 'تعذر الاتصال بجيميناي';
      }

      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  return { ok: false, error: lastError };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'مفتاح جيميناي غير مضاف في إعدادات نيتلفاي' })
    };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'بيانات غير صحيحة' })
    };
  }

  const brand = String(data.brand || 'غير محدد').slice(0, 80);
  const modelName = String(data.model || 'غير محدد').slice(0, 100);
  const os = String(data.os || 'غير محدد').slice(0, 80);
  const fault = String(data.fault || 'غير محدد').slice(0, 120);
  const rawMessages = Array.isArray(data.messages) ? data.messages : [];

  const userMessages = rawMessages.filter((m) => m && m.role === 'user');
  const userCount = userMessages.length;

  if (userCount > MAX_USER_MESSAGES) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'خلصت المحادثة.', ended: true })
    };
  }

  let imageCount = 0;
  for (const m of userMessages) {
    if (m.media && m.media.data) imageCount++;
  }
  if (imageCount > MAX_IMAGES_PER_SESSION) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer: 'وصلت للحد الأقصى للصور في الجلسة دي، كمل وصفك بالكلام أو ابدأ تشخيص جديد.',
        ended: false
      })
    };
  }

  const system = `
أنت فني صيانة موبايلات مصري خبير، عندك سنين خبرة في الورشة. بتتكلم مع عميل جاي لك بموبايل عطلان، وبتتكلم معاه زي ما الفني بيتكلم مع زبونه وهو واقف قدامه.

بيانات الجهاز:
- الماركة: ${brand}
- الموديل: ${modelName}
- إصدار النظام: ${os}
- نوع العيب: ${fault}

طريقة كلامك:
- الكلام بالعامية المصرية البسيطة، من غير عناوين ولا رموز ولا نجوم ولا قوائم نقطية.
- اكتب بإملاء سليم وحروف صحيحة وكلمات مفهومة، وماتكتبش كلمات مقطوعة أو مكررة.
- ردودك قصيرة، من ٣ لـ ٦ سطور بالكتير.

ترتيب الرد:
- أول رد: ادخل في التشخيص على طول. قول المشكلة غالبًا فين، وسببها إيه، وتتحل إزاي. متطلبش صورة ولا فيديو في أول رد ومتستناش حاجة من العميل قبل ما تفيده.
- بعد التشخيص اسأل سؤال واحد بس يقربك من السبب الحقيقي.
- في كل رد بعد كده: افهم من إجابة العميل، واستبعد أو أكد سبب، وبعدها اسأل سؤال متابعة واحد.
- لما توصل لتشخيص واضح: اذكر السبب المرجح، والخطوات العملية، وهل ينفع في البيت ولا لازم ورشة، والتكلفة التقريبية بالجنيه المصري، ومدى خطورة العطل باختصار شديد جوه نفس الرد القصير.

الصور والفيديو:
- العميل ممكن يبعت صورة في أي وقت من نفسه. لو بعت، حللها وقوله المشكلة فين وسببها إيه والحل إيه، واقرأ أي رسالة خطأ أو كود ظاهر.
- لو مش قادر توصل للمشكلة بالكلام، أو في رسالة خطأ بتظهر في سلوك لازم تشوفه، وقتها قول له يصور فيديو قصير أو صورة أوضح.
- لو العطل واضح بالكلام متطلبش صورة.
- لو الصورة مش واضحة اطلب منه يصورها تاني بوضوح.

الإعدادات والأعطال الداخلية:
- اشرح المسار بالترتيب، مثلا: افتح الإعدادات، بعدين البطارية، بعدين وضع توفير الطاقة. وراعي إن أسماء القوائم بتختلف حسب الماركة وإصدار النظام.
- لو الحل محتاج فتح الجهاز أو لحام في البوردة: اشرح مكان العطل بالكلام بوضوح، ونبه إن ده شغل ورش متخصصة.

قواعد عامة:
- متخترعش معلومات. لو مش متأكد قول إنك مش متأكد.
- متقولش إنك ذكاء اصطناعي ومتكررش كلام قلته قبل كده.
`.trim();

  const history = rawMessages.map((m) => {
    const parts = [];
    const text = typeof m.text === 'string' ? m.text.slice(0, MAX_TEXT_LENGTH).trim() : '';
    if (text) {
      parts.push({ text });
    }

    const base64Data = m.media && m.media.data ? sanitizeBase64(m.media.data) : '';
    if (base64Data) {
      const mimeType =
        m.media && typeof m.media.mimeType === 'string' && m.media.mimeType.startsWith('image/')
          ? m.media.mimeType
          : 'image/jpeg';
      parts.push({
        inlineData: {
          mimeType,
          data: base64Data
        }
      });
    }

    if (parts.length === 0) {
      parts.push({ text: ' ' });
    }

    return {
      role: m.role === 'user' ? 'user' : 'model',
      parts
    };
  });

  const result = await callGemini(KEY, {
    systemInstruction: { parts: [{ text: system }] },
    contents: history
  });

  if (!result.ok) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: result.error })
    };
  }

  const cand = result.json && result.json.candidates && result.json.candidates[0];
  const answer =
    cand && cand.content && Array.isArray(cand.content.parts)
      ? cand.content.parts
          .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
          .join('')
          .trim() || 'معنديش إجابة دلوقتي، جرب تاني.'
      : 'معنديش إجابة دلوقتي، جرب تاني.';

  const ended = userCount >= MAX_USER_MESSAGES;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer, ended })
  };
};
