'use strict';

const { createGeminiKit, GeminiResponseError } = require('@jaysonh/gemini-kit');

/**
 * Server boundary for Gemini calls. Keep SDK configuration and response shapes
 * here; retrieval, caching, model fallback, and alerts belong to callers.
 *
 * Embedding prefixes are deliberately preserved from the legacy SDK paths:
 * changing them, task types, or dimensions needs a separate retrieval evaluation.
 * An injected SDK client allows tests to exercise gemini-kit without API calls.
 */
function createGeminiAdapter({
  apiKey,
  embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
  requestTimeoutMs,
  client,
  retry = { maxRetries: 0 },
} = {}) {
  if (requestTimeoutMs !== undefined &&
      (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0)) {
    throw new TypeError('requestTimeoutMs must be a positive finite number.');
  }

  const gemini = createGeminiKit({
    apiKey,
    client,
    embeddingModel,
    retry,
    embeddingConfig: requestTimeoutMs === undefined
      ? undefined
      : { httpOptions: { timeout: requestTimeoutMs } },
  });

  async function embedText(text) {
    const vector = await gemini.embedText(text);
    if (!Array.isArray(vector) || vector.length === 0 ||
        !vector.every((value) => Number.isFinite(value))) {
      throw new GeminiResponseError('Gemini returned an invalid embedding vector.', {
        code: 'INVALID_EMBEDDING_RESPONSE',
      });
    }
    return vector;
  }

  return {
    generateText: (contents, options) => gemini.generateText(contents, options),
    embedText,
    embedQuery: (text) => embedText(`task: question answering | query: ${text}`),
    embedWebDocument: (title, text) => embedText(`title: ${title || 'none'} | text: ${text}`),
    embedDocument: (title, text) => embedText(`task: retrieval_document | title: ${title || 'Document'} | text: ${text}`),
  };
}

module.exports = { createGeminiAdapter };
