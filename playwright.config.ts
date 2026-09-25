import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Cloud dev containers ship a pinned Chromium; CI installs Playwright's own.
const localChromium = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const executablePath = !process.env.CI && existsSync(localChromium) ? localChromium : undefined;

const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}/`,
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: 'phone-landscape',
      use: {
        ...devices['Pixel 7 landscape'],
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
