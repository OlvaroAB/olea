/**
 * `ol-egov.141.89.5.26` ([D-414], `ol-egov.141.89.48`): the demand-grain re-ask on arrival. Three
 * layers, each proven where it lives, and no test calls a model (the transport is a fake that
 * records every send; a test that must not reach the service asserts the recorded sends are none):
 *
 *  1. the ASK, over the real evidence gate (`retrieve` with the band, the composite veto and the
 *     real `WorkerGroundingJudge`), so the re-check goes through the existing, ruled call path and
 *     keeps the gate's outcomes apart (client c4cb3e4, [D-441], [D-442]);
 *  2. the RUNNER, which turns the feed's arrival signal into one serial, coalesced pass and keeps a
 *     re-check that could not run beside its row with its own reason;
 *  3. the REAL ARRIVAL PATH, the processed-revision feed, end to end.
 *
 * Every string here is invented (INV-3).
 */
import {
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
  hashText,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  type RetrieveDeps,
  type VaultPath,
  type WorkerTaskRequest,
} from 'olea-core';
import {
  fingerprintJudgedEvidence,
  type ReaskOnArrivalDeps,
  type SufficiencyAnswer,
  type SufficiencyRecord,
} from 'olea-core/src/gap/demand-gap.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createDemandGapReask,
  createRetrievalSufficiencyAsk,
} from '../../src/gap/demand-gap-reask.js';
import { createProcessedRevisionFeed } from '../../src/ingestion/processed-revisions/feed.js';
import { ObsidianProcessedRevisionStore } from '../../src/ingestion/processed-revisions/store.js';
import { memoryVault } from '../review/memory-vault.js';

// ---- the orthogonal fixture (the shape draft-quiz-cards.spec.ts uses, for the same reason) ----

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

class LookupEmbeddingProvider implements EmbeddingProvider {
  private readonly vectors = new Map<string, readonly number[]>();
  register(text: string, vector: readonly number[]): void {
    this.vectors.set(text, vector);
  }
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return {
      vectors: request.texts.map((text) => {
        const vector = this.vectors.get(text);
        if (!vector) throw new Error(`no vector registered for ${JSON.stringify(text)}`);
        return vector;
      }),
    };
  }
}

function indexOf(
  docs: readonly { path: string; blocks: readonly string[] }[],
): PersistedKeywordIndex {
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

const FILLER_COUNT = 100;
const DIM = 2 + FILLER_COUNT;
const CONCEPT_NAME = 'mitochondria';
const TARGET_TEXT = 'Mitochondria is the powerhouse of the cell and drives cellular respiration.';
const TARGET_PATH = 'course/mitochondria-lecture.md';

function unitVector(position: number): number[] {
  const vector = new Array(DIM).fill(0);
  vector[position] = 1;
  return vector;
}

function buildFixture(targetCosine: number, targetText = TARGET_TEXT) {
  const provider = new LookupEmbeddingProvider();
  const residual = Math.sqrt(Math.max(0, 1 - targetCosine * targetCosine));
  provider.register(targetText, unitVector(0));
  provider.register(
    CONCEPT_NAME,
    unitVector(0).map((component, i) => component * targetCosine + (i === 1 ? residual : 0)),
  );
  const filler: { path: string; blocks: readonly string[] }[] = [];
  for (let i = 0; i < FILLER_COUNT; i++) {
    const text = `unrelated filler passage number ${i} about an unrelated topic`;
    provider.register(text, unitVector(2 + i));
    filler.push({ path: `filler/${i}.md`, blocks: [text] });
  }
  return {
    keywordIndex: indexOf([{ path: TARGET_PATH, blocks: [targetText] }, ...filler]),
    provider,
  };
}

async function retrieveDeps(
  keywordIndex: PersistedKeywordIndex,
  provider: LookupEmbeddingProvider,
): Promise<RetrieveDeps> {
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider,
    model: 'fake-model-v1',
  });
  return { keywordIndex, embeddingCache, embeddingProvider: provider };
}

