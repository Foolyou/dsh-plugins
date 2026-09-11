import { defineConfig } from '@playwright/test';
process.env.NO_PROXY = 'localhost,127.0.0.1';
process.env.no_proxy = 'localhost,127.0.0.1';
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:15081', launchOptions: { executablePath:process.env.CHROME_PATH ?? '/opt/google/chrome/chrome', args:['--no-sandbox'] } },
  webServer: { command:'python3 -m http.server 15081', url:'http://localhost:15081/react.html', reuseExistingServer:true },
});
