const { test, expect } = require('@playwright/test');

async function openChat(page) {
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.goto('./');
  await page.locator('.chat-bubble').click();
  await page.getByRole('button', { name: 'I Understand & Agree', exact: true }).click();
}

async function send(page) {
  await page.getByRole('textbox', { name: 'Type your message', exact: true }).fill('How do I start a business?');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}

test('announces only the final streamed answer and removes hidden link tab stops', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      if (!new URL(String(url), location.href).pathname.endsWith('/api/chat')) return originalFetch(url, options);
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          window.emitChatEvent = event => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
          window.endChatStream = () => controller.close();
          options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
        },
      }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
    };
  });
  await openChat(page);
  const announcement = page.locator('.chat-reply-announcement');
  await expect(announcement).toHaveAttribute('aria-live', 'polite');
  await expect(announcement).toHaveAttribute('aria-atomic', 'true');
  await expect(announcement).toBeEmpty();
  await send(page);
  await page.waitForFunction(() => Boolean(window.emitChatEvent));
  const thinking = page.getByRole('status', { name: 'Assistant is thinking', exact: true });
  await expect(thinking).toBeVisible();
  await expect(thinking.locator('.thinking-dot')).toHaveCount(3);
  expect(await thinking.locator('.thinking-dot').first().evaluate(dot => getComputedStyle(dot).animationName)).toBe('thinking-pulse');
  await page.evaluate(() => window.emitChatEvent({ type: 'meta', conversationId: 'thinking-test' }));
  await expect(thinking).toBeVisible();
  await expect(page.locator('.message-ai-badge')).toHaveCount(0);
  await page.evaluate(() => window.emitChatEvent({ type: 'chunk', text: 'Discarded draft' }));
  await expect(page.locator('.message-assistant').last()).toContainText('Discarded');
  await expect(thinking).toHaveCount(0);
  await expect(announcement).toBeEmpty();
  await page.evaluate(() => window.emitChatEvent({ type: 'reset' }));
  await expect(thinking).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await thinking.locator('.thinking-dot').first().evaluate(dot => getComputedStyle(dot).animationName)).toBe('none');
  await page.evaluate(() => {
    window.emitChatEvent({ type: 'chunk', text: 'Another draft' });
    window.emitChatEvent({ type: 'final', reply: 'Read the **business plan** and [resources](https://www.oksbdc.org/).', aiGenerated: true });
    window.endChatStream();
  });
  await expect(announcement).toHaveText('Assistant: Read the business plan and resources.');
  await expect(thinking).toHaveCount(0);
  await expect(announcement.locator('a, button, [tabindex]')).toHaveCount(0);
  await expect(page.locator('.message-assistant').last().getByRole('link', { name: 'resources' })).toBeVisible();
});

test('clears the previous announcement while waiting and announces identical JSON replies again', async ({ page }) => {
  await openChat(page);
  let finishRequest;
  await page.route('**/api/chat', route => new Promise(resolve => {
    finishRequest = async () => { await route.fulfill({ json: { reply: 'Write a business plan.', aiGenerated: false } }); resolve(); };
  }));
  const announcement = page.locator('.chat-reply-announcement');
  for (let turn = 0; turn < 2; turn++) {
    finishRequest = null;
    await send(page);
    await expect.poll(() => Boolean(finishRequest)).toBe(true);
    await expect(announcement).toBeEmpty();
    await expect(page.locator('.message-thinking')).toBeVisible();
    await finishRequest();
    await expect(announcement).toHaveText('Assistant: Write a business plan.');
    await expect(page.locator('.message-thinking')).toHaveCount(0);
  }
});

test('announces translated request errors and clears them on reset', async ({ page }) => {
  await openChat(page);
  await page.getByRole('button', { name: 'Open chat options', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Español', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir opciones del chat', exact: true }).click();
  await page.route('**/api/chat', route => route.fulfill({ status: 503, json: { error: 'Unable to generate a response right now.' } }));
  await page.getByRole('textbox', { name: 'Escribe tu mensaje', exact: true }).fill('Necesito ayuda.');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  const announcement = page.locator('.chat-reply-announcement');
  await expect(announcement).toHaveText('Asistente: No se puede generar una respuesta en este momento.');
  await page.getByRole('button', { name: 'Abrir opciones del chat', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reiniciar chat', exact: true }).click();
  await expect(announcement).toBeEmpty();
});
