/**
 * `heading-offer.ts` tests (F2.10, `[D-170]`/`[GEN-2]`, `ol-0r92.27`,
 * `ol-0r92.23`).
 *
 * INV-3: every heading, course, concept and question below is invented for
 * this suite — none copied from `docs/design/pass1/` or any real vault.
 *
 * Three things this file proves, one per `describe` block:
 * 1. **Accept drafts through the real per-concept path** and caches a
 *    `status: 'pending'` `DraftRecord` per question, keyed on the caller-
 *    resolved `ConceptRecord.key` (never the display name) — indistinguishable
 *    in the cache from a sweep-drafted record.
 * 2. **A refusal and an unparseable response are honest, non-throwing
 *    outcomes** — nothing is cached either way.
 * 3. **Dismiss persists nothing**: the vault is never written, and the
 *    dismissal is visible only through `isDismissed` on the SAME port
 *    instance (a fresh port remembers nothing).
 */
import {
  type ConceptRecord,
  DemandRoutingCounter,
  type HeadingOfferCandidate,
  INSTRUMENT_TARGET_STORE_FOLDER,
  instrumentTargetStorePath,
  parseMcqBlocks,
  readInstrumentDemand,
  readInstrumentTarget,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import {
  demandRoutingCounterFor,
  draftDemandRefusalCounterFor,
} from '../../src/generation/pipeline.js';
import { describeRefusal } from '../../src/retrieval/draft-cards-copy.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsRequest,
  DraftQuizCardsResult,
} from '../../src/retrieval/draft-quiz-cards.js';
import {
  createHeadingOfferPort,
  type HeadingOfferContext,
} from '../../src/review/heading-offer.js';
import { MemoryVaultSource } from '../generation/fakes.js';

const NOTE_PATH = '01 Courses/COGS214/Week 2.md';
const NOW = new Date('2026-09-02T10:00:00-07:00');

function candidateFixture(overrides: Partial<HeadingOfferCandidate> = {}): HeadingOfferCandidate {
  return {
    headingText: 'Does chunking extend working memory capacity?',
    level: 2,
    blockIndex: 3,
    headingStart: 120,
    headingEnd: 168,
    coverageEnd: 400,
    rule: 'yes-no-inversion',
    ...overrides,
  };
}

function conceptFixture(overrides: Partial<ConceptRecord> = {}): ConceptRecord {
  return {
    key: 'concept-key-chunking',
    name: 'Chunking',
    tier: 1,
    courses: ['COGS214'],
    sourcePaths: [NOTE_PATH],
    ...overrides,
  };
}

function contextFixture(overrides: Partial<HeadingOfferContext> = {}): HeadingOfferContext {
  return {
    courseCode: 'COGS214',
    concept: conceptFixture(),
    sourcePath: NOTE_PATH,
    ...overrides,
  };
}

function draftedResult(questionCount: number): DraftQuizCardsResult {
  return {
    status: 'drafted',
    request: {
      courseCode: 'COGS214',
      conceptName: 'Chunking',
      sourceChunks: ['her prose about chunking'],
      personalization: { voiceExemplars: { phrasing: [], terminology: [] } },
    },
    response: {
      ok: true,
      stamp: { promptVersion: '1.0.0', modelId: 'test-model' },
      result: {
        questions: Array.from({ length: questionCount }, (_, i) => ({
          stem: `Stem ${i}`,
          correctAnswer: 'Correct',
          distractors: ['A', 'B', 'C', 'D'],
          feedback: 'Feedback',
        })),
      },
    },
  };
}

function setUp(
  draftForConcept: (
    deps: DraftQuizCardsDeps,
    request: DraftQuizCardsRequest,
  ) => Promise<DraftQuizCardsResult>,
) {
  const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
  const cache = createVaultDraftCacheStore(vault);
  const port = createHeadingOfferPort({
    // Never actually read — `draftForConcept` intercepts every call in
    // this suite, matching `pipeline.spec.ts`'s own posture for the
    // identical injectable seam.
    draftDeps: () => ({}) as DraftQuizCardsDeps,
    cache,
    now: () => NOW,
    draftForConcept,
  });
  return { vault, cache, port };
}

