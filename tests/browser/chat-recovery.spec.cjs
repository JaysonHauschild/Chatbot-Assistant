const { test, expect } = require('@playwright/test');

const serviceNotice = 'The assistant is temporarily unavailable. Please try again.';
const answer = 'Start with customer interviews and compare the needs you hear most often.';
const question = 'How can I learn what my customers need?';
const success = { reply: answer, aiGenerated: true, conversationId: 'recovery-browser' };
const degraded = { reply: serviceNotice, aiGenerated: false, retryable: true, conversationId: 'recovery-browser' };
const ndjson = (events) => ({
  contentType: 'application/x-ndjson',
  body: events.map(event => JSON.stringify(event)).join('\n') + '\n',
});

async function openChat(page) {
  // Mock every API call, including feedback and reset, to keep this suite local.
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.goto('./');
  await page.locator('.chat-bubble').click();
  await page.getByRole('button', { name: 'I Understand & Agree', exact: true }).click();
}

async function send(page, message = question) {
  await page.getByRole('textbox').fill(message);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}

const retryButton = page => page.getByRole('button', { name: 'Retry last message', exact: true });

test('retry replaces the failed answer, preserves the draft and resends the original context once', async ({ page }) => {
  await openChat(page);
  const requests = [];
  await page.route('**/api/chat', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: requests.length === 2 ? degraded : success });
  });
  await send(page, 'An earlier question');
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  await send(page);
  const retry = retryButton(page);
  await expect(retry).toBeVisible();
  // The action belongs to the last assistant response, below its message bubble.
  await expect(page.locator('.assistant-message-stack').last().getByRole('button', { name: 'Retry last message' })).toBeVisible();
  const messageBox = await page.locator('.message-assistant').last().boundingBox();
  const buttonBox = await retry.boundingBox();
  expect(buttonBox.y).toBeGreaterThanOrEqual(messageBox.y + messageBox.height);
  await page.getByRole('textbox').fill('Keep this unsent draft');
  await retry.click();
  await expect(page.getByText(serviceNotice, { exact: true })).toHaveCount(0);
  await expect(page.locator('.message-ai-badge')).toHaveCount(2);
  await expect(retry).toHaveCount(0);
  await expect(page.locator('.message-user')).toHaveCount(2);
  await expect(page.getByRole('textbox')).toHaveValue('Keep this unsent draft');
  expect(requests).toHaveLength(3);
  expect(requests[2]).toEqual(requests[1]);
  expect(requests[2].history).toEqual([
    { role: 'user', content: 'An earlier question' }, { role: 'assistant', content: answer },
  ]);
});

for (const failure of ['streamed error', 'truncated stream', 'network', 'HTTP 429', 'HTTP 503', 'empty response']) {
  test(`${failure} exposes retry and recovers on the next click`, async ({ page }) => {
    await openChat(page);
    let attempts = 0;
    await page.route('**/api/chat', route => {
      if (++attempts > 1) return route.fulfill({ json: success });
      if (failure === 'network') return route.abort('failed');
      if (failure.startsWith('HTTP')) return route.fulfill({ status: Number(failure.slice(5)), json: { error: serviceNotice } });
      if (failure === 'empty response') return route.fulfill({ json: { reply: '', aiGenerated: true } });
      return route.fulfill(ndjson(failure === 'truncated stream'
        ? [{ type: 'chunk', text: 'An unfinished answer' }]
        : [{ type: 'chunk', text: 'An unfinished answer' }, { type: 'final', ...degraded }]));
    });
    await send(page);
    await expect(retryButton(page)).toBeVisible();
    await retryButton(page).click();
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await expect(retryButton(page)).toHaveCount(0);
    await expect(page.locator('.message-user')).toHaveCount(1);
    expect(attempts).toBe(2);
  });
}

