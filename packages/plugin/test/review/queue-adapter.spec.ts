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
  chooseSupportLevel,
  composeQueue,
  createFsrsScheduler,
  executeStudyPlan,
  PRESENTED_OPTIONS,
  projectInstrumentValidity,
  provisionalConceptKey,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  adaptExecutedReviewQueue,
  adaptReviewQueue,
  buildSupportLevelHistoryLookup,
  createFrozenReviewQueue,
  HINT_UPTAKE_RECORDED,
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
          schemaVersion: 6,
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
      bodyVersion: 2 as const,
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
              citations: [
                {
                  basis: 'past-paper' as const,
                  sourcePath: '03 Research/paper.md',
                  questionLabel: 'Q1',
                },
              ],
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

// `[D-395]` condition 5 (review-log v6's `compositionId`, `olea-service`'s
// `ol-egov.141.89.10.65`): both adapters stamp `input.compositionId` verbatim
// onto every item they build — a single value for the whole call (never a
// per-instrument map, unlike `rankedReasonsById` above), because one call is
// one composed batch served under exactly one record.
describe('both adapters stamp compositionId onto every item, never fabricating one (D-395)', () => {
  it('adaptReviewQueue stamps the same id on every item when the caller supplies one', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const queue = composedQueueFor(session);
    const items = adaptReviewQueue({
      queue,
      recordsById: session.recordsById,
      compositionId: 'composition-key1:nonce-1',
    });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.compositionId).toBe('composition-key1:nonce-1');
    }
  });

  it('omitting compositionId leaves every item without one — a review outside a composed session', async () => {
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
      expect(item.compositionId).toBeUndefined();
      expect(Object.hasOwn(item, 'compositionId')).toBe(false);
    }
  });

  it('adaptExecutedReviewQueue carries the same field through PlannedQueueItem', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const executed = executeStudyPlan({ queue: composedQueueFor(session), plan: null });
    const items = adaptExecutedReviewQueue({
      items: executed.items,
      recordsById: session.recordsById,
      compositionId: 'composition-key1:nonce-1',
    });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.compositionId).toBe('composition-key1:nonce-1');
    }
  });

  // `[D-395]`: a "keep going" that grows an already-frozen sitting composes
  // its additions under a DIFFERENT call (the extension's own record), and
  // `extend` only ever appends what is not already present — the already-
  // frozen items must keep whatever id `open` stamped them with, never pick
  // up `extend`'s own value. Where the ruling says the record is unchanged
  // (nothing in the list changed), the id an item carries stays the same
  // one — this is the passthrough that makes that true, one call at a time.
  it("createFrozenReviewQueue: an item already frozen under one call keeps that call's id when extend runs under a different one", async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const executed = executeStudyPlan({ queue: composedQueueFor(session), plan: null });
    const frozen = createFrozenReviewQueue({ now: () => NOW });

    const opened = frozen.open({
      items: executed.items,
      recordsById: session.recordsById,
      compositionId: 'composition-key1:nonce-1',
    });
    expect(opened.length).toBeGreaterThan(0);
    for (const item of opened) {
      expect(item.compositionId).toBe('composition-key1:nonce-1');
    }

    // Re-`extend` with the SAME candidate list under a different call's id:
    // nothing new to append, so the frozen items are returned unchanged —
    // still carrying the FIRST call's id, never the second's.
    const extended = frozen.extend({
      items: executed.items,
      recordsById: session.recordsById,
      compositionId: 'composition-key1:nonce-2',
    });
    expect(extended).toBe(opened);
    for (const item of extended) {
      expect(item.compositionId).toBe('composition-key1:nonce-1');
    }
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
  /** v6's top-level verdict (`[D-303]`), written with no depth grade for a correctness-only record (`ol-ryrh`). */
  readonly explainBackCorrectness?: 'correct' | 'partial' | 'incorrect';
  /**
   * `[D-350]`: a review written today records an explicit true or false, so this defaults to
   * `false`; `'absent'` is a record older than the field, or a surface that did not observe it.
   */
  readonly hintOpened?: boolean | 'absent';
  /** Written only when given, as a real record's is only when a level was chosen. */
  readonly supportLevelShown?: 'independent' | 'prompted' | 'guided';
}) {
  return {
    schemaVersion: 6 as const,
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
    ...(overrides.hintOpened === 'absent' ? {} : { hintOpened: overrides.hintOpened ?? false }),
    ...(overrides.supportLevelShown !== undefined
      ? { supportLevelShown: overrides.supportLevelShown }
      : {}),
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
    ...(overrides.explainBackCorrectness !== undefined
      ? {
          explainBackCorrectness: {
            verdict: overrides.explainBackCorrectness,
            artifactProvenance: {
              taskId: 'grade.explain-back-correctness.v1',
              promptVersion: '2026-08-26',
              modelId: 'workers-ai:test-model',
            },
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

  // `ol-egov.141.89.9.73` (`[D-419]`, `[D-423]`): a review is a session outcome for the one concept
  // it scored — the first id of its own record — and for no concept it merely names as context.
  it('a multi-concept review is folded into its scored concept only, never into a context concept', () => {
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
    expect(lookup.outcomesFor('concept-b', 'recall')).toEqual([]);
  });

  it('a record written with another concept first credits that one, whatever the note lists today', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'qa',
        rating: 'again',
        conceptIds: ['concept-b', 'concept-a'],
      }),
    ]);
    expect(lookup.outcomesFor('concept-b', 'recall')).toHaveLength(1);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([]);
  });

  it('an explanation of a two-concept record is read at its scored concept only', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a', 'concept-b'],
        explainBackCorrectness: 'incorrect',
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'explanation')).toHaveLength(1);
    expect(lookup.outcomesFor('concept-b', 'explanation')).toEqual([]);
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
        // No `correctness` at all — a pre-D-286 single-pass grade, or a
        // correctness check that failed. [D-281]: never promoted to 'none' on
        // depth alone; and since the 2026-09-28 rulings (`ol-egov.141.89.9.66`)
        // never read as a slip of hers either: it has no reading.
        explainBackGrade: { soloLevel: 'relational' },
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'explanation')).toEqual([]);
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

