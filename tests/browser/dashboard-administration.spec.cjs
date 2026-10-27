const { test, expect } = require('@playwright/test');
const tokenFor = (role) => `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ role, sub: 'self', username: 'root.admin' })).toString('base64url')}.test-signature`;

test('administrators create users, change roles and confirm deletion without editing their own access', async ({ page }) => {
  let users = [{ id: 'self', username: 'root.admin', role: 'admin', active: true, onboardingRequired: false }];
  let failCreate = true;
  let failRole = true;
  const writes = [];
  await page.addInitScript((token) => sessionStorage.setItem('dashboard_token', token), tokenFor('admin'));
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (!url.pathname.includes('/dashboard/users')) return route.fulfill({ json: {} });
    if (request.method() === 'GET') return route.fulfill({ json: { currentUserId: 'self', users } });
    writes.push({ method: request.method(), body: request.postDataJSON() });
    if (request.method() === 'POST') {
      if (failCreate) { failCreate = false; return route.fulfill({ status: 409, json: { error: 'That username already exists.' } }); }
      const body = request.postDataJSON();
      const user = { id: 'new', username: body.username, role: body.role, active: true, onboardingRequired: true };
      users = [...users, user];
      return route.fulfill({ status: 201, json: { user, temporaryPassword: 'sample-generated-temporary-password' } });
    }
    if (request.method() === 'PUT') {
      if (failRole) { failRole = false; return route.fulfill({ status: 500, json: { error: 'Unable to change the user role.' } }); }
      users = users.map((user) => user.id === 'new' ? { ...user, role: request.postDataJSON().role } : user);
      return route.fulfill({ json: { user: users.find((user) => user.id === 'new') } });
    }
    users = users.filter((user) => user.id !== 'new');
    return route.fulfill({ status: 204 });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Administration', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Users & access', exact: true }).click();
  const create = page.getByRole('form', { name: 'Create dashboard user', exact: true });
  await expect(page.getByRole('button', { name: 'Delete root.admin', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Role for root.admin', exact: true })).toHaveCount(0);
  await create.getByRole('textbox', { name: 'Username', exact: true }).fill('new.viewer');
  await expect(create.getByRole('combobox', { name: 'Role', exact: true })).toHaveValue('readonly');
  await create.getByRole('button', { name: 'Create user', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('That username already exists.');
  await expect(create.getByRole('textbox')).toHaveValue('new.viewer');
  await create.getByRole('button', { name: 'Create user', exact: true }).click();
  const credentials = page.getByRole('region', { name: 'New user credentials', exact: true });
  await expect(credentials).toContainText('sample-generated-temporary-password');
  await expect(page.getByRole('region', { name: 'Dashboard users', exact: true })).toContainText('First login pending');
  const role = page.getByRole('combobox', { name: 'Role for new.viewer', exact: true });
  await role.selectOption('admin');
  await page.getByRole('button', { name: 'Save role for new.viewer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to change the user role.');
  await expect(role).toHaveValue('admin');
  await page.getByRole('button', { name: 'Save role for new.viewer', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Updated new.viewer to Administrator.');
  await page.getByRole('button', { name: 'Dismiss credentials', exact: true }).click();
  await expect(credentials).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete new.viewer', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes.filter((write) => write.method === 'DELETE')).toHaveLength(0);
  await page.getByRole('button', { name: 'Delete new.viewer', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete new.viewer', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Deleted new.viewer.');
  await expect(page.getByRole('combobox', { name: 'Role for new.viewer', exact: true })).toHaveCount(0);
  expect(writes[1].body).toEqual({ username: 'new.viewer', role: 'readonly' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const role of ['dashboard', 'readonly']) {
  test(`${role} accounts never see the Administration tab`, async ({ page }) => {
    await page.addInitScript((token) => sessionStorage.setItem('dashboard_token', token), tokenFor(role));
    const userRequests = [];
    await page.route('**/api/**', (route) => {
      if (/\/dashboard\/(users|audit-log)/.test(route.request().url())) userRequests.push(route.request().url());
      return route.fulfill({ json: {} });
    });
    await page.goto('./dashboard');
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Administration', exact: true })).toHaveCount(0);
    await expect(page.locator('#dashboard-panel-administration')).toHaveCount(0);
    expect(userRequests).toEqual([]);
  });
}

test('account controls reset passwords briefly, lock and unlock, and revoke sessions', async ({ page }) => {
  let user = { id: 'staff', username: 'staff.editor', role: 'dashboard', active: true, onboardingRequired: false, locked: false };
  const writes = [];
  await page.clock.install();
  await page.addInitScript((token) => sessionStorage.setItem('dashboard_token', token), tokenFor('admin'));
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (!url.pathname.includes('/dashboard/users')) return route.fulfill({ json: {} });
    if (request.method() === 'GET') return route.fulfill({ json: { currentUserId: 'self', users: [
      { id: 'self', username: 'root.admin', role: 'admin', active: true }, user,
    ] } });
    writes.push(url.pathname);
    if (url.pathname.endsWith('/reset-password')) {
      user = { ...user, passwordResetRequired: true };
      return route.fulfill({ json: { user, temporaryPassword: 'sample-reset-temporary-password' } });
    }
    if (url.pathname.endsWith('/lock')) user = { ...user, locked: request.postDataJSON().locked };
    return route.fulfill({ json: { user } });
  });
  await page.goto('./dashboard');
  await page.getByRole('tab', { name: 'Administration', exact: true }).click();
  await page.locator('.dashboard-sidebar').getByRole('link', { name: 'Users & access', exact: true }).click();
  await page.getByRole('button', { name: 'Reset password for staff.editor', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel reset', exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Reset password for staff.editor', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reset password for staff.editor', exact: true }).click();
  const credentials = page.getByRole('region', { name: 'New user credentials', exact: true });
  await expect(credentials).toContainText('sample-reset-temporary-password');
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain('sample-reset-temporary-password');
  await page.clock.fastForward(60_001);
  await expect(credentials).toHaveCount(0);
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'staff.editor', exact: true }) });
  await expect(row).toContainText('Password change required');
  await page.getByRole('button', { name: 'Lock staff.editor', exact: true }).click();
  await expect(row).toContainText('Locked');
  await expect(page.getByRole('status')).toContainText('Existing sessions were kept.');
  await page.getByRole('button', { name: 'Unlock staff.editor', exact: true }).click();
  await expect(row).toContainText('Password change required');
  await page.getByRole('button', { name: 'Revoke sessions for staff.editor', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm revoke sessions for staff.editor', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revoked all active sessions for staff.editor.');
  await page.getByRole('button', { name: 'Revoke sessions for root.admin', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm revoke sessions for root.admin', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log In', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('dashboard_token'))).toBeNull();
});

test('temporary-password login requires a new password and preserves reset mode across refresh', async ({ page }) => {
  const submitted = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/login')) return route.fulfill({ json: {
      token: tokenFor('onboarding'), onboardingRequired: true, passwordResetRequired: true,
      user: { username: 'staff.editor', role: 'dashboard' },
    } });
    if (path.endsWith('/auth/onboarding')) {
      submitted.push(route.request().postDataJSON());
      return route.fulfill({ json: { token: tokenFor('dashboard'), onboardingRequired: false, passwordResetRequired: false,
        user: { username: 'staff.editor', role: 'dashboard' } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('./dashboard');
  await page.getByLabel('Username', { exact: true }).fill('staff.editor');
  await page.getByLabel('Password', { exact: true }).fill('sample-reset-temporary-password');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
  await expect(page.getByLabel('First name', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveCount(0);
  await page.getByLabel('New password', { exact: true }).fill('my replacement password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('my replacement password');
  await page.getByRole('button', { name: 'Save new password', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
  expect(submitted).toEqual([{ password: 'my replacement password' }]);
  expect(await page.evaluate(() => sessionStorage.getItem('dashboard_password_reset_required'))).toBeNull();
});
