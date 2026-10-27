const { test, expect } = require('@playwright/test');

test('conversation viewer translates automatically and can show original messages', async ({ page }) => {
  let fail = false;
  let translationRequests = 0;
  let releaseTranslation;
  let pendingTranslation = new Promise((resolve) => { releaseTranslation = resolve; });
  const events = [{ id: 'user-1', kind: 'user', turn: 1, content: 'Necesito ayuda para abrir un negocio.' },
    { id: 'reply-1', kind: 'assistant', turn: 1, content: 'Hello, I can help.' }];
  const item = { conversationId: 'spanish-chat', preview: events[0].content, messageCount: 1, responseCount: 1,
    feedbackCount: 0, events, topics: [], ratings: [], pages: [] };
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-token'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/conversations')) return route.fulfill({ json: {} });
    if (!url.searchParams.has('conversationId')) return route.fulfill({ json: { conversations: [item], total: 1, limit: 25 } });
    if (url.searchParams.get('translate') === 'true') {
      translationRequests++;
      if (pendingTranslation) await pendingTranslation;
      return route.fulfill({ json: { ...item, translationStatus: fail ? 'unavailable' : 'complete',
        events: fail ? events : [{ ...events[0], englishContent: 'I need help starting a business.', sourceLanguage: 'Spanish' }, events[1]] } });
    }
    return route.fulfill({ json: item });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await page.getByRole('button', { name: /Necesito ayuda/ }).click();
  const detail = page.getByRole('region', { name: 'Selected message or feedback' });
  await expect(page.getByText('Translating messages into English… Originals are available now.', { exact: true })).toBeVisible();
  await expect(detail.getByText(events[0].content, { exact: true })).toBeVisible();
  releaseTranslation();
  pendingTranslation = null;
  await expect(detail.getByText('I need help starting a business.', { exact: true })).toBeVisible();
  await expect(page.getByText('Translating messages into English… Originals are available now.', { exact: true })).toHaveCount(0);
  await expect(detail.getByText(/Translated to English from Spanish/)).toBeVisible();
  await detail.getByRole('button', { name: 'Show original', exact: true }).click();
  await expect(detail.getByText(events[0].content, { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Show English translation' }).click();
  await expect(detail.getByText('I need help starting a business.', { exact: true })).toBeVisible();
  await page.getByLabel('Show original messages', { exact: true }).check();
  await expect(detail.getByText(events[0].content, { exact: true })).toBeVisible();
  await page.getByLabel('Show original messages', { exact: true }).uncheck();
  await detail.getByRole('button', { name: 'Next entry' }).click();
  await expect(detail.getByText(events[1].content, { exact: true })).toBeVisible();
  await expect(detail.getByText(/Translated to English/)).toHaveCount(0);
  fail = true;
  await page.getByRole('button', { name: 'Refresh conversations', exact: true }).click();
  await expect(page.getByText(/Some messages could not be translated/)).toBeVisible();
  await expect(detail.getByText(events[0].content, { exact: true })).toBeVisible();
  fail = false;
  pendingTranslation = new Promise((resolve) => { releaseTranslation = resolve; });
  await page.getByRole('button', { name: 'Retry translation' }).click();
  await expect(page.getByText('Translating messages into English… Originals are available now.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Some messages could not be translated/)).toHaveCount(0);
  releaseTranslation();
  pendingTranslation = null;
  await expect(detail.getByText('I need help starting a business.', { exact: true })).toBeVisible();
  expect(translationRequests).toBe(3);
});
