'use strict';

const DEFAULT_PRIMARY_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_SECONDARY_MODEL = 'gemini-3.6-flash';

function getChatModels(env = process.env) {
  const normalize = (value) => String(value || '').trim().replace(/^models\//, '');
  return {
    primary: normalize(env.GEMINI_MODEL) || DEFAULT_PRIMARY_MODEL,
    secondary: normalize(env.GEMINI_SECONDARY_MODEL) || DEFAULT_SECONDARY_MODEL,
    // Classification is optional telemetry. A blank value saves one API call per answer.
    classifier: normalize(env.GEMINI_CLASSIFIER_MODEL),
  };
}

function isRecoverableModelError(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  return [404, 408, 429, 500, 502, 503, 504].includes(status) ||
    error?.code === 'EMPTY_MODEL_RESPONSE' ||
    /timeout|timed out|fetch failed|network|socket|ECONNRESET|ETIMEDOUT/i.test(error?.message || '') ||
    /AbortError/.test(error?.name || '');
}

// Each process remembers short model cooldowns so subsequent turns can go straight
// to the secondary instead of spending another request on a throttled model.
function createModelFallback({ now = Date.now } = {}) {
  const cooldowns = new Map();
  return async function generateWithFallback({ models, generate, signal, onFailure = () => {} }) {
    const names = [...new Set(models.filter(Boolean))];
    for (const [name, entry] of cooldowns) {
      if (entry.until <= now()) cooldowns.delete(name);
    }
    let lastError;
    for (let index = 0; index < names.length; index++) {
      signal?.throwIfAborted();
      const name = names[index];
      const cooling = cooldowns.get(name);
      if (cooling) {
        lastError = cooling.error;
        continue;
      }
      try {
        const value = await generate(name);
        signal?.throwIfAborted();
        return { model: name, value };
      } catch (error) {
        signal?.throwIfAborted();
        lastError = error;
        const recoverable = isRecoverableModelError(error);
        const status = Number(error?.status || error?.statusCode || error?.response?.status);
        if (status === 429 || status === 404 || status === 503) {
          const retryInfo = error?.errorDetails?.find((detail) => detail['@type']?.endsWith('RetryInfo'));
          const seconds = parseFloat(retryInfo?.retryDelay);
          const delay = status === 404 ? 300_000 : status === 503 ? 10_000
            : Math.max(60_000, Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : 0);
          // Bound state even when operators change model overrides repeatedly.
          if (cooldowns.size >= 20) cooldowns.delete(cooldowns.keys().next().value);
          cooldowns.set(name, { until: now() + delay, error });
        }
        onFailure(error, name, recoverable && names.slice(index + 1).some((next) => !cooldowns.has(next)));
        if (!recoverable) throw error;
      }
    }
    throw lastError || new Error('No chat model is configured.');
  };
}

module.exports = { getChatModels, isRecoverableModelError, createModelFallback };