describe('accept — F2.10/[D-170]: creates the draft through the real per-concept path', () => {
  it('caches one pending DraftRecord per drafted question, keyed on the opaque concept key', async () => {
    let calledWith: DraftQuizCardsRequest | null = null;
    const { cache, port } = setUp(async (_deps, request) => {
      calledWith = request;
      return draftedResult(2);
    });

    const outcome = await port.accept(candidateFixture(), contextFixture());

    expect(outcome.kind).toBe('drafted');
    if (outcome.kind !== 'drafted') throw new Error('unreachable');
    expect(outcome.draftIds).toHaveLength(2);

    // The SAME request shape the automatic sweep sends — courseCode and
    // conceptName, nothing heading-specific — proving this calls the real
    // generation entry point rather than a heading-scoped reimplementation.
    expect(calledWith).toEqual({ courseCode: 'COGS214', conceptName: 'Chunking' });

    for (const draftId of outcome.draftIds) {
      const record = await cache.get(draftId);
      expect(record).not.toBeNull();
      expect(record?.status).toBe('pending');
      expect(record?.conceptIds).toEqual(['concept-key-chunking']);
      expect(record?.courseCode).toBe('COGS214');
      expect(record?.sourcePath).toBe(NOTE_PATH);
      expect(record?.instrumentId).toBeUndefined();
      // `ol-3ux7.64.9` [WBX-8]: `setUp`'s injected `now: () => NOW` reaches
      // the cached record's own timestamp, not just real wall time.
      expect(record?.createdAt).toBe(NOW.toISOString());
    }

    const pending = await cache.listPending();
    expect(pending).toHaveLength(2);
  });

  it('a refusal is a real outcome, not an error, and caches nothing', async () => {
    const { cache, port } = setUp(async () => ({ status: 'refused', reason: 'below-band' }));

    const outcome = await port.accept(candidateFixture(), contextFixture());

    expect(outcome).toMatchObject({ kind: 'refused', reason: 'below-band' });
    if (outcome.kind === 'refused') {
      expect(outcome.copy.headline.length).toBeGreaterThan(0);
    }
    expect(await cache.listPending()).toHaveLength(0);
  });

  // D-441 (ruled 2026-09-29) and D-289: each specific reason survives to the
  // caller with its own classification, and only a judge rejection is worded
  // as her notes falling short.
  const REFUSAL_CASES = [
    { reason: 'no-hits', outcome: 'retrieval-failure', insufficiency: false },
    { reason: 'below-relevance-threshold', outcome: 'retrieval-failure', insufficiency: false },
    { reason: 'below-composite-threshold', outcome: 'threshold-blocked', insufficiency: false },
    { reason: 'below-band', outcome: 'threshold-blocked', insufficiency: false },
    { reason: 'judge-rejected', outcome: 'source-insufficient', insufficiency: true },
    { reason: 'judge-unavailable', outcome: 'service-failure', insufficiency: false },
    { reason: 'composite-check-unavailable', outcome: 'service-failure', insufficiency: false },
  ] as const;

  for (const { reason, outcome: expectedOutcome, insufficiency } of REFUSAL_CASES) {
    it(`a ${reason} refusal keeps its own reason and reads as ${expectedOutcome}${insufficiency ? '' : ', never as her notes falling short'}`, async () => {
      const { cache, port } = setUp(async () => ({ status: 'refused', reason }));

      const outcome = await port.accept(candidateFixture(), contextFixture());

      expect(outcome).toMatchObject({ kind: 'refused', reason });
      if (outcome.kind !== 'refused') throw new Error('unreachable');
      expect(outcome.copy.outcome).toBe(expectedOutcome);
      const claimsShortfall = /enough|grounding/i.test(outcome.copy.headline);
      expect(claimsShortfall).toBe(insufficiency);
      expect(await cache.listPending()).toHaveLength(0);
    });
  }

  it('an unparseable response caches nothing', async () => {
    const { cache, port } = setUp(async () => ({
      status: 'drafted',
      request: {
        courseCode: 'COGS214',
        conceptName: 'Chunking',
        sourceChunks: [],
        personalization: { voiceExemplars: { phrasing: [], terminology: [] } },
      },
      response: { ok: false, error: 'malformed' },
    }));

    const outcome = await port.accept(candidateFixture(), contextFixture());

    expect(outcome).toMatchObject({ kind: 'unparseable' });
    expect(await cache.listPending()).toHaveLength(0);
  });

  it('a drafted response with zero questions is reported unparseable, not a silent no-op', async () => {
    const { cache, port } = setUp(async () => draftedResult(0));

    const outcome = await port.accept(candidateFixture(), contextFixture());

    expect(outcome).toMatchObject({ kind: 'unparseable' });
    expect(await cache.listPending()).toHaveLength(0);
  });

  it('F7.8: no Worker connection reports not-configured and never calls draftForConcept', async () => {
    let called = false;
    const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
    const cache = createVaultDraftCacheStore(vault);
    const port = createHeadingOfferPort({
      draftDeps: () => null,
      cache,
      now: () => NOW,
      draftForConcept: async () => {
        called = true;
        return draftedResult(1);
      },
    });

    const outcome = await port.accept(candidateFixture(), contextFixture());

    expect(outcome).toMatchObject({ kind: 'not-configured' });
    expect(called).toBe(false);
    expect(await cache.listPending()).toHaveLength(0);
  });
});

