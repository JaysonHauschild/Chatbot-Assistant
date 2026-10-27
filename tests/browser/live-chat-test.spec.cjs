const { test, expect } = require('@playwright/test');
const token = role => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.test`;

async function prepare(page, role = 'dashboard', fail = false) {
  const requests = [];
  await page.addInitScript(value => {
    sessionStorage.setItem('dashboard_token', value);
    sessionStorage.setItem('oksbdc_chat_session_id', 'existing-public-session');
    sessionStorage.setItem('oksbdc_chat_visit_id', 'existing-public-visit');
    sessionStorage.setItem('chatbot_disclaimer_agreed', 'true');
  }, token(role));
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/live-chat-test')) {
      requests.push(request);
      return route.fulfill({ status: fail ? 401 : 200, json: fail ? { error: 'Please log in again.' } : { token: 'test-session-token', expiresAt: new Date(Date.now() + 1800000).toISOString() } });
    }
    if (path.endsWith('/api/chat')) {
      requests.push(request);
      return route.fulfill({ json: { reply: 'A live test reply.', aiGenerated: true, conversationId: 'live-test-browser', turn: 1 } });
    }
    if (/\/api\/(chat\/reset|chat\/link-click|feedback)$/.test(path)) {
      requests.push(request);
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/system-prompt')) return route.fulfill({ json: { systemPrompt: 'Saved prompt.' } });
    if (path.endsWith('/message-filter/rules')) return route.fulfill({ json: { items: [], totalRules: 0 } });
    return route.fulfill({ json: {} });
  });
  await page.goto('./dashboard');
  return requests;
}

test('dashboard opens the real widget with test authorization and isolated session storage', async ({ page }) => {
  const requests = await prepare(page);
  await page.getByRole('button', { name: 'Test live chatbot', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Test live chatbot' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Test conversations and feedback are not saved/)).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({ path: `/tmp/live-chat-test-${page.viewportSize().width}.png` });
  await dialog.getByRole('textbox').fill('How do I start a business?');
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(dialog.getByText('A live test reply.', { exact: true }).first()).toBeVisible();
  const chat = requests.find(request => new URL(request.url()).pathname.endsWith('/api/chat'));
  expect(chat.headers()['x-live-chat-test']).toBe('test-session-token');
  expect(chat.postDataJSON().sessionId).not.toBe('existing-public-session');
  expect(chat.postDataJSON().visitId).not.toBe('existing-public-visit');
  expect(requests[0].headers().authorization).toBe(`Bearer ${token('dashboard')}`);
  expect(await page.evaluate(() => sessionStorage.getItem('oksbdc_chat_session_id'))).toBe('existing-public-session');
  expect(await page.evaluate(() => sessionStorage.getItem('oksbdc_chat_visit_id'))).toBe('existing-public-visit');
  expect(await page.evaluate(() => Object.values(sessionStorage))).not.toContain('test-session-token');
  await dialog.getByRole('button', { name: 'Close test', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Test live chatbot', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Test live chatbot', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('A live test reply.', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('read-only accounts do not see the live test button', async ({ page }) => {
  await prepare(page, 'readonly');
  await expect(page.getByRole('heading', { name: 'Chatbot Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test live chatbot', exact: true })).toHaveCount(0);
});

test('simulates a custom delay locally and shows reassurance after twelve seconds', async ({ page }) => {
  const requests = await prepare(page);
  await page.getByRole('button', { name: 'Test live chatbot', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Test live chatbot' });
  await expect(dialog).toBeVisible();
  await page.clock.install();
  await dialog.getByLabel('Response delay (seconds)').fill('120');
  await dialog.getByRole('textbox').fill('A simulated question');
  const simulate = dialog.getByRole('button', { name: 'Simulate delayed response', exact: true });
  await simulate.click();
  await expect(simulate).toBeDisabled();
  await expect(dialog.locator('.message-thinking')).toBeVisible();
  await expect(dialog.locator('.message-user').last()).toContainText('A simulated question');
  await page.clock.fastForward(11_000);
  await expect(dialog.getByText("We're working on it", { exact: true })).toHaveCount(0);
  await page.clock.fastForward(1_000);
  await expect(dialog.getByText("We're working on it", { exact: true })).toBeVisible();
  await page.clock.fastForward(79_000);
  await expect(dialog.locator('.message-thinking')).toBeVisible();
  await page.clock.fastForward(30_000);
  await expect(dialog.getByText('Simulated response after 120 seconds.', { exact: true })).toBeVisible();
  await expect(dialog.locator('.message-thinking')).toHaveCount(0);
  await expect(simulate).toBeEnabled();
  expect(requests.filter(request => new URL(request.url()).pathname.endsWith('/api/chat'))).toHaveLength(0);

  await simulate.click();
  await dialog.getByRole('button', { name: 'Open chat options', exact: true }).click();
  await dialog.getByRole('menuitem', { name: 'Reset Chat', exact: true }).click();
  await page.clock.fastForward(121_000);
  await expect(dialog.getByText('Simulated response after 120 seconds.', { exact: true })).toHaveCount(0);
  await expect(dialog.locator('.message-thinking')).toHaveCount(0);
});

test('failed authorization shows an error without opening a test', async ({ page }) => {
  await prepare(page, 'dashboard', true);
  await page.getByRole('button', { name: 'Test live chatbot', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Please log in again.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('lite mode test toggle shows the notice, marks requests, and restores normal routing', async ({ page }) => {
  await prepare(page);
  const requests = [];
  await page.route('**/api/chat', route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    return route.fulfill({ json: body.liteMode
      ? { reply: 'Sorry, we are unable to answer that right now. Please try again later.', aiGenerated: false, liteMode: true, liteModeReason: 'test' }
      : { reply: 'A normal test response.', aiGenerated: true, liteMode: false } });
  });
  await page.getByRole('button', { name: 'Test live chatbot', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Test live chatbot' });
  const toggle = dialog.getByRole('checkbox', { name: 'Enable lite mode for this test (saved responses only)' });
  await toggle.check();
  await expect(dialog.locator('.chat-lite-badge')).toHaveText('Lite mode');
  await expect(dialog.getByText('Only saved answers are available right now. Some questions may not be answered. Please try again later.')).toBeVisible();
  await dialog.getByRole('textbox').fill('An unmatched question');
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(dialog.getByText('Sorry, we are unable to answer that right now. Please try again later.', { exact: true })).toBeVisible();
  await expect(dialog.locator('.message-ai-badge')).toHaveCount(0);
  const layout = await dialog.evaluate(element => {
    const messages = element.querySelector('.chat-messages');
    const items = [...messages.children].map(child => child.getBoundingClientRect()).filter(rect => rect.height > 0);
    return {
      messageHeight: messages.clientHeight,
      overlapping: items.some((rect, index) => index > 0 && rect.top < items[index - 1].bottom - 1),
      controlsInsideChat: Boolean(element.querySelector('.chat-widget .live-chat-test-simulation')),
      horizontalOverflow: element.scrollWidth > element.clientWidth,
    };
  });
  expect(layout.overlapping).toBe(false);
  expect(layout.messageHeight).toBeGreaterThan(240);
  expect(layout.controlsInsideChat).toBe(false);
  expect(layout.horizontalOverflow).toBe(false);
  await page.screenshot({ path: `/tmp/live-chat-lite-layout-${page.viewportSize().width}.png` });
  await dialog.getByRole('button', { name: 'Open chat options', exact: true }).click();
  await dialog.getByRole('menuitemcheckbox', { name: 'Dark Mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: `/tmp/live-chat-lite-layout-dark-${page.viewportSize().width}.png` });
  expect(requests[0].liteMode).toBe(true);
  await toggle.uncheck();
  await expect(dialog.locator('.chat-lite-badge')).toHaveCount(0);
  await dialog.getByRole('textbox').fill('A normal question');
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(dialog.getByText('A normal test response.', { exact: true })).toBeVisible();
  expect(requests[1].liteMode).toBe(false);
});

test('automatic lite mode appears on open, survives the test toggle, and clears after recovery', async ({ page }) => {
  await prepare(page);
  await page.clock.install();
  let enabled = true;
  await page.route('**/api/chat/mode', route => route.fulfill({ json: { liteMode: enabled, reason: enabled ? 'high_traffic' : null } }));
  await page.getByRole('button', { name: 'Test live chatbot', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Test live chatbot' });
  await expect(dialog.locator('.chat-lite-badge')).toBeVisible();
  const toggle = dialog.getByRole('checkbox', { name: 'Enable lite mode for this test (saved responses only)' });
  await toggle.check();
  await toggle.uncheck();
  await expect(dialog.locator('.chat-lite-badge')).toBeVisible();
  enabled = false;
  await page.clock.fastForward(30_001);
  await expect(dialog.locator('.chat-lite-badge')).toHaveCount(0);
});
