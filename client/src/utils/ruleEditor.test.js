import test from 'node:test'
import assert from 'node:assert/strict'
import { ruleMatchDraft, ruleDraftProblem } from './ruleEditor.js'

test('literal rules open as editable phrases without changing matching behavior', () => {
  assert.deepEqual(ruleMatchDraft({ regexPattern: 'loan|SBA loan|a\\+b', pattern: '/loan|SBA loan|a\\+b/i' }), {
    mode: 'keywords', keywords: 'loan, SBA loan, a+b', pattern: 'loan|SBA loan|a\\+b',
  })
  assert.equal(ruleMatchDraft({ pattern: 'business loan' }).keywords, 'business loan')
  assert.equal(ruleMatchDraft({ pattern: '/literal\\|pipe/i' }).keywords, 'literal|pipe')
})

test('advanced patterns, nondefault flags and literal commas stay intact', () => {
  for (const [pattern, flags] of [['\\bgrants?\\b', 'i'], ['loan', 'im'], ['a,b', 'i'], ['(loan|grant)', 'i'], ['\\d+', 'i'], ['a|', 'i']]) {
    const draft = ruleMatchDraft({ regexPattern: pattern, pattern: `/${pattern}/${flags}` })
    assert.equal(draft.mode, 'regex')
    assert.equal(draft.pattern, pattern)
  }
})

test('draft guidance rejects invalid patterns, empty phrases and duplicate new names', () => {
  const draft = { id: 'help', mode: 'keywords', keywords: ' , ', pattern: '', reply: 'Contact us.', items: [], editing: false }
  assert.match(ruleDraftProblem(draft), /at least one/)
  assert.match(ruleDraftProblem({ ...draft, keywords: 'loan', items: [{ id: 'help' }] }), /already in use/)
  assert.equal(ruleDraftProblem({ ...draft, keywords: 'loan', editing: true, items: [{ id: 'help' }] }), '')
  assert.match(ruleDraftProblem({ ...draft, mode: 'regex', pattern: '[a' }), /invalid/)
})
