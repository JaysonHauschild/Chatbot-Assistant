const { test, expect } = require('@playwright/test');

const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"sub":"self","role":"admin"}').toString('base64url')}.test`;
const baseline = 'Give helpful Oklahoma business guidance.';

async function prepare(page) {
  let failPromptSave = true;
  const review = { status: 'to_review', version: 0, updates: [] };
  const histories = ['one', 'two'].map((id) => ({ conversationId: id, preview: `Question ${id}`, messageCount: 1,
    responseCount: 1, feedbackCount: 0, review, events: [{ id, kind: 'user', turn: 1, content: `Question ${id}` }] }));
  await page.addInitScript((value) => sessionStorage.setItem('dashboard_token', value), token);
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/system-prompt')) {
      if (request.method() === 'PUT') {
        if (failPromptSave) { failPromptSave = false; return route.fulfill({ status: 500, json: { error: 'Save failed.' } }); }
        return route.fulfill({ json: { systemPrompt: request.postDataJSON().systemPrompt } });
      }
      return route.fulfill({ json: { systemPrompt: baseline } });
    }
    if (path.endsWith('/message-filter/rules')) return route.fulfill({ json: { items: [
      { id: 'loan_help', regexPattern: 'loan', pattern: '/loan/i', reply: 'Talk to an advisor.', action: 'respond' },
    ], totalRules: 1 } });
    if (path.endsWith('/users') && request.method() === 'POST') return route.fulfill({ json: {
      user: { id: 'new', username: request.postDataJSON().username, role: request.postDataJSON().role }, temporaryPassword: 'temporary-password',
    } });
    if (path.endsWith('/users')) return route.fulfill({ json: { currentUserId: 'self', users: [
      { id: 'self', username: 'admin', role: 'admin', active: true }, { id: 'staff', username: 'staff', role: 'readonly', active: true },
    ] } });
    if (path.endsWith('/conversations/review')) return route.fulfill({ json: { review: {
      ...review, status: request.postDataJSON().status, version: 1,
    } } });
    if (path.endsWith('/conversations')) {
      const id = new URL(request.url()).searchParams.get('conversationId');
      return route.fulfill({ json: id ? histories.find((history) => history.conversationId === id)
        : { conversations: histories, total: 2, limit: 25 } });
    }
    if (path.endsWith('/audit-log')) return route.fulfill({ json: { items: [], total: 0 } });
    return route.fulfill({ json: {} });
  });
  await page.goto('./dashboard');
}

async function open(page, section, subtab) {
  await page.getByRole('tab', { name: section, exact: true }).click();
  if (subtab) await page.locator('.dashboard-sidebar').getByRole('link', { name: subtab, exact: true }).click();
}

async function answerWarning(page, action, accept = false) {
  const handled = new Promise((resolve) => page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('unsaved changes');
    if (accept) await dialog.accept(); else await dialog.dismiss();
    resolve();
  }));
  await action();
  await handled;
}

