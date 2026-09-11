import { defineConfig } from '@playwright/test';
process.env.NO_PROXY = 'localhost,127.0.0.1';
process.env.no_proxy = 'localhost,127.0.0.1';
export default defineConfig({ testDir: './tests', testMatch: '*.spec.ts', use: { baseURL: 'http://127.0.0.1:15082', launchOptions: { executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', args: ['--no-sandbox'] } } });
