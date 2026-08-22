/**
 * End-to-end proof of `ObsidianKeywordIndexStore`'s two acceptance clauses
 * that a unit test on the store alone can't establish, because they're
 * really claims about `KeywordIndexEngine` + this store working together
 * (P2-T01a acceptance; see `features/C2-index.md`'s "the index survives a
 * plugin reload" and "deleting the stored key and rebuilding reproduces
 * the same index" scenarios):
 *
 * - **Reload.** A fresh `KeywordIndexEngine` built over a *second*
 *   `ObsidianKeywordIndexStore` instance, but the same underlying
 *   `data.json` blob, comes back holding exactly what was persisted before
 *   — nothing lost, nothing invented, no rebuild needed. That's what
 *   "the index survives a plugin reload" means in practice: Obsidian
 *   tears down and reconstructs the whole plugin object graph on every
 *   reload, so "survives" can only ever mean "the *next* engine instance,
 *   reading the *same* data.json, sees it."
 * - **C2.4, end to end.** Deleting the store's key (D-006: always a safe
 *   thing to do) and rebuilding from the vault reproduces the identical
 *   `PersistedKeywordIndex` — proven here through the real adapter and a
 *   real (if synthetic) vault via `FolderSource`, not asserted by fiat.
 *
 * `FolderSource` (from `olea-core`, over `node:fs`) stands in for the vault
 * — a real, if synthetic, filesystem of markdown notes, invented content
 * only (INV-3). No `obsidian` import anywhere in this file.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderSource, KeywordIndexEngine } from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObsidianKeywordIndexStore } from '../../src/keyword-index/store.js';

/** In-memory stand-in for Obsidian's one-blob-per-plugin `data.json`, shared across store instances the way a real plugin's persisted file is shared across reloads. */
class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'olea-keyword-index-'));
  writeFileSync(
    join(root, 'week2.md'),
    [
      '---',
      'course: GEOL204',
      '---',
      '# Bedform Stratification',
      '',
      'Chemical synapses release neurotransmitter into the cleft.',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'week3.md'),
    [
      '---',
      'course: GEOL204',
      '---',
      '# Node Regeneration',
      '',
      'Voltage-gated sodium channels drive the depolarising phase.',
    ].join('\n'),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ObsidianKeywordIndexStore + KeywordIndexEngine — reload', () => {
  it('a second engine instance over the same data.json blob sees exactly what was persisted, with no rebuild', async () => {
    const host = new FakeDataHost();
    const vault = new FolderSource(root);

    const firstEngine = await KeywordIndexEngine.create({
      vault,
      store: new ObsidianKeywordIndexStore(host),
    });
    await firstEngine.rebuild();
    const persistedBeforeReload = firstEngine.toPersisted();
    expect(persistedBeforeReload.documents).toHaveLength(2);

    // Simulate a plugin reload: a brand-new engine and a brand-new store
    // instance, but the same underlying data.json blob — nothing else
    // touches the vault in between.
    const reloadedEngine = await KeywordIndexEngine.create({
      vault,
      store: new ObsidianKeywordIndexStore(host),
    });

    expect(reloadedEngine.toPersisted()).toEqual(persistedBeforeReload);
  });
});

describe('ObsidianKeywordIndexStore + KeywordIndexEngine — delete and rebuild (C2.4, end to end)', () => {
  it('deleting the stored key and rebuilding reproduces the same persisted index, field for field', async () => {
    const host = new FakeDataHost();
    const vault = new FolderSource(root);

    const engine = await KeywordIndexEngine.create({
      vault,
      store: new ObsidianKeywordIndexStore(host),
    });
    await engine.rebuild();
    const before = engine.toPersisted();
    expect(before.documents).toHaveLength(2);
    expect(host.blob).not.toBeNull();

    // D-006: delete the whole cache — simulated here at the exact
    // granularity the store owns, its own top-level key inside the shared
    // blob, exactly what a real "clear plugin cache" action would remove.
    const blob = host.blob as Record<string, unknown>;
    delete blob.keywordIndex;
    expect(await new ObsidianKeywordIndexStore(host).load()).toBeNull();

    const rebuiltEngine = await KeywordIndexEngine.create({
      vault,
      store: new ObsidianKeywordIndexStore(host),
    });
    expect(rebuiltEngine.toPersisted()).toEqual({ version: 1, documents: [] });

    const result = await rebuiltEngine.rebuild();
    expect(result).toBe('complete');

    const after = rebuiltEngine.toPersisted();
    expect(after).toEqual(before);
    expect(await new ObsidianKeywordIndexStore(host).load()).toEqual(before);
  });
});
