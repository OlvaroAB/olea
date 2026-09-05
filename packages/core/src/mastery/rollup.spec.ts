// Scenario: features/F2-review.md — "F2.3 — Mastery sprig reflects real
// maturity" / "recognition alone caps the sprig, it doesn't max it",
// tagged `@auto:core/mastery/rollup.spec` (this file; the tag was corrected
// from `core/mastery-rollup.spec` to match this module's actual path — see
// this task's report).
//
// Vocabulary updated for D-049/`VOC-1` (`ol-7efk`): the retired five-state
// ordinal (`new`/`shaky`/`coming`/`solid`/`yours`) is now the ratified
// four-stage set (`seed`/`sprout`/`sapling`/`tree`). `shaky` and `coming`
// collapse onto one word, `sprout` — see `rollup.ts`'s module doc for why.
//
// Concept and instrument ids below are structural placeholders
// ("concept-a", "qa:concept-a:1"), never fixture vocabulary — INV-3.
import type { ReviewLogEntry, ReviewLogRecord, SoloLevel, SuspendLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { mergeReviewLogRecords } from '../review-log/merge.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { Scheduler, SchedulerState } from '../scheduler/types.js';
import { replaySchedulerStates } from '../session/replay.js';
import {
  computeAllConceptMastery,
  computeConceptMastery,
  conceptIdsInLog,
  conceptVitalityInstruments,
  DEPTH_GATE_SOLO_LEVEL,
  evidenceTierOf,
  MIN_SPACED_RETRIEVAL_DAYS,
  masteryAtTimeForConceptIds,
  readAllConceptVitality,
  readConceptVitality,
} from './rollup.js';

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `r-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-01-10T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

/** One event per day, starting `startDay`, `count` days apart by 1 day each. */
function onConsecutiveDays(
  startDay: string,
  count: number,
  build: (day: string, index: number) => Partial<ReviewLogRecord>,
): ReviewLogEntry[] {
  const start = new Date(`${startDay}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    return review({ eventId: `d${i}`, timestamp: `${day}T09:00:00-04:00`, ...build(day, i) });
  });
}

/**
 * A graded explain-back review event for `concept-a` — R9's SOLO verdict as
 * the log actually carries it (`explainBackGrade`, `contracts/review-log.ts`),
 * with `rating: null` per F2.16. Structural placeholders throughout (INV-3).
 */
function gradedExplainBack(
  soloLevel: SoloLevel,
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return review({
    eventId: `eb-${soloLevel}`,
    instrumentId: 'explain-back:concept-a',
    instrumentType: 'explain-back',
    rating: null,
    explainBackGrade: {
      soloLevel,
      contentRef: 'content-ref-placeholder',
      revisionOf: null,
      artifactProvenance: {
        taskId: 'explain-back-grade',
        promptVersion: 'v0',
        modelId: 'model-placeholder',
      },
    },
    ...overrides,
  });
}

describe('evidenceTierOf — R7 tiers', () => {
  it('mcq is recognition, qa/cloze are recall, explain-back is explanation', () => {
    expect(evidenceTierOf('mcq')).toBe('recognition');
    expect(evidenceTierOf('qa')).toBe('recall');
    expect(evidenceTierOf('cloze')).toBe('recall');
    expect(evidenceTierOf('explain-back')).toBe('explanation');
  });
});

describe('computeConceptMastery — empty log and no-evidence concept', () => {
  it('an empty log is `seed`', () => {
    const result = computeConceptMastery([], 'concept-a');
    expect(result.state).toBe('seed');
    expect(result.evidence.scoredEventCount).toBe(0);
  });

  it('a concept the log never names is `seed`, even when the log has other evidence', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, () => ({ conceptIds: ['concept-b'] }));
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('seed');
  });
});

