const { test, expect } = require('@playwright/test');

test('archived conversations can be searched, inspected and restored', async ({ page }) => {
  let archived = true;
  let failRestore = true;
  const mutations = [];
  const conversation = {
    conversationId: 'archived-example', preview: 'How do I start a bakery?',
    startedAt: '2026-01-01T12:00:00Z', updatedAt: '2026-01-01T12:00:01Z',
    messageCount: 1, responseCount: 1, feedbackCount: 0,
    events: [
      { id: '1-user', kind: 'user', turn: 1, timestamp: '2026-01-01T12:00:00Z', content: 'How do I start a bakery?' },
      { id: '1-assistant', kind: 'assistant', turn: 1, timestamp: '2026-01-01T12:00:01Z', content: 'Start with a business plan.' },
    ],
  };
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes('/dashboard/conversations')) return route.fulfill({ json: {} });
    expect(route.request().headers().authorization).toBe('Bearer test-dashboard-token');
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ conversationId: conversation.conversationId });
      mutations.push(url.pathname.split('/').at(-1));
      if (url.pathname.endsWith('/restore') && failRestore) {
        failRestore = false;
        return route.fulfill({ status: 500, json: { error: 'Unable to restore conversation. Please try again.' } });
      }
      archived = url.pathname.endsWith('/archive');
      return route.fulfill({ json: { conversationId: conversation.conversationId, archived } });
    }
    const visible = (url.searchParams.get('archived') === 'true') === archived;
    if (url.searchParams.has('conversationId')) {
      return route.fulfill({ status: visible ? 200 : 404, json: visible ? conversation : { error: 'Not found' } });
    }
    const matches = visible && conversation.preview.toLowerCase().includes((url.searchParams.get('q') || '').toLowerCase());
    return route.fulfill({ json: { total: matches ? 1 : 0, limit: 25, offset: 0, conversations: matches ? [conversation] : [] } });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await expect(page.getByText('No conversations found.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View archived conversations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Archived Conversations', exact: true })).toBeVisible();
  const search = page.getByRole('textbox', { name: 'Search conversation reference or message text' });
  await search.fill('no match');
  await page.getByRole('button', { name: 'Search conversations', exact: true }).click();
  await expect(page.getByText('No archived conversations found.', { exact: true })).toBeVisible();
  await search.fill('bakery');
  await page.getByRole('button', { name: 'Search conversations', exact: true }).click();
  await page.getByRole('button', { name: /How do I start a bakery/ }).click();
  await expect(page.getByRole('heading', { name: 'archived-example', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive conversation', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore conversation', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Unable to restore conversation. Please try again.');
  await page.getByRole('button', { name: 'Restore conversation', exact: true }).click();
  await expect(page.getByText('Conversation restored. It is available in Conversation History.')).toBeVisible();
  await expect(page.getByText('No archived conversations found.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to conversation history', exact: true }).click();
  await expect(search).toHaveValue('');
  await page.getByRole('button', { name: /How do I start a bakery/ }).click();
  await page.getByRole('button', { name: 'Archive conversation', exact: true }).click();
  await expect(page.getByText('Conversation archived. Its chat history is saved.')).toBeVisible();
  await page.getByRole('button', { name: 'View archived conversations', exact: true }).click();
  await expect(page.getByRole('button', { name: /How do I start a bakery/ })).toBeVisible();
  expect(mutations).toEqual(['restore', 'restore', 'archive']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