const STAMP = { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' };

function fakeTransport(judge?: (request: WorkerTaskRequest) => unknown) {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest): Promise<unknown> => {
      calls.push(request);
      if (judge !== undefined) return judge(request);
      return { ok: true, stamp: STAMP, result: { supported: true, reason: 'covers it' } };
    },
  };
}
const verdict = (supported: boolean) => () => ({
  ok: true,
  stamp: STAMP,
  result: { supported, reason: 'stated verdict' },
});

// `D112_GROUNDING_BAND` is lower 0.555 / upper 0.800; the composite's own top1 bar is 0.545.
const ABOVE_BAND = 1.0;
const IN_BAND = 0.65;
const BELOW_BAND_ONLY = 0.55;

const CONCEPT = { conceptKey: 'concept-a', conceptName: CONCEPT_NAME, course: 'CRS-A' };

function askRequest(overrides: { previousFingerprint?: string } = {}) {
  return {
    concept: CONCEPT,
    demand: 'calculate' as const,
    previousFingerprint: 'stored-fingerprint',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. The ask, over the real evidence gate
// ---------------------------------------------------------------------------

describe('createRetrievalSufficiencyAsk: the re-check goes through the existing, ruled call path', () => {
  it('a supported verdict is a sufficient verdict carrying the fingerprint of what the judge read', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND);
    const transport = fakeTransport(verdict(true));
    const ask = createRetrievalSufficiencyAsk({
      retrieve: await retrieveDeps(keywordIndex, provider),
      transport,
    });

    const answer = await ask(askRequest());

    const expected = await fingerprintJudgedEvidence(
      { refs: [{ path: TARGET_PATH as VaultPath, blockIndex: 0 }], context: TARGET_TEXT },
      hashText,
    );
    expect(answer).toEqual({
      kind: 'verdict',
      verdict: 'sufficient',
      evidenceFingerprint: expected,
    });
  });

  it('asks the sufficiency question only: one grounding.judge.v1 send carrying the demand as the intended operation, and never a generative call', async () => {
    const { keywordIndex, provider } = buildFixture(IN_BAND);
    const transport = fakeTransport(verdict(true));
    const ask = createRetrievalSufficiencyAsk({
      retrieve: await retrieveDeps(keywordIndex, provider),
      transport,
    });

    await ask(askRequest());

    expect(transport.calls.map((call) => call.taskId)).toEqual(['grounding.judge.v1']);
    expect(transport.calls[0]?.payload).toMatchObject({
      query: CONCEPT_NAME,
      intendedOperation: 'calculate',
    });
  });

  it('judge-rejected is the only insufficiency: the judge read the passages and found them not enough', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND);
    const ask = createRetrievalSufficiencyAsk({
      retrieve: await retrieveDeps(keywordIndex, provider),
      transport: fakeTransport(verdict(false)),
    });

    const answer = await ask(askRequest());

    expect(answer).toMatchObject({ kind: 'verdict', verdict: 'insufficient' });
    expect((answer as { evidenceFingerprint: string }).evidenceFingerprint).not.toBe('');
  });

  it('when the evidence is the evidence the stored verdict was asked over, the judge is never called', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND);
    const stored = await fingerprintJudgedEvidence(
      { refs: [{ path: TARGET_PATH as VaultPath, blockIndex: 0 }], context: TARGET_TEXT },
      hashText,
    );
    const transport = fakeTransport(verdict(true));
    const ask = createRetrievalSufficiencyAsk({
      retrieve: await retrieveDeps(keywordIndex, provider),
      transport,
    });

    const answer = await ask(askRequest({ previousFingerprint: stored }));

    expect(answer).toEqual({ kind: 'evidence-unchanged' });
    expect(transport.calls).toEqual([]);
  });

  it('when the evidence differs from what the stored verdict was asked over, the judge is asked again', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND, `${TARGET_TEXT} A new sentence.`);
    const stored = await fingerprintJudgedEvidence(
      { refs: [{ path: TARGET_PATH as VaultPath, blockIndex: 0 }], context: TARGET_TEXT },
      hashText,
    );
    const transport = fakeTransport(verdict(true));
    const ask = createRetrievalSufficiencyAsk({
      retrieve: await retrieveDeps(keywordIndex, provider),
      transport,
    });

    const answer = await ask(askRequest({ previousFingerprint: stored }));

    expect(transport.calls).toHaveLength(1);
    expect(answer).toMatchObject({ kind: 'verdict', verdict: 'sufficient' });
  });

  it('below the band is threshold-blocked and not assessed: nothing is sent, and it is not an insufficiency', async () => {
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_ONLY);
    const transport = fakeTransport(verdict(false));
    const ask = createRetrievalSufficiencyAsk({
      retrieve: await retrieveDeps(keywordIndex, provider),
      transport,
    });

    expect(await ask(askRequest())).toEqual({ kind: 'not-run', reason: 'threshold-blocked' });
    expect(transport.calls).toEqual([]);
  });

  it('an empty index is a retrieval failure: nothing is sent, and it is not an insufficiency', async () => {
    const provider = new LookupEmbeddingProvider();
    provider.register(CONCEPT_NAME, unitVector(0));
    const transport = fakeTransport(verdict(false));
    const ask = createRetrievalSufficiencyAsk({
      retrieve: await retrieveDeps(indexOf([]), provider),
      transport,
    });

    expect(await ask(askRequest())).toEqual({ kind: 'not-run', reason: 'retrieval-failed' });
    expect(transport.calls).toEqual([]);
  });

  it('an unreachable judge is an outage, never an insufficiency', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND);
    const ask = createRetrievalSufficiencyAsk({
      retrieve: await retrieveDeps(keywordIndex, provider),
      transport: fakeTransport(() => {
        throw new Error('network down');
      }),
    });

    expect(await ask(askRequest())).toEqual({ kind: 'not-run', reason: 'check-unavailable' });
  });

  it('a judge answer that is not a verdict is an outage too', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND);
    const ask = createRetrievalSufficiencyAsk({
      retrieve: await retrieveDeps(keywordIndex, provider),
      transport: fakeTransport(() => ({ ok: true, stamp: STAMP, result: { unexpected: true } })),
    });

    expect(await ask(askRequest())).toEqual({ kind: 'not-run', reason: 'check-unavailable' });
  });

  it('a demand the judge request cannot carry is not asked at all, so evidence for no particular demand never stands in for it', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND);
    const transport = fakeTransport(verdict(true));
    const ask = createRetrievalSufficiencyAsk({
      retrieve: await retrieveDeps(keywordIndex, provider),
      transport,
    });

    const answer = await ask({
      concept: CONCEPT,
      demand: 'interpret-printed-result',
      previousFingerprint: 'stored-fingerprint',
    });

    expect(answer).toEqual({ kind: 'not-run', reason: 'demand-not-askable' });
    expect(transport.calls).toEqual([]);
  });

  it('a retrieval that throws is an outage for the caller to fold, never a rejection out of the ask', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND);
    const deps = await retrieveDeps(keywordIndex, provider);
    const ask = createRetrievalSufficiencyAsk({
      retrieve: {
        ...deps,
        keywordIndex: null as never,
      },
      transport: fakeTransport(verdict(true)),
    });

    expect(await ask(askRequest())).toEqual({ kind: 'not-run', reason: 'check-unavailable' });
  });
});

