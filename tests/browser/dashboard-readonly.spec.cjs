const { test, expect } = require('@playwright/test');
const { buildMonthlyAnalytics } = require('../../server/lib/monthly-analytics');
const readonlyToken = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ role: 'readonly', username: 'viewer' })).toString('base64url')}.test-signature`;

test('read-only users can inspect and export data but cannot see editing, archive, or management controls', async ({ page }) => {
  const writes = [];
  const paths = [];
  const review = { status: 'resolved', version: 1, updates: [{ status: 'resolved', note: 'Advisor followed up.', updatedBy: 'Staff', updatedAt: '2026-01-03T00:00:00Z' }] };
  const lines = [JSON.stringify({ event: 'chat_turn_received', conversation_id: 'viewer-chat', turn: 1, timestamp: '2026-01-02T00:00:00Z' })];
  await page.addInitScript((token) => { sessionStorage.setItem('dashboard_token', token); sessionStorage.setItem('dashboard_username', 'viewer'); }, readonlyToken);
  await page.route('**/api/**', (route) => {
    const request = route.request(); const url = new URL(request.url());
    paths.push(url.pathname);
    if (request.method() !== 'GET') writes.push(url.pathname);
    if (url.pathname.endsWith('/auth/login')) return route.fulfill({ json: { token: readonlyToken, user: { username: 'viewer', role: 'readonly' } } });
    if (url.pathname.endsWith('/monthly-analytics')) return route.fulfill({ json: buildMonthlyAnalytics(lines, { startMonth: '2026-01', endMonth: '2026-01' }) });
    if (!url.pathname.endsWith('/conversations')) return route.fulfill({ json: {} });
    const history = { conversationId: 'viewer-chat', preview: 'Help with permits', messageCount: 1, responseCount: 1, feedbackCount: 0,
      archived: url.searchParams.get('archived') === 'true', review, reviewStatus: review.status, referralClicks: [],
      events: [{ id: 'user-1', kind: 'user', turn: 1, content: 'Help with permits' }, { id: 'reply-1', kind: 'assistant', turn: 1, content: 'Talk to an advisor.' }] };
    return route.fulfill({ json: url.searchParams.has('conversationId') ? history : { total: 1, limit: 25, conversations: [history] } });
  });
  await page.goto('./dashboard');
  await expect(page.locator('.dashboard-readonly-badge')).toHaveText('Read-only');
  await expect(page.getByRole('tab', { name: 'Management', exact: true })).toHaveCount(0);
  await expect(page.locator('#dashboard-panel-management')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Needs attention', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await page.getByRole('button', { name: /Help with permits/ }).click();
  const tracking = page.getByRole('region', { name: 'Review tracking', exact: true });
  await expect(tracking.getByText('Advisor followed up.', { exact: true })).toBeVisible();
  await expect(tracking.getByRole('textbox')).toHaveCount(0);
  await expect(tracking.getByRole('combobox')).toHaveCount(0);
  await expect(tracking.getByRole('button', { name: 'Save review', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive conversation', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View archived conversations', exact: true }).click();
  await page.getByRole('button', { name: /Help with permits/ }).click();
  await expect(page.getByRole('button', { name: 'Restore conversation', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Monthly analytics', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Usage & referrals', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export Excel (.xlsx)', exact: true })).toBeEnabled();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel (.xlsx)', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.xlsx$/);
  expect(writes).toEqual([]);
  expect(paths.some((path) => /system-prompt|rollback|blocked-responses/.test(path))).toBe(false);
  // Fresh login must retain the same restrictions as a restored session.
  await page.getByRole('button', { name: 'Log Out', exact: true }).click();
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('viewer');
  await page.getByLabel('Password', { exact: true }).fill('viewer test password');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.locator('.dashboard-readonly-badge')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Management', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
