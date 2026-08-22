/**
 * C2.4's centrepiece: "delete-index-and-rebuild equals incremental state."
 *
 * This is an equivalence test, not a smoke test — see the module doc below
 * each phase for what a real bug in `KeywordIndexEngine.applyEvent` would do
 * to it. The comparison is `toEqual` on the exact `PersistedKeywordIndex`
 * `KeywordIndexStore.save` actually received (`store.peek()`), field for
 * field and in array order — never routed through `searchKeywordIndex` or
 * any other reducing/normalising function first, which is what makes this
 * test able to fail at all rather than only ever proving "both sides mention
 * the same words somewhere."
 */

import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { KeywordIndexEngine } from './engine.js';
import type { YieldScheduler } from './scheduling.js';
import type { KeywordIndexStore, PersistedKeywordIndex } from './types.js';

class MemoryKeywordIndexStore implements KeywordIndexStore {
  private saved: PersistedKeywordIndex | null = null;

  async load(): Promise<PersistedKeywordIndex | null> {
    return this.saved;
  }

  async save(index: PersistedKeywordIndex): Promise<void> {
    this.saved = index;
  }

  peek(): PersistedKeywordIndex | null {
    return this.saved;
  }
}

/** No real timer — resolves on the microtask queue only (the task's "inject any clock/scheduling dependency... do not use real timers in tests"). */
const immediateScheduler: YieldScheduler = { yield: () => Promise.resolve() };

describe('KeywordIndexEngine — delete-index-and-rebuild equals incremental state (C2.4)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-keyword-index-c24-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeFixture(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async function removeFixture(relPath: string): Promise<void> {
    await unlink(join(root, ...relPath.split('/')));
  }

  it('produces the identical persisted index whether reached incrementally or by deleting the cache and rebuilding', async () => {
    const vault = new FolderSource(root);
    const store = new MemoryKeywordIndexStore();
    const engine = await KeywordIndexEngine.create({ vault, store, scheduler: immediateScheduler });

    // A realistic, *not* alphabetically-ordered event stream. Deliberately
    // out of path order: if `KeywordIndexEngine.toPersisted` ever regressed
    // to reflecting Map insertion (i.e. event-arrival) order instead of
    // explicitly sorting by path, this ordering is exactly what would expose
    // it — `buildFullIndex` inherits sorted order for free from
    // `VaultSource.list`'s contract, so the two sides would silently drift
    // out of array-order agreement while still containing the same set of
    // documents. `toEqual` on the full array catches that; a set-based or
    // per-path comparison would not.

    // 1. create — a document at the end of the alphabet, first.
    await writeFixture('Zeta.md', '---\ncourse: GEOL204\n---\n\n# Zeta\nfirst prose\n');
    await engine.applyEvent({ kind: 'create', path: 'Zeta.md' });

    // 2. create — a document at the start of the alphabet, second.
    await writeFixture('Alpha.md', '---\ncourse: MUSTH104\n---\n\n# Alpha v1\noriginal prose\n');
    await engine.applyEvent({ kind: 'create', path: 'Alpha.md' });

    // 3. create — a document with no course at all, to prove ungrouped
    //    documents survive the round trip too.
    await writeFixture('Mid.md', '# Mid\nno course here\n');
    await engine.applyEvent({ kind: 'create', path: 'Mid.md' });

    // 4. modify — changes Alpha's content; the incremental index must reflect
    //    the new content, not the one indexed at step 2.
    await writeFixture('Alpha.md', '---\ncourse: MUSTH104\n---\n\n# Alpha v2\nrevised prose\n');
    await engine.applyEvent({ kind: 'modify', path: 'Alpha.md' });

    // 5. rename — moves into a subfolder, proving path (not just filename)
    //    changes are handled, and that the old key is not left behind.
    await removeFixture('Mid.md');
    await writeFixture('renamed/Middle.md', '# Mid\nno course here\n');
    await engine.applyEvent({ kind: 'rename', path: 'renamed/Middle.md', oldPath: 'Mid.md' });

    // 6. create, then 7. rename that changes *only* case — exercised on this
    //    dev/CI platform's case-sensitive filesystem (Linux), so the two
    //    paths are genuinely distinct dentries; see C2-index.md's scenario
    //    note on the platform caveat.
    await writeFixture('casestudy.md', '---\ncourse: GEOL204\n---\n\n# Case study\nprose\n');
    await engine.applyEvent({ kind: 'create', path: 'casestudy.md' });
    await removeFixture('casestudy.md');
    await writeFixture('CaseStudy.md', '---\ncourse: GEOL204\n---\n\n# Case study\nprose\n');
    await engine.applyEvent({ kind: 'rename', path: 'CaseStudy.md', oldPath: 'casestudy.md' });

    // 8. delete — removes a document the index actually holds.
    await removeFixture('renamed/Middle.md');
    await engine.applyEvent({ kind: 'delete', path: 'renamed/Middle.md' });

    // 9. delete of a path that was **never** created or indexed at all —
    //    the acceptance criterion's explicit case. No filesystem mutation:
    //    the path never existed on disk either.
    await engine.applyEvent({ kind: 'delete', path: 'never-created.md' });

    // 10. one more create, out of order relative to the two survivors above.
    await writeFixture('Beta.md', '---\ncourse: MUSTH104\n---\n\n# Beta\nprose\n');
    await engine.applyEvent({ kind: 'create', path: 'Beta.md' });

    const incremental = store.peek();
    expect(incremental).not.toBeNull();
    // Sanity check on the scenario itself, independent of the equivalence
    // claim below: exactly the four survivors, nothing stale.
    expect(incremental?.documents.map((d) => d.path).sort()).toEqual([
      'Alpha.md',
      'Beta.md',
      'CaseStudy.md',
      'Zeta.md',
    ]);

    // --- Delete the whole cache (D-006: safe at any moment) and rebuild. ---
    await engine.clear();
    expect(store.peek()).toEqual({ version: 1, documents: [] });

    const rebuildResult = await engine.rebuild();
    expect(rebuildResult).toBe('complete');
    const rebuilt = store.peek();

    // The actual equivalence claim: deep, order-sensitive equality of the
    // real persisted structures — not a normalised or search-mediated
    // comparison. A rename that forgot to drop the old key, a delete that
    // mis-keyed on `oldPath` instead of `path`, a `modify` that reused stale
    // text, a case-collision bug treating `casestudy.md`/`CaseStudy.md` as
    // the same key, or `toPersisted` losing its explicit sort would each
    // make this assertion fail.
    expect(rebuilt).toEqual(incremental);
  });
});
