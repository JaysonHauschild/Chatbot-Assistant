/**
 * scripts/add-documents.js — Add local documents to the chatbot knowledgebase.
 *
 * Examples:
 *   node scripts/add-documents.js ./data/knowledge-documents
 *   node scripts/add-documents.js ./docs/policies.md ./docs/faq.txt
 *   node scripts/add-documents.js --dir ./data/knowledge-documents --fresh-docs
 *
 * Supported file types: .txt, .md, .markdown, .csv, .json, .html, .htm
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createGeminiAdapter } = require('../lib/gemini-adapter');
const {
  collectDocumentFiles,
  buildDocumentRecords,
  mergeDocumentRecords,
  SUPPORTED_DOCUMENT_EXTENSIONS,
} = require('../lib/knowledge-documents');

dotenv.config({ path: path.join(__dirname, '../.env') });

const DEFAULT_DOCUMENT_DIR = path.join(__dirname, '../data/knowledge-documents');
const DEFAULT_VECTOR_STORE_PATH = path.join(__dirname, '../data/vector-store.json');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    inputPaths: [],
    outputPath: DEFAULT_VECTOR_STORE_PATH,
    rootDir: null,
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
    chunkSize: 600,
    chunkOverlap: 100,
    embedDelayMs: 250,
    freshDocs: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--out' && next) {
      args.outputPath = path.resolve(next);
      index += 1;
    } else if (arg === '--dir' && next) {
      args.inputPaths.push(path.resolve(next));
      index += 1;
    } else if (arg === '--root' && next) {
      args.rootDir = path.resolve(next);
      index += 1;
    } else if (arg === '--model' && next) {
      args.embeddingModel = next;
      index += 1;
    } else if (arg === '--chunk-size' && next) {
      args.chunkSize = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === '--chunk-overlap' && next) {
      args.chunkOverlap = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === '--delay-ms' && next) {
      args.embedDelayMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === '--fresh-docs') {
      args.freshDocs = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (!arg.startsWith('--')) {
      args.inputPaths.push(path.resolve(arg));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!args.inputPaths.length) {
    args.inputPaths.push(DEFAULT_DOCUMENT_DIR);
  }

  if (!args.rootDir) {
    const firstDirectory = args.inputPaths.find((inputPath) => fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory());
    args.rootDir = firstDirectory || path.dirname(args.inputPaths[0]);
  }

  return args;
}

function printHelp() {
  console.log([
    'Add local documents to the chatbot knowledgebase.',
    '',
    'Usage:',
    '  node scripts/add-documents.js [files-or-directories]',
    '  node scripts/add-documents.js --dir ./data/knowledge-documents',
    '',
    'Options:',
    '  --out <path>            Vector store path. Default: server/data/vector-store.json',
    '  --dir <path>            Directory to scan. Can be repeated.',
    '  --root <path>           Root used for document:// source IDs.',
    '  --model <name>          Embedding model. Default: GEMINI_EMBEDDING_MODEL or gemini-embedding-2',
    '  --chunk-size <number>   Characters per chunk. Default: 600',
    '  --chunk-overlap <num>   Overlap between chunks. Default: 100',
    '  --delay-ms <number>     Delay between embedding calls. Default: 250',
    '  --fresh-docs            Remove all existing document:// chunks before adding these docs.',
    '',
    `Supported files: ${[...SUPPORTED_DOCUMENT_EXTENSIONS].join(', ')}`,
  ].join('\n'));
}

function readExistingVectorStore(outputPath) {
  if (!fs.existsSync(outputPath)) return [];

  const records = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  if (!Array.isArray(records)) {
    throw new Error(`Vector store is invalid: expected array at ${outputPath}`);
  }
  return records;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in server/.env');
  }

  const files = collectDocumentFiles(args.inputPaths);
  if (!files.length) {
    console.log(`No supported documents found. Looked for: ${[...SUPPORTED_DOCUMENT_EXTENSIONS].join(', ')}`);
    console.log(`Input paths: ${args.inputPaths.join(', ')}`);
    return;
  }

  const gemini = createGeminiAdapter({
    apiKey: process.env.GEMINI_API_KEY,
    embeddingModel: args.embeddingModel,
  });
  const existingRecords = readExistingVectorStore(args.outputPath);
  const baseRecords = args.freshDocs
    ? existingRecords.filter((record) => typeof record?.url !== 'string' || !record.url.startsWith('document://'))
    : existingRecords;

  console.log('Document knowledgebase ingestion');
  console.log(`Documents : ${files.length}`);
  console.log(`Model     : ${args.embeddingModel}`);
  console.log(`Output    : ${args.outputPath}`);

  const documentRecords = await buildDocumentRecords({
    files,
    rootDir: args.rootDir,
    chunkSize: args.chunkSize,
    chunkOverlap: args.chunkOverlap,
    delayMs: args.embedDelayMs,
    embedText: gemini.embedDocument,
    onProgress: (event) => {
      if (event.phase === 'document') {
        console.log(`\n${event.document.url}`);
        console.log(`  ${event.chunkCount} chunk(s) | ${event.document.title}`);
      } else if (event.phase === 'chunk') {
        process.stdout.write(`  embedded ${event.embeddedChunks}/${event.totalChunks} chunk(s)\r`);
      }
    },
  });

  if (documentRecords.length) process.stdout.write('\n');

  const nextRecords = mergeDocumentRecords(baseRecords, documentRecords);
  fs.mkdirSync(path.dirname(args.outputPath), { recursive: true });
  fs.writeFileSync(args.outputPath, JSON.stringify(nextRecords), 'utf8');

  console.log('\nDone.');
  console.log(`Added document chunks : ${documentRecords.length}`);
  console.log(`Total vector chunks   : ${nextRecords.length}`);
}

main().catch((error) => {
  console.error(`\nDocument ingestion failed: ${error.message}`);
  process.exit(1);
});
