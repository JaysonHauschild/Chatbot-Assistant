'use strict';

function parseDelimitedList(value, delimiter = ',') {
  return typeof value === 'string'
    ? value
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function isTruthyValue(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '').trim().toLowerCase(),
  );
}

function isExactFlagEnabled(value, enabledValue = '1') {
  return String(value || '').trim() === String(enabledValue);
}

module.exports = {
  isExactFlagEnabled,
  isTruthyValue,
  parseDelimitedList,
};
