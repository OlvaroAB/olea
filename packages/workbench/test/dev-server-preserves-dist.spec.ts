/**
 * ol-m34c: **a SUCCESSFUL serve must never touch the deployable `dist/`.**
 *
 * THE DEFECT THIS GUARDS, closing the case `ol-ie7t` deliberately left open.
 * `ol-ie7t` stopped a *failed* serve from wiping `dist/` before it knew whether
 * it could bind its port. It did nothing for the case that actually did
 * damage: a serve that *succeeds* keeps rebuilding in place, in the same
 * directory the deployable artifact lives in, for as long as the process
 * runs. On 2026-08-15 a three-day-old forgotten watcher did exactly that,
 * silently overwriting a 447 KB production `app.js` with a 3.35 MB dev bundle
 * seven minutes after a production build had finished — see
 * `test/build-stamp.spec.ts` for the detection half that incident produced
 * first.
 *
 * THE FIX THIS PROVES. `serve` now resolves its working directory to a
 * sibling of the deployable one (`<dist>-dev`) and never gets a path to the
 * real `dist/` at all — see `build.mjs`'s `dist` computation. This spawns the
 * real script: seeds a real production build, starts a real `serve` against
 * the same `WB_DIST`, waits for its *initial* build to land in the sibling
 * directory, then forces a *second* build by editing the real entry point's
 * mtime — the same "an unrelated source edit lands while a server is
 * running" shape as the incident — and checks the production directory is
 * still byte-identical after both.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const WORKBENCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_SCRIPT = join(WORKBENCH_ROOT, 'build.mjs');
const ENTRY = join(WORKBENCH_ROOT, 'src', 'main.ts');

const temporary: string[] = [];

function scratchDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'olea-wb-preserve-'));
  temporary.push(dir);
  return dir;
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

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for: ${what}`);
    }
    await new Promise((settle) => setTimeout(settle, 50));
  }
}

let child: ReturnType<typeof spawn> | undefined;

afterEach(async () => {
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    const dead = new Promise<void>((done) => child?.once('close', () => done()));
    child.kill('SIGKILL');
    await Promise.race([dead, new Promise<void>((done) => setTimeout(done, 2_000))]);
  }
  child = undefined;
  for (const dist of temporary.splice(0)) {
    rmSync(dist, { recursive: true, force: true });
    rmSync(`${dist}-dev`, { recursive: true, force: true });
  }
});

describe('a successful dev serve never touches the deployable dist/ (ol-m34c)', () => {
  it('builds into a sibling directory and rebuilds there, leaving dist/ byte-identical', async () => {
    const dist = scratchDist();
    const devDist = `${dist}-dev`;

    // Seed `dist/` with a real production build, exactly like a deploy would find it.
    const build = spawnSync(process.execPath, [BUILD_SCRIPT, 'production'], {
      cwd: WORKBENCH_ROOT,
      env: { ...process.env, WB_DIST: dist },
      encoding: 'utf8',
    });
    expect(build.status, build.stderr).toBe(0);
    const stampBefore = stampOf(dist);
    const appBefore = readFileSync(join(dist, 'app.js'));

    let stdout = '';
    let stderr = '';
    child = spawn(process.execPath, [BUILD_SCRIPT, 'serve'], {
      cwd: WORKBENCH_ROOT,
      // Port 0: the OS assigns a free one. This test never makes an HTTP
      // request, so which port it is does not matter.
      env: { ...process.env, WB_DIST: dist, WB_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await waitFor(
        () => existsSync(join(devDist, 'build-stamp.json')),
        15_000,
        'the initial serve build to land in the sibling directory',
      );
    } catch (error) {
      throw new Error(`${(error as Error).message}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }

    // THE ASSERTION. The deployable directory was never touched by the serve
    // that just built — not even to look at it.
    expect(stampOf(dist)).toEqual(stampBefore);
    expect(readFileSync(join(dist, 'app.js'))).toEqual(appBefore);
    expect(stampOf(devDist).mode).toBe('serve');

    // Force a SECOND build the way a real edit would, while the server is
    // still running — the exact shape of the incident, where the overwrite
    // happened on an unrelated source edit minutes after the production
    // build had finished.
    const rebuildsBefore = stampOf(devDist).rebuilds;
    const now = new Date();
    utimesSync(ENTRY, now, now);
    try {
      await waitFor(
        () => stampOf(devDist).rebuilds > rebuildsBefore,
        15_000,
        'a rebuild triggered by a source edit',
      );
    } catch (error) {
      throw new Error(`${(error as Error).message}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }

    // Still untouched, after a rebuild the watcher actually performed.
    expect(stampOf(dist)).toEqual(stampBefore);
    expect(readFileSync(join(dist, 'app.js'))).toEqual(appBefore);
  }, 45_000);
});