// ---------------------------------------------------------------------------
// 2. The runner
// ---------------------------------------------------------------------------

function record(overrides: Partial<SufficiencyRecord> = {}): SufficiencyRecord {
  return {
    conceptKey: 'concept-a',
    demand: 'calculate',
    verdict: 'insufficient',
    evidenceFingerprint: 'fp-1',
    ...overrides,
  };
}

type AskRequest = Parameters<ReaskOnArrivalDeps['ask']>[0];

function runnerHarness(
  initial: readonly SufficiencyRecord[],
  answer: (request: AskRequest) => SufficiencyAnswer | Promise<SufficiencyAnswer>,
) {
  const records = new Map(initial.map((r) => [`${r.conceptKey}|${r.demand}`, r]));
  const asked: string[] = [];
  const saves: SufficiencyRecord[] = [];
  const passes: string[][] = [];
  const deps: ReaskOnArrivalDeps = {
    listRecords: async () => {
      passes.push([]);
      return [...records.values()];
    },
    saveRecord: async (next) => {
      saves.push(next);
      records.set(`${next.conceptKey}|${next.demand}`, next);
    },
    resolveConcept: (conceptKey) => ({
      conceptKey,
      conceptName: `name of ${conceptKey}`,
      course: conceptKey === 'concept-b' ? 'CRS-B' : 'CRS-A',
    }),
    ask: async (request) => {
      asked.push(request.concept.conceptKey);
      return answer(request);
    },
  };
  const reask = createDemandGapReask(deps);
  return { reask, records, asked, saves, passes };
}

