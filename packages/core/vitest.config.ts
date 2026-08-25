import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  /**
   * `ol-ppxj.11` [HOST-1]: same measured host defect as `ol-63et` (a stat
   * immediately following a write on this virtiofs mount, /workspace, can
   * spuriously report ENOENT for the entry that write just created — wrangler's
   * mkdtemp/lstat and this package's own `fs.cp` race in `build.mjs` are the
   * other two measured instances). Vite's dependency cache lives under
   * `node_modules/.vite` by default; moving it under `os.tmpdir()` takes it off
   * that mount. This is a location change only — same cache, same contents,
   * same behavior on a healthy host and on CI (whose tmpdir is ephemeral
   * either way).
   *
   * WHAT THIS DOES NOT FIX, and why not. The config-transform temp file
   * (`.vite-temp/vitest.config.ts.timestamp-*.mjs`, written by vite's default
   * `bundle` configLoader and immediately dynamically `import()`-ed — the
   * exact write-then-resolve race, measured here as `ERR_MODULE_NOT_FOUND`) is
   * NOT reachable from this file: vite computes its path
   * (`findNearestNodeModules(dirname(configFile)) + '/.vite-temp'`) and writes
   * to it in order to load THIS FILE — before any code in it, including this
   * `cacheDir`, has had a chance to run. There is no config-file knob for it.
   * The only real fix is `vitest run --configLoader=runner` (verified: 0
   * failures in 12 concurrent runs here, vs. a repeatable ~40% failure rate on
   * the default `bundle` loader under the same load) — but that is a
   * `package.json` test-script change, outside this bead's file ownership.
   * Filed as follow-up: `ol-ppxj.13` [HOST-3].
   *
   * RESIDUAL RISK, until that follow-up lands: the only mitigation reachable
   * from here is host-local and does not travel — `node_modules/.vite-temp`
   * replaced with a symlink to a directory under `os.tmpdir()`, the same shape
   * as `ol-63et`'s `.wrangler/tmp` fix. Gitignored, so a fresh clone or a
   * `node_modules` wipe has the defect again until the symlink (or the
   * `--configLoader` follow-up) is redone.
   */
  cacheDir: join(tmpdir(), 'olea-vitest-cache', basename(here)),
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'test/fixtures/**'],
    /**
     * `ol-hrmw`: raised from vitest's 5000ms default, deliberately and with the
     * measurement behind it, because the default was taking the whole `pnpm -r`
     * gate down.
     *
     * WHAT WENT WRONG. Two `src/concept/evidence.spec.ts` tests timed out at
     * 5000ms on a machine running three build lanes; the same tests pass in
     * isolation and passed on a re-run of the same tree. Because `pnpm -r`
     * stops at the first failing package, `contracts`, `plugin`, `workbench`
     * and `synthetic` then never ran at all — a load-sensitive flake that
     * reports as a total gate failure and is indistinguishable at a glance
     * from a real regression. Two lanes have now had to tell those apart by
     * hand.
     *
     * WHY A TIMEOUT AND NOT A PERFORMANCE FIX. The cost was measured before it
     * was accommodated, because "slow test" and "accidentally quadratic" want
     * opposite responses:
     *
     *   - Vault size: an 8x copy of the fixture vault (52 -> 409 files, zettel
     *     vocabulary 12 -> 96) costs ~4.4-5x, not ~64x. Linear, not quadratic.
     *   - Vocabulary size: `extractTier3Evidence`'s matcher compiles one
     *     RegExp per vocabulary term per text unit, which is the one plausible
     *     O(n^2) shape in this pass. Sweeping the vocabulary 12 -> 12,000 terms
     *     at fixed vault size costs ~1.4x end to end, so that term is nowhere
     *     near dominant and the pass is I/O- and parse-bound as written.
     *   - Absolute cost: each test re-runs the whole tier-3 sweep over the
     *     whole fixture vault from scratch (list, read and parse ~50 files,
     *     plus PDF extraction of the embedded deck). Warm, that is ~180-450ms
     *     per test; on a cold FS cache the same file measured ~1.4-2.7s per
     *     test. 5000ms is not a budget anybody chose for that — it is the
     *     default — and it leaves under 2x headroom cold and none at all when
     *     several lanes contend. The failing run reported "import 160.67s",
     *     i.e. an oversubscription factor no per-test budget survives.
     *
     * So the work is real, and it belongs to 22 spec files in this package
     * that sweep the fixture vault, not to these two. That is why the number
     * is here rather than on the two tests: a per-test literal would be a fix
     * for the two that happened to lose first. `src/concept/extract.spec.ts`
     * already carries the same reasoning inline at 20_000 for its own
     * double-sweep test; this is that judgement applied package-wide.
     *
     * COST OF THE RAISE, stated rather than hidden: a genuinely hung test now
     * takes 30s to surface instead of 5s. The whole package's suite runs in
     * well under that, so a hang is still obvious.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
