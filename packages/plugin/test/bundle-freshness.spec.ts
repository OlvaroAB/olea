/**
 * ol-wfze, second half: **`main.js` is the one artifact left that a test run can
 * silently consume a stale copy of.**
 *
 * WHAT RUN 10 CLOSED, AND WHAT IT LEFT. Run 10 removed the module-graph half of
 * this hazard by pointing `main`/`types` at `./src/index.ts` for `olea-contracts`,
 * `olea-core` and `olea-synthetic`, so no workspace import resolves through a
 * build directory any more; `workspace-resolution.spec.ts` holds that property
 * down. That fix does not and cannot reach `packages/plugin/main.js`. The esbuild
 * bundle is a genuine second artifact, `bundle-install.spec.ts` loads it *from
 * disk on purpose* — loading the source instead would defeat the entire point of
 * that suite — and ol-wfze's own close note names it as the remaining stale-able
 * artifact, out of scope at the time.
 *
 * THE TWO WAYS IT WENT GREEN WITHOUT CHECKING ANYTHING, both reproduced before
 * this file was written:
 *
 *   1. VACUITY. `bundle-install.spec.ts` was `describe.skipIf(!bundleBuilt)`.
 *      `main.js` is gitignored, so on a clean checkout there was nothing to load
 *      and the whole file silently skipped. Moving `main.js` aside and running
 *      the plugin suite reported `26 passed | 1 skipped`, exit 0 — green. That is
 *      N-013 in its purest form: the ONE check that distinguishes a real plugin
 *      from scaffolding could not fail, so it reported success on every CI run
 *      this workflow ever made. The `skipIf` is gone; that file now fails.
 *
 *   2. STALENESS, which removing the `skipIf` does NOT fix and which is what this
 *      file is for. Renaming `olea-create-card` in `src/commands/ids.ts` and
 *      running the suite WITHOUT rebuilding left `bundle-install.spec.ts` at
 *      `2 passed`. It asserted the command set of yesterday's bundle and called
 *      it today's. Every claim that suite makes — valid CommonJS, extends
 *      `Plugin`, registers both views and all four commands — is a claim about
 *      whatever `main.js` happened to be lying on disk.
 *
 * WHY A FRESHNESS ASSERTION HERE, WHEN IT WAS THE WRONG ANSWER FOR THE MODULE
 * GRAPH. ol-wfze considered and rejected a staleness assertion for `dist/`,
 * correctly: once nothing resolves through `dist/`, editing source without
 * rebuilding is harmless and normal, so the assertion would be a false-alarm
 * generator. The bundle is the opposite case. Editing plugin or core source
 * without rebuilding genuinely does invalidate every assertion
 * `bundle-install.spec.ts` makes, because that suite reads the artifact rather
 * than the source. Here a stale input IS the defect, so naming it is not a false
 * alarm — it is the finding. The remedy is always the same one line, and the
 * failure message says it.
 *
 * WHY MTIME IS ENOUGH. `pnpm -r build` is topologically ordered and writes
 * `main.js` last, so a correct build leaves the bundle at or after every input.
 * A fresh clone has no `main.js` at all and fails the existence check instead,
 * which points at the same remedy. Equal timestamps pass, so a build fast enough
 * to land in the same clock tick as its inputs is not an error.
 *
 * SCOPE. Inputs are the TypeScript that esbuild actually bundles — `src/` of
 * `olea-plugin`, `olea-core` and `olea-contracts` — plus `esbuild.config.mjs`,
 * which decides what goes in. Co-located `*.spec.ts` files are excluded
 * deliberately: they are not reachable from `src/main.ts`, so editing one cannot
 * change the bundle, and counting them would produce exactly the false alarms
 * that get a guard disabled. `styles.css` and `manifest.json` ship alongside
 * `main.js` but are not bundled into it, and no test loads them from disk.
 */

import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_ROOT = resolve(PLUGIN_ROOT, '..');
const REPO_ROOT = resolve(PACKAGES_ROOT, '..');
const BUNDLE = join(PLUGIN_ROOT, 'main.js');

/** Source trees esbuild reaches from `src/main.ts`. Everything here lands in the bundle. */
const INPUT_ROOTS = [
  join(PLUGIN_ROOT, 'src'),
  join(PACKAGES_ROOT, 'core', 'src'),
  join(PACKAGES_ROOT, 'contracts', 'src'),
];

/** Not a source tree, but it decides the bundle's contents, so a change to it goes stale too. */
const INPUT_FILES = [join(PLUGIN_ROOT, 'esbuild.config.mjs')];

const BUNDLED_EXTENSIONS = ['.ts', '.mts', '.mjs', '.js'];

