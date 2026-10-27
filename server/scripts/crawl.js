/**
 * scripts/crawl.js  —  OKSBDC site crawler
 *
 * Thin wrapper around lib/crawler.js that supplies the OKSBDC-specific
 * configuration: seed URLs, allowed hostnames, and the query-param
 * preservation rules that make business.oksbdc.org detail-page URLs unique.
 *
 * Run once (or whenever the site content changes):
 *   node scripts/crawl.js
 *   node scripts/crawl.js --max-pages 50   (limit for testing)
 *   node scripts/crawl.js --fresh          (ignore any saved checkpoint)
 *   node scripts/crawl.js --no-progress    (disable terminal progress bar)
 *
 * All crawl behaviour (chunking, OCR, embedding, checkpointing) lives in
 * lib/crawler.js and can be reused for any site by supplying different config.
 */

'use strict';

const path   = require('path');
const dotenv = require('dotenv');
const { crawl } = require('../lib/crawler');

dotenv.config({ path: path.join(__dirname, '../.env') });

if (!process.env.GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY is not set in server/.env');
  process.exit(1);
}

// ── OKSBDC-specific URL config ────────────────────────────────────────────────

const ALLOWED_HOSTNAMES = ['www.oksbdc.org', 'oksbdc.org', 'business.oksbdc.org'];
const START_URLS        = ['https://www.oksbdc.org', 'https://business.oksbdc.org'];

/**
 * Hostname aliases used during URL normalisation.
 * Redirects bare oksbdc.org links to www.oksbdc.org so both are deduped
 * to the same canonical URL.
 */
const HOSTNAME_ALIASES = { 'oksbdc.org': 'www.oksbdc.org' };

/**
 * business.oksbdc.org uses query params as stable page identifiers.
 * Return a URLSearchParams that preserves only the params that distinguish
 * unique content pages; all other params (tracking, filters, etc.) are dropped.
 *
 * @param {string}          hostname
 * @param {string}          pathname  lower-cased
 * @param {URLSearchParams} params
 * @returns {URLSearchParams|null}
 */
function getPreservedParams(hostname, pathname, params) {
  if (hostname !== 'business.oksbdc.org') return null;

  const preserved = new URLSearchParams();

  if (pathname.endsWith('/workshop.aspx') && params.has('ekey')) {
    preserved.set('ekey', params.get('ekey'));
  } else if (pathname.endsWith('/reg.aspx')) {
    if (params.has('mode'))   preserved.set('mode',   params.get('mode'));
    if (params.has('event'))  preserved.set('event',  params.get('event'));
    if (params.has('center')) preserved.set('center', params.get('center'));
    if (params.has('subloc')) preserved.set('subloc', params.get('subloc'));
  } else if (pathname.endsWith('/center.aspx')) {
    if (params.has('center')) preserved.set('center', params.get('center'));
    if (params.has('subloc')) preserved.set('subloc', params.get('subloc'));
  }

  return preserved;
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const maxPagesArg = process.argv.indexOf('--max-pages');
const maxPages    = maxPagesArg !== -1 ? parseInt(process.argv[maxPagesArg + 1], 10) : 300;
const fresh       = process.argv.includes('--fresh');
const showProgress = !process.argv.includes('--no-progress') && process.env.CRAWL_PROGRESS !== 'false';

// ── Run ───────────────────────────────────────────────────────────────────────

crawl({
  apiKey:              process.env.GEMINI_API_KEY,
  startUrls:           START_URLS,
  allowedHostnames:    ALLOWED_HOSTNAMES,
  hostnameAliases:     HOSTNAME_ALIASES,
  getPreservedParams,
  outputPath:          path.join(__dirname, '../data/vector-store.json'),
  checkpointPath:      path.join(__dirname, '../data/crawl-state.json'),
  embeddingModel:      process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
  maxPages,
  fresh,
  showProgress,
  enableOcr:           process.env.ENABLE_IMAGE_OCR !== 'false',
  ocrLanguage:         process.env.OCR_LANGUAGE || 'eng',
  ocrMaxImagesPerPage: Number.parseInt(process.env.OCR_MAX_IMAGES_PER_PAGE || '3', 10),
  ocrMinTextLength:    Number.parseInt(process.env.OCR_MIN_TEXT_LENGTH    || '40', 10),
  embedDelayMs:        250,
  chunkSize:           600,
  chunkOverlap:        100,
}).catch(err => {
  console.error('\nCrawl failed:', err);
  process.exit(1);
});
