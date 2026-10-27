import assert from 'node:assert/strict'
import { test } from 'node:test'
import { frenchText, spanishText, isWidgetServiceMessage, loadWidgetLanguage, translateWidgetText } from './widgetLanguage.js'

test('uses English by default and accepts only supported stored preferences', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  try {
    for (const [stored, expected] of [[null, 'en'], ['en', 'en'], ['es', 'es'], ['fr', 'fr'], ['unknown', 'en']]) {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: { getItem: () => stored },
      })
      assert.equal(loadWidgetLanguage(), expected)
    }
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('Storage blocked') },
    })
    assert.equal(loadWidgetLanguage(), 'en')
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  }
})

test('translates notices at display time without mutating their English source', () => {
  const notice = 'Conversation expired'
  assert.equal(translateWidgetText(notice, 'es'), 'Conversación vencida')
  assert.equal(translateWidgetText(notice, 'en'), notice)
  assert.equal(translateWidgetText('Please enter feedback before submitting.', 'es'), 'Escribe tu opinión antes de enviarla.')
})

test('preserves unknown content and does not identify filter text as a service fallback', () => {
  for (const text of ['Custom message filter rule response', 'constructor', '__proto__']) {
    assert.equal(translateWidgetText(text, 'es'), text)
    assert.equal(isWidgetServiceMessage(text), false)
  }
})

test('French translations cover every existing UI string and preserve English fallback', () => {
  assert.deepEqual(Object.keys(frenchText).sort(), Object.keys(spanishText).sort())
  for (const [source, translated] of Object.entries(frenchText)) {
    assert.ok(translated.trim(), source)
    assert.equal(translateWidgetText(source, 'fr'), translated)
    assert.equal(translateWidgetText(source, 'en'), source)
  }
  assert.equal(translateWidgetText('Send message', 'fr'), 'Envoyer le message')
  assert.equal(translateWidgetText('Unrecognized message', 'fr'), 'Unrecognized message')
  assert.equal(translateWidgetText('Send message', 'unknown'), 'Send message')
})

test('French service notices translate and retain the advising destination', () => {
  const highDemand = 'I’m sorry — our AI service is temporarily experiencing high demand. Please try again in a minute. If you need immediate help, you can request free advising here: https://business.oksbdc.org/reg.aspx?mode=counsel&center=64000&subloc=0'
  const timeout = 'I’m sorry — the assistant took too long to respond, so the request was cancelled. Please try again in a moment.'
  assert.equal(isWidgetServiceMessage(highDemand), true)
  assert.match(translateWidgetText(highDemand, 'fr'), /très sollicité/)
  assert.ok(translateWidgetText(highDemand, 'fr').endsWith('https://business.oksbdc.org/reg.aspx?mode=counsel&center=64000&subloc=0'))
  assert.equal(isWidgetServiceMessage(timeout), true)
  assert.match(translateWidgetText(timeout, 'fr'), /annulée/)
})
