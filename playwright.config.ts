import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (process.platform === 'win32' && existsSync(windowsChrome) ? windowsChrome : undefined);
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 25000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1280, height: 900 },
    launchOptions: { executablePath, args: ['--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
