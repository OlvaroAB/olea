// Scenarios: features/F2-review.md, "F2.15 — The adapter presents what the queue
// chose, and invents nothing" — @auto:plugin/review/queue-adapter.spec
//
// Everything below composes a real session out of a small in-memory vault
// through `olea-core`'s `buildReviewSession`, rather than hand-building a
// `ComposedQueue`. Hand-building it would test the adapter against the shape
// this file believes the composer produces, which is exactly the coupling the
// adapter exists to remove.
//
// `[SESS-8.6]` (`ol-egov.132.6`): `buildReviewSession` no longer composes a
// `ComposedQueue` itself — see `session/build.ts`'s own module doc. This file
// tests `queue-adapter.ts`, which is UNCHANGED (still kept, per
// `docs/dev/one-assembly-path.md` §4): every fixture below still gets a real
// `ComposedQueue` out of a real vault, just via an explicit `composeQueue`
// call over `buildReviewSession`'s enumerated `candidates` — see
// {@link composedQueueFor} — the identical shape
// `packages/workbench/src/queue/derive.ts` uses in production.
import type { ComposedQueue, PlannedQueueItem, RandomSource, VaultSource } from 'olea-core';
import {
  buildReviewSession,
  composeQueue,
  createFsrsScheduler,
  executeStudyPlan,
  PRESENTED_OPTIONS,
  provisionalConceptKey,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  adaptExecutedReviewQueue,
  adaptReviewQueue,
  buildSupportLevelHistoryLookup,
  createFrozenReviewQueue,
} from '../../src/review/queue-adapter.js';
import type { McqItem, ReviewQueueItem } from '../../src/review/types.js';

/** `ol-63e1`: `conceptIds` now carries the opaque key, never the display name — 'Alpha' here is unbound (no matching Zettelkasten note). */
function unboundKey(name: string): string {
  return provisionalConceptKey({ name, boundNotePath: null });
}

const NOW = new Date('2026-08-20T12:00:00Z');

function memoryVault(files: Readonly<Record<string, string>>): VaultSource {
  const contents = new Map(Object.entries(files));
  return {
    async list(options = {}) {
      const extensions = options.extensions?.map((e) => e.toLowerCase());
      return [...contents.keys()]
        .filter((p) => options.under === undefined || p.startsWith(`${options.under}/`))
        .filter((p) => extensions === undefined || extensions.some((e) => p.endsWith(`.${e}`)))
        .sort();
    },
    async read(path) {
      const value = contents.get(path);
      if (value === undefined) throw new Error(`no such file ${path}`);
      return value;
    },
    async readBinary(path) {
      return new TextEncoder().encode(await this.read(path));
    },
    async write(path, content) {
      contents.set(path, content);
    },
    async exists(path) {
      return contents.has(path);
    },
    watch() {
      return () => undefined;
    },
  };
}

const QA_NOTE = [
  '---',
  'topic: [Alpha]',
  'course: TEST101',
  '---',
  '',
  '## What holds it together?',
  '',
  'The front of the card::The back of the card ^blk1',
  '',
].join('\n');

const CLOZE_NOTE = [
  '---',
  'topic: [Beta]',
  'course: TEST101',
  '---',
  '',
  '## Why does it settle?',
  '',
  'Grains are ==sorted== by flow.',
  '',
].join('\n');

const MCQ_NOTE = [
  '---',
  'topic: [Gamma]',
  'course: MUS101',
  '---',
  '',
  '## Which structure?',
  '',
  '```olea-mcq',
  'stem: Which structure preserves the record?',
  'answer: The correct one',
  'distractor: d1',
  'distractor: d2',
  'distractor: d3',
  'distractor: d4',
  'distractor: d5',
  'feedback: Because of the thing.',
  '```',
  '',
].join('\n');

function vault(): VaultSource {
  return memoryVault({
    'Notes/qa.md': QA_NOTE,
    'Notes/cloze.md': CLOZE_NOTE,
    'Notes/mcq.md': MCQ_NOTE,
  });
}

/**
 * `[SESS-8.6]`: the `ComposedQueue` `buildReviewSession` used to hand back
 * directly — now composed explicitly over its enumerated `candidates`, the
 * same real-vault-to-`composeQueue` shape `packages/workbench/src/queue/derive.ts`
 * uses in production. See this file's own module doc.
 */
function composedQueueFor(
  built: { readonly candidates: Parameters<typeof composeQueue>[0]['candidates'] },
  now: Date = NOW,
): ComposedQueue {
  return composeQueue({ candidates: built.candidates, now });
}

async function adapt(options: { readonly random?: RandomSource } = {}) {
  const session = await buildReviewSession({
    vault: vault(),
    scheduler: createFsrsScheduler(),
    now: NOW,
  });
  return adaptReviewQueue({
    queue: composedQueueFor(session),
    recordsById: session.recordsById,
    ...(options.random !== undefined ? { random: options.random } : {}),
  });
}

