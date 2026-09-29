/**
 * `createDraftAcceptPort` tests (F3.3, `[D-097]`, INV-6, `ol-mfn0`).
 *
 * Proves the three outcomes each do the vault write (if any) and the
 * `verdictLogRecordV4` append as one unit: accept/edit materialize and
 * record a verdict naming the REAL instrument id; reject writes nothing to
 * the vault and records a verdict naming the draft's own id; a re-call on
 * an already-resolved draft is a no-op rather than a double write.
 *
 * The last suite below (`ol-p3t07b`, F2.15/F3.4) goes one step further than
 * "a vault write happened": it feeds the vault `accept()` just wrote back
 * through `buildReviewSession` — the SAME entry point `main.ts`'s
 * `composeReviewSession` calls on her next "start today's review" — and
 * asserts the materialized MCQ comes back as an ordinary `QueueCandidate`,
 * composed by the real `composeQueue` (`olea-core`), with no special-casing
 * for its generated provenance. That is the acceptance criterion "generated
 * items enter the queue like any instrument", proved against production
 * code on both sides of the seam rather than asserted about the write alone.
 *
 * The `[D-133]` describe block near the bottom (`ol-2zfj.39`) closes the
 * LAST hop of the predecessor-threading chain: a `DraftRecord` carrying
 * `predecessorInstrumentId` (as `revision-job-runner.ts` now produces) makes
 * `accept()` forward it into `materializeAcceptedDraft`, which stamps the
 * successor's `predecessor:` field and appends the succession record — end
 * to end, from a cached draft through to both vault-visible facts.
 *
 * The `ol-0r92.87` describe block covers the stale-input guard: a draft
 * whose `sourceContentHash` no longer matches the note's current content
 * refuses rather than materializing against unreviewed content, leaves the
 * record `rejected` (never `pending`) with a `rejected` verdict appended,
 * and a retry on the same draft id still refuses rather than re-accepting.
 */
import {
  buildReviewSession,
  composeQueue,
  createFsrsScheduler,
  hashText,
  INSTRUMENT_TARGET_STORE_FOLDER,
  instrumentTargetStorePath,
  parseCards,
  parseMcqBlocks,
  provisionalConceptKey,
  readInstrumentDemand,
  readInstrumentTarget,
  reviewLogPath,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { StaleSourceRevisionError } from '../../src/generation/materialize-mcq.js';
import type { DraftDemandCarriage, DraftRecord } from '../../src/generation/types.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE_PATH = '01 Courses/COGS214/Week 2.md';
const NOW = new Date('2026-08-25T10:00:00-07:00');

function baseRecord(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: 'draft-1',
    status: 'pending',
    courseCode: 'COGS214',
    conceptName: 'Working memory',
    conceptIds: ['concept-key-1'], // the opaque key (`ol-63e1`'s flip), not the display name
    sourcePath: NOTE_PATH,
    createdAt: '2026-08-25T09:00:00-07:00',
    question: {
      stem: 'What limits working memory capacity?',
      correctAnswer: 'Chunking',
      distractors: ['A', 'B', 'C', 'D'],
      feedback: 'See the lecture notes.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
    ...overrides,
  };
}

function setUp() {
  const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
  const cache = createVaultDraftCacheStore(vault);
  let eventId = 0;
  const port = createDraftAcceptPort({
    vault,
    cache,
    deviceId: 'device-a',
    now: () => NOW,
    generateEventId: () => `event-${++eventId}`,
  });
  return { vault, cache, port };
}

async function readVerdictLines(vault: MemoryVaultSource): Promise<unknown[]> {
  const path = reviewLogPath('2026-08-25', 'device-a');
  const raw = vault.raw(path);
  if (raw === undefined) return [];
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe('createDraftAcceptPort', () => {
  it('accept materializes into the vault, updates the cache, and appends an accepted verdict naming the real instrument', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord());

    const { instrumentId } = await port.accept('draft-1', 'accepted');
    expect(instrumentId).toMatch(/^mcq-/);

    const resolved = await cache.get('draft-1');
    expect(resolved?.status).toBe('accepted');
    expect(resolved?.instrumentId).toBe(instrumentId);
    expect(resolved?.resolvedAt).toBeDefined();

    expect(vault.raw(NOTE_PATH)).toContain('her prose');
    expect(vault.raw(NOTE_PATH)).toContain('olea-mcq');

    const verdicts = (await readVerdictLines(vault)) as Array<Record<string, unknown>>;
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      kind: 'verdict',
      instrumentId,
      verdict: 'accepted',
      conceptIds: ['concept-key-1'], // the OPAQUE key, not the display name — types.ts's doc
      artifactProvenance: {
        taskId: 'quiz.generate.v1',
        promptVersion: '1.0.0',
        modelId: 'test-model',
      },
    });
  });

  it('reject writes nothing to the vault and records a verdict naming the draft id', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord());
    const noteBefore = vault.raw(NOTE_PATH);

    await port.reject('draft-1');

    expect(vault.raw(NOTE_PATH)).toBe(noteBefore); // untouched

    const resolved = await cache.get('draft-1');
    expect(resolved?.status).toBe('rejected');
    expect(resolved?.instrumentId).toBeUndefined();

    const verdicts = (await readVerdictLines(vault)) as Array<Record<string, unknown>>;
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      kind: 'verdict',
      instrumentId: 'draft-1',
      verdict: 'rejected',
      conceptIds: ['concept-key-1'],
    });
  });

  it('a second accept call on an already-accepted draft is a no-op, not a second write', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord());
    const first = await port.accept('draft-1', 'accepted');
    const noteAfterFirst = vault.raw(NOTE_PATH);

    const second = await port.accept('draft-1', 'accepted');
    expect(second.instrumentId).toBe(first.instrumentId);
    expect(vault.raw(NOTE_PATH)).toBe(noteAfterFirst); // no second MCQ block inserted

    const verdicts = await readVerdictLines(vault);
    expect(verdicts).toHaveLength(1); // no second verdict appended
  });

  it('a reject call on an already-rejected draft is a no-op', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord());
    await port.reject('draft-1');
    await port.reject('draft-1');

    const verdicts = await readVerdictLines(vault);
    expect(verdicts).toHaveLength(1);
  });

  it('accept throws for an unknown draft id (programmer error, not a recoverable condition)', async () => {
    const { port } = setUp();
    await expect(port.accept('does-not-exist', 'accepted')).rejects.toThrow();
  });
});

