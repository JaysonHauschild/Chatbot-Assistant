const { test, expect } = require('@playwright/test');

test('an empty dashboard module shows a recovery action and reload restores the login screen', async ({ page }) => {
  let emptyModule = true;
  await page.route('**/src/Dashboard.jsx*', (route) => emptyModule
    ? route.fulfill({ contentType: 'text/javascript', body: 'export {}' }) : route.continue());
  await page.goto('./dashboard');
  await expect(page.getByRole('alert')).toContainText('Dashboard could not load');
  await expect(page.getByRole('button', { name: 'Reload dashboard', exact: true })).toBeVisible();
  emptyModule = false;
  await page.getByRole('button', { name: 'Reload dashboard', exact: true }).click();
  await expect(page.getByText('Sign in to review conversations, see usage, and update the chatbot.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a pending dashboard module displays a loading message', async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route('**/src/Dashboard.jsx*', async (route) => { await pending; await route.continue(); });
  await page.goto('./dashboard', { waitUntil: 'domcontentloaded' });
  try {
    await expect(page.getByRole('status')).toHaveText('Loading dashboard…');
  } finally { release(); }
  await expect(page.getByText('Sign in to review conversations, see usage, and update the chatbot.', { exact: true })).toBeVisible();
});
