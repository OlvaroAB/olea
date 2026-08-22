// Inverted INV-1 probe (plan §0.5 / bead P0-T03).
//
// scripts/check-inv1.mjs is CI's enforcement of INV-1 ("no `obsidian` import
// outside packages/plugin. Ever."). This spec proves the tripwire actually
// fires, by shelling out to the real checker script as a child process (never
// importing the probe fixture as an ES module — that would drag an
// unresolvable `obsidian` specifier into vitest's own module graph):
//
//   1. Pointed at the deliberately-poisoned fixture directory, the checker
//      must exit non-zero and name the offending file.
//   2. Pointed at nothing (its default scan of the real tree), the checker
//      must exit zero — the enforcement itself is green in CI.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/core/test -> repo root
const repoRoot = join(__dirname, '..', '..', '..');
const checkerScript = join(repoRoot, 'scripts', 'check-inv1.mjs');
const probeFixtureDir = join(__dirname, 'fixtures', 'inv1-probe');

function runChecker(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [checkerScript, ...args], {
      encoding: 'utf8',
      cwd: repoRoot,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    // execFileSync throws a Node ExecFileException on non-zero exit, which
    // carries these fields but isn't exported as a usable type; narrow the
    // unknown catch variable to the documented shape rather than widening it.
    const execError = error as { status?: number; stdout?: unknown; stderr?: unknown };
    return {
      status: typeof execError.status === 'number' ? execError.status : 1,
      stdout: String(execError.stdout ?? ''),
      stderr: String(execError.stderr ?? ''),
    };
  }
}

describe('INV-1 enforcement (scripts/check-inv1.mjs)', () => {
  it('exits non-zero and names the offending file when pointed at the probe fixture', () => {
    const result = runChecker([probeFixtureDir]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/INV-1 VIOLATION/);
    expect(result.stderr).toMatch(/obsidian/);
    expect(result.stderr).toMatch(/violation\.ts/);
  });

  it('exits zero on the clean tree (default scan: every package except packages/plugin)', () => {
    const result = runChecker([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/INV-1 OK/);
  });
});
