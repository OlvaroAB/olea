/**
 * F8.8's computation (`[POST-1]`, `[D-134]`). Fixture ids are opaque
 * (INV-3): no real course code or concept name anywhere in this file.
 */
import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { ConceptCourses } from '../insights/types.js';
import type { Scheduler, SchedulerState } from '../scheduler/types.js';
import { buildRetrospective } from './build.js';
import type { RetrospectiveInput } from './types.js';

const NOW = new Date('2026-09-01T09:00:00.000Z');
const HOLDING_CUT = 0.7;

function review(conceptId: string, day: string, eventId: string): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId,
    timestamp: `${day}T20:00:00+00:00`,
    instrumentId: `qa:${conceptId}:1`,
    instrumentType: 'qa',
    conceptIds: [conceptId],
    rating: 'good',
    wasUnsure: false,
    durationMs: 4_000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  };
}

/**
 * Recall probability fixed per instrument id — the same shape
 * `mastery/rollup.spec.ts`'s own `stubScheduler` uses, since
 * `readAllConceptVitality` replays the log through `schedule()` (to rebuild
 * per-instrument state) before ever calling `retrievability()`.
 */
function stubScheduler(byInstrument: Readonly<Record<string, number>>): Scheduler {
  return {
    schedule({ instrumentId, now }) {
      const state: SchedulerState = {
        schemaVersion: 1,
        due: now.toISOString(),
        stability: 1,
        difficulty: 5,
        scheduledDays: 1,
        learningStepIndex: 0,
        reps: 1,
        lapses: 0,
        learningState: 'review',
        lastReview: now.toISOString(),
      };
      return { instrumentId, state, intervalDays: 1 };
    },
    retrievability({ instrumentId }) {
      const recallProbability = byInstrument[instrumentId];
      if (recallProbability === undefined) {
        throw new Error(`stubScheduler: no probability configured for ${instrumentId}`);
      }
      return { instrumentId, recallProbability };
    },
  };
}

function baseInput(overrides: Partial<RetrospectiveInput> = {}): RetrospectiveInput {
  return {
    assessmentPath: 'Courses/C1/Final.md',
    course: 'C1',
    scope: [
      { conceptId: 'c-held', conceptName: 'Held concept' },
      { conceptId: 'c-faded', conceptName: 'Faded concept' },
      { conceptId: 'c-early', conceptName: 'Early concept' },
    ],
    scopeOrigin: 'evidenced',
    entries: [review('c-held', '2026-08-30', 'e1'), review('c-faded', '2026-01-10', 'e2')],
    scheduler: stubScheduler({ 'qa:c-held:1': 0.9, 'qa:c-faded:1': 0.3 }),
    now: NOW,
    holdingCut: HOLDING_CUT,
    conceptCourses: [],
    ...overrides,
  };
}

describe('buildRetrospective', () => {
  it('partitions scope into held, faded and a too-early COUNT — never a fourth grouping', () => {
    const result = buildRetrospective(baseInput());

    expect(result.held.map((c) => c.conceptId)).toEqual(['c-held']);
    expect(result.faded.map((c) => c.conceptId)).toEqual(['c-faded']);
    expect(result.tooEarlyCount).toBe(1);
    expect(result.held.length + result.faded.length + result.tooEarlyCount).toBe(result.scopeCount);
    expect(result.scopeCount).toBe(3);
  });

  it('never files a too-early concept under "faded" (principle 12 part 3 — no false middle)', () => {
    const result = buildRetrospective(baseInput());
    expect(result.faded.some((c) => c.conceptId === 'c-early')).toBe(false);
    expect(result.held.some((c) => c.conceptId === 'c-early')).toBe(false);
  });

  it('carries a stage alongside vitality on every held/faded line (F2.11 co-presence, [D-116])', () => {
    const result = buildRetrospective(baseInput());
    for (const line of [...result.held, ...result.faded]) {
      expect(line.vitality).toBeTruthy();
      expect(line.stage).toBeTruthy();
    }
  });

  it('"carries" is an overlay, cross-course: a concept can be BOTH held and carrying', () => {
    const conceptCourses: readonly ConceptCourses[] = [
      { conceptId: 'c-held', courses: ['C1', 'C2'] },
    ];
    const result = buildRetrospective(baseInput({ conceptCourses }));

    expect(result.held.map((c) => c.conceptId)).toContain('c-held');
    const carriesLine = result.carries.find((c) => c.conceptId === 'c-held');
    expect(carriesLine?.otherCourses).toEqual(['C2']);
    expect(carriesLine?.carriesToFinalAssessment).toBe(false);
  });

  it('never fabricates a single "the" other course — every other course sharing the concept, sorted', () => {
    const conceptCourses: readonly ConceptCourses[] = [
      { conceptId: 'c-held', courses: ['C1', 'C3', 'C2'] },
    ];
    const result = buildRetrospective(baseInput({ conceptCourses }));
    expect(result.carries.find((c) => c.conceptId === 'c-held')?.otherCourses).toEqual([
      'C2',
      'C3',
    ]);
  });

  it('a too-early concept never appears in "carries" — no durable evidence for F8.7 to read', () => {
    const conceptCourses: readonly ConceptCourses[] = [
      { conceptId: 'c-early', courses: ['C1', 'C2'] },
    ];
    const result = buildRetrospective(baseInput({ conceptCourses }));
    expect(result.carries.some((c) => c.conceptId === 'c-early')).toBe(false);
  });

  it("D-134 Q3: with no other course, falls back to the course's own final assessment scope", () => {
    const result = buildRetrospective(
      baseInput({
        conceptCourses: [{ conceptId: 'c-held', courses: ['C1'] }], // no OTHER course
        finalAssessmentScope: [{ conceptId: 'c-held', conceptName: 'Held concept' }],
      }),
    );
    const carriesLine = result.carries.find((c) => c.conceptId === 'c-held');
    expect(carriesLine?.otherCourses).toEqual([]);
    expect(carriesLine?.carriesToFinalAssessment).toBe(true);
  });

  it('does not carry at all when neither an other course nor a final-assessment scope names the concept', () => {
    const result = buildRetrospective(baseInput());
    expect(result.carries).toEqual([]);
  });

  it('passes scopeOrigin and assessment identity straight through, unmodified', () => {
    const result = buildRetrospective(baseInput({ scopeOrigin: 'assessment-stated' }));
    expect(result.scopeOrigin).toBe('assessment-stated');
    expect(result.assessmentPath).toBe('Courses/C1/Final.md');
    expect(result.course).toBe('C1');
  });

  it('is a pure function: identical input twice yields byte-identical output', () => {
    const input = baseInput();
    expect(buildRetrospective(input)).toEqual(buildRetrospective(input));
  });
});

