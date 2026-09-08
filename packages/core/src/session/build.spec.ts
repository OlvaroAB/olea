// Scenarios: features/F2-review.md, "F2.14 — One entry point composes a session
// from a vault" and "F2.14 — Containment co-presence is filtered at
// composition (C7.9)" — @auto:core/session/build.spec. F2.19's own reachability
// coverage below is @auto:core/queue/block-order.spec's shape, reused at this
// integration level per `ol-vr8z`.
import type { ReviewLogEntry, SelectionContextV4 } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { memoryVault } from '../../test/session/memory-vault.js';
import { resolveAssessmentGroupingContext } from '../assessment/scope-concept-keys.js';
import type { AssessmentRecord } from '../assessment/types.js';
import { provisionalConceptKey } from '../concept/concept-key.js';
import { resolveRelatedConceptKeys } from '../concept/related-concept-keys.js';
import type { ConceptRelation } from '../concept/relation.js';
import type { ConceptRecord } from '../concept/types.js';
import { composeQueue } from '../queue/compose.js';
import { reviewLogPath } from '../review-log/path.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { StudySessionItem } from '../study-session/build.js';
import type { CalendarDay } from '../today/calendar-day.js';
import { calendarDayFromLocalDate } from '../today/calendar-day.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { buildReviewSession, queueItemsFromComposedSession } from './build.js';
import { toDueInstruments } from './due-instruments.js';
import { readReviewLogHistory } from './history.js';
import type { VaultInstrumentRecord } from './types.js';

/**
 * `[SESS-8.6]` (`ol-egov.132.6`): `session/build.ts` no longer resolves these
 * two `composeQueue` inputs itself (it no longer calls `composeQueue` at
 * all) — see `build.ts`'s own module doc. The tests below that still exercise
 * `composeQueue`'s cohort-ordering behaviour (real for the workbench and the
 * simulator, `packages/workbench/src/queue/derive.ts` /
 * `simulator/live-queue.ts`, per `docs/dev/one-assembly-path.md` §4) build the
 * two maps themselves, the same way that real caller does — never by
 * resurrecting the deleted resolution inside `build.ts`.
 */
function conceptSourcePathsByConceptKey(
  concepts: readonly ConceptRecord[],
): ReadonlyMap<string, readonly VaultPath[]> {
  return new Map(concepts.map((concept) => [concept.key, concept.sourcePaths]));
}

async function arrivalDaysByConceptKey(
  vault: VaultSource,
  concepts: readonly ConceptRecord[],
): Promise<ReadonlyMap<string, CalendarDay>> {
  const firstSeen = vault.firstSeen?.bind(vault);
  if (firstSeen === undefined) return new Map();
  const days = new Map<string, CalendarDay>();
  await Promise.all(
    concepts.map(async (concept) => {
      const stats = await Promise.all(concept.sourcePaths.map((path) => firstSeen(path)));
      const known = stats.filter((ms): ms is number => ms !== null);
      if (known.length === 0) return;
      days.set(concept.key, calendarDayFromLocalDate(new Date(Math.min(...known))));
    }),
  );
  return days;
}

/**
 * `ol-63e1`: every concept in `smallVault()` below is unbound (tier 2 — no
 * matching Zettelkasten note), so `VaultInstrumentRecord.conceptIds` and a
 * review-log record's `conceptIds` both carry this derived opaque key, never
 * the bare display name ('Alpha', 'Beta', 'Gamma').
 */
function unboundKey(name: string): string {
  return provisionalConceptKey({ name, boundNotePath: null });
}

const CONTEXT: SelectionContextV4 = {
  dueState: 'new',
  examProximity: null,
  yieldRank: null,
  instrumentTypesOffered: ['qa'],
  planVersion: null,
};

const NOW = new Date('2026-08-20T12:00:00Z');

function note(topic: string, course: string, body: readonly string[]): string {
  return ['---', `topic: [${topic}]`, `course: ${course}`, '---', '', ...body, ''].join('\n');
}

/** Two courses, three concepts, one concept carrying two instruments. */
function smallVault(): ReturnType<typeof memoryVault> {
  return memoryVault({
    'Courses/GEO/one.md': note('Alpha', 'GEO101', [
      '## First?',
      '',
      'Alpha front::Alpha back ^a1',
      '',
      'Alpha is ==layered== here.',
    ]),
    'Courses/GEO/two.md': note('Beta', 'GEO101', ['## Second?', '', 'Beta front::Beta back ^b1']),
    'Courses/MUS/three.md': note('Gamma', 'MUS101', [
      '## Third?',
      '',
      'Gamma front::Gamma back ^g1',
    ]),
  });
}

function reviewOf(
  eventId: string,
  timestamp: string,
  instrumentId: string,
  conceptId: string,
): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId,
    instrumentType: 'qa',
    conceptIds: [conceptId],
    rating: 'good',
    wasUnsure: false,
    durationMs: null,
    selectionContext: CONTEXT,
  };
}

