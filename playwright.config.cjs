const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5186/chatbot/',
    browserName: 'chromium',
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {
      launchOptions: {
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        args: ['--no-zygote'],
      },
    } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: 'npm run dev --prefix client -- --host 127.0.0.1 --port 5186 --strictPort',
    url: 'http://127.0.0.1:5186/chatbot/',
    reuseExistingServer: false,
    env: {
      VITE_API_BASE_URL: 'http://127.0.0.1:5186/chatbot',
      VITE_EMBEDDED: 'false',
      VITE_CHAT_REQUEST_TIMEOUT_MS: '90000',
    },
  },
});
