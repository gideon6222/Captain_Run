/* Unit-test harness.

   Node cannot import TypeScript, so this bundles test/pure-entry.ts with
   esbuild and imports the result. The tests then run against the real shipping
   modules, through the real import graph - not a copy, and not a slice of a
   file parsed by hand.

   The alternative, evaluating a section of the source with `new Function`,
   works right up until the first type annotation turns the whole suite into a
   SyntaxError. It is not worth the twenty lines it saves. */

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..');

let cached = null;

/* Async because bundling is. Test files use top-level await, which node's ESM
   test runner supports. */
export async function loadPure() {
  if (cached) return cached;
  const outfile = join(mkdtempSync(join(tmpdir(), 'captainrun-pure-')), 'pure.mjs');
  await build({
    entryPoints: [join(HERE, 'pure-entry.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile,
    logLevel: 'silent'
  });
  cached = await import(pathToFileURL(outfile).href);
  /* A bundle that silently exports nothing would make every assertion below
     pass against undefined. Fail loudly here instead. */
  if (typeof cached.hash !== 'function') throw new Error('harness: hash missing from the bundle');
  if (typeof cached.T !== 'object') throw new Error('harness: tuning table missing from the bundle');
  return cached;
}