describe('each queue item becomes a renderable instrument of its own type', () => {
  it('renders all three types, in the order the queue offered them', async () => {
    const items = await adapt();
    // All three are never-reviewed ('new'), so every course-block ties on
    // urgency (`ol-ua0i`'s F2.18) and blocks sort alphabetically:
    // MUS101 (mcq) leads TEST101 (cloze, qa, in vault-list order within the
    // block: `Notes/cloze.md` then `Notes/qa.md`).
    expect(items.map((i) => i.instrument.type)).toEqual(['mcq', 'cloze', 'qa']);
  });

  it('a Q&A card carries its question, its answer and the anchor to find it again', async () => {
    const qa = (await adapt()).find((i) => i.instrument.type === 'qa');
    if (qa?.instrument.type !== 'qa') throw new Error('expected a qa item');
    expect(qa.instrument.question).toBe('The front of the card');
    expect(qa.instrument.answer).toBe('The back of the card');
    expect(qa.instrument.sourcePath).toBe('Notes/qa.md');
    expect(qa.instrument.noteTitle).toBe('qa');
    expect(qa.instrument.blockId).toBe('blk1');
    expect(qa.instrument.courseCode).toBe('TEST101');
    expect(qa.instrument.conceptIds).toEqual([unboundKey('Alpha')]);
  });

  it('a cloze carries the sentence in three parts and the heading as its context line', async () => {
    const cloze = (await adapt()).find((i) => i.instrument.type === 'cloze');
    if (cloze?.instrument.type !== 'cloze') throw new Error('expected a cloze item');
    expect(cloze.instrument.before).toBe('Grains are ');
    expect(cloze.instrument.clozeText).toBe('sorted');
    expect(cloze.instrument.after).toBe(' by flow.');
    expect(cloze.instrument.noteContext).toBe('Why does it settle?');
  });

  it('an MCQ carries its stem, its feedback, and exactly the presented option count', async () => {
    const mcq = (await adapt()).find((i) => i.instrument.type === 'mcq');
    if (mcq?.instrument.type !== 'mcq') throw new Error('expected an mcq item');
    expect(mcq.instrument.stem).toBe('Which structure preserves the record?');
    expect(mcq.instrument.feedback).toBe('Because of the thing.');
    expect(mcq.instrument.options).toHaveLength(PRESENTED_OPTIONS);
    expect(mcq.instrument.options.filter((o) => o.correct)).toHaveLength(1);
    expect(mcq.instrument.options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('an MCQ is sampled and shuffled at the moment it is adapted', () => {
  it('two adaptations of the same instrument are not guaranteed to match, in content or in position', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const mcq = (await adapt()).find((i) => i.instrument.type === 'mcq');
      if (mcq?.instrument.type !== 'mcq') throw new Error('expected an mcq item');
      seen.add(mcq.instrument.options.map((o) => o.label).join('|'));
    }
    // A presenter that sampled once per instrument, or that pinned the answer
    // to a position, would produce one string here.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('every distractor in the pool is eventually shown — the sample really rotates', async () => {
    const labels = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const mcq = (await adapt()).find((i) => i.instrument.type === 'mcq');
      if (mcq?.instrument.type !== 'mcq') throw new Error('expected an mcq item');
      for (const option of mcq.instrument.options) labels.add(option.label);
    }
    expect(labels).toEqual(new Set(['The correct one', 'd1', 'd2', 'd3', 'd4', 'd5']));
  });

  it('the randomness is injected, so a determinism claim is about the source and not the adapter', async () => {
    const fixed = (): RandomSource => {
      let i = 0;
      // A deterministic sequence, not a constant: a constant source would make
      // "identical twice" true of a presenter that ignored the source entirely.
      return {
        next: () => {
          i = (i * 7 + 3) % 11;
          return i / 11;
        },
      };
    };
    const a = await adapt({ random: fixed() });
    const b = await adapt({ random: fixed() });
    expect(b).toEqual(a);
  });
});

// `[D-220 / DIST-3]` (`ol-egov.109`, `ol-0r92.52`) — see this file's module doc and
// `queue-adapter.ts`'s own module-doc section for why the lookup is a pre-fetched map matched by
// text, never by position.
describe('distractor provenance ([D-220 / DIST-3]) is attached by text, never fabricated', () => {
  async function session() {
    return buildReviewSession({ vault: vault(), scheduler: createFsrsScheduler(), now: NOW });
  }

  function isMcqQueueItem(
    item: ReviewQueueItem | undefined,
  ): item is ReviewQueueItem & { instrument: McqItem } {
    return item !== undefined && item.instrument.type === 'mcq';
  }

  function mcqItemOf(items: readonly ReviewQueueItem[]) {
    const mcq = items.find((i) => i.instrument.type === 'mcq');
    if (!isMcqQueueItem(mcq)) throw new Error('expected an mcq item');
    return mcq;
  }

  it('populates believes/source_says only for the distractors named in the sidecar, matched by text', async () => {
    const built = await session();
    const baseline = mcqItemOf(
      adaptReviewQueue({ queue: composedQueueFor(built), recordsById: built.recordsById }),
    );
    const instrumentId = baseline.instrument.instrumentId;

    const distractorProvenanceById = new Map([
      [
        instrumentId,
        {
          entries: [
            {
              text: 'd1',
              believes: 'Coined belief about d1',
              source_says: 'Coined source line about d1',
            },
            {
              text: 'd3',
              believes: 'Coined belief about d3',
              source_says: 'Coined source line about d3',
            },
          ],
        },
      ],
    ]);

    // Sampled across many showings (F2.15 resamples/reshuffles every time) so this actually
    // exercises the "only the named ones, whichever slot they land in" claim rather than one draw.
    for (let i = 0; i < 60; i += 1) {
      const item = mcqItemOf(
        adaptReviewQueue({
          queue: composedQueueFor(built),
          recordsById: built.recordsById,
          distractorProvenanceById,
        }),
      );
      for (const option of item.instrument.options) {
        if (option.label === 'd1' || option.label === 'd3') {
          expect(option.believes).toEqual(
            expect.stringContaining(option.label === 'd1' ? 'd1' : 'd3'),
          );
          expect(option.source_says).toEqual(
            expect.stringContaining(option.label === 'd1' ? 'd1' : 'd3'),
          );
        } else {
          expect(option.believes).toBeUndefined();
          expect(option.source_says).toBeUndefined();
        }
      }
    }
  });

  it('never attaches believes/source_says to the correct option, even if a (malformed) sidecar names its text', async () => {
    const built = await session();
    const baseline = mcqItemOf(
      adaptReviewQueue({ queue: composedQueueFor(built), recordsById: built.recordsById }),
    );
    const distractorProvenanceById = new Map([
      [
        baseline.instrument.instrumentId,
        {
          entries: [
            {
              text: 'The correct one',
              believes: 'Should never surface',
              source_says: 'Should never surface',
            },
          ],
        },
      ],
    ]);

    for (let i = 0; i < 20; i += 1) {
      const item = mcqItemOf(
        adaptReviewQueue({
          queue: composedQueueFor(built),
          recordsById: built.recordsById,
          distractorProvenanceById,
        }),
      );
      const correct = item.instrument.options.find((o) => o.correct);
      expect(correct?.believes).toBeUndefined();
      expect(correct?.source_says).toBeUndefined();
    }
  });

  it('omitting distractorProvenanceById leaves every option without believes/source_says (today’s every caller)', async () => {
    const item = mcqItemOf(await adapt());
    for (const option of item.instrument.options) {
      expect(option.believes).toBeUndefined();
      expect(option.source_says).toBeUndefined();
    }
  });

  it('adaptExecutedReviewQueue threads the same lookup through, keyed the same way', async () => {
    const built = await session();
    const executed = executeStudyPlan({ queue: composedQueueFor(built), plan: null });
    const baseline = mcqItemOf(
      adaptExecutedReviewQueue({ items: executed.items, recordsById: built.recordsById }),
    );

    const distractorProvenanceById = new Map([
      [
        baseline.instrument.instrumentId,
        {
          entries: [
            {
              text: 'd2',
              believes: 'Coined belief about d2',
              source_says: 'Coined source line about d2',
            },
          ],
        },
      ],
    ]);

    for (let i = 0; i < 60; i += 1) {
      const items = adaptExecutedReviewQueue({
        items: executed.items,
        recordsById: built.recordsById,
        distractorProvenanceById,
      });
      const item = items.find((i) => i.instrument.type === 'mcq');
      if (item?.instrument.type !== 'mcq') throw new Error('expected an mcq item');
      const d2 = item.instrument.options.find((o) => o.label === 'd2');
      if (d2 !== undefined) {
        expect(d2.believes).toBe('Coined belief about d2');
        expect(d2.source_says).toBe('Coined source line about d2');
      }
      for (const option of item.instrument.options) {
        if (option.label !== 'd2') {
          expect(option.believes).toBeUndefined();
          expect(option.source_says).toBeUndefined();
        }
      }
    }
  });
});

describe('the adapter carries the queue’s explicit nulls through unchanged', () => {
  it('yieldRank, examProximity and plan version stay null, and mastery is not invented', async () => {
    for (const item of await adapt()) {
      expect(item.selectionContext.yieldRank).toBeNull();
      expect(item.selectionContext.examProximity).toBeNull();
      expect(item.selectionContext.planVersion).toBeNull();
      // `ol-g6zg`: `masteryAtTime` left the context for the record, and the
      // adapter still does not own it — C5.4's rollup does not exist. It is
      // absent rather than null, and absent means "not recorded", which is the
      // true statement. An adapter guessing here would quietly become the thing
      // the Phase A→B checkpoint measures.
      expect(Object.hasOwn(item.selectionContext, 'masteryAtTime')).toBe(false);
    }
  });

  it('dueState and instrumentTypesOffered come from the queue verbatim', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const composedQueue = composedQueueFor(session);
    const items = adaptReviewQueue({ queue: composedQueue, recordsById: session.recordsById });
    for (const [index, item] of items.entries()) {
      const queued = composedQueue.items[index];
      expect(item.selectionContext.dueState).toBe(queued?.selectionContext.dueState);
      expect(item.selectionContext.instrumentTypesOffered).toEqual(
        queued?.selectionContext.instrumentTypesOffered,
      );
    }
  });

  it('every item of a never-reviewed vault is new with a null prior state', async () => {
    for (const item of await adapt()) {
      expect(item.selectionContext.dueState).toBe('new');
      expect(item.priorState).toBeNull();
    }
  });
});

describe('the prior state the view schedules against is the replayed one', () => {
  it('an instrument with history in the log arrives with its replayed state, not null', async () => {
    const source = vault();
    const first = await buildReviewSession({
      vault: source,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const qa = first.instruments.records.find((r) => r.instrumentType === 'qa');
    if (qa === undefined) throw new Error('expected a qa record');

    const session = await buildReviewSession({
      vault: source,
      scheduler: createFsrsScheduler(),
      now: new Date('2027-08-20T12:00:00Z'),
      entries: [
        {
          schemaVersion: 5,
          kind: 'review',
          eventId: 'e1',
          timestamp: '2026-08-19T09:00:00+00:00',
          instrumentId: qa.instrumentId,
          instrumentType: 'qa',
          rating: 'good',
          wasUnsure: false,
          durationMs: null,
          selectionContext: {
            dueState: 'new',
            examProximity: null,
            yieldRank: null,
            instrumentTypesOffered: ['qa'],
            planVersion: null,
          },
          conceptIds: [...qa.conceptIds],
        },
      ],
    });

    const items = adaptReviewQueue({
      queue: composedQueueFor(session, new Date('2027-08-20T12:00:00Z')),
      recordsById: session.recordsById,
    });
    const adapted = items.find((i) => i.instrument.instrumentId === qa.instrumentId);
    expect(adapted?.priorState).not.toBeNull();
    expect(adapted?.priorState?.reps).toBe(1);
    expect(adapted?.selectionContext.dueState).toBe('overdue');
  });
});

describe('the adapter adds nothing and drops nothing', () => {
  it('offers exactly what the queue offered, never a deferred instrument', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const composedQueue = composedQueueFor(session);
    const items = adaptReviewQueue({ queue: composedQueue, recordsById: session.recordsById });
    expect(items.map((i) => i.instrument.instrumentId)).toEqual(
      composedQueue.items.map((i) => i.instrumentId),
    );
    for (const deferral of composedQueue.deferred) {
      expect(items.map((i) => i.instrument.instrumentId)).not.toContain(deferral.instrumentId);
    }
  });

  it('an item with no matching record is skipped rather than rendered blank', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const items = adaptReviewQueue({ queue: composedQueueFor(session), recordsById: new Map() });
    expect(items).toEqual([]);
  });
});

// P5-T07: `adaptExecutedReviewQueue` is `adaptReviewQueue`'s plan-aware sibling
// — see queue-adapter.ts's module doc for why it is a second function rather
// than a signature change (packages/workbench calls the original, unowned by
// this lane).
describe('adaptExecutedReviewQueue — the executed selectionContext passes through untouched', () => {
  it('with no plan, matches adaptReviewQueue item for item (Phase A parity)', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const composedQueue = composedQueueFor(session);
    const executed = executeStudyPlan({ queue: composedQueue, plan: null });

    // Same fixed source for both calls — MCQ sampling is per-showing (F2.15),
    // so two independently-seeded `Math.random` calls would disagree on an MCQ's
    // option order for a reason that has nothing to do with this comparison.
    const fixedRandom: RandomSource = { next: () => 0.42 };
    const viaQueue = adaptReviewQueue({
      queue: composedQueue,
      recordsById: session.recordsById,
      random: fixedRandom,
    });
    const viaExecuted = adaptExecutedReviewQueue({
      items: executed.items,
      recordsById: session.recordsById,
      random: fixedRandom,
    });

    expect(viaExecuted).toEqual(viaQueue);
  });

  it('carries a real planVersion through, unlike adaptReviewQueue, which cannot see one', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const first = composedQueueFor(session).items[0];
    if (first === undefined) throw new Error('expected a composed item');

    const plan = {
      envelopeVersion: 1 as const,
      kind: 'study-plan' as const,
      bodyVersion: 1 as const,
      policyVersion: 'sp1-test0000000002',
      computedAt: '2026-08-20T09:00:00-04:00',
      freshForSeconds: 3600,
      governsForSeconds: 86_400,
      body: {
        asOf: '2026-08-20',
        courses: [
          {
            course: 'TEST101',
            status: 'ranked' as const,
            concepts: first.conceptIds.map((conceptId, index) => ({
              conceptId,
              rank: index + 1,
              weight: 10 - index,
              examProximityDays: 5,
              reasoning: 'test reasoning',
              citations: [{ sourcePath: '03 Research/paper.md', questionLabel: 'Q1' }],
            })),
          },
        ],
      },
    };

    const executed = executeStudyPlan({ queue: composedQueueFor(session), plan });
    const items = adaptExecutedReviewQueue({
      items: executed.items,
      recordsById: session.recordsById,
    });

    const adapted = items.find((i) => i.instrument.instrumentId === first.instrumentId);
    expect(adapted?.selectionContext.planVersion).toBe(plan.policyVersion);
    expect(adapted?.selectionContext.yieldRank).toBe(1);
  });
});

