// دالة الخلفية: مهلتها 15 دقيقة، فكل الميزات تشتغل بدون قطع
// بترد فورًا بـ 202، وتحفظ النتيجة في Netlify Blobs، والصفحة تسأل عنها بعدين
const { connectLambda, getStore } = require('@netlify/blobs');
const { getPhoneInfo } = require('./phone-data');
const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
const FAST_MODELS = ['gemini-3.5-flash-lite'];
const MAX_USER_MESSAGES = 6; // الرسالة الأولى + 5 رسائل متابعة
const MAX_IMAGES_PER_SESSION = 5;
const MAX_TEXT_LENGTH = 2000;
const TOTAL_BUDGET_MS = 100000; // مهلة سخية لأن الدالة في الخلفية
const TIMEOUT_MSG = 'استغرق الرد وقتًا أطول من المعتاد، حاول مرة أخرى.';

// ===== النصوص الثابتة (عدّلها من هنا) =====
const WELCOME =
  'وعليكم السلام ورحمة الله وبركاته، أهلًا بك في موقع ورشة دوز فيكس فون للاستشارة في مشاكل وأعطال الهواتف.';
const THANKS_REPLY = 'الشكر لله، تحت أمرك.';
const FAREWELL = 'السلام عليكم ورحمة الله وبركاته.';
const PRICE_TITLE = 'التكلفة التقريبية:';
const PRICE_NOTE = 'الأسعار تقريبية وقد تختلف قليلًا من ورشة إلى أخرى.';

// مصطلحات لاتينية قصيرة مسموحة
const LATIN_OK = new Set([
  'ios', 'usb', 'sim', 'lcd', 'led', 'ic', 'dfu', 'frp', 'nfc', 'gps', 'otg',
  'sd', 'gb', 'tb', 'mah', 'ram', 'rom', 'cpu', 'gpu', 'pin', 'ssd', 'pc',
  'tv', 'id', 'vpn', 'apn', 'ime', 'imei', 'oled', 'wifi', 'wi-fi', 'type-c'
]);

const PRICE_WORDS = /(سعر|اسعار|أسعار|تكلف|بكام|كام|مصنعي|ثمن)/;

function sanitizeBase64(data) {
  if (typeof data !== 'string') return '';
  const cleaned = data.includes(',') ? data.split(',')[1] : data;
  return cleaned.trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function timeLeft(startedAt) {
  return TOTAL_BUDGET_MS - (Date.now() - startedAt);
}

// ===== هل رسالة العميل شكر فقط؟ =====
function isThanksOnly(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 60) return false;
  const norm = t
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
  const hasThanks =
    /(شكرا|متشكر|مشكور|تسلم|يسلمو|جزاك|بارك الله|ربنا يكرمك|الله يكرمك|كتر خيرك|الف شكر|ربنا يبارك|thanks|thank you|thx)/.test(norm);
  if (!hasThanks) return false;
  const hasMore = /[؟?]|(لسه|لكن|بس |مشكله|ازاي|ليه|هل |عندي|جربت|تاني|كمان)/.test(norm);
  const words = norm.split(/\s+/).filter(Boolean);
  return !hasMore && words.length <= 6;
}

// ===== كشف حروف لاتينية ملتصقة بالعربي (عطل في توليد النص) =====
function hasGlitch(text) {
  return /[\u0600-\u06FF][A-Za-z]|[A-Za-z][\u0600-\u06FF]/.test(text);
}