describe('an accepted MCQ persists as a scheduled instrument (F2.15/F3.4, ol-p3t07b)', () => {
  /**
   * A course note that carries the `topic:` frontmatter `buildReviewSession`
   * reads to bind concept membership — the same shape `session/build.spec.ts`
   * (`olea-core`) and `open-session.spec.ts` use, so this fixture is not a
   * simplified stand-in for the real vault walk, it is the real thing.
   */
  const COURSE_NOTE_PATH = 'Courses/GEO101/Week 3.md';
  const COURSE_NOTE = [
    '---',
    'topic: [Sediment layering]',
    'course: GEO101',
    '---',
    '',
    'her prose about sediment',
    '',
  ].join('\n');

  it('is found by a fresh buildReviewSession walk as an ordinary due candidate, attached to its concept', async () => {
    const vault = new MemoryVaultSource({ [COURSE_NOTE_PATH]: COURSE_NOTE });
    const cache = createVaultDraftCacheStore(vault);
    const port = createDraftAcceptPort({ vault, cache, deviceId: 'device-a', now: () => NOW });
    await cache.put(
      baseRecord({
        sourcePath: COURSE_NOTE_PATH,
        // The draft's own conceptIds are only ever used for the verdict log
        // (accept.ts never uses them to bind the materialized instrument) —
        // deliberately different from the note's real topic, so this test
        // cannot pass by accidentally reusing the draft's own value instead
        // of a real vault-derived one.
        conceptIds: ['not-the-real-binding'],
      }),
    );

    const { instrumentId } = await port.accept('draft-1', 'accepted');

    // A fresh walk of the SAME vault `accept()` just wrote into — the
    // enumeration `main.ts`'s `composeReviewSession` reads on her next
    // "start today's review" — composed by the real `composeQueue`, exactly
    // `packages/workbench/src/queue/derive.ts`'s own shape (`[SESS-8.6]`,
    // `ol-egov.132.6`: `buildReviewSession` itself no longer composes). No
    // fixture here stands in for either.
    const composed = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const queue = composeQueue({ candidates: composed.candidates, now: NOW });

    const record = composed.recordsById.get(instrumentId);
    expect(record?.instrumentType).toBe('mcq');
    expect(record?.conceptIds).toEqual([
      provisionalConceptKey({ name: 'Sediment layering', boundNotePath: null }),
    ]);
    expect(record?.courses).toEqual(['GEO101']);

    const offered = queue.items.find((item) => item.instrumentId === instrumentId);
    expect(offered).toBeDefined();
    // Never reviewed yet — the same 'new' dueState any hand-authored
    // instrument gets the first time the queue ever sees it (compose.ts's
    // `dueStateOf`), not a status peculiar to having been generated.
    expect(offered?.selectionContext.dueState).toBe('new');
    expect(offered?.instrumentType).toBe('mcq');
    expect(offered?.conceptIds).toEqual([
      provisionalConceptKey({ name: 'Sediment layering', boundNotePath: null }),
    ]);
  });

  it('sits in the SAME dedupe group as a hand-authored MCQ on the same concept — F2.17 cannot tell them apart', async () => {
    const handAuthoredPath = 'Courses/GEO101/Week 1.md';
    const handAuthoredNote = [
      '---',
      'topic: [Sediment layering]',
      'course: GEO101',
      '---',
      '',
      '## Already there?',
      '',
      '```olea-mcq',
      'id: olea-mcq-existing',
      'stem: A hand-authored question?',
      'answer: The right one',
      'distractor: a',
      'distractor: b',
      'distractor: c',
      'distractor: d',
      '```',
      '',
    ].join('\n');

    const vault = new MemoryVaultSource({
      [handAuthoredPath]: handAuthoredNote,
      [COURSE_NOTE_PATH]: COURSE_NOTE,
    });
    const cache = createVaultDraftCacheStore(vault);
    const port = createDraftAcceptPort({ vault, cache, deviceId: 'device-a', now: () => NOW });
    await cache.put(baseRecord({ sourcePath: COURSE_NOTE_PATH }));

    const { instrumentId: generatedId } = await port.accept('draft-1', 'accepted');

    const composed = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const queue = composeQueue({ candidates: composed.candidates, now: NOW });

    // Both instruments are eligible (dueState 'new'), share one concept, and
    // F2.17 (compose.ts) offers exactly one of them per session — the same
    // dedupe a session with two hand-authored MCQs on one concept would get.
    // Which one wins is FSRS-order/insertion-order, `composeQueue`'s call,
    // not a distinction this test makes: the point is there is exactly one
    // winner and one deferral, not that the generated one always wins.
    const offeredIds = queue.items.map((item) => item.instrumentId);
    const deferredIds = queue.deferred.map((d) => d.instrumentId);
    expect(offeredIds).toHaveLength(1);
    expect(deferredIds).toHaveLength(1);
    expect(new Set([...offeredIds, ...deferredIds])).toEqual(
      new Set(['olea-mcq-existing', generatedId]),
    );
  });
});

