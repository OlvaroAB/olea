import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `[D-437]` (`ol-egov.141.89.57`), design section 3.1 and test T7: the writer of the instrument
// target record is callable only from materialisation and paper hand-off. Absence of a record is
// the unspecified state and it is permanent (`[D-277]` (f)): no migration, no backfill, no write on
// answering, opening, rescheduling, reviewing or revising. A backfill would be a new caller of
// `writeInstrumentTarget`, so the caller list is what this test pins.
//
// The allow-list names the two production callers the design names, by path. Neither exists yet
// (B4 adds the materialisers, B7 the hand-off): the test asserts no caller OUTSIDE the list, and
// each of those two beads shows its own caller by file and line in its close evidence.

const PACKAGES_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The only files that may call the writer. Widening this list is a design change, not an edit. */
const ALLOWED_CALLERS: readonly string[] = [
  'packages/plugin/src/generation/materialize-card.ts',
  'packages/plugin/src/generation/materialize-mcq.ts',
  'packages/core/src/oracle/paper-store.ts',
];

/** The module that defines the writer, exempt from its own scan. */
const DEFINING_MODULE = 'packages/core/src/instrument/target-store.ts';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-e2e', '.git', 'coverage']);

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
}

/** Every non-test source file under `packages/*` `src/` and `scripts/`. */
async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  const packages = await readdir(PACKAGES_DIR, { withFileTypes: true });
  for (const pkg of packages) {
    if (!pkg.isDirectory()) continue;
    for (const sub of ['src', 'scripts']) {
      try {
        await walk(join(PACKAGES_DIR, pkg.name, sub), files);
      } catch {
        // a package without that folder
      }
    }
  }
  return files.filter((file) => !/\.(spec|test)\.[cm]?[jt]sx?$/.test(file));
}

describe('the target-record writer has no caller but materialisation and paper hand-off (T7)', () => {
  it('scans real source files (a scan that found none would pass vacuously)', async () => {
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files.map((f) => relative(REPO_ROOT, f))).toContain(DEFINING_MODULE);
  });

  it('no file outside the allow-list refers to writeInstrumentTarget', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      const rel = relative(REPO_ROOT, file);
      if (rel === DEFINING_MODULE) continue;
      if (!(await readFile(file, 'utf8')).includes('writeInstrumentTarget')) continue;
      if (!ALLOWED_CALLERS.includes(rel)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('the allow-list is exactly the two callers the design names, as three files', () => {
    expect(ALLOWED_CALLERS).toHaveLength(3);
    expect(ALLOWED_CALLERS.filter((p) => p.includes('materialize-'))).toHaveLength(2);
    expect(ALLOWED_CALLERS.filter((p) => p.endsWith('paper-store.ts'))).toHaveLength(1);
  });
});