// ===== تنظيف الرد =====
function cleanAnswer(text, brand, modelName, os) {
  const allowed = new Set(
    (brand + ' ' + modelName + ' ' + os)
      .toLowerCase()
      .split(/[^a-z0-9+\-]+/)
      .filter(Boolean)
  );

  let out = String(text || '')
    .replace(/[*#`]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // حذف أي حروف لاتينية قصيرة غريبة ليست مصطلحًا معروفًا
  out = out.replace(/[A-Za-z][A-Za-z0-9+\-]*/g, (tok) => {
    const low = tok.toLowerCase();
    if (allowed.has(low) || LATIN_OK.has(low) || /\d/.test(tok) || tok.length > 3) return tok;
    return '';
  });

  return out.replace(/ {2,}/g, ' ').trim();
}

// ===== الاتصال بجيميناي =====
// opts: { models, attempts, timeoutMs, search }
async function callGemini(KEY, body, startedAt, opts = {}) {
  const models = opts.models || MODELS;
  const attempts = opts.attempts || 2;
  const maxTimeout = opts.timeoutMs || 60000;
  let lastError = 'خطأ غير معروف';

  for (const model of models) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const remaining = timeLeft(startedAt);
      if (remaining < 4000) return { ok: false, error: TIMEOUT_MSG };

      try {
        const url =
          'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(model) +
          ':generateContent?key=' +
          encodeURIComponent(KEY);

        const payload = opts.search ? { ...body, tools: [{ google_search: {} }] } : body;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(Math.min(remaining - 1000, maxTimeout))
        });

        let json = {};
        try {
          json = await res.json();
        } catch (_) {
          json = {};
        }

        if (res.ok) return { ok: true, json };

        lastError =
          '[' + model + ' / ' + res.status + '] ' +
          ((json && json.error && json.error.message) || 'خطأ من جيميناي');

        if (res.status === 404 || res.status === 429) break;
        if (res.status < 500) return { ok: false, error: lastError };
      } catch (e) {
        lastError =
          e && e.name === 'TimeoutError' ? TIMEOUT_MSG : 'تعذر الاتصال بجيميناي';
      }

      if (attempt < attempts) await sleep(600 * attempt);
    }
  }
  return { ok: false, error: lastError };
}

