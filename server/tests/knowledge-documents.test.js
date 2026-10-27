'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectDocumentFiles,
  readDocument,
  buildDocumentRecords,
  mergeDocumentRecords,
} = require('../lib/knowledge-documents');

test('collectDocumentFiles finds supported document files recursively', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-docs-test-'));
  try {
    fs.mkdirSync(path.join(tempDir, 'nested'));
    fs.writeFileSync(path.join(tempDir, 'one.md'), '# One\n\nUseful content.'.repeat(10), 'utf8');
    fs.writeFileSync(path.join(tempDir, 'nested', 'two.txt'), 'Two document content.'.repeat(10), 'utf8');
    fs.writeFileSync(path.join(tempDir, 'ignored.pdf'), 'not supported', 'utf8');

    const files = collectDocumentFiles([tempDir]).map((filePath) => path.relative(tempDir, filePath).split(path.sep).join('/'));

    assert.deepEqual(files, ['nested/two.txt', 'one.md']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('readDocument normalizes text and builds document URLs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-doc-read-test-'));
  try {
    const filePath = path.join(tempDir, 'Policy Notes.html');
    fs.writeFileSync(filePath, '<h1>Policy Notes</h1><script>bad()</script><p>Plain text.</p>', 'utf8');

    const document = readDocument(filePath, tempDir);

    assert.equal(document.url, 'document://policy-notes.html');
    assert.equal(document.title, 'Policy Notes Plain text.');
    assert.equal(document.text.includes('<script>'), false);
    assert.match(document.text, /Policy Notes/);
    assert.match(document.text, /Plain text/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildDocumentRecords embeds chunks and mergeDocumentRecords replaces matching document sources only', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oksbdc-doc-build-test-'));
  try {
    const filePath = path.join(tempDir, 'faq.md');
    fs.writeFileSync(filePath, '# FAQ\n\nThis document explains advising intake steps and required preparation. '.repeat(12), 'utf8');

    const records = await buildDocumentRecords({
      files: [filePath],
      rootDir: tempDir,
      chunkSize: 140,
      chunkOverlap: 20,
      embedText: async (_title, text) => [text.length, 1, 0],
    });

    assert.ok(records.length > 1);
    assert.equal(records[0].url, 'document://faq.md');
    assert.equal(records[0].sourceType, 'document');
    assert.deepEqual(records[0].embedding, [records[0].text.length, 1, 0]);

    const merged = mergeDocumentRecords([
      { id: 'https://example.com#chunk0', url: 'https://example.com', title: 'Web', text: 'Web', embedding: [0] },
      { id: 'document://faq.md#chunk0', url: 'document://faq.md', title: 'Old', text: 'Old', embedding: [0] },
    ], records);

    assert.equal(merged.some((record) => record.title === 'Old'), false);
    assert.ok(merged.some((record) => record.url === 'https://example.com'));
    assert.equal(merged.filter((record) => record.url === 'document://faq.md').length, records.length);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
