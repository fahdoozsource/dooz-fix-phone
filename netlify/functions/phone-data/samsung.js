const { CONFIDENCE, TIER_LABEL } = require('./common');

const PATHS = {
  os: 'One UI',
  devMode: 'الإعدادات > حول الهاتف > معلومات البرنامج > اضغط على رقم البناء 7 مرات',
  update: 'الإعدادات > تحديث البرنامج > تنزيل وتثبيت',
  battery: 'الإعدادات > البطارية',
  storage: 'الإعدادات > البطارية والعناية بالجهاز > التخزين',
  safeMode: 'اضغط مطولا على زر الطاقة، ثم اضغط مطولا على إيقاف التشغيل، ثم الوضع الآمن',
  network: 'الإعدادات > الإدارة العامة > إعادة ضبط > إعادة ضبط إعدادات الشبكة',
  diagnostics: 'تطبيق Samsung Members > الدعم > تشخيص الهاتف > اختبار الكل',
  screenTest: 'اطلب *#0*# من الاتصال لاختبار ألوان الشاشة'
};

// أعطال مثبتة بمصادر فعلية
const FAULTS = {
  greenLine: {
    symptom: 'خط أخضر أو وردي عمودي في الشاشة',
    confidence: 'verified',
    fix: 'استبدال الشاشة هو الحل الوحيد حسب مستخدمين كتير. روح مركز سامسونج المعتمد مش محل خارجي، واسأل عن سياسة الاستبدال المجاني لمرة واحدة لو الخط ظهر بعد تحديث. التكلفة بتختلف حسب البلد وفي بلد ناس اتطلب منهم مبلغ كبير بحجة خارج الضمان.',
    notes: 'بيظهر عند ناس بعد تحديث البرنامج. جرب اختبار *#0*# الأول للتأكد إنه عطل شاشة.'
  },
  freezeTouch: {
    symptom: 'تهنيج الشاشة واللمس بيتصرف لوحده',
    confidence: 'reported',
    fix: 'خطوات مقترحة: إعادة تشغيل إجباري بالضغط على الطاقة وخفض الصوت، تحديث البرنامج، الوضع الآمن لو تطبيق هو السبب، تشخيص من Samsung Members. في حالات ناس مركز صيانة معتمد ما لقاش عطل عتاد وإعادة تثبيت البرنامج ما نفعتش.',
    notes: 'أكتر موديلات اتذكرت: A15 وA05.'
  },
  bootLogo: {
    symptom: 'الجهاز عالق على شعار سامسونج أو بيعيد التشغيل',
    confidence: 'reported',
    fix: 'خطوات مقترحة بالترتيب: شحن الجهاز، إعادة تشغيل إجباري، الوضع الآمن (ضغط خفض الصوت أثناء الإقلاع) لو تطبيق سبب المشكلة، مسح الكاش من وضع الاسترداد، وآخر حل إعادة تثبيت البرنامج الأصلي بأداة Odin وده لفني.',
    notes: 'مستخدم جرب الطاقة مع الصوت ووصله بلابتوب ومنفعش، فاحتمال يحتاج مركز خدمة.'
  },
  slowCharge: {
    symptom: 'الشحن بطيء ومكتوب 8 ساعات رغم الشاحن الأصلي',
    confidence: 'reported',
    fix: 'جرب كابل وشاحن تاني، نضف منفذ الشحن، أعد التشغيل، وشوف تحديث. لو فضل بطيء احتمال المنفذ أو البطارية محتاجة فحص.',
    notes: 'اتذكر على A15 بشاحن 25 واط أصلي. ما اتأكدش من حل نفع.'
  },
  wifiDrop: {
    symptom: 'الواي فاي بيفصل أو الجهاز بيفتكر إنه مفيش إنترنت',
    confidence: 'reported',
    fix: 'إعادة ضبط الشبكة من الإعدادات، وتحديث البرنامج. مستخدمة دفعت رسوم إصلاح والعطل رجع بعد أيام، فاحتمال برنامج مش عتاد.',
    notes: 'اتذكر على A15.'
  },
  heat: {
    symptom: 'سخونة في الاستخدام العادي',
    confidence: 'general',
    fix: 'إيقاف السطوع التلقائي، إيقاف الموقع، فصل واي فاي وبيانات للتجربة، وشوف التطبيقات اللي بتشتغل في الخلفية.',
    notes: 'خطوات عامة من مقال مراجعة، مش مؤكدة.'
  }
};