// [SESS-8.3] `ol-egov.132.3`, `docs/dev/one-assembly-path.md` row 3:
// `plan/execute.ts` gains a second entry, `executeStudyPlanOverComposedRows`,
// that runs the same join as `executeStudyPlan` but never reorders. This
// adapter needs no change for that — it already just walks `input.items` in
// the order given and passes `selectionContext` through verbatim (see this
// file's module doc). Proven here by hand-building a `PlannedQueueItem[]` in
// an order a weight sort would reverse, rather than importing the new
// function: it has no barrel export yet, by design — row 4 (`ol-egov.132.4`)
// is its first real caller.
describe('adaptExecutedReviewQueue accepts a composed-rows result unchanged in shape (SESS-8.3)', () => {
  it('preserves whatever order the executed items arrive in, course blocks intact', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const composedQueue = composedQueueFor(session);
    expect(composedQueue.items.length).toBeGreaterThanOrEqual(3);

    // Reverse of the composed queue's own order — stands in for a composed
    // session having decided a different (course-blocked) order than plain
    // FSRS due order would. The adapter must not disturb it either way.
    const reversed = [...composedQueue.items].reverse();
    const composedOrderItems: readonly PlannedQueueItem[] = reversed.map((q) => ({
      instrumentId: q.instrumentId,
      instrumentType: q.instrumentType,
      conceptIds: q.conceptIds,
      priorState: q.priorState,
      selectionContext: { ...q.selectionContext, planVersion: null },
      planWeight: null,
    }));

    const adapted = adaptExecutedReviewQueue({
      items: composedOrderItems,
      recordsById: session.recordsById,
    });

    expect(adapted.map((i) => i.instrument.instrumentId)).toEqual(
      reversed.map((q) => q.instrumentId),
    );
    expect(adapted.map((i) => i.instrument.instrumentId)).not.toEqual(
      composedQueue.items.map((q) => q.instrumentId),
    );
  });
});

