import { defineConfig, devices } from '@playwright/test';

/* Smoke tests run against the PRODUCTION build, not the dev server.

   The whole point is to catch wiring bugs - a broken import, a missing DOM id,
   a boot-order regression - and those only show up in the real bundle. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  /* list for the terminal, html for the artifact CI uploads on failure */
  reporter: [['list'], ['html', { open: 'never' }]],
  /* Playwright's 30s default is measured on a developer machine. These tests
     drive thousands of simulated ticks through a software rasteriser, and a
     two-core CI runner is several times slower - a timeout there says nothing
     about the game. Long enough to absorb that, short enough that a genuine
     hang still ends the run. */
  timeout: 90_000,
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
