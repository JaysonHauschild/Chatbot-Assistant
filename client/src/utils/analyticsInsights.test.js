import test from 'node:test'
import assert from 'node:assert/strict'
import { ratingChange, latestRatingComparison, savedReplyOpportunities, savedReplySuggestion } from './analyticsInsights.js'

test('compares rating rates in percentage points and avoids incomplete or unrated comparisons', () => {
  assert.equal(ratingChange({ negativeReplyRate: .5 }, { negativeReplyRate: .25 }), '25.0 percentage points higher')
  assert.equal(ratingChange({ negativeReplyRate: 0 }, { negativeReplyRate: .5 }), '50.0 percentage points lower')
  assert.equal(ratingChange({ negativeReplyRate: 0 }, { negativeReplyRate: 0 }), 'No change')
  assert.equal(ratingChange({ negativeReplyRate: null }, { negativeReplyRate: 0 }), 'Not enough ratings to compare')
  assert.equal(ratingChange({ negativeReplyRate: 0, partial: true }, { negativeReplyRate: .5 }), 'Month still in progress; not compared')
  assert.equal(ratingChange({ negativeReplyRate: 0 }, undefined), 'No earlier month in this report')
  const comparison = latestRatingComparison({ generatedAt: '2026-03-15T00:00:00Z', months: [
    { month: '2026-01', negativeReplyRate: .25 }, { month: '2026-02', negativeReplyRate: .5 },
    { month: '2026-03', partial: true, negativeReplyRate: 0 }, { month: '2026-04', negativeReplyRate: null },
  ] })
  assert.equal(comparison.current.month, '2026-02')
  assert.equal(comparison.previous.month, '2026-01')
  assert.equal(comparison.replyChange, '25.0 percentage points higher')
})

test('saved reply suggestions use explicit evidence and distinguish existing replies from possible new replies', () => {
  const topic = (key, metrics) => ({ key, helpNeededMessages: 0, negativeReplies: 0, aiReplies: 0, savedReplies: 0, ...metrics })
  const topics = [topic('unclassified', { helpNeededMessages: 5 }), topic('one-off', { aiReplies: 1 }),
    topic('repeated', { aiReplies: 3 }), topic('existing', { savedReplies: 2, negativeReplies: 1 }),
    topic('unsure', { helpNeededMessages: 1 }), topic('handled', { aiReplies: 5, savedReplies: 1 })]
  assert.deepEqual(savedReplyOpportunities({ topicQuality: topics }).map((row) => row.key), ['repeated', 'existing', 'unsure'])
  assert.match(savedReplySuggestion(topics[3]), /Review the saved replies/)
  assert.match(savedReplySuggestion(topics[2]), /AI answered this topic repeatedly/)
  assert.match(savedReplySuggestion(topics[4]), /clearer guidance/)
  assert.deepEqual(savedReplyOpportunities({}), [])
})