// `[D-240]` item 5 (`ol-egov.130`), `ol-2zfj.67` [SESS-6]: both adapters carry
// `QueueItem.dedupeReason`/`PlannedQueueItem.dedupeReason` through verbatim —
// same "read straight off the queue, never derived here" discipline this
// file's other pass-through fields already follow.
describe('both adapters carry dedupeReason through verbatim ([D-240] item 5)', () => {
  it('adaptReviewQueue carries dedupeReason when the composed item set one, and omits it otherwise', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const [first, ...rest] = composedQueueFor(session).items;
    if (first === undefined) throw new Error('expected a composed item');

    const items = adaptReviewQueue({
      queue: { items: [{ ...first, dedupeReason: 'recall-overdue' }, ...rest], deferred: [] },
      recordsById: session.recordsById,
    });
    const adapted = items.find((i) => i.instrument.instrumentId === first.instrumentId);
    expect(adapted?.dedupeReason).toBe('recall-overdue');
    // Never fabricated for an item the queue set nothing on.
    for (const item of items.slice(1)) {
      expect(item.dedupeReason).toBeUndefined();
      expect(Object.hasOwn(item, 'dedupeReason')).toBe(false);
    }
  });

  it('adaptExecutedReviewQueue carries the same field through PlannedQueueItem', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const [first, ...rest] = composedQueueFor(session).items;
    if (first === undefined) throw new Error('expected a composed item');

    const executed = executeStudyPlan({
      queue: { items: [{ ...first, dedupeReason: 'format-match' }, ...rest], deferred: [] },
      plan: null,
    });
    const items = adaptExecutedReviewQueue({
      items: executed.items,
      recordsById: session.recordsById,
    });
    const adapted = items.find((i) => i.instrument.instrumentId === first.instrumentId);
    expect(adapted?.dedupeReason).toBe('format-match');
  });
});

