import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `[D-437]` row 38 (`ol-egov.141.89.2.20`): the sweep's explicit recall intent is authoring intent
// for the ordinary generation sweep and NO other generation path. The constant is the one place
// that intent is written, so the list of files that refer to it is what this test pins. A new
// caller (a heading offer, a revision, a planner need, a paper slot) would be a way for a recall
// label to appear on an instrument authored for another purpose.
//
// It is a scan of source text, like `instrument/target-store-callers.spec.ts` beside the record
// writer, so a reference in a comment counts: no file but the two below may name the constant.

const PACKAGES_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const CONSTANT = 'SWEEP_RECALL_ASK';

/** The module that defines the constant, and the one sweep that uses it. */
const DEFINING_MODULE = 'packages/core/src/routing/demand-ask.ts';
const ALLOWED_CALLERS: readonly string[] = ['packages/plugin/src/generation/pipeline.ts'];

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

describe('the sweep recall constant has no caller but the ordinary generation sweep (row 38)', () => {
  it('scans real source files (a scan that found none would pass vacuously)', async () => {
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files.map((f) => relative(REPO_ROOT, f))).toContain(DEFINING_MODULE);
  });

  it('no file outside the allow-list refers to the constant', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      const rel = relative(REPO_ROOT, file);
      if (rel === DEFINING_MODULE) continue;
      if (!(await readFile(file, 'utf8')).includes(CONSTANT)) continue;
      if (!ALLOWED_CALLERS.includes(rel)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('the sweep does refer to it (a list nothing on it uses would pass for the wrong reason)', async () => {
    const sweep = await readFile(join(REPO_ROOT, ALLOWED_CALLERS[0] ?? ''), 'utf8');
    expect(sweep).toContain(CONSTANT);
  });
});
