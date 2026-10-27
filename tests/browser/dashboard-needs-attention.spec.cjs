const { test, expect } = require('@playwright/test');

test('Needs attention opens focused reviews and removes the selected filtered feedback item', async ({ page }) => {
  const hidden = [];
  const feedback = [
    { feedback: 'up', scope: 'response', assistant_reply: 'Helpful answer', dashboard_key: 'positive' },
    { feedback: 'down', scope: 'response', assistant_reply: 'Answer needing review', dashboard_key: 'negative' },
    { feedback: 'sad', scope: 'session', comment: 'Disappointed visitor', dashboard_key: 'sad' },
  ];
  await page.addInitScript(() => sessionStorage.setItem('dashboard_token', 'test-dashboard-token'));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/hide-entry')) {
      hidden.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith('/feedback-summary')) return route.fulfill({ json: {
      feedbackDetails: feedback, unsureMessages: [{ user_message: 'Unanswered question', assistant_reply: 'Unsure reply' }],
    } });
    if (path.endsWith('/blocked-responses')) return route.fulfill({ json: { items: [
      { conversationId: 'pending', turn: 1, userMessage: 'Pending blocked message', reviewStatus: '' },
      { conversationId: 'mistake', turn: 1, userMessage: 'Mistaken block', reviewStatus: 'false_positive' },
      { conversationId: 'correct', turn: 1, userMessage: 'Confirmed correct block', reviewStatus: 'correct_block' },
    ] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('./dashboard');
  await page.getByRole('button', { name: 'Needs attention', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Management', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /Response review/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toBeFocused();
  const review = page.locator('#management-panel-review');
  await expect(review.getByText('Answer needing review')).toBeVisible();
  await expect(review.getByText('Disappointed visitor')).toBeVisible();
  await expect(review.getByText('Unsure reply')).toBeVisible();
  await expect(review.getByText('Pending blocked message')).toBeVisible();
  await expect(review.getByText('Mistaken block')).toBeVisible();
  await expect(review.getByText('Helpful answer')).toHaveCount(0);
  await expect(review.getByText('Confirmed correct block')).toHaveCount(0);

  await review.locator('article').filter({ hasText: 'Answer needing review' })
    .getByRole('button', { name: 'Remove from list', exact: true }).click();
  await expect.poll(() => hidden.length).toBe(1);
  expect(hidden[0].target_key).toBe('negative');
  await expect(review.getByText('Answer needing review')).toHaveCount(0);
  await review.getByRole('button', { name: 'Show all reviews', exact: true }).click();
  await expect(review.getByText('Helpful answer')).toBeVisible();
  await expect(review.getByText('Confirmed correct block')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