// F2.22 (`[D-331]`, `[D-374]`, `ol-3ux7.5.57.14.58`): both adapters map
// `rankedReasonsById` onto `ReviewQueueItem.rankedReason` verbatim, by
// `instrumentId` — same "read straight off the pre-fetched map, never
// derived here" discipline `distractorProvenanceById` already follows,
// because neither `QueueItem` nor `PlannedQueueItem` carries the field
// itself (see this file's module doc for exactly where the production path
// loses it before it would reach here).
describe('both adapters map rankedReasonsById onto rankedReason, never fabricating one (F2.22)', () => {
  it('adaptReviewQueue carries the reason for the named instrument, and omits it for every other item', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const [first, ...rest] = composedQueueFor(session).items;
    if (first === undefined) throw new Error('expected a composed item');

    const items = adaptReviewQueue({
      queue: { items: [first, ...rest], deferred: [] },
      recordsById: session.recordsById,
      rankedReasonsById: new Map([
        [first.instrumentId, 'It is overdue and blocks two later concepts.'],
      ]),
    });
    const adapted = items.find((i) => i.instrument.instrumentId === first.instrumentId);
    expect(adapted?.rankedReason).toBe('It is overdue and blocks two later concepts.');
    // Never fabricated for an item the map names nothing for.
    for (const item of items) {
      if (item.instrument.instrumentId === first.instrumentId) continue;
      expect(item.rankedReason).toBeUndefined();
      expect(Object.hasOwn(item, 'rankedReason')).toBe(false);
    }
  });

  it('omitting rankedReasonsById leaves every item without a rankedReason — every caller today', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const items = adaptReviewQueue({
      queue: composedQueueFor(session),
      recordsById: session.recordsById,
    });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Object.hasOwn(item, 'rankedReason')).toBe(false);
    }
  });

  it('adaptExecutedReviewQueue carries the same field through PlannedQueueItem', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const [first, ...rest] = composedQueueFor(session).items;
    if (first === undefined) throw new Error('expected a composed item');

    const executed = executeStudyPlan({
      queue: { items: [first, ...rest], deferred: [] },
      plan: null,
    });
    const items = adaptExecutedReviewQueue({
      items: executed.items,
      recordsById: session.recordsById,
      rankedReasonsById: new Map([
        [first.instrumentId, 'It is overdue and blocks two later concepts.'],
      ]),
    });
    const adapted = items.find((i) => i.instrument.instrumentId === first.instrumentId);
    expect(adapted?.rankedReason).toBe('It is overdue and blocks two later concepts.');
  });
});

// [SUPP-3] (`ol-lpl4`): row 3.9's chooser input, built from raw review-log
// entries and threaded through both adapters — the live queue's equivalent of
// `study-session/build.ts`'s composition-time wiring ([SUPP-2], `ol-95vv.4`).
//
// `explainBackGrade` (`ol-egov.141.89.9.20`): present only for an
// `'explain-back'` entry, and only when the caller wants a GRADED one —
// omitted entirely produces an ungraded entry (`rating` stays `null` per
// F2.16, and no `explainBackGrade` at all), the shape
// `buildSupportLevelHistoryLookup` must skip rather than guess at.
function reviewLogEntry(overrides: {
  readonly eventId: string;
  readonly timestamp: string;
  readonly instrumentType: 'qa' | 'cloze' | 'mcq' | 'explain-back';
  readonly rating: 'again' | 'hard' | 'good' | 'easy' | null;
  readonly conceptIds: readonly string[];
  readonly explainBackGrade?: {
    readonly soloLevel:
      | 'prestructural'
      | 'unistructural'
      | 'multistructural'
      | 'relational'
      | 'extended-abstract';
    readonly correctness?: 'correct' | 'partial' | 'incorrect';
  };
}) {
  return {
    schemaVersion: 5 as const,
    kind: 'review' as const,
    eventId: overrides.eventId,
    timestamp: overrides.timestamp,
    instrumentId: `inst-${overrides.eventId}`,
    instrumentType: overrides.instrumentType,
    rating: overrides.rating,
    wasUnsure: false,
    durationMs: null,
    selectionContext: {
      dueState: 'new' as const,
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [overrides.instrumentType],
      planVersion: null,
    },
    conceptIds: [...overrides.conceptIds],
    ...(overrides.explainBackGrade !== undefined
      ? {
          explainBackGrade: {
            soloLevel: overrides.explainBackGrade.soloLevel,
            contentRef: `content:${overrides.eventId}`,
            revisionOf: null,
            artifactProvenance: {
              taskId: 'grade.explain-back.v1',
              promptVersion: '2026-08-26',
              modelId: 'workers-ai:test-model',
            },
            ...(overrides.explainBackGrade.correctness !== undefined
              ? { correctness: overrides.explainBackGrade.correctness }
              : {}),
          },
        }
      : {}),
  };
}