describe('computeConceptMastery — recognition-only concept caps at sapling (named test, R7)', () => {
  it('many correct MCQ reviews, spread over days, never exceed sapling', () => {
    const entries = onConsecutiveDays('2026-01-01', 20, () => ({
      instrumentType: 'mcq',
      instrumentId: 'mcq:concept-a:1',
      rating: 'good',
    }));
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('sapling');
    expect(result.evidence.recognitionOnly).toBe(true);
  });

  it('a mixed-in recall success clears `recognitionOnly` but still cannot reach `tree` (MAT-6: only the depth gate can)', () => {
    const mcq = onConsecutiveDays('2026-01-01', 19, () => ({
      instrumentType: 'mcq',
      instrumentId: 'mcq:concept-a:1',
      rating: 'good',
    }));
    const recall = review({
      eventId: 'd-recall',
      timestamp: '2026-01-20T09:00:00-04:00',
      instrumentType: 'qa',
      instrumentId: 'qa:concept-a:1',
      rating: 'good',
    });
    const result = computeConceptMastery([...mcq, recall], 'concept-a');
    expect(result.evidence.recognitionOnly).toBe(false);
    expect(result.state).toBe('sapling');
  });
});

describe('computeConceptMastery — an UNGRADED explain-back is recorded, never counted (R7: success, not attempt)', () => {
  it('explain-back attempts with no verdict do not reach past seed — no success signal exists to act on', () => {
    const entries = [
      review({
        eventId: 'e1',
        instrumentType: 'explain-back',
        rating: null,
        instrumentId: 'explain-back:concept-a',
      }),
      review({
        eventId: 'e2',
        timestamp: '2026-01-11T09:00:00-04:00',
        instrumentType: 'explain-back',
        rating: null,
        instrumentId: 'explain-back:concept-a',
      }),
    ];
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('seed');
    expect(result.evidence.explainBackAttempts).toBe(2);
    expect(result.evidence.tiersPracticed.explanation).toBe(true);
  });

  it('an ungraded explain-back does not satisfy the depth gate even alongside solid recall evidence', () => {
    const recall = onConsecutiveDays('2026-01-01', 5, () => ({
      instrumentType: 'qa',
      rating: 'good',
    }));
    // Recall alone reaches `sapling` and stops there (see the dedicated test
    // below); this asserts an UNGRADED explain-back's presence changes nothing
    // — it is recorded, not counted, per R7's "success", not "attempt".
    const withExplainBack = [
      ...recall,
      review({
        eventId: 'eb',
        timestamp: '2026-01-06T09:00:00-04:00',
        instrumentType: 'explain-back',
        rating: null,
        instrumentId: 'explain-back:concept-a',
      }),
    ];
    const withoutExplainBack = computeConceptMastery(recall, 'concept-a');
    const with_ = computeConceptMastery(withExplainBack, 'concept-a');
    expect(with_.state).toBe(withoutExplainBack.state);
    expect(with_.evidence.explainBackAttempts).toBe(1);
  });
});

// Scenario: features/F2-review.md — "R3 / R7 / R9 — Growth stage is monotonic,
// vitality is three-valued, and the model never holds the estimate" →
// "`tree` reachable only through a graded explain-back, never through recall
// alone", tagged `@auto:core/mastery/rollup.spec` (this file).
describe('computeConceptMastery — the spacing gate and the depth gate (MAT-6, R7)', () => {
  it('spaced, reliable Q&A recall reaches `sapling` and stops there — recall alone never reaches `tree`', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, () => ({
      instrumentType: 'qa',
      rating: 'good',
    }));
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('sapling');
    expect(result.evidence.successfulScoredDays).toBe(5);
    expect(result.evidence.depthGateCleared).toBe(false);
  });

  it('a high-success run crammed into one sitting is `sprout` — the spacing gate, `[D-145]`', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      review({
        eventId: `c${i}`,
        timestamp: `2026-01-01T0${9 + i}:00:00-04:00`,
        instrumentType: 'qa',
        rating: 'good',
      }),
    );
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('sprout');
    expect(result.evidence.successfulScoredDays).toBe(1);
  });

  it('a graded explain-back at the depth threshold reaches `tree`, with no recall evidence at all', () => {
    const result = computeConceptMastery([gradedExplainBack('relational')], 'concept-a');
    expect(result.state).toBe('tree');
    expect(result.evidence.deepestSoloLevel).toBe('relational');
    expect(result.evidence.depthGateCleared).toBe(true);
    expect(result.evidence.gradedExplainBackCount).toBe(1);
  });

  it('a graded explain-back BELOW the depth threshold does not open the gate', () => {
    for (const level of ['prestructural', 'unistructural', 'multistructural'] as const) {
      const result = computeConceptMastery([gradedExplainBack(level)], 'concept-a');
      expect(result.evidence.depthGateCleared).toBe(false);
      expect(result.state).toBe('sprout');
    }
  });

  it('`extended-abstract` clears the gate too — the threshold is a floor, not an equality', () => {
    const result = computeConceptMastery([gradedExplainBack('extended-abstract')], 'concept-a');
    expect(result.state).toBe('tree');
  });

  it('the deepest verdict EVER recorded governs — a later shallower attempt never takes the stage back', () => {
    const deepThenShallow = [
      gradedExplainBack('relational', { eventId: 'g1', timestamp: '2026-01-01T09:00:00-04:00' }),
      gradedExplainBack('unistructural', {
        eventId: 'g2',
        timestamp: '2026-02-01T09:00:00-04:00',
      }),
    ];
    const result = computeConceptMastery(deepThenShallow, 'concept-a');
    expect(result.evidence.deepestSoloLevel).toBe('relational');
    expect(result.state).toBe('tree');
  });
});