// `[SESS-8.6]` (`ol-egov.132.6`): `buildReviewSession` no longer composes —
// see `build.ts`'s own module doc. Every test below that used to read
// `session.queue` now calls `composeQueue` directly over `session.candidates`
// — exactly `packages/workbench/src/queue/derive.ts`'s own real composition
// (buildReviewSession's enumeration, fed to composeQueue), which is what
// this integration coverage is FOR now that the review tab no longer is one.
describe('one entry point, an enumeration composeQueue can still be fed (`[SESS-8.6]`)', () => {
  it('every candidate resolves in `recordsById` — a caller composing over it never walks the vault again', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(session.instruments.records).toHaveLength(4);
    expect(session.candidates).toHaveLength(4);
    const queue = composeQueue({ candidates: session.candidates, now: NOW });
    for (const item of queue.items) {
      expect(session.recordsById.get(item.instrumentId)).toBeDefined();
    }
  });

  it('a concept with two instruments yields one item and one named deferral', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const queue = composeQueue({ candidates: session.candidates, now: NOW });

    const alphaItems = queue.items.filter((i) => i.conceptIds.includes(unboundKey('Alpha')));
    const alphaDeferred = queue.deferred.filter((d) => d.conceptIds.includes(unboundKey('Alpha')));
    expect(alphaItems).toHaveLength(1);
    expect(alphaDeferred).toHaveLength(1);
    expect(alphaDeferred[0]?.deferredBehind).toBe(alphaItems[0]?.instrumentId);
    expect(alphaItems[0]?.selectionContext.instrumentTypesOffered).toEqual(['qa', 'cloze']);
  });

  it('a never-reviewed instrument is offered as new, with a null prior state', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const queue = composeQueue({ candidates: session.candidates, now: NOW });
    for (const item of queue.items) {
      expect(item.selectionContext.dueState).toBe('new');
      expect(item.priorState).toBeNull();
      expect(item.selectionContext.yieldRank).toBeNull();
      expect(item.selectionContext.examProximity).toBeNull();
    }
  });

  it('an instrument with history carries the replayed state as its prior state', async () => {
    const vault = smallVault();
    const enumeration = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const gamma = enumeration.instruments.records.find((r) =>
      r.conceptIds.includes(unboundKey('Gamma')),
    );
    if (gamma === undefined) throw new Error('expected a Gamma instrument');

    const session = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
      entries: [
        reviewOf('e1', '2026-08-19T09:00:00+00:00', gamma.instrumentId, unboundKey('Gamma')),
      ],
    });
    const queue = composeQueue({ candidates: session.candidates, now: NOW });

    const item = queue.items.find((i) => i.instrumentId === gamma.instrumentId);
    // A Good the day before pushes it out of today's session entirely — which
    // is itself the proof that the replay reached composition.
    expect(item).toBeUndefined();
    expect(session.replay.states.get(gamma.instrumentId)?.state.reps).toBe(1);

    const later = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: new Date('2027-08-20T12:00:00Z'),
      entries: [
        reviewOf('e1', '2026-08-19T09:00:00+00:00', gamma.instrumentId, unboundKey('Gamma')),
      ],
    });
    const laterQueue = composeQueue({
      candidates: later.candidates,
      now: new Date('2027-08-20T12:00:00Z'),
    });
    const overdue = laterQueue.items.find((i) => i.instrumentId === gamma.instrumentId);
    expect(overdue?.selectionContext.dueState).toBe('overdue');
    expect(overdue?.priorState).not.toBeNull();
  });
});

describe('suspension, read from the whole log', () => {
  it('a suspended instrument is excluded, and unsuspending brings it back unchanged', async () => {
    const vault = smallVault();
    const base = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const gamma = base.instruments.records.find((r) => r.conceptIds.includes(unboundKey('Gamma')));
    if (gamma === undefined) throw new Error('expected a Gamma instrument');

    const suspended = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
      entries: [
        {
          schemaVersion: 5,
          kind: 'suspend',
          eventId: 's1',
          timestamp: '2026-08-01T09:00:00+00:00',
          instrumentId: gamma.instrumentId,
          conceptIds: [unboundKey('Gamma')],
        },
      ],
    });
    expect(suspended.suspended.has(gamma.instrumentId)).toBe(true);
    const suspendedQueue = composeQueue({
      candidates: suspended.candidates,
      now: NOW,
      suspended: suspended.suspended,
    });
    expect(suspendedQueue.items.map((i) => i.instrumentId)).not.toContain(gamma.instrumentId);
    expect(suspendedQueue.deferred.map((d) => d.instrumentId)).not.toContain(gamma.instrumentId);

    const restored = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
      entries: [
        {
          schemaVersion: 5,
          kind: 'suspend',
          eventId: 's1',
          timestamp: '2026-08-01T09:00:00+00:00',
          instrumentId: gamma.instrumentId,
          conceptIds: [unboundKey('Gamma')],
        },
        {
          schemaVersion: 5,
          kind: 'unsuspend',
          eventId: 's2',
          timestamp: '2026-08-02T09:00:00+00:00',
          instrumentId: gamma.instrumentId,
          conceptIds: [unboundKey('Gamma')],
        },
      ],
    });
    const restoredQueue = composeQueue({
      candidates: restored.candidates,
      now: NOW,
      suspended: restored.suspended,
    });
    expect(restoredQueue.items.map((i) => i.instrumentId)).toContain(gamma.instrumentId);
  });
});

