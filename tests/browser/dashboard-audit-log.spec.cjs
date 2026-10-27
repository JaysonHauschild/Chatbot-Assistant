const { test, expect } = require('@playwright/test');
const adminToken = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"sub":"self","username":"root.admin","role":"admin"}').toString('base64url')}.test-signature`;

async function prepare(page, auditHandler) {
  await page.addInitScript((token) => sessionStorage.setItem('dashboard_token', token), adminToken);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/dashboard/audit-log')) return auditHandler(route, url);
    if (url.pathname.endsWith('/dashboard/users')) return route.fulfill({ json: {
      currentUserId: 'self', users: [{ id: 'self', username: 'root.admin', role: 'admin', active: true }],
    } });
    return route.fulfill({ json: {} });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Administration', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Users & access', exact: true }).click();
  await page.getByRole('tab', { name: 'Audit log', exact: true }).click();
}

test('administrators browse, search, expand, and refresh audit entries', async ({ page }) => {
  const entries = Array.from({ length: 53 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 9, 14, 12, index)).toISOString(),
    action: 'dashboard_user_locked', actor: { username: 'root.admin', role: 'admin' },
    target: { type: 'dashboard_user', id: `staff-${index}` },
    details: { username: `staff.${index}`, note: '<script>window.auditInjected=true</script>' },
  })).reverse();
  await prepare(page, (route, url) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${adminToken}`);
    const offset = Number(url.searchParams.get('offset'));
    const q = url.searchParams.get('q');
    const matching = q ? entries.filter((entry) => entry.target.id.includes(q)) : entries;
    return route.fulfill({ json: { items: matching.slice(offset, offset + 50), total: matching.length, limit: 50, offset } });
  });
  const audit = page.getByRole('region', { name: 'Dashboard audit log', exact: true });
  await expect(audit).toContainText('Showing 1–50 of 53 entries.');
  const table = audit.getByRole('region', { name: 'Audit entries', exact: true });
  await expect(table.getByRole('row').nth(1)).toContainText('staff-52');
  const detail = page.getByLabel('Details for dashboard_user_locked at 2026-10-14T12:52:00.000Z', { exact: true });
  await detail.click();
  await expect(table.locator('pre').first()).toContainText('"username": "staff.52"');
  expect(await page.evaluate(() => window.auditInjected)).toBeUndefined();
  await audit.getByRole('button', { name: 'Older entries', exact: true }).click();
  await expect(audit).toContainText('Showing 51–53 of 53 entries.');
  await expect(audit.getByRole('button', { name: 'Older entries', exact: true })).toBeDisabled();
  await audit.getByRole('button', { name: 'Newer entries', exact: true }).click();
  await expect(audit).toContainText('Showing 1–50 of 53 entries.');
  await audit.getByRole('searchbox', { name: 'Search audit log', exact: true }).fill('staff-52');
  await audit.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(audit).toContainText('Showing 1–1 of 1 entries.');
  await audit.getByRole('searchbox', { name: 'Search audit log', exact: true }).fill('no-match');
  await audit.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(audit).toContainText('No audit entries found.');
  await audit.getByRole('searchbox', { name: 'Search audit log', exact: true }).fill('');
  await audit.getByRole('button', { name: 'Search', exact: true }).click();
  entries.unshift({ timestamp: '2026-10-14T14:00:00.000Z', action: 'dashboard_user_sessions_revoked', actor: { username: 'second.admin' } });
  await audit.getByRole('button', { name: 'Refresh audit log', exact: true }).click();
  await expect(audit).toContainText('Showing 1–50 of 54 entries.');
  await expect(audit.getByRole('row').nth(1)).toContainText('dashboard user sessions revoked');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('audit log failures allow retry and expired sessions return to login', async ({ page }) => {
  let mode = 'error';
  await prepare(page, (route) => mode === 'error'
    ? route.fulfill({ status: 500, json: { error: 'Unable to load the dashboard audit log.' } })
    : mode === 'expired' ? route.fulfill({ status: 401, json: { error: 'Invalid session.' } })
      : route.fulfill({ json: { items: [], total: 0 } }));
  const audit = page.getByRole('region', { name: 'Dashboard audit log', exact: true });
  await expect(audit.getByRole('alert')).toContainText('Unable to load the dashboard audit log.');
  mode = 'ready';
  await audit.getByRole('button', { name: 'Refresh audit log', exact: true }).click();
  await expect(audit).toContainText('No audit entries found.');
  await expect(audit.getByRole('alert')).toHaveCount(0);
  mode = 'expired';
  await audit.getByRole('button', { name: 'Refresh audit log', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log In', exact: true })).toBeVisible();
});
