/**
 * ol-m34c: **a `dist/` assembled from two different builds must be detectable.**
 *
 * THE INCIDENT THIS ENCODES, which happened rather than being imagined. On
 * 2026-08-15 a forgotten `node build.mjs serve` from three days earlier still
 * held port 4321 with a watcher on the real `dist/`. Seven minutes after a
 * production build completed, an unrelated source edit made that watcher write a
 * 3,352,881-byte dev bundle over the 447 KB production `app.js`. `index.html`,
 * `_headers` and `plugin-styles.css` were still the production build's. Nothing
 * in the directory recorded that its files came from two builds, so nothing
 * could have noticed — and `dist/` is the artifact a pre-deploy privacy gate is
 * run against.
 *
 * ol-ie7t fixed the case where the serve *fails*: it now binds its port before
 * touching `dist/` (`dev-server-port-clash.spec.ts` guards that). This is the
 * case where the serve *succeeds*, which ordering cannot help with, because the
 * overwrite is a successful build doing what it was asked. The remedy is a
 * record: `build-stamp.json` names the mode and hashes everything else, the
 * watcher rewrites it on every rebuild, and `node build.mjs verify` reads it
 * back with three distinct exit codes.
 *
 * EVERY TEST HERE BUILDS INTO A THROWAWAY `WB_DIST`. A test that proved the
 * deployable directory is protected by overwriting the deployable directory
 * would be its own counter-example.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const WORKBENCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_SCRIPT = join(WORKBENCH_ROOT, 'build.mjs');

const temporary: string[] = [];

function scratchDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'olea-wb-dist-'));
  temporary.push(dir);
  return dir;
}

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(dist: string, ...args: string[]): Run {
  const result = spawnSync(process.execPath, [BUILD_SCRIPT, ...args], {
    cwd: WORKBENCH_ROOT,
    env: { ...process.env, WB_DIST: dist },
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function stampOf(dist: string): {
  format: string;
  mode: string;
  builtAt: string;
  rebuilds: number;
  fileCount: number;
  files: Record<string, { bytes: number; sha256: string }>;
} {
  return JSON.parse(readFileSync(join(dist, 'build-stamp.json'), 'utf8'));
}

afterAll(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the build stamp (ol-m34c)', () => {
  it('records the mode and every file a production build left behind', () => {
    const dist = scratchDist();
    expect(run(dist, 'production').status).toBe(0);

    const stamp = stampOf(dist);
    expect(stamp.format).toBe('olea-workbench/build-stamp@1');
    expect(stamp.mode).toBe('production');
    expect(stamp.rebuilds).toBe(0);
    // The whole artifact, not just the bundle: the incident was a production
    // index beside a dev bundle, so a stamp covering only `app.js` would have
    // been silent about exactly half of it.
    expect(stamp.fileCount).toBeGreaterThan(1);
    for (const name of ['app.js', 'index.html', '_headers', 'plugin-styles.css']) {
      expect(stamp.files[name], name).toBeDefined();
    }
    expect(stamp.files['build-stamp.json']).toBeUndefined();
  });

  it('carries nothing environment-derived into the artifact', () => {
    const dist = scratchDist();
    expect(run(dist, 'production').status).toBe(0);

    // `dist/` is a public surface and the build has no `define` for the same
    // reason: the surest way to keep an environment value out of it is to have
    // no channel for one. The stamp is a new file in that directory, so it gets
    // the same requirement — relative paths only, and not even the absolute
    // path of the directory it is sitting in.
    const text = readFileSync(join(dist, 'build-stamp.json'), 'utf8');
    expect(text).not.toContain(dist);
    expect(text).not.toContain(WORKBENCH_ROOT);
    for (const path of Object.keys(stampOf(dist).files)) {
      expect(path.startsWith('/'), path).toBe(false);
      expect(path.includes('..'), path).toBe(false);
    }
  });

  it('verifies a complete production artifact as such (exit 0)', () => {
    const dist = scratchDist();
    expect(run(dist, 'production').status).toBe(0);

    const verified = run(dist, 'verify');
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain('complete production artifact');
  });

  /**
   * THE ASSERTION THIS FILE EXISTS FOR. Reproduces the incident's shape exactly:
   * a production build, then one file replaced by the dev bundle a watcher would
   * have written. Everything else in the directory is still the production
   * build's, which is what made it invisible.
   */
  it('detects a dist/ whose files came from two different builds (exit 1)', () => {
    const release = scratchDist();
    const devBuild = scratchDist();
    expect(run(release, 'production').status).toBe(0);
    expect(run(devBuild, 'development').status).toBe(0);

    const productionBundle = stampOf(release).files['app.js'];
    const developmentBundle = stampOf(devBuild).files['app.js'];
    if (productionBundle === undefined || developmentBundle === undefined) {
      throw new Error('a build produced no app.js — the premise of this test is gone');
    }
    // Not incidental: the unminified bundle is several times the size of the
    // minified one, which is how the real mixed directory was eventually spotted
    // — by someone comparing a reported size against the file on disk, by hand.
    expect(developmentBundle.bytes).toBeGreaterThan(productionBundle.bytes * 2);

    writeFileSync(join(release, 'app.js'), readFileSync(join(devBuild, 'app.js')));

    const verified = run(release, 'verify');
    expect(verified.status).toBe(1);
    expect(verified.stderr).toContain('more than one build');
    expect(verified.stderr).toContain('app.js');
  });

  it('detects a file nobody built, and one that went missing (exit 1)', () => {
    const dist = scratchDist();
    expect(run(dist, 'production').status).toBe(0);

    writeFileSync(join(dist, 'stray.txt'), 'not written by any build\n', 'utf8');
    expect(run(dist, 'verify').stderr).toContain('not written by this build: stray.txt');
    rmSync(join(dist, 'stray.txt'));

    rmSync(join(dist, '_headers'));
    const verified = run(dist, 'verify');
    expect(verified.status).toBe(1);
    expect(verified.stderr).toContain('missing: _headers');
  });

  /**
   * The dev-server case, reduced to what a gate can act on. A dev build is
   * internally consistent — nothing is mixed — and still must never be
   * deployed. Exit 2 is that distinction: it says "intact, wrong kind", which a
   * gate can treat differently from "this directory is not what it claims".
   */
  it('separates “not a production build” from “mixed” by exit code (exit 2)', () => {
    const dist = scratchDist();
    expect(run(dist, 'development').status).toBe(0);
    expect(stampOf(dist).mode).toBe('development');

    const verified = run(dist, 'verify');
    expect(verified.status).toBe(2);
    expect(verified.stderr).toContain('not a deployable artifact');
  });

  it('refuses to vouch for a directory with no stamp at all (exit 1)', () => {
    const dist = scratchDist();
    writeFileSync(join(dist, 'app.js'), '// arrived from somewhere\n', 'utf8');

    const verified = run(dist, 'verify');
    expect(verified.status).toBe(1);
    expect(verified.stderr).toContain('no build-stamp.json');
  });

  /**
   * A mode this script does not recognise used to fall through to `development`,
   * so a typo in the read-only mode would wipe and rebuild the very directory it
   * was asked to inspect. The safe mode existing is not much use if a slip of the
   * finger runs the destructive one.
   */
  it('refuses an unrecognised mode instead of falling through to a rebuild', () => {
    const dist = scratchDist();
    expect(run(dist, 'production').status).toBe(0);
    const before = stampOf(dist);

    const typo = run(dist, 'verfiy');
    expect(typo.status).toBe(1);
    expect(typo.stderr).toContain('is not a build mode');
    expect(typo.stderr).toContain('Nothing has been touched');
    expect(stampOf(dist)).toEqual(before);
  });

  it('leaves dist/ untouched when verifying', () => {
    const dist = scratchDist();
    expect(run(dist, 'production').status).toBe(0);
    const before = stampOf(dist);

    expect(run(dist, 'verify').status).toBe(0);
    expect(stampOf(dist)).toEqual(before);
  });
});
