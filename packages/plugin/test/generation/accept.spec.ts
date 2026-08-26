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
 */
import {
  buildReviewSession,
  createFsrsScheduler,
  provisionalConceptKey,
  reviewLogPath,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
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

    // The same call `main.ts`'s `composeReviewSession` makes on her next
    // "start today's review" — a fresh walk of the SAME vault `accept()`
    // just wrote into, composed by the real `composeQueue`. No fixture here
    // stands in for either.
    const composed = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    const record = composed.recordsById.get(instrumentId);
    expect(record?.instrumentType).toBe('mcq');
    expect(record?.conceptIds).toEqual([
      provisionalConceptKey({ name: 'Sediment layering', boundNotePath: null }),
    ]);
    expect(record?.courses).toEqual(['GEO101']);

    const offered = composed.queue.items.find((item) => item.instrumentId === instrumentId);
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

    // Both instruments are eligible (dueState 'new'), share one concept, and
    // F2.17 (compose.ts) offers exactly one of them per session — the same
    // dedupe a session with two hand-authored MCQs on one concept would get.
    // Which one wins is FSRS-order/insertion-order, `composeQueue`'s call,
    // not a distinction this test makes: the point is there is exactly one
    // winner and one deferral, not that the generated one always wins.
    const offeredIds = composed.queue.items.map((item) => item.instrumentId);
    const deferredIds = composed.queue.deferred.map((d) => d.instrumentId);
    expect(offeredIds).toHaveLength(1);
    expect(deferredIds).toHaveLength(1);
    expect(new Set([...offeredIds, ...deferredIds])).toEqual(
      new Set(['olea-mcq-existing', generatedId]),
    );
  });
});
