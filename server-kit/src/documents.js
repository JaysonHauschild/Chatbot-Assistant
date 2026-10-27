'use strict';

const fs = require('fs');
const path = require('path');

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.html',
  '.htm',
]);

function normalizeDocumentText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function deriveDocumentTitle(filePath, text) {
  const headingMatch = text.match(/^\s*#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim().slice(0, 160);

  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine && firstLine.length <= 120) return firstLine;

  return (
    path
      .basename(filePath, path.extname(filePath))
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || path.basename(filePath)
  );
}

function slugifyDocumentPath(filePath, rootDir = process.cwd()) {
  const relative =
    path.relative(rootDir, filePath) || path.basename(filePath);
  return relative
    .split(path.sep)
    .join('/')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9/._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
    .toLowerCase();
}

function getDocumentUrl(filePath, rootDir) {
  return `document://${slugifyDocumentPath(filePath, rootDir)}`;
}

function collectDocumentFiles(inputPaths, options = {}) {
  const supportedExtensions =
    options.supportedExtensions || SUPPORTED_DOCUMENT_EXTENSIONS;
  const files = [];
  const seen = new Set();

  function visit(inputPath) {
    const resolved = path.resolve(inputPath);
    if (!fs.existsSync(resolved)) return;

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(resolved).sort()) {
        visit(path.join(resolved, entry));
      }
      return;
    }

    if (
      !stat.isFile() ||
      !supportedExtensions.has(
        path.extname(resolved).toLowerCase(),
      ) ||
      seen.has(resolved)
    ) {
      return;
    }

    seen.add(resolved);
    files.push(resolved);
  }

  for (const inputPath of inputPaths) visit(inputPath);
  return files;
}

function chunkText(text, chunkSize = 600, chunkOverlap = 100) {
  const chunks = [];
  const safeChunkSize = Math.max(
    100,
    Number.parseInt(chunkSize, 10) || 600,
  );
  const safeOverlap = Math.max(
    0,
    Math.min(
      Number.parseInt(chunkOverlap, 10) || 0,
      safeChunkSize - 1,
    ),
  );
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + safeChunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length >= 60) chunks.push(chunk);
    if (end === text.length) break;
    start += safeChunkSize - safeOverlap;
  }

  return chunks;
}

function readDocument(filePath, rootDir) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const text = normalizeDocumentText(raw);
  return {
    filePath,
    url: getDocumentUrl(filePath, rootDir),
    title: deriveDocumentTitle(filePath, text),
    text,
  };
}

async function buildDocumentRecords(options) {
  const {
    files,
    rootDir,
    embedText,
    chunkSize = 600,
    chunkOverlap = 100,
    delayMs = 0,
    onProgress = null,
  } = options;

  if (typeof embedText !== 'function') {
    throw new TypeError(
      'buildDocumentRecords: embedText function is required.',
    );
  }

  const records = [];
  const documents = files.map((filePath) =>
    readDocument(filePath, rootDir),
  );
  const totalChunks = documents.reduce(
    (total, document) =>
      total +
      chunkText(document.text, chunkSize, chunkOverlap).length,
    0,
  );
  let embeddedChunks = 0;

  for (const document of documents) {
    const chunks = chunkText(
      document.text,
      chunkSize,
      chunkOverlap,
    );
    onProgress?.({
      phase: 'document',
      document,
      chunkCount: chunks.length,
      embeddedChunks,
      totalChunks,
    });

    for (let index = 0; index < chunks.length; index += 1) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const embedding = await embedText(
        document.title,
        chunks[index],
        document,
      );
      records.push({
        id: `${document.url}#chunk${index}`,
        url: document.url,
        title: document.title,
        text: chunks[index],
        embedding,
        sourceType: 'document',
        sourcePath: path
          .relative(rootDir, document.filePath)
          .split(path.sep)
          .join('/'),
      });
      embeddedChunks += 1;
      onProgress?.({
        phase: 'chunk',
        document,
        chunkIndex: index,
        embeddedChunks,
        totalChunks,
      });
    }
  }

  return records;
}

function mergeDocumentRecords(existingRecords, documentRecords) {
  const replacementUrls = new Set(
    documentRecords.map((record) => record.url),
  );

  return [
    ...existingRecords.filter(
      (record) => !replacementUrls.has(record?.url),
    ),
    ...documentRecords,
  ];
}

module.exports = {
  SUPPORTED_DOCUMENT_EXTENSIONS,
  buildDocumentRecords,
  chunkText,
  collectDocumentFiles,
  deriveDocumentTitle,
  deriveTitle: deriveDocumentTitle,
  getDocumentUrl,
  mergeDocumentRecords,
  normalizeDocumentText,
  readDocument,
  slugifyDocumentPath,
};