describe('dismiss — [D-170]: declines the offer itself, persists nothing (D7.1 authorises no field for it)', () => {
  it('writes nothing to the vault: the note is untouched and the draft cache stays empty', async () => {
    const { vault, cache, port } = setUp(async () => draftedResult(1));
    const candidate = candidateFixture();
    const before = vault.raw(NOTE_PATH);

    port.dismiss(candidate, NOTE_PATH);

    expect(vault.raw(NOTE_PATH)).toBe(before);
    expect(await cache.list()).toEqual([]);
  });

  it('isDismissed reflects the in-memory set on the SAME port only', () => {
    const { port } = setUp(async () => draftedResult(1));
    const candidate = candidateFixture();

    expect(port.isDismissed(candidate, NOTE_PATH)).toBe(false);
    port.dismiss(candidate, NOTE_PATH);
    expect(port.isDismissed(candidate, NOTE_PATH)).toBe(true);

    // A fresh port (a reloaded plugin) remembers nothing — the honest shape
    // of "not persisted."
    const { port: freshPort } = setUp(async () => draftedResult(1));
    expect(freshPort.isDismissed(candidate, NOTE_PATH)).toBe(false);
  });

  it('a dismissal is scoped to (sourcePath, headingStart) — a different heading is unaffected', () => {
    const { port } = setUp(async () => draftedResult(1));
    const candidate = candidateFixture({ headingStart: 120 });
    const otherHeading = candidateFixture({ headingStart: 500 });

    port.dismiss(candidate, NOTE_PATH);

    expect(port.isDismissed(candidate, NOTE_PATH)).toBe(true);
    expect(port.isDismissed(otherHeading, NOTE_PATH)).toBe(false);
    expect(port.isDismissed(candidate, 'Other/Note.md')).toBe(false);
  });
});

/**
 * `[D-437]` (`ol-egov.141.89.2.20`), design `demand-carriage.md` §4.1, rows 35 and 37: the accept path
 * builds the ask from the heading (the whole heading and its question word are the primary request,
 * the mapping the secondary), routes it against `quiz.generate.v1`, sends the demand only when it was
 * served, and returns the routing on the outcome as data. Nothing student-visible changes: no copy,
 * no label, no held draft (design Open question 1).
 */