// F2.5's `filter` is `composeQueue`'s own field, not `BuildReviewSessionInput`'s
// any more (`[SESS-8.6]`) — this suite now proves the same real-vault
// integration by feeding the enumeration's `candidates` to `composeQueue`
// directly, exactly `packages/workbench/src/queue/derive.ts`'s own shape.
describe('the filter narrows a real-vault session the same way it narrows a synthetic one', () => {
  it('a course filter keeps only that course’s concepts, as a subsequence', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const unfiltered = composeQueue({ candidates: session.candidates, now: NOW });
    const filtered = composeQueue({
      candidates: session.candidates,
      now: NOW,
      filter: { courses: ['GEO101'] },
    });

    expect(filtered.items.flatMap((i) => i.conceptIds).sort()).toEqual(
      [unboundKey('Alpha'), unboundKey('Beta')].sort(),
    );
    const unfilteredIds = unfiltered.items.map((i) => i.instrumentId);
    const filteredIds = filtered.items.map((i) => i.instrumentId);
    // Subsequence: same items, same order, fewer of them.
    expect(unfilteredIds.filter((id) => filteredIds.includes(id))).toEqual(filteredIds);
  });

  it('a concept filter keeps only that concept', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const queue = composeQueue({
      candidates: session.candidates,
      now: NOW,
      filter: { conceptIds: [unboundKey('Gamma')] },
    });
    expect(queue.items.flatMap((i) => i.conceptIds)).toEqual([unboundKey('Gamma')]);
  });
});

describe('the log is read from the vault when the caller does not supply it', () => {
  it('reads every day-file under the log folder and merges them', async () => {
    const vault = smallVault();
    const enumeration = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const gamma = enumeration.instruments.records.find((r) =>
      r.conceptIds.includes(unboundKey('Gamma')),
    );
    if (gamma === undefined) throw new Error('expected a Gamma instrument');

    await vault.write(
      reviewLogPath('2026-08-19', 'device-a'),
      `${JSON.stringify(reviewOf('e1', '2026-08-19T09:00:00+00:00', gamma.instrumentId, unboundKey('Gamma')))}\n`,
    );
    await vault.write(
      reviewLogPath('2026-08-19', 'device-b'),
      // The same event from a second device — merged by eventId, not doubled.
      `${JSON.stringify(reviewOf('e1', '2026-08-19T09:00:00+00:00', gamma.instrumentId, unboundKey('Gamma')))}\n`,
    );

    const history = await readReviewLogHistory(vault);
    expect(history.files).toHaveLength(2);
    expect(history.entries).toHaveLength(1);

    const session = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    expect(session.replay.states.get(gamma.instrumentId)?.reviewCount).toBe(1);
  });

  it('a truncated final line costs that line and nothing else', async () => {
    const vault = smallVault();
    await vault.write(
      reviewLogPath('2026-08-19', 'device-a'),
      `${JSON.stringify(reviewOf('e1', '2026-08-19T09:00:00+00:00', 'x', unboundKey('Gamma')))}\n{"schemaVer`,
    );
    const history = await readReviewLogHistory(vault);
    expect(history.entries).toHaveLength(1);
    expect(history.invalidLines).toHaveLength(1);
  });

  it('no log at all reads as no history, not as an error', async () => {
    const history = await readReviewLogHistory(smallVault());
    expect(history).toEqual({ entries: [], invalidLines: [], files: [] });
  });
});

describe('the Today-panel adapter', () => {
  it('counts each instrument under the first of its concept’s courses, so the rows sum to the headline', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const due = toDueInstruments(session.instruments.records, session.replay);
    expect(due).toHaveLength(4);
    expect(due.every((d) => d.due === null)).toBe(true);
    expect(new Set(due.map((d) => d.courseCode))).toEqual(new Set(['GEO101', 'MUS101']));
    // One row per instrument, never fanned out across its concept's courses.
    expect(due.map((d) => d.instrumentId)).toHaveLength(
      new Set(due.map((d) => d.instrumentId)).size,
    );
  });
});

// `smallVault()`'s concepts carry their own display name (tier 2, unbound —
// see `unboundKey` above), so `ConceptRelation.from`/`to` can name them
// directly: 'Alpha', 'Beta', 'Gamma'.
function partOfEdge(part: string, container: string): ConceptRelation {
  return {
    type: 'part-of',
    from: part,
    to: container,
    provenance: 'model-proposed',
    confidence: 0.9,
    introducingPassages: {
      from: { sourcePath: `${part}.md`, location: { page: 1, charRange: { start: 0, end: 1 } } },
      to: { sourcePath: `${container}.md`, location: { page: 1, charRange: { start: 0, end: 1 } } },
    },
  };
}

