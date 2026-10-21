/**
 * `[D-368]` / F3.7 (`ol-egov.141.89.105.28`): a sweep composed through `buildGenerationWiring`
 * supplies the drain-order signal itself, from a priority source refreshed before the sweep, so the
 * cap is spent on the concept with the greater current need. A review-log read that fails leaves the
 * sweep in the rotation's order and drafting running. Every fixture string is invented; the
 * concept names are the order's only witness, read off the retrieval's embedding queries; nothing
 * touches the network.
 */
import {
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
  type ExtractedUnit,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  REVIEW_LOG_FOLDER,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildGenerationWiring } from '../../src/generation/wiring.js';
import { MemoryVaultSource } from './fakes.js';

const COURSE = 'TESTA101';
const NOTE = `01 Courses/${COURSE}/Week 1.md`;
const NAMES = ['alpha', 'beta', 'gamma', 'delta'];
const NOW = new Date('2026-01-10T09:00:00');

class MemoryStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load() {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache) {
    this.saved = cache;
  }
}

/** Records every text it is asked to embed; the concept names among them are the sweep's call order. */
class RecordingProvider implements EmbeddingProvider {
  readonly texts: string[] = [];
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    this.texts.push(...request.texts);
    return { vectors: request.texts.map(() => [1, 0]) };
  }
}

const unit: ExtractedUnit = {
  text: 'unused',
  provenance: { sourcePath: NOTE, location: { page: 1, charRange: { start: 0, end: 1 } } },
};

async function world(vault: VaultSource) {
  const provider = new RecordingProvider();
  const keywordIndex: PersistedKeywordIndex = {
    version: 1,
    documents: [
      {
        path: NOTE,
        courses: [COURSE],
        contentHash: 'unused',
        blocks: [{ blockIndex: 0, kind: 'paragraph', text: 'Some invented passage.' }],
      },
    ],
  };
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryStore(),
    provider,
    model: 'fake-model-v1',
  });
  const transport = {
    send: async (): Promise<unknown> => {
      throw new Error('no generation call is expected');
    },
  };
  const draftDeps = {
    retrieve: { keywordIndex, embeddingCache, embeddingProvider: provider },
    transport,
  };
  const wiring = buildGenerationWiring({ vault, deviceId: 'device-a', now: () => NOW });
  const asked = () => provider.texts.filter((t) => NAMES.includes(t));
  return { wiring, draftDeps, asked };
}

const noteVault = () =>
  new MemoryVaultSource({
    [NOTE]: `---\ntopic: [${NAMES.join(', ')}]\ncourse: ${COURSE}\n---\n\n# Week 1\n\nSome invented prose.\n`,
  });

describe('the sweep composition supplies the drain-order signal (ol-egov.141.89.105.28)', () => {
  it('a higher-need concept is drafted before an alphabetically earlier one under the cap', async () => {
    const vault = noteVault();
    const { wiring, draftDeps, asked } = await world(vault);
    const concepts = await wiring.listConceptsForCourse(COURSE);
    // Every concept but the last in name order is recently recalled, so the untouched one is the
    // one in greatest need.
    const untouched = 'delta';
    const records = concepts
      .filter((concept) => concept.name !== untouched)
      .map((concept, i) => ({
        schemaVersion: 6,
        kind: 'review',
        eventId: `r-${i}`,
        timestamp: '2026-01-09T09:00:00-04:00',
        instrumentId: `qa:${concept.key}:1`,
        instrumentType: 'qa',
        conceptIds: [concept.key],
        rating: 'good',
        wasUnsure: false,
        durationMs: 1200,
        supportLevelShown: 'independent',
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      }));
    await vault.write(
      `${REVIEW_LOG_FOLDER}/wiring-drain-order-spec.jsonl`,
      records.map((r) => JSON.stringify(r)).join('\n'),
    );

    await wiring.sweep([unit], draftDeps);

    expect(asked()[0]).toBe(untouched);
  });

  it('a review-log read that fails leaves the sweep running in the rotation order', async () => {
    const base = noteVault();
    const failing: VaultSource = Object.create(base);
    failing.list = async (...args: Parameters<VaultSource['list']>) => {
      if (String(args[0]).startsWith(REVIEW_LOG_FOLDER)) throw new Error('read failed');
      return base.list(...args);
    };
    const { wiring, draftDeps, asked } = await world(failing);

    const report = await wiring.sweep([unit], draftDeps);

    expect(report).not.toBeNull();
    expect(asked().slice(0, 3)).toEqual(['alpha', 'beta', 'delta']);
  });
});
