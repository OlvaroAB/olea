/**
 * `ObsidianCorpusRelationStateStore` — persisted "which concepts has the
 * corpus-level relation stage already accounted for" bookkeeping
 * (`[EXT-11]` `ol-kw4a`), over Obsidian's `loadData`/`saveData`. Same shape
 * as `../ingestion/queue-store.ts`'s `ObsidianQueueStore` and for the same
 * two reasons: unit-testable in plain Node against a fake host, and a
 * documented narrow contract rather than the whole `Plugin` surface.
 *
 * **What this is for.** `shouldRunCorpusRelationBatch`'s concept-count
 * boundary needs "how many concepts are new since the corpus stage last
 * ran" — a number nothing else in this plugin currently tracks, because
 * there is no persisted concept registry yet (component register's
 * registry rows are still unbuilt). This store holds the minimum needed to
 * compute that count without one: the set of concept names already seen as
 * of the last corpus-stage run. It is client-side plugin cache, the same
 * category as `ObsidianQueueStore`'s persisted queue or the embedding
 * cache — never a copy of her content, and rebuildable from a fresh concept
 * read at any time (a store with no ancestry is just "every concept counts
 * as new," which under-nominates once, not silently).
 *
 * **Namespacing, not ownership** — see `ObsidianQueueStore`'s own doc for
 * why a single top-level key inside `data.json` is used rather than
 * treating the blob as this store's alone.
 */

export interface CorpusRelationRunState {
  /** Concept names known as of the corpus stage's last run. Names, not identifiers — D-005 has no bearing here (nothing leaves the device), but there is still no reason to invent a second identity scheme. */
  readonly knownConceptNames: readonly string[];
}

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — see the module doc for why it's spelled out rather than imported. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const CORPUS_RELATION_STATE_STORAGE_KEY = 'corpusRelationState';

const EMPTY_STATE: CorpusRelationRunState = { knownConceptNames: [] };

function isCorpusRelationRunState(value: unknown): value is CorpusRelationRunState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['knownConceptNames']) &&
    candidate['knownConceptNames'].every((name) => typeof name === 'string')
  );
}

export class ObsidianCorpusRelationStateStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Never throws — a missing or corrupted entry reads as "nothing known yet," the same posture `ObsidianQueueStore.load` takes for a malformed queue. */
  async load(): Promise<CorpusRelationRunState> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return EMPTY_STATE;
    const candidate = (blob as Record<string, unknown>)[CORPUS_RELATION_STATE_STORAGE_KEY];
    return isCorpusRelationRunState(candidate) ? candidate : EMPTY_STATE;
  }

  /** Read-modify-write around this store's own key, preserving whatever else `data.json` holds. */
  async save(state: CorpusRelationRunState): Promise<void> {
    const blob = await this.host.loadData();
    const base = typeof blob === 'object' && blob !== null ? (blob as Record<string, unknown>) : {};
    await this.host.saveData({ ...base, [CORPUS_RELATION_STATE_STORAGE_KEY]: state });
  }
}
