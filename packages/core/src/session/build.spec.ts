// Scenarios: features/F2-review.md, "F2.14 — One entry point composes a session
// from a vault" and "F2.14 — Containment co-presence is filtered at
// composition (C7.9)" — @auto:core/session/build.spec. F2.19's own reachability
// coverage below is @auto:core/queue/block-order.spec's shape, reused at this
// integration level per `ol-vr8z`.
import type { ReviewLogEntry, SelectionContextV4 } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { memoryVault } from '../../test/session/memory-vault.js';
import type { AssessmentRecord } from '../assessment/types.js';
import { provisionalConceptKey } from '../concept/concept-key.js';
import type { ConceptRelation } from '../concept/relation.js';
import { reviewLogPath } from '../review-log/path.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import { buildReviewSession } from './build.js';
import { toDueInstruments } from './due-instruments.js';
import { readReviewLogHistory } from './history.js';

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

describe('one entry point, both halves returned', () => {
  it('returns the composed queue and the records that produced it, from one walk', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(session.instruments.records).toHaveLength(4);
    expect(session.candidates).toHaveLength(4);
    // Every offered item can be rendered without walking the vault again.
    for (const item of session.queue.items) {
      expect(session.recordsById.get(item.instrumentId)).toBeDefined();
    }
  });

  it('a concept with two instruments yields one item and one named deferral', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    const alphaItems = session.queue.items.filter((i) =>
      i.conceptIds.includes(unboundKey('Alpha')),
    );
    const alphaDeferred = session.queue.deferred.filter((d) =>
      d.conceptIds.includes(unboundKey('Alpha')),
    );
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
    for (const item of session.queue.items) {
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

    const item = session.queue.items.find((i) => i.instrumentId === gamma.instrumentId);
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
    const overdue = later.queue.items.find((i) => i.instrumentId === gamma.instrumentId);
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
    expect(suspended.queue.items.map((i) => i.instrumentId)).not.toContain(gamma.instrumentId);
    expect(suspended.queue.deferred.map((d) => d.instrumentId)).not.toContain(gamma.instrumentId);

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
    expect(restored.queue.items.map((i) => i.instrumentId)).toContain(gamma.instrumentId);
  });
});

describe('the filter narrows a real-vault session the same way it narrows a synthetic one', () => {
  it('a course filter keeps only that course’s concepts, as a subsequence', async () => {
    const vault = smallVault();
    const unfiltered = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const filtered = await buildReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      now: NOW,
      filter: { courses: ['GEO101'] },
    });

    expect(filtered.queue.items.flatMap((i) => i.conceptIds).sort()).toEqual(
      [unboundKey('Alpha'), unboundKey('Beta')].sort(),
    );
    const unfilteredIds = unfiltered.queue.items.map((i) => i.instrumentId);
    const filteredIds = filtered.queue.items.map((i) => i.instrumentId);
    // Subsequence: same items, same order, fewer of them.
    expect(unfilteredIds.filter((id) => filteredIds.includes(id))).toEqual(filteredIds);
  });

  it('a concept filter keeps only that concept', async () => {
    const session = await buildReviewSession({
      vault: smallVault(),
      scheduler: createFsrsScheduler(),
      now: NOW,
      filter: { conceptIds: [unboundKey('Gamma')] },
    });
    expect(session.queue.items.flatMap((i) => i.conceptIds)).toEqual([unboundKey('Gamma')]);
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

    // Beta (the container) is the side that yields; Alpha (the part) stays.
    expect(session.queue.items.some((item) => item.conceptIds.includes(unboundKey('Beta')))).toBe(
      false,
    );
    expect(session.queue.items.some((item) => item.conceptIds.includes(unboundKey('Alpha')))).toBe(
      true,
    );
    expect(session.containmentDropped).toHaveLength(1);
    expect(session.containmentDropped[0]?.conceptIds).toContain(unboundKey('Beta'));
    // Gamma is untouched — the rule is scoped to the edge's own two concepts.
    expect(session.queue.items.some((item) => item.conceptIds.includes(unboundKey('Gamma')))).toBe(
      true,
    );
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

async function bandedItemOrder(
  extra: Partial<Parameters<typeof buildReviewSession>[0]> = {},
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
    ...extra,
  });
  // Sanity: the property under test only holds if all three really did land
  // in one tie band together — three items, one course.
  expect(session.queue.items).toHaveLength(3);
  return session.queue.items.map((item) => item.conceptIds[0] ?? item.instrumentId);
}

describe('F2.19 (`ol-vr8z`) — relatedConceptKeys/assessmentContext resolved and threaded through', () => {
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
