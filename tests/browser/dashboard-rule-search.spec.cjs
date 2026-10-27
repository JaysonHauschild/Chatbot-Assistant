const { test, expect } = require('@playwright/test');

test('existing rules can be searched by name, literal pattern text, and response', async ({ page }) => {
  const items = [
    { id: 'business_startup', pattern: '\\b(start|launch)\\b', reply: 'Make a business plan.', action: 'respond', order: 1 },
    { id: 'funding_options', pattern: '(grant|loan)', reply: 'Explore financing with a local lender.', action: 'respond', order: 2 },
    { id: 'safety_notice', pattern: 'suspicious', message: 'Please contact an advisor for assistance.', action: 'block', order: 3 },
  ];
  const mutations = [];
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    if (route.request().method() !== 'GET') mutations.push(route.request().url());
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.pathname.endsWith('/message-filter/rules') ? { items, totalRules: items.length } : {} });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Management', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Chatbot instructions', exact: true }).click();
  await page.getByRole('tab', { name: /Message rules/ }).click();
  const section = page.getByRole('region', { name: 'Existing message rules' });
  const search = section.getByRole('searchbox', { name: 'Search existing rules' });
  const cards = section.locator('.dashboard-rule-sort-item');
  await expect(cards).toHaveCount(3);
  await search.fill('  FUNDING_OPTIONS  ');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('funding_options');
  await expect(section.getByRole('status')).toHaveText('1 of 3 rules match your search.');
  // Movement controls still reflect the rule's position in the full list.
  await expect(cards.getByRole('button', { name: 'Move up', exact: true })).toBeEnabled();
  await expect(cards.getByRole('button', { name: 'Move down', exact: true })).toBeEnabled();
  await search.fill('\\b(start|launch)\\b');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('business_startup');
  await expect(cards.getByRole('button', { name: 'Move up', exact: true })).toBeDisabled();
  await search.fill('LOCAL LENDER');
  await expect(cards).toHaveCount(1);
  await cards.getByText('Rule details', { exact: true }).click();
  await expect(cards.first()).toContainText('Explore financing with a local lender.');
  await search.fill('contact an advisor');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('safety_notice');
  await expect(cards.getByRole('button', { name: 'Move down', exact: true })).toBeDisabled();
  await search.fill('[(');
  await expect(cards).toHaveCount(0);
  await expect(section.getByText('No rules match your search. Try another term or clear the search.')).toBeVisible();
  await section.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(cards).toHaveCount(3);
  await search.fill('   ');
  await expect(cards).toHaveCount(3);
  expect(mutations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