/** Lets the event loop turn until `condition` holds, so a test never guesses how many microtasks a step takes. */
async function until(condition: () => boolean): Promise<void> {
  for (let turns = 0; turns < 200 && !condition(); turns += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  expect(condition()).toBe(true);
}

const ARRIVAL = {
  path: 'a/deck.pdf' as VaultPath,
  courses: ['CRS-A'],
  fingerprint: 'h',
  state: 'read',
} as const;

describe('createDemandGapReask: an arrival asks again for the concepts it bears on', () => {
  it('re-asks the concept holding an open verdict in the arriving course, saves a sufficient verdict, and leaves the other course alone', async () => {
    const h = runnerHarness([record(), record({ conceptKey: 'concept-b' })], () => ({
      kind: 'verdict',
      verdict: 'sufficient',
      evidenceFingerprint: 'fp-2',
    }));
    h.reask.onArrival(ARRIVAL);
    await h.reask.idle();
    expect(h.asked).toEqual(['concept-a']);
    expect(h.saves).toEqual([record({ verdict: 'sufficient', evidenceFingerprint: 'fp-2' })]);
  });

  it.each(['pending', 'unreadable'] as const)(
    'a %s revision is not material yet: nothing is asked',
    async (state) => {
      const h = runnerHarness([record()], () => {
        throw new Error('must not be asked');
      });
      h.reask.onArrival({ ...ARRIVAL, state });
      await h.reask.idle();
      expect(h.asked).toEqual([]);
      expect(h.passes).toEqual([]);
    },
  );

  it('arrivals that land before a pass starts share one pass, and arrivals during a pass earn exactly one more', async () => {
    let releaseFirst: () => void = () => undefined;
    let first = true;
    const h = runnerHarness([record()], async () => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return { kind: 'evidence-unchanged' };
    });
    h.reask.onArrival(ARRIVAL);
    h.reask.onArrival({ ...ARRIVAL, path: 'a/other.pdf' as VaultPath });
    await until(() => h.asked.length === 1);
    // The first pass is now waiting inside its ask; more arrivals come in behind it.
    h.reask.onArrival({ ...ARRIVAL, path: 'a/third.pdf' as VaultPath });
    h.reask.onArrival({ ...ARRIVAL, path: 'a/fourth.pdf' as VaultPath });
    releaseFirst();
    await h.reask.idle();
    expect(h.passes).toHaveLength(2);
    expect(h.asked).toEqual(['concept-a', 'concept-a']);
  });

  it('a re-check that could not run is kept beside its row with its own reason and writes nothing, and a later answer clears it', async () => {
    const answers: Parameters<ReaskOnArrivalDeps['ask']>[0][] = [];
    let next: 'threshold' | 'sufficient' = 'threshold';
    const h = runnerHarness([record()], (request) => {
      answers.push(request);
      return next === 'threshold'
        ? { kind: 'not-run', reason: 'threshold-blocked' }
        : { kind: 'verdict', verdict: 'sufficient', evidenceFingerprint: 'fp-2' };
    });
    expect(h.reask.notRunFor('concept-a', 'calculate')).toBeUndefined();

    h.reask.onArrival(ARRIVAL);
    await h.reask.idle();
    expect(h.reask.notRunFor('concept-a', 'calculate')).toEqual({ reason: 'threshold-blocked' });
    expect(h.saves).toEqual([]);
    expect(h.records.get('concept-a|calculate')?.verdict).toBe('insufficient');

    next = 'sufficient';
    h.reask.onArrival({ ...ARRIVAL, path: 'a/again.pdf' as VaultPath });
    await h.reask.idle();
    expect(h.reask.notRunFor('concept-a', 'calculate')).toBeUndefined();
    expect(h.records.get('concept-a|calculate')?.verdict).toBe('sufficient');
  });

  it('an outage and a threshold each keep their own reason, and neither ever flips the row', async () => {
    for (const reason of [
      'threshold-blocked',
      'retrieval-failed',
      'check-unavailable',
      'could-not-decide',
      'demand-not-askable',
    ] as const) {
      const h = runnerHarness([record({ verdict: 'partial' })], () => ({
        kind: 'not-run',
        reason,
      }));
      h.reask.onArrival(ARRIVAL);
      await h.reask.idle();
      expect(h.reask.notRunFor('concept-a', 'calculate')).toEqual({ reason });
      expect(h.records.get('concept-a|calculate')?.verdict).toBe('partial');
      expect(h.saves).toEqual([]);
    }
  });

  it('an ask that throws is an outage for that record, and the runner keeps going', async () => {
    const h = runnerHarness([record()], () => {
      throw new Error('transport down');
    });
    h.reask.onArrival(ARRIVAL);
    await h.reask.idle();
    expect(h.reask.notRunFor('concept-a', 'calculate')).toEqual({ reason: 'check-unavailable' });
    // and a second arrival is still processed
    h.reask.onArrival({ ...ARRIVAL, path: 'a/again.pdf' as VaultPath });
    await h.reask.idle();
    expect(h.asked).toHaveLength(2);
  });

  it('never throws and never logs a path, a course or a concept name, even when the store fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reask = createDemandGapReask({
      listRecords: async () => {
        throw new Error('unreadable: a/secret-name.md');
      },
      saveRecord: async () => undefined,
      resolveConcept: () => undefined,
      ask: async () => ({ kind: 'evidence-unchanged' }),
    });
    reask.onArrival({ ...ARRIVAL, path: 'a/secret-name.md' as VaultPath });
    await reask.idle();
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).not.toContain('secret-name');
    expect(logged).not.toContain('CRS-A');
    errors.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. The real arrival path: the processed-revision feed
