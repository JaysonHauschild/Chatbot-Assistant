const { test, expect } = require('@playwright/test');

test('rule editor adds suggested and new tags with Enter and Tab and saves category-only edits', async ({ page }) => {
  let items = [
    { id: 'funding_rule', pattern: '/\\bgrants?\\b/im', regexPattern: '\\bgrants?\\b', action: 'respond', reply: 'Grant resources.',
      intents: ['funding'], prevIntents: ['planning'], userIntents: ['exploratory'] },
    { id: 'legal_rule', pattern: '/license/i', regexPattern: 'license', action: 'respond', reply: 'Licensing resources.', intents: ['legal'] },
  ];
  const writes = [];
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/message-filter/rules') && route.request().method() === 'GET') return route.fulfill({ json: { items, totalRules: items.length } });
    if (['PUT', 'POST'].includes(route.request().method()) && url.pathname.includes('/message-filter/rules')) {
      const body = route.request().postDataJSON();
      writes.push(body);
      const index = items.findIndex((item) => item.id === body.id);
      const item = { ...body, pattern: `/${body.regexPattern}/i` };
      if (index < 0) items.push(item); else items[index] = item;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Management', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Chatbot instructions', exact: true }).click();
  await page.getByRole('tab', { name: /Message rules/ }).click();
  const card = page.locator('.dashboard-rule-sort-item').filter({ hasText: 'funding_rule' });
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Add message rule' });
  const categories = editor.getByRole('combobox', { name: 'Question categories', exact: true });
  await expect(editor.getByRole('textbox', { name: 'Advanced matching pattern (regex)', exact: true })).toHaveValue('\\bgrants?\\b');
  await expect(editor.getByRole('button', { name: 'Remove funding from Question categories', exact: true })).toBeVisible();
  await categories.click();
  await editor.getByRole('option', { name: 'legal', exact: true }).click();
  await categories.fill('New Topic');
  await categories.press('Enter');
  await expect(editor.getByRole('button', { name: 'Remove new_topic from Question categories', exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await categories.fill('community');
  await categories.press('Tab');
  await expect(editor.getByRole('button', { name: 'Remove community from Question categories', exact: true })).toBeVisible();
  await categories.fill('FUNDING');
  await categories.press('Enter');
  await expect(editor.getByRole('button', { name: 'Remove funding from Question categories', exact: true })).toHaveCount(1);
  await editor.getByRole('button', { name: 'Remove legal from Question categories', exact: true }).click();
  await editor.getByRole('button', { name: 'Save Rule', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ id: 'funding_rule', regexPattern: '\\bgrants?\\b', intents: ['funding', 'new_topic', 'community'],
    prevIntents: ['planning'], userIntents: ['exploratory'], reply: 'Grant resources.' });
  await expect(editor.getByRole('heading', { name: 'Add message rule', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Remove community from Question categories', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel Edit', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Rule name (unique)', exact: true }).fill('new_rule');
  await editor.getByRole('button', { name: 'Words and phrases', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Words or phrases (separate with commas)', exact: true }).fill('local help');
  await editor.getByRole('textbox', { name: 'Reply', exact: true }).fill('Contact an advisor.');
  await categories.fill('advising');
  await categories.press('Enter');
  await editor.getByRole('button', { name: 'Add Rule', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].intents).toEqual(['advising']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
