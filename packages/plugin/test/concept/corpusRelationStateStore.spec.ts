/**
 * `ObsidianCorpusRelationStateStore` tests (`[EXT-11]`, `ol-kw4a`).
 *
 * Mirrors `test/concept/wiring.spec.ts`'s `FakeDataHost` — no `obsidian`
 * import.
 */
import { describe, expect, it } from 'vitest';
import {
  CORPUS_RELATION_STATE_STORAGE_KEY,
  ObsidianCorpusRelationStateStore,
} from '../../src/concept/corpusRelationStateStore.js';

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

describe('ObsidianCorpusRelationStateStore', () => {
  it('reads an empty state when nothing has ever been saved', async () => {
    const store = new ObsidianCorpusRelationStateStore(new FakeDataHost());
    expect(await store.load()).toEqual({ knownConceptNames: [] });
  });

  it('reads back exactly what was saved', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianCorpusRelationStateStore(host);

    await store.save({ knownConceptNames: ['Type I error', 'Type II error'] });

    expect(await store.load()).toEqual({ knownConceptNames: ['Type I error', 'Type II error'] });
  });

  it('namespaces under its own key, preserving whatever else data.json holds', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: 'untouched' };
    const store = new ObsidianCorpusRelationStateStore(host);

    await store.save({ knownConceptNames: ['A'] });

    expect(host.blob).toEqual({
      someOtherPluginSetting: 'untouched',
      [CORPUS_RELATION_STATE_STORAGE_KEY]: { knownConceptNames: ['A'] },
    });
  });

  it('treats a corrupted entry as "nothing known yet" rather than throwing', async () => {
    const host = new FakeDataHost();
    host.blob = { [CORPUS_RELATION_STATE_STORAGE_KEY]: { knownConceptNames: 'not an array' } };
    const store = new ObsidianCorpusRelationStateStore(host);

    expect(await store.load()).toEqual({ knownConceptNames: [] });
  });
});