// Scenario: features/F2-review.md — "no code path lowers a growth stage" /
// "a lapse, a fresh misconception, or a pruning never takes back a stage
// already earned", tagged `@auto:core/mastery/rollup.spec` (this file). This
// is the in-repo twin of `olea-service`'s `scripts/harness/mastery-checks.mjs`
// monotonicity run (CHK-2, `ol-3ux7.15`), which drives the same property
// through `checkMasteryMonotonicity`.
describe('computeConceptMastery — the high-water mark never falls (R3, knowledge model §8 test 4)', () => {
  const rank = (state: string) => ['seed', 'sprout', 'sapling', 'tree'].indexOf(state);

  it('a concept at `tree` stays `tree` through a run of lapses', () => {
    const earned = [
      ...onConsecutiveDays('2026-01-01', 3, () => ({ instrumentType: 'qa', rating: 'good' })),
      gradedExplainBack('relational', { eventId: 'g', timestamp: '2026-01-04T09:00:00-04:00' }),
    ];
    expect(computeConceptMastery(earned, 'concept-a').state).toBe('tree');

    const thenLapses = [
      ...earned,
      ...onConsecutiveDays('2026-02-01', 6, (_d, i) => ({
        eventId: `lapse-${i}`,
        instrumentType: 'qa',
        rating: 'again',
      })),
    ];
    expect(computeConceptMastery(thenLapses, 'concept-a').state).toBe('tree');
  });

  it('replaying any prefix, prefix by prefix, never lowers the stage', () => {
    const log = [
      ...onConsecutiveDays('2026-01-01', 3, () => ({ instrumentType: 'qa', rating: 'good' })),
      ...onConsecutiveDays('2026-01-10', 4, (_d, i) => ({
        eventId: `bad-${i}`,
        instrumentType: 'qa',
        rating: 'again',
      })),
      gradedExplainBack('relational', { eventId: 'g', timestamp: '2026-02-01T09:00:00-04:00' }),
      ...onConsecutiveDays('2026-03-01', 3, (_d, i) => ({
        eventId: `worse-${i}`,
        instrumentType: 'mcq',
        instrumentId: 'mcq:concept-a:1',
        rating: 'again',
      })),
    ];
    const sequence = log.map(
      (_, i) => computeConceptMastery(log.slice(0, i + 1), 'concept-a').state,
    );
    expect(sequence).toContain('tree'); // the property is not vacuous — the stage does move
    for (let i = 1; i < sequence.length; i += 1) {
      expect(rank(sequence[i] as string)).toBeGreaterThanOrEqual(rank(sequence[i - 1] as string));
    }
  });
});

