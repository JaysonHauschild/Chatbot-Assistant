'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../scripts/evaluate-log-responses');
const { createGeminiAdapter } = require('../lib/gemini-adapter');

test('default evaluator log paths include the current date so output rolls daily', () => {
  const date = new Date('2026-06-03T12:34:56.000Z');

  assert.equal(getDateStamp(date), '2026-06-03');
  assert.match(buildDatedLogPath('response-evaluations', date), /server\/logs\/response-evaluations-2026-06-03\.jsonl$/);
  assert.match(buildDatedLogPath('message-response-pairs', date), /server\/logs\/message-response-pairs-2026-06-03\.jsonl$/);

  const options = parseArgs([]);
  assert.match(options.output, /server\/logs\/response-evaluations-\d{4}-\d{2}-\d{2}\.jsonl$/);
  assert.match(options.pairsOutput, /server\/logs\/message-response-pairs-\d{4}-\d{2}-\d{2}\.jsonl$/);
});

test('extractMessageResponsePair supports current and legacy chat log fields', () => {
  assert.deepEqual(
    extractMessageResponsePair({
      timestamp: '2026-01-01T00:00:00.000Z',
      conversation_id: 'conv-1',
      turn: 2,
      model: 'gemini-test',
      user_message_redacted: 'How do I start?',
      bot_reply_redacted: 'Start with a plan.',
      intent: 'basic_info',
      was_referred: false,
    }, 12),
    {
      source_line: 12,
      timestamp: '2026-01-01T00:00:00.000Z',
      conversation_id: 'conv-1',
      turn: 2,
      model: 'gemini-test',
      event: 'chat_turn',
      message: 'How do I start?',
      response: 'Start with a plan.',
      intent: 'basic_info',
      user_intent: null,
      was_referred: false,
      predefined_response: false,
      blocked: false,
      is_test: false,
    },
  );

  const legacyPair = extractMessageResponsePair({
    conversationId: 'conv-2',
    message: 'Where are you located?',
    reply: 'Visit oksbdc.org.',
    predefined_response: true,
    is_test: true,
  }, 4);

  assert.equal(legacyPair.conversation_id, 'conv-2');
  assert.equal(legacyPair.message, 'Where are you located?');
  assert.equal(legacyPair.response, 'Visit oksbdc.org.');
  assert.equal(legacyPair.predefined_response, true);
  assert.equal(legacyPair.is_test, true);

  assert.equal(extractMessageResponsePair({ message: 'missing reply' }, 1), null);
  assert.equal(extractMessageResponsePair({ reply: 'missing message' }, 1), null);
});

test('extractPairsFromLines strips JSONL logs to unique non-test message/response pairs by default', () => {
  const lines = [
    JSON.stringify({ conversation_id: 'conv', turn: 1, user_message_redacted: 'Q1', bot_reply_redacted: 'A1' }),
    JSON.stringify({ conversation_id: 'conv', turn: 1, user_message_redacted: 'Q1', bot_reply_redacted: 'A1' }),
    JSON.stringify({ conversation_id: 'conv', turn: 2, user_message_redacted: 'Q2', bot_reply_redacted: 'A2', is_test: true }),
    JSON.stringify({ event: 'model_call_failed', user_message_redacted: 'Q3' }),
    'not-json',
  ];

  const defaultPairs = extractPairsFromLines(lines);
  assert.equal(defaultPairs.length, 1);
  assert.equal(defaultPairs[0].message, 'Q1');

  const withTests = extractPairsFromLines(lines, { includeTests: true });
  assert.equal(withTests.length, 2);
  assert.equal(withTests[1].message, 'Q2');
});

