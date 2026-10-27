const { test, expect } = require('@playwright/test');

for (const locale of [
  { code: 'es', accept: 'Entiendo y acepto', send: 'Enviar mensaje', question: '¿Cómo puedo abrir una empresa?', reply: 'Puede preparar un plan.' },
  { code: 'fr', accept: 'Je comprends et j’accepte', send: 'Envoyer le message', question: 'Comment créer une entreprise ?', reply: 'Vous pouvez préparer un plan.' },
]) test(`widget translates UI and sends ${locale.code} with chat requests`, async ({ page }) => {
  const requests = [];
  await page.route('**/api/**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/api/chat')) {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { reply: locale.reply, aiGenerated: true, conversationId: 'language-browser' } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('./');
  await page.locator('.chat-bubble').click();
  await page.locator('.disclaimer-language select').selectOption(locale.code);
  await page.getByRole('button', { name: locale.accept, exact: true }).click();
  await page.getByRole('textbox').fill(locale.question);
  await page.getByRole('button', { name: locale.send, exact: true }).click();
  await expect(page.getByText(locale.reply, { exact: true })).toBeVisible();
  await expect(page.locator('.widget-shell')).toHaveAttribute('lang', locale.code);
  expect(await page.evaluate(() => localStorage.getItem('chatbot_language'))).toBe(locale.code);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ language: locale.code, message: locale.question, stream: true });
});


test('French preference survives reload and can switch back to English in chat options', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('chatbot_theme', 'dark');
    if (!localStorage.getItem('chatbot_language')) localStorage.setItem('chatbot_language', 'fr');
  });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.goto('./');
  await page.locator('.chat-bubble').click();
  await expect(page.locator('.disclaimer-language select')).toHaveValue('fr');
  await page.getByRole('button', { name: 'Je comprends et j’accepte', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir les options de discussion', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Langue', exact: true })).toHaveValue('fr');
  await page.reload();
  await expect(page.locator('.widget-shell')).toHaveAttribute('lang', 'fr');
  if (await page.locator('.chat-bubble').isVisible()) await page.locator('.chat-bubble').click();
  const accept = page.getByRole('button', { name: 'Je comprends et j’accepte', exact: true });
  if (await accept.isVisible()) await accept.click();
  await page.getByRole('button', { name: 'Ouvrir les options de discussion', exact: true }).click();
  await page.getByRole('combobox', { name: 'Langue', exact: true }).selectOption('en');
  await expect(page.locator('.widget-shell')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
});


test('language dropdown text and options have readable contrast in both themes', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.goto('./');
  await page.locator('.chat-bubble').click();
  async function checkContrast(select, theme) {
    await expect(select).toHaveCSS('color-scheme', theme);
    const ratios = await select.evaluate((element) => {
      const luminance = (color) => {
        const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      return [element, ...element.options].map((control) => {
        const style = getComputedStyle(control);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
    });
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
  // Check each control with both themes, including a live theme change.
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    await checkContrast(page.locator('.disclaimer-language select'), theme);
  }
  await page.getByRole('button', { name: 'I Understand & Agree', exact: true }).click();
  await page.getByRole('button', { name: 'Open chat options', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    await checkContrast(page.getByRole('combobox', { name: 'Language', exact: true }), theme);
  }
});