describe('computeConceptMastery — a concept whose evidence disagrees sharply', () => {
  it('an even mix of hits and misses across several instruments reads as sprout', () => {
    // Four events, evenly split: two successes on two distinct days, one day
    // short of the spacing gate, so the concept sits at the `sprout` floor.
    const entries = onConsecutiveDays('2026-01-01', 4, (_day, i) => ({
      instrumentType: i % 2 === 0 ? 'qa' : 'mcq',
      instrumentId: i % 2 === 0 ? 'qa:concept-a:1' : 'mcq:concept-a:1',
      rating: i % 2 === 0 ? 'good' : 'again',
    }));
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.evidence.successfulScoredDays).toBe(2);
    expect(result.state).toBe('sprout');
  });

  it('an all-failure history is still sprout, never a state below it — the vocabulary has no floor beneath sprout once evidence exists', () => {
    const entries = onConsecutiveDays('2026-01-01', 4, () => ({ rating: 'again' }));
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.state).toBe('sprout');
  });
});

describe('computeConceptMastery — the two declared constants are honoured and validated (MAT-6)', () => {
  it('the shipped defaults are the declared ones: 3 spaced days, and `relational` on the depth gate', () => {
    expect(MIN_SPACED_RETRIEVAL_DAYS).toBe(3);
    expect(DEPTH_GATE_SOLO_LEVEL).toBe('relational');
  });

  it('a stricter spacing gate holds the same log at `sprout`', () => {
    const entries = onConsecutiveDays('2026-01-01', 3, () => ({
      instrumentType: 'qa',
      rating: 'good',
    }));
    expect(computeConceptMastery(entries, 'concept-a').state).toBe('sapling');
    expect(computeConceptMastery(entries, 'concept-a', { minSpacedRetrievalDays: 4 }).state).toBe(
      'sprout',
    );
  });

  it('a stricter depth gate holds a `relational` verdict short of `tree`', () => {
    const entries = [gradedExplainBack('relational')];
    expect(computeConceptMastery(entries, 'concept-a').state).toBe('tree');
    expect(
      computeConceptMastery(entries, 'concept-a', { depthGate: 'extended-abstract' }).state,
    ).toBe('sprout');
  });

  it('rejects a non-positive minSpacedRetrievalDays', () => {
    expect(() => computeConceptMastery([], 'concept-a', { minSpacedRetrievalDays: 0 })).toThrow();
  });

  it('rejects a depthGate that is not a SOLO level', () => {
    expect(() =>
      computeConceptMastery([], 'concept-a', { depthGate: 'tree' as unknown as SoloLevel }),
    ).toThrow();
  });

  it('rejects an empty conceptId', () => {
    expect(() => computeConceptMastery([], '')).toThrow();
  });
});

describe('rebuild-from-log equivalence and idempotent replay (this task N-013 requirement)', () => {
  it('projecting, discarding, and re-projecting the same log gives byte-identical results', () => {
    const entries = [
      ...onConsecutiveDays('2026-01-01', 4, (_d, i) => ({
        instrumentType: i % 2 === 0 ? 'qa' : 'mcq',
        rating: 'good',
      })),
      review({
        eventId: 'other-concept',
        timestamp: '2026-01-05T09:00:00-04:00',
        conceptIds: ['concept-b'],
      }),
    ];

    const first = computeAllConceptMastery(entries);
    // "Discard": nothing to tear down — the module holds no cache between
    // calls. Recompute from the same entries as a fresh call, proving that
    // fact rather than assuming it.
    const second = computeAllConceptMastery(entries);
    expect([...second]).toEqual([...first]);
  });

  it('is a pure function: the same call made twice returns equal, independently-built results', () => {
    const entries = onConsecutiveDays('2026-01-01', 6, () => ({
      instrumentType: 'qa',
      rating: 'good',
    }));
    const a = computeConceptMastery(entries, 'concept-a');
    const b = computeConceptMastery(entries, 'concept-a');
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // independently constructed, not memoised/shared
  });

  it('never mutates its input — replaying the identical entries array a second time changes nothing about it', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, (_d, i) => ({
      instrumentType: i % 2 === 0 ? 'qa' : 'mcq',
      rating: i % 2 === 0 ? 'good' : 'again',
    }));
    const before = JSON.parse(JSON.stringify(entries));
    computeConceptMastery(entries, 'concept-a');
    computeAllConceptMastery(entries);
    expect(entries).toEqual(before);
  });

  it('is indifferent to the order entries were supplied in — merge order never changes the result', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, (_d, i) => ({
      instrumentType: i % 2 === 0 ? 'qa' : 'mcq',
      rating: i % 2 === 0 ? 'good' : 'again',
    }));
    const forward = computeConceptMastery(entries, 'concept-a');
    const reversed = computeConceptMastery([...entries].reverse(), 'concept-a');
    expect(reversed).toEqual(forward);
  });
});

