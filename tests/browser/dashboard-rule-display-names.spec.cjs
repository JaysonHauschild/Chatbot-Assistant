const { test, expect } = require('@playwright/test');
const { buildMonthlyAnalytics } = require('../../server/lib/monthly-analytics');

test('renaming a rule preserves its ID and updates dashboard labels and analytics', async ({ page }) => {
  test.setTimeout(60_000);
  let item = { id: 'loan_help', displayName: 'loan_help', pattern: '/loan/i', regexPattern: 'loan', reply: 'Talk to an advisor.', action: 'respond', order: 1 };
  const writes = [];
  const analytics = buildMonthlyAnalytics([
    JSON.stringify({ event: 'chat_turn_received', conversation_id: 'example', turn: 1, timestamp: '2026-01-01T12:00:00Z' }),
    JSON.stringify({ event: 'chat_response_predefined', conversation_id: 'example', turn: 1, timestamp: '2026-01-01T12:00:01Z', predefinedByRule: 'loan_help' }),
  ], { startMonth: '2026-01', endMonth: '2026-01' });
  const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"admin"}').toString('base64url')}.test`;
  await page.addInitScript(value => sessionStorage.setItem('dashboard_token', value), token);
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/message-filter/rules/loan_help') && request.method() === 'PUT') {
      const body = request.postDataJSON(); writes.push(body);
      item = { ...item, displayName: body.displayName };
      return route.fulfill({ json: { ok: true, id: item.id, displayName: item.displayName } });
    }
    if (path.endsWith('/message-filter/rules')) return route.fulfill({ json: { items: [item], totalRules: 1 } });
    if (path.endsWith('/monthly-analytics')) return route.fulfill({ json: analytics });
    if (path.endsWith('/rollback-snapshots')) return route.fulfill({ json: { items: [] } });
    if (path.endsWith('/system-prompt')) return route.fulfill({ json: { systemPrompt: 'Saved instructions' } });
    return route.fulfill({ json: {} });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Management', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Message rules', exact: true }).click();
  const card = page.locator('.dashboard-rule-sort-item').first();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Add message rule', exact: true });
  const name = editor.getByRole('textbox', { name: 'Rule name', exact: true });
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue('loan_help');
  await name.fill('Business loan help');
  await expect(editor.getByRole('region', { name: 'Rule summary' })).toContainText('Unsaved changes: Rule name.');
  await editor.getByRole('button', { name: 'Save Rule', exact: true }).click();
  await expect(card).toContainText('Business loan help');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ id: 'loan_help', displayName: 'Business loan help', keywords: 'loan' });
  const search = page.getByRole('searchbox', { name: 'Search existing rules' });
  await search.fill('Business loan help');
  await expect(card).toBeVisible();
  await search.fill('loan_help');
  await expect(card).toContainText('Business loan help');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(name).toHaveValue('Business loan help');
  await expect(editor.getByRole('button', { name: 'Save Rule', exact: true })).toBeDisabled();
  await name.fill('An unsaved name');
  page.once('dialog', dialog => dialog.accept());
  await editor.getByRole('button', { name: 'Cancel Edit', exact: true }).click();
  await expect(card).toContainText('Business loan help');
  expect(writes).toHaveLength(1);
  await page.getByRole('tab', { name: 'Monthly analytics', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Usage & referrals', exact: true }).click();
  await page.getByRole('tab', { name: 'Topics & rules', exact: true }).click();
  const rules = page.getByRole('region', { name: 'Rules used', exact: true });
  await expect(rules).toContainText('Business loan help');
  await expect(rules).not.toContainText('loan_help');
});