// `[D-133]` (`ol-2zfj.39`) — the final hop of the predecessor-threading
// chain: `accept()` forwarding a cached draft's `predecessorInstrumentId`
// into `materializeAcceptedDraft`. See this file's module doc.
describe('createDraftAcceptPort — [D-133] predecessor threading', () => {
  it('a draft carrying predecessorInstrumentId stamps the successor block and appends a succession record on accept', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord({ predecessorInstrumentId: 'mcq-old-1' }));

    const { instrumentId: successorId } = await port.accept('draft-1', 'accepted');

    const { instruments, invalid } = parseMcqBlocks(vault.raw(NOTE_PATH) ?? '');
    expect(invalid).toHaveLength(0);
    expect(instruments[0]?.id).toBe(successorId);
    expect(instruments[0]?.predecessor).toBe('mcq-old-1');

    const path = reviewLogPath('2026-08-25', 'device-a');
    const raw = vault.raw(path);
    const lines = (raw ?? '')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const succession = lines.find((line) => line.kind === 'succession');
    expect(succession).toMatchObject({
      kind: 'succession',
      predecessorInstrumentId: 'mcq-old-1',
      successorInstrumentId: successorId,
    });
    // The verdict for the ACCEPT itself is still appended too — succession
    // is additional bookkeeping, never a replacement for the ordinary
    // verdict record every accept produces.
    expect(lines.find((line) => line.kind === 'verdict')).toBeDefined();
  });

  it('a draft with no predecessorInstrumentId stamps nothing and appends no succession record (unchanged pre-[D-133] behaviour)', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord());

    await port.accept('draft-1', 'accepted');

    const { instruments } = parseMcqBlocks(vault.raw(NOTE_PATH) ?? '');
    expect(instruments[0]?.predecessor).toBeNull();

    const path = reviewLogPath('2026-08-25', 'device-a');
    const lines = (vault.raw(path) ?? '')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.find((line) => line.kind === 'succession')).toBeUndefined();
  });
});

