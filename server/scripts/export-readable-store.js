'use strict';

const fs = require('fs');
const path = require('path');

const INPUT_PATH = path.join(__dirname, '../data/vector-store.json');
const OUTPUT_PATH = path.join(__dirname, '../data/vector-store-readable.json');

function parseArgs() {
  const outIndex = process.argv.indexOf('--out');
  const outputPath = outIndex !== -1 && process.argv[outIndex + 1]
    ? path.resolve(process.argv[outIndex + 1])
    : OUTPUT_PATH;

  return { outputPath };
}

function groupRecords(records) {
  const grouped = new Map();

  for (const record of records) {
    const url = typeof record.url === 'string' ? record.url : 'unknown-url';
    const title = typeof record.title === 'string' ? record.title : url;
    const text = typeof record.text === 'string' ? record.text : '';

    if (!grouped.has(url)) {
      grouped.set(url, {
        url,
        title,
        chunkCount: 0,
        chunks: [],
      });
    }

    const entry = grouped.get(url);
    entry.chunkCount += 1;
    entry.chunks.push({
      index: entry.chunkCount - 1,
      text,
    });
  }

  return Array.from(grouped.values())
    .sort((a, b) => a.url.localeCompare(b.url));
}

function main() {
  const { outputPath } = parseArgs();

  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Vector store not found: ${INPUT_PATH}`);
    console.error('Run "npm run crawl" in the server folder first.');
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT_PATH, 'utf8');
  const records = JSON.parse(raw);

  if (!Array.isArray(records)) {
    console.error('Vector store format is invalid: expected a JSON array.');
    process.exit(1);
  }

  const grouped = groupRecords(records);

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFile: INPUT_PATH,
    totalChunks: records.length,
    totalPages: grouped.length,
    pages: grouped,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`Readable export written to ${outputPath}`);
  console.log(`Pages: ${payload.totalPages} | Chunks: ${payload.totalChunks}`);
}

main();