describe('the high-water fold needs no event order at all (ol-y3ne, revisited by MAT-6)', () => {
  // This module used to keep its own private `byInstantThenEventId`
  // comparator, duplicating the ruled fold total order in
  // `../review-log/merge.ts` (`ol-egov.20`, `ol-y3ne`), then imported the
  // shared one. MAT-6 removed the need for either: every fact the growth
  // stage reads is a count, a set or a maximum over the WHOLE log, so which
  // event is "last" cannot change the answer. These tests prove that
  // directly — the fold agrees with the ruled order because it is
  // indifferent to order, not because it re-implements it.

  it('agrees with mergeReviewLogRecords by being indifferent to the order entries arrive in', () => {
    const instant = '2026-01-10T09:00:00-04:00';
    const bbb = review({ eventId: 'bbb', timestamp: instant, rating: 'again' });
    const aaa = review({ eventId: 'aaa', timestamp: instant, rating: 'easy' });

    const mergedOrder = mergeReviewLogRecords([bbb, aaa]).records.map((r) => r.eventId);
    expect(mergedOrder).toEqual(['aaa', 'bbb']);

    const forwards = computeConceptMastery([bbb, aaa], 'concept-a');
    const backwards = computeConceptMastery([aaa, bbb], 'concept-a');
    expect(forwards).toEqual(backwards);
  });

  it('a scrambled log reads exactly as its merge-ordered self does', () => {
    const e1 = review({ eventId: 'e1', timestamp: '2026-01-10T09:00:00-04:00', rating: 'good' });
    const e2 = review({ eventId: 'e2', timestamp: '2026-01-11T09:00:00-04:00', rating: 'again' });
    const e3 = review({ eventId: 'e3', timestamp: '2026-01-12T09:00:00-04:00', rating: 'good' });
    const scrambled = [e3, e1, e2];

    const merged = mergeReviewLogRecords(scrambled).records;
    expect(merged.map((r) => r.eventId)).toEqual(['e1', 'e2', 'e3']);
    expect(computeConceptMastery(scrambled, 'concept-a')).toEqual(
      computeConceptMastery(merged, 'concept-a'),
    );
  });
});

describe('conceptIdsInLog', () => {
  it('collects every concept named by a review event, sorted, ignoring suspend events', () => {
    const entries: ReviewLogEntry[] = [
      review({ eventId: 'a', conceptIds: ['concept-b', 'concept-a'] }),
      {
        schemaVersion: 5,
        kind: 'suspend',
        eventId: 's1',
        timestamp: '2026-01-02T09:00:00-04:00',
        instrumentId: 'qa:concept-c:1',
        conceptIds: ['concept-c'],
      },
    ];
    expect(conceptIdsInLog(entries)).toEqual(['concept-a', 'concept-b']);
  });
});

describe('computeAllConceptMastery', () => {
  it('rolls up every concept the log names, per concept — never an aggregate (D-031/ol-7328 ruling)', () => {
    const entries = [
      ...onConsecutiveDays('2026-01-01', 5, () => ({ conceptIds: ['concept-a'], rating: 'good' })),
      ...onConsecutiveDays('2026-01-01', 4, () => ({ conceptIds: ['concept-b'], rating: 'again' })),
    ];
    const all = computeAllConceptMastery(entries);
    expect(all.get('concept-a')?.state).toBe('sapling');
    expect(all.get('concept-b')?.state).toBe('sprout');
  });

  it('a restricted conceptIds list rolls up only those concepts', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, (_d, i) => ({
      conceptIds: [i % 2 === 0 ? 'concept-a' : 'concept-b'],
    }));
    const all = computeAllConceptMastery(entries, ['concept-a']);
    expect([...all.keys()]).toEqual(['concept-a']);
  });
});

