'use strict';
/**
 * lib/crawler.js
 *
 * Generic web crawler + embedding pipeline.
 *
 * Fetches HTML pages from configured seed URLs, extracts and chunks text
 * (with optional image OCR), embeds each chunk using the Gemini Embeddings
 * API, and writes the resulting vector store to disk. Supports resumable
 * crawls via an on-disk checkpoint file.
 *
 * ─── USAGE ────────────────────────────────────────────────────────────────
 *
 *   const { crawl } = require('./lib/crawler')
 *   await crawl({ apiKey, startUrls, allowedHostnames, outputPath, checkpointPath })
 *
 * ─── CONFIG ───────────────────────────────────────────────────────────────
 *
 *   Required:
 *     apiKey             {string}    Gemini API key.
 *     startUrls          {string[]}  Seed URLs to begin crawling from.
 *     allowedHostnames   {string[]}  Only follow links on these hostnames.
 *     outputPath         {string}    Where to write vector-store.json.
 *     checkpointPath     {string}    Where to save/restore crawl state.
 *
 *   Optional:
 *     embeddingModel     {string}    Default: 'gemini-embedding-2'
 *     chunkSize          {number}    Characters per chunk. Default: 600
 *     chunkOverlap       {number}    Overlap between adjacent chunks. Default: 100
 *     embedDelayMs       {number}    Delay between embedding calls (rate-limit
 *                                   cushion). Default: 250
 *     fetchTimeoutMs     {number}    Per-page fetch timeout. Default: 12000
 *     maxPages           {number}    Hard cap on pages crawled. Default: 300
 *     fresh              {boolean}   Ignore any saved checkpoint. Default: false
 *     enableOcr          {boolean}   Run Tesseract OCR on candidate images.
 *                                   Default: true
 *     ocrLanguage        {string}    Tesseract language pack. Default: 'eng'
 *     ocrMaxImagesPerPage {number}  Max images to OCR per page. Default: 3
 *     ocrMinTextLength   {number}   Discard OCR output shorter than this.
 *                                   Default: 40
 *     hostnameAliases    {object}   Map of hostname → canonical hostname used
 *                                   to normalise URLs before deduplication.
 *                                   e.g. { 'example.com': 'www.example.com' }
 *     getPreservedParams {Function} (hostname, pathname, params) => URLSearchParams|null
 *                                   Return a URLSearchParams to preserve
 *                                   specific query parameters for that URL,
 *                                   or null/undefined to strip all params.
 *                                   Useful when query params distinguish
 *                                   unique pages (e.g. ?id=123).
 *
 * ─── RETURNS ──────────────────────────────────────────────────────────────
 *
 *   Promise<{ pageCount: number, chunkCount: number }>
 */

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const { load }               = require('cheerio');
const { createGeminiAdapter } = require('./gemini-adapter');
const { createWorker }       = require('tesseract.js');

// ── URL helpers ───────────────────────────────────────────────────────────────

function makeIsAllowedUrl(allowedHostnames) {
  return function isAllowedUrl(urlStr) {
    try {
      return allowedHostnames.includes(new URL(urlStr).hostname);
    } catch {
      return false;
    }
  };
}

function makeNormalizeUrl(hostnameAliases, getPreservedParams) {
  return function normalizeUrl(href, base) {
    try {
      const u = new URL(href, base);
      u.hash = '';

      // Apply any caller-supplied hostname aliases (e.g. bare domain → www)
      if (hostnameAliases && hostnameAliases[u.hostname]) {
        u.hostname = hostnameAliases[u.hostname];
      }

      const hostname = u.hostname.toLowerCase();
      const pathname = u.pathname.toLowerCase();
      const params   = u.searchParams;

      // Let the caller decide which query params to preserve on a per-URL basis.
      if (getPreservedParams) {
        const preserved = getPreservedParams(hostname, pathname, params);
        u.search = (preserved && preserved.toString()) ? preserved.toString() : '';
      } else {
        u.search = '';
      }

      // Normalise to HTTPS and strip trailing slash from non-root paths.
      if (u.protocol === 'http:') u.protocol = 'https:';
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
      }

      return u.href;
    } catch {
      return null;
    }
  };
}

// ── Page fetch ────────────────────────────────────────────────────────────────

async function fetchHtml(url, fetchTimeoutMs) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'GenericRAGCrawler/1.0',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(fetchTimeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return null;
  return res.text();
}

// ── Text extraction ───────────────────────────────────────────────────────────