async function unloadBlocked(page) {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

test('instructions track changes, guard navigation and logout, and clear only after a successful save', async ({ page }) => {
  test.setTimeout(60000);
  await prepare(page);
  await open(page, 'Management', 'Chatbot instructions');
  const form = page.locator('#management-panel-prompt form').first();
  const input = page.getByRole('textbox', { name: 'Chatbot instructions', exact: true });
  await expect(input).toHaveValue(baseline);
  expect(await unloadBlocked(page)).toBe(false);
  await input.fill(`${baseline} Ask for missing details.`);
  await expect(form.getByText('Unsaved changes', { exact: true })).toBeVisible();
  expect(await unloadBlocked(page)).toBe(true);
  await answerWarning(page, () => page.getByRole('tab', { name: 'Conversations', exact: true }).click());
  await expect(input).toBeVisible();
  await answerWarning(page, () => page.getByRole('tab', { name: /Message rules/ }).click());
  await expect(page.locator('#management-panel-prompt')).toBeVisible();
  await page.getByRole('tab', { name: /Chatbot instructions/ }).focus();
  await answerWarning(page, () => page.keyboard.press('ArrowRight'));
  await expect(page.getByRole('tab', { name: /Chatbot instructions/ })).toBeFocused();
  await answerWarning(page, () => page.getByRole('button', { name: 'Needs attention', exact: true }).click());
  await answerWarning(page, () => page.getByRole('button', { name: 'Log Out', exact: true }).click());
  await page.getByRole('button', { name: 'Save instructions', exact: true }).click();
  await expect(page.getByText('Save failed.', { exact: true })).toBeVisible();
  expect(await unloadBlocked(page)).toBe(true);
  await page.getByRole('button', { name: 'Save instructions', exact: true }).click();
  await expect(form.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  expect(await unloadBlocked(page)).toBe(false);
  await input.fill(baseline);
  expect(await unloadBlocked(page)).toBe(true);
  await input.fill(`${baseline} Ask for missing details.`);
  expect(await unloadBlocked(page)).toBe(false);
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(page.locator('#dashboard-panel-overview')).toBeVisible();
});

test('blank new rules remain clean until actual content is entered', async ({ page }) => {
  test.setTimeout(60000);
  await prepare(page);
  await open(page, 'Management', 'Message rules');
  const editor = page.getByRole('region', { name: 'Add message rule', exact: true });
  const indicator = editor.getByText('Unsaved changes', { exact: true });
  const summary = editor.getByRole('region', { name: 'Rule summary', exact: true });
  await expect(summary).toContainText('No unsaved changes.');
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(page.locator('#dashboard-panel-overview')).toBeVisible();
  await open(page, 'Management', 'Message rules');
  await editor.getByRole('button', { name: 'Advanced matching (regex)', exact: true }).click();
  const pattern = editor.getByLabel('Advanced matching pattern (regex)', { exact: true });
  await pattern.fill('   ');
  await editor.getByLabel('Reply language', { exact: true }).selectOption('es');
  await editor.getByLabel('What should happen?', { exact: true }).selectOption('block');
  await expect(indicator).toHaveCount(0);
  expect(await unloadBlocked(page)).toBe(false);
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(page.locator('#dashboard-panel-overview')).toBeVisible();
  await open(page, 'Management', 'Message rules');
  await pattern.fill('business loan');
  await expect(indicator).toBeVisible();
  await answerWarning(page, () => page.getByRole('tab', { name: 'Overview', exact: true }).click());
  await pattern.fill('');
  await expect(indicator).toHaveCount(0);
  const categories = editor.getByRole('combobox', { name: 'Question categories', exact: true });
  await categories.fill('funding');
  await categories.press('Enter');
  await expect(indicator).toBeVisible();
  expect(await unloadBlocked(page)).toBe(true);
  await editor.getByRole('button', { name: 'Remove funding from Question categories', exact: true }).click();
  await expect(indicator).toHaveCount(0);
  expect(await unloadBlocked(page)).toBe(false);
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(page.locator('#dashboard-panel-overview')).toBeVisible();
});

test('rule drafts warn before cancellation, replacement, and sidebar navigation', async ({ page }) => {
  await prepare(page);
  await open(page, 'Management', 'Message rules');
  const editor = page.getByRole('region', { name: 'Add message rule', exact: true });
  await expect(editor.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await editor.getByLabel('Rule name (unique)', { exact: true }).fill('new_draft');
  const edit = page.locator('.dashboard-rule-sort-item').getByRole('button', { name: 'Edit', exact: true });
  await answerWarning(page, () => edit.click());
  await expect(editor.getByLabel('Rule name (unique)', { exact: true })).toHaveValue('new_draft');
  await answerWarning(page, () => edit.click(), true);
  await expect(editor.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await editor.getByLabel('Reply', { exact: true }).fill('Updated reply.');
  await answerWarning(page, () => editor.getByRole('button', { name: 'Cancel Edit', exact: true }).click());
  await expect(editor.getByLabel('Reply', { exact: true })).toHaveValue('Updated reply.');
  await answerWarning(page, () => page.getByRole('tab', { name: 'Overview', exact: true }).click());
  await answerWarning(page, () => editor.getByRole('button', { name: 'Cancel Edit', exact: true }).click(), true);
  await expect(editor.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  expect(await unloadBlocked(page)).toBe(false);
});

test('review notes survive canceled conversation changes and searches; saving clears the warning', async ({ page }) => {
  await prepare(page);
  await open(page, 'Conversations');
  await page.getByRole('button', { name: /Question one/ }).click();
  const review = page.getByRole('region', { name: 'Review tracking', exact: true });
  const note = review.getByLabel('Add an internal note');
  await note.fill('Follow up with an advisor.');
  await expect(review.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await answerWarning(page, () => page.getByRole('button', { name: /Question two/ }).click());
  await expect(note).toHaveValue('Follow up with an advisor.');
  await answerWarning(page, () => page.getByRole('button', { name: 'Search conversations', exact: true }).click());
  await answerWarning(page, () => page.getByRole('button', { name: 'View archived conversations', exact: true }).click());
  await answerWarning(page, () => page.getByRole('tab', { name: 'Overview', exact: true }).click());
  await review.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(review.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await note.fill('Another note.');
  await answerWarning(page, () => page.getByRole('button', { name: /Question two/ }).click(), true);
  await expect(note).toHaveValue('');
  expect(await unloadBlocked(page)).toBe(false);
});

test('administration protects new accounts and role edits, including hidden drafts on logout', async ({ page }) => {
  await prepare(page);
  await open(page, 'Administration', 'Users & access');
  const username = page.getByLabel('Username', { exact: true });
  await username.fill('new.editor');
  await answerWarning(page, () => page.getByRole('tab', { name: 'Audit log', exact: true }).click());
  await expect(username).toBeVisible();
  await page.getByRole('button', { name: 'Create user', exact: true }).click();
  await expect(username).toHaveValue('');
  expect(await unloadBlocked(page)).toBe(false);
  await page.getByLabel('Role for staff', { exact: true }).selectOption('dashboard');
  await answerWarning(page, () => page.getByRole('tab', { name: 'Audit log', exact: true }).click(), true);
  await expect(page.getByRole('tabpanel', { name: 'Audit log', exact: true })).toBeVisible();
  expect(await unloadBlocked(page)).toBe(true);
  await answerWarning(page, () => page.getByRole('button', { name: 'Log Out', exact: true }).click());
  await page.getByRole('tab', { name: 'Users & access', exact: true }).click();
  await expect(page.getByLabel('Role for staff', { exact: true })).toHaveValue('dashboard');
  await page.getByLabel('Role for staff', { exact: true }).selectOption('readonly');
  expect(await unloadBlocked(page)).toBe(false);
});