describe('C7.9 containment co-presence, wired through buildReviewSession (register row 3.7)', () => {
  it('is a no-op with no relations supplied — today’s shape for every real caller', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    expect(session.containmentDropped).toEqual([]);
    expect(session.candidates).toHaveLength(4);
  });

  it('drops the container’s instrument when a part-of edge makes Beta the container of Alpha', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
      relations: [partOfEdge('Alpha', 'Beta')],
    });

    // Beta (the container) is the side that yields; Alpha (the part) stays —
    // asserted directly on `candidates`/`containmentDropped` now, per
    // `build.ts`'s own module doc: this is what decides "kept", not what any
    // one composer downstream does with it.
    expect(
      session.candidates.some((candidate) => candidate.conceptIds.includes(unboundKey('Beta'))),
    ).toBe(false);
    expect(
      session.candidates.some((candidate) => candidate.conceptIds.includes(unboundKey('Alpha'))),
    ).toBe(true);
    expect(session.containmentDropped).toHaveLength(1);
    expect(session.containmentDropped[0]?.conceptIds).toContain(unboundKey('Beta'));
    // Gamma is untouched — the rule is scoped to the edge's own two concepts.
    expect(
      session.candidates.some((candidate) => candidate.conceptIds.includes(unboundKey('Gamma'))),
    ).toBe(true);
  });
});

/**
 * F2.19 (`ol-vr8z`): `buildReviewSession` resolves `relatedConceptKeys` and
 * `assessmentContext` internally from `relations`/`assessments` — see the
 * field docs on `BuildReviewSessionInput`. Three same-course, never-related
 * concepts, each with one instrument reviewed identically in the past so all
 * three land in one exact overdue-days tie band at `BAND_NOW` — the only
 * place F2.19's grouping can move anything (`[D-113]`; `queue/block-order.ts`'s
 * own doc).
 */
function bandVault(): ReturnType<typeof memoryVault> {
  return memoryVault({
    'Courses/GEO/x.md': note('ConceptX', 'GEO101', ['## X?', '', 'X front::X back ^x1']),
    'Courses/GEO/y.md': note('ConceptY', 'GEO101', ['## Y?', '', 'Y front::Y back ^y1']),
    'Courses/GEO/z.md': note('ConceptZ', 'GEO101', ['## Z?', '', 'Z front::Z back ^z1']),
  });
}

const BAND_REVIEWED_AT = '2026-08-01T09:00:00+00:00';
const BAND_NOW = new Date('2026-09-20T12:00:00Z');

function contrastEdge(a: string, b: string): ConceptRelation {
  return {
    type: 'contrasts-with',
    from: a,
    to: b,
    provenance: 'model-proposed',
    confidence: 0.9,
    introducingPassages: {
      from: { sourcePath: `${a}.md`, location: { page: 1, charRange: { start: 0, end: 1 } } },
      to: { sourcePath: `${b}.md`, location: { page: 1, charRange: { start: 0, end: 1 } } },
    },
  };
}

/**
 * `[SESS-8.6]` (`ol-egov.132.6`): `relations`/`assessments` no longer resolve
 * into `relatedConceptKeys`/`assessmentContext` inside `build.ts` (that
 * resolution pipeline fed `composeQueue` alone and is gone with the call —
 * see `build.ts`'s own module doc). This block still proves `composeQueue`'s
 * own cohort-ordering behaviour is real and reachable — `relations`/
 * `assessments` are resolved HERE, the same two calls `build.ts` used to
 * make, then handed to `composeQueue` directly alongside the real-vault
 * `candidates` `buildReviewSession` still enumerates. Exactly
 * `packages/workbench/src/queue/derive.ts`'s own shape.
 */
async function bandedItemOrder(
  extra: { relations?: readonly ConceptRelation[]; assessments?: readonly AssessmentRecord[] } = {},
): Promise<readonly string[]> {
  const vault = bandVault();
  const enumerated = await buildReviewSession({
    vault,
    scheduler: createFsrsScheduler(),
    now: BAND_NOW,
  });
  const idOf = (conceptName: string): string => {
    const record = enumerated.instruments.records.find((r) =>
      r.conceptIds.includes(unboundKey(conceptName)),
    );
    if (record === undefined) throw new Error(`expected an instrument for ${conceptName}`);
    return record.instrumentId;
  };
  // All three reviewed 'good' at the identical past instant, so FSRS — a
  // pure function of (prior state, rating, elapsed time) — gives all three
  // the identical resulting due date, hence the identical overdueDays at
  // `BAND_NOW`: one tie band of three, not three bands of one.
  const entries: readonly ReviewLogEntry[] = ['ConceptX', 'ConceptY', 'ConceptZ'].map(
    (conceptName) =>
      reviewOf(`band-${conceptName}`, BAND_REVIEWED_AT, idOf(conceptName), unboundKey(conceptName)),
  );
  const session = await buildReviewSession({
    vault,
    scheduler: createFsrsScheduler(),
    now: BAND_NOW,
    entries,
    ...(extra.relations !== undefined ? { relations: extra.relations } : {}),
    ...(extra.assessments !== undefined ? { assessments: extra.assessments } : {}),
  });
  const { relatedConceptKeys } = resolveRelatedConceptKeys(
    extra.relations ?? [],
    session.instruments.concepts,
  );
  const { assessmentContext } = resolveAssessmentGroupingContext(
    extra.assessments ?? [],
    session.instruments.concepts,
  );
  const queue = composeQueue({
    candidates: session.candidates,
    now: BAND_NOW,
    relatedConceptKeys,
    assessmentContext,
  });
  // Sanity: the property under test only holds if all three really did land
  // in one tie band together — three items, one course.
  expect(queue.items).toHaveLength(3);
  return queue.items.map((item) => item.conceptIds[0] ?? item.instrumentId);
}

