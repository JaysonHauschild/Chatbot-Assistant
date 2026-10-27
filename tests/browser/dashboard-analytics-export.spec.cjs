const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const ExcelJS = require('../../client/node_modules/exceljs');
const { buildMonthlyAnalytics } = require('../../server/lib/monthly-analytics');

test('monthly analytics exports the applied filters and disables export while unavailable', async ({ page }) => {
  let fail = false;
  let pending;
  let release;
  const lines = ['2026-01', '2026-02'].flatMap((month) => [
    JSON.stringify({ event: 'chat_turn_received', conversationId: 'shared-chat', turn: month === '2026-01' ? 1 : 2,
      timestamp: `${month}-02T12:00:00Z`, session_id_hash: 'shared-session' }),
    JSON.stringify({ event: 'chat_response_predefined', conversationId: 'shared-chat', turn: month === '2026-01' ? 1 : 2,
      timestamp: `${month}-02T12:00:01Z`, routing: { rule_id: '=HYPERLINK("bad")' }, message_intent: 'Café, "startup"', classification: { allowed_links_used: ['https://business.oksbdc.org/reg.aspx?mode=counsel'] } }),
  ]);
  lines.push(JSON.stringify({ event: 'chat_turn_received', conversationId: 'sandbox', turn: 1, timestamp: '2026-01-02T12:00:00Z', is_test: true }),
    JSON.stringify({ event: 'chat_response', conversationId: 'sandbox', turn: 1, timestamp: '2026-01-02T12:00:01Z', message_intent: 'Test topic' }));
  for (const id of ['shared-chat', 'shared-chat', 'sandbox']) {
    lines.push(JSON.stringify({ event: 'advising_link_clicked', conversation_id: id, timestamp: '2026-02-03T00:00:00Z',
      details: { url: 'https://business.oksbdc.org/reg.aspx?mode=counsel' } }));
  }
  lines.push(JSON.stringify({ event: 'advising_link_clicked', conversation_id: 'shared-chat', timestamp: '2026-02-03T00:00:01Z',
    details: { url: 'https://www.oksbdc.org/workshops/' } }));
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/monthly-analytics')) return route.fulfill({ json: {} });
    if (pending) await pending;
    if (fail) return route.fulfill({ status: 500, json: { error: 'Analytics unavailable' } });
    return route.fulfill({ json: buildMonthlyAnalytics(lines, { ...Object.fromEntries(url.searchParams), now: new Date('2026-02-15T00:00:00Z') }) });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Monthly analytics', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Usage & referrals', exact: true }).click();
  const exportButton = page.getByRole('button', { name: 'Export Excel (.xlsx)', exact: true });
  await expect(exportButton).toBeEnabled();
  await page.getByLabel('From', { exact: true }).fill('2026-01');
  await page.getByLabel('Through', { exact: true }).fill('2026-02');
  await page.getByRole('button', { name: 'Update report', exact: true }).click();
  await expect(exportButton).toBeEnabled();

  const referralProgress = page.getByRole('progressbar', { name: 'Chats clicking an advising link', exact: true });
  await expect(referralProgress).toHaveAttribute('aria-valuenow', '100');
  await expect(referralProgress).toHaveAttribute('aria-valuetext', '1 of 1 chats clicked an advising link (100.0%).');
  await expect(referralProgress.locator('span')).toHaveAttribute('style', 'width: 100%;');
  const referralCard = page.locator('.analytics-kpis article').filter({ has: page.getByRole('heading', { name: 'Advising referral clicks', exact: true }) });
  await expect(referralCard.locator('strong')).toHaveText('2');
  const usage = page.getByRole('region', { name: 'Monthly usage table', exact: true });
  await expect(usage.getByRole('columnheader', { name: 'Advising referral clicks', exact: true })).toBeVisible();
  await expect(usage.getByRole('row').filter({ hasText: 'Feb 2026' }).getByRole('cell').nth(8)).toHaveText('2');
  await page.getByRole('combobox', { name: 'Measure', exact: true }).selectOption('advisingReferralClicks');
  await expect(page.getByRole('list', { name: 'Advising referral clicks by month', exact: true }).locator('strong')).toHaveText(['0', '2']);

  const downloadWorkbook = async () => {
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await readFile(await download.path()));
    const rows = Object.fromEntries(workbook.worksheets.map((sheet) => {
      const values = [];
      sheet.eachRow((row) => values.push(row.values.slice(1)));
      return [sheet.name, values];
    }));
    return { filename: download.suggestedFilename(), workbook, rows, text: JSON.stringify(rows) };
  };
  // Draft filters must not change the data or filename of an export.
  await expect(page.getByRole('combobox', { name: 'Traffic', exact: true })).toHaveCount(0);
  await page.getByLabel('Through', { exact: true }).fill('2026-03');
  const first = await downloadWorkbook();
  expect(first.filename).toBe('monthly-analytics_2026-01_2026-02.xlsx');
  expect(first.text).toContain('CHATBOT USAGE REPORT');
  const topics = first.workbook.getWorksheet('Question topics');
  expect(topics.getCell('A6').value).toBe('Café, "startup"');
  expect(topics.getCell('B6').value).toBe(2);
  expect(topics.getCell('C6').value).toBe(1);
  expect(first.text).not.toContain('HYPERLINK');
  expect(first.text).not.toContain('Test topic');
  expect(first.rows.Summary.find((row) => row[0] === 'Advising referral clicks')[1]).toBe(2);
  expect(first.rows.Summary.find((row) => row[0] === 'All OKSBDC link clicks')[1]).toBe(3);
  expect(first.rows.Summary.find((row) => row[0] === 'Chats sharing an advising link')[1]).toBe(1);
  expect(first.rows.Summary.find((row) => row[0] === 'Advising chat click rate')[1]).toBe(1);
  const monthly = first.workbook.getWorksheet('Monthly usage');
  expect(monthly.getCell('E5').value).toBe('In progress');
  expect(monthly.getCell('G4').value).toBe('Whole reporting period');
  // Range totals count the shared session/chat once, while both months count them.
  expect(monthly.getCell('H6').value).toBe(1);
  expect(monthly.getCell('H7').value).toBe(1);
  expect(monthly.getCell('H8').value).toBe(2);
  expect(monthly.columnCount).toBe(8);
  expect(first.workbook.getWorksheet('Summary').getColumn(3).width).toBeLessThanOrEqual(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  pending = new Promise((resolve) => { release = resolve; });
  await page.getByRole('button', { name: 'Update report', exact: true }).click();
  await expect(exportButton).toBeDisabled();
  release();
  pending = null;
  await expect(exportButton).toBeEnabled();
  const second = await downloadWorkbook();
  expect(second.filename).toBe('monthly-analytics_2026-01_2026-03.xlsx');
  expect(second.workbook.getWorksheet('Monthly usage').getCell('B6').value).toBe(1);
  expect(second.workbook.getWorksheet('Monthly usage').getCell('B10').value).toBe(1);
  expect(second.text).toContain('Café');
  expect(second.text).not.toContain('Test topic');
  fail = true;
  await page.getByRole('button', { name: 'Update report', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Analytics unavailable');
  await expect(exportButton).toBeDisabled();
});


test('referral progress shows partial uptake and handles dates with no referrals', async ({ page }) => {
  const url = 'https://business.oksbdc.org/reg.aspx?mode=counsel';
  const lines = ['clicked', 'unclicked'].map((id) => JSON.stringify({ event: 'chat_response', conversation_id: id, turn: 1,
    timestamp: '2026-01-02T00:00:00Z', message: { assistant_redacted: `Request [advising](${url}).` } }));
  lines.push(JSON.stringify({ event: 'chat_turn_received', conversation_id: 'no-referral', turn: 1, timestamp: '2026-01-02T00:00:00Z' }));
  for (const day of ['03', '04']) lines.push(JSON.stringify({ event: 'advising_link_clicked', conversation_id: 'clicked',
    timestamp: `2026-01-${day}T00:00:00Z`, details: { url } }));
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.pathname.endsWith('/monthly-analytics')
      ? buildMonthlyAnalytics(lines, Object.fromEntries(url.searchParams)) : {} });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Monthly analytics', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Usage & referrals', exact: true }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-01');
  await page.getByLabel('Through', { exact: true }).fill('2026-01');
  await page.getByRole('button', { name: 'Update report', exact: true }).click();
  const bar = page.getByRole('progressbar', { name: 'Chats clicking an advising link', exact: true });
  await expect(bar).toHaveAttribute('aria-valuenow', '50');
  await expect(bar).toHaveAttribute('aria-valuetext', '1 of 2 chats clicked an advising link (50.0%).');
  await expect(bar.locator('span')).toHaveAttribute('style', 'width: 50%;');
  const allChatsBar = page.getByRole('progressbar', { name: 'Referral clicks across all chats', exact: true });
  await expect(allChatsBar).toHaveAttribute('aria-valuenow', '33');
  await expect(allChatsBar).toHaveAttribute('aria-valuetext', '1 of 3 total chats clicked an advising link (33.3%).');
  const rectangles = await page.locator('.analytics-referral-progress').evaluateAll((bars) => bars.map((bar) => ({ x: bar.getBoundingClientRect().x, y: bar.getBoundingClientRect().y })));
  if (page.viewportSize().width > 700) {
    expect(rectangles[1].x).toBeGreaterThan(rectangles[0].x);
    expect(rectangles[1].y).toBe(rectangles[0].y);
  } else {
    expect(rectangles[1].y).toBeGreaterThan(rectangles[0].y);
  }
  await page.getByRole('button', { name: 'About advising link follow-through', exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText('2 total referral clicks');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('From', { exact: true }).fill('2026-02');
  await page.getByLabel('Through', { exact: true }).fill('2026-02');
  await page.getByRole('button', { name: 'Update report', exact: true }).click();
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  await expect(bar).toHaveAttribute('aria-valuetext', 'No chats shared an advising link during these dates.');
  await expect(allChatsBar).toHaveAttribute('aria-valuenow', '0');
  await expect(allChatsBar).toHaveAttribute('aria-valuetext', 'No chats recorded during these dates.');
});
