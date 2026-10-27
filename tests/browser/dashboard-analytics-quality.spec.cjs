const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const ExcelJS = require('../../client/node_modules/exceljs');
const { buildMonthlyAnalytics } = require('../../server/lib/monthly-analytics');

const receipt = (id, month, topic = 'funding', isTest = false) => ({ event: 'chat_turn_received', conversation_id: id, turn: 1,
  timestamp: `2026-${month}-05T12:00:00Z`, classification: { message_intent: topic }, is_test: isTest });
const response = (id, month, topic = 'funding', unsure = false) => ({ event: 'chat_response', conversation_id: id, turn: 1,
  timestamp: `2026-${month}-05T12:00:01Z`, classification: { message_intent: topic, unsure_response: unsure } });
const rating = (id, value) => ({ event: 'chat_feedback', conversation_id: id, turn: 1,
  timestamp: '2026-04-01T00:00:00Z', feedback: { scope: 'response', value } });

test('quality analytics show live-only help topics, rating changes, saved reply suggestions, and matching exports', async ({ page }) => {
  const entries = [
    receipt('jan-a', '01'), response('jan-a', '01'), rating('jan-a', 'up'),
    receipt('jan-b', '01'), response('jan-b', '01'), rating('jan-b', 'up'),
    receipt('feb-a', '02'), response('feb-a', '02'), rating('feb-a', 'down'),
    receipt('feb-b', '02'), response('feb-b', '02'), rating('feb-b', 'up'),
    receipt('no-reply-a', '02', 'licensing'), receipt('no-reply-b', '02', 'licensing'),
    receipt('unsure', '02', 'legal'), response('unsure', '02', 'legal', true),
    receipt('current', '03', 'licensing'),
    { event: 'chat_feedback', conversation_id: 'feb-a', timestamp: '2026-04-01T00:00:00Z', feedback: { scope: 'session', value: 'sad' } },
    receipt('sandbox', '02', 'test-only-topic', true), response('sandbox', '02', 'test-only-topic', true), rating('sandbox', 'down'),
  ];
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/monthly-analytics')) return route.fulfill({ json: {} });
    return route.fulfill({ json: buildMonthlyAnalytics(entries.map((entry) => JSON.stringify(entry)), {
      ...Object.fromEntries(url.searchParams), now: new Date('2026-03-15T00:00:00Z'),
    }) });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Monthly analytics', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Usage & referrals', exact: true }).click();
  await page.getByRole('tab', { name: 'Answer quality', exact: true }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-01');
  await page.getByLabel('Through', { exact: true }).fill('2026-03');
  await page.getByRole('button', { name: 'Update report', exact: true }).click();
  const quality = page.getByRole('region', { name: 'Answer quality and follow-up', exact: true });
  await expect(quality.locator('.analytics-quality-kpis article').filter({ hasText: 'Questions needing help' }).locator('strong')).toHaveText('4');
  await expect(quality.locator('.analytics-quality-kpis article').filter({ hasText: 'Negative reply ratings' }).locator('strong')).toHaveText('25.0%');
  await expect(quality.locator('.analytics-quality-kpis article').filter({ hasText: 'Negative reply ratings' }).locator('.analytics-rating-participation > b')).toHaveText('80.0%');
  await expect(quality.locator('.analytics-quality-kpis article').filter({ hasText: 'Negative chat ratings' }).locator('.analytics-rating-participation > b')).toHaveText('12.5%');
  const monthlyRatings = quality.getByRole('region', { name: 'Negative ratings by month', exact: true });
  const february = monthlyRatings.getByRole('row').filter({ hasText: 'Feb 2026' });
  await expect(february.getByRole('cell').nth(2)).toHaveText('66.7%');
  await expect(february.getByRole('cell').nth(6)).toHaveText('20.0%');
  await expect(quality).toContainText('50.0 percentage points higher');
  const helpTopics = quality.getByRole('region', { name: 'Question topics needing help', exact: true });
  await expect(helpTopics.getByRole('row', { name: /^Licensing / })).toContainText('3');
  await expect(helpTopics).toContainText('Legal and licensing');
  const suggestions = quality.getByRole('region', { name: 'Topics to review for saved replies', exact: true });
  await expect(suggestions).toContainText('Funding');
  await expect(suggestions).toContainText('consider adding a saved reply');
  await expect(quality).not.toContainText('Test-only-topic');
  await page.getByRole('tab', { name: 'Usage & referrals', exact: true }).click();
  await page.getByLabel('Measure', { exact: true }).selectOption('negativeReplyRate');
  await expect(page.getByRole('list', { name: 'Negative reply ratings (%) by month', exact: true })).toContainText('50.0%');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel (.xlsx)', exact: true }).click();
  const download = await downloadPromise;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(await download.path()));
  const sheet = workbook.getWorksheet('Answer quality');
  expect(sheet.getCell('B3').value).toBe(4);
  expect(sheet.getCell('B7').value).toBe(.25);
  expect(sheet.getCell('C7').value).toContain('Rating participation: 80.0%');
  expect(sheet.getCell('C8').value).toContain('Rating participation: 12.5%');
  expect(download.suggestedFilename()).toBe('monthly-analytics_2026-01_2026-03.xlsx');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('tab', { name: 'Answer quality', exact: true }).click();
  await page.getByLabel('From', { exact: true }).fill('2025-01');
  await page.getByLabel('Through', { exact: true }).fill('2025-02');
  await page.getByRole('button', { name: 'Update report', exact: true }).click();
  await expect(quality.getByRole('button', { name: /^View conversations:/ })).toHaveCount(0);
  await expect(quality).toContainText('No questions needing help found for these dates.');
  await expect(quality).toContainText('No topics meet the review criteria for these dates.');
  await expect(quality.locator('.analytics-quality-kpis article').filter({ hasText: 'Negative reply ratings' }).locator('strong')).toHaveText('—');
  await expect(quality.locator('.analytics-rating-participation > b')).toHaveText(['—', '—']);
});