// `ol-v7r5.98`: the same predecessor-threading hop as the `[D-133]` block
// above, but for a `'qa'`-kind draft — `accept.ts`'s Q&A path did not
// forward `record.predecessorInstrumentId` or the device id/clock/event-id
// trio into `materializeAcceptedCardDraft`, so accepting a Q&A successor
// draft wrote the card but never appended the succession event. Uses the
// port's REAL, registered `'qa'` materializer (no injected override —
// `accept-generalized-kind.spec.ts` covers dispatch with a fake), so this
// proves the production path end to end, mirroring `materialize-card.spec.ts`'s
// own `[D-366]` succession-hookup suite one layer up, through `accept()`.
describe('createDraftAcceptPort — [D-366]/ol-v7r5.98 Q&A successor threading', () => {
  function baseCardRecord(overrides: Partial<DraftRecord> = {}): DraftRecord {
    return {
      draftId: 'draft-1',
      status: 'pending',
      courseCode: 'COGS214',
      conceptName: 'Working memory',
      conceptIds: ['concept-key-1'],
      sourcePath: NOTE_PATH,
      createdAt: '2026-08-25T09:00:00-07:00',
      instrumentType: 'qa',
      card: { front: 'What limits working memory capacity?', back: 'Chunking' },
      provenance: { taskId: 'cards.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
      firstServedAt: null,
      ...overrides,
    };
  }

  it('a Q&A draft carrying predecessorInstrumentId appends a succession record naming both ids on accept', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseCardRecord({ predecessorInstrumentId: 'qa-old-1' }));

    const { instrumentId: successorId } = await port.accept('draft-1', 'accepted');

    const cards = parseCards(vault.raw(NOTE_PATH) ?? '');
    expect(cards).toHaveLength(1); // the card itself carries no predecessor field (no format mechanism for one)

    const lines = (await readVerdictLines(vault)) as Array<Record<string, unknown>>;
    const succession = lines.find((line) => line.kind === 'succession');
    expect(succession).toMatchObject({
      kind: 'succession',
      predecessorInstrumentId: 'qa-old-1',
      successorInstrumentId: successorId,
    });
    // The accept verdict is still appended too — succession is additional
    // bookkeeping, never a replacement for it.
    const verdict = lines.find((line) => line.kind === 'verdict');
    expect(verdict).toMatchObject({
      verdict: 'accepted',
      instrumentId: successorId,
      instrumentType: 'qa',
    });
  });

  it('a Q&A draft with no predecessorInstrumentId appends no succession record (unchanged behaviour)', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseCardRecord());

    await port.accept('draft-1', 'accepted');

    const lines = (await readVerdictLines(vault)) as Array<Record<string, unknown>>;
    expect(lines.find((line) => line.kind === 'succession')).toBeUndefined();
  });
});

