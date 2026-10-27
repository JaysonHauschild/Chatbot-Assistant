const { test, expect } = require('@playwright/test');

test('clear editing preserves simple matching, previews draft changes, handles errors and cancels without saving', async ({ page }) => {
  test.setTimeout(60_000);
  let items = [
    { id: 'loan_help', pattern: '/loan|SBA loan/i', regexPattern: 'loan|SBA loan', reply: 'Talk with an advisor.', action: 'respond', order: 1, intents: ['funding'] },
    { id: 'advanced_help', pattern: '/\\bgrants?\\b/im', regexPattern: '\\bgrants?\\b', negativePattern: '/personal/i', reply: 'Grant guidance.', action: 'respond', order: 2 },
  ];
  let failSave = true;
  const writes = [];
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.endsWith('/rules/test')) return route.fulfill({ json: { matched: true, action: 'respond', reply: request.postDataJSON().reply, persisted: false } });
    if (url.pathname.includes('/message-filter/rules') && request.method() === 'PUT') {
      const body = request.postDataJSON(); writes.push(body);
      if (failSave) { failSave = false; return route.fulfill({ status: 500, json: { error: 'Unable to save this message rule.' } }); }
      items = items.map((item) => item.id === body.id ? { ...item, ...body, regexPattern: 'loan|SBA loan' } : item);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: url.pathname.endsWith('/message-filter/rules') ? { items, totalRules: items.length } : {} });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Management', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Chatbot instructions', exact: true }).click();
  await page.getByRole('tab', { name: /Message rules/ }).click();
  const editor = page.getByRole('region', { name: 'Add message rule' });
  const cards = page.locator('.dashboard-rule-sort-item');
  await cards.filter({ hasText: 'loan_help' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'Words or phrases (separate with commas)', exact: true })).toHaveValue('loan, SBA loan');
  await expect(editor.getByRole('region', { name: 'Rule summary', exact: true })).toContainText('No unsaved changes.');
  await expect(editor.getByRole('button', { name: 'Save Rule', exact: true })).toBeDisabled();
  await editor.getByRole('textbox', { name: 'Reply', exact: true }).fill('Book a free advising appointment.');
  await expect(editor.getByRole('region', { name: 'Rule summary', exact: true })).toContainText('Unsaved changes: Reply.');
  await cards.filter({ hasText: 'advanced_help' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'Rule name', exact: true })).toHaveValue('loan_help');
  await expect(editor.getByText('You have unsaved changes. Save this rule or choose Cancel Edit before opening another rule.', { exact: true })).toBeVisible();
  await editor.getByText('Test this rule', { exact: true }).click();
  await editor.getByRole('textbox', { name: 'Example visitor message', exact: true }).fill('I need an SBA loan');
  await editor.getByRole('button', { name: 'Try example message', exact: true }).click();
  await expect(editor.getByText('This draft matches', { exact: false })).toBeVisible();
  await editor.getByRole('textbox', { name: 'Reply', exact: true }).fill('Call an advisor today.');
  await expect(editor.getByText('This draft matches', { exact: false })).toHaveCount(0);
  await editor.getByLabel('Reply language', { exact: true }).selectOption('fr');
  await expect(editor.getByRole('region', { name: 'Rule summary', exact: true })).toContainText('Unsaved changes: Reply, Language.');
  await expect(editor.getByRole('region', { name: 'Rule summary', exact: true })).toContainText('French');
  await editor.getByRole('button', { name: 'Save Rule', exact: true }).click();
  await expect(editor.getByText('Unable to save this message rule.', { exact: true })).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue('Call an advisor today.');
  await editor.getByRole('button', { name: 'Save Rule', exact: true }).click();
  await expect(editor.getByRole('heading', { name: 'Add message rule', exact: true })).toBeVisible();
  expect(writes.at(-1)).toMatchObject({ id: 'loan_help', keywords: 'loan, SBA loan', regexPattern: '', reply: 'Call an advisor today.', action: 'respond', language: 'fr' });
  await expect(editor.getByRole('button', { name: 'Words and phrases', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await cards.filter({ hasText: 'advanced_help' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'Advanced matching pattern (regex)', exact: true })).toHaveValue('\\bgrants?\\b');
  await expect(editor.getByRole('region', { name: 'Rule summary', exact: true })).toContainText('Saved exclusion kept: /personal/i');
  await editor.getByRole('textbox', { name: 'Advanced matching pattern (regex)', exact: true }).fill('[unfinished');
  await expect(editor.getByRole('region', { name: 'Rule summary', exact: true })).toContainText('incomplete or invalid');
  await expect(editor.getByRole('button', { name: 'Save Rule', exact: true })).toBeDisabled();
  page.once('dialog', (dialog) => dialog.accept());
  await editor.getByRole('button', { name: 'Cancel Edit', exact: true }).click();
  expect(writes).toHaveLength(2);
  await expect(editor.getByLabel('Reply language', { exact: true })).toHaveValue('en');
  await expect(editor.getByRole('textbox', { name: 'Rule name (unique)', exact: true })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
