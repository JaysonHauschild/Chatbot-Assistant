'use strict';

const { notifyChatError } = require('./gemini-usage-alert');
const { workTracker } = require('./work-tracker');
/**
 * lib/rag-engine.js — Generic RAG retrieval engine.
 *
 * Handles vector-store loading, query embedding, cosine-similarity ranking,
 * and context-block formatting. All project-specific configuration (paths,
 * thresholds, special-query detectors) is supplied via init() so this module
 * can be reused across projects without modification.
 *
 * Usage:
 *   const { RagEngine } = require('./lib/rag-engine');
 *   const engine = new RagEngine();
 *   engine.init({ apiKey, vectorStorePath, embeddingModel, topK, minScore, ... });
 *   const context = await engine.getContext(queryString);
 *   const status  = engine.getStatus();
 *
 * init() config fields
 * ─────────────────────────────────────────────────────────────────
 *   Required:
 *     apiKey             {string}    Gemini API key.
 *     vectorStorePath    {string}    Absolute path to vector-store.json.
 *     embeddingModel     {string}    Model name used when the store was built.
 *
 *   Optional retrieval tuning:
 *     topK               {number}    Max chunks to return (default: 8).
 *     minScore           {number}    Minimum cosine score (default: 0.27).
 *     maxPerUrl          {number}    Max chunks per source URL (default: 2).
 *     cacheMaxEntries    {number}    Max query-context cache entries (default: 200).
 *     preloadQueries     {string[]}  Query batch to embed and cache after init.
 *     preloadConcurrency {number}    Concurrent preload embeddings (default: 2).
 *     requestTimeoutMs   {number}    Embedding request timeout (default: 12000).
 *
 *   Optional static supplement:
 *     staticSupplementPath {string} Path to a plain-text supplement file.
 *     supplementLabel      {string} Title label shown in the context block.
 *
 *   Optional special-query overrides (e.g. location queries):
 *     isSpecialQuery     {Function}  (query: string) => boolean
 *     specialTopK        {number}
 *     specialMinScore    {number}
 *     specialMaxPerUrl   {number}
 *     specialQuerySuffix {string}   Appended to the query before embedding.
 *
 * getStatus() returns:
 *   { ready, chunkCount, hasEmbeddingModel, embeddingModel,
 *     staticSupplementLoaded, lastInitError, contextCacheSize,
 *     preloadStatus, preloadRequested, preloadCompleted, preloadFailed }
 */

const fs = require('fs');
const { createGeminiAdapter } = require('./gemini-adapter');

// ── Cosine similarity ─────────────────────────────────────────────────────────