/** The one line that fixes every failure in this file. */
const REMEDY = 'run `pnpm run build` from the repo root, then re-run the tests';

interface Input {
  readonly path: string;
  readonly mtimeMs: number;
}

function isBundledSource(name: string): boolean {
  // Tests are co-located with source in `packages/core/src`, and they are not
  // reachable from `src/main.ts`. Treating them as bundle inputs would mean
  // every core test edit demanded a plugin rebuild — a false alarm, and false
  // alarms are how a guard gets commented out.
  if (name.endsWith('.spec.ts') || name.endsWith('.test.ts')) return false;
  if (name.endsWith('.d.ts')) return false;
  return BUNDLED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function walk(dir: string, out: Input[]): Input[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, out);
    } else if (entry.isFile() && isBundledSource(entry.name)) {
      out.push({ path: full, mtimeMs: statSync(full).mtimeMs });
    }
  }
  return out;
}

function bundleInputs(): Input[] {
  const found: Input[] = [];
  for (const root of INPUT_ROOTS) walk(root, found);
  for (const file of INPUT_FILES) found.push({ path: file, mtimeMs: statSync(file).mtimeMs });
  return found;
}

/**
 * The comparator, extracted so its FAILING branch can be exercised on every run.
 * A guard whose failure path is never executed is the defect it guards against.
 */
function staleInputs(bundleMtimeMs: number, inputs: readonly Input[]): string[] {
  return inputs
    .filter((input) => input.mtimeMs > bundleMtimeMs)
    .map((input) => relative(REPO_ROOT, input.path))
    .sort();
}

function bundleMtimeMs(): number | null {
  try {
    return statSync(BUNDLE).mtimeMs;
  } catch {
    return null;
  }
}

describe('the built bundle cannot be silently stale (ol-wfze)', () => {
  const inputs = bundleInputs();

  it('finds the sources that go into the bundle, so this suite cannot pass by looking at nothing', () => {
    // N-013 guard on the guard, the same shape `workspace-resolution.spec.ts`
    // carries: a mistyped root or an over-eager filter would make the staleness
    // assertion below vacuously true, which is precisely the failure this file
    // exists to prevent. Assert the corpus before asserting anything about it.
    expect(inputs.length).toBeGreaterThan(50);
    const paths = inputs.map((input) => relative(REPO_ROOT, input.path));
    expect(paths).toContain('packages/plugin/src/main.ts');
    expect(paths).toContain('packages/plugin/esbuild.config.mjs');
    // One file from each of the three source trees, so dropping a whole package
    // from INPUT_ROOTS fails here rather than quietly narrowing the guard.
    expect(paths.some((path) => path.startsWith('packages/core/src/'))).toBe(true);
    expect(paths.some((path) => path.startsWith('packages/contracts/src/'))).toBe(true);
    // And the exclusion is real: co-located core specs are not bundle inputs.
    expect(paths.some((path) => path.endsWith('.spec.ts'))).toBe(false);
  });

  it('reports staleness when there is staleness, so a green result means something', () => {
    // The comparator's failing branch, run every time. Against a bundle older
    // than everything, every input must be named. If this ever returns an empty
    // list the assertion below is worthless, and we find out here instead of
    // during the hour spent chasing a green suite that ran yesterday's code.
    const everythingStale = staleInputs(0, inputs);
    expect(everythingStale).toHaveLength(inputs.length);
    expect(everythingStale).toContain('packages/plugin/src/main.ts');
    // And it is a comparison, not a constant: nothing is newer than the future.
    expect(staleInputs(Number.MAX_SAFE_INTEGER, inputs)).toEqual([]);
  });

  it('has a built main.js on disk for bundle-install.spec.ts to load', () => {
    // Was `describe.skipIf(!bundleBuilt)` over in `bundle-install.spec.ts`, which
    // turned "the bundle was never built" into a silent skip and a green run.
    // It is an assertion now, so a test run that never built the plugin says so.
    expect(bundleMtimeMs(), `packages/plugin/main.js does not exist — ${REMEDY}`).not.toBeNull();
  });

  it('was built after every source that goes into it', () => {
    const built = bundleMtimeMs();
    if (built === null) return; // Already reported above; do not double-fail.
    const stale = staleInputs(built, inputs);
    // Named rather than counted, so the message is the diagnosis. When this
    // fires, `bundle-install.spec.ts` is asserting the shape of a bundle built
    // before these files existed in their current form — its four registered
    // commands, its two view types and its `Plugin` subclass are all claims
    // about superseded code, and they will pass.
    expect(
      stale,
      `packages/plugin/main.js is older than ${stale.length} of its own sources, ` +
        `so bundle-install.spec.ts is testing a superseded build — ${REMEDY}`,
    ).toEqual([]);
  });
});
