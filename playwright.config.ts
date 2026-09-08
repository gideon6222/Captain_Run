import { defineConfig, devices } from '@playwright/test';

/* Smoke tests run against the PRODUCTION build, not the dev server.

   The whole point is to catch wiring bugs - a broken import, a missing DOM id,
   a boot-order regression - and those only show up in the real bundle. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    /* portrait phone, which is the only shape this game is played in */
    viewport: { width: 390, height: 844 },
    trace: 'off'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000
  }
});