describe('buildSupportLevelHistoryLookup — folds raw review-log entries into row 3.9’s chooser input', () => {
  it('an empty log offers no outcomes for any concept or tier', () => {
    const lookup = buildSupportLevelHistoryLookup([]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([]);
    expect(lookup.outcomesFor('concept-a', 'explanation')).toEqual([]);
  });

  it('an "again" qa/cloze rating derives a wrong-concept failure at the recall tier', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'qa',
        rating: 'again',
        conceptIds: ['concept-a'],
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
  });

  it('a non-"again" rating derives no failure at all', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'cloze',
        rating: 'good',
        conceptIds: ['concept-a'],
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: false },
    ]);
  });

  it('an mcq review contributes no outcome at all — [D-094] gives recognition no ladder', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'mcq',
        rating: 'again',
        conceptIds: ['concept-a'],
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([]);
  });

  it('a review with no rating (schema-nullable) is skipped rather than guessed at', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'qa',
        rating: null,
        conceptIds: ['concept-a'],
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([]);
  });

  it('a multi-concept review is folded into every one of its concepts', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'qa',
        rating: 'again',
        conceptIds: ['concept-a', 'concept-b'],
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toHaveLength(1);
    expect(lookup.outcomesFor('concept-b', 'recall')).toHaveLength(1);
  });

  it('outcomes come back oldest-first, matching the entries’ own order', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-01T09:00:00+00:00',
        instrumentType: 'qa',
        rating: 'again',
        conceptIds: ['concept-a'],
      }),
      reviewLogEntry({
        eventId: 'e2',
        timestamp: '2026-08-10T09:00:00+00:00',
        instrumentType: 'qa',
        rating: 'good',
        conceptIds: ['concept-a'],
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
      { failureShape: 'none', hintUptake: false },
    ]);
  });

  // att.md item 9 / [D-094] / C5.4: "[D-094] counts whole sessions and C5.4
  // defines a session as a cluster of reviews" — the fold must count SESSIONS,
  // never individual reviews, or two clean answers minutes apart recede
  // support twice as fast as the ruling allows.
  it('two reviews inside one sitting fold into a single session outcome, not two ([D-094], C5.4)', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'qa',
        rating: 'good',
        conceptIds: ['concept-a'],
      }),
      reviewLogEntry({
        eventId: 'e2',
        // 10 minutes later — well inside C5.4's 45-minute clustering gap, so
        // this is the SAME sitting as `e1`, not a second one.
        timestamp: '2026-08-18T09:10:00+00:00',
        instrumentType: 'qa',
        rating: 'good',
        conceptIds: ['concept-a'],
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: false },
    ]);
  });

  it('a sitting with both a clean and a failing review folds to the failing shape (att.md §2.6: escalate on any failure in the session)', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'qa',
        rating: 'good',
        conceptIds: ['concept-a'],
      }),
      reviewLogEntry({
        eventId: 'e2',
        timestamp: '2026-08-18T09:05:00+00:00',
        instrumentType: 'qa',
        rating: 'again',
        conceptIds: ['concept-a'],
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
  });

  it('two sittings 45+ minutes apart still fold into two separate outcomes', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'qa',
        rating: 'good',
        conceptIds: ['concept-a'],
      }),
      reviewLogEntry({
        eventId: 'e2',
        // 46 minutes later — just past the clustering gap, so this is a new sitting.
        timestamp: '2026-08-18T09:46:00+00:00',
        instrumentType: 'qa',
        rating: 'good',
        conceptIds: ['concept-a'],
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: false },
      { failureShape: 'none', hintUptake: false },
    ]);
  });
});

// `ol-egov.141.89.9.20`: the explain-back branch of the support history had
// no production caller — `buildSupportLevelHistoryLookup` filtered to
// `qa`/`cloze` only, so no explain-back review ever reached
// `deriveFailureShape`'s explain-back branch (fixed for correctness-before-
// depth by `ol-egov.141.89.9.17`, D-286, D-281). These tests are this
// lookup's REGRESSION coverage for that gap: each fails against the prior
// filter (`review.instrumentType !== 'qa' && ... !== 'cloze'` skipped every
// explain-back entry, so every `outcomesFor(..., 'explanation')` below came
// back `[]`) and passes once explain-back entries are folded at the
// `'explanation'` tier.
describe('explain-back reviews reach the support history, at the explanation tier ([D-094], D-286, D-281, ol-egov.141.89.9.20)', () => {
  it('an incorrect relational explanation lowers the ladder — correctness overrides depth', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a'],
        explainBackGrade: { soloLevel: 'relational', correctness: 'incorrect' },
      }),
    ]);
    // Failing-first: before the fix, this instrumentType was filtered out
    // entirely and the assertion below saw `[]`, not `[{ failureShape:
    // 'wrong-concept', ... }]`.
    expect(lookup.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
    // Never bleeds into the unrelated recall tier for the same concept.
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([]);
  });

  it('an unknown-correctness explanation never reads as a clean pass, even at a relational depth', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a'],
        // No `correctness` at all — a pre-D-286 single-pass grade. [D-281]:
        // read as unknown, capped at 'minor-slip', never promoted to 'none'
        // on depth alone.
        explainBackGrade: { soloLevel: 'relational' },
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'minor-slip', hintUptake: false },
    ]);
  });

  it('a confirmed correct, relational explanation reads as a clean pass', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a'],
        explainBackGrade: { soloLevel: 'relational', correctness: 'correct' },
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'none', hintUptake: false },
    ]);
  });

  it('an ungraded explain-back entry (no soloLevel) is skipped, not guessed at', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a'],
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'explanation')).toEqual([]);
  });

  it('a clean recall review and a failing explanation of the same concept in one sitting stay on their own tiers', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'qa',
        rating: 'good',
        conceptIds: ['concept-a'],
      }),
      reviewLogEntry({
        eventId: 'e2',
        // 5 minutes later — same sitting (C5.4's 45-minute gap).
        timestamp: '2026-08-18T09:05:00+00:00',
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a'],
        explainBackGrade: { soloLevel: 'prestructural', correctness: 'incorrect' },
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: false },
    ]);
    expect(lookup.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
  });
});