test('automatic stream fallback clears the partial primary answer without asking for retry', async ({ page }) => {
  await openChat(page);
  let attempts = 0;
  await page.route('**/api/chat', route => {
    attempts++;
    return route.fulfill(ndjson([
      { type: 'chunk', text: 'Discard the partial primary answer' },
      { type: 'reset' }, { type: 'chunk', text: answer }, { type: 'final', ...success },
    ]));
  });
  await send(page);
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  await expect(page.getByText('Discard the partial primary answer', { exact: true })).toHaveCount(0);
  await expect(retryButton(page)).toHaveCount(0);
  await expect(page.locator('.message-ai-badge')).toHaveCount(1);
  expect(attempts).toBe(1);
});

test('repeated failures keep one question; sending a new question hides retry and omits failed history', async ({ page }) => {
  await openChat(page);
  const requests = [];
  await page.route('**/api/chat', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: requests.length <= 2 ? degraded : success });
  });
  await send(page);
  await retryButton(page).click();
  await expect(retryButton(page)).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.locator('.message-user')).toHaveCount(1);
  await expect(page.getByText(serviceNotice, { exact: true })).toHaveCount(1);
  await send(page, 'A different question');
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  await expect(retryButton(page)).toHaveCount(0);
  expect(requests[2].history).toEqual([]);
});

test('retry is unavailable while a request is pending and duplicate activation sends only once', async ({ page }) => {
  await openChat(page);
  let attempts = 0;
  let completeRetry;
  const retryPending = new Promise(resolve => { completeRetry = resolve; });
  await page.route('**/api/chat', async route => {
    attempts++;
    if (attempts === 1) return route.fulfill({ json: degraded });
    await retryPending;
    return route.fulfill({ json: success });
  });
  await send(page);
  await expect(retryButton(page)).toBeVisible();
  try {
    await retryButton(page).evaluate(button => { button.click(); button.click(); });
    await expect.poll(() => attempts).toBe(2);
    await expect(retryButton(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  } finally {
    completeRetry();
  }
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test('browser timeout offers retry without waiting ninety real seconds', async ({ page }) => {
  await openChat(page);
  await page.clock.install();
  let received = false;
  let finishRequest;
  const pending = new Promise(resolve => { finishRequest = resolve; });
  await page.route('**/api/chat', async route => {
    received = true;
    await pending;
    await route.fulfill({ json: success }).catch(() => {});
  });
  try {
    await send(page);
    await expect.poll(() => received).toBe(true);
    await page.clock.fastForward(90_001);
    await expect(retryButton(page)).toBeVisible();
    await expect(page.locator('.message-assistant').last()).toContainText('took too long');
  } finally {
    finishRequest();
  }
});

test('successful predefined replies, policy errors and expired conversations do not offer retry', async ({ page }) => {
  await openChat(page);
  const replies = [
    { json: { reply: 'Hello from OKSBDC.', aiGenerated: false } },
    { status: 403, json: { error: 'Access is temporarily blocked.' } },
    { json: { reply: 'Conversation expired.', conversationExpired: true, aiGenerated: false } },
  ];
  await page.route('**/api/chat', route => route.fulfill(replies.shift()));
  await send(page, 'Hello');
  await expect(page.getByText('Hello from OKSBDC.', { exact: true })).toBeVisible();
  await expect(retryButton(page)).toHaveCount(0);
  await send(page, 'Blocked question');
  await expect(page.getByText('Access is temporarily blocked.', { exact: true })).toBeVisible();
  await expect(retryButton(page)).toHaveCount(0);
  await send(page, 'Expired question');
  await expect(page.locator('.conversation-expired-card')).toBeVisible();
  await expect(retryButton(page)).toHaveCount(0);
});

test('retry translates into Spanish and reset removes the failed turn', async ({ page }) => {
  await openChat(page);
  await page.route('**/api/chat', route => route.fulfill({ json: degraded }));
  await send(page);
  await expect(retryButton(page)).toBeVisible();
  await page.getByRole('button', { name: 'Open chat options', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Español' }).click();
  await expect(page.getByRole('button', { name: 'Reintentar el último mensaje', exact: true })).toHaveText('Reintentar');
  await page.getByRole('menuitem', { name: 'Reiniciar chat' }).click();
  await expect(page.locator('.message-retry')).toHaveCount(0);
  await expect(page.locator('.message-user')).toHaveCount(0);
});
