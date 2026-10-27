'use strict';
/**
 * rag.js  —  OKSBDC RAG module
 *
 * Thin wrapper around lib/rag-engine.js that supplies OKSBDC-specific
 * configuration: vector store path, static locations supplement, retrieval
 * thresholds, and the location-query detector.
 *
 * Exports the same { init, getRelevantContext, getStatus } API as before so
 * no other files need to change. All generic retrieval logic lives in
 * lib/rag-engine.js and can be reused for any project.
 *
 * If the vector store has not been built yet (run "npm run crawl" first),
 * getRelevantContext returns null and the server falls back to the plain
 * system prompt.
 */

const path = require('path');
const { isTruthyValue } = require('server-kit');
const { RagEngine } = require('./lib/rag-engine');

// ── OKSBDC-specific config ────────────────────────────────────────────────────

const VECTOR_STORE_PATH    = path.join(__dirname, 'data/vector-store.json');
const LOCATIONS_STATIC_PATH = path.join(__dirname, 'data/locations-static.txt');

const DEFAULT_RAG_PRELOAD_QUERIES = Object.freeze([
  'How do I start a business in Oklahoma?',
  'What licenses or permits do I need for my business?',
  'Where is the nearest OKSBDC office?',
  'What funding options are available for small businesses?',
  'How do I write a business plan?',
  'What training workshops does OKSBDC offer?',
]);

function parsePreloadQueries(value) {
  if (typeof value !== 'string') return DEFAULT_RAG_PRELOAD_QUERIES;

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    }
  } catch {
    // Fall back to delimiter parsing below.
  }

  return trimmed
    .split(/\n|\|\||;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getPreloadQueries() {
  if (isTruthyValue(process.env.RAG_PRELOAD_DISABLED)) return [];
  return parsePreloadQueries(process.env.RAG_PRELOAD_QUERIES);
}

/**
 * Detects location-related queries so the engine can use relaxed retrieval
 * thresholds and prepend the static office-locations supplement.
 * Location chunks score lower than general content in cosine similarity,
 * so they need a lower minScore and higher topK to surface reliably.
 *
 * @param {string} query
 * @returns {boolean}
 */
function isLocationQuery(query) {
  return /\b(location|locations|office|offices|center|centers|county|counties|region|regions|nearest|where.*(office|located))\b/i.test(query);
}

// ── Engine instance ───────────────────────────────────────────────────────────

const engine = new RagEngine();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call once at server startup with the Gemini API key.
 * Loads the vector store from disk synchronously so it is available
 * immediately when the first request arrives.
 *
 * @param {string} apiKey
 * @returns {object}  Same shape as getStatus().
 */
function init(apiKey) {
  return engine.init({
    apiKey,
    vectorStorePath:      VECTOR_STORE_PATH,
    staticSupplementPath: LOCATIONS_STATIC_PATH,
    supplementLabel:      'OKSBDC Office Locations',
    // Must match the model used when the store was built (scripts/crawl.js).
    embeddingModel:       process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
    // General retrieval thresholds
    topK:      Number.parseInt(process.env.RAG_TOP_K       || '8',    10),
    minScore:  Number.parseFloat(process.env.RAG_MIN_SCORE  || '0.27'),
    maxPerUrl: Number.parseInt(process.env.RAG_MAX_PER_URL  || '2',   10),
    // Location-query thresholds (relaxed — address chunks score lower)
    isSpecialQuery:    isLocationQuery,
    specialTopK:       Number.parseInt(process.env.RAG_LOCATION_TOP_K      || '14',  10),
    specialMinScore:   Number.parseFloat(process.env.RAG_LOCATION_MIN_SCORE || '0.18'),
    specialMaxPerUrl:  Number.parseInt(process.env.RAG_LOCATION_MAX_PER_URL || '3',   10),
    specialQuerySuffix: 'OKSBDC office locations centers statewide regional offices',
    cacheMaxEntries:    Number.parseInt(process.env.RAG_CONTEXT_CACHE_MAX || '200', 10),
    preloadQueries:     getPreloadQueries(),
    preloadConcurrency: Number.parseInt(process.env.RAG_PRELOAD_CONCURRENCY || '2', 10),
    requestTimeoutMs:   Number.parseInt(process.env.RAG_REQUEST_TIMEOUT_MS || '12000', 10),
  });
}

/**
 * Embeds `query`, scores every chunk in the store, and returns the
 * top-k chunks formatted as a context block ready for injection into the
 * system prompt. Returns null when no chunks pass the threshold.
 *
 * @param {string}  query
 * @param {number}  [topK]
 * @returns {Promise<string|null>}
 */
async function getRelevantContext(query, topK) {
  return engine.getContext(query, topK);
}

/**
 * @returns {{ ready, chunkCount, hasEmbeddingModel, embeddingModel,
 *             locationsSupplementLoaded, lastInitError }}
 */
function getStatus() {
  const status = engine.getStatus();
  // Preserve the original field name for backward compatibility with the
  // health endpoint and any external consumers that rely on this shape.
  return {
    ...status,
    locationsSupplementLoaded: status.staticSupplementLoaded,
  };
}

function preloadContextBatch(queries) {
  return engine.preloadContextBatch(queries);
}

module.exports = { init, getRelevantContext, getStatus, preloadContextBatch };