describe('masteryAtTimeForConceptIds — the value a future writer stamps (ol-g6zg v4 shape)', () => {
  it('builds a per-concept map agreeing with the given conceptIds', () => {
    const entries = onConsecutiveDays('2026-01-01', 5, () => ({
      instrumentType: 'qa',
      rating: 'good',
    }));
    const value = masteryAtTimeForConceptIds(entries, ['concept-a']);
    expect(value).toEqual({ attribution: 'per-concept', byConcept: { 'concept-a': 'sapling' } });
  });

  it('excludes the not-yet-appended event by construction — it only ever sees what the caller passes', () => {
    // Passing history that does *not* yet include "today's" event is the
    // caller's responsibility (module doc); this asserts the function reads
    // exactly what it is given and nothing more.
    const priorHistory = onConsecutiveDays('2026-01-01', 2, () => ({ rating: 'again' }));
    const value = masteryAtTimeForConceptIds(priorHistory, ['concept-a']);
    expect(value).toEqual({ attribution: 'per-concept', byConcept: { 'concept-a': 'sprout' } });
  });
});

// ---------------------------------------------------------------------------
// Register join 1-2 (`[D-087]`, `ol-95vv.1`): `conceptVitalityInstruments`,
// `readConceptVitality`, `readAllConceptVitality`. `vitality.spec.ts` is the
// standing proof for the fold itself (min, filter, floor); these tests prove
// the WIRE — that this module assembles the fold's input correctly from a
// review log and a scheduler, register join 1 (3.2's replayed state into
// 3.1's fold) — and re-assert D-087's three promises end to end so a defect
// in the assembly step (e.g. leaking another concept's instrument in) cannot
// hide behind an already-green fold test.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-03-01T09:00:00.000Z');