function extractAnswer(json) {
  const cand = json && json.candidates && json.candidates[0];
  if (!cand || !cand.content || !Array.isArray(cand.content.parts)) return '';
  return cand.content.parts
    .filter((p) => p && !p.thought)
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

// ===== بحث الأسعار (يشتغل فقط لما العميل يسأل عن السعر) =====
async function lookupPrices(KEY, startedAt, ctx) {
  const prompt =
    'ابحث عن الأسعار الحالية في السوق المصرية بالجنيه المصري.\n' +
    'الجهاز: ' + ctx.brand + ' ' + ctx.modelName + '\n' +
    'نوع العيب: ' + ctx.fault + '\n' +
    'كلام العميل: ' + ctx.lastText.slice(0, 300) + '\n\n' +
    'المطلوب: سطر لسعر قطعة الغيار المحتملة لهذا الموديل (رقم واحد تقريبي لكل جودة إن وجدت: أصلي أو تجاري)، ' +
    'وسطر لأجر المصنعية المعتاد لهذا العطل. إذا كان العطل يُحل بإعدادات أو سوفت وير فاكتب: مجاني. ' +
    'اكتب أرقامًا فقط وبحد أقصى 4 أسطر قصيرة بدون شرح. إذا لم تجد سعرًا موثوقًا اكتب: غير متاح.';

  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };

  const r = await callGemini(KEY, body, startedAt, {
    models: [MODELS[0]],
    attempts: 1,
    timeoutMs: 30000,
    search: true
  });
  if (!r.ok) return '';

  const t = extractAnswer(r.json).replace(/[*#`]+/g, '').trim();
  if (!t || (/غير متاح/.test(t) && t.length < 20)) return '';
  return t.slice(0, 600);
}

// ===== تدقيق إملائي (للرد الأول فقط، ومعطّل افتراضيًا) =====
const ENABLE_PROOFREAD = false;

const PROOF_PROMPT =
  'أنت مدقق لغوي للعربية. ستصلك رسالة بالعامية المصرية المبسطة. ' +
  'صحح فقط الأخطاء الإملائية، والكلمات المشوهة أو الناقصة أو المكررة، وأي حروف لاتينية ملتصقة بكلمات عربية. ' +
  'لا تغيّر المعنى ولا الأرقام ولا ترتيب الخطوات ولا الأسلوب، ولا تضف شيئًا ولا تحذف جملة. ' +
  'أعد النص المصحح فقط بدون أي شرح أو علامات تنسيق.';

function numbersOf(t) {
  return (String(t).match(/\d+/g) || []).join(',');
}

async function proofread(KEY, text, startedAt) {
  if (!ENABLE_PROOFREAD) return text;
  if (timeLeft(startedAt) < 10000) return text;

  const body = {
    systemInstruction: { parts: [{ text: PROOF_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text }] }]
  };

  const r = await callGemini(KEY, body, startedAt, {
    models: FAST_MODELS,
    attempts: 1,
    timeoutMs: 20000
  });
  if (!r.ok) return text;

  const fixed = extractAnswer(r.json).replace(/[*#`]+/g, '').trim();
  if (!fixed) return text;

  const ratio = fixed.length / text.length;
  if (ratio < 0.8 || ratio > 1.25) return text;
  if (numbersOf(fixed) !== numbersOf(text)) return text;
  if (hasGlitch(fixed)) return text;

  return fixed;
    }
function buildSystemPrompt({ brand, modelName, os, fault, isFirstReply, phoneInfo }) {
  const today = new Date().toISOString().slice(0, 10);
  const osKnown = os && os !== 'غير محدد' && os.trim() !== '';

  return `
أنت فني صيانة هواتف محمولة مصري خبير، لديك سنوات طويلة من الخبرة العملية في الورشة، وتشخّص الأعطال وتشرح الحلول لعميل يكتب لك عن جهازه.

بيانات الجهاز:
- الماركة: ${brand}
- الموديل: ${modelName}
- إصدار النظام: ${osKnown ? os : 'لم يحدده العميل'}
- نوع العيب: ${fault}
- تاريخ اليوم: ${today}
`معلومات من قاعدة بيانات الورشة عن الجهاز ده: ${phoneInfo}

معرفتك بالجهاز والنظام (مهم جدًا):
- اعتمد على معرفتك بهذا الموديل بالتحديد: مواصفاته، وواجهة النظام عليه، وأعطاله الشائعة.
- أسماء القوائم ومسارات الإعدادات تختلف من ماركة إلى أخرى ومن إصدار إلى آخر، مثل One UI في سامسونج وMIUI أو HyperOS في شاومي وColorOS في أوبو. اشرح الخطوات بالمسار الصحيح لهذا الجهاز بالذات، واذكر المسار بالترتيب كما يظهر للعميل.
- إذا كان إصدار النظام غير محدد، فاستنتج من الموديل المدى المنطقي للإصدارات التي يعمل عليها، وتعامل على أساسه، وإذا اختلف المسار بين إصدارين فاذكر المسارين باختصار. لا تسأل العميل عن إصدار النظام.
- إذا كان الجهاز لا يدعم ميزة أو إصدارًا معينًا فقل ذلك بوضوح.

أسلوب الكتابة (مهم جدًا):
- اكتب بعامية مصرية مبسطة وواضحة وقريبة من الفصحى، بجمل قصيرة ومنطقية، وبإملاء عربي سليم 100%.
- التزم بالهمزات والتاء المربوطة والألف المقصورة والتنوين الصحيحة، مثل: أولًا، ثانيًا، ثالثًا، رابعًا، خامسًا، إذا، إلى، مثلًا، غالبًا، فعلًا، لأن، أيضًا.
- استخدم كلمات عربية معروفة فقط. لا تخترع كلمات، ولا تكتب كلمات ناقصة أو مشوهة أو مقطوعة أو مكررة.
- المصطلحات الفنية اكتبها بهذه الصيغ: الشاشة، التاتش، حساس القرب (حساس المكالمات)، اللوحة الأم (البوردة)، منفذ الشحن، الشاحن، البطارية، السماعة، الميكروفون، الكاميرا، الشريحة، الهارد وير، السوفت وير، قطعة الغيار، المصنعية، السيليكون الحراري، الفلاتة.
- ممنوع تمامًا إدخال أي حروف إنجليزية داخل الكلمات العربية أو ملتصقة بها. الحروف اللاتينية مسموحة فقط لأسماء الأجهزة والأنظمة والمصطلحات المعيارية مثل Android وiOS وUSB وType-C وWi-Fi وSIM وOLED وLCD وIC وIMEI، وتُكتب منفصلة بمسافة عن الكلمات العربية.
- ممنوع العناوين والرموز والنجوم والجداول والقوائم النقطية. رتّب الخطوات بكلمات مثل: أولًا، ثانيًا، ثالثًا.
- قبل أن تنهي ردك راجع كل جملة، وتأكد من سلامة الإملاء ومن أن الكلام منطقي ودقيق فنيًا.

أسلوب الرد:
- لا تبدأ أي رد بترحيب أو مجاملة أو نداء، مثل: أهلًا، يا باشا، يا غالي، بص يا سيدي. ابدأ بالمعلومة أو الحل مباشرة.
- لا تعِد كلام العميل ولا تلخص سؤاله، وأجب مباشرة.
- لا تضف عبارات مجاملة في آخر الرد.
- اعتمد على خبرة عميقة وحلول نهائية قابلة للتنفيذ، وليس على كلام عام.

${
  isFirstReply
    ? `
هذا هو الرد الأول. سيضيف النظام الترحيب تلقائيًا قبل ردك، لذلك لا تكتب أي ترحيب أو سلام، وابدأ مباشرة بالعطل وحله. يجب أن يكون الرد كاملًا ومفصلًا في رسالة واحدة:
أولًا: اذكر الأسباب المحتملة للمشكلة من الأكثر احتمالًا إلى الأقل.
ثانيًا: لكل سبب يُحل في البيت، اشرح الحل خطوة خطوة وبالترتيب: الدخول على أي إعدادات، والضغط على ماذا، ثم ماذا، بالمسار الصحيح لهذا الجهاز.
ثالثًا: لكل سبب يحتاج ورشة، اشرح للعميل مكان العطل بالضبط وما الذي سيغيّره أو يصلحه الفني، مثل: فلاتة ناقصة أو تالفة، أو لحام مكسور في اللوحة الأم، أو شاشة أو بطارية أو منفذ شحن يحتاج استبدال، ونبّه أن الجهاز سيُفتح وأن هذا عمل ورش متخصصة.
رابعًا: وضّح ما يُجرَّب بعد ذلك إذا لم ينجح الحل الأول، وما الحل النهائي إذا فشلت كل الحلول.
خامسًا: وضّح أي حل يصلح في البيت وأي حل يحتاج ورشة، ودرجة خطورة العطل باختصار.
لا تطلب صورة ولا فيديو في الرد الأول.
`
    : `
هذا رد متابعة: لا ترحيب ولا مجاملة، وأجب مباشرة على ما كتبه العميل.
- اجعل الرد قصيرًا من 3 إلى 6 أسطر.
- افهم من كلام العميل، ثم أكّد سببًا أو استبعده.
- اسأل سؤال متابعة واحدًا فقط عند الحاجة، مثل: ماذا جربت؟ متى ظهر العطل؟ هل تظهر رسالة خطأ؟ هل يمكنك تصويره؟
- عند الوصول إلى تشخيص واضح: اذكر السبب المرجح، ثم الحل النهائي. إذا كان الحل في البيت فاشرح خطواته واحدة واحدة، وقل له: إذا نجحت الخطوات فالمشكلة انتهت، وإذا لم تنجح فالحل في الورشة. وإذا كان الحل في الورشة فاشرح ما سيفعله الفني بالضبط.
- لا تكرر حلولًا ذكرتها من قبل.
`
}

الأسعار:
- لا تذكر أي أسعار أو تكلفة أو مصنعية في ردك أبدًا، ولا تسأل العميل هل يريد معرفة التكلفة. إذا سأل العميل عن السعر، فسيضيف النظام قسم التكلفة تلقائيًا بعد ردك، فقل فقط إن التكلفة التقريبية مكتوبة في نهاية الرد.

الصور والفيديو:
- قد يرسل العميل صورة في أي وقت. إذا أرسلها فحللها، وقل أين المشكلة وما سببها وما الحل، واقرأ أي رسالة خطأ أو كود ظاهر فيها.
- إذا لم تستطع الوصول للمشكلة بالكلام فاطلب منه فيديو قصيرًا أو صورة أوضح.
- إذا كان العطل واضحًا بالكلام فلا تطلب صورة.

قواعد عامة:
- لا تخترع معلومات. إذا لم تكن متأكدًا فقل ذلك.
- إذا شكرك العميل فقط فرد بجملة: الشكر لله، تحت أمرك.
- لا تقل إنك ذكاء اصطناعي.
`.trim();
}

// ===== المنطق الكامل: يرجّع { answer, ended } أو { error } =====
async function run(data) {
  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) {
    return { error: 'مفتاح جيميناي غير مضاف في إعدادات نيتلفاي' };
  }

  const startedAt = Date.now();

  const brand = String(data.brand || 'غير محدد').slice(0, 80);
  const modelName = String(data.model || 'غير محدد').slice(0, 100);
  const os = String(data.os || '').trim().slice(0, 80) || 'غير محدد';
  const fault = String(data.fault || 'غير محدد').slice(0, 120);
  const phoneInfo = getPhoneInfo(brand, modelName);
  const rawMessages = Array.isArray(data.messages) ? data.messages : [];

  const userMessages = rawMessages.filter((m) => m && m.role === 'user');
  const userCount = userMessages.length;

  if (userCount > MAX_USER_MESSAGES) {
    return { answer: 'انتهت المحادثة.\n' + FAREWELL, ended: true };
  }

  let imageCount = 0;
  for (const m of userMessages) {
    if (m.media && m.media.data) imageCount++;
  }
  if (imageCount > MAX_IMAGES_PER_SESSION) {
    return {
      answer: 'وصلت إلى الحد الأقصى للصور في هذه الجلسة. أكمل وصف المشكلة بالكلام، أو ابدأ تشخيصًا جديدًا.',
      ended: false
    };
  }

  const isFirstReply = userCount <= 1;
  const ended = userCount >= MAX_USER_MESSAGES;

  // ===== رد الشكر: ثابت وبدون استدعاء جيميناي =====
  const lastUser = userMessages[userMessages.length - 1];
  const lastHasImage = !!(lastUser && lastUser.media && lastUser.media.data);
  if (!isFirstReply && !lastHasImage && lastUser && isThanksOnly(lastUser.text)) {
    return { answer: THANKS_REPLY + '\n' + FAREWELL, ended };
  }

  const lastText = String((lastUser && lastUser.text) || '');

  // الأسعار: فقط لما العميل يسأل عن السعر (مش في الرد الأول)
  const needPrices = !isFirstReply && PRICE_WORDS.test(lastText);

  const system = buildSystemPrompt({ brand, modelName, os, fault, isFirstReply, phoneInfo });

  const history = rawMessages.map((m) => {
    const parts = [];
    const text = typeof m.text === 'string' ? m.text.slice(0, MAX_TEXT_LENGTH).trim() : '';
    if (text) parts.push({ text });

    const base64Data = m.media && m.media.data ? sanitizeBase64(m.media.data) : '';
    if (base64Data) {
      const mimeType =
        m.media && typeof m.media.mimeType === 'string' && m.media.mimeType.startsWith('image/')
          ? m.media.mimeType
          : 'image/jpeg';
      parts.push({ inlineData: { mimeType, data: base64Data } });
    }

    if (parts.length === 0) parts.push({ text: ' ' });

    return { role: m.role === 'user' ? 'user' : 'model', parts };
  });

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: history
  };

  // الرد الأول: الموديل الكبير ثم الاحتياطي. المتابعة: الموديل السريع فقط.
  const mainOpts = isFirstReply
    ? {}
    : { models: FAST_MODELS, attempts: 1, timeoutMs: 40000 };

  // بحث الأسعار يشتغل بالتوازي مع الرد، لكن فقط لما العميل يسأل
  const pricePromise = needPrices
    ? lookupPrices(KEY, startedAt, { brand, modelName, fault, lastText }).catch(() => '')
    : Promise.resolve('');

  const [result, priceNotes] = await Promise.all([
    callGemini(KEY, body, startedAt, mainOpts),
    pricePromise
  ]);

  if (!result.ok) {
    return { error: result.error };
  }

  let answer = extractAnswer(result.json);

  // لو ظهرت حروف لاتينية ملتصقة بالعربي في الرد الأول فقط، أعد المحاولة مرة واحدة
  if (isFirstReply && hasGlitch(answer) && timeLeft(startedAt) > 30000) {
    const retry = await callGemini(KEY, body, startedAt, { attempts: 1 });
    if (retry.ok) {
      const retryAnswer = extractAnswer(retry.json);
      if (retryAnswer && !hasGlitch(retryAnswer)) answer = retryAnswer;
    }
  }

  answer = cleanAnswer(answer, brand, modelName, os);
  if (!answer) answer = 'لا توجد إجابة الآن، حاول مرة أخرى.';

  if (isFirstReply) answer = await proofread(KEY, answer, startedAt);

  // إضافة قسم التكلفة (فقط لو العميل سأل)
  if (priceNotes) {
    const prices = cleanAnswer(priceNotes, brand, modelName, os);
    if (prices) answer = answer + '\n\n' + PRICE_TITLE + '\n' + prices + '\n' + PRICE_NOTE;
  }

  if (isFirstReply) answer = WELCOME + '\n\n' + answer;
  if (ended) answer = answer + '\n\n' + FAREWELL;

  return { answer, ended };
}

exports.handler = async (event) => {
  let data = {};
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400 };
  }

  const jobId = String(data.jobId || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(jobId)) {
    return { statusCode: 400 };
  }

  let store;
  try {
    connectLambda(event);
    store = getStore('diagnose-jobs');
  } catch (e) {
    return { statusCode: 500 };
  }

  let out;
  try {
    out = await run(data);
  } catch (e) {
    out = { error: 'حدث خطأ غير متوقع، حاول مرة أخرى.' };
  }

  try {
    await store.setJSON(jobId, {
      status: out.error ? 'error' : 'done',
      answer: out.answer || '',
      ended: !!out.ended,
      error: out.error || '',
      at: Date.now()
    });
  } catch (e) {
    return { statusCode: 500 };
  }

  return { statusCode: 202 };
};