describe('F2.19 (`ol-vr8z`) — relatedConceptKeys/assessmentContext resolved and threaded through composeQueue directly (`[SESS-8.6]`)', () => {
  it('with neither raw input, the tie band keeps plain enumeration order (the pre-existing shape)', async () => {
    const order = await bandedItemOrder();
    expect(order).toEqual([unboundKey('ConceptX'), unboundKey('ConceptY'), unboundKey('ConceptZ')]);
  });

  it('`relations` alone flips the tie-band order — the mutation this catches is exactly that flip', async () => {
    const withRelation = await bandedItemOrder({
      relations: [contrastEdge('ConceptX', 'ConceptZ')],
    });
    // X and Z now share a C7.10 edge; Y has none. Per `withinBlockRelatedness`
    // this scores X and Z equally above Y, and a stable sort keeps X ahead of
    // Z (X's band position came first) — X, Z, Y. Baseline (previous test)
    // was X, Y, Z: Y and Z swap places, which is the observable flip.
    expect(withRelation).toEqual([
      unboundKey('ConceptX'),
      unboundKey('ConceptZ'),
      unboundKey('ConceptY'),
    ]);
  });

  it('`assessments` alone shifts the tie band toward the assessment-scoped concept (`ol-f3qu`)', async () => {
    // Until `ol-f3qu`, `session/build.ts`'s `toQueueCandidate` never set
    // `QueueCandidate.targetAssessmentPath`, so `assessmentContext`'s
    // scope-matching half had nothing to join against — this test used to pin
    // that honest gap (a resolved, correctly-shaped map with no observable
    // effect through this caller). `ol-f3qu` closes it: `targetAssessmentPathIndex`
    // now maps ConceptZ's key to this assessment's path (it names 'ConceptZ'
    // in its scope), so `block-order.ts`'s `groupingScore` finds the context
    // and, with the due date one day after `BAND_NOW`, the proximity term
    // dominates (`~0.93`) and outweighs the zero relatedness every item has
    // here (no `relations` supplied). ConceptZ moves to the front; X and Y,
    // both scoring `0`, keep their original relative order behind it.
    const assessments: readonly AssessmentRecord[] = [
      {
        path: 'Assessments/midterm.md',
        course: 'GEO101',
        type: 'exam',
        weight: 0.3,
        weightRaw: '30',
        due: '2026-09-21',
        status: 'upcoming',
        scope: 'ConceptZ',
      },
    ];
    const order = await bandedItemOrder({ assessments });
    expect(order).toEqual([unboundKey('ConceptZ'), unboundKey('ConceptX'), unboundKey('ConceptY')]);
  });

  it('supplying both `relations` and `assessments` together (the real call shape) blends both signals, assessment proximity winning', async () => {
    const assessments: readonly AssessmentRecord[] = [
      {
        path: 'Assessments/midterm.md',
        course: 'GEO101',
        type: 'exam',
        weight: 0.3,
        weightRaw: '30',
        due: '2026-09-21',
        status: 'upcoming',
        scope: 'ConceptZ',
      },
    ];
    const order = await bandedItemOrder({
      relations: [contrastEdge('ConceptX', 'ConceptZ')],
      assessments,
    });
    // Before `ol-f3qu`: X and Z share a C7.10 edge (relatedness 0.5 each), Y
    // has none, so `relations` alone flips the baseline to X, Z, Y (see the
    // test above it). With `targetAssessmentPathIndex` now wiring ConceptZ to
    // this assessment, Z's score blends in the ~0.93 proximity term
    // (`(1 - 0.93) * 0.5 relatedness + 0.93 * 1 scopeMembership ≈ 0.95`),
    // which now outranks X's relatedness-only 0.5 — Z leads instead of X.
    expect(order).toEqual([unboundKey('ConceptZ'), unboundKey('ConceptX'), unboundKey('ConceptY')]);
  });
});