/**
 * A `Scheduler` whose recall probability is looked up per instrument id —
 * the same technique `vitality.spec.ts` uses, so a test can say "this
 * instrument is faded" without reverse-engineering an FSRS stability that
 * produces it. `schedule` still returns a real-shaped `SchedulerState`,
 * because `readConceptVitality`/`readAllConceptVitality` call
 * `replaySchedulerStates` internally, which needs something to fold.
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

function suspend(overrides: Partial<SuspendLogRecord> = {}): SuspendLogRecord {
  return {
    schemaVersion: 5,
    kind: 'suspend',
    eventId: 's1',
    timestamp: '2026-01-10T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    conceptIds: ['concept-a'],
    ...overrides,
  };
}

describe('conceptVitalityInstruments — register join 1 (3.2 replayed state -> 3.1 instrument list)', () => {
  it('gathers only the instruments that are evidence for the concept, with their replayed state', () => {
    const scheduler = stubScheduler({ 'qa:concept-a:1': 0.5, 'qa:concept-b:1': 0.9 });
    const entries: ReviewLogEntry[] = [
      review({ eventId: 'a', instrumentId: 'qa:concept-a:1', conceptIds: ['concept-a'] }),
      review({
        eventId: 'b',
        instrumentId: 'qa:concept-b:1',
        conceptIds: ['concept-b'],
        timestamp: '2026-01-11T09:00:00-04:00',
      }),
    ];
    const replayed = replaySchedulerStates(entries, scheduler);

    const forA = conceptVitalityInstruments(entries, 'concept-a', replayed);
    expect(forA).toHaveLength(1);
    expect(forA[0]?.instrumentId).toBe('qa:concept-a:1');
    expect(forA[0]?.instrumentType).toBe('qa');
    expect(forA[0]?.state).not.toBeNull();

    // concept-b's instrument never enters concept-a's list — the join does
    // not leak another concept's evidence into this one's fold.
    expect(forA.some((i) => i.instrumentId === 'qa:concept-b:1')).toBe(false);
  });

  it('reports state: null for an instrument with no completed review — the floor is evidential, not "absent from the log"', () => {
    const scheduler = stubScheduler({});
    // Recorded (it is evidence the concept was practised) but never rated —
    // the frozen record allows this so a real bug stays loggable; it must
    // never be fed to the scheduler (module doc, `session/replay.ts`).
    const entries: ReviewLogEntry[] = [review({ eventId: 'a', rating: null })];
    const replayed = replaySchedulerStates(entries, scheduler);

    const instruments = conceptVitalityInstruments(entries, 'concept-a', replayed);
    expect(instruments).toHaveLength(1);
    expect(instruments[0]?.state).toBeNull();
  });

  it('ignores suspend events entirely — they carry conceptIds but are not evidence', () => {
    const scheduler = stubScheduler({});
    const entries: ReviewLogEntry[] = [suspend()];
    const replayed = replaySchedulerStates(entries, scheduler);
    expect(conceptVitalityInstruments(entries, 'concept-a', replayed)).toEqual([]);
  });

  it('returns nothing for a concept the log never mentions', () => {
    const scheduler = stubScheduler({ 'qa:concept-a:1': 0.9 });
    const entries: ReviewLogEntry[] = [review()];
    const replayed = replaySchedulerStates(entries, scheduler);
    expect(conceptVitalityInstruments(entries, 'concept-nowhere', replayed)).toEqual([]);
  });
});

describe('readConceptVitality — the fold is a MINIMUM, not a mean (D-087, end to end)', () => {
  it('one faded instrument pulls the whole concept to tending, however fresh the rest are', () => {
    const scheduler = stubScheduler({ fresh: 0.99, alsoFresh: 0.98, faded: 0.4 });
    const entries: ReviewLogEntry[] = [
      review({ eventId: 'a', instrumentId: 'fresh' }),
      review({ eventId: 'b', instrumentId: 'alsoFresh' }),
      review({ eventId: 'c', instrumentId: 'faded' }),
    ];
    // Mean of 0.99/0.98/0.4 is 0.79 — above nothing interesting; the point is
    // that even a mean of the two FRESH ones (0.985) is not what governs.
    const reading = readConceptVitality(entries, 'concept-a', scheduler, NOW, 0.9);
    expect(reading.value).toBe('tending');
    expect(reading.weakest?.instrumentId).toBe('faded');
    expect(reading.instrumentsRead).toBe(3);
  });
});

describe('readConceptVitality — evidence tier is a FILTER, never a weight (D-087, end to end)', () => {
  it('an MCQ instrument for the same concept never enters the fold, however it scores', () => {
    const scheduler = stubScheduler({ faded: 0.4, 'inst-mcq': 1 });
    const entries: ReviewLogEntry[] = [
      review({ eventId: 'a', instrumentId: 'faded' }),
      review({
        eventId: 'b',
        instrumentId: 'inst-mcq',
        instrumentType: 'mcq',
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['mcq'],
          planVersion: null,
        },
      }),
    ];
    const reading = readConceptVitality(entries, 'concept-a', scheduler, NOW, 0.9);
    expect(reading.value).toBe('tending');
    expect(reading.instrumentsRead).toBe(1);
    expect(reading.weakest?.instrumentId).toBe('faded');
  });
});

describe('readConceptVitality — the sufficiency floor fires exactly on the ruled condition (D-087, end to end)', () => {
  it('reads early on an empty log', () => {
    const scheduler = stubScheduler({});
    const reading = readConceptVitality([], 'concept-a', scheduler, NOW, 0.9);
    expect(reading).toStrictEqual({ value: 'early', weakest: null, instrumentsRead: 0 });
  });

  it('reads early for a concept the log never mentions, even when other concepts have full evidence', () => {
    const scheduler = stubScheduler({ 'qa:concept-a:1': 0.99 });
    const entries: ReviewLogEntry[] = [review()];
    const reading = readConceptVitality(entries, 'concept-nowhere', scheduler, NOW, 0.9);
    expect(reading.value).toBe('early');
  });

  it('reads early when the concept is recognition-only, however well the MCQ is doing', () => {
    const scheduler = stubScheduler({ 'inst-mcq': 1 });
    const entries: ReviewLogEntry[] = [
      review({
        eventId: 'a',
        instrumentId: 'inst-mcq',
        instrumentType: 'mcq',
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['mcq'],
          planVersion: null,
        },
      }),
    ];
    const reading = readConceptVitality(entries, 'concept-a', scheduler, NOW, 0.9);
    expect(reading.value).toBe('early');
  });

  it('reads early when the only recall-tier review recorded was never rated (no COMPLETED review)', () => {
    const scheduler = stubScheduler({});
    const entries: ReviewLogEntry[] = [review({ eventId: 'a', rating: null })];
    const reading = readConceptVitality(entries, 'concept-a', scheduler, NOW, 0.9);
    expect(reading.value).toBe('early');
  });

  it('leaves the floor on the first completed recall review, however badly it went', () => {
    const scheduler = stubScheduler({ 'qa:concept-a:1': 0.1 });
    const entries: ReviewLogEntry[] = [review()];
    const reading = readConceptVitality(entries, 'concept-a', scheduler, NOW, 0.9);
    expect(reading.value).toBe('tending');
    expect(reading.instrumentsRead).toBe(1);
  });
});

describe('readAllConceptVitality — batches readConceptVitality over one replay', () => {
  it('agrees with calling readConceptVitality per concept', () => {
    const scheduler = stubScheduler({ 'qa:concept-a:1': 0.99, 'qa:concept-b:1': 0.2 });
    const entries: ReviewLogEntry[] = [
      review({ eventId: 'a', instrumentId: 'qa:concept-a:1', conceptIds: ['concept-a'] }),
      review({
        eventId: 'b',
        instrumentId: 'qa:concept-b:1',
        conceptIds: ['concept-b'],
        timestamp: '2026-01-11T09:00:00-04:00',
      }),
    ];
    const batched = readAllConceptVitality(
      entries,
      ['concept-a', 'concept-b'],
      scheduler,
      NOW,
      0.9,
    );
    expect(batched.get('concept-a')).toStrictEqual(
      readConceptVitality(entries, 'concept-a', scheduler, NOW, 0.9),
    );
    expect(batched.get('concept-b')).toStrictEqual(
      readConceptVitality(entries, 'concept-b', scheduler, NOW, 0.9),
    );
    expect(batched.get('concept-a')?.value).toBe('holding');
    expect(batched.get('concept-b')?.value).toBe('tending');
  });

  it('returns an empty map for an empty conceptIds list, even over a non-empty log', () => {
    const scheduler = stubScheduler({ 'qa:concept-a:1': 0.99 });
    const entries: ReviewLogEntry[] = [review()];
    const batched = readAllConceptVitality(entries, [], scheduler, NOW, 0.9);
    expect(batched.size).toBe(0);
  });

  it('returns an empty map for an empty log', () => {
    const scheduler = stubScheduler({});
    const batched = readAllConceptVitality([], ['concept-a'], scheduler, NOW, 0.9);
    expect(batched.get('concept-a')).toStrictEqual({
      value: 'early',
      weakest: null,
      instrumentsRead: 0,
    });
  });
});

describe('readConceptVitality — against the real ts-fsrs port (wire integration, not just the stub)', () => {
  it('reads holding immediately after a review and decays to tending as the concept is left alone', () => {
    const scheduler = createFsrsScheduler();
    const reviewedOn = '2026-03-01T09:00:00-04:00';
    const entries: ReviewLogEntry[] = [
      review({
        eventId: 'a',
        instrumentId: 'qa:concept-a:1',
        timestamp: reviewedOn,
        rating: 'good',
      }),
    ];
    const holdingCut = 0.9;

    const sameDay = readConceptVitality(
      entries,
      'concept-a',
      scheduler,
      new Date(reviewedOn),
      holdingCut,
    );
    expect(sameDay.value).toBe('holding');

    // The stage would not have moved (no wall clock in computeConceptMastery)
    // — vitality is the axis that carries this decay.
    const muchLater = readConceptVitality(
      entries,
      'concept-a',
      scheduler,
      new Date('2026-06-01T09:00:00.000Z'),
      holdingCut,
    );
    expect(muchLater.value).toBe('tending');
    expect(muchLater.weakest?.recallProbability).toBeLessThan(
      sameDay.weakest?.recallProbability ?? 1,
    );
  });
});
