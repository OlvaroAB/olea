// Scenarios: features/F2-review.md, "F2.15 — The adapter presents what the queue
// chose, and invents nothing" — @auto:plugin/review/queue-adapter.spec
//
// Everything below composes a real session out of a small in-memory vault
// through `olea-core`'s `buildReviewSession`, rather than hand-building a
// `ComposedQueue`. Hand-building it would test the adapter against the shape
// this file believes the composer produces, which is exactly the coupling the
// adapter exists to remove.
import type { RandomSource, VaultSource } from 'olea-core';
import {
  buildReviewSession,
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

async function adapt(options: { readonly random?: RandomSource } = {}) {
  const session = await buildReviewSession({
    vault: vault(),
    scheduler: createFsrsScheduler(),
    now: NOW,
  });
  return adaptReviewQueue({
    queue: session.queue,
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
    const items = adaptReviewQueue({ queue: session.queue, recordsById: session.recordsById });
    for (const [index, item] of items.entries()) {
      const queued = session.queue.items[index];
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

    const items = adaptReviewQueue({ queue: session.queue, recordsById: session.recordsById });
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
    const items = adaptReviewQueue({ queue: session.queue, recordsById: session.recordsById });
    expect(items.map((i) => i.instrument.instrumentId)).toEqual(
      session.queue.items.map((i) => i.instrumentId),
    );
    for (const deferral of session.queue.deferred) {
      expect(items.map((i) => i.instrument.instrumentId)).not.toContain(deferral.instrumentId);
    }
  });

  it('an item with no matching record is skipped rather than rendered blank', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const items = adaptReviewQueue({ queue: session.queue, recordsById: new Map() });
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
    const executed = executeStudyPlan({ queue: session.queue, plan: null });

    // Same fixed source for both calls — MCQ sampling is per-showing (F2.15),
    // so two independently-seeded `Math.random` calls would disagree on an MCQ's
    // option order for a reason that has nothing to do with this comparison.
    const fixedRandom: RandomSource = { next: () => 0.42 };
    const viaQueue = adaptReviewQueue({
      queue: session.queue,
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
    const first = session.queue.items[0];
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

    const executed = executeStudyPlan({ queue: session.queue, plan });
    const items = adaptExecutedReviewQueue({
      items: executed.items,
      recordsById: session.recordsById,
    });

    const adapted = items.find((i) => i.instrument.instrumentId === first.instrumentId);
    expect(adapted?.selectionContext.planVersion).toBe(plan.policyVersion);
    expect(adapted?.selectionContext.yieldRank).toBe(1);
  });
});

// [SUPP-3] (`ol-lpl4`): row 3.9's chooser input, built from raw review-log
// entries and threaded through both adapters — the live queue's equivalent of
// `study-session/build.ts`'s composition-time wiring ([SUPP-2], `ol-95vv.4`).
function reviewLogEntry(overrides: {
  readonly eventId: string;
  readonly timestamp: string;
  readonly instrumentType: 'qa' | 'cloze' | 'mcq';
  readonly rating: 'again' | 'hard' | 'good' | 'easy' | null;
  readonly conceptIds: readonly string[];
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
});

describe('supportLevel threads through both adapters ([SUPP-3])', () => {
  it('omitting supportHistory leaves every instrument’s supportLevel undefined — unchanged behaviour', async () => {
    const session = await buildReviewSession({
      vault: vault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const items = adaptReviewQueue({ queue: session.queue, recordsById: session.recordsById });
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
      queue: session.queue,
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
    const executed = executeStudyPlan({ queue: session.queue, plan: null });
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
      queue: session.queue,
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
    const executed = executeStudyPlan({ queue: session.queue, plan: null });
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
});
