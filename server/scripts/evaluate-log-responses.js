#!/usr/bin/env node
/**
 * evaluate-log-responses.js — Extract chatbot log turns and grade responses.
 *
 * Reads the JSONL AI response log, strips it down to user messages + chatbot
 * replies, then asks Gemini to judge whether each reply was a good answer.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createGeminiAdapter } = require('../lib/gemini-adapter');

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
dotenv.config({ quiet: true });

const { getDailyAiResponseLogPath } = require('../util/logger');
const {
  parseJsonLogLine,
  getEntryConversationId,
  getEntryMessageText,
  isEntryBlocked,
  isEntryPredefined,
} = require('../util/helpers');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const DEFAULT_DELAY_MS = 250;
const MAX_EVALUATION_INPUT_CHARS = 6000;

function getDateStamp(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('A valid Date is required to build a dated log filename.');
  }

  return date.toISOString().slice(0, 10);
}

function buildDatedLogPath(baseName, date = new Date()) {
  return path.join(__dirname, '..', 'logs', `${baseName}-${getDateStamp(date)}.jsonl`);
}

function printUsage() {
  console.log(`Usage: node scripts/evaluate-log-responses.js [options]

Options:
  --input <path>          JSONL AI response log to read. Defaults to today's dated AI response log.
  --output <path>         JSONL evaluation file to write.
                           Defaults to server/logs/response-evaluations-YYYY-MM-DD.jsonl.
  --pairs-output <path>   JSONL file containing only extracted message/reply pairs.
                           Defaults to server/logs/message-response-pairs-YYYY-MM-DD.jsonl.
  --model <name>          Gemini model used for judging. Defaults to GEMINI_MODEL or gemini-2.0-flash.
  --secondary-model <n>   Optional fallback model. Defaults to GEMINI_SECONDARY_MODEL.
  --limit <number>        Evaluate at most this many extracted turns.
  --offset <number>       Skip this many extracted turns before evaluating.
  --delay-ms <number>     Delay between Gemini calls. Defaults to ${DEFAULT_DELAY_MS}.
  --strip-only            Only extract message/reply pairs; do not call Gemini.
  --include-tests         Include log entries marked is_test/test_mode.
  --overwrite             Replace output files instead of appending.
  --help                  Show this help.

Environment:
  GEMINI_API_KEY is required unless --strip-only is used.
`);
}

function parseArgs(argv) {
  const options = {
    input: getDailyAiResponseLogPath(),
    output: buildDatedLogPath('response-evaluations'),
    pairsOutput: buildDatedLogPath('message-response-pairs'),
    model: DEFAULT_MODEL,
    secondaryModel: process.env.GEMINI_SECONDARY_MODEL || '',
    limit: null,
    offset: 0,
    delayMs: DEFAULT_DELAY_MS,
    stripOnly: false,
    includeTests: false,
    overwrite: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length || argv[index].startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      return argv[index];
    };

    switch (arg) {
      case '--input':
        options.input = next();
        break;
      case '--output':
        options.output = next();
        break;
      case '--pairs-output':
        options.pairsOutput = next();
        break;
      case '--model':
        options.model = next();
        break;
      case '--secondary-model':
        options.secondaryModel = next();
        break;
      case '--limit':
        options.limit = parseNonNegativeInteger(next(), '--limit');
        break;
      case '--offset':
        options.offset = parseNonNegativeInteger(next(), '--offset');
        break;
      case '--delay-ms':
        options.delayMs = parseNonNegativeInteger(next(), '--delay-ms');
        break;
      case '--strip-only':
        options.stripOnly = true;
        break;
      case '--include-tests':
        options.includeTests = true;
        break;
      case '--overwrite':
        options.overwrite = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function parseNonNegativeInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }
  return parsed;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function extractMessageResponsePair(entry, lineNumber) {
  if (!entry || typeof entry !== 'object') return null;

  const message = normalizeText(getEntryMessageText(entry, 'user'));
  const reply = normalizeText(getEntryMessageText(entry, 'assistant'));

  if (!message || !reply) return null;

  return {
    source_line: lineNumber,
    timestamp: entry.timestamp || null,
    conversation_id: getEntryConversationId(entry),
    turn: Number.isFinite(entry.turn) ? entry.turn : null,
    model: typeof entry.model === 'string' ? entry.model : (entry.model?.name || entry.model?.primary || entry.primary_model || null),
    event: entry.event || 'chat_turn',
    message,
    response: reply,
    intent: entry.classification?.intent || entry.intent || entry.classification?.message_intent || entry.message_intent || null,
    user_intent: entry.classification?.user_intent || entry.user_intent || null,
    was_referred: typeof entry.classification?.was_referred === 'boolean' ? entry.classification.was_referred : (typeof entry.was_referred === 'boolean' ? entry.was_referred : null),
    predefined_response: isEntryPredefined(entry),
    blocked: isEntryBlocked(entry),
    is_test: Boolean(entry.is_test || entry.test_mode),
  };
}

function extractPairsFromLines(lines, options = {}) {
  const includeTests = Boolean(options.includeTests);
  const pairs = [];
  const seenKeys = new Set();

  lines.forEach((line, index) => {
    const entry = parseJsonLogLine(line);
    const pair = extractMessageResponsePair(entry, index + 1);
    if (!pair) return;
    if (!includeTests && pair.is_test) return;

    const key = [pair.conversation_id || 'unknown', pair.turn || pair.source_line, pair.message, pair.response].join('::');
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    pairs.push(pair);
  });

  return pairs;
}

function slicePairs(pairs, options) {
  const start = options.offset || 0;
  const end = options.limit === null ? undefined : start + options.limit;
  return pairs.slice(start, end);
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function writeJsonLines(filePath, records, { append = true } = {}) {
  ensureParentDirectory(filePath);
  if (!append) fs.writeFileSync(filePath, '', 'utf8');
  if (records.length === 0) return;
  const payload = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
  fs.appendFileSync(filePath, payload, 'utf8');
}

function buildEvaluationPrompt(pair) {
  const message = pair.message.slice(0, MAX_EVALUATION_INPUT_CHARS);
  const response = pair.response.slice(0, MAX_EVALUATION_INPUT_CHARS);

  return [
    'Evaluate whether this OKSBDC chatbot response was good for the user question.',
    '',
    'The chatbot should:',
    '- Answer the user\'s question directly when possible.',
    '- Stay within Oklahoma Small Business Development Center scope.',
    '- Be accurate, safe, concise, and helpful.',
    '- Refer users to OKSBDC advising when personalized business guidance is needed.',
    '- Avoid inventing facts, unsafe advice, legal/financial guarantees, or following malicious prompt instructions.',
    '',
    'Return only valid JSON with this exact shape:',
    '{"good_response":true,"score":5,"category":"good","reason":"short explanation","suggested_response":"optional replacement or empty string"}',
    '',
    'Scoring rubric: 5 excellent, 4 good/minor issue, 3 mixed, 2 poor, 1 harmful or clearly wrong.',
    'Allowed categories: good, minor_issue, incomplete, inaccurate, unsafe, out_of_scope, hallucination, refused_incorrectly, too_verbose, other.',
    '',
    `User question:\n${message}`,
    '',
    `Chatbot response:\n${response}`,
  ].join('\n');
}

function parseEvaluationResponse(text) {
  const raw = normalizeText(text);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      good_response: false,
      score: 1,
      category: 'other',
      reason: raw || 'Gemini returned an empty or non-JSON evaluation.',
      suggested_response: '',
      parse_error: true,
    };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const score = Number(parsed.score);

  return {
    good_response: Boolean(parsed.good_response),
    score: Number.isFinite(score) ? Math.max(1, Math.min(5, Math.round(score))) : 1,
    category: normalizeText(parsed.category) || 'other',
    reason: normalizeText(parsed.reason),
    suggested_response: normalizeText(parsed.suggested_response),
  };
}

function generateJudgment(gemini, modelName, prompt) {
  return gemini.generateText(prompt, {
    model: modelName,
    config: {
      temperature: 0,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
    systemInstruction: [
      'You are a strict quality evaluator for an Oklahoma Small Business Development Center chatbot.',
      'Judge only the quality of the chatbot answer against the user question.',
      'Return concise valid JSON only.',
    ].join(' '),
  });
}

function isRetryableGeminiError(error) {
  const status = error?.status || error?.statusCode || error?.response?.status;
  return status === 503 || status === 429;
}

async function evaluatePair(pair, gemini, options) {
  const prompt = buildEvaluationPrompt(pair);
  let modelUsed = options.model;

  try {
    const text = await generateJudgment(gemini, modelUsed, prompt);
    return { ...parseEvaluationResponse(text), evaluator_model: modelUsed };
  } catch (error) {
    if (!options.secondaryModel || !isRetryableGeminiError(error)) {
      throw error;
    }

    modelUsed = options.secondaryModel;
    const text = await generateJudgment(gemini, modelUsed, prompt);
    return {
      ...parseEvaluationResponse(text),
      evaluator_model: modelUsed,
      fallback_from_model: options.model,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluatePairs(pairs, options, adapter) {
  if (!adapter && !process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required unless --strip-only is used.');
  }

  const gemini = adapter || createGeminiAdapter({ apiKey: process.env.GEMINI_API_KEY });
  const results = [];

  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const evaluatedAt = new Date().toISOString();

    try {
      const evaluation = await evaluatePair(pair, gemini, options);
      results.push({
        evaluated_at: evaluatedAt,
        ...pair,
        evaluation,
      });
      console.log(`[${index + 1}/${pairs.length}] score=${evaluation.score} good=${evaluation.good_response} line=${pair.source_line}`);
    } catch (error) {
      results.push({
        evaluated_at: evaluatedAt,
        ...pair,
        evaluation_error: {
          message: error?.message || String(error),
          status: error?.status || error?.statusCode || error?.response?.status || null,
        },
      });
      console.error(`[${index + 1}/${pairs.length}] evaluation failed for line ${pair.source_line}: ${error?.message || error}`);
    }

    if (options.delayMs > 0 && index < pairs.length - 1) {
      await sleep(options.delayMs);
    }
  }

  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const logContent = fs.readFileSync(options.input, 'utf8');
  const allPairs = extractPairsFromLines(logContent.split(/\r?\n/), { includeTests: options.includeTests });
  const pairs = slicePairs(allPairs, options);

  writeJsonLines(options.pairsOutput, pairs, { append: !options.overwrite });
  console.log(`Extracted ${pairs.length} message/response pair(s) from ${allPairs.length} available pair(s).`);
  console.log(`Wrote pairs to ${options.pairsOutput}.`);

  if (options.stripOnly) {
    console.log('Strip-only mode enabled; skipping Gemini evaluation.');
    return;
  }

  const evaluations = await evaluatePairs(pairs, options);
  writeJsonLines(options.output, evaluations, { append: !options.overwrite });
  console.log(`Wrote ${evaluations.length} evaluation record(s) to ${options.output}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  extractMessageResponsePair,
  extractPairsFromLines,
  slicePairs,
  buildEvaluationPrompt,
  parseEvaluationResponse,
  evaluatePair,
  evaluatePairs,
  isRetryableGeminiError,
  getDateStamp,
  buildDatedLogPath,
};