describe('F2.19 (`ol-f3qu`) — `toQueueCandidate` populates `targetAssessmentPath`', () => {
  function candidateFor(
    candidates: readonly {
      readonly conceptIds: readonly string[];
      readonly targetAssessmentPath?: string | null;
    }[],
    conceptName: string,
  ): { readonly targetAssessmentPath?: string | null } {
    const candidate = candidates.find((c) => c.conceptIds.includes(unboundKey(conceptName)));
    if (candidate === undefined) throw new Error(`expected a candidate for ${conceptName}`);
    return candidate;
  }

  it('stays `null` when no `assessments` are supplied — the prior, still-correct default', async () => {
    const session = await buildReviewSession({
      vault: bandVault(),
      scheduler: createFsrsScheduler(),
      now: BAND_NOW,
    });
    expect(candidateFor(session.candidates, 'ConceptX').targetAssessmentPath).toBeNull();
  });

  it("sets a candidate's `targetAssessmentPath` to the assessment naming its first concept in scope", async () => {
    const assessments: readonly AssessmentRecord[] = [
      {
        path: 'Assessments/midterm.md',
        course: 'GEO101',
        type: 'exam',
        weight: 0.3,
        weightRaw: '30',
        due: '2026-09-21',
        status: 'upcoming',
        scope: 'ConceptZ',
      },
    ];
    const session = await buildReviewSession({
      vault: bandVault(),
      scheduler: createFsrsScheduler(),
      now: BAND_NOW,
      assessments,
    });
    expect(candidateFor(session.candidates, 'ConceptZ').targetAssessmentPath).toBe(
      'Assessments/midterm.md',
    );
    // Untouched: ConceptX is named in no assessment's scope.
    expect(candidateFor(session.candidates, 'ConceptX').targetAssessmentPath).toBeNull();
  });

  it('a concept named in two assessments resolves to the one with the soonest known due day', async () => {
    const assessments: readonly AssessmentRecord[] = [
      {
        path: 'Assessments/far.md',
        course: 'GEO101',
        type: 'exam',
        weight: 0.3,
        weightRaw: '30',
        due: '2026-12-01',
        status: 'upcoming',
        scope: 'ConceptZ',
      },
      {
        path: 'Assessments/near.md',
        course: 'GEO101',
        type: 'quiz',
        weight: 0.1,
        weightRaw: '10',
        due: '2026-09-21',
        status: 'upcoming',
        scope: 'ConceptZ',
      },
    ];
    const session = await buildReviewSession({
      vault: bandVault(),
      scheduler: createFsrsScheduler(),
      now: BAND_NOW,
      assessments,
    });
    // `targetAssessmentPathIndex`'s tie-break: soonest known `dueDay` wins,
    // regardless of the two assessments' vault-path ordering ('far' sorts
    // before 'near' alphabetically, so this also proves it isn't a path sort).
    expect(candidateFor(session.candidates, 'ConceptZ').targetAssessmentPath).toBe(
      'Assessments/near.md',
    );
  });

  it('a concept named in two assessments with no known due day breaks the tie by `VaultPath` ascending, deterministically', async () => {
    const assessments: readonly AssessmentRecord[] = [
      {
        path: 'Assessments/zzz-no-due.md',
        course: 'GEO101',
        type: 'exam',
        weight: 0.3,
        weightRaw: '30',
        due: undefined,
        status: 'upcoming',
        scope: 'ConceptZ',
      },
      {
        path: 'Assessments/aaa-no-due.md',
        course: 'GEO101',
        type: 'quiz',
        weight: 0.1,
        weightRaw: '10',
        due: undefined,
        status: 'upcoming',
        scope: 'ConceptZ',
      },
    ];
    const session = await buildReviewSession({
      vault: bandVault(),
      scheduler: createFsrsScheduler(),
      now: BAND_NOW,
      assessments,
    });
    expect(candidateFor(session.candidates, 'ConceptZ').targetAssessmentPath).toBe(
      'Assessments/aaa-no-due.md',
    );
  });
});

/**
 * `[SESS-8.6]` (`ol-egov.132.6`): `build.ts` no longer resolves
 * `conceptSourcePaths`/`arrivalDays` itself — that pipeline fed `composeQueue`
 * alone and is gone with the call (see `build.ts`'s own module doc). This
 * block still proves `[D-149]`'s cohort signal is real and reachable through
 * `composeQueue`: this file's own top-of-file `conceptSourcePathsByConceptKey`/
 * `arrivalDaysByConceptKey` (mirroring the deleted resolvers) resolve the two
 * maps here, from the SAME `vault`/`instruments.concepts` `build.ts` used to
 * hold, and `cohortItemOrder` below hands them to `composeQueue` directly —
 * exactly `packages/workbench/src/queue/derive.ts`'s own shape.
 *
 * Same tie-band construction as the `ol-vr8z` block above (three same-course
 * concepts landing in one exact overdue-days band — the only place F2.19's
 * grouping can move anything), plus a fourth, card-less note whose `topic:`
 * flow list names BOTH `ConceptX` and `ConceptZ`. `concept/extract.ts` merges
 * a same-name unbound concept's `sourcePaths` across every note that names it
 * (proven by `extract.spec.ts`'s own "course association is M:N" case), so
 * this one bridging note lands in *both* concepts' own `sourcePaths` without
 * adding a fourth queue candidate — `ConceptX`'s and `ConceptZ`'s
 * `conceptSourcePaths` entries now overlap, `ConceptY`'s does not.
 */
function cohortVault(): ReturnType<typeof memoryVault> {
  return memoryVault({
    'Courses/GEO/x.md': note('ConceptX', 'GEO101', ['## X?', '', 'X front::X back ^x1']),
    'Courses/GEO/z.md': note('ConceptZ', 'GEO101', ['## Z?', '', 'Z front::Z back ^z1']),
    'Courses/GEO/y.md': note('ConceptY', 'GEO101', ['## Y?', '', 'Y front::Y back ^y1']),
    'Courses/GEO/shared-lecture.md': [
      '---',
      'topic: [ConceptX, ConceptZ]',
      'course: GEO101',
      '---',
      '',
      'Bridging lecture note, no card of its own — it exists purely to give',
      'ConceptX and ConceptZ a shared source-note grain for the cohort signal.',
      '',
    ].join('\n'),
  });
}

const COHORT_NOW = new Date('2026-09-20T12:00:00Z');
const COHORT_REVIEWED_AT = '2026-08-01T09:00:00+00:00';