function extractText($) {
  $(
    'script, style, noscript, nav, footer, header, aside, ' +
    '[aria-hidden="true"], .menu, .navigation, .sidebar, ' +
    '.cookie-notice, .popup, iframe',
  ).remove();
  const text = $('body').text();
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ── OCR helpers ───────────────────────────────────────────────────────────────

function shouldPrioritizePage(url) {
  return /\b(about|contact|location|locations|office|offices|center|centers|advisor|advisors)\b/i.test(url);
}

function scoreImageCandidate($image, pageUrl, resolvedUrl) {
  const alt          = ($image.attr('alt')            || '').trim();
  const title        = ($image.attr('title')          || '').trim();
  const classes      = ($image.attr('class')          || '').trim();
  const dataSrc      = ($image.attr('data-src')       || '').trim();
  const dataFallback = ($image.attr('data-fallback')  || '').trim();
  const dataBgImage  = ($image.attr('data-bg-image')  || '').trim();
  const descriptor   = `${alt} ${title} ${classes} ${dataSrc} ${dataFallback} ${dataBgImage} ${resolvedUrl} ${pageUrl}`.toLowerCase();

  let score = 0;
  if (shouldPrioritizePage(pageUrl)) score += 3;
  if (/(office|location|contact|phone|advisor|center|county|region)/i.test(descriptor)) score += 4;
  if (/(map|directory|team|staff|about)/i.test(descriptor)) score += 2;

  const width  = Number.parseInt($image.attr('width')  || '0', 10);
  const height = Number.parseInt($image.attr('height') || '0', 10);
  if (width >= 250 || height >= 250) score += 1;
  if (/(logo|icon|badge|banner)/i.test(descriptor)) score -= 3;

  return { score, alt };
}

function collectImageSourceUrls($image, pageUrl, normalizeUrl) {
  const rawSources = [
    $image.attr('src'),
    $image.attr('data-src'),
    $image.attr('data-fallback'),
    $image.attr('data-bg-image'),
  ].filter(Boolean);

  const urls = [];
  const seen = new Set();
  for (const raw of rawSources) {
    const norm = normalizeUrl(raw, pageUrl);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    urls.push(norm);
  }
  return urls;
}

function findOcrCandidateImages($, pageUrl, { isAllowedUrl, normalizeUrl, ocrMaxImagesPerPage }) {
  const candidates = [];

  $('img, [data-bg-image]').each((_, el) => {
    const image      = $(el);
    const sourceUrls = collectImageSourceUrls(image, pageUrl, normalizeUrl);

    for (const resolvedUrl of sourceUrls) {
      if (!isAllowedUrl(resolvedUrl))                        continue;
      if (/\.(svg|gif)(\?|$)/i.test(resolvedUrl))            continue;
      if (/location.?map|map.?location/i.test(resolvedUrl)) continue;

      const { score, alt } = scoreImageCandidate(image, pageUrl, resolvedUrl);
      if (score < 3) continue;
      candidates.push({ url: resolvedUrl, alt, score });
    }
  });

  candidates.sort((a, b) => b.score - a.score);

  const unique = [];
  const seen   = new Set();
  for (const c of candidates) {
    if (seen.has(c.url)) continue;
    unique.push(c);
    seen.add(c.url);
    if (unique.length >= ocrMaxImagesPerPage) break;
  }
  return unique;
}

async function fetchImageBuffer(url, fetchTimeoutMs) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GenericRAGCrawler/1.0', Accept: 'image/*' },
    signal: AbortSignal.timeout(fetchTimeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) return null;
  return Buffer.from(await res.arrayBuffer());
}

function normalizeOcrText(text) {
  return text
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .filter(line => { const s = line.trim(); return s.length > 0 && /\w/.test(s); })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[|]{2,}/g, ' ')
    .replace(/^[\s•\-–—*]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractOcrTextForPage($, pageUrl, worker, opts) {
  if (!worker) return '';
  const images = findOcrCandidateImages($, pageUrl, opts);
  if (images.length === 0) return '';

  const blocks = [];
  for (const image of images) {
    try {
      const buffer = await fetchImageBuffer(image.url, opts.fetchTimeoutMs);
      if (!buffer) continue;
      const result = await worker.recognize(buffer);
      const text   = normalizeOcrText(result?.data?.text || '');
      if (text.length < opts.ocrMinTextLength) continue;
      blocks.push([
        `Image source: ${image.url}`,
        image.alt ? `Image alt: ${image.alt}` : null,
        'Image text:',
        text,
      ].filter(Boolean).join('\n'));
    } catch (err) {
      console.warn(`  OCR skipped ${image.url}: ${err.message}`);
    }
  }

  return blocks.length === 0 ? '' : `OCR EXTRACTED IMAGE TEXT\n\n${blocks.join('\n\n---\n\n')}`;
}

// ── Chunking & embedding ──────────────────────────────────────────────────────

function chunkText(text, chunkSize, chunkOverlap) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end   = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length >= 60) chunks.push(chunk);
    if (end === text.length) break;
    start += chunkSize - chunkOverlap;
  }
  return chunks;
}

async function embedText(embedModel, title, text) {
  return embedModel.embedWebDocument(title, text);
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
}

function loadCheckpoint(checkpointPath, embeddingModel, fresh) {
  if (fresh || !fs.existsSync(checkpointPath)) return null;
  try {
    const cp = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (cp?.embeddingModel && cp.embeddingModel !== embeddingModel) {
      console.warn(`Ignoring checkpoint built with ${cp.embeddingModel}; current model is ${embeddingModel}.`);
      return null;
    }
    if (!Array.isArray(cp?.queue) || !Array.isArray(cp?.visited) || !Array.isArray(cp?.records)) return null;
    return {
      pageCount: Number.isFinite(cp.pageCount) ? cp.pageCount : cp.visited.length,
      queue:     cp.queue,
      visited:   cp.visited,
      records:   cp.records,
    };
  } catch (err) {
    console.warn(`Unable to load checkpoint: ${err.message}`);
    return null;
  }
}

function saveCheckpoint(checkpointPath, outputPath, embeddingModel, { pageCount, queue, visited, records }) {
  writeJson(checkpointPath, {
    savedAt: new Date().toISOString(),
    embeddingModel,
    pageCount,
    queue,
    visited: [...visited],
    records,
  });
  writeJson(outputPath, records);
}

function clearCheckpoint(checkpointPath) {
  if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── CLI progress ─────────────────────────────────────────────────────────────

function truncateForTerminal(value, max) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function createProgressBar({ enabled, total, stream = process.stdout }) {
  const interactive = Boolean(enabled && stream.isTTY);
  let lastState = null;

  function format(state) {
    const current = Math.min(state.current || 0, total || 0);
    const ratio = total > 0 ? Math.min(current / total, 1) : 0;
    const width = 24;
    const filled = Math.round(ratio * width);
    const bar = `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
    const pct = `${Math.round(ratio * 100)}`.padStart(3, ' ');
    const status = truncateForTerminal(state.status || '', 64);

    return `Crawl [${bar}] ${pct}% | ${current}/${total} pages | ` +
      `${state.chunks || 0} chunks | ${state.queued || 0} queued | ${status}`;
  }

  function clearLine() {
    if (!interactive) return;
    readline.clearLine(stream, 0);
    readline.cursorTo(stream, 0);
  }

  return {
    render(state) {
      if (!interactive) return;
      lastState = state;
      clearLine();
      stream.write(format(state));
    },
    log(message = '') {
      if (!interactive) {
        console.log(message);
        return;
      }
      clearLine();
      console.log(message);
      if (lastState) {
        stream.write(format(lastState));
      }
    },
    finish() {
      if (!interactive) return;
      clearLine();
      lastState = null;
    },
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Crawl pages, embed chunks, and write a vector store to disk.
 *
 * @param {object} config  See module header for full field list.
 * @returns {Promise<{ pageCount: number, chunkCount: number }>}
 */
async function crawl(config) {
  const {
    apiKey,
    startUrls,
    allowedHostnames,
    outputPath,
    checkpointPath,
    embeddingModel      = 'gemini-embedding-2',
    chunkSize           = 600,
    chunkOverlap        = 100,
    embedDelayMs        = 250,
    fetchTimeoutMs      = 12000,
    maxPages            = 300,
    fresh               = false,
    enableOcr           = true,
    ocrLanguage         = 'eng',
    ocrMaxImagesPerPage = 3,
    ocrMinTextLength    = 40,
    hostnameAliases     = null,
    getPreservedParams  = null,
    showProgress        = process.stdout.isTTY,
  } = config;

  if (!apiKey)                   throw new Error('crawl: apiKey is required');
  if (!startUrls?.length)        throw new Error('crawl: startUrls is required');
  if (!allowedHostnames?.length) throw new Error('crawl: allowedHostnames is required');
  if (!outputPath)               throw new Error('crawl: outputPath is required');
  if (!checkpointPath)           throw new Error('crawl: checkpointPath is required');

  const embedModel = createGeminiAdapter({ apiKey, embeddingModel });

  const isAllowedUrl = makeIsAllowedUrl(allowedHostnames);
  const normalizeUrl = makeNormalizeUrl(hostnameAliases, getPreservedParams);

  const ocrOpts = { isAllowedUrl, normalizeUrl, ocrMaxImagesPerPage, ocrMinTextLength, fetchTimeoutMs };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  let ocrWorker = null;

  if (enableOcr) {
    console.log(`OCR       : enabled (${ocrLanguage}, max ${ocrMaxImagesPerPage} image(s)/page)`);
    ocrWorker = await createWorker(ocrLanguage);
  } else {
    console.log('OCR       : disabled');
  }

  try {
    if (fresh) clearCheckpoint(checkpointPath);

    const checkpoint = loadCheckpoint(checkpointPath, embeddingModel, fresh);
    const visited    = new Set(checkpoint?.visited || []);
    const queue      = checkpoint?.queue?.length ? [...checkpoint.queue] : [...startUrls];
    const queued     = new Set(queue);
    const records    = checkpoint?.records || [];
    let   pageCount  = checkpoint?.pageCount || 0;
    const progress = createProgressBar({ enabled: showProgress, total: maxPages });

    console.log(`\nRAG Crawler`);
    console.log(`Max pages : ${maxPages}`);
    console.log(`Model     : ${embeddingModel}`);
    console.log(`Output    : ${outputPath}\n`);

    if (checkpoint) {
      console.log(
        `Resuming from checkpoint: ${pageCount} page(s) crawled, ` +
        `${records.length} chunk(s) saved, ${queue.length} URL(s) queued.\n`,
      );
    }

    while (queue.length > 0 && pageCount < maxPages) {
      const url = queue.shift();
      queued.delete(url);

      if (visited.has(url)) continue;
      visited.add(url);
      pageCount++;

      progress.render({
        current: pageCount,
        queued: queue.length,
        chunks: records.length,
        status: `Fetching ${url}`,
      });

      let html;
      try {
        html = await fetchHtml(url, fetchTimeoutMs);
      } catch (err) {
        progress.log(`[${pageCount}/${maxPages}] SKIP ${url} (${err.message})`);
        saveCheckpoint(checkpointPath, outputPath, embeddingModel, { pageCount, queue, visited, records });
        continue;
      }

      if (!html) {
        progress.log(`[${pageCount}/${maxPages}] SKIP ${url} (not HTML or non-200)`);
        saveCheckpoint(checkpointPath, outputPath, embeddingModel, { pageCount, queue, visited, records });
        continue;
      }

      const $        = load(html);
      const title    = $('title').text().trim() || url;
      const bodyText = extractText($);
      const ocrText  = await extractOcrTextForPage($, url, ocrWorker, ocrOpts);
      const combined = [bodyText, ocrText].filter(Boolean).join('\n\n---\n\n');

      // Discover and enqueue new links
      $('a[href]').each((_, el) => {
        const href       = $(el).attr('href');
        const normalized = normalizeUrl(href, url);
        if (normalized && isAllowedUrl(normalized) && !visited.has(normalized) && !queued.has(normalized)) {
          queue.push(normalized);
          queued.add(normalized);
        }
      });

      if (!combined || combined.length < 60) {
        progress.log(`[${pageCount}/${maxPages}] SKIP ${url} (no content)`);
        saveCheckpoint(checkpointPath, outputPath, embeddingModel, { pageCount, queue, visited, records });
        continue;
      }

      const chunks = chunkText(combined, chunkSize, chunkOverlap);
      progress.render({
        current: pageCount,
        queued: queue.length,
        chunks: records.length,
        status: `Embedding ${chunks.length} chunk(s): ${title}`,
      });

      for (let i = 0; i < chunks.length; i++) {
        try {
          await sleep(embedDelayMs);
          const embedding = await embedText(embedModel, title, chunks[i]);
          records.push({ id: `${url}#chunk${i}`, url, title, text: chunks[i], embedding });
          progress.render({
            current: pageCount,
            queued: queue.length,
            chunks: records.length,
            status: `Embedding ${i + 1}/${chunks.length}: ${title}`,
          });
        } catch (err) {
          progress.log(`  ✗ Embed error chunk ${i}: ${err.message}`);
        }
      }

      progress.log(`[${pageCount}/${maxPages}] ${chunks.length} chunk(s), title: "${title.slice(0, 60)}"`);

      saveCheckpoint(checkpointPath, outputPath, embeddingModel, { pageCount, queue, visited, records });
    }

    progress.finish();
    console.log('\n──────────────────────────────────────');
    console.log(`Pages crawled : ${pageCount}`);
    console.log(`Chunks saved  : ${records.length}`);
    console.log(`Writing to    : ${outputPath}`);

    writeJson(outputPath, records);
    clearCheckpoint(checkpointPath);
    console.log('Done.\n');

    return { pageCount, chunkCount: records.length };
  } finally {
    if (ocrWorker) await ocrWorker.terminate();
  }
}

module.exports = { crawl };
