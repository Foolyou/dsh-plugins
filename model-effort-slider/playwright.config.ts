import { defineConfig } from '@playwright/test';
process.env.NO_PROXY = 'localhost,127.0.0.1';
process.env.no_proxy = 'localhost,127.0.0.1';
export default defineConfig({
  testDir: './tests', testMatch: '*.spec.ts',
  // One fixture server owns one host storage root, so specs must not run in parallel:
  // a reset in one worker would clear portraits another worker is asserting on.
  fullyParallel: false, workers: 1,
  // Every run starts from an empty host store.
  globalSetup: './tests/reset.ts',
  use: { baseURL: 'http://127.0.0.1:15082', launchOptions: { executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', args: ['--no-sandbox'] } },
});