// الموديلات: fault = مفاتيح من FAULTS اللي اتذكرت فعلا على الموديل ده
const MODELS = {
  // ===== فاخر (15) =====
  'S25 Ultra': { tier: 'premium', faults: [] },
  'S25+': { tier: 'premium', faults: [] },
  'S25': { tier: 'premium', faults: [] },
  'S24 Ultra': { tier: 'premium', faults: ['greenLine'] },
  'S24': { tier: 'premium', faults: [] },
  'S23 Ultra': { tier: 'premium', faults: ['greenLine'] },
  'S23': { tier: 'premium', faults: [] },
  'S22 Ultra': { tier: 'premium', faults: [] },
  'S21': { tier: 'premium', faults: [] },
  'Z Fold 6': { tier: 'premium', faults: [] },
  'Z Flip 6': { tier: 'premium', faults: [] },
  'Note 20 Ultra': { tier: 'premium', faults: [] },
  'Note 10': { tier: 'premium', faults: [] },
  'A56': { tier: 'premium', faults: [] },
  'A55': { tier: 'premium', faults: [] },

  // ===== اقتصادي (15) =====
  'A16': { tier: 'econ', faults: [] },
  'A15': { tier: 'econ', faults: ['freezeTouch', 'slowCharge', 'wifiDrop'] },
  'A06': { tier: 'econ', faults: ['freezeTouch'] },
  'A05': { tier: 'econ', faults: ['freezeTouch'] },
  'A26': { tier: 'econ', faults: [] },
  'A25': { tier: 'econ', faults: [] },
  'A35': { tier: 'econ', faults: [] },
  'M15': { tier: 'econ', faults: [] },
  'M35': { tier: 'econ', faults: [] },
  'A14': { tier: 'econ', faults: [] },
  'A24': { tier: 'econ', faults: [] },
  'A34': { tier: 'econ', faults: [] },
  'M14': { tier: 'econ', faults: [] },
  'A13': { tier: 'econ', faults: [] },
  'A23': { tier: 'econ', faults: [] },

  // ===== أضعف (10) =====
  'A03': { tier: 'weak', faults: ['bootLogo'] },
  'A03 Core': { tier: 'weak', faults: ['bootLogo'] },
  'A04': { tier: 'weak', faults: [] },
  'A04e': { tier: 'weak', faults: ['slowCharge'] },
  'A02': { tier: 'weak', faults: [] },
  'A02s': { tier: 'weak', faults: [] },
  'A12': { tier: 'weak', faults: [] },
  'A11': { tier: 'weak', faults: [] },
  'A10s': { tier: 'weak', faults: [] },
  'A01': { tier: 'weak', faults: [] }
};

// أعطال عامة للفئة لو الموديل ملوش أعطال موثقة (confidence = general)
const TIER_GENERAL = {
  premium: 'خطوط في الشاشة بعد الوقوع أو التحديث، سخونة تحت الضغط، البطارية بعد سنتين أو تلاتة، كسر زجاج الظهر والكاميرا.',
  econ: 'تهنيج وبطء بعد شهور، مشاكل لمس، سخونة، ضعف البطارية، منفذ الشحن.',
  weak: 'بطء شديد، التخزين بيخلص بسرعة، شحن بطيء، بطارية ضعيفة، مشاكل تحديث.'
};

function norm(s) {
  return String(s || '').toLowerCase().replace(/samsung|galaxy/g, '').replace(/[^a-z0-9+]+/g, '');
}

function find(modelName) {
  const t = norm(modelName);
  if (!t) return null;
  const names = Object.keys(MODELS);
  for (let i = 0; i < names.length; i++) {
    if (norm(names[i]) === t) return names[i];
  }
  return null;
}

function getInfo(modelName) {
  const lines = [];
  lines.push('واجهة النظام: ' + PATHS.os + '.');
  lines.push('مسارات الإعدادات: وضع المطور: ' + PATHS.devMode + ' | التحديث: ' + PATHS.update +
    ' | البطارية: ' + PATHS.battery + ' | التخزين: ' + PATHS.storage +
    ' | الوضع الآمن: ' + PATHS.safeMode + ' | إعادة ضبط الشبكة: ' + PATHS.network +
    ' | تشخيص الهاتف: ' + PATHS.diagnostics + ' | اختبار الشاشة: ' + PATHS.screenTest + '.');

  const name = find(modelName);
  if (!name) return lines.join('\n');

  const m = MODELS[name];
  lines.push('فئة الموديل: ' + TIER_LABEL[m.tier] + '.');

  if (m.faults.length) {
    lines.push('أعطال اتذكرت فعلا على هذا الموديل (مع مستوى الثقة):');
    m.faults.forEach((k) => {
      const f = FAULTS[k];
      lines.push('- ' + f.symptom + ' [' + CONFIDENCE[f.confidence] + ']: ' + f.fix + (f.notes ? ' ملاحظة: ' + f.notes : ''));
    });
  } else {
    lines.push('مفيش بحث موثق على أعطال الموديل ده. الأعطال العامة للفئة (معلومة عامة غير مؤكدة): ' + TIER_GENERAL[m.tier]);
  }
  return lines.join('\n');
}

module.exports = { getInfo, MODELS, FAULTS };
