import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/* Build stamp, shown in the camp screen.

   An installed PWA can be a load behind after a deploy, and the game is meant
   to look identical between builds, so there is otherwise nothing to look at
   on the phone to tell whether an update actually landed. */
function buildSha() {
  /* CI checks out a detached head; GITHUB_SHA is the authoritative commit */
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    const sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    /* mark local builds with uncommitted changes, so a stamp on the phone is
       never mistaken for a commit that actually exists */
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().length > 0;
    return dirty ? sha + '+' : sha;
  } catch (e) {
    return 'unknown';
  }
}

export default defineConfig({
  /* GitHub Pages serves this from /Captain_Run/, not the domain root, so every
     emitted URL must be relative. The manifest and icon already use './'. */
  base: './',

  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },

  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        /* Split three.js out of the game code. Two reasons, and the second
           matters more.

           1. three.js is ~490 kB and changes only when the pinned version
              does, while game code changes constantly. Keeping them apart
              means a gameplay tweak invalidates ~30 kB on mobile data instead
              of ~520 kB.

           2. It is what makes the bundle size guard able to see anything. In
              one combined chunk, a whole subsystem going missing is a couple
              of per cent - inside any sane tolerance. As its own chunk the
              game code is small enough that losing something is unmissable. */
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        }
      }
    }
  },

  plugins: [
    VitePWA({
      /* Workbox generates the precache manifest from the real build output,
         hashed filenames and all. This retires the hand-written sw.js and the
         "bump CACHE or your change looks like it did nothing" trap that came
         with it: a changed file changes its hash, so it is a new precache
         entry and there is nothing left to remember. */
      strategies: 'generateSW',
      registerType: 'autoUpdate',

      workbox: {
        /* the old sw.js called skipWaiting() and clients.claim(); these keep
           that exact behaviour */
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        /* cleanupOutdatedCaches only removes Workbox's own caches. The
           pre-migration worker used a hand-rolled cache named captainrun-v1,
           which Workbox cannot see; this deletes it on activate. */
        importScripts: ['sw-legacy-cleanup.js'],
        globPatterns: ['**/*.{js,css,html,svg,webmanifest,woff2}'],
        /* the sourcemap is large and only devtools ever asks for it */
        globIgnores: ['**/*.map'],
        navigateFallback: 'index.html'
      },

      /* Keep public/manifest.webmanifest exactly as it is. The PWA already
         installed on the phone is keyed to its start_url and scope, so
         regenerating it risks the installed app rather than improving it. */
      manifest: false,

      /* index.html registers the worker by hand, and that registration
         resolves to the same sw.js this plugin emits. */
      injectRegister: null,

      devOptions: {
        /* no service worker during `vite dev`; a cache-first worker on
           localhost serves stale modules and wastes an afternoon */
        enabled: false
      }
    })
  ]
});