// `ol-0r92.87` — the stale-input guard. See this file's module doc.
describe('createDraftAcceptPort — ol-0r92.87 stale-input guard', () => {
  const ORIGINAL_NOTE = '# Week 2\n\nher prose\n';

  async function setUpWithHash() {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: ORIGINAL_NOTE });
    const cache = createVaultDraftCacheStore(vault);
    let eventId = 0;
    const port = createDraftAcceptPort({
      vault,
      cache,
      deviceId: 'device-a',
      now: () => NOW,
      generateEventId: () => `event-${++eventId}`,
    });
    const sourceContentHash = await hashText(ORIGINAL_NOTE);
    return { vault, cache, port, sourceContentHash };
  }

  it('refuses when the source note changed since drafting, writes nothing, and leaves the draft rejected rather than accepted silently', async () => {
    const { vault, cache, port, sourceContentHash } = await setUpWithHash();
    await cache.put(baseRecord({ sourceContentHash }));

    // Her note changed while the draft was outstanding — a real edit, a sync
    // from another device, doesn't matter which.
    await vault.write(NOTE_PATH, `${ORIGINAL_NOTE}\nA line added after drafting.\n`);
    const noteBeforeAccept = vault.raw(NOTE_PATH);

    await expect(port.accept('draft-1', 'accepted')).rejects.toThrow(StaleSourceRevisionError);

    // Nothing was inserted — the note is exactly what it was the instant before the call.
    expect(vault.raw(NOTE_PATH)).toBe(noteBeforeAccept);
    expect(vault.raw(NOTE_PATH)).not.toContain('olea-mcq');

    const resolved = await cache.get('draft-1');
    expect(resolved?.status).toBe('rejected');
    expect(resolved?.instrumentId).toBeUndefined();

    const verdicts = (await readVerdictLines(vault)) as Array<Record<string, unknown>>;
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      kind: 'verdict',
      instrumentId: 'draft-1', // the draft's own id — no instrument was ever materialized
      verdict: 'rejected',
      conceptIds: ['concept-key-1'],
    });
  });

  it('a retry after the stale rejection still refuses, rather than re-accepting against whatever the note now contains', async () => {
    const { vault, cache, port, sourceContentHash } = await setUpWithHash();
    await cache.put(baseRecord({ sourceContentHash }));
    await vault.write(NOTE_PATH, `${ORIGINAL_NOTE}\nchanged\n`);

    await expect(port.accept('draft-1', 'accepted')).rejects.toThrow(StaleSourceRevisionError);
    // Second call: the record is now 'rejected' with no instrumentId, so this
    // hits the ordinary already-resolved branch and throws too — never a
    // silent re-accept, and never a second write or a second verdict.
    await expect(port.accept('draft-1', 'accepted')).rejects.toThrow(
      /already 'rejected' with no instrumentId/,
    );

    expect(vault.raw(NOTE_PATH)).not.toContain('olea-mcq');
    const verdicts = await readVerdictLines(vault);
    expect(verdicts).toHaveLength(1);
  });

  it('an unchanged source still accepts normally when a hash is present', async () => {
    const { vault, cache, port, sourceContentHash } = await setUpWithHash();
    await cache.put(baseRecord({ sourceContentHash }));

    const { instrumentId } = await port.accept('draft-1', 'accepted');
    expect(instrumentId).toMatch(/^mcq-/);
    expect(vault.raw(NOTE_PATH)).toContain('olea-mcq');

    const resolved = await cache.get('draft-1');
    expect(resolved?.status).toBe('accepted');
    expect(resolved?.instrumentId).toBe(instrumentId);
  });

  it('a draft cached before this field existed (no sourceContentHash) still accepts normally — "no signal, no gate"', async () => {
    const { vault, cache, port } = await setUpWithHash();
    // No `sourceContentHash` override — `baseRecord()`'s own default, matching
    // every draft cached before `ol-0r92.87`.
    await cache.put(baseRecord());
    await vault.write(NOTE_PATH, `${ORIGINAL_NOTE}\nchanged after drafting\n`);

    const { instrumentId } = await port.accept('draft-1', 'accepted');
    expect(instrumentId).toMatch(/^mcq-/);
  });
});

/**
 * `[D-437]` (`ol-egov.141.89.2.30`), design `demand-carriage.md` sections 4.3, 4.4 and 6 (T6): the
 * accept path forwards a cached draft's demand to the materialiser, which writes the ONE target
 * record, keyed by the instrument id `accept` returns. A draft with no demand forwards nothing, so
 * nothing is written and the instrument reads unspecified for ever. Uses the port's REAL registered
 * materialisers, through the real `olea-core` reader, so this is the production hop end to end.
 * Every fixture is invented.
 */
