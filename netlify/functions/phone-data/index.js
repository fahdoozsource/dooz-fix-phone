const samsung = require('./samsung');

// لما تضيف شركة جديدة، ضيف سطر هنا وفي القائمة تحت
const BRANDS = {
  samsung: samsung
};

function normBrand(b) {
  return String(b || '').toLowerCase().replace(/[^a-z]/g, '');
}

function getPhoneInfo(brand, model) {
  const key = normBrand(brand);
  const mod = BRANDS[key];
  if (!mod || typeof mod.getInfo !== 'function') return '';
  try {
    return mod.getInfo(model) || '';
  } catch (e) {
    return '';
  }
}

module.exports = { getPhoneInfo };
