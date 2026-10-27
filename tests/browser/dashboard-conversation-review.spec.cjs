const { test, expect } = require('@playwright/test');
const { parseConversationFilters, matchesConversationFilters } = require('../../server/lib/conversation-search');

test('staff save notes and statuses, recover drafts on failures and conflicts, and search unfinished reviews', async ({ page }) => {
  test.setTimeout(60_000);
  let review = { status: 'to_review', version: 0, updates: [] };
  let failure = '';
  let archived = false;
  const updates = [];
  const history = () => ({ conversationId: 'review-chat', preview: 'Help with my bakery', messageCount: 1, responseCount: 1, feedbackCount: 0,
    review, reviewStatus: review.status, topics: ['funding'], ratings: [], pages: [],
    events: [{ id: 'question', kind: 'user', turn: 1, content: 'Help with my bakery' }, { id: 'reply', kind: 'assistant', turn: 1, content: 'Talk to an advisor.' }] });
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.endsWith('/conversations/review')) {
      const body = request.postDataJSON(); updates.push(body);
      if (failure === 'storage') { failure = ''; return route.fulfill({ status: 500, json: { error: 'Unable to save the review. Please try again.' } }); }
      if (failure === 'conflict') {
        failure = '';
        review = { status: 'in_progress', version: review.version + 1, updates: [...review.updates, { status: 'in_progress', note: 'Another staff member is following up.', updatedBy: 'Jamie', updatedAt: '2026-10-05T12:00:00Z' }] };
        return route.fulfill({ status: 409, json: { review, error: 'Someone else updated this review. Check their changes, then save again. Your note is still here.' } });
      }
      expect(body.expectedVersion).toBe(review.version);
      review = { status: body.status, version: review.version + 1, updates: [...review.updates, { status: body.status, note: body.note, updatedBy: 'Alex', updatedAt: '2026-10-05T12:01:00Z' }] };
      return route.fulfill({ json: { conversationId: 'review-chat', review } });
    }
    if (url.pathname.endsWith('/conversations/archive') || url.pathname.endsWith('/conversations/restore')) {
      archived = url.pathname.endsWith('/archive');
      return route.fulfill({ json: { conversationId: 'review-chat', archived } });
    }
    if (!url.pathname.endsWith('/conversations')) return route.fulfill({ json: {} });
    const item = history();
    if (url.searchParams.has('conversationId')) return route.fulfill({ json: item });
    const matches = archived === (url.searchParams.get('archived') === 'true') && matchesConversationFilters(item, parseConversationFilters(Object.fromEntries(url.searchParams)));
    return route.fulfill({ json: { total: matches ? 1 : 0, limit: 25, offset: 0, conversations: matches ? [item] : [], filterOptions: { topics: ['funding'], pages: [] } } });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await page.getByRole('button', { name: /Help with my bakery/ }).click();
  const tracking = page.getByRole('region', { name: 'Review tracking', exact: true });
  await tracking.getByLabel('Review progress', { exact: true }).selectOption('in_progress');
  await tracking.getByLabel('Add an internal note', { exact: true }).fill('Ask an advisor.\nFollow up tomorrow.');
  failure = 'storage';
  await tracking.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(tracking.getByRole('alert')).toContainText('Unable to save');
  await expect(tracking.getByLabel('Add an internal note')).toHaveValue('Ask an advisor.\nFollow up tomorrow.');
  await tracking.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(tracking.getByRole('status')).toHaveText('Review saved.');
  await expect(tracking.getByText('Ask an advisor.\nFollow up tomorrow.', { exact: true })).toBeVisible();
  await expect(tracking.getByLabel('Add an internal note')).toHaveValue('');
  await page.reload();
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await page.getByRole('button', { name: /Help with my bakery/ }).click();
  await expect(tracking.getByLabel('Review progress')).toHaveValue('in_progress');
  await tracking.getByLabel('Review progress').selectOption('resolved');
  await tracking.getByLabel('Add an internal note').fill('Advisor answered the question.');
  failure = 'conflict';
  await tracking.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(tracking.getByRole('alert')).toContainText('Someone else updated');
  await expect(tracking.getByText('Another staff member is following up.', { exact: true })).toBeVisible();
  await expect(tracking.getByLabel('Add an internal note')).toHaveValue('Advisor answered the question.');
  await expect(tracking.getByLabel('Review progress')).toHaveValue('in_progress');
  await tracking.getByLabel('Review progress').selectOption('resolved');
  await tracking.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(tracking.getByRole('status')).toHaveText('Review saved.');
  expect(updates.at(-1).expectedVersion).toBe(2);
  const form = page.getByRole('form', { name: 'Search conversations', exact: true });
  await form.getByLabel('Review status', { exact: true }).selectOption('unfinished');
  await form.getByRole('button', { name: 'Search conversations', exact: true }).click();
  await expect(page.getByText('No conversations found.', { exact: true })).toBeVisible();
  await form.getByLabel('Review status', { exact: true }).selectOption('resolved');
  await form.getByRole('button', { name: 'Search conversations', exact: true }).click();
  await page.getByRole('button', { name: /Help with my bakery/ }).click();
  await page.getByRole('button', { name: 'Archive conversation', exact: true }).click();
  await page.getByRole('button', { name: 'View archived conversations', exact: true }).click();
  await page.getByRole('button', { name: /Help with my bakery/ }).click();
  await expect(tracking.getByLabel('Review progress')).toHaveValue('resolved');
  await expect(tracking.getByText('Advisor answered the question.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('conversation viewer shows referral clicks and clears the indicator when another chat is selected', async ({ page }) => {
  const clicks = [
    { timestamp: '2026-10-05T12:00:00Z', turn: 1, url: 'https://business.oksbdc.org/reg.aspx?mode=counsel' },
    { timestamp: null, turn: null, url: 'https://www.oksbdc.org/about/' },
  ];
  const histories = ['clicked', 'unclicked'].map((id) => ({ conversationId: id, preview: `${id} conversation`,
    messageCount: 1, responseCount: 1, feedbackCount: 0, referralClicks: id === 'clicked' ? clicks : [],
    events: [{ id: 'question', kind: 'user', turn: 1, content: `${id} conversation` },
      { id: 'reply', kind: 'assistant', turn: 1, content: 'Request advising.' }] }));
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/conversations')) return route.fulfill({ json: {} });
    return route.fulfill({ json: url.searchParams.has('conversationId')
      ? histories.find((history) => history.conversationId === url.searchParams.get('conversationId'))
      : { conversations: histories, total: 2, limit: 25 } });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await page.getByRole('button', { name: /^clicked conversation/ }).click();
  const indicator = page.getByRole('region', { name: 'Advising referral clicks', exact: true });
  await expect(indicator.getByText('Referral link clicked', { exact: true })).toBeVisible();
  await indicator.getByText('View recorded clicks (2)', { exact: true }).click();
  await expect(indicator).toContainText('Reply 1');
  await expect(indicator).toContainText('Time unavailable');
  await expect(indicator.getByText(clicks[0].url, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: /^unclicked conversation/ }).click();
  await expect(indicator.getByText('No referral link click recorded', { exact: true })).toBeVisible();
  await expect(indicator.locator('details')).toHaveCount(0);
});
