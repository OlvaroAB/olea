// Inverted INV-3 probe (ol-thuc).
//
// scripts/check-inv3.mjs is CI's real-content marker tripwire. This spec proves the matching
// hardening done for ol-thuc actually behaves as intended, by shelling out to the real checker
// script as a child process against a synthetic fixture (SYNTHETIC markers only — never a real
// course code, note title or concept name; this repo is public):
//
//   1. Pointed at the probe fixture with a distinctive synthetic marker set via INV3_MARKERS, the
//      checker must exit non-zero, report the offending file, withhold the matched marker text,
//      and match the marker's INFLECTED form (word-boundary bounded on the left, free on the
//      right) while refusing to fire when the marker is glued onto a preceding letter.
//   2. Pointed at the same fixture with a marker that is itself ordinary English, the checker
//      must report it as an ADVISORY, not a VIOLATION, and exit zero.
//   3. With INV3_MARKERS unset, the checker must still warn "NOT ACTIVE" and exit zero — the
//      pre-existing contract this hardening must not disturb.
//   4. With INV3_MARKERS unset AND --require-markers, the checker must fail closed (exit 1) —
//      also pre-existing, also must not regress.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/core/test -> repo root
const repoRoot = join(__dirname, '..', '..', '..');
const checkerScript = join(repoRoot, 'scripts', 'check-inv3.mjs');
const probeFixtureDir = join(__dirname, 'fixtures', 'inv3-probe');

// A distinctive, obviously-synthetic marker — never a real course code, note title or concept
// name. The fixture file carries only its INFLECTED form (`zqxplorb77s`), to exercise the
// left-bound/free-right matching this spec exists to check.
const SYNTHETIC_MARKER = 'zqxplorb77';
// Present in scripts/lib/common-english-words.mjs's generic frequency list — chosen for the
// advisory-carve-out test precisely because it is ordinary English and carries no information
// about anyone's real vault.
const ORDINARY_MARKER = 'wonderful';

function runChecker(
  args: string[],
  env: Record<string, string | undefined>,
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [checkerScript, ...args], {
      encoding: 'utf8',
      cwd: repoRoot,
      env: { ...process.env, ...env },
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

describe('INV-3 enforcement (scripts/check-inv3.mjs, ol-thuc matcher hardening)', () => {
  it('exits non-zero, names the file, withholds marker text, and is word-boundary bounded', () => {
    const result = runChecker([probeFixtureDir], { INV3_MARKERS: SYNTHETIC_MARKER });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/INV-3 VIOLATION/);
    expect(result.stderr).toMatch(/violation\.txt/);
    // Matched marker text is never printed, for either the base term or its inflected form.
    expect(result.stderr.toLowerCase()).not.toContain(SYNTHETIC_MARKER);
    // The inflected occurrence (line 2) must fire; the glued-onto-a-letter occurrence (line 3)
    // must not — left-bound, free-right is the whole point of ol-thuc.
    expect(result.stderr).toMatch(/\(line 2\)/);
    expect(result.stderr).not.toMatch(/\(line 3\)/);
    expect(result.stderr).not.toMatch(/\(line 1\)/);
  });

  it('reports an ordinary-English marker as ADVISORY, not a violation, and exits zero', () => {
    const result = runChecker([probeFixtureDir], { INV3_MARKERS: ORDINARY_MARKER });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/INV-3 ADVISORY/);
    expect(result.stdout).toMatch(/advisory-only\.txt/);
    expect(result.stdout).toMatch(/INV-3 OK/);
    expect(result.stderr).not.toMatch(/INV-3 VIOLATION/);
  });

  it('still warns NOT ACTIVE and exits zero when INV3_MARKERS is unset (pre-existing contract)', () => {
    const result = runChecker([probeFixtureDir], { INV3_MARKERS: '' });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/NOT ACTIVE/);
  });

  it('still fails closed under --require-markers when unset (pre-existing contract)', () => {
    const result = runChecker([probeFixtureDir, '--require-markers'], { INV3_MARKERS: '' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/FAIL-CLOSED/);
  });
});