test('parseArgs handles evaluation script options and validates numbers', () => {
  const options = parseArgs([
    '--input', 'in.jsonl',
    '--output', 'out.jsonl',
    '--pairs-output', 'pairs.jsonl',
    '--model', 'gemini-primary',
    '--secondary-model', 'gemini-secondary',
    '--limit', '5',
    '--offset', '2',
    '--delay-ms', '0',
    '--strip-only',
    '--include-tests',
    '--overwrite',
  ]);

  assert.equal(options.input, 'in.jsonl');
  assert.equal(options.output, 'out.jsonl');
  assert.equal(options.pairsOutput, 'pairs.jsonl');
  assert.equal(options.model, 'gemini-primary');
  assert.equal(options.secondaryModel, 'gemini-secondary');
  assert.equal(options.limit, 5);
  assert.equal(options.offset, 2);
  assert.equal(options.delayMs, 0);
  assert.equal(options.stripOnly, true);
  assert.equal(options.includeTests, true);
  assert.equal(options.overwrite, true);

  assert.throws(() => parseArgs(['--limit', '-1']), /non-negative integer/);
  assert.throws(() => parseArgs(['--input']), /requires a value/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
});

test('slicePairs applies offset and limit', () => {
  const pairs = ['a', 'b', 'c', 'd'];
  assert.deepEqual(slicePairs(pairs, { offset: 1, limit: 2 }), ['b', 'c']);
  assert.deepEqual(slicePairs(pairs, { offset: 2, limit: null }), ['c', 'd']);
});

test('buildEvaluationPrompt and parseEvaluationResponse produce evaluator JSON payloads', () => {
  const prompt = buildEvaluationPrompt({ message: 'Can I get a grant?', response: 'Talk to an advisor.' });
  assert.match(prompt, /OKSBDC chatbot response/);
  assert.match(prompt, /Can I get a grant\?/);
  assert.match(prompt, /Talk to an advisor\./);

  assert.deepEqual(parseEvaluationResponse('{"good_response":true,"score":4,"category":"minor_issue","reason":"Helpful","suggested_response":""}'), {
    good_response: true,
    score: 4,
    category: 'minor_issue',
    reason: 'Helpful',
    suggested_response: '',
  });

  const clamped = parseEvaluationResponse('{"good_response":false,"score":99,"category":"unsafe","reason":"Bad"}');
  assert.equal(clamped.score, 5);
  assert.equal(clamped.good_response, false);

  const malformed = parseEvaluationResponse('not json');
  assert.equal(malformed.parse_error, true);
  assert.equal(malformed.good_response, false);
});

test('isRetryableGeminiError only accepts rate-limit and unavailable statuses', () => {
  assert.equal(isRetryableGeminiError({ status: 503 }), true);
  assert.equal(isRetryableGeminiError({ response: { status: 429 } }), true);
  assert.equal(isRetryableGeminiError({ statusCode: 400 }), false);
});

const evaluationText = JSON.stringify({ good_response: true, score: 4, category: 'minor_issue', reason: 'Helpful', suggested_response: '' });
const evaluationPair = { source_line: 7, message: 'How do I start a business?', response: 'Start with a plan.' };
const evaluationOptions = { model: 'judge-primary', secondaryModel: 'judge-secondary', delayMs: 0 };

test('evaluation uses gemini-kit with the existing prompt, settings, and output fields', async () => {
  const requests = [];
  const gemini = createGeminiAdapter({
    client: { models: { async generateContent(request) {
      requests.push(request);
      return { text: evaluationText };
    } } },
  });
  assert.deepEqual(await evaluatePair(evaluationPair, gemini, evaluationOptions), {
    ...parseEvaluationResponse(evaluationText), evaluator_model: 'judge-primary',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'judge-primary');
  assert.equal(requests[0].contents, buildEvaluationPrompt(evaluationPair));
  assert.deepEqual(requests[0].config, {
    temperature: 0,
    maxOutputTokens: 512,
    responseMimeType: 'application/json',
    systemInstruction: [
      'You are a strict quality evaluator for an Oklahoma Small Business Development Center chatbot.',
      'Judge only the quality of the chatbot answer against the user question.',
      'Return concise valid JSON only.',
    ].join(' '),
  });
});

test('evaluation falls back once on wrapped 429 and 503 errors without retrying the primary', async () => {
  for (const status of [429, 503]) {
    const models = [];
    const gemini = createGeminiAdapter({
      client: { models: { async generateContent(request) {
        models.push(request.model);
        if (request.model === 'judge-primary') throw Object.assign(new Error('Unavailable'), { status });
        return { text: evaluationText };
      } } },
    });
    assert.deepEqual(await evaluatePair(evaluationPair, gemini, evaluationOptions), {
      ...parseEvaluationResponse(evaluationText),
      evaluator_model: 'judge-secondary', fallback_from_model: 'judge-primary',
    });
    assert.deepEqual(models, ['judge-primary', 'judge-secondary']);
  }
});

test('evaluation preserves errors without fallback for other statuses or absent secondary models', async () => {
  for (const [status, secondaryModel] of [[400, 'judge-secondary'], [500, 'judge-secondary'], [429, '']]) {
    let calls = 0;
    const gemini = createGeminiAdapter({
      client: { models: { async generateContent() {
        calls++;
        throw Object.assign(new Error('Failed'), { status });
      } } },
    });
    await assert.rejects(evaluatePair(evaluationPair, gemini, { ...evaluationOptions, secondaryModel }), { status });
    assert.equal(calls, 1);
  }
});

test('evaluation keeps non-JSON handling and records secondary failures while continuing the batch', async () => {
  const models = [];
  const gemini = createGeminiAdapter({
    client: { models: { async generateContent(request) {
      models.push(request.model);
      if (models.length <= 2) throw Object.assign(new Error('Judge unavailable'), { status: 503 });
      return { text: 'not json' };
    } } },
  });
  const results = await evaluatePairs([evaluationPair, { ...evaluationPair, source_line: 8 }], evaluationOptions, gemini);
  assert.deepEqual(models, ['judge-primary', 'judge-secondary', 'judge-primary']);
  assert.deepEqual(results[0].evaluation_error, { message: 'Judge unavailable', status: 503 });
  assert.equal(results[0].source_line, 7);
  assert.equal(results[1].source_line, 8);
  assert.equal(results[1].evaluation.parse_error, true);
  assert.equal(results[1].evaluation.evaluator_model, 'judge-primary');
});
