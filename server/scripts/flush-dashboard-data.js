#!/usr/bin/env node

'use strict';

const path = require('path');
const readline = require('readline/promises');
const dotenv = require('dotenv');
const {
  DEFAULT_SERVER_ROOT,
  getOperationalDataPaths,
  collectOperationalDataFiles,
  flushOperationalDataFiles,
} = require('../lib/operational-data-cleanup');

function parseArgs(argv = process.argv.slice(2)) {
  const options = { dryRun: false, yes: false, help: false };

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function printHelp(output = process.stdout) {
  output.write([
    'Flush persisted chatbot logs and dashboard telemetry.',
    '',
    'Usage:',
    '  npm run dashboard:data:flush -- --dry-run',
    '  npm run dashboard:data:flush',
    '  npm run dashboard:data:flush -- --yes',
    '',
    'Options:',
    '  --dry-run   List files without deleting them.',
    '  --yes, -y   Skip the interactive FLUSH confirmation.',
    '  --help, -h  Show this help.',
    '',
  ].join('\n'));
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 ** 2)).toFixed(1)} MiB`;
}

function printPlan(files, output = process.stdout) {
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  output.write(`\nFiles selected: ${files.length} (${formatBytes(totalBytes)})\n`);
  for (const file of files) {
    output.write(`  - ${file.filePath} [${file.category}, ${formatBytes(file.size)}]\n`);
  }
  output.write([
    '',
    'Preserved: dashboard accounts, message-filter rules, rollback snapshots,',
    'active bans/Redis data, system prompts, knowledge documents, and vector stores.',
    '',
  ].join('\n'));
}

async function confirmFlush(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) return false;

  const prompt = readline.createInterface({ input, output });
  try {
    const answer = await prompt.question('Type FLUSH to permanently delete these files: ');
    return answer.trim() === 'FLUSH';
  } finally {
    prompt.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  dotenv.config({ path: path.join(DEFAULT_SERVER_ROOT, '.env') });
  const config = getOperationalDataPaths(process.env, DEFAULT_SERVER_ROOT);
  const files = collectOperationalDataFiles(config);

  console.log('Dashboard data flush');
  console.log('Stop the chatbot server first so it cannot write new events during cleanup.');
  printPlan(files);

  if (files.length === 0) {
    console.log('Nothing to flush.');
    return;
  }

  if (options.dryRun) {
    flushOperationalDataFiles(files, { dryRun: true });
    console.log('Dry run complete. No files were deleted.');
    return;
  }

  if (!options.yes && !(await confirmFlush())) {
    const suffix = process.stdin.isTTY
      ? 'Confirmation did not match FLUSH.'
      : 'Non-interactive use requires --yes.';
    throw new Error(`Cleanup cancelled. ${suffix}`);
  }

  const result = flushOperationalDataFiles(files);
  console.log(`Deleted ${result.deleted.length} file(s).`);
  if (result.missing.length > 0) console.log(`Skipped ${result.missing.length} file(s) that had already disappeared.`);
  if (result.failed.length > 0) {
    for (const failure of result.failed) {
      console.error(`Unable to delete ${failure.filePath}: ${failure.error}`);
    }
    throw new Error(`Failed to delete ${result.failed.length} file(s).`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, formatBytes, printPlan, confirmFlush, main };
