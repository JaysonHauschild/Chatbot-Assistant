const { test, expect } = require('@playwright/test');
const { buildMonthlyAnalytics } = require('../../server/lib/monthly-analytics');

async function openAnalytics(page) {
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', (route) => route.fulfill({ json: route.request().url().includes('/monthly-analytics')
    ? buildMonthlyAnalytics([], { startMonth: '2026-01', endMonth: '2026-02' }) : {} }));
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Monthly analytics', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Usage & referrals', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export Excel (.xlsx)', exact: true })).toBeEnabled();
}

test('dashboard explanations use tooltips with keyboard, touch and viewport-safe positioning', async ({ page }, testInfo) => {
  await openAnalytics(page);
  const help = page.getByRole('button', { name: 'About visits', exact: true });
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveCount(0);
  await expect(page.getByText('Recorded browser visits with chat activity. One person may visit more than once.', { exact: true })).not.toBeVisible();
  await help.scrollIntoViewIfNeeded();
  await help.focus();
  await expect(tooltip).toContainText('One person may visit more than once');
  expect(await help.getAttribute('aria-describedby')).toBe(await tooltip.getAttribute('id'));
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await help.click();
  await expect(tooltip).toBeVisible();
  const bounds = await tooltip.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
  await help.click();
  await expect(tooltip).toHaveCount(0);
  // Longer report notes remain reachable without covering the whole viewport.
  await page.getByRole('button', { name: 'About this analytics report', exact: true }).click();
  await expect(tooltip).toContainText('This report uses saved chat history');
  await page.screenshot({ path: `/tmp/dashboard-tooltips-${testInfo.project.name}.png` });
  await page.getByRole('heading', { name: 'Monthly analytics', exact: true }).click({ position: { x: 10, y: 10 } });
  await expect(tooltip).toHaveCount(0);
  const darkMode = page.getByRole('button', { name: 'Dark Mode', exact: true });
  if (await darkMode.count()) await darkMode.click();
  await help.click();
  expect(await tooltip.evaluate((node) => getComputedStyle(node).getPropertyValue('--help-surface').trim())).toBe(
    await help.evaluate((node) => getComputedStyle(node).getPropertyValue('--surface').trim()));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status').filter({ hasText: 'No saved chat activity' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('hover help stays open while reading and management field descriptions remain linked', async ({ page }) => {
  await openAnalytics(page);
  const help = page.getByRole('button', { name: 'About advising link follow-through', exact: true });
  if (page.viewportSize().width > 700) {
    await help.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await tooltip.hover();
    await page.waitForTimeout(200);
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
  }
  await page.getByRole('tab', { name: 'Management', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Chatbot instructions', exact: true }).click();
  await page.getByRole('tab', { name: /Message rules/ }).click();
  const input = page.getByRole('textbox', { name: 'Rule name (unique)', exact: true });
  await expect(input).toHaveAttribute('aria-describedby', 'newRuleIdHelp');
  await page.getByRole('button', { name: 'About rule names', exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText('Each rule needs a different name');
  await page.keyboard.press('Escape');
});