test('quality card actions open conversations with applied report dates and distinct quality filters', async ({ page }) => {
  const entries = [receipt('help-chat', '02'), receipt('rated-chat', '02'), response('rated-chat', '02'), rating('rated-chat', 'down'),
    { event: 'chat_feedback', conversation_id: 'rated-chat', timestamp: '2026-04-01T00:00:00Z', feedback: { scope: 'session', value: 'sad' } }];
  const requests = [];
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/monthly-analytics')) return route.fulfill({ json: buildMonthlyAnalytics(entries.map(JSON.stringify), {
      startMonth: '2026-02', endMonth: '2026-02', now: new Date('2026-03-15T00:00:00Z'),
    }) });
    if (url.pathname.endsWith('/conversations')) {
      requests.push(Object.fromEntries(url.searchParams));
      return route.fulfill({ json: { conversations: [], total: 0, limit: 25 } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('./dashboard');
  for (const [title, quality] of [['questions needing help', 'help'], ['negative reply ratings', 'negative_reply'], ['negative chat ratings', 'negative_chat']]) {
    await page.getByRole('tab', { name: 'Monthly analytics', exact: true }).click();
    await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Usage & referrals', exact: true }).click();
    await page.getByRole('tab', { name: 'Answer quality', exact: true }).click();
    // Unapplied changes must not alter the drill-down dates.
    await page.getByLabel('From', { exact: true }).fill('2025-01');
    await page.getByRole('button', { name: `View conversations: ${title}`, exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Conversations', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Answer quality', { exact: true })).toHaveValue(quality);
    await expect(page.getByLabel('From date', { exact: true })).toHaveValue('2026-02-01');
    await expect(page.getByLabel('Through date', { exact: true })).toHaveValue('2026-02-28');
    await expect.poll(() => requests.at(-1)?.quality).toBe(quality);
    expect(requests.at(-1)).toMatchObject({ dateFrom: '2026-02-01', dateTo: '2026-02-28', offset: '0', archived: 'all' });
    await expect(page.getByLabel('Include archived conversations', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(page.getByLabel('Answer quality', { exact: true })).toHaveValue('');
  }
});