/**
 * Computes the cosine similarity between two equal-length numeric vectors.
 * Returns a value in [-1, 1]; returns 0 if either vector has zero magnitude.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function normalizeCacheText(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    : '';
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── RagEngine class ───────────────────────────────────────────────────────────

class RagEngine {
  constructor() {
    this._embedModel          = null;
    this._vectorStore         = [];
    this._isReady             = false;
    this._staticSupplementText = '';
    this._supplementLabel     = 'Supplement';
    this._lastInitError       = null;
    this._embeddingModel      = '';
    this._contextCache        = new Map();
    this._inFlightContextRequests = new Map();
    this._preloadStatus       = 'idle';
    this._preloadRequested    = 0;
    this._preloadCompleted    = 0;
    this._preloadFailed       = 0;
    this._preloadPromise      = null;

    // Retrieval config (populated by init)
    this._topK         = 8;
    this._minScore     = 0.27;
    this._maxPerUrl    = 2;
    this._cacheMaxEntries = 200;
    this._preloadConcurrency = 2;
    this._requestTimeoutMs = 12_000;

    // Special-query overrides
    this._isSpecialQuery    = null;
    this._specialTopK       = 8;
    this._specialMinScore   = 0.27;
    this._specialMaxPerUrl  = 2;
    this._specialQuerySuffix = '';
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _reset() {
    this._embedModel           = null;
    this._vectorStore          = [];
    this._isReady              = false;
    this._staticSupplementText = '';
    this._lastInitError        = null;
    this._contextCache.clear();
    this._inFlightContextRequests.clear();
    this._preloadStatus    = 'idle';
    this._preloadRequested = 0;
    this._preloadCompleted = 0;
    this._preloadFailed    = 0;
    this._preloadPromise   = null;
  }

  _buildContextCacheKey(queryText, topKOverride) {
    const normalizedQuery = normalizeCacheText(queryText);
    const isSpecial = this._isSpecialQuery ? this._isSpecialQuery(normalizedQuery) : false;
    const topK = Number.isFinite(topKOverride) ? topKOverride : (isSpecial ? this._specialTopK : this._topK);
    return `${isSpecial ? 'special' : 'general'}|topK:${topK}|${normalizedQuery}`;
  }

  _rememberContext(cacheKey, context) {
    if (!cacheKey || !context || this._cacheMaxEntries <= 0) return;

    if (this._contextCache.has(cacheKey)) {
      this._contextCache.delete(cacheKey);
    }
    this._contextCache.set(cacheKey, context);

    while (this._contextCache.size > this._cacheMaxEntries) {
      this._contextCache.delete(this._contextCache.keys().next().value);
    }
  }

  async _runPreloadQueue(queries) {
    const uniqueQueries = [...new Set(queries.map(normalizeCacheText).filter(Boolean))];
    this._preloadRequested = uniqueQueries.length;

    if (uniqueQueries.length === 0 || !this._isReady || !this._embedModel) {
      this._preloadStatus = uniqueQueries.length === 0 ? 'idle' : 'skipped';
      return this.getStatus();
    }

    this._preloadStatus = 'running';
    let nextIndex = 0;
    const workerCount = Math.min(this._preloadConcurrency, uniqueQueries.length);

    const worker = async () => {
      while (nextIndex < uniqueQueries.length) {
        const query = uniqueQueries[nextIndex];
        nextIndex += 1;

        try {
          await this.getContext(query);
          this._preloadCompleted += 1;
        } catch (err) {
          this._preloadFailed += 1;
          console.warn(`RagEngine: failed to preload context for "${query}": ${err?.message || err}`);
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    this._preloadStatus = this._preloadFailed > 0 ? 'completed_with_errors' : 'completed';
    console.log(`RagEngine: preloaded ${this._preloadCompleted}/${this._preloadRequested} RAG context queries into cache.`);
    return this.getStatus();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Initialises the engine with project-specific configuration.
   * Loads the vector store synchronously so it is ready before the first request.
   *
   * @param {object} config  See module-level JSDoc for field descriptions.
   * @returns {object}  Same shape as getStatus().
   */
  init(config = {}) {
    this._reset();

    const {
      apiKey,
      vectorStorePath,
      staticSupplementPath,
      supplementLabel     = 'Supplement',
      embeddingModel      = 'gemini-embedding-2',
      topK                = 8,
      minScore            = 0.27,
      maxPerUrl           = 2,
      isSpecialQuery      = null,
      specialTopK         = topK,
      specialMinScore     = minScore,
      specialMaxPerUrl    = maxPerUrl,
      specialQuerySuffix  = '',
      cacheMaxEntries     = 200,
      preloadQueries      = [],
      preloadConcurrency  = 2,
      requestTimeoutMs    = 12_000,
    } = config;

    this._embeddingModel     = embeddingModel;
    this._supplementLabel    = supplementLabel;
    this._topK               = topK;
    this._minScore           = minScore;
    this._maxPerUrl          = maxPerUrl;
    this._cacheMaxEntries   = parseNonNegativeInteger(cacheMaxEntries, 200);
    this._preloadConcurrency = Math.max(1, parsePositiveInteger(preloadConcurrency, 2));
    this._requestTimeoutMs   = parsePositiveInteger(requestTimeoutMs, 12_000);
    this._isSpecialQuery     = typeof isSpecialQuery === 'function' ? isSpecialQuery : null;
    this._specialTopK        = specialTopK;
    this._specialMinScore    = specialMinScore;
    this._specialMaxPerUrl   = specialMaxPerUrl;
    this._specialQuerySuffix = typeof specialQuerySuffix === 'string' ? specialQuerySuffix : '';

    if (!apiKey || typeof apiKey !== 'string') {
      this._lastInitError = 'apiKey is required to initialize RagEngine.';
      console.warn(`RagEngine: ${this._lastInitError} Falling back to system-prompt-only mode.`);
      return this.getStatus();
    }

    this._embedModel = createGeminiAdapter({
      apiKey,
      embeddingModel,
      requestTimeoutMs: this._requestTimeoutMs,
    });

    if (!vectorStorePath || !fs.existsSync(vectorStorePath)) {
      const msg = vectorStorePath
        ? `vector store not found at ${vectorStorePath}. Run "npm run crawl" to build it.`
        : 'vectorStorePath is required.';
      console.warn(`RagEngine: ${msg} Falling back to system-prompt-only mode.`);
      this._lastInitError = 'vector_store_missing';
      return this.getStatus();
    }

    try {
      this._vectorStore = JSON.parse(fs.readFileSync(vectorStorePath, 'utf8'));
      this._isReady = this._vectorStore.length > 0;
      if (!this._isReady) {
        this._lastInitError = 'vector_store_empty';
      }
      console.log(`RagEngine: loaded ${this._vectorStore.length} chunks from vector store using ${embeddingModel}.`);
    } catch (err) {
      this._vectorStore   = [];
      this._isReady       = false;
      this._lastInitError = err?.message || 'vector_store_parse_failed';
      console.error('RagEngine: failed to load vector store:', err.message);
    }

    if (staticSupplementPath && fs.existsSync(staticSupplementPath)) {
      try {
        this._staticSupplementText = fs.readFileSync(staticSupplementPath, 'utf8').trim();
        console.log(`RagEngine: loaded static supplement "${supplementLabel}".`);
      } catch (err) {
        console.error('RagEngine: failed to load static supplement:', err.message);
      }
    }

    if (Array.isArray(preloadQueries) && preloadQueries.length > 0) {
      this._preloadStatus = 'queued';
      this._preloadPromise = workTracker.trackBackgroundTask(() => this._runPreloadQueue(preloadQueries)).catch((err) => {
        this._preloadStatus = 'failed';
        this._lastInitError = err?.message || 'context_preload_failed';
        console.error('RagEngine: context preload failed:', err.message);
      });
    }

    return this.getStatus();
  }

  /**
   * Embeds `query`, ranks all chunks in the store by cosine similarity, and
   * returns the top-k chunks as a formatted context block for prompt injection.
   * Returns null when no chunks pass the threshold or the store is not ready.
   *
   * @param {string}  query
   * @param {number}  [topKOverride]  Overrides the configured topK when provided.
   * @returns {Promise<string|null>}
   */
  async getContext(query, topKOverride) {
    if (!this._isReady || !this._embedModel) return null;

    const queryText = typeof query === 'string' ? query.trim() : '';
    if (!queryText) return null;

    const cacheKey = this._buildContextCacheKey(queryText, topKOverride);
    if (this._contextCache.has(cacheKey)) {
      const cachedContext = this._contextCache.get(cacheKey);
      // Refresh insertion order so active entries survive LRU eviction.
      this._contextCache.delete(cacheKey);
      this._contextCache.set(cacheKey, cachedContext);
      return cachedContext;
    }

    if (this._inFlightContextRequests.has(cacheKey)) {
      return this._inFlightContextRequests.get(cacheKey);
    }

    const contextPromise = workTracker.trackBackgroundTask(() => this._getContextUncached(queryText, topKOverride, cacheKey));
    this._inFlightContextRequests.set(cacheKey, contextPromise);

    try {
      return await contextPromise;
    } finally {
      this._inFlightContextRequests.delete(cacheKey);
    }
  }

  async _getContextUncached(queryText, topKOverride, cacheKey) {
    const isSpecial = this._isSpecialQuery ? this._isSpecialQuery(queryText) : false;

    const topK       = Number.isFinite(topKOverride) ? topKOverride : (isSpecial ? this._specialTopK    : this._topK);
    const minScore   = isSpecial ? this._specialMinScore   : this._minScore;
    const maxPerUrl  = isSpecial ? this._specialMaxPerUrl  : this._maxPerUrl;
    const embeddingQuery = (isSpecial && this._specialQuerySuffix)
      ? `${queryText} ${this._specialQuerySuffix}`
      : queryText;

    let queryEmbedding;
    try {
      queryEmbedding = await this._embedModel.embedQuery(embeddingQuery);
    } catch (err) {
      void notifyChatError(err, 'RAG embedding');
      console.error('RagEngine: embedding query failed:', err.message);
      return null;
    }

    const scored = this._vectorStore.map((chunk) => ({
      url:   chunk.url,
      title: chunk.title,
      text:  chunk.text,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    // Sort descending — most semantically similar chunks first.
    scored.sort((a, b) => b.score - a.score);

    // Collect up to topK chunks, enforcing minScore and the per-URL cap.
    const top = [];
    const perUrlCount = new Map();

    for (const chunk of scored) {
      if (chunk.score < minScore) continue;
      const count = perUrlCount.get(chunk.url) || 0;
      if (count >= maxPerUrl) continue;

      top.push(chunk);
      perUrlCount.set(chunk.url, count + 1);

      if (top.length >= topK) break;
    }

    const vectorChunks = top.map(
      (c) => `Source: ${c.url}\nTitle: ${c.title}\n\n${c.text}`,
    );

    // Prepend the static supplement when this is a special query and the
    // supplement was loaded.
    if (isSpecial && this._staticSupplementText) {
      const context = [
        `Source: static-supplement\nTitle: ${this._supplementLabel}\n\n${this._staticSupplementText}`,
        ...vectorChunks,
      ].join('\n\n---\n\n');
      this._rememberContext(cacheKey, context);
      return context;
    }

    if (top.length === 0) return null;

    const context = vectorChunks.join('\n\n---\n\n');
    this._rememberContext(cacheKey, context);
    return context;
  }

  preloadContextBatch(queries = []) {
    if (!Array.isArray(queries)) {
      return Promise.reject(new TypeError('queries must be an array of strings'));
    }

    this._preloadPromise = workTracker.trackBackgroundTask(() => this._runPreloadQueue(queries));
    return this._preloadPromise;
  }

  /**
   * Returns a snapshot of the current engine state for health checks and logs.
   *
   * @returns {{ ready: boolean, chunkCount: number, hasEmbeddingModel: boolean,
   *             embeddingModel: string, staticSupplementLoaded: boolean,
   *             lastInitError: string|null }}
   */
  getStatus() {
    return {
      ready:                  this._isReady,
      chunkCount:             this._vectorStore.length,
      hasEmbeddingModel:      Boolean(this._embedModel),
      embeddingModel:         this._embeddingModel,
      staticSupplementLoaded: Boolean(this._staticSupplementText),
      lastInitError:          this._lastInitError,
      contextCacheSize:       this._contextCache.size,
      preloadStatus:          this._preloadStatus,
      preloadRequested:       this._preloadRequested,
      preloadCompleted:       this._preloadCompleted,
      preloadFailed:          this._preloadFailed,
      requestTimeoutMs:       this._requestTimeoutMs,
    };
  }
}

module.exports = { RagEngine };