/**
 * `cohortVault()` wrapped with a `firstSeen` that answers only for the
 * bridging note — `x.md`/`y.md`/`z.md` all read `null` (unknown), same
 * "cannot say" posture `memoryVault` itself takes for every path by omitting
 * the accessor entirely. `ConceptX`'s and `ConceptZ`'s own `sourcePaths` each
 * include the bridging note, so the EARLIEST-`firstSeen` resolution
 * (`arrivalDaysByConceptKey`'s doc) gives both an arrival day of `COHORT_NOW`
 * itself — maximally fresh, decay weight `1`. `ConceptY` never touches the
 * bridging note, so its own `sourcePaths` has no path this fake can answer
 * for at all, and it gets no `arrivalDays` entry — decay weight `0`, the same
 * "no signal" case `withinBlockCohortDecayWeight`'s doc names.
 */
function cohortVaultWithFreshBridge(): VaultSource {
  const vault = cohortVault();
  return {
    ...vault,
    async firstSeen(path: VaultPath) {
      return path === 'Courses/GEO/shared-lecture.md' ? COHORT_NOW.getTime() : null;
    },
  };
}

async function cohortItemOrder(vault: VaultSource): Promise<readonly string[]> {
  const enumerated = await buildReviewSession({
    vault,
    scheduler: createFsrsScheduler(),
    now: COHORT_NOW,
  });
  const idOf = (conceptName: string): string => {
    const record = enumerated.instruments.records.find((r) =>
      r.conceptIds.includes(unboundKey(conceptName)),
    );
    if (record === undefined) throw new Error(`expected an instrument for ${conceptName}`);
    return record.instrumentId;
  };
  const entries: readonly ReviewLogEntry[] = ['ConceptX', 'ConceptY', 'ConceptZ'].map(
    (conceptName) =>
      reviewOf(
        `cohort-${conceptName}`,
        COHORT_REVIEWED_AT,
        idOf(conceptName),
        unboundKey(conceptName),
      ),
  );
  const session = await buildReviewSession({
    vault,
    scheduler: createFsrsScheduler(),
    now: COHORT_NOW,
    entries,
  });
  const conceptSourcePaths = conceptSourcePathsByConceptKey(session.instruments.concepts);
  const arrivalDays = await arrivalDaysByConceptKey(vault, session.instruments.concepts);
  const queue = composeQueue({
    candidates: session.candidates,
    now: COHORT_NOW,
    conceptSourcePaths,
    arrivalDays,
  });
  // Sanity: three items, one tie band — the same guard `bandedItemOrder`
  // above carries, for the same reason.
  expect(queue.items).toHaveLength(3);
  return queue.items.map((item) => item.conceptIds[0] ?? item.instrumentId);
}

describe('[D-149] (`ol-4e7o`) — arrivalDays/conceptSourcePaths resolved internally and threaded through', () => {
  it('with a host that cannot answer `firstSeen`, the tie band keeps plain enumeration order — a real no-op', async () => {
    // `cohortVault()` unwrapped: `memoryVault` has no `firstSeen` at all, so
    // `arrivalDaysByConceptKey` returns an empty map without attempting any
    // I/O, and the shared-note cohort (via `conceptSourcePaths` alone,
    // `arrivalDays` absent) contributes nothing — `block-order.ts`'s own
    // no-op proof for exactly this combination.
    const order = await cohortItemOrder(cohortVault());
    expect(order).toEqual([unboundKey('ConceptX'), unboundKey('ConceptY'), unboundKey('ConceptZ')]);
  });

  it('a real `firstSeen` reaching a shared, freshly-arrived source note pulls that cohort adjacent — the mutation this catches', async () => {
    const order = await cohortItemOrder(cohortVaultWithFreshBridge());
    // ConceptX and ConceptZ's shared, freshly-arrived bridging note pulls them
    // adjacent ahead of ConceptY — never `[X, Y, Z]`, the plain-caller-order
    // fallback above, which is what a mutation dropping either resolved map
    // (or failing to thread it into `composeQueue`) would produce instead.
    expect(order).toEqual([unboundKey('ConceptX'), unboundKey('ConceptZ'), unboundKey('ConceptY')]);
  });
});