describe('supportLevel threads through both adapters ([SUPP-3])', () => {
  it('omitting supportHistory leaves every instrument’s supportLevel undefined — unchanged behaviour', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const items = adaptReviewQueue({
      queue: composedQueueFor(session),
      recordsById: session.recordsById,
    });
    for (const item of items) {
      expect(Object.hasOwn(item.instrument, 'supportLevel')).toBe(false);
    }
  });

  it('a qa/cloze item carries the chooser’s decision when supportHistory is supplied', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const qaRecord = [...session.recordsById.values()].find((r) => r.instrumentType === 'qa');
    if (qaRecord === undefined) throw new Error('expected a qa record');
    const conceptId = qaRecord.conceptIds[0];
    if (conceptId === undefined) throw new Error('expected the qa record to name a concept');

    // One escalation-triggering ("again") prior review for the qa card's
    // concept raises the ladder one rung off `[D-094]`'s 'prompted' cold
    // start — see `advanceSupportLevel`/`raiseSupportLevel`.
    const supportHistory = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'qa',
        rating: 'again',
        conceptIds: [conceptId],
      }),
    ]);

    const items = adaptReviewQueue({
      queue: composedQueueFor(session),
      recordsById: session.recordsById,
      supportHistory,
    });

    const qa = items.find((i) => i.instrument.type === 'qa');
    expect(qa?.instrument.supportLevel).toEqual({ level: 'guided', provenance: 'evidence-thin' });

    const mcq = items.find((i) => i.instrument.type === 'mcq');
    expect(Object.hasOwn(mcq?.instrument ?? {}, 'supportLevel')).toBe(false);
  });

  it('adaptExecutedReviewQueue threads the same decision through a planned item', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const qaRecord = [...session.recordsById.values()].find((r) => r.instrumentType === 'qa');
    if (qaRecord === undefined) throw new Error('expected a qa record');
    const conceptId = qaRecord.conceptIds[0];
    if (conceptId === undefined) throw new Error('expected the qa record to name a concept');

    const supportHistory = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'qa',
        rating: 'again',
        conceptIds: [conceptId],
      }),
    ]);

    // `executeStudyPlan` (out of this lane's ownership) rebuilds `PlannedQueueItem`
    // from `QueueItem` by an explicit field list — this asserts the decision
    // survives that reconstruction because it is computed here, in adaptation,
    // from `instrumentType`/`conceptIds`, both of which `executeStudyPlan`
    // preserves verbatim.
    const executed = executeStudyPlan({ queue: composedQueueFor(session), plan: null });
    const items = adaptExecutedReviewQueue({
      items: executed.items,
      recordsById: session.recordsById,
      supportHistory,
    });

    const qa = items.find((i) => i.instrument.type === 'qa');
    expect(qa?.instrument.supportLevel).toEqual({ level: 'guided', provenance: 'evidence-thin' });
  });

  it('supportSelfAssessment is ignored when supportHistory is not supplied', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const items = adaptReviewQueue({
      queue: composedQueueFor(session),
      recordsById: session.recordsById,
      supportSelfAssessment: 'confident',
    });
    for (const item of items) {
      expect(Object.hasOwn(item.instrument, 'supportLevel')).toBe(false);
    }
  });
});

