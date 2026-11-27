const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
const MAX_USER_MESSAGES = 11; // الرسالة الأولى + 10 رسائل متابعة
const MAX_IMAGES_PER_SESSION = 5;
const MAX_TEXT_LENGTH = 2000;

function sanitizeBase64(data) {
  if (typeof data !== 'string') return '';
  const trimmed = data.trim();
  if (!trimmed) return '';
  const cleaned = trimmed.includes(',') ? trimmed.split(',')[1] : trimmed;
  return cleaned.replace(/\s+/g, '');
}

function getSafeMimeType(mimeType) {
  if (typeof mimeType !== 'string') return 'image/jpeg';
  const normalized = mimeType.trim().toLowerCase();
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  return allowed.includes(normalized)
    ? normalized === 'image/jpg'
      ? 'image/jpeg'
      : normalized
    : 'image/jpeg';
}

async function callGemini(KEY, body) {
  let lastError = 'حصلت مشكلة مؤقتة في الاتصال، جرب تاني بعد شوية.';

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

        const apiMessage =
          json && json.error && typeof json.error.message === 'string'
            ? json.error.message
            : 'خطأ من خدمة الذكاء الاصطناعي';

        lastError = '[' + model + ' / ' + res.status + '] ' + apiMessage;

        // لو النموذج غير متاح في المسار الحالي ننتقل للنموذج اللي بعده فوراً
        if (res.status === 404) {
          break;
        }

        // إعادة المحاولة فقط في حالة الضغط أو الأعطال المؤقتة
        const isTemporary = res.status >= 500 || res.status === 429;
        if (!isTemporary) {
          return { ok: false, error: lastError };
        }
      } catch (_) {
        lastError = 'تعذر الاتصال بالخدمة، تأكد من اتصالك بالإنترنت وجرب تاني.';
      }

      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
      }
    }
  }

  return { ok: false, error: lastError };
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'مفتاح GEMINI_API_KEY غير مضبوط في إعدادات البيئة على Netlify.'
      })
    };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (_) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'صيغة البيانات المرسلة غير صحيحة.' })
    };
  }

  const brand = String(data.brand || 'غير محدد').slice(0, 80).trim() || 'غير محدد';
  const modelName = String(data.model || 'غير محدد').slice(0, 100).trim() || 'غير محدد';
  const os = String(data.os || 'غير محدد').slice(0, 80).trim() || 'غير محدد';
  const fault = String(data.fault || 'غير محدد').slice(0, 120).trim() || 'غير محدد';
  const rawMessages = Array.isArray(data.messages) ? data.messages : [];

  const userMessages = rawMessages.filter((m) => m && typeof m === 'object' && m.role === 'user');
  const userCount = userMessages.length;

  if (userCount > MAX_USER_MESSAGES) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer: 'خلصت المحادثة في الجلسة دي، تقدر تبدأ تشخيص جديد لأي مشكلة تانية.',
        ended: true
      })
    };
  }

  let imageCount = 0;
  for (const m of userMessages) {
    if (m.media && sanitizeBase64(m.media.data)) {
      imageCount++;
    }
  }

  if (imageCount > MAX_IMAGES_PER_SESSION) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer:
          'وصلت للحد الأقصى لعدد الصور المسموح بيها في الجلسة دي، كمل وصفك بالكلام أو ابدأ تشخيص جديد.',
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

  const history = rawMessages
    .filter((m) => m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant' || m.role === 'model'))
    .map((m) => {
      const parts = [];
      const text = typeof m.text === 'string' ? m.text.slice(0, MAX_TEXT_LENGTH).trim() : '';

      if (text) {
        parts.push({ text });
      }

      if (m.role === 'user' && m.media && typeof m.media === 'object') {
        const base64Data = sanitizeBase64(m.media.data);
        if (base64Data) {
          parts.push({
            inlineData: {
              mimeType: getSafeMimeType(m.media.mimeType),
              data: base64Data
            }
          });
        }
      }

      if (parts.length === 0) {
        parts.push({ text: 'متابعة' });
      }

      return {
        role: m.role === 'user' ? 'user' : 'model',
        parts
      };
    });

  if (history.length === 0) {
    history.push({
      role: 'user',
      parts: [{ text: `مشكلة في جهاز ${brand} ${modelName} بخصوص: ${fault}` }]
    });
  }

  const result = await callGemini(KEY, {
    systemInstruction: { parts: [{ text: system }] },
    contents: history
  });

  if (!result.ok) {
    return {
      statusCode: 500,
      headers,
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
    headers,
    body: JSON.stringify({ answer, ended })
  };
};
