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
    baseURL: 'http://localhost:4179',
    /* portrait phone, which is the only shape this game is played in */
    viewport: { width: 390, height: 844 },
    trace: 'off'
  },
  /* The viewport goes AFTER the device spread, and that ordering is the whole
     point.

     `use: { ...devices['Desktop Chrome'] }` carries its own 1280x720 viewport,
     and a project's `use` overrides the top-level one - so the portrait size
     set above was silently discarded and every smoke test ran landscape on a
     desktop-shaped window. For this game that is not cosmetic: the camera
     solves its field of view from the aspect ratio, so the tests were framing
     a picture the phone never renders, and a drag measured as a fraction of
     window width meant something different in the test than in the hand.

     Caught by a control-direction test whose two drags cancelled out to
     exactly zero - arithmetic that only works at 1280 wide. */
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false },
  }],
  webServer: {
    /* Port 4179, not vite's default 4173, and that is not arbitrary.

       Several games are built on this machine at once, in separate repos and
       separate Claude sessions, and every one of them copies its stack from the
       last - so every one of them inherited `vite preview` on 4173. Two suites
       running at the same time then fight over one port, and the failures do
       not look like a port conflict: this suite produced a stretch of
       ERR_CONNECTION_REFUSED mid-run when the other project's server went away,
       and, with `reuseExistingServer: true` briefly set, *silently ran Wick's
       tests against Coreward* and reported that the debug seam did not exist.

       Give every game its own fixed port. It costs one number. */
    command: 'npm run build && npx vite preview --port 4179 --strictPort',
    url: 'http://localhost:4179',
    /* Never reuse a running server, even locally.

       `reuseExistingServer: !process.env.CI` was tried and is a trap here: it
       skips the build and attaches to whatever already answers on the port,
       which on a machine running two games at once meant answering "the debug
       seam is missing" about a game that was never loaded. A suite whose whole
       purpose is to test this build must never be allowed to test another one.

       If a leftover preview from an interrupted run blocks the port:
         Get-NetTCPConnection -LocalPort 4179 -State Listen |
           ForEach-Object { Stop-Process -Id $_.OwningProcess -Force } */
    reuseExistingServer: false,
    timeout: 180_000
  }
});
