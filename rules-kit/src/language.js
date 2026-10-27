'use strict';

function normalizeLanguage(value = 'en') {
  if (typeof value !== 'string' || !value.trim()) throw new Error('language must be a valid language code, such as en or es.');
  try { return new Intl.Locale(value.trim()).language; }
  catch { throw new Error('language must be a valid language code, such as en or es.'); }
}

function ruleLanguage(rule, defaultLanguage = 'en') {
  return normalizeLanguage(rule.language === undefined ? defaultLanguage : rule.language);
}

module.exports = { normalizeLanguage, ruleLanguage };