// `ol-ryrh` (ruled 2026-09-27): a correctness verdict recorded without a depth
// grade counts wherever correctness alone counts (`ol-egov.141.89.6.59`).
// Escalation needs only a failure shape ([D-094] item 5), and [D-286] skips
// the depth pass for an incorrect verdict, so before this change an incorrect
// explanation never reached the explanation ladder at all. Fading needs depth
// evidence (F2.20), so a correct or partial verdict without depth is skipped.
describe('a correctness-only explain-back record on the support ladder (ol-ryrh, [D-094], [D-286], F2.20)', () => {
  it('an incorrect verdict with no depth grade escalates the explanation ladder', () => {
    const lookup = buildSupportLevelHistoryLookup([
      reviewLogEntry({
        eventId: 'e1',
        timestamp: '2026-08-18T09:00:00+00:00',
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a'],
        explainBackCorrectness: 'incorrect',
      }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
    expect(chooseSupportLevel(lookup.outcomesFor('concept-a', 'explanation')).level).toBe('guided');
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([]);
  });

  it.each(['correct', 'partial'] as const)(
    'a %s verdict with no depth grade is skipped, so it never recedes support',
    (verdict) => {
      const lookup = buildSupportLevelHistoryLookup([
        reviewLogEntry({
          eventId: 'e1',
          timestamp: '2026-08-18T09:00:00+00:00',
          instrumentType: 'explain-back',
          rating: null,
          conceptIds: ['concept-a'],
          explainBackCorrectness: verdict,
        }),
        reviewLogEntry({
          eventId: 'e2',
          timestamp: '2026-08-19T09:00:00+00:00',
          instrumentType: 'explain-back',
          rating: null,
          conceptIds: ['concept-a'],
          explainBackCorrectness: verdict,
        }),
      ]);
      expect(lookup.outcomesFor('concept-a', 'explanation')).toEqual([]);
    },
  );
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

// ---------------------------------------------------------------------------
// `ol-egov.141.89.9.66` — the rulings of 2026-09-28: only her own failures
// move the ladder (the same rule `packages/core/src/support-level/history.ts`
// folds). Ids are structural placeholders.
// ---------------------------------------------------------------------------

type LadderEntry = Parameters<typeof buildSupportLevelHistoryLookup>[0][number];

const LADDER_PROVENANCE = { taskId: 't', promptVersion: 'v0', modelId: 'm' } as const;

function missOn(eventId: string, timestamp: string, instrumentId: string): LadderEntry {
  return {
    ...reviewLogEntry({
      eventId,
      timestamp,
      instrumentType: 'qa',
      rating: 'again',
      conceptIds: ['concept-a'],
    }),
    instrumentId,
  } as unknown as LadderEntry;
}

function standingEvent(
  kind: 'verdict' | 'suspend',
  instrumentId: string,
  timestamp: string,
  reason?: 'defect' | 'own-choice',
): LadderEntry {
  if (kind === 'verdict') {
    return {
      schemaVersion: 6,
      kind: 'verdict',
      eventId: `v-${instrumentId}`,
      timestamp,
      instrumentId,
      instrumentType: 'qa',
      conceptIds: ['concept-a'],
      verdict: 'rejected',
    } as unknown as LadderEntry;
  }
  return {
    schemaVersion: 6,
    kind: 'suspend',
    eventId: `s-${instrumentId}`,
    timestamp,
    instrumentId,
    conceptIds: ['concept-a'],
    ...(reason !== undefined ? { reason } : {}),
  } as unknown as LadderEntry;
}

describe('buildSupportLevelHistoryLookup — only her own failures move the ladder (ol-egov.141.89.9.66)', () => {
  it('rule 1: a miss on an instrument she suspended (her choice, or no reason) still counts', () => {
    for (const reason of ['own-choice', undefined] as const) {
      const lookup = buildSupportLevelHistoryLookup([
        missOn('m1', '2026-08-18T09:00:00+00:00', 'qa:w'),
        standingEvent('suspend', 'qa:w', '2026-08-18T10:00:00+00:00', reason),
      ]);
      expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([
        { failureShape: 'wrong-concept', hintUptake: false },
      ]);
    }
  });

  it('rule 1: a miss on a rejected or defective instrument is not read as hers', () => {
    for (const standing of [
      standingEvent('verdict', 'qa:w', '2026-08-18T10:00:00+00:00'),
      standingEvent('suspend', 'qa:w', '2026-08-18T10:00:00+00:00', 'defect'),
    ]) {
      const lookup = buildSupportLevelHistoryLookup([
        missOn('m1', '2026-08-18T09:00:00+00:00', 'qa:w'),
        standing,
      ]);
      expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([]);
    }
  });

  it('rule 2: a miss whose grade a contest proved wrong is skipped; a corrective re-grade stands in for its grade', () => {
    const entries = [
      missOn('m1', '2026-08-18T09:00:00+00:00', 'qa:c'),
      missOn('m2', '2026-08-20T09:00:00+00:00', 'qa:c'),
    ];
    const validity = projectInstrumentValidity(entries, [
      {
        schemaVersion: 6,
        kind: 'dispute',
        eventId: 'd1',
        timestamp: '2026-08-20T09:01:00+00:00',
        claimKind: 'grade',
        claimRendering: 'explain-back-grade',
        conceptIds: ['concept-a'],
        instrumentId: 'qa:c',
        evidenceBasis: 'basis-1',
        effect: 'quarantined',
      },
      {
        schemaVersion: 6,
        kind: 'dispute',
        eventId: 'd2',
        timestamp: '2026-08-22T09:00:00+00:00',
        claimKind: 'grade',
        claimRendering: 'explain-back-grade',
        conceptIds: ['concept-a'],
        instrumentId: 'qa:c',
        evidenceBasis: 'basis-1',
        effect: 'quarantined',
        resolves: 'd1',
        outcome: 'corrected',
      },
    ] as Parameters<typeof projectInstrumentValidity>[1]);
    const lookup = buildSupportLevelHistoryLookup(entries, validity);
    // m1 (a separate, sound session) stands; m2's proven-wrong grade does not.
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);

    const original = reviewLogEntry({
      eventId: 'e1',
      timestamp: '2026-08-18T09:00:00+00:00',
      instrumentType: 'explain-back',
      rating: null,
      conceptIds: ['concept-a'],
      explainBackGrade: { soloLevel: 'relational', correctness: 'correct' },
    });
    const regrade = {
      ...reviewLogEntry({
        eventId: 'e2',
        timestamp: '2026-08-25T09:00:00+00:00',
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a'],
        explainBackCorrectness: 'incorrect',
      }),
      instrumentId: original.instrumentId,
      explainBackGrade: {
        soloLevel: 'multistructural',
        contentRef: 'content:e2',
        revisionOf: 'e1',
        artifactProvenance: LADDER_PROVENANCE,
      },
    };
    const regraded = buildSupportLevelHistoryLookup([original, regrade] as LadderEntry[]);
    expect(regraded.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
  });

  it('rule 5: a failed correctness check neither escalates nor breaks her clean run', () => {
    const clean = (eventId: string, timestamp: string) =>
      reviewLogEntry({
        eventId,
        timestamp,
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a'],
        explainBackGrade: { soloLevel: 'relational', correctness: 'correct' },
      });
    const lookup = buildSupportLevelHistoryLookup([
      clean('e1', '2026-08-18T09:00:00+00:00'),
      reviewLogEntry({
        eventId: 'e2',
        timestamp: '2026-08-19T09:00:00+00:00',
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a'],
        explainBackGrade: { soloLevel: 'multistructural' },
      }),
      clean('e3', '2026-08-20T09:00:00+00:00'),
    ]);
    expect(lookup.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'none', hintUptake: false },
      { failureShape: 'none', hintUptake: false },
    ]);
  });
});

// `[D-350]` (ol-egov.141.89.9.13, ruled 2026-09-25; built in ol-egov.141.89.9.83). The ruling's
// operative sentences: "Change the legacy default. Add the hint-opened field, but treat a missing
// value as unknown." and "Absence of a record cannot establish unaided performance. ... record
// explicit true or false for new reviews." This is the production fold (wired at
// `review/open-session.ts` and `session-builder/provider.ts`); the core fold folds the same rule.
//
// The ruled reading is HELD in production until a review surface writes the field
// (`HINT_UPTAKE_RECORDED`, `ol-egov.141.63`; the next describe pins the held path), so this block
// forces the switch on: the ruled path stays tested, and stays correct, for the day it is flipped.
describe('buildSupportLevelHistoryLookup — hint state is three-valued ([D-350], switch forced on)', () => {
  const ruledLookup = (entries: readonly LadderEntry[]) =>
    buildSupportLevelHistoryLookup(entries, undefined, true);
  const day = (n: number) => `2026-08-${String(10 + n).padStart(2, '0')}T09:00:00+00:00`;
  const recallReview = (
    n: number,
    extra: Partial<Parameters<typeof reviewLogEntry>[0]> = {},
  ): LadderEntry =>
    reviewLogEntry({
      eventId: `h${n}`,
      timestamp: day(n),
      instrumentType: 'qa',
      rating: 'good',
      conceptIds: ['concept-a'],
      supportLevelShown: 'prompted',
      ...extra,
    }) as unknown as LadderEntry;
  const levelOf = (entries: LadderEntry[], concept = 'concept-a') =>
    chooseSupportLevel(ruledLookup(entries).outcomesFor(concept, 'recall')).level;

  it('an opened hint on a prompted recall success reads as taken; a recorded not-opened as not taken', () => {
    expect(
      ruledLookup([recallReview(0, { hintOpened: true })]).outcomesFor('concept-a', 'recall'),
    ).toEqual([{ failureShape: 'none', hintUptake: true }]);
    expect(
      ruledLookup([recallReview(0, { hintOpened: false })]).outcomesFor('concept-a', 'recall'),
    ).toEqual([{ failureShape: 'none', hintUptake: false }]);
  });

  it('an absent value on a prompted or guided answer is unknown, never not opened', () => {
    for (const supportLevelShown of ['prompted', 'guided'] as const) {
      const lookup = ruledLookup([recallReview(0, { hintOpened: 'absent', supportLevelShown })]);
      expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([
        { failureShape: 'none', hintUptake: 'unknown' },
      ]);
    }
  });

  it('an absent value on a record with no support level is unknown, never inferred', () => {
    const entry = reviewLogEntry({
      eventId: 'h0',
      timestamp: day(0),
      instrumentType: 'qa',
      rating: 'good',
      conceptIds: ['concept-a'],
      hintOpened: 'absent',
    }) as unknown as LadderEntry;
    expect(ruledLookup([entry]).outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: 'unknown' },
    ]);
  });

  it('an answer shown at independent support has no hint to open: absent reads not opened (J5)', () => {
    const lookup = ruledLookup([
      recallReview(0, { hintOpened: 'absent', supportLevelShown: 'independent' }),
    ]);
    expect(lookup.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: false },
    ]);
  });

  it('the explanation tier reads the field the same way', () => {
    const explanation = (n: number, hintOpened: boolean | 'absent') =>
      reviewLogEntry({
        eventId: `x${n}`,
        timestamp: day(n),
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a'],
        explainBackGrade: { soloLevel: 'relational', correctness: 'correct' },
        supportLevelShown: 'prompted',
        hintOpened,
      }) as unknown as LadderEntry;
    const lookup = ruledLookup([
      explanation(0, true),
      explanation(2, 'absent'),
      explanation(4, false),
    ]);
    expect(lookup.outcomesFor('concept-a', 'explanation').map((o) => o.hintUptake)).toEqual([
      true,
      'unknown',
      false,
    ]);
  });

  it('one session reads the worst state shown: opened, then unknown, then not opened', () => {
    const sitting = (states: readonly (boolean | 'absent')[]) =>
      states.map((hintOpened, i) =>
        reviewLogEntry({
          eventId: `s${i}`,
          timestamp: `2026-08-10T09:0${i}:00+00:00`,
          instrumentType: 'qa',
          rating: 'good',
          conceptIds: ['concept-a'],
          supportLevelShown: 'prompted',
          hintOpened,
        }),
      ) as unknown as LadderEntry[];
    const read = (states: readonly (boolean | 'absent')[]) =>
      ruledLookup(sitting(states)).outcomesFor('concept-a', 'recall')[0]?.hintUptake;
    expect(read([false, false])).toBe(false);
    expect(read([false, 'absent'])).toBe('unknown');
    expect(read([false, true])).toBe(true);
    expect(read(['absent', true])).toBe(true);
  });

  it('two clean sessions with the hint recorded not opened recede; opened or unknown hold the level', () => {
    expect(levelOf([recallReview(0), recallReview(2)])).toBe('independent');
    expect(
      levelOf([recallReview(0, { hintOpened: true }), recallReview(2, { hintOpened: true })]),
    ).toBe('prompted');
    expect(
      levelOf([
        recallReview(0, { hintOpened: 'absent' }),
        recallReview(2, { hintOpened: 'absent' }),
      ]),
    ).toBe('prompted');
    expect(
      levelOf([recallReview(0), recallReview(2, { hintOpened: 'absent' }), recallReview(4)]),
    ).toBe('prompted');
  });

  it('absence of a record never recedes a guided cell, and a failure escalates whatever the state', () => {
    const failure = recallReview(0, { rating: 'again', hintOpened: 'absent' });
    expect(levelOf([failure])).toBe('guided');
    expect(
      levelOf([
        failure,
        ...[2, 4, 6].map((n) =>
          recallReview(n, { supportLevelShown: 'guided', hintOpened: 'absent' }),
        ),
      ]),
    ).toBe('guided');
    expect(
      levelOf([
        failure,
        ...[2, 4, 6].map((n) =>
          recallReview(n, { supportLevelShown: 'guided', hintOpened: false }),
        ),
      ]),
    ).toBe('prompted');
  });
});

