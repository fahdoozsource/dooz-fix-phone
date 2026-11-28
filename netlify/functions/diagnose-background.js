// دالة الخلفية: بترد فورًا بـ 202، وتحفظ النتيجة في Netlify Blobs، والصفحة تسأل عنها بعدين
const { connectLambda, getStore } = require('@netlify/blobs');
const { getPhoneInfo } = require('./phone-data');

// الموديل الخفيف أولًا للسرعة، والكبير احتياطي فقط لو فشل
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
const FAST_MODELS = ['gemini-3.5-flash-lite'];
const MAX_USER_MESSAGES = 6; // الرسالة الأولى + 5 رسائل متابعة
const MAX_IMAGES_PER_SESSION = 5;
const MAX_TEXT_LENGTH = 2000;
const TOTAL_BUDGET_MS = 30000; // ميزانية قصيرة عشان الرد يطلع بسرعة
const MAIN_TIMEOUT_MS = 15000; // مهلة المحاولة الواحدة
const TIMEOUT_MSG = 'استغرق الرد وقتًا أطول من المعتاد، حاول مرة أخرى.';

// ===== النصوص الثابتة (عدّلها من هنا) =====
const WELCOME =
  'وعليكم السلام ورحمة الله وبركاته، أهلًا بك في موقع ورشة دوز فيكس فون للاستشارة في مشاكل وأعطال الهواتف.';
const THANKS_REPLY = 'الشكر لله، تحت أمرك.';
const FAREWELL = 'السلام عليكم ورحمة الله وبركاته.';
const PRICE_TITLE = 'التكلفة التقريبية:';
const PRICE_NOTE = 'الأسعار تقريبية وقد تختلف قليلًا من فني إلى آخر.';
const PRICE_FAIL_NOTE =
  'تعذر جلب الأسعار الحالية الآن، وتقدر تسأل فني صيانة قريب منك عن السعر النهائي، أو اسأل مرة أخرى بعد قليل.';

// مصطلحات لاتينية قصيرة مسموحة (تمت إضافة ui و one لأسماء واجهات سامسونج مثل One UI)
const LATIN_OK = new Set([
  'ios', 'usb', 'sim', 'lcd', 'led', 'ic', 'dfu', 'frp', 'nfc', 'gps', 'otg',
  'sd', 'gb', 'tb', 'mah', 'ram', 'rom', 'cpu', 'gpu', 'pin', 'ssd', 'pc',
  'tv', 'id', 'vpn', 'apn', 'ime', 'imei', 'oled', 'wifi', 'wi-fi', 'type-c',
  'ui', 'one', 'miui', 'hyperos', 'coloros', 'oxygenos', 'realme', 'os', 'ota', 'adb', 'fastboot'
]);

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

// ===== توحيد الكتابة العربية (للفهم فقط) =====
function normalizeAr(text) {
  return String(text || '')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
}

// ===== هل العميل بيسأل عن السعر؟ (بأي صيغة) =====
// أمثلة: سعرها كام، التكلفة كام، بكام القطعة، الصنايعي هياخد كام، المصنعية بكام، هدفع كام
function isPriceQuestion(text) {
  const norm = normalizeAr(text);
  if (!norm) return false;

  // كلمات واضحة جدًا في المعنى (تُفحص كجزء من الكلمة)
  const STRONG = [
    'سعر', 'اسعار', 'تكلف', 'تكاليف', 'يكلف', 'مصنعي', 'ثمن', 'فلوس',
    'price', 'cost', 'how much'
  ];
  if (STRONG.some((w) => norm.includes(w))) return true;

  // كلمات لازم تكون كلمة كاملة (بعد حذف حرف الواو أو الباء أو اللام من أولها)
  const WORDS = new Set(['كام', 'اجره', 'اجر', 'هدفع', 'ادفع', 'هيدفع', 'يدفع', 'اتكلف', 'هتكلف']);
  const tokens = norm.split(/[\s،,.؟?!:؛]+/).filter(Boolean);
  return tokens.some((w) => WORDS.has(w) || WORDS.has(w.replace(/^[وبل]/, '')));
}

