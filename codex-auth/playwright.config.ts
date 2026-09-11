import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: '*.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:15083', launchOptions: { executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', args: ['--no-sandbox'] } } });
