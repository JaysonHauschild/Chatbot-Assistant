const { test, expect } = require('@playwright/test');
const { buildMonthlyAnalytics } = require('../../server/lib/monthly-analytics');

test('dashboard sidebar expands, switches sections, and supports keyboard navigation', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-token'));
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/conversations')) return route.fulfill({ json: { conversations: [], total: 0, limit: 25 } });
    if (url.pathname.endsWith('/monthly-analytics')) return route.fulfill({ json: buildMonthlyAnalytics([], { startMonth: '2026-01', endMonth: '2026-01' }) });
    return route.fulfill({ json: {} });
  });
  await page.goto('./dashboard');
  const sidebar = page.locator('.dashboard-sidebar');
  const views = page.getByRole('tablist', { name: 'Dashboard views' });
  await expect(views).toHaveAttribute('aria-orientation', 'vertical');
  await expect(page.getByRole('button', { name: 'Expand navigation', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.dashboard-tabs')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
  const collapsedWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse navigation', exact: true })).toHaveAttribute('aria-expanded', 'true');
  expect(await sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(collapsedWidth);
  await expect(sidebar.getByText('Monthly analytics', { exact: true })).toBeVisible();
  if (mobile) {
    await expect(sidebar).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('.dashboard-card')).toHaveAttribute('inert', '');
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeFocused();
  }
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await expect(page.locator('#dashboard-panel-conversations')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Conversations', exact: true })).toHaveAttribute('aria-selected', 'true');
  if (mobile) await expect(page.getByRole('button', { name: 'Expand navigation', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Conversations', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Monthly analytics', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeFocused();
  if (!mobile) await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Expand navigation', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/dashboard-sidebar-${testInfo.project.name}-collapsed.png`, fullPage: true });
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  await page.screenshot({ path: `/tmp/dashboard-sidebar-${testInfo.project.name}-expanded.png`, fullPage: true });
  if (mobile) {
    await page.locator('.dashboard-navigation-backdrop').click({ position: { x: 330, y: 250 } });
    await expect(page.getByRole('button', { name: 'Expand navigation', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  }
});

test('sidebar sections reveal subtab links and keep the selected view in sync', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"sub":"self","role":"admin"}').toString('base64url')}.test`;
  await page.addInitScript((value) => sessionStorage.setItem('dashboard_token', value), token);
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/monthly-analytics')) return route.fulfill({ json: buildMonthlyAnalytics([], { startMonth: '2026-01', endMonth: '2026-02' }) });
    if (path.endsWith('/users')) return route.fulfill({ json: { currentUserId: 'self', users: [] } });
    if (path.endsWith('/audit-log')) return route.fulfill({ json: { items: [], total: 0 } });
    return route.fulfill({ json: {} });
  });
  await page.goto('./dashboard');
  const sidebar = page.locator('.dashboard-sidebar');
  for (const [section, links, target, panelTab] of [
    ['Monthly analytics', ['Usage & referrals', 'Answer quality', 'Topics & rules'], 'Topics & rules', 'Answer quality'],
    ['Management', ['Chatbot instructions', 'Message rules', 'Response review', 'Change history'], 'Message rules', 'Response review'],
    ['Administration', ['Users & access', 'Audit log'], 'Audit log', 'Users & access'],
  ]) {
    const parent = sidebar.getByRole('tab', { name: section, exact: true });
    await parent.click();
    await expect(parent).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar.getByRole('link')).toHaveText(links);
    await parent.click();
    await expect(parent).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar.getByRole('link')).toHaveCount(0);
    await parent.click();
    if (mobile) {
      await expect(page.locator('.dashboard-card')).toHaveAttribute('inert', '');
      await sidebar.getByRole('link').last().focus();
      await page.keyboard.press('Tab');
      await expect(sidebar.getByRole('button', { name: 'Collapse navigation', exact: true })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(sidebar.getByRole('link').last()).toBeFocused();
    }
    await sidebar.getByRole('link', { name: target, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: target, exact: section !== 'Management' })).toBeVisible();
    if (mobile) {
      await expect(page.getByRole('button', { name: 'Expand navigation', exact: true })).toBeFocused();
      await expect(page.locator('.dashboard-card')).not.toHaveAttribute('inert', '');
    } else {
      await expect(sidebar.getByRole('link', { name: target, exact: true })).toHaveAttribute('aria-current', 'page');
    }
    await page.getByRole('tab', { name: panelTab, exact: section !== 'Management' }).click();
    if (mobile) await sidebar.getByRole('button', { name: 'Expand navigation', exact: true }).click();
    await expect(sidebar.getByRole('link', { name: panelTab, exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/dashboard-sidebar-${section.replaceAll(' ', '-')}-${testInfo.project.name}.png`, fullPage: false });
    if (mobile) await page.keyboard.press('Escape');
  }
});