describe('accept — [D-437]: the heading offer carries the heading through routing and the request', () => {
  const SERVED_HEADING = 'What is chunking?';
  const DEFERRED_HEADING = 'How many items fit in working memory?';
  const UNDERSPECIFIED_HEADING = 'Why does chunking help recall?';

  it('a served heading sends the mapping and the whole heading with its question word (T3)', async () => {
    let calledWith: DraftQuizCardsRequest | null = null;
    const { port } = setUp(async (_deps, request) => {
      calledWith = request;
      return draftedResult(1);
    });

    const outcome = await port.accept(
      candidateFixture({ headingText: SERVED_HEADING, rule: 'wh-inversion' }),
      contextFixture(),
    );

    expect(calledWith).toEqual({
      courseCode: 'COGS214',
      conceptName: 'Chunking',
      intendedDemand: 'recall-a-fact',
      requestedAsk: { heading: SERVED_HEADING, questionWord: 'What' },
    });
    expect(outcome).toMatchObject({
      kind: 'drafted',
      demandRouting: {
        kind: 'served',
        demand: 'recall-a-fact',
        source: { heading: SERVED_HEADING, questionWord: 'What' },
      },
    });
    expect(outcome.unmetAsk).toBeUndefined();
  });

  it('a heading whose word no generator serves is recorded as unmet with the heading kept, and nothing about it is sent (T18)', async () => {
    let calledWith: DraftQuizCardsRequest | null = null;
    const { cache, port } = setUp(async (_deps, request) => {
      calledWith = request;
      return draftedResult(1);
    });

    const outcome = await port.accept(
      candidateFixture({ headingText: DEFERRED_HEADING, rule: 'wh-inversion' }),
      contextFixture(),
    );

    // The request is today's: no demand, no heading. The narrower practice is authored exactly as
    // an unspecified need is, and it is not the unserved ask.
    expect(calledWith).toEqual({ courseCode: 'COGS214', conceptName: 'Chunking' });
    // Today's presentation is unchanged: the draft is created and cached as before.
    expect(outcome.kind).toBe('drafted');
    expect(await cache.listPending()).toHaveLength(1);
    // The unmet ask travels on the outcome with its source, and is not served.
    expect(outcome.demandRouting).toEqual({
      kind: 'deferred',
      demand: 'calculate',
      source: { heading: DEFERRED_HEADING, questionWord: 'How' },
    });
    expect(outcome.unmetAsk).toEqual(outcome.demandRouting);
  });

  it('the cached draft of an unmet ask records no demand: nothing counts it as meeting the ask', async () => {
    const { cache, port } = setUp(async () => draftedResult(1));

    const outcome = await port.accept(
      candidateFixture({ headingText: DEFERRED_HEADING, rule: 'wh-inversion' }),
      contextFixture(),
    );

    if (outcome.kind !== 'drafted') throw new Error('unreachable');
    const record = await cache.get(outcome.draftIds[0] ?? '');
    const serialised = JSON.stringify(record);
    expect(serialised).not.toContain('calculate');
    expect(serialised).not.toContain(DEFERRED_HEADING);
    expect(serialised).not.toContain('declaredDemand');
    expect(serialised).not.toContain('intendedDemand');
  });

  it('a bare why is unspecified with its source kept, sends nothing, and is not called unsupported', async () => {
    let calledWith: DraftQuizCardsRequest | null = null;
    const { port } = setUp(async (_deps, request) => {
      calledWith = request;
      return draftedResult(1);
    });

    const outcome = await port.accept(
      candidateFixture({ headingText: UNDERSPECIFIED_HEADING, rule: 'wh-inversion' }),
      contextFixture(),
    );

    expect(calledWith).toEqual({ courseCode: 'COGS214', conceptName: 'Chunking' });
    expect(outcome.demandRouting).toEqual({
      kind: 'unspecified',
      reason: 'underspecified',
      source: { heading: UNDERSPECIFIED_HEADING, questionWord: 'Why' },
    });
    expect(outcome.unmetAsk).toBeUndefined();
  });

  it('a yes/no heading is unspecified with no question word, and the request is exactly the sweep-shaped one', async () => {
    let calledWith: DraftQuizCardsRequest | null = null;
    const { port } = setUp(async (_deps, request) => {
      calledWith = request;
      return draftedResult(1);
    });

    const outcome = await port.accept(candidateFixture(), contextFixture());

    expect(calledWith).toEqual({ courseCode: 'COGS214', conceptName: 'Chunking' });
    expect(outcome.demandRouting).toMatchObject({
      kind: 'unspecified',
      reason: 'underspecified',
      source: { questionWord: null },
    });
  });

  it('every outcome kind carries the routing: a refusal, an unparseable reply and not-configured', async () => {
    const heading = candidateFixture({ headingText: SERVED_HEADING, rule: 'wh-inversion' });
    const expected = {
      kind: 'served',
      demand: 'recall-a-fact',
      source: { heading: SERVED_HEADING, questionWord: 'What' },
    };

    const refused = await setUp(async () => ({
      status: 'refused',
      reason: 'judge-rejected',
    })).port.accept(heading, contextFixture());
    expect(refused).toMatchObject({ kind: 'refused', demandRouting: expected });
    // The refusal copy is unchanged by the demand (no new wording, no label).
    if (refused.kind !== 'refused') throw new Error('unreachable');
    expect(refused.copy).toEqual(describeRefusal('judge-rejected'));

    const unparseable = await setUp(async () => ({
      status: 'drafted',
      request: {
        courseCode: 'COGS214',
        conceptName: 'Chunking',
        sourceChunks: [],
      },
      response: { ok: false },
    })).port.accept(heading, contextFixture());
    expect(unparseable).toMatchObject({ kind: 'unparseable', demandRouting: expected });

    const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
    const notConfigured = await createHeadingOfferPort({
      draftDeps: () => null,
      cache: createVaultDraftCacheStore(vault),
      now: () => NOW,
    }).accept(heading, contextFixture());
    expect(notConfigured).toMatchObject({ kind: 'not-configured', demandRouting: expected });
  });

  it('counts each attempted ask per concept and per reason, and an unmet ask never counts as served', async () => {
    const counter = new DemandRoutingCounter();
    const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
    const port = createHeadingOfferPort({
      draftDeps: () => ({}) as DraftQuizCardsDeps,
      cache: createVaultDraftCacheStore(vault),
      now: () => NOW,
      draftForConcept: async () => draftedResult(1),
      demandCounter: counter,
    });

    await port.accept(candidateFixture({ headingText: SERVED_HEADING }), contextFixture());
    await port.accept(candidateFixture({ headingText: DEFERRED_HEADING }), contextFixture());
    await port.accept(candidateFixture({ headingText: DEFERRED_HEADING }), contextFixture());
    await port.accept(candidateFixture({ headingText: UNDERSPECIFIED_HEADING }), contextFixture());

    expect(counter.counts()).toEqual([
      { conceptKey: 'concept-key-chunking', reason: 'served', count: 1 },
      { conceptKey: 'concept-key-chunking', reason: 'no-generator-serves', count: 2 },
      { conceptKey: 'concept-key-chunking', reason: 'underspecified', count: 1 },
    ]);
    expect(counter.total('served')).toBe(1);
  });

  it('does not count an ask that was never attempted: no Worker connection', async () => {
    const counter = new DemandRoutingCounter();
    const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
    const port = createHeadingOfferPort({
      draftDeps: () => null,
      cache: createVaultDraftCacheStore(vault),
      now: () => NOW,
      demandCounter: counter,
    });

    await port.accept(candidateFixture({ headingText: SERVED_HEADING }), contextFixture());

    expect(counter.counts()).toEqual([]);
  });

  it('with no counter supplied, counts into the session counter the draft cache stands for', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
    const cache = createVaultDraftCacheStore(vault);
    const port = createHeadingOfferPort({
      draftDeps: () => ({}) as DraftQuizCardsDeps,
      cache,
      now: () => NOW,
      draftForConcept: async () => draftedResult(1),
    });

    await port.accept(candidateFixture({ headingText: SERVED_HEADING }), contextFixture());

    expect(demandRoutingCounterFor(cache).counts()).toEqual([
      { conceptKey: 'concept-key-chunking', reason: 'served', count: 1 },
    ]);
  });
});

