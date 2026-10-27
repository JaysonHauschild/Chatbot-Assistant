'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { compileRule } = require('rules-kit');
const { ruleResponseLanguage } = require('./response-language');

const DEFAULT_RULES_PATH = path.join(__dirname, '..', 'data', 'message-filter-rules.json');

function getMessageFilterRulesPath() {
  return process.env.MESSAGE_FILTER_RULES_PATH ||
    process.env.MESSAGE_FILTER_PATH ||
    DEFAULT_RULES_PATH;
}

function serializeRegex(regex) {
  return {
    source: regex.source,
    flags: regex.flags,
  };
}

function isRegexLike(value) {
  return value instanceof RegExp ||
    Object.prototype.toString.call(value) === '[object RegExp]' ||
    (value && typeof value.source === 'string' && typeof value.flags === 'string');
}

function serializeRule(rule) {
  const serialized = {};

  for (const [key, value] of Object.entries(rule || {})) {
    if (isRegexLike(value)) {
      if (key === 'pattern') {
        serialized.pattern = value.source;
        if (value.flags) serialized.flags = value.flags;
      } else if (key === 'negativePattern') {
        serialized.negativePattern = value.source;
        if (value.flags) serialized.negativeFlags = value.flags;
      } else {
        serialized[key] = serializeRegex(value);
      }
    } else {
      serialized[key] = value;
    }
  }

  return serialized;
}

function extractLegacyRulesArray(fileContents) {
  const startMarker = 'const RULES = [';
  const start = fileContents.indexOf(startMarker);
  if (start === -1) return null;

  const bodyStart = fileContents.indexOf('[', start);
  if (bodyStart === -1) return null;

  let depth = 0;
  let inString = '';
  let escaped = false;
  let inRegex = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = bodyStart; index < fileContents.length; index += 1) {
    const char = fileContents[index];
    const next = fileContents[index + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === inString) {
        inString = '';
      }
      continue;
    }

    if (inRegex) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '/') {
        inRegex = false;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      inString = char;
      continue;
    }

    if (char === '/' && /[:(,\[=]\s*$/.test(fileContents.slice(Math.max(0, index - 20), index))) {
      inRegex = true;
      continue;
    }

    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return fileContents.slice(bodyStart, index + 1);
      }
    }
  }

  return null;
}

function readLegacyRuleStore(fileContents) {
  const arraySource = extractLegacyRulesArray(fileContents);
  if (!arraySource) {
    throw new Error('Unable to find message-filter rules JSON or legacy RULES array.');
  }

  const rules = vm.runInNewContext(`(${arraySource})`, Object.create(null), { timeout: 1000 });
  return {
    version: 1,
    rules: rules.map(serializeRule),
  };
}

function normalizeRuleStore(store) {
  const rules = Array.isArray(store?.rules) ? store.rules : [];
  const normalized = {
    version: Number.isFinite(store?.version) ? store.version : 1,
    rules: rules.map((rule) => ({ ...rule, displayName: typeof rule.displayName === 'string' && rule.displayName.trim() ? rule.displayName.trim() : rule.id })),
  };

  if (store?.areas && typeof store.areas === 'object' && !Array.isArray(store.areas)) {
    normalized.areas = { ...store.areas };
  }

  return normalized;
}

function readMessageFilterRuleStore(filePath = getMessageFilterRulesPath()) {
  if (!fs.existsSync(filePath)) {
    return { version: 1, rules: [] };
  }

  const fileContents = fs.readFileSync(filePath, 'utf8');
  try {
    return normalizeRuleStore(JSON.parse(fileContents));
  } catch (jsonError) {
    if (!fileContents.includes('const RULES = [')) throw jsonError;
    return normalizeRuleStore(readLegacyRuleStore(fileContents));
  }
}

function writeMessageFilterRuleStore(store, filePath = getMessageFilterRulesPath()) {
  const normalized = normalizeRuleStore(store);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

function compileMessageFilterRule(rule) {
  // Preserve the legacy store's empty-flags default; standalone rules-kit also
  // supports explicit empty flags for callers needing case-sensitive strings.
  return compileRule({ ...rule, flags: rule.flags || 'i', negativeFlags: rule.negativeFlags || rule.flags || 'i' });
}

function getCompiledMessageFilterRules(filePath = getMessageFilterRulesPath()) {
  return readMessageFilterRuleStore(filePath).rules.map(compileMessageFilterRule);
}

function summarizeMessageFilterRule(rule, index) {
  return {
    id: rule.id,
    displayName: rule.displayName || rule.id,
    area: typeof rule.area === 'string' ? rule.area : null,
    topic: typeof rule.topic === 'string' ? rule.topic : null,
    action: rule.action,
    language: ruleResponseLanguage(rule),
    order: index + 1,
    regexPattern: typeof rule.pattern === 'string' ? rule.pattern : '',
    pattern: rule.pattern ? `/${rule.pattern}/${rule.flags || 'i'}` : null,
    negativePattern: rule.negativePattern ? `/${rule.negativePattern}/${rule.negativeFlags || rule.flags || 'i'}` : null,
    intents: Array.isArray(rule.intents) ? rule.intents : [],
    userIntents: Array.isArray(rule.userIntents) ? rule.userIntents : [],
    prevIntents: Array.isArray(rule.prevIntents) ? rule.prevIntents : [],
    reply: typeof rule.reply === 'string' ? rule.reply : null,
    message: typeof rule.message === 'string' ? rule.message : null,
    replacement: typeof rule.replacement === 'string' ? rule.replacement : null,
  };
}

module.exports = {
  DEFAULT_RULES_PATH,
  getMessageFilterRulesPath,
  readMessageFilterRuleStore,
  writeMessageFilterRuleStore,
  compileMessageFilterRule,
  getCompiledMessageFilterRules,
  summarizeMessageFilterRule,
};