// ---------------------------------------------------------------------------

describe('the real arrival path: a processed revision through the feed re-asks, and nothing else moves', () => {
  class FakeDataHost {
    blob: Record<string, unknown> = {};
    async loadData(): Promise<unknown> {
      return this.blob;
    }
    async saveData(data: unknown): Promise<void> {
      this.blob = data as Record<string, unknown>;
    }
  }

  it('a note that clears the free checks asks again for a concept holding an open verdict in its course, once', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianProcessedRevisionStore(host, () => new Date('2026-08-01T12:00:00'));
    const vault = memoryVault({});
    const feed = createProcessedRevisionFeed({ store, vault, manifestsFor: async () => new Map() });
    const h = runnerHarness([record()], () => ({
      kind: 'verdict',
      verdict: 'sufficient',
      evidenceFingerprint: 'fp-2',
    }));
    feed.subscribe(h.reask.onArrival);
    await feed.start();

    await feed.noteEvaluated('01 Courses/CRS-A/week 1.md', 'Some invented lecture text.', {
      kind: 'verdict',
    });
    await h.reask.idle();
    expect(h.asked).toEqual(['concept-a']);
    expect(h.records.get('concept-a|calculate')?.verdict).toBe('sufficient');

    // The same version again is not an arrival.
    await feed.noteEvaluated('01 Courses/CRS-A/week 1.md', 'Some invented lecture text.', {
      kind: 'verdict',
    });
    await h.reask.idle();
    expect(h.asked).toEqual(['concept-a']);

    // A note in another course does not bear on this concept.
    await feed.noteEvaluated('01 Courses/CRS-B/week 1.md', 'Other invented text.', {
      kind: 'verdict',
    });
    await h.reask.idle();
    expect(h.asked).toEqual(['concept-a']);
  });
});