describe('createDraftAcceptPort: the demand a cached draft carries reaches the target record ([D-437], T6)', () => {
  const HEADING = 'What is an invented chunking heading?';

  function carriage(overrides: Partial<DraftDemandCarriage> = {}): DraftDemandCarriage {
    return {
      origin: 'heading-cue',
      intendedDemand: 'recall-a-fact',
      requestedAsk: { heading: HEADING, questionWord: 'What' },
      acknowledgedDemand: 'recall-a-fact',
      declaredDemand: 'recall-a-fact',
      ...overrides,
    };
  }

  function cardRecord(overrides: Partial<DraftRecord> = {}): DraftRecord {
    // A card draft carries `card` and no `question` (types.ts: mutually exclusive).
    const { question: _question, ...rest } = baseRecord();
    return {
      ...rest,
      instrumentType: 'qa',
      card: { front: 'What limits working memory capacity?', back: 'Chunking' },
      provenance: {
        taskId: 'cards.generate.v1',
        promptVersion: '1.8.0',
        modelId: 'test-model',
      },
      ...overrides,
    };
  }

  function targetFiles(vault: MemoryVaultSource) {
    return vault.list({ under: INSTRUMENT_TARGET_STORE_FOLDER });
  }

  function mcqBlockOf(vault: MemoryVaultSource) {
    const block = parseMcqBlocks(vault.raw(NOTE_PATH) ?? '').instruments[0];
    if (block === undefined) throw new Error('no mcq block was written');
    return block;
  }

  function qaBlockOf(vault: MemoryVaultSource) {
    const card = parseCards(vault.raw(NOTE_PATH) ?? '').find((c) => c.type === 'qa');
    if (card === undefined || card.type !== 'qa') throw new Error('no qa card was written');
    return card;
  }

  it('an accepted multiple-choice draft with an acknowledged, agreeing demand leaves one record under the returned id, read back as recognition', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord({ demand: carriage() }));

    const { instrumentId } = await port.accept('draft-1', 'accepted');

    expect(await targetFiles(vault)).toEqual([instrumentTargetStorePath(instrumentId)]);
    expect(await readInstrumentDemand(vault, instrumentId, mcqBlockOf(vault))).toEqual({
      kind: 'declared',
      demand: 'recall-a-fact',
      origin: 'heading-cue',
      responseForm: 'recognition',
    });
  });

  it('the record carries the draft provenance task and prompt version as its generator, never the model id, and never her heading', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(
      baseRecord({
        provenance: { taskId: 'quiz.generate.v1', promptVersion: '2.4.0', modelId: 'a-model' },
        demand: carriage(),
      }),
    );

    const { instrumentId } = await port.accept('draft-1', 'accepted');

    const read = await readInstrumentTarget(vault, instrumentId);
    if (read.kind !== 'record') throw new Error('expected a record');
    expect(read.record.generator).toEqual({ taskId: 'quiz.generate.v1', promptVersion: '2.4.0' });
    expect(read.record.origin).toBe('heading-cue');
    // Row 35: the heading survives in the draft cache only; the target record stores none of her wording.
    expect(vault.raw(instrumentTargetStorePath(instrumentId))).not.toContain(HEADING);
    expect((await cache.get('draft-1'))?.demand?.requestedAsk?.heading).toBe(HEADING);
  });

  it('an accepted card draft with an acknowledged, agreeing demand leaves one record under the returned id, read back as free recall', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(cardRecord({ demand: carriage({ origin: 'revision' }) }));

    const { instrumentId } = await port.accept('draft-1', 'accepted');

    expect(await targetFiles(vault)).toEqual([instrumentTargetStorePath(instrumentId)]);
    expect(await readInstrumentDemand(vault, instrumentId, qaBlockOf(vault))).toEqual({
      kind: 'declared',
      demand: 'recall-a-fact',
      origin: 'revision',
      responseForm: 'free-recall',
    });
    const read = await readInstrumentTarget(vault, instrumentId);
    if (read.kind !== 'record') throw new Error('expected a record');
    expect(read.record.generator).toEqual({ taskId: 'cards.generate.v1', promptVersion: '1.8.0' });
  });

  it("the sweep origin's recall intent on a multiple-choice draft reads recognition, never free recall (row 38)", async () => {
    const { vault, cache, port } = setUp();
    const { requestedAsk: _heading, ...sweepAsk } = carriage({ origin: 'sweep' });
    await cache.put(baseRecord({ demand: sweepAsk }));

    const { instrumentId } = await port.accept('draft-1', 'accepted');

    const reading = await readInstrumentDemand(vault, instrumentId, mcqBlockOf(vault));
    expect(reading).toMatchObject({
      kind: 'declared',
      origin: 'sweep',
      responseForm: 'recognition',
    });
  });

  it('edited resolves the same way accepted does: the record is written once for the returned id', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord({ demand: carriage() }));

    const { instrumentId } = await port.accept('draft-1', 'edited');

    expect(await targetFiles(vault)).toEqual([instrumentTargetStorePath(instrumentId)]);
    // A second accept on the resolved draft is the idempotent no-op: it writes nothing more.
    await port.accept('draft-1', 'edited');
    expect(await targetFiles(vault)).toEqual([instrumentTargetStorePath(instrumentId)]);
  });

  describe.each([
    ['multiple-choice', (o: Partial<DraftRecord>) => baseRecord(o), mcqBlockOf],
    ['card', (o: Partial<DraftRecord>) => cardRecord(o), qaBlockOf],
  ] as const)('a %s draft that must leave no record', (_kind, build, blockOf) => {
    it('an old-Worker response (no acknowledgement) leaves none, and the instrument reads unspecified', async () => {
      const { vault, cache, port } = setUp();
      const { acknowledgedDemand: _ack, ...unacknowledged } = carriage();
      await cache.put(build({ demand: unacknowledged }));

      const { instrumentId } = await port.accept('draft-1', 'accepted');

      expect(await targetFiles(vault)).toEqual([]);
      expect(await readInstrumentDemand(vault, instrumentId, blockOf(vault))).toEqual({
        kind: 'unspecified',
      });
    });

    it('a mismatching declaration leaves none, and the accept still succeeds', async () => {
      const { vault, cache, port } = setUp();
      await cache.put(build({ demand: carriage({ declaredDemand: 'calculate' }) }));

      const { instrumentId } = await port.accept('draft-1', 'accepted');

      expect(await targetFiles(vault)).toEqual([]);
      expect((await cache.get('draft-1'))?.status).toBe('accepted');
      expect(await readInstrumentDemand(vault, instrumentId, blockOf(vault))).toEqual({
        kind: 'unspecified',
      });
    });

    it('a legacy draft (no demand field at all) leaves none and reads unspecified for ever', async () => {
      const { vault, cache, port } = setUp();
      await cache.put(build({}));
      expect('demand' in ((await cache.get('draft-1')) ?? {})).toBe(false);

      const { instrumentId } = await port.accept('draft-1', 'accepted');

      expect(await targetFiles(vault)).toEqual([]);
      expect(await readInstrumentDemand(vault, instrumentId, blockOf(vault))).toEqual({
        kind: 'unspecified',
      });
    });

    it('a rejected draft writes no record: nothing was materialised', async () => {
      const { vault, cache, port } = setUp();
      await cache.put(build({ demand: carriage() }));

      await port.reject('draft-1');

      expect(await targetFiles(vault)).toEqual([]);
    });
  });

  it('a stale-source refusal writes no record', async () => {
    const { vault, cache, port } = setUp();
    await cache.put(baseRecord({ sourceContentHash: 'not-the-hash', demand: carriage() }));

    await expect(port.accept('draft-1', 'accepted')).rejects.toThrow(StaleSourceRevisionError);

    expect(await targetFiles(vault)).toEqual([]);
  });

  it('carrying a demand changes nothing in her note: it is byte-identical with and without one (INV-6)', async () => {
    const withDemand = setUp();
    const without = setUp();
    await withDemand.cache.put(baseRecord({ demand: carriage() }));
    await without.cache.put(baseRecord());

    await withDemand.port.accept('draft-1', 'accepted');
    await without.port.accept('draft-1', 'accepted');

    expect(withDemand.vault.raw(NOTE_PATH)).toBe(without.vault.raw(NOTE_PATH));
    expect(withDemand.vault.raw(NOTE_PATH)).not.toContain('recall-a-fact');
  });
});