/**
 * Register row 4.6's own health check (`docs/Olea_component_register.md`,
 * olea-service): "the partition property, tested directly — `held.length +
 * faded.length + tooEarlyCount` always equals `scopeCount`... never a fourth
 * bucket." The `it` above at line ~90 already asserts the sum for ONE
 * hand-built 3-concept scope; `ol-3ux7.41` asks for the property over a
 * GENERATED set of scopes so the guarantee is not resting on one fixture
 * happening to be well-formed. `build.ts`'s own `for` loop over `input.scope`
 * makes this structurally true today (every concept lands in `tooEarlyCount`
 * via `continue`, or in exactly one of `held`/`faded`) — this test exists to
 * catch a FUTURE edit that adds a filter, an early `return`, or a fourth
 * bucket and silently breaks that guarantee, not because the property is in
 * doubt today.
 */
describe('buildRetrospective — partition property over a generated set of scopes (register row 4.6)', () => {
  /** Deterministic PRNG (mulberry32) — "generated" means reproducible across runs, never `Math.random()`. */
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  type Bucket = 'held' | 'faded' | 'early';

  /** Builds one scope of `size` concepts, each independently assigned held/faded/early via `rng`, and the entries/scheduler config needed to force that vitality reading. */
  function generatedScope(
    size: number,
    rng: () => number,
  ): {
    readonly scope: RetrospectiveInput['scope'];
    readonly entries: ReviewLogRecord[];
    readonly recallByInstrument: Record<string, number>;
    readonly bucketByConceptId: ReadonlyMap<string, Bucket>;
  } {
    const scope: { conceptId: string; conceptName: string }[] = [];
    const entries: ReviewLogRecord[] = [];
    const recallByInstrument: Record<string, number> = {};
    const bucketByConceptId = new Map<string, Bucket>();

    for (let i = 0; i < size; i += 1) {
      const conceptId = `gen-c${i}`;
      scope.push({ conceptId, conceptName: `Generated concept ${i}` });
      const roll = rng();
      const bucket: Bucket = roll < 1 / 3 ? 'held' : roll < 2 / 3 ? 'faded' : 'early';
      bucketByConceptId.set(conceptId, bucket);
      if (bucket === 'early') continue; // no review evidence at all -> readVitality's 'early' path
      entries.push(review(conceptId, '2026-08-30', `e-${conceptId}`));
      recallByInstrument[`qa:${conceptId}:1`] = bucket === 'held' ? 0.95 : 0.3; // vs. HOLDING_CUT = 0.7
    }

    return { scope, entries, recallByInstrument, bucketByConceptId };
  }

  const GENERATED_SCOPE_SIZES = [0, 1, 2, 3, 7, 12, 25, 40];

  it.each(GENERATED_SCOPE_SIZES)(
    'held + faded + tooEarly == scopeCount, no double-count or omission, for a generated %i-concept scope',
    (size) => {
      const rng = mulberry32(size + 1);
      const { scope, entries, recallByInstrument, bucketByConceptId } = generatedScope(size, rng);
      const result = buildRetrospective(
        baseInput({ scope, entries, scheduler: stubScheduler(recallByInstrument) }),
      );

      expect(result.scopeCount).toBe(size);
      expect(result.held.length + result.faded.length + result.tooEarlyCount).toBe(
        result.scopeCount,
      );

      const heldIds = new Set(result.held.map((c) => c.conceptId));
      const fadedIds = new Set(result.faded.map((c) => c.conceptId));
      // No double-count: nothing appears in both lists, and neither list has an internal duplicate.
      expect(heldIds.size).toBe(result.held.length);
      expect(fadedIds.size).toBe(result.faded.length);
      for (const id of heldIds) expect(fadedIds.has(id)).toBe(false);
      // No omission: every generated concept lands in exactly the bucket it was generated for.
      for (const [conceptId, bucket] of bucketByConceptId) {
        expect(heldIds.has(conceptId)).toBe(bucket === 'held');
        expect(fadedIds.has(conceptId)).toBe(bucket === 'faded');
      }
    },
  );
});
