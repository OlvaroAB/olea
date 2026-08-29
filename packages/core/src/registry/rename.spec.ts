/**
 * `features/F8-concepts-scope.md`'s `@auto:core/registry/rename.spec` —
 * "her old wording still resolves after the rename" (F8.4/`[D-088]`).
 *
 * `overrides.spec.ts` already covers the rename/prune transforms in
 * isolation; this file is specifically the clause those tests do not touch:
 * that the demoted alias `renameConcept` records is enough, on its own, to
 * (a) resolve old wording back to the same concept as the current name, and
 * (b) keep material written under the old wording matchable by a keyword
 * search built from the new one — `ol-l5og.11`'s wiring of
 * `../retrieval/aliasExpansion.ts` into `../retrieval/engine.ts`'s
 * `retrieve()`. C7.11's key is still provisional (`../concept/types.ts`) —
 * every assertion below equates NAMES via one run's `RegistryOverrides`,
 * never a key, exactly as `aliasEquivalenceGroups`'s own doc requires.
 */
import { describe, expect, it } from 'vitest';
import type { PersistedKeywordIndex } from '../keyword-index/types.js';
import { expandQueryWithAliases } from '../retrieval/aliasExpansion.js';
import { EmbeddingCacheEngine } from '../retrieval/embeddingCache.js';
import { retrieve } from '../retrieval/engine.js';
import type {
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
  PersistedEmbeddingCache,
} from '../retrieval/types.js';
import { aliasEquivalenceGroups, EMPTY_REGISTRY_OVERRIDES, renameConcept } from './overrides.js';

const CONCEPT_KEY = 'concept-key-1';
const OLD_NAME = 'Osmosis';
// Deliberately shares no token with OLD_NAME or with the fixture block text
// below ("swell"/"freshwater"/etc.) — a token overlap here would let a test
// pass on incidental keyword overlap rather than on the alias expansion
// actually under test (see the retrieve() suite's third case, which needs a
// query that matches NOTHING without expansion).
const NEW_NAME = 'Solute equalization';

function renamedOverrides() {
  return renameConcept(EMPTY_REGISTRY_OVERRIDES, CONCEPT_KEY, OLD_NAME, NEW_NAME);
}

describe('aliasEquivalenceGroups — resolving old wording reaches the same concept as the new one', () => {
  it('groups the current display name with every demoted alias, both directions', () => {
    const groups = aliasEquivalenceGroups(renamedOverrides());

    // "that old wording is resolved" — looking it up lands in a group that
    // also contains the concept's current name: both names resolve to the
    // same concept.
    expect(groups.get(OLD_NAME)).toContain(NEW_NAME);
    // And the reverse lookup, from the name she sees today, still finds the
    // one she used to use — a single equivalence class, not a one-way index.
    expect(groups.get(NEW_NAME)).toContain(OLD_NAME);
  });

  it('is empty for a concept never renamed — nothing to resolve, nothing to expand', () => {
    expect(aliasEquivalenceGroups(EMPTY_REGISTRY_OVERRIDES).size).toBe(0);
  });
});

describe('expandQueryWithAliases — the keyword-search half of the wiring', () => {
  it('adds the old wording to a query built from the new name', () => {
    const expanded = expandQueryWithAliases(`explain ${NEW_NAME}`, renamedOverrides());
    expect(expanded).toContain(OLD_NAME);
  });

  it('adds the new wording to a query built from the old name — the equivalence runs both ways', () => {
    const expanded = expandQueryWithAliases(`explain ${OLD_NAME}`, renamedOverrides());
    expect(expanded).toContain(NEW_NAME);
  });

  it('leaves a query untouched, by reference, when there is no rename history at all', () => {
    const query = 'explain something unrelated';
    expect(expandQueryWithAliases(query, EMPTY_REGISTRY_OVERRIDES)).toBe(query);
  });

  it('leaves a query untouched when it names no renamed concept', () => {
    const query = 'explain photosynthesis';
    expect(expandQueryWithAliases(query, renamedOverrides())).toBe(query);
  });
});

// --- retrieve() integration: the production caller this bead wires --------

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

/**
 * Always fails — forces `retrieve()` onto its documented keyword-only
 * degradation path (`engine.ts`'s module doc), so every assertion below is
 * about keyword/alias matching alone, never a semantic-similarity fixture's
 * own shape (unlike `engine.spec.ts`, nothing here needs a realistic
 * embedding space to make its point).
 */
class UnreachableEmbeddingProvider implements EmbeddingProvider {
  async embed(_request: EmbedRequest): Promise<EmbedResult> {
    throw new Error('embedding provider unreachable — keyword-only by construction');
  }
}

function index(docs: { path: string; blocks: string[] }[]): PersistedKeywordIndex {
  return {
    version: 1,
    documents: docs.map((doc) => ({
      path: doc.path,
      courses: [],
      contentHash: 'unused',
      blocks: doc.blocks.map((text, blockIndex) => ({
        blockIndex,
        kind: 'paragraph' as const,
        text,
      })),
    })),
  };
}

async function keywordOnlyDeps(idx: PersistedKeywordIndex) {
  const provider = new UnreachableEmbeddingProvider();
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider,
    model: 'fake-model-v1',
  });
  return { keywordIndex: idx, embeddingCache, embeddingProvider: provider };
}

describe('retrieve() — her old wording still resolves after the rename (F8.4, [D-088])', () => {
  it('matches material written before the rename when queried with her NEW wording, once registryOverrides is supplied', async () => {
    // The note was written, and never touched again, before she renamed the
    // concept — exactly the scenario's "material and notes she wrote before
    // the rename using the old name". Nothing about it is re-extracted.
    const deps = await keywordOnlyDeps(
      index([
        {
          path: 'course/notes.md',
          blocks: [`${OLD_NAME} explains why cells swell in freshwater.`],
        },
      ]),
    );

    const result = await retrieve({ ...deps, registryOverrides: renamedOverrides() }, NEW_NAME);

    expect(result.status).toBe('grounded');
    if (result.status === 'grounded') {
      expect(result.chunks[0]?.path).toBe('course/notes.md');
    }
  });

  it('still matches the same material when queried with her OLD wording — both queries reach the same concept', async () => {
    const deps = await keywordOnlyDeps(
      index([
        {
          path: 'course/notes.md',
          blocks: [`${OLD_NAME} explains why cells swell in freshwater.`],
        },
      ]),
    );

    const result = await retrieve({ ...deps, registryOverrides: renamedOverrides() }, OLD_NAME);

    expect(result.status).toBe('grounded');
  });

  it('refuses the same NEW-wording query when registryOverrides is omitted — proves the alias wiring, not something else, is what bridges the rename', async () => {
    const deps = await keywordOnlyDeps(
      index([
        {
          path: 'course/notes.md',
          blocks: [`${OLD_NAME} explains why cells swell in freshwater.`],
        },
      ]),
    );

    const result = await retrieve(deps, NEW_NAME);

    expect(result.status).toBe('refused');
  });
});
