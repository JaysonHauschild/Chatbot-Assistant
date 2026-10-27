const { test, expect } = require('@playwright/test');
const { groupConversationsByVisit } = require('../../server/lib/conversation-visits');

async function prepare(page, role = 'dashboard') {
  const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.test`;
  const item = (id, preview, visitReference, archived = false) => ({ conversationId: id, preview, visitReference, archived,
    startedAt: '2026-01-01T12:00:00Z', updatedAt: '2026-01-01T12:01:00Z', messageCount: 1, responseCount: 1,
    feedbackCount: 0, reviewStatus: 'to_review', topics: ['funding'] });
  const items = [item('first', 'First business question', 'shared1234567890'), item('second', 'Second business question', 'shared1234567890'),
    item('archived', 'Archived business question', 'shared1234567890', true), item('unknown', 'Old question without visit details', null),
    ...Array.from({ length: 26 }, (_, index) => item(`other-${index}`, `Other question ${index}`, `other${String(index).padStart(15, '0')}`))];
  items.slice(0, 3).forEach((entry) => { entry.updatedAt = '2026-01-03T12:01:00Z'; });
  items[3].updatedAt = '2026-01-02T12:01:00Z';
  const requests = [];
  await page.addInitScript((value) => sessionStorage.setItem('dashboard_token', value), token);
  await page.route('**/api/**', (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.endsWith('/conversations/archive')) {
      items.find((entry) => entry.conversationId === request.postDataJSON().conversationId).archived = true;
      return route.fulfill({ json: { archived: true } });
    }
    if (!url.pathname.endsWith('/conversations')) return route.fulfill({ json: {} });
    const params = Object.fromEntries(url.searchParams);
    if (params.conversationId) {
      const entry = items.find((entry) => entry.conversationId === params.conversationId);
      return route.fulfill({ json: { ...entry, review: { status: 'to_review', version: 0, updates: [] }, translationStatus: 'complete',
        events: [{ id: entry.conversationId, kind: 'user', content: entry.preview, turn: 1 }] } });
    }
    requests.push(params);
    const matching = items.filter((entry) => (params.archived === 'all' || entry.archived === (params.archived === 'true'))
      && (!params.q || entry.preview.toLowerCase().includes(params.q.toLowerCase())));
    const offset = Number(params.offset || 0);
    if (params.groupBy === 'visit') {
      const visits = groupConversationsByVisit(matching);
      return route.fulfill({ json: { total: visits.length, conversationTotal: matching.length, limit: 25, offset,
        unlinkedConversationCount: matching.filter((entry) => !entry.visitReference).length, visits: visits.slice(offset, offset + 25) } });
    }
    return route.fulfill({ json: { conversations: matching.slice(offset, offset + 25), total: matching.length, limit: 25, offset } });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  return requests;
}

test('visit groups expand into conversations, filter and paginate, and protect review drafts', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const requests = await prepare(page);
  const toggle = page.getByRole('checkbox', { name: 'Group conversations by visit', exact: true });
  await toggle.check();
  await expect.poll(() => requests.at(-1)?.groupBy).toBe('visit');
  await expect(page.getByRole('list', { name: 'Visits', exact: true }).locator(':scope > li')).toHaveCount(25);
  const shared = page.locator('.conversation-visit').filter({ hasText: 'Visit shared12' });
  await shared.locator('summary').click();
  await expect(shared.getByRole('button')).toHaveCount(2);
  await expect(shared).toContainText('2 conversations');
  await shared.getByRole('button', { name: /Second business question/ }).click();
  const review = page.getByRole('region', { name: 'Review tracking', exact: true });
  const note = review.getByLabel('Add an internal note');
  await note.fill('Keep this review draft.');
  page.once('dialog', (dialog) => dialog.dismiss());
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(note).toHaveValue('Keep this review draft.');
  await note.fill('');
  await page.getByRole('textbox', { name: 'Search conversation reference or message text', exact: true }).fill('Second business');
  await page.getByRole('button', { name: 'Search conversations', exact: true }).click();
  await expect(shared).toContainText('1 matching conversation');
  await shared.locator('summary').click();
  await expect(shared.getByRole('button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.offset).toBe('25');
  await expect(page.getByRole('list', { name: 'Visits', exact: true }).locator(':scope > li')).toHaveCount(3);
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.offset).toBe('0');
  await expect(page.getByText(/no reliable visit details/)).toBeVisible();
  await page.screenshot({ path: `/tmp/conversation-visit-groups-${testInfo.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await toggle.uncheck();
  await expect(page.getByRole('list', { name: 'Conversations', exact: true })).toBeVisible();
});

test('read-only staff can group archived and active chats without editing controls', async ({ page }) => {
  const requests = await prepare(page, 'readonly');
  await page.getByRole('checkbox', { name: 'Group conversations by visit', exact: true }).check();
  await page.getByLabel('Include archived conversations', { exact: true }).check();
  const shared = page.locator('.conversation-visit').filter({ hasText: 'Visit shared12' });
  await expect(shared).toContainText('3 conversations');
  await shared.locator('summary').focus();
  await page.keyboard.press('Enter');
  await shared.getByRole('button', { name: /Archived business question/ }).click();
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive conversation', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View archived conversations', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.archived).toBe('true');
  await expect(shared).toContainText('1 conversation');
  await shared.locator('summary').click();
  await expect(shared.getByRole('button')).toHaveCount(1);
  await shared.getByRole('button', { name: /Archived business question/ }).click();
  await expect(page.getByRole('button', { name: 'Restore conversation', exact: true })).toHaveCount(0);
});

test('reset starts an independent chat while preserving its recorded visit', async ({ page }) => {
  const chats = []; const resets = [];
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/chat/reset')) resets.push(route.request().postDataJSON());
    if (path.endsWith('/chat')) {
      chats.push(route.request().postDataJSON());
      return route.fulfill({ json: { reply: `Answer ${chats.length}`, conversationId: `conversation-${chats.length}`, aiGenerated: false } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('./');
  await page.locator('.chat-bubble').click();
  await page.getByRole('button', { name: 'I Understand & Agree', exact: true }).click();
  await page.getByRole('textbox').fill('First question');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Answer 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open chat options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reset Chat', exact: true }).click();
  await page.getByRole('textbox').fill('Second question');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Answer 2', { exact: true })).toBeVisible();
  expect(chats[0].visitId).toBeTruthy();
  expect(chats[1].visitId).toBe(chats[0].visitId);
  expect(chats[1].sessionId).not.toBe(chats[0].sessionId);
  expect(chats[1].history).toEqual([]);
  expect(chats[1].conversationId).toBeUndefined();
  expect(resets[0]).toMatchObject({ conversationId: 'conversation-1', sessionId: chats[0].sessionId });
  await page.reload();
  expect(await page.evaluate(() => sessionStorage.getItem('oksbdc_chat_visit_id'))).toBe(chats[0].visitId);
});
