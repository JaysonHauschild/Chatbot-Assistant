import assert from 'node:assert/strict'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const requireServer = createRequire(new URL('../../server/package.json', import.meta.url))
const express = requireServer('express')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const app = express()
app.use('/chatbot', express.static(fileURLToPath(new URL('../dist', import.meta.url))))
const listen = () => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server))
})
const widgetServer = await listen()
const hostServer = await listen()
const widgetUrl = `http://127.0.0.1:${widgetServer.address().port}/chatbot/`
const hostUrl = `http://127.0.0.1:${hostServer.address().port}/`
const snippet = (await readFile(new URL('../../docs/widget-embed.html', import.meta.url), 'utf8'))
  .replace('https://apps.oksbdc.org/chatbot/', widgetUrl)
app.get('/', (_request, response) => response.send(`<!doctype html>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; min-height: 200vh; font: 20px sans-serif; background: #eef5f0; }
    #host-action { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; }
  </style>
  <button id="host-action" onclick="this.dataset.clicks = Number(this.dataset.clicks || 0) + 1">Host page</button>
  ${snippet}`))
const screenshots = await mkdtemp(join(tmpdir(), 'oksbdc-embed-clicks-'))
let browser

try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ['--no-sandbox'],
  })
  for (const width of [1280, 768, 541, 540, 375]) {
    const mobile = width <= 540
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: mobile })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/**', (route) => route.fulfill({ json: {
      status: 'ok', version: 'test', reply: 'Here is a test response.', conversationId: 'embed-test',
    } }))
    await page.goto(hostUrl)
    const frame = page.frameLocator('iframe')
    const waitForClosedClip = () => page.waitForFunction(() => {
      const iframe = document.querySelector('iframe')
      return iframe.style.visibility === 'visible' && iframe.style.clipPath.startsWith('inset(')
    })
    const checkHostInput = async () => {
      // These points were covered by the old desktop/phone iframe.
      const point = { x: mobile ? width / 2 : width - 280, y: 300 }
      const before = Number(await page.locator('#host-action').getAttribute('data-clicks') || 0)
      if (mobile) await page.touchscreen.tap(point.x, point.y)
      else await page.mouse.click(point.x, point.y)
      assert.equal(Number(await page.locator('#host-action').getAttribute('data-clicks')), before + 1)
    }
    await waitForClosedClip()
    await checkHostInput()
    const bubble = frame.locator('.chat-bubble')
    const rect = await bubble.boundingBox()
    if (mobile) assert.ok(Math.abs(rect.x + rect.width / 2 - width / 2) < 2)
    else assert.ok(width - rect.x - rect.width < 20)
    assert.ok(await bubble.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0))
    await page.screenshot({ path: join(screenshots, `closed-${width}.png`) })

    const originalClip = await page.locator('iframe').evaluate((iframe) => iframe.style.clipPath)
    await page.evaluate((origin) => {
      const iframe = document.querySelector('iframe')
      const data = { type: 'oksbdc:widget-layout', isOpen: true, insets: { top: 0, right: 0, bottom: 0, left: 0 } }
      window.dispatchEvent(new MessageEvent('message', { source: window, origin, data }))
      window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow, origin: 'https://invalid.example', data }))
      window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow, origin, data: { ...data, insets: { ...data.insets, top: -1 } } }))
    }, new URL(widgetUrl).origin)
    assert.equal(await page.locator('iframe').evaluate((iframe) => iframe.style.clipPath), originalClip)

    const prompt = await frame.locator('.chat-launcher-prompt').boundingBox()
    if (mobile) await page.touchscreen.tap(prompt.x + prompt.width / 2, prompt.y + prompt.height / 2)
    else await page.mouse.click(prompt.x + prompt.width / 2, prompt.y + prompt.height / 2)
    await page.waitForFunction(() => document.querySelector('iframe').style.clipPath === 'none')
    await frame.getByRole('button', { name: 'I Understand & Agree', exact: true }).click()
    const panel = await frame.locator('.chat-widget').boundingBox()
    assert.ok(panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= width && panel.y + panel.height <= 844)
    await page.screenshot({ path: join(screenshots, `open-${width}.png`) })
    await frame.getByRole('textbox', { name: 'Type your message', exact: true }).fill('How do I start a business?')
    await frame.getByRole('button', { name: 'Send message', exact: true }).click()
    await frame.getByText('Here is a test response.', { exact: true }).waitFor()
    await frame.getByRole('button', { name: 'Close chat', exact: true }).click()
    await waitForClosedClip()
    await checkHostInput()
    await frame.getByRole('button', { name: 'Write Feedback', exact: true }).click()
    await frame.getByRole('button', { name: 'Send Feedback', exact: true }).click()
    await frame.getByRole('alert').filter({ hasText: 'Please enter feedback' }).waitFor()
    await page.screenshot({ path: join(screenshots, `feedback-${width}.png`) })
    await frame.getByRole('button', { name: 'Cancel', exact: true }).click()
    await frame.getByRole('button', { name: 'Happy', exact: true }).click()
    await frame.getByText('Thanks for your feedback.', { exact: true }).last().waitFor()
    await bubble.click()
    await frame.getByRole('button', { name: 'Close chat', exact: true }).click()
    await waitForClosedClip()
    await checkHostInput()

    // A live host viewport resize must update the closed clip and positioning.
    await page.setViewportSize({ width: mobile ? 1280 : 375, height: 740 })
    await bubble.click()
    await frame.getByRole('button', { name: 'Close chat', exact: true }).click()
    await waitForClosedClip()
    await page.screenshot({ path: join(screenshots, `resized-${width}.png`) })
    const contentFrame = page.frames().find((entry) => entry.url() === widgetUrl)
    await contentFrame.goto(widgetUrl)
    await waitForClosedClip()
    await bubble.click()
    await frame.getByRole('button', { name: 'Close chat', exact: true }).click()
    await waitForClosedClip()
    await page.mouse.move(20, 100)
    await page.mouse.wheel(0, 250)
    await page.waitForFunction(() => window.scrollY > 0)
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${width}px: host ${mobile ? 'taps' : 'clicks'}, launcher, open/close, feedback, resize, reload, scrolling, message validation`)
  }
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true })
    await page.route('**/api/**', (route) => route.fulfill({ json: { status: 'ok', version: 'test' } }))
    await page.goto(`${widgetUrl}embed-test/`)
    await page.waitForFunction(() => document.querySelector('#widget-state')?.textContent === 'Closed')
    assert.equal(new URL(await page.locator('iframe').getAttribute('src'), widgetUrl).searchParams.get('test_mode'), '1')
    await page.locator('.tap-target').nth(8).tap()
    await page.locator('.corner-left').tap()
    if (width < 540) await page.locator('.corner-right').tap()
    assert.equal(await page.locator('#tap-total').textContent(), width < 540 ? '3' : '2')
    await page.getByLabel('Show iframe bounds').check()
    assert.equal(await page.locator('#iframe-bounds').isVisible(), true)
    await page.screenshot({ path: join(screenshots, `test-route-${width}.png`) })
    const frame = page.frameLocator('iframe')
    await frame.locator('.chat-bubble').tap()
    await page.waitForFunction(() => document.querySelector('#widget-state').textContent === 'Open')
    await frame.getByRole('button', { name: 'Close chat', exact: true }).tap()
    await page.waitForFunction(() => document.querySelector('#widget-state').textContent === 'Closed')
    await page.mouse.move(width / 2, 350)
    await page.mouse.wheel(0, 400)
    await page.waitForFunction(() => Number(document.querySelector('#scroll-position').textContent) > 0)
    await page.getByRole('button', { name: 'Reset', exact: true }).tap()
    assert.equal(await page.locator('#tap-total').textContent(), '0')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.close()
    console.log(`PASS visual test route ${width}px: taps, counters, bounds, widget state, scrolling, reset, test traffic`)
  }
  console.log(`Screenshots: ${screenshots}`)
} finally {
  await browser?.close()
  await Promise.all([widgetServer, hostServer].map((server) => new Promise((resolve) => server.close(resolve))))
}