// `[SESS-8.4]` (`ol-egov.132.4`): `queueItemsFromComposedSession` translates
// the study-session composer's own rows into `QueueItem[]`, off the kept
// enumeration alone — @auto:core/session/build.spec.
describe('queueItemsFromComposedSession — translating composed rows off the kept enumeration', () => {
  function studySessionItemFor(record: VaultInstrumentRecord, position: number): StudySessionItem {
    return {
      position,
      instrumentId: record.instrumentId,
      instrumentType: record.instrumentType,
      notePath: record.notePath,
      noteTitle: record.noteTitle,
      conceptName: record.conceptIds[0] ?? record.instrumentId,
      course: record.courses[0] ?? '',
      gapClass: 'mastery-gap',
      gapRank: position,
      gapScore: 1,
      estimatedSeconds: 60,
      durationSource: 'assumed',
      formatMatch: 'no-preference',
    };
  }

  it('fills conceptIds and priorState from the kept enumeration, never reorders, and computes instrumentTypesOffered over the whole kept candidate set', async () => {
    const vault = smallVault();
    const session = await buildReviewSession({ vault, scheduler: createFsrsScheduler(), now: NOW });

    const alphaQa = session.candidates.find(
      (c) => c.instrumentType === 'qa' && c.conceptIds.includes(unboundKey('Alpha')),
    );
    const alphaCloze = session.candidates.find((c) => c.instrumentType === 'cloze');
    const beta = session.candidates.find((c) => c.conceptIds.includes(unboundKey('Beta')));
    if (alphaQa === undefined || alphaCloze === undefined || beta === undefined) {
      throw new Error('fixture vault missing an expected candidate');
    }

    // Deliberately the reverse of vault-walk order (Beta's file sorts after
    // Alpha's) — the composer's own order is what must survive, not the
    // enumeration's.
    const betaRecord = session.recordsById.get(beta.instrumentId);
    const alphaQaRecord = session.recordsById.get(alphaQa.instrumentId);
    if (betaRecord === undefined || alphaQaRecord === undefined) {
      throw new Error('fixture vault missing an expected record');
    }
    const items = [studySessionItemFor(betaRecord, 1), studySessionItemFor(alphaQaRecord, 2)];

    const queueItems = queueItemsFromComposedSession({
      items,
      recordsById: session.recordsById,
      candidates: session.candidates,
      now: NOW,
    });

    expect(queueItems.map((i) => i.instrumentId)).toEqual([
      beta.instrumentId,
      alphaQa.instrumentId,
    ]);

    const [betaItem, alphaQaItem] = queueItems;
    expect(betaItem?.conceptIds).toEqual(betaRecord.conceptIds);
    expect(betaItem?.priorState).toBeNull();
    expect(betaItem?.selectionContext.dueState).toBe('new');
    // Nothing else in the kept set shares Beta's concept.
    expect(betaItem?.selectionContext.instrumentTypesOffered).toEqual(['qa']);

    expect(alphaQaItem?.conceptIds).toEqual(alphaQaRecord.conceptIds);
    expect(alphaQaItem?.priorState).toBeNull();
    // Alpha's cloze instrument shares the concept, so both types are named —
    // this is `../queue/compose.js`'s `instrumentTypesOfferedFor` question,
    // answered over the kept `candidates` rather than composeQueue's own
    // narrower "eligible" set.
    expect(alphaQaItem?.selectionContext.instrumentTypesOffered).toEqual(
      expect.arrayContaining(['qa', 'cloze']),
    );
    expect(alphaCloze).toBeDefined();

    // Never ranked by this translator — `executeStudyPlanOverComposedRows` is
    // the only thing that may fill these in, from the plan.
    expect(betaItem?.selectionContext.examProximity).toBeNull();
    expect(betaItem?.selectionContext.yieldRank).toBeNull();
  });

  it('dueState reads `early` for an item the composer chose ahead of its FSRS due day — unreachable through composeQueue, reachable here', async () => {
    const vault = smallVault();
    const enumeration = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const alphaQa = enumeration.candidates.find(
      (c) => c.instrumentType === 'qa' && c.conceptIds.includes(unboundKey('Alpha')),
    );
    if (alphaQa === undefined) throw new Error('fixture vault missing Alpha qa candidate');

    const entries = [
      reviewOf('e1', '2026-08-10T09:00:00Z', alphaQa.instrumentId, unboundKey('Alpha')),
    ];
    const session = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
      entries,
    });
    const candidate = session.candidates.find((c) => c.instrumentId === alphaQa.instrumentId);
    const record = session.recordsById.get(alphaQa.instrumentId);
    if (candidate?.state === null || candidate?.state === undefined || record === undefined) {
      throw new Error('expected a reviewed instrument to carry FSRS state');
    }
    const due = new Date(candidate.state.due);
    const dayBefore = new Date(due.getTime() - 24 * 60 * 60 * 1000);
    const dayAfter = new Date(due.getTime() + 24 * 60 * 60 * 1000);
    const items = [studySessionItemFor(record, 1)];

    const early = queueItemsFromComposedSession({
      items,
      recordsById: session.recordsById,
      candidates: session.candidates,
      now: dayBefore,
    });
    expect(early[0]?.selectionContext.dueState).toBe('early');

    const onDue = queueItemsFromComposedSession({
      items,
      recordsById: session.recordsById,
      candidates: session.candidates,
      now: due,
    });
    expect(onDue[0]?.selectionContext.dueState).toBe('due');

    const overdue = queueItemsFromComposedSession({
      items,
      recordsById: session.recordsById,
      candidates: session.candidates,
      now: dayAfter,
    });
    expect(overdue[0]?.selectionContext.dueState).toBe('overdue');
  });

  it('throws when a composed item names an instrument the kept enumeration does not have', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const ghost: StudySessionItem = {
      position: 1,
      instrumentId: 'not-a-real-instrument',
      instrumentType: 'qa',
      notePath: 'Courses/GEO/one.md' as VaultPath,
      noteTitle: 'one',
      conceptName: 'Alpha',
      course: 'GEO101',
      gapClass: 'mastery-gap',
      gapRank: 1,
      gapScore: 1,
      estimatedSeconds: 60,
      durationSource: 'assumed',
      formatMatch: 'no-preference',
    };

    expect(() =>
      queueItemsFromComposedSession({
        items: [ghost],
        recordsById: session.recordsById,
        candidates: session.candidates,
        now: NOW,
      }),
    ).toThrow(/not-a-real-instrument/);
  });
});
