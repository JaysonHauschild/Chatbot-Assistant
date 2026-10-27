'use strict';

function sanitizeHttpUrl(rawUrl, options = {}) {
  const maxLength = Number.isFinite(options.maxLength)
    ? options.maxLength
    : 2000;

  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > maxLength) return null;

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

module.exports = {
  sanitizeHttpUrl,
};