/**
 * `[D-437]` (`ol-egov.141.89.2.30`), design `demand-carriage.md` sections 4.3, 4.4 and 6 (row 35, T6):
 * the heading offer stamps `DraftRecord.demand` on each draft it caches, from the request it sent
 * (the mapping AND the whole heading) and the response it got, so accepting the draft in review
 * writes the target record. The heading stays in the draft cache and never reaches the target record.
 */
describe('accept — [D-437]: the heading offer stamps the demand on each cached draft', () => {
  const SERVED_HEADING = 'What is chunking?';
  const DEFERRED_HEADING = 'How many items fit in working memory?';

  /** What a new Worker returns for the request it was sent: it echoes the request payload, acknowledges the demand, declares per question. */
  function workerResult(
    request: DraftQuizCardsRequest,
    declared: readonly (string | undefined)[],
    options: { readonly acknowledged?: boolean } = {},
  ): DraftQuizCardsResult {
    const acknowledged = options.acknowledged ?? request.intendedDemand !== undefined;
    return {
      status: 'drafted',
      request: {
        courseCode: request.courseCode,
        conceptName: request.conceptName,
        sourceChunks: ['her prose about chunking'],
        ...(request.intendedDemand === undefined ? {} : { intendedDemand: request.intendedDemand }),
        ...(request.requestedAsk === undefined ? {} : { requestedAsk: request.requestedAsk }),
      },
      response: {
        ok: true,
        stamp: { promptVersion: '2.4.0', modelId: 'test-model' },
        result: {
          ...(acknowledged ? { demandAcknowledgement: { intendedDemand: 'recall-a-fact' } } : {}),
          questions: declared.map((word, i) => ({
            stem: `Stem ${i}`,
            correctAnswer: 'Correct',
            distractors: ['A', 'B', 'C', 'D'],
            feedback: 'Feedback',
            ...(word === undefined ? {} : { declaredDemand: word }),
          })),
        },
      },
    };
  }

  it('a served heading is cached with the heading-cue origin, the mapping, the whole heading with its question word, the acknowledgement and its own declaration', async () => {
    const { cache, port } = setUp(async (_deps, request) =>
      workerResult(request, ['recall-a-fact']),
    );

    const outcome = await port.accept(
      candidateFixture({ headingText: SERVED_HEADING, rule: 'wh-inversion' }),
      contextFixture(),
    );

    if (outcome.kind !== 'drafted') throw new Error('unreachable');
    const record = await cache.get(outcome.draftIds[0] ?? '');
    expect(record?.demand).toEqual({
      origin: 'heading-cue',
      intendedDemand: 'recall-a-fact',
      requestedAsk: { heading: SERVED_HEADING, questionWord: 'What' },
      acknowledgedDemand: 'recall-a-fact',
      declaredDemand: 'recall-a-fact',
    });
  });

  it('each question of a served heading carries its own declaration, by position', async () => {
    const { cache, port } = setUp(async (_deps, request) =>
      workerResult(request, ['recall-a-fact', 'recall-a-fact']),
    );

    const outcome = await port.accept(
      candidateFixture({ headingText: SERVED_HEADING, rule: 'wh-inversion' }),
      contextFixture(),
    );

    if (outcome.kind !== 'drafted') throw new Error('unreachable');
    expect(outcome.draftIds).toHaveLength(2);
    const records = await Promise.all(outcome.draftIds.map((id) => cache.get(id)));
    expect(records.map((r) => r?.demand?.declaredDemand)).toEqual([
      'recall-a-fact',
      'recall-a-fact',
    ]);
  });

  it('an unserved, unspecified or yes/no heading is cached with no demand key: its request carried none', async () => {
    for (const heading of [DEFERRED_HEADING, 'Why does chunking help recall?']) {
      const { cache, port } = setUp(async (_deps, request) => workerResult(request, [undefined]));
      const outcome = await port.accept(
        candidateFixture({ headingText: heading, rule: 'wh-inversion' }),
        contextFixture(),
      );
      if (outcome.kind !== 'drafted') throw new Error('unreachable');
      const record = await cache.get(outcome.draftIds[0] ?? '');
      expect(record).not.toBeNull();
      expect('demand' in (record ?? {})).toBe(false);
    }
    const { cache, port } = setUp(async (_deps, request) => workerResult(request, [undefined]));
    const yesNo = await port.accept(candidateFixture(), contextFixture());
    if (yesNo.kind !== 'drafted') throw new Error('unreachable');
    expect('demand' in ((await cache.get(yesNo.draftIds[0] ?? '')) ?? {})).toBe(false);
  });

  it('an old Worker (no acknowledgement) is cached carrying the demand it was asked, unacknowledged, and is not dropped', async () => {
    const { cache, port } = setUp(async (_deps, request) =>
      workerResult(request, [undefined], { acknowledged: false }),
    );

    const outcome = await port.accept(
      candidateFixture({ headingText: SERVED_HEADING, rule: 'wh-inversion' }),
      contextFixture(),
    );

    if (outcome.kind !== 'drafted') throw new Error('unreachable');
    const record = await cache.get(outcome.draftIds[0] ?? '');
    expect(record?.demand).toEqual({
      origin: 'heading-cue',
      intendedDemand: 'recall-a-fact',
      requestedAsk: { heading: SERVED_HEADING, questionWord: 'What' },
    });
    expect(draftDemandRefusalCounterFor(cache).total()).toBe(0);
  });

  it('a question declaring a different demand than asked is not cached and is counted; the agreeing one beside it is kept', async () => {
    const { cache, port } = setUp(async (_deps, request) =>
      workerResult(request, ['calculate', 'recall-a-fact']),
    );

    const outcome = await port.accept(
      candidateFixture({ headingText: SERVED_HEADING, rule: 'wh-inversion' }),
      contextFixture(),
    );

    if (outcome.kind !== 'drafted') throw new Error('unreachable');
    expect(outcome.draftIds).toHaveLength(1);
    expect(await cache.listPending()).toHaveLength(1);
    expect(draftDemandRefusalCounterFor(cache).counts()).toEqual([
      { conceptKey: 'concept-key-chunking', count: 1 },
    ]);
  });

  it('when every question is refused nothing is cached and the outcome is the honest nothing-arrived one, with the routing still carried', async () => {
    const { cache, port } = setUp(async (_deps, request) => workerResult(request, ['calculate']));

    const outcome = await port.accept(
      candidateFixture({ headingText: SERVED_HEADING, rule: 'wh-inversion' }),
      contextFixture(),
    );

    expect(outcome).toMatchObject({
      kind: 'unparseable',
      demandRouting: { kind: 'served', demand: 'recall-a-fact' },
    });
    expect(await cache.listPending()).toEqual([]);
    expect(draftDemandRefusalCounterFor(cache).total()).toBe(1);
  });

  it('the production path end to end: accept the offer, accept the draft in review, one record keyed by the returned id and read back as declared recognition', async () => {
    const { vault, cache, port } = setUp(async (_deps, request) =>
      workerResult(request, ['recall-a-fact']),
    );
    const outcome = await port.accept(
      candidateFixture({ headingText: SERVED_HEADING, rule: 'wh-inversion' }),
      contextFixture(),
    );
    if (outcome.kind !== 'drafted') throw new Error('unreachable');
    const accept = createDraftAcceptPort({ vault, cache, deviceId: 'device-a', now: () => NOW });

    const { instrumentId } = await accept.accept(outcome.draftIds[0] ?? '', 'accepted');

    expect(await vault.list({ under: INSTRUMENT_TARGET_STORE_FOLDER })).toEqual([
      instrumentTargetStorePath(instrumentId),
    ]);
    const block = parseMcqBlocks(vault.raw(NOTE_PATH) ?? '').instruments[0];
    if (block === undefined) throw new Error('no block was written');
    expect(await readInstrumentDemand(vault, instrumentId, block)).toEqual({
      kind: 'declared',
      demand: 'recall-a-fact',
      origin: 'heading-cue',
      responseForm: 'recognition',
    });
    // Row 35: the whole heading is in the draft cache; the target record stores none of her wording.
    const record = await readInstrumentTarget(vault, instrumentId);
    if (record.kind !== 'record') throw new Error('expected a record');
    expect(JSON.stringify(record.record)).not.toContain(SERVED_HEADING);
    expect((await cache.get(outcome.draftIds[0] ?? ''))?.demand?.requestedAsk?.heading).toBe(
      SERVED_HEADING,
    );
  });

  it('an unserved heading accepted in review leaves no record: the narrower draft is never the unserved ask’s fulfilment', async () => {
    const { vault, cache, port } = setUp(async (_deps, request) =>
      workerResult(request, [undefined]),
    );
    const outcome = await port.accept(
      candidateFixture({ headingText: DEFERRED_HEADING, rule: 'wh-inversion' }),
      contextFixture(),
    );
    if (outcome.kind !== 'drafted') throw new Error('unreachable');
    const accept = createDraftAcceptPort({ vault, cache, deviceId: 'device-a', now: () => NOW });

    await accept.accept(outcome.draftIds[0] ?? '', 'accepted');

    expect(await vault.list({ under: INSTRUMENT_TARGET_STORE_FOLDER })).toEqual([]);
  });
});
