'use strict';

const { normalizeLanguage } = require('./language');

function buildKeywordPattern(keywords) {
  const values = typeof keywords === 'string' ? keywords.split(',') : keywords;
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
    throw new TypeError('keywords must be a comma-separated string or an array of strings.');
  }
  return values.map(value => value.trim()).filter(Boolean)
    .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}

function compilePattern(pattern, flags, label) {
  if (Object.prototype.toString.call(pattern) === '[object RegExp]') return new RegExp(pattern.source, pattern.flags);
  if (typeof pattern !== 'string' || !pattern) throw new TypeError(`${label} must be a nonempty regex source or RegExp.`);
  return new RegExp(pattern, flags);
}

function compileRule(rule) {
  if (!rule || typeof rule !== 'object' || typeof rule.id !== 'string' || !rule.id.trim()) {
    throw new TypeError('Each rule requires a nonempty string id.');
  }
  // Legacy stores can contain unfinished rules. Missing actions remain inert.
  if (rule.action !== undefined && !['respond', 'block', 'replace'].includes(rule.action)) throw new TypeError(`Rule '${rule.id}' has an unsupported action.`);
  for (const field of ['intents', 'userIntents', 'prevIntents']) {
    if (rule[field] !== undefined && (!Array.isArray(rule[field]) || rule[field].some(value => typeof value !== 'string'))) {
      throw new TypeError(`Rule '${rule.id}': ${field} must be an array of strings.`);
    }
  }
  for (const field of ['reply', 'message', 'replacement']) {
    if (rule[field] !== undefined && typeof rule[field] !== 'string') throw new TypeError(`Rule '${rule.id}': ${field} must be a string.`);
  }
  if (rule.priority !== undefined && !Number.isFinite(rule.priority)) throw new TypeError(`Rule '${rule.id}': priority must be finite.`);
  if (rule.language !== undefined) normalizeLanguage(rule.language);
  const compiled = {
    ...rule,
    displayName: typeof rule.displayName === 'string' && rule.displayName.trim() ? rule.displayName.trim() : rule.id,
    pattern: compilePattern(rule.pattern ?? buildKeywordPattern(rule.keywords), rule.flags ?? 'i', `Rule '${rule.id}' pattern`),
  };
  if (rule.negativePattern) compiled.negativePattern = compilePattern(rule.negativePattern, rule.negativeFlags ?? rule.flags ?? 'i', `Rule '${rule.id}' exclusion`);
  for (const field of ['intents', 'userIntents', 'prevIntents']) {
    if (rule[field]) compiled[field] = [...rule[field]];
  }
  return compiled;
}

function compileRules(rules) {
  if (!Array.isArray(rules)) throw new TypeError('rules must be an array.');
  const ids = new Set();
  return rules.map(rule => {
    const compiled = compileRule(rule);
    if (ids.has(compiled.id)) throw new Error(`Duplicate rule id '${compiled.id}'.`);
    ids.add(compiled.id);
    return compiled;
  });
}

module.exports = { buildKeywordPattern, compileRule, compileRules };
