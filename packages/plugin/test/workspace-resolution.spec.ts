/**
 * ol-wfze: **no workspace package may advertise an entry point inside `dist/`.**
 *
 * THE DEFECT THIS GUARDS. `olea-core` used to declare `"main": "./dist/index.js"`
 * while `"types"` pointed at `./src/index.ts`. Downstream packages therefore
 * TYPECHECKED against core's source and RAN against the last build of it. Edit a
 * core module, run `pnpm -r test` without rebuilding, and every downstream suite
 * executes yesterday's implementation while the type system reports today's —
 * and both are green. Three assertions in this package's today-panel suite
 * passed for about an hour that way in run 9 and only went red after an explicit
 * `pnpm -r build`.
 *
 * WHY IT IS WORTH A TEST RATHER THAN A HABIT. Nothing in a green run
 * distinguishes "this passed" from "this passed against code you have since
 * replaced". That is N-013 — a check that cannot fail in the way you think it
 * can — relocated out of the check and into the build graph, which is exactly
 * where it is hardest to notice. Run 9's answer was discipline: take every gate
 * number after a build. Habits are the thing this project's guard work exists to
 * replace, and a habit leaves no trace when it lapses.
 *
 * WHY THIS SHAPE OF TEST. The hazard was closed by pointing `main` at source, so
 * there is no second artifact left to go stale — `dist/` may still be produced,
 * but nothing in the workspace resolves through it. That fix is one word in a
 * `package.json`, invisible in review, and silently undone by anyone who decides
 * a private package "should" ship built output. This asserts the property that
 * closes the hazard rather than the symptom, so reopening it fails here instead
 * of being discovered by an hour of chasing a green suite.
 *
 * SCOPE, stated because it is narrower than the defect class. This proves the
 * *module graph* has no stale-able artifact in it. It says nothing about
 * `packages/plugin/main.js`, the esbuild bundle loaded from disk by
 * `bundle-install.spec.ts` — that one is a genuine second artifact and is
 * stale-able by construction, because the point of that suite is to read the
 * artifact rather than the source. It is covered separately, and as of run 11 it
 * IS covered: `bundle-freshness.spec.ts` fails when `main.js` is missing or older
 * than any source that goes into it. Together the two files close ol-wfze —
 * this one for the packages resolved by name, that one for the bundle.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The fields Node and Vite resolve a bare specifier through. `types`/`typings`
 * are included deliberately: a dist-pointing `types` does not cause the stale
 * *execution* above, but it does make `pnpm -r typecheck` depend on a prior
 * build, which is the same ordering hazard wearing the typechecker's hat.
 */
const ENTRY_FIELDS = ['main', 'module', 'browser', 'types', 'typings'] as const;

/** The packages this workspace imports by bare specifier, and so must resolve without a build. */
const RESOLVED_BY_NAME = ['olea-contracts', 'olea-core', 'olea-synthetic'] as const;

interface Manifest {
  readonly dir: string;
  readonly name: string;
  readonly json: Record<string, unknown>;
}

function manifests(): Manifest[] {
  return readdirSync(PACKAGES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PACKAGES_ROOT, entry.name, 'package.json'))
    .filter((file) => existsSync(file))
    .map((file) => {
      const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      return { dir: dirname(file), name: String(json.name ?? dirname(file)), json };
    });
}

/** Every string leaf under an `exports` map, which is the other way an entry point gets declared. */
function exportStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) exportStrings(value, out);
  }
  return out;
}

/** Every declared entry point of one package, as `field -> specifier` pairs. */
function entryPoints(manifest: Manifest): { field: string; value: string }[] {
  const found: { field: string; value: string }[] = [];
  for (const field of ENTRY_FIELDS) {
    const value = manifest.json[field];
    if (typeof value === 'string') found.push({ field, value });
  }
  for (const value of exportStrings(manifest.json.exports)) {
    found.push({ field: 'exports', value });
  }
  return found;
}

/** True when a specifier points into a build-output directory rather than at source. */
function pointsIntoDist(specifier: string): boolean {
  return specifier.split('/').includes('dist');
}

describe('workspace module resolution cannot go stale (ol-wfze)', () => {
  const all = manifests();

  it('finds every workspace package, so this suite cannot pass by looking at nothing', () => {
    // N-013 guard on the guard: a broken glob here would make every assertion
    // below vacuously true, which is the exact failure mode this file exists to
    // prevent. Assert the corpus before asserting anything about it.
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.map((m) => m.name).sort()).toEqual(
      expect.arrayContaining(['olea-contracts', 'olea-core', 'olea-plugin', 'olea-synthetic']),
    );
    // Not every package declares an entry point — `olea-workbench` is a build
    // target nothing imports by name, and correctly has none. So the floor is on
    // the packages that ARE imported by name, which are the ones that can go
    // stale, and each of which must name both a runtime and a types entry.
    for (const name of RESOLVED_BY_NAME) {
      const manifest = all.find((candidate) => candidate.name === name);
      expect(manifest, `${name} is missing from packages/`).toBeDefined();
      const fields = manifest ? entryPoints(manifest).map((entry) => entry.field) : [];
      expect(fields).toContain('main');
      expect(fields).toContain('types');
    }
  });

  it('declares no entry point inside dist/, so nothing resolves to a build artifact', () => {
    const offenders = all.flatMap((manifest) =>
      entryPoints(manifest)
        .filter((entry) => pointsIntoDist(entry.value))
        .map((entry) => `${manifest.name}: "${entry.field}": ${JSON.stringify(entry.value)}`),
    );
    // Named rather than counted: when this fires, the message is the diagnosis.
    // A dist-pointing entry means consumers run the last BUILD of this package
    // while typechecking its current SOURCE, so their suites can pass against
    // code that no longer exists. Point the field at ./src/index.ts instead.
    expect(offenders).toEqual([]);
  });

  it('resolves every by-name dependency to a file that exists without a build', () => {
    // The property a clean clone needs, checked directly rather than inferred
    // from the absence of the string "dist": CI runs typecheck and test before
    // build, so an entry naming any not-yet-existing file fails there and not
    // here. `dist/` is deleted first so a warm local build cannot hide it.
    for (const name of RESOLVED_BY_NAME) {
      const manifest = all.find((candidate) => candidate.name === name);
      expect(manifest, `${name} is missing from packages/`).toBeDefined();
      if (!manifest) continue;
      for (const entry of entryPoints(manifest)) {
        const target = resolve(manifest.dir, entry.value);
        expect(
          existsSync(target),
          `${name} "${entry.field}" points at ${entry.value}, which does not exist in the source tree`,
        ).toBe(true);
      }
    }
  });
});