// ===== هل رسالة العميل شكر فقط؟ =====
function isThanksOnly(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 60) return false;
  const norm = normalizeAr(t);
  const hasThanks =
    /(شكرا|متشكر|مشكور|تسلم|يسلمو|جزاك|بارك الله|ربنا يكرمك|الله يكرمك|كتر خيرك|الف شكر|ربنا يبارك|thanks|thank you|thx)/.test(norm);
  if (!hasThanks) return false;
  const hasMore = /[؟?]|(لسه|لكن|بس |مشكله|ازاي|ليه|هل |عندي|جربت|تاني|كمان)/.test(norm);
  const words = norm.split(/\s+/).filter(Boolean);
  return !hasMore && words.length <= 6;
}

// ===== كشف حروف لاتينية ملتصقة بالعربي =====
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
// opts: { models, attempts, timeoutMs, search, maxTokens }
async function callGemini(KEY, body, startedAt, opts = {}) {
  const models = opts.models || MODELS;
  const attempts = opts.attempts || 1;
  const maxTimeout = opts.timeoutMs || MAIN_TIMEOUT_MS;
  let lastError = 'خطأ غير معروف';

  for (const model of models) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const remaining = timeLeft(startedAt);
      if (remaining < 3000) return { ok: false, error: TIMEOUT_MSG };

      try {
        const url =
          'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(model) +
          ':generateContent?key=' +
          encodeURIComponent(KEY);

        let payload = {
          ...body,
          generationConfig: {
            maxOutputTokens: opts.maxTokens || 1000,
            temperature: 0.3
          }
        };
        if (opts.search) payload = { ...payload, tools: [{ google_search: {} }] };

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(Math.min(remaining - 500, maxTimeout))
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
        console.log('[gemini] error:', lastError, opts.search ? '(with search)' : '');

        // 404 أو 429: جرّب الموديل التالي. غير كده: وقف
        if (res.status === 404 || res.status === 429) break;
        if (res.status < 500) return { ok: false, error: lastError };
      } catch (e) {
        lastError =
          e && e.name === 'TimeoutError' ? TIMEOUT_MSG : 'تعذر الاتصال بجيميناي';
        console.log('[gemini] exception:', model, e && e.name, e && e.message);
      }

      if (attempt < attempts) await sleep(300 * attempt);
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
// بيجرّب الموديلين واحد ورا التاني، وبيطبع في اللوج سبب أي فشل
async function lookupPrices(KEY, startedAt, ctx) {
  const prompt =
    'ابحث في الإنترنت الآن عن الأسعار الحالية في السوق المصرية بالجنيه المصري.\n' +
    'الجهاز: ' + ctx.brand + ' ' + ctx.modelName + '\n' +
    'نوع العيب: ' + ctx.fault + '\n' +
    (ctx.desc ? 'وصف العميل: ' + ctx.desc.slice(0, 300) + '\n' : '') +
    (ctx.lastBotText ? 'آخر تشخيص قدمه الفني للعميل: ' + ctx.lastBotText.slice(0, 600) + '\n' : '') +
    'سؤال العميل الآن: ' + ctx.lastText.slice(0, 300) + '\n\n' +
    'المطلوب بالضبط ثلاثة أسطر قصيرة، وفي كل سطر رقم واحد تقريبي فقط بدون مدى (لا تكتب من كذا إلى كذا):\n' +
    'قطعة الغيار: (سعر القطعة المناسبة لهذا الموديل والعطل) جنيه\n' +
    'المصنعية: (أجر الفني لتركيبها أو لإصلاح هذا العطل) جنيه\n' +
    'الإجمالي التقريبي: (المجموع) جنيه\n' +
    'إذا كان في التشخيص أكثر من عطل فاحسب للعطل الأرجح فقط.\n' +
    'إذا كان العطل يُحل بإعدادات أو سوفت وير فاكتب سطرًا واحدًا فقط: مجاني.\n' +
    'اكتب الأرقام فقط بدون شرح. إذا لم تجد سعرًا موثوقًا اكتب: غير متاح.';

  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };

  console.log('[prices] lookup start:', ctx.brand, ctx.modelName, '/', ctx.fault);

  for (const m of MODELS) {
    if (timeLeft(startedAt) < 4000) break;

    const r = await callGemini(KEY, body, startedAt, {
      models: [m],
      attempts: 1,
      timeoutMs: 14000,
      maxTokens: 400,
      search: true
    });

    if (!r.ok) {
      console.log('[prices] failed on', m, '->', r.error);
      continue;
    }

    const t = extractAnswer(r.json).replace(/[*#`]+/g, '').trim();
    console.log('[prices] raw from', m, ':', t.slice(0, 200));

    if (!t || (/غير متاح/.test(t) && t.length < 20)) continue;
    return t.slice(0, 600);
  }

  console.log('[prices] no usable result');
  return '';
}

function buildSystemPrompt({ brand, modelName, os, fault, desc, isFirstReply, phoneInfo }) {
  const today = new Date().toISOString().slice(0, 10);
  const osKnown = os && os !== 'غير محدد' && os.trim() !== '';
  const infoText = phoneInfo ? '\n' + phoneInfo : '';

  return `
أنت مستشار صيانة هواتف محمولة مصري خبير، لديك سنوات طويلة من الخبرة العملية، وتشخّص الأعطال وتشرح الحلول لعميل يكتب لك عن جهازه. أنت تقدم استشارة عبر الموقع، ولست الفني الذي يصلح الجهاز بنفسه.

بيانات الجهاز:
- الماركة: ${brand}
- الموديل: ${modelName}
- إصدار النظام: ${osKnown ? os : 'لم يحدده العميل'}
- نوع العيب: ${fault}
- وصف العميل بكلامه: ${desc || 'لم يكتب وصفًا'}
- تاريخ اليوم: ${today}
${infoText}

قراءة بيانات العميل (مهم جدًا):
- نوع العيب المختار ووصف العميل المكتوب مصدر واحد للمعلومات، فاقرأ الاثنين معًا واعتمد عليهما معًا.
- قد يتكلم الوصف عن عطل مختلف عن العيب المختار، أو عن عطلين معًا. في هذه الحالة تناول كل عطل منهما، ولا تتجاهل أي واحد، ووزّع الأسباب بينهما مع الالتزام بحد الكلمات.
- لا تبدأ بأسباب جاهزة من عندك. ابنِ الأسباب على ما قاله العميل بالضبط.
- إذا ذكر العميل أنه جرّب شيئًا، مثل تغيير قطعة أو إعادة تشغيل أو تحديث، وما زال العطل موجودًا، فاستبعد الأسباب التي تتناقض مع ذلك، وابدأ بالأسباب التي ما زالت محتملة بعده.
- لا تفترض معلومة لم يذكرها العميل. إذا كانت المعلومة ناقصة وتغيّر التشخيص، فاسأل عنها في سؤالك الأخير.
- ابدأ ردك بالمشكلة الأقرب لما كتبه العميل في الوصف، ثم الباقي حسب الاحتمال.

معرفتك بالجهاز والنظام:
- اعتمد على معرفتك بهذا الموديل بالتحديد: مواصفاته، وواجهة النظام عليه، وأعطاله الشائعة.
- اشرح خطوات الإعدادات بالمسار الصحيح لهذا الجهاز بالذات، بالترتيب كما يظهر للعميل.
- إذا كان إصدار النظام غير محدد فاستنتجه من الموديل، ولا تسأل العميل عنه.
- إذا كان الجهاز لا يدعم ميزة معينة فقل ذلك بوضوح.

أسلوب الكتابة (مهم جدًا، الدقة اللغوية أهم من السرعة):
- اكتب بعامية مصرية مبسطة وواضحة وقريبة من الفصحى، بجمل قصيرة ومنطقية ومترابطة.
- الإملاء العربي يجب أن يكون سليمًا 100%: الهمزات (أ، إ، ء، ئ، ؤ)، والتاء المربوطة والهاء، والألف المقصورة والياء، والتنوين، والتشكيل الخفيف عند الحاجة فقط. مثل: أولًا، ثانيًا، ثالثًا، رابعًا، إذا، إلى، مثلًا، غالبًا، لأن، أيضًا، مشكلة، شاشة.
- راجع كل كلمة قبل كتابتها. لا تكتب كلمة ناقصة الحروف أو مقطوعة أو مكررة أو مشوهة، ولا تخلط حروفًا من لغات أخرى.
- اكتب كل جملة كاملة بفعلها وفاعلها ونهايتها. لا تترك جملة معلّقة أو ناقصة، ولا تنهِ جملة بكلمة مثل: من، إلى، على، في، بدون أن تكمل المعنى.
- استخدم كلمات عربية معروفة فقط. لا تخترع كلمات.
- المصطلحات الفنية اكتبها بهذه الصيغ: الشاشة، التاتش، حساس القرب، اللوحة الأم (البوردة)، منفذ الشحن، الشاحن، البطارية، السماعة، الميكروفون، الكاميرا، الشريحة، الهارد وير، السوفت وير، قطعة الغيار، المصنعية، السيليكون الحراري، الفلاتة.
- ممنوع تمامًا إدخال حروف إنجليزية داخل الكلمات العربية أو ملتصقة بها. الحروف اللاتينية مسموحة فقط لأسماء الأجهزة والأنظمة والمصطلحات المعيارية مثل Android وiOS وOne UI وUSB وType-C وWi-Fi وSIM وOLED وLCD وIC وIMEI، وتُكتب منفصلة بمسافة عن الكلمات العربية.
- ممنوع العناوين والرموز والنجوم والجداول والقوائم النقطية.
- قبل أن تنهي ردك، راجعه كاملًا مرة أخيرة وتأكد من سلامة الإملاء ومن أن كل جملة مكتملة ومنطقية فنيًا.

أسلوب الرد:
- لا تبدأ أي رد بترحيب أو مجاملة أو نداء، مثل: أهلًا، يا باشا، يا غالي. ابدأ بالمعلومة أو الحل مباشرة.
- لا تعِد كلام العميل ولا تلخص سؤاله، وأجب مباشرة.
- لا تضف عبارات مجاملة في آخر الرد.
- اعتمد على حلول نهائية قابلة للتنفيذ وليس على كلام عام.

مهم جدًا بخصوص مكان الإصلاح:
- أنت لست ورشة ولا تفتح الأجهزة. ممنوع تمامًا أن تقول: في الورشة، أو عندنا في الورشة، أو نفحص الجهاز عندنا، أو نعيد تثبيت السوفت وير عندنا.
- عندما يحتاج العطل إلى تدخل فني، قل: تذهب إلى فني صيانة، وسيقوم بكذا. ثم اشرح بالتدريج: أولًا يفحص الفني كذا، فإذا لم تتحل المشكلة فيجرّب كذا، فإذا لم تتحل أيضًا فالحل النهائي هو كذا.
- اشرح للعميل ما سيفعله فني الصيانة بالضبط وبالترتيب، مثل: فحص الفلاتة، أو تنظيف المنفذ، أو إعادة تثبيت السوفت وير على اللوحة الأم، أو تغيير الشاشة أو البطارية أو منفذ الشحن، أو إصلاح لحام في اللوحة الأم.
- نبّه أن الجهاز سيُفتح عند الفني في الحالات التي تحتاج ذلك.

${
  isFirstReply
    ? `
هذا هو الرد الأول. سيضيف النظام التحية تلقائيًا، فلا تكتب أي ترحيب أو سلام. ابدأ فورًا بالأسباب.
اذكر من ثلاثة إلى أربعة أسباب محتملة للعطل من الأكثر احتمالًا إلى الأقل.
رتب كل سبب في فقرة مستقلة بهذا الشكل بالضبط:
المشكلة الأولى: اكتب السبب في جملة أو جملتين.
الحل: اكتب الحل في سطر جديد تحتها مباشرة، وابدأه بكلمة الحل، ثم الخطوات بالتفصيل.
اترك سطرًا فارغًا كاملًا بين كل مشكلة وحلها والمشكلة التي بعدها. ثم المشكلة الثانية، ثم الثالثة، وهكذا بنفس الترتيب.
ممنوع تمامًا استخدام كلمة يُحل أو ويُحل أو تُحل في وصف الحل. اكتب بدلًا منها: الحل، أو: وتتحل المشكلة بـ.
إذا كان الحل منزليًا فاذكر خطواته المختصرة بالمسار الصحيح لهذا الجهاز. وإذا كان يحتاج فني صيانة فاذكر ما سيفعله بالضبط وما البديل لو لم ينجح.
اجعل الرد كله في حدود 230 كلمة.
في آخر الرد، بعد سطر فارغ، اسأل سؤالًا واحدًا فقط في محله تمامًا، تختاره حسب العطل والسياق، ويكون الهدف منه أن تحدد من إجابة العميل مكان العطل بالضبط. أمثلة: هل وقع الجهاز أو تعرض لمياه أو ضغط قبل ظهور العطل؟ أو: هل بدأ العطل بعد تحديث أو بعد تغيير قطعة؟ أو: هل العطل مستمر أم يظهر أحيانًا فقط؟
لا تطلب صورة ولا فيديو في الرد الأول.
`
    : `
هذا رد متابعة: لا ترحيب ولا مجاملة، وأجب مباشرة على ما كتبه العميل.
- اجعل الرد قصيرًا من 3 إلى 5 أسطر.
- أكّد سببًا أو استبعده بناءً على كلام العميل.
- اسأل سؤال متابعة واحدًا فقط عند الحاجة.
- عند الوصول إلى تشخيص واضح: اذكر السبب المرجح ثم الحل النهائي. إذا كان الحل في البيت فاشرح خطواته، وقل له: إذا نجحت الخطوات فالمشكلة انتهت، وإذا لم تنجح فاذهب إلى فني صيانة. وإذا كان الحل عند فني صيانة فاشرح ما سيفعله بالترتيب.
- لا تكرر حلولًا ذكرتها من قبل.
- إذا لم تستطع الوصول للمشكلة بالكلام فاطلب منه فيديو قصيرًا أو صورة أوضح.
`
}

الأسعار:
- لا تذكر أي أسعار أو تكلفة أو مصنعية في ردك أبدًا، ولا تسأل العميل هل يريد معرفة التكلفة، ولا تعرض عليه ذلك. إذا سأل العميل عن السعر أو التكلفة بأي صيغة فسيضيف النظام قسم التكلفة تلقائيًا بعد ردك، فاكتب جملة واحدة فقط: التكلفة التقريبية مكتوبة في نهاية الرد.

الصور:
- إذا أرسل العميل صورة فحللها، وقل أين المشكلة وما سببها وما الحل، واقرأ أي رسالة خطأ ظاهرة فيها.
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
  const desc = String(data.desc || '').trim().slice(0, 1000);
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

  // آخر رد قدمه الفني (عشان بحث الأسعار يعرف إحنا بنتكلم عن أنهي عطل)
  let lastBotText = '';
  for (let i = rawMessages.length - 1; i >= 0; i--) {
    const m = rawMessages[i];
    if (m && m.role !== 'user' && typeof m.text === 'string' && m.text.trim()) {
      lastBotText = m.text.trim();
      break;
    }
  }

  // الأسعار: فقط لما العميل يسأل عن السعر بأي صيغة (مش في الرد الأول)
  const needPrices = !isFirstReply && isPriceQuestion(lastText);
  console.log('[run] userCount=', userCount, 'needPrices=', needPrices, 'text=', lastText.slice(0, 80));

  const system = buildSystemPrompt({ brand, modelName, os, fault, desc, isFirstReply, phoneInfo });

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

  // الرد الأول: الخفيف ثم الكبير احتياطي. المتابعة: الخفيف فقط.
  const mainOpts = isFirstReply
    ? { models: MODELS, attempts: 1, timeoutMs: MAIN_TIMEOUT_MS, maxTokens: 1000 }
    : { models: FAST_MODELS, attempts: 1, timeoutMs: 12000, maxTokens: 500 };

  // بحث الأسعار بالتوازي مع الرد، لكن فقط لما العميل يسأل
  const pricePromise = needPrices
    ? lookupPrices(KEY, startedAt, { brand, modelName, fault, desc, lastText, lastBotText }).catch((e) => {
        console.log('[prices] exception:', e && e.message);
        return '';
      })
    : Promise.resolve('');

  const [result, priceNotes] = await Promise.all([
    callGemini(KEY, body, startedAt, mainOpts),
    pricePromise
  ]);

  if (!result.ok) {
    return { error: result.error };
  }

  let answer = extractAnswer(result.json);

  // تنظيف الحروف اللاتينية الغريبة بدل إعادة المحاولة (أسرع)
  answer = cleanAnswer(answer, brand, modelName, os);
  if (!answer) answer = 'لا توجد إجابة الآن، حاول مرة أخرى.';

  // إضافة قسم التكلفة (فقط لو العميل سأل)
  if (needPrices) {
    const prices = priceNotes ? cleanAnswer(priceNotes, brand, modelName, os) : '';
    if (prices) {
      answer = answer + '\n\n' + PRICE_TITLE + '\n' + prices + '\n' + PRICE_NOTE;
    } else {
      answer = answer + '\n\n' + PRICE_FAIL_NOTE;
    }
  }

  // التحية بتتحط من الكود نفسه، فتطلع زي ما هي بالحرف
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
    console.log('[run] unexpected error:', e && e.message);
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
