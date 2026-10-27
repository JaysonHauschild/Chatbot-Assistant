'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeConversationId,
  redactSensitiveText,
  isTestModeEnabled,
  parseJsonLogLine,
  getEntryConversationId,
  getConversationTurnKey,
  buildBlockedReviewMap,
} = require('../util/helpers');

test('sanitizeConversationId accepts safe IDs, normalizes unsafe characters, and rejects invalid IDs', () => {
  assert.equal(sanitizeConversationId(' conv-123_ABC '), 'conv-123_ABC');
  assert.equal(sanitizeConversationId('lead@example.com / odd id'), 'lead_example_com___odd_id');
  assert.equal(sanitizeConversationId(''), null);
  assert.equal(sanitizeConversationId(' '.repeat(4)), null);
  assert.equal(sanitizeConversationId('x'.repeat(121)), null);
  assert.equal(sanitizeConversationId(42), null);
});

test('redactSensitiveText removes common PII while preserving non-sensitive context and max-length behavior', () => {
  const redacted = redactSensitiveText(
    'Call (405) 555-1212 or email owner@example.com. SSN 123-45-6789. Card 4111 1111 1111 1111.',
  );

  assert.equal(
    redacted,
    'Call [REDACTED_PHONE] or email [REDACTED_EMAIL]. SSN [REDACTED_SSN]. Card [REDACTED_CARD].',
  );
  assert.equal(redactSensitiveText('abcdef', { maxLength: 3 }), 'abc');
  assert.equal(redactSensitiveText('abcdef', { maxLength: null }), 'abcdef');
  assert.equal(redactSensitiveText(null), '');
});

test('redactSensitiveText removes tax IDs, addresses, and labeled government or financial identifiers', () => {
  const cases = [
    {
      input: 'EIN 12-3456789; alternate EIN: 123456789; state tax ID 987654321.',
      expected: 'EIN [REDACTED_EIN]; alternate EIN: [REDACTED_EIN]; state tax ID [REDACTED_TAX_ID].',
    },
    {
      input: 'Address: 123 N Main St., Suite 400, Tulsa, OK 74103. Mail PO Box 77, Norman, OK 73069.',
      expected: 'Address: [REDACTED_ADDRESS]. Mail [REDACTED_ADDRESS].',
    },
    {
      input: 'Ship to RR 2 Box 152, Ada, OK 74820.',
      expected: 'Ship to [REDACTED_ADDRESS].',
    },
    {
      input: 'Routing number: 103000648; bank account number: 9876543210; IBAN GB82 WEST 1234 5698 7654 32.',
      expected: 'Routing number: [REDACTED_ROUTING_NUMBER]; bank account number: [REDACTED_BANK_ACCOUNT]; IBAN [REDACTED_IBAN].',
    },
    {
      input: 'DOB 01/02/1980; driver license: D123456789; passport 123456789; VIN 1HGCM82633A004352.',
      expected: 'DOB [REDACTED_DOB]; driver license: [REDACTED_DRIVER_LICENSE]; passport [REDACTED_PASSPORT]; VIN [REDACTED_VIN].',
    },
    {
      input: 'MRN: A1234567; Medicare ID 1EG4TE5MK73; license plate 123ABC.',
      expected: 'MRN: [REDACTED_MEDICAL_ID]; Medicare ID [REDACTED_MEDICAL_ID]; license plate [REDACTED_LICENSE_PLATE].',
    },
    {
      input: 'My name is Jane Q Smith, and my EIN is 12-3456789.',
      expected: 'My name is [REDACTED_NAME], and my EIN is [REDACTED_EIN].',
    },
  ];

  for (const { input, expected } of cases) {
    assert.equal(redactSensitiveText(input, { maxLength: null }), expected);
  }
});

test('redactSensitiveText removes credentials, network identifiers, and expanded phone formats', () => {
  const redacted = redactSensitiveText(
    'API key: sk-test_123456; password is Hunter2!; IP 192.168.1.40; MAC 00:1A:2B:3C:4D:5E; phone +44 20 7946 0958.',
    { maxLength: null },
  );

  assert.equal(
    redacted,
    'API key: [REDACTED_CREDENTIAL]; password is [REDACTED_CREDENTIAL]; IP [REDACTED_IP_ADDRESS]; MAC [REDACTED_MAC_ADDRESS]; phone [REDACTED_PHONE].',
  );
});

test('redactSensitiveText avoids broad numeric false positives', () => {
  const ordinaryBusinessText = [
    'Revenue was $125,000 in 2025.',
    'The ZIP code is 74103.',
    'Order 123456789 has 25 units and a 10.25% margin.',
    'The workshop runs from 9:00 to 11:30 on 07/23/2026.',
  ].join(' ');

  assert.equal(
    redactSensitiveText(ordinaryBusinessText, { maxLength: null }),
    ordinaryBusinessText,
  );
});

test('log utility helpers parse valid entries and ignore malformed review records', () => {
  assert.deepEqual(parseJsonLogLine('{"event":"ok"}'), { event: 'ok' });
  assert.equal(parseJsonLogLine('not-json'), null);
  assert.equal(parseJsonLogLine(''), null);

  assert.equal(getEntryConversationId({ conversationId: ' current ' }), 'current');
  assert.equal(getEntryConversationId({ conversation_id: 'legacy' }), 'legacy');
  assert.equal(getEntryConversationId({ conversationId: '' }), null);

  assert.equal(getConversationTurnKey('conv', 3), 'conv::3');
  assert.equal(getConversationTurnKey('conv', Number.NaN), null);

  const reviewMap = buildBlockedReviewMap([
    JSON.stringify({ event: 'blocked_response_review', conversationId: 'conv', turn: 1, reviewStatus: 'correct_block', timestamp: '2026-01-01T00:00:00.000Z' }),
    JSON.stringify({ event: 'blocked_response_review', conversationId: 'conv', turn: 1, reviewStatus: 'false_positive', timestamp: '2026-01-01T00:01:00.000Z' }),
    JSON.stringify({ event: 'blocked_response_review', conversationId: 'conv', turn: 2, reviewStatus: 'unsupported' }),
    'not-json',
  ]);

  assert.equal(reviewMap.size, 1);
  assert.deepEqual(reviewMap.get('conv::1'), {
    status: 'false_positive',
    timestamp: '2026-01-01T00:01:00.000Z',
  });
});

test('isTestModeEnabled only enables explicit test_mode=1', () => {
  assert.equal(isTestModeEnabled('1'), true);
  assert.equal(isTestModeEnabled(1), true);
  assert.equal(isTestModeEnabled(' true '), false);
  assert.equal(isTestModeEnabled(undefined), false);
});