// The production path while the `[D-350]` reading is HELD (`ol-egov.141.89.9.83`,
// `ol-egov.141.63`). No review surface writes `hintOpened` yet, so reading it as three-valued in
// production makes the support level unable to recede: an unrecorded hint holds every prompted
// cell for good (a replay of simulated terms found none ending independent, and readiness and
// demand-met reading less). The ruling assumed the writer exists, so the
// reader alone is held behind `HINT_UPTAKE_RECORDED` and production reads exactly what it read
// before bd56859f: uptake `false` on every outcome, whatever the record says. Flip the switch to
// `true` when the writer lands, and delete this block with that commit; the block above keeps the
// ruled path tested meanwhile.
describe('buildSupportLevelHistoryLookup — production default while the [D-350] reading is held', () => {
  const day = (n: number) => `2026-08-${String(10 + n).padStart(2, '0')}T09:00:00+00:00`;
  const recallReview = (
    n: number,
    extra: Partial<Parameters<typeof reviewLogEntry>[0]> = {},
  ): LadderEntry =>
    reviewLogEntry({
      eventId: `p${n}`,
      timestamp: day(n),
      instrumentType: 'qa',
      rating: 'good',
      conceptIds: ['concept-a'],
      supportLevelShown: 'prompted',
      ...extra,
    }) as unknown as LadderEntry;
  const outcomes = (entries: LadderEntry[]) =>
    buildSupportLevelHistoryLookup(entries).outcomesFor('concept-a', 'recall');
  const levelOf = (entries: LadderEntry[]) => chooseSupportLevel(outcomes(entries)).level;

  it('the switch is off until the writer of hintOpened lands', () => {
    expect(HINT_UPTAKE_RECORDED).toBe(false);
  });

  it('reads uptake false on every outcome, whatever hintOpened says or omits', () => {
    for (const hintOpened of [true, false, 'absent'] as const) {
      for (const supportLevelShown of ['independent', 'prompted', 'guided'] as const) {
        expect(outcomes([recallReview(0, { hintOpened, supportLevelShown })])).toEqual([
          { failureShape: 'none', hintUptake: false },
        ]);
      }
    }
    const noLevel = reviewLogEntry({
      eventId: 'p0',
      timestamp: day(0),
      instrumentType: 'qa',
      rating: 'good',
      conceptIds: ['concept-a'],
      hintOpened: 'absent',
    }) as unknown as LadderEntry;
    expect(outcomes([noLevel])).toEqual([{ failureShape: 'none', hintUptake: false }]);
  });

  it('a session reads false however its answers differ', () => {
    const sitting = ([true, 'absent', false] as const).map((hintOpened, i) =>
      reviewLogEntry({
        eventId: `s${i}`,
        timestamp: `2026-08-10T09:0${i}:00+00:00`,
        instrumentType: 'qa',
        rating: 'good',
        conceptIds: ['concept-a'],
        supportLevelShown: 'prompted',
        hintOpened,
      }),
    ) as unknown as LadderEntry[];
    expect(outcomes(sitting)).toEqual([{ failureShape: 'none', hintUptake: false }]);
  });

  it('two clean sessions recede, with the hint field absent or opened, as before the ruling was built', () => {
    expect(
      levelOf([
        recallReview(0, { hintOpened: 'absent' }),
        recallReview(2, { hintOpened: 'absent' }),
      ]),
    ).toBe('independent');
    expect(
      levelOf([recallReview(0, { hintOpened: true }), recallReview(2, { hintOpened: true })]),
    ).toBe('independent');
    expect(levelOf([recallReview(0), recallReview(2)])).toBe('independent');
  });

  it('a failure still escalates, and a guided cell still recedes after clean sessions with no hint state', () => {
    const failure = recallReview(0, { rating: 'again', hintOpened: 'absent' });
    expect(levelOf([failure])).toBe('guided');
    expect(
      levelOf([
        failure,
        ...[2, 4, 6].map((n) =>
          recallReview(n, { supportLevelShown: 'guided', hintOpened: 'absent' }),
        ),
      ]),
    ).toBe('prompted');
  });

  it('the default is the switch: forcing it off gives the same lookup, forcing it on does not', () => {
    const entries = [
      recallReview(0, { hintOpened: 'absent' }),
      recallReview(2, { hintOpened: 'absent' }),
    ];
    const read = (lookup: ReturnType<typeof buildSupportLevelHistoryLookup>) =>
      lookup.outcomesFor('concept-a', 'recall');
    expect(read(buildSupportLevelHistoryLookup(entries))).toEqual(
      read(buildSupportLevelHistoryLookup(entries, undefined, false)),
    );
    expect(read(buildSupportLevelHistoryLookup(entries))).not.toEqual(
      read(buildSupportLevelHistoryLookup(entries, undefined, true)),
    );
  });
});
