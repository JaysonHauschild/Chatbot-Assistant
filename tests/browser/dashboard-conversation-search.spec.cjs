const { test, expect } = require('@playwright/test');
const { parseConversationFilters, matchesConversationFilters } = require('../../server/lib/conversation-search');

const target = {
  conversationId: 'target-chat', preview: 'Can I get a loan for my bakery?',
  startedAt: '2026-01-15T12:00:00Z', updatedAt: '2026-01-15T12:00:01Z',
  messageCount: 1, responseCount: 1, feedbackCount: 1, topics: ['funding'],
  pages: ['https://example.com/business-help'], ratings: ['down'], hasBlockedMessages: true,
  events: [
    { id: 'user', kind: 'user', turn: 1, timestamp: '2026-01-15T12:00:00Z', content: 'Can I get a loan for my bakery?' },
    { id: 'reply', kind: 'assistant', turn: 1, timestamp: '2026-01-15T12:00:01Z', content: 'Please speak with an advisor.', blocked: true },
  ],
};

test('conversation search combines filters, resets pagination, clears old selections, and works in archives', async ({ page }) => {
  const fixtures = [target, ...Array.from({ length: 27 }, (_, index) => ({
    ...target, conversationId: `other-${index}`, preview: `Other question ${index}`, topics: ['legal'], ratings: ['up'], hasBlockedMessages: false,
    events: [{ id: 'user', kind: 'user', turn: 1, content: `Other question ${index}`, timestamp: '2026-02-01T00:00:00Z' }],
  }))];
  const requests = [];
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/conversations')) return route.fulfill({ json: {} });
    const archived = url.searchParams.get('archived') === 'true';
    const histories = archived ? [{ ...target, conversationId: 'archived-target' }] : fixtures;
    if (url.searchParams.has('conversationId')) return route.fulfill({ json: histories.find((item) => item.conversationId === url.searchParams.get('conversationId')) });
    const query = Object.fromEntries(url.searchParams);
    requests.push(query);
    const matches = histories.filter((item) => matchesConversationFilters(item, parseConversationFilters(query)));
    const offset = Number(query.offset || 0);
    return route.fulfill({ json: { total: matches.length, offset, limit: 25, conversations: matches.slice(offset, offset + 25),
      filterOptions: { topics: ['funding', 'legal'], pages: ['https://example.com/business-help'] } } });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await expect(page.getByText('28 active conversations', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByText('26-28 of 28', { exact: true })).toBeVisible();
  const form = page.getByRole('form', { name: 'Search conversations', exact: true });
  await form.getByRole('textbox', { name: 'Search conversation reference or message text' }).fill('BAKERY');
  await form.getByLabel('From date', { exact: true }).fill('2026-01-01');
  await form.getByLabel('Through date', { exact: true }).fill('2026-01-31');
  await form.getByRole('combobox', { name: 'Question topic', exact: true }).selectOption('funding');
  await form.getByRole('combobox', { name: 'Visitor rating', exact: true }).selectOption('negative');
  await form.getByRole('combobox', { name: 'Blocked messages', exact: true }).selectOption('yes');
  await form.getByLabel('Website page contains', { exact: true }).fill('business-help');
  // Draft filter changes leave the applied results and page unchanged.
  expect(requests.at(-1).offset).toBe('25');
  await form.getByRole('button', { name: 'Search conversations', exact: true }).click();
  await expect(page.getByText('1 active conversation matching your search', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ q: 'BAKERY', offset: '0', topic: 'funding', rating: 'negative', blocked: 'yes',
    dateFrom: '2026-01-01', dateTo: '2026-01-31', page: 'business-help' });
  await page.getByRole('button', { name: /Can I get a loan for my bakery/ }).click();
  await expect(page.getByRole('heading', { name: 'target-chat', exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByText('28 active conversations', { exact: true })).toBeVisible();
  await expect(page.getByText('No conversation selected.', { exact: true })).toBeVisible();
  await expect(form.getByRole('combobox', { name: 'Question topic', exact: true })).toHaveValue('');
  await expect(form.getByLabel('From date', { exact: true })).toHaveValue('');
  await expect(form.getByLabel('Website page contains', { exact: true })).toHaveValue('');

  await form.getByLabel('From date', { exact: true }).fill('2026-02-01');
  await form.getByLabel('Through date', { exact: true }).fill('2026-01-01');
  const count = requests.length;
  await form.getByRole('button', { name: 'Search conversations', exact: true }).click();
  expect(await form.getByLabel('Through date', { exact: true }).evaluate((input) => input.validity.rangeUnderflow)).toBe(true);
  expect(requests.length).toBe(count);
  await page.getByRole('button', { name: 'View archived conversations', exact: true }).click();
  await expect(page.getByText('1 archived conversation', { exact: true })).toBeVisible();
  await expect(form.getByLabel('From date', { exact: true })).toHaveValue('');
  await form.getByRole('combobox', { name: 'Visitor rating', exact: true }).selectOption('down');
  await form.getByRole('button', { name: 'Search conversations', exact: true }).click();
  await expect(page.getByText('1 archived conversation matching your search', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ archived: 'true', rating: 'down', offset: '0' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
