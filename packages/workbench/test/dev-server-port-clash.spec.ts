/**
 * ol-ie7t: **a dev server that cannot get its port must not destroy `dist/`.**
 *
 * THE DEFECT THIS GUARDS. `build.mjs serve` used to `rm(dist)` as its very first
 * act and bind its port as its very last. Run it while something else held the
 * port — a forgotten watcher from a previous session, which is exactly how this
 * was found — and the wipe had already happened by the time the bind failed. The
 * process then died on an unhandled EADDRINUSE, leaving no `dist/`, no
 * explanation, and no hint that a failed dev server was the cause. The next
 * command to look for the artifact just found it missing or half-built.
 *
 * WHY IT IS WORTH A TEST AND NOT JUST A PATCH. `dist/` is a public surface: the
 * built workbench is a deployable artifact with a pre-deploy privacy gate run
 * against it. A build step that can silently remove or half-replace that artifact
 * is one step removed from a gate that passed against a different bundle than the
 * one deployed. That is the house defect class — a reported result that has
 * quietly stopped describing the thing it names — and the ordering that prevents
 * it is two statements apart in a file nobody re-reads. Swap them back and
 * nothing else in the suite would notice.
 *
 * WHY IT DRIVES THE REAL SCRIPT. The assertion is about the ORDER of two side
 * effects — bind, then wipe — so a re-implementation or a mock of either would
 * assert the test's own structure rather than the build's. This spawns
 * `build.mjs serve` for real, against a port genuinely held by this process, and
 * looks at the filesystem afterwards.
 *
 * NON-DESTRUCTIVE BY CONSTRUCTION, and that is itself the assertion: against the
 * fixed script the child exits before touching `dist/`, so this test cannot harm
 * a real build. Against the old script it would delete one — which is precisely
 * the failure being detected, and the reason the sentinel is checked rather than
 * the exit code alone.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const WORKBENCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_SCRIPT = join(WORKBENCH_ROOT, 'build.mjs');
const DIST = join(WORKBENCH_ROOT, 'dist');
const SENTINEL = join(DIST, '.port-clash-probe');
const SENTINEL_BODY = 'ol-ie7t: if this file is gone, serve mode wiped dist/ before binding.\n';

/** Holds a port for real, on an OS-assigned number so no fixed port can collide. */
function occupyEphemeralPort(): Promise<{ server: Server; port: number }> {
  return new Promise((settle, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        fail(new Error('could not determine the bound port'));
        return;
      }
      settle({ server, port: address.port });
    });
  });
}

interface Run {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly timedOut: boolean;
}

/** Runs `node build.mjs serve` with `WB_PORT` set, killing it if it somehow starts serving. */
function runServeAgainst(port: number, timeoutMs = 30_000): Promise<Run> {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [BUILD_SCRIPT, 'serve'], {
      cwd: WORKBENCH_ROOT,
      env: { ...process.env, WB_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      settle({ code, signal, stderr, stdout, timedOut });
    });
  });
}

const opened: Server[] = [];
let createdDist = false;

afterEach(async () => {
  await Promise.all(
    opened.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
  rmSync(SENTINEL, { force: true });
  // Only remove `dist/` if this test is what created it; a real build's output
  // is left exactly as found.
  if (createdDist) {
    rmSync(DIST, { recursive: true, force: true });
    createdDist = false;
  }
});

describe('the workbench dev server on a port clash (ol-ie7t)', () => {
  it('fails cleanly and leaves dist/ intact', async () => {
    if (!existsSync(DIST)) {
      mkdirSync(DIST, { recursive: true });
      createdDist = true;
    }
    writeFileSync(SENTINEL, SENTINEL_BODY, 'utf8');

    const { server, port } = await occupyEphemeralPort();
    opened.push(server);

    const run = await runServeAgainst(port);

    // Guard the guard: if the child had somehow bound the port, it would have
    // gone on to wipe and rebuild dist/ and then served forever, and the
    // sentinel check below would be measuring the wrong thing entirely.
    expect(
      run.timedOut,
      'serve kept running against a held port — the clash was never detected',
    ).toBe(false);

    // THE ASSERTION. The artifact survives a failed serve. Against the original
    // ordering this is the line that goes red: `rm(dist)` ran first, so the
    // sentinel — and the rest of a real build — was already gone.
    expect(
      existsSync(SENTINEL),
      'serve destroyed dist/ before discovering it could not bind its port',
    ).toBe(true);
    expect(readFileSync(SENTINEL, 'utf8')).toBe(SENTINEL_BODY);

    // A clash is a failure, so it must be reported as one. Dying on an unhandled
    // 'error' event technically also exits non-zero; what makes this actionable
    // is naming the port and saying the artifact was left alone.
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain(String(port));
    expect(run.stderr).toMatch(/dist\/ has NOT been touched/);
  }, 45_000);
});