// `ol-v7r5.35` / C5.8 (as amended by `[D-193]`): the freeze itself. Scenarios:
// features/F2-review.md, "C5.8 — The session holds still while it is open" —
// @auto:plugin/review/queue-adapter.spec
describe('createFrozenReviewQueue — C5.8’s freeze, held across calls', () => {
  function twoNoteVault(): VaultSource {
    return memoryVault({ 'Notes/qa.md': QA_NOTE, 'Notes/cloze.md': CLOZE_NOTE });
  }

  /** Adds a third, `MUS101` instrument — the "something comes due meanwhile" fixture. */
  function threeNoteVault(): VaultSource {
    return memoryVault({
      'Notes/qa.md': QA_NOTE,
      'Notes/cloze.md': CLOZE_NOTE,
      'Notes/mcq.md': MCQ_NOTE,
    });
  }

  async function buildExecuted(source: VaultSource) {
    const session = await buildReviewSession({
      vault: source,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const executed = executeStudyPlan({ queue: composedQueueFor(session), plan: null });
    return { items: executed.items, recordsById: session.recordsById };
  }

  it('composing the same session twice returns the identical list, never a fresh recompute', async () => {
    const composed = await buildExecuted(twoNoteVault());
    const queue = createFrozenReviewQueue({ now: () => NOW });

    const first = queue.open(composed);
    const second = queue.open(composed);

    expect(second).toBe(first);
  });

  it('an item that comes due after the session opens does not appear in it', async () => {
    const opening = await buildExecuted(twoNoteVault());
    const laterState = await buildExecuted(threeNoteVault());
    const queue = createFrozenReviewQueue({ now: () => NOW });

    const opened = queue.open(opening);
    expect(opened.map((i) => i.instrument.type)).not.toContain('mcq');

    // Re-offered mid-session with the mcq now due — the freeze refuses it,
    // and hands back the exact list she opened with.
    const reoffered = queue.open(laterState);
    expect(reoffered).toBe(opened);
    expect(reoffered.map((i) => i.instrument.type)).not.toContain('mcq');
  });

  it('outrunning the target appends fresh items, never reordering or duplicating what is already there', async () => {
    const opening = await buildExecuted(twoNoteVault());
    const more = await buildExecuted(threeNoteVault());
    const queue = createFrozenReviewQueue({ now: () => NOW });

    const opened = queue.open(opening);
    const extended = queue.extend(more);

    // What she already had is still there, in the same order, untouched.
    expect(extended.slice(0, opened.length)).toEqual(opened);
    // Exactly the one genuinely new instrument (the mcq) was appended.
    expect(extended.length).toBe(opened.length + 1);
    expect(extended.map((i) => i.instrument.type)).toContain('mcq');

    // Extending again with the identical candidates adds nothing further —
    // every one of them is already in the list.
    const extendedAgain = queue.extend(more);
    expect(extendedAgain).toEqual(extended);
  });

  it('extending an unopened holder behaves like opening — nothing to append onto yet', async () => {
    const opening = await buildExecuted(twoNoteVault());
    const queue = createFrozenReviewQueue({ now: () => NOW });

    const extended = queue.extend(opening);
    expect(extended.map((i) => i.instrument.type)).toEqual(['cloze', 'qa']);
  });

  it('holds unconditionally before the idle threshold, even when the caller reports a material change', async () => {
    const opening = await buildExecuted(twoNoteVault());
    let now = NOW;
    const queue = createFrozenReviewQueue({ now: () => now, idleThresholdMs: 60_000 });

    const opened = queue.open(opening);
    now = new Date(NOW.getTime() + 1_000); // well under the threshold

    const held = queue.open({
      ...opening,
      staleness: {
        itemsDueInScope: true,
        materialArrivedInScope: false,
        assessmentProximityBandCrossedInScope: false,
      },
    });
    expect(held).toBe(opened);
  });

  it('holds past the idle threshold when its own composition has not materially changed', async () => {
    const opening = await buildExecuted(twoNoteVault());
    let now = NOW;
    const queue = createFrozenReviewQueue({ now: () => now, idleThresholdMs: 1_000 });

    const opened = queue.open(opening);
    now = new Date(NOW.getTime() + 2_000); // past the threshold

    const held = queue.open(opening);
    expect(held).toBe(opened);
  });

  it('a session gone stale past the idle threshold, with a material change, ends rather than holding — the next open recomposes', async () => {
    const opening = await buildExecuted(twoNoteVault());
    const laterState = await buildExecuted(threeNoteVault());
    let now = NOW;
    const queue = createFrozenReviewQueue({ now: () => now, idleThresholdMs: 1_000 });

    queue.open(opening);
    now = new Date(NOW.getTime() + 2_000); // past the threshold

    const result = queue.open({
      ...laterState,
      staleness: {
        itemsDueInScope: true,
        materialArrivedInScope: false,
        assessmentProximityBandCrossedInScope: false,
      },
    });

    // The stale session ended and a fresh one took its place — the item that
    // came due while it sat idle is now honestly part of a NEW session.
    expect(result.map((i) => i.instrument.type)).toContain('mcq');
  });

  it('close releases the freeze — the next open recomposes unconditionally', async () => {
    const opening = await buildExecuted(twoNoteVault());
    const laterState = await buildExecuted(threeNoteVault());
    const queue = createFrozenReviewQueue({ now: () => NOW });

    queue.open(opening);
    queue.close();
    const reopened = queue.open(laterState);

    expect(reopened.map((i) => i.instrument.type)).toContain('mcq');
  });

  // att.md item 9 / [D-186]: "an extension's levels are those fixed when the
  // session was composed, never re-read from the session in progress."
  describe('an extension’s support levels are fixed at composition ([D-186])', () => {
    function oneNoteVault(): VaultSource {
      return memoryVault({ 'Notes/qa.md': QA_NOTE });
    }

    it('a newly-appended item’s support level reads the history frozen at open, never a fresh read fed to extend', async () => {
      const opening = await buildExecuted(oneNoteVault());
      // The cloze note's concept (Beta) is not due until this vault grows —
      // this is the item `extend` appends mid-sitting.
      const more = await buildExecuted(twoNoteVault());
      const clozeRecord = [...more.recordsById.values()].find((r) => r.instrumentType === 'cloze');
      if (clozeRecord === undefined) throw new Error('expected a cloze record');
      const conceptId = clozeRecord.conceptIds[0];
      if (conceptId === undefined) throw new Error('expected the cloze record to name a concept');

      // At composition time, nothing has reviewed the cloze's concept yet —
      // [D-094]'s cold start is 'prompted'.
      const historyAtComposition = buildSupportLevelHistoryLookup([]);
      // Between composition and the extension she reviews, in THIS still-open
      // sitting, and misses — a fresh read of "the log as it now stands"
      // would raise the level. [D-186] says the extension must not see this.
      const historyAtExtension = buildSupportLevelHistoryLookup([
        reviewLogEntry({
          eventId: 'live-miss',
          timestamp: '2026-08-20T11:58:00+00:00',
          instrumentType: 'qa',
          rating: 'again',
          conceptIds: [conceptId],
        }),
      ]);

      const queue = createFrozenReviewQueue({ now: () => NOW });
      queue.open({ ...opening, supportHistory: historyAtComposition });
      const extended = queue.extend({ ...more, supportHistory: historyAtExtension });

      const cloze = extended.find((i) => i.instrument.type === 'cloze');
      // Fixed at composition: still the cold-start 'prompted', never the
      // 'guided' a fresh fold of `historyAtExtension` would produce.
      expect(cloze?.instrument.supportLevel).toEqual({
        level: 'prompted',
        provenance: 'evidence-thin',
      });
    });
  });
});
