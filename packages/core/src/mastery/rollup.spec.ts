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
import assert from 'node:assert';
import type {
  DisputeLogRecord,
  InstrumentType,
  Rating,
  ReviewLogEntry,
  ReviewLogRecord,
  SoloLevel,
  SupportLevel,
  SuspendLogRecord,
  VerdictLogRecord,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { mergeReviewLogRecords } from '../review-log/merge.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { Scheduler, SchedulerState } from '../scheduler/types.js';
import { replaySchedulerStates } from '../session/replay.js';
import { readAllEligibleConceptVitality } from './attainment.js';
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
  reviewRecordsForConcept,
} from './rollup.js';
import { projectInstrumentValidity } from './validity.js';

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
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
    // `[D-281]`: the four pieces of qualifying evidence travel together, so
    // the default helper carries a qualifying attempt — an INDEPENDENT
    // correctness verdict of `correct` and an admitted support level — and the
    // tests below strip one piece at a time to show what each one is doing.
    supportLevelShown: 'independent',
    explainBackGrade: {
      soloLevel,
      correctness: 'correct',
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
    // Ruling of 2026-09-28 (`ol-egov.141.89.9.66`): nothing assessed, so no
    // practice is established — not even the "practised" flag.
    expect(result.evidence.tiersPracticed.explanation).toBe(false);
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

describe('computeConceptMastery — tiersSucceeded (ol-lfhj, R7, review 3.4: "a wrong answer never lowers need")', () => {
  it('a single wrong MCQ answer PRACTISES recognition but does not SUCCEED at it', () => {
    const entries = [
      review({ instrumentType: 'mcq', instrumentId: 'mcq:concept-a:1', rating: 'again' }),
    ];
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.evidence.tiersPracticed.recognition).toBe(true);
    expect(result.evidence.tiersSucceeded?.recognition).toBe(false);
  });

  it('a single right MCQ answer succeeds at recognition too', () => {
    const entries = [
      review({ instrumentType: 'mcq', instrumentId: 'mcq:concept-a:1', rating: 'good' }),
    ];
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.evidence.tiersPracticed.recognition).toBe(true);
    expect(result.evidence.tiersSucceeded?.recognition).toBe(true);
  });

  it('a wrong answer among an all-failure history never sets tiersSucceeded, for any tier', () => {
    const entries = onConsecutiveDays('2026-01-01', 4, () => ({ rating: 'again' }));
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.evidence.tiersPracticed.recall).toBe(true);
    expect(result.evidence.tiersSucceeded?.recall).toBe(false);
  });

  it('an explain-back graded incorrect practises explanation but does not succeed at it', () => {
    const entries = [
      gradedExplainBack('relational', {
        explainBackGrade: {
          soloLevel: 'relational',
          correctness: 'incorrect',
          contentRef: 'content-ref-placeholder',
          revisionOf: null,
          artifactProvenance: {
            taskId: 'explain-back-grade',
            promptVersion: 'v0',
            modelId: 'model-placeholder',
          },
        },
      }),
    ];
    const result = computeConceptMastery(entries, 'concept-a');
    expect(result.evidence.tiersPracticed.explanation).toBe(true);
    expect(result.evidence.tiersSucceeded?.explanation).toBe(false);
    // R3/R7: correctness alone does not open the depth gate (assistance and
    // instrument validity gate it too), but it must never claim success.
    expect(result.state).not.toBe('tree');
  });
});

/**
 * An explain-back review carrying only the independent correctness verdict
 * (v6's top-level `explainBackCorrectness`, `[D-303]`) and no depth grade:
 * what the accept path records when depth grading was skipped (`[D-286]`: an
 * incorrect verdict never gets a depth pass) or was unavailable (`ol-ryrh`).
 */
function correctnessOnlyExplainBack(
  verdict: 'correct' | 'partial' | 'incorrect',
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return review({
    eventId: `eb-correctness-only-${verdict}`,
    instrumentId: 'explain-back:concept-a',
    instrumentType: 'explain-back',
    rating: null,
    supportLevelShown: 'independent',
    explainBackCorrectness: {
      verdict,
      artifactProvenance: {
        taskId: 'explain-back-correctness',
        promptVersion: 'v0',
        modelId: 'model-placeholder',
      },
    },
    ...overrides,
  });
}

// `ol-ryrh` (ruled 2026-09-27): a correctness verdict recorded without a depth
// grade does not count toward the explanation tier; it counts wherever
// correctness alone counts (`ol-egov.141.89.6.59`).
describe('computeConceptMastery — a correctness-only explain-back record (ol-ryrh)', () => {
  it('a correct verdict with no depth grade gives no explanation-tier success and never the top stage', () => {
    const result = computeConceptMastery([correctnessOnlyExplainBack('correct')], 'concept-a');
    expect(result.evidence.tiersPracticed.explanation).toBe(true);
    expect(result.evidence.tiersSucceeded?.explanation).toBe(false);
    expect(result.evidence.gradedExplainBackCount).toBe(0);
    expect(result.evidence.deepestSoloLevel).toBeNull();
    expect(result.evidence.depthGateCleared).toBe(false);
    expect(result.evidence.topStageQualified).toBe(false);
    expect(result.state).not.toBe('tree');
  });

  it('the same verdict WITH a depth grade does succeed at the explanation tier, so the test above can fail', () => {
    const result = computeConceptMastery([gradedExplainBack('relational')], 'concept-a');
    expect(result.evidence.tiersSucceeded?.explanation).toBe(true);
  });

  it('beside spaced recall, a correct correctness-only record leaves the stage where recall put it', () => {
    const recall = onConsecutiveDays('2026-01-01', 5, () => ({
      instrumentType: 'qa',
      rating: 'good',
    }));
    const withRecord = [
      ...recall,
      correctnessOnlyExplainBack('correct', { timestamp: '2026-01-06T09:00:00-04:00' }),
    ];
    expect(computeConceptMastery(recall, 'concept-a').state).toBe('sapling');
    expect(computeConceptMastery(withRecord, 'concept-a').state).toBe('sapling');
  });

  // The seed-to-sprout floor is a place where correctness alone counts:
  // `sprout` is "Practised" (vocabulary registry, growth stage axis 1), the
  // floor is outcome-independent ("any scored review, whatever its outcome"),
  // and no clause puts a depth condition anywhere below the top stage (R7:
  // the depth gate is the top stage's; `sapling` is reachable on any mix).
  it.each(['correct', 'partial', 'incorrect'] as const)(
    'a %s verdict with no depth grade lifts seed to sprout, and no further',
    (verdict) => {
      const result = computeConceptMastery([correctnessOnlyExplainBack(verdict)], 'concept-a');
      expect(result.state).toBe('sprout');
      expect(result.evidence.correctnessOnlyExplainBackCount).toBe(1);
      expect(result.evidence.scoredEventCount).toBe(0);
    },
  );

  it('an explain-back with neither a verdict nor a depth grade still stays at seed', () => {
    const result = computeConceptMastery(
      [
        review({
          instrumentId: 'explain-back:concept-a',
          instrumentType: 'explain-back',
          rating: null,
        }),
      ],
      'concept-a',
    );
    expect(result.state).toBe('seed');
    expect(result.evidence.correctnessOnlyExplainBackCount).toBe(0);
  });

  it('a record carrying a depth grade is counted as graded, not as correctness-only', () => {
    const result = computeConceptMastery([gradedExplainBack('multistructural')], 'concept-a');
    expect(result.evidence.gradedExplainBackCount).toBe(1);
    expect(result.evidence.correctnessOnlyExplainBackCount).toBe(0);
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

describe('the fold reads the depth gate through the option a study plan can supply, with the declared value as the cold-start fallback (ol-egov.141.89.9.18, att.md item 12)', () => {
  it('a delivered gate looser than the declared cut admits a verdict the cold-start fallback would refuse', () => {
    const entries = [gradedExplainBack('multistructural')];
    // No plan cached: the declared cut (`relational`) applies, and a
    // `multistructural` verdict falls short of it.
    expect(computeConceptMastery(entries, 'concept-a').state).toBe('sprout');
    // A plan-delivered gate loosens the cut, and the same verdict now
    // qualifies — the delivered value changes the outcome.
    expect(
      computeConceptMastery(entries, 'concept-a', { depthGate: 'multistructural' }).state,
    ).toBe('tree');
  });

  it('with no plan cached, the fold falls back to the declared cut, not to no gate at all', () => {
    const entries = [gradedExplainBack('relational')];
    const noOptionSupplied = computeConceptMastery(entries, 'concept-a');
    const explicitDeclaredValue = computeConceptMastery(entries, 'concept-a', {
      depthGate: DEPTH_GATE_SOLO_LEVEL,
    });
    expect(noOptionSupplied.state).toBe(explicitDeclaredValue.state);
    expect(noOptionSupplied.evidence).toEqual(explicitDeclaredValue.evidence);
  });

  it('computeAllConceptMastery threads a delivered gate to every concept it folds, not only the single-concept entry point', () => {
    const entries = [
      gradedExplainBack('multistructural', {
        eventId: 'eb-a',
        instrumentId: 'explain-back:concept-a',
        conceptIds: ['concept-a'],
      }),
      gradedExplainBack('multistructural', {
        eventId: 'eb-b',
        instrumentId: 'explain-back:concept-b',
        conceptIds: ['concept-b'],
      }),
    ];
    const coldStart = computeAllConceptMastery(entries);
    expect(coldStart.get('concept-a')?.state).toBe('sprout');
    expect(coldStart.get('concept-b')?.state).toBe('sprout');

    const delivered = computeAllConceptMastery(entries, undefined, {
      depthGate: 'multistructural',
    });
    expect(delivered.get('concept-a')?.state).toBe('tree');
    expect(delivered.get('concept-b')?.state).toBe('tree');
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
  it('collects every concept a review event scores, sorted, ignoring suspend events and context concepts', () => {
    const entries: ReviewLogEntry[] = [
      review({ eventId: 'a', conceptIds: ['concept-b', 'concept-a'] }),
      review({ eventId: 'a2', conceptIds: ['concept-d'] }),
      {
        schemaVersion: 6,
        kind: 'suspend',
        eventId: 's1',
        timestamp: '2026-01-02T09:00:00-04:00',
        instrumentId: 'qa:concept-c:1',
        conceptIds: ['concept-c'],
      },
    ];
    // `[D-419]`: 'concept-a' rides the first record as context only, so no
    // review scored it and it is not in the log's scored set.
    expect(conceptIdsInLog(entries)).toEqual(['concept-b', 'concept-d']);
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
    schemaVersion: 6,
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

// Scenario: features/F5-explain-it-back.md — "F5.8 — what the top growth
// stage claims, and the evidence that qualifies it [D-281]", tagged
// `@auto:MAT-C5-correctness-required`, `@auto:MAT-C5-legacy-unknown`,
// `@auto:MAT-C5-assistance`, `@auto:MAT-C5-instrument-validity` and
// `@auto:MAT-C5-revision-supersedes`. Structural placeholders throughout
// (INV-3).
describe('computeConceptMastery — [D-281] qualifying evidence for the top stage', () => {
  it('@auto:MAT-C5-correctness-required — a structurally deep but INCORRECT answer never reaches `tree`', () => {
    for (const verdict of ['partial', 'incorrect'] as const) {
      const entry = gradedExplainBack('relational');
      assert(entry.explainBackGrade);
      const wrong = {
        ...entry,
        explainBackGrade: { ...entry.explainBackGrade, correctness: verdict },
      };
      const result = computeConceptMastery([wrong], 'concept-a');
      expect(result.evidence.depthGateCleared).toBe(true);
      expect(result.evidence.topStageQualified).toBe(false);
      expect(result.state).toBe('sprout');
    }
  });

  it('@auto:MAT-C5-legacy-unknown — a record written before the correctness field existed reads as unknown, never as correct', () => {
    const entry = gradedExplainBack('extended-abstract');
    assert(entry.explainBackGrade);
    const { correctness: _dropped, ...legacyGrade } = entry.explainBackGrade;
    const legacy = { ...entry, explainBackGrade: legacyGrade };
    const result = computeConceptMastery([legacy], 'concept-a');
    expect(result.evidence.topStageQualified).toBe(false);
    expect(result.state).toBe('sprout');
  });

  it('@auto:MAT-C5-assistance — an admitted support level reaches `tree`; `guided` and an unrecorded level do not', () => {
    expect(
      computeConceptMastery(
        [gradedExplainBack('relational', { supportLevelShown: 'prompted' })],
        'concept-a',
      ).state,
    ).toBe('tree');

    expect(
      computeConceptMastery(
        [gradedExplainBack('relational', { supportLevelShown: 'guided' })],
        'concept-a',
      ).state,
    ).toBe('sprout');

    const entry = gradedExplainBack('relational');
    const { supportLevelShown: _none, ...noSupport } = entry;
    expect(computeConceptMastery([noSupport], 'concept-a').state).toBe('sprout');
  });

  it('@auto:MAT-C5-instrument-validity — an attempt on a withdrawn or rejected instrument qualifies nothing', () => {
    const entries = [gradedExplainBack('relational')];
    expect(computeConceptMastery(entries, 'concept-a').state).toBe('tree');
    expect(
      computeConceptMastery(entries, 'concept-a', {
        invalidInstrumentIds: ['explain-back:concept-a'],
      }).state,
    ).toBe('sprout');
  });

  it('@auto:MAT-C5-revision-supersedes — a corrected grade supersedes the one it corrects, whatever order the log is folded in', () => {
    const original = gradedExplainBack('relational', { eventId: 'g1' });
    const correction = gradedExplainBack('multistructural', {
      eventId: 'g2',
      timestamp: '2026-02-01T09:00:00-04:00',
    });
    assert(correction.explainBackGrade);
    const corrected = {
      ...correction,
      explainBackGrade: { ...correction.explainBackGrade, revisionOf: 'g1' },
    };
    expect(computeConceptMastery([original], 'concept-a').state).toBe('tree');
    expect(computeConceptMastery([original, corrected], 'concept-a').state).toBe('sprout');
    expect(computeConceptMastery([corrected, original], 'concept-a').state).toBe('sprout');
  });

  it('a correction that itself qualifies still grants the stage — supersession replaces, it does not punish', () => {
    const original = gradedExplainBack('relational', { eventId: 'g1' });
    const correction = gradedExplainBack('extended-abstract', { eventId: 'g2' });
    assert(correction.explainBackGrade);
    const corrected = {
      ...correction,
      explainBackGrade: { ...correction.explainBackGrade, revisionOf: 'g1' },
    };
    expect(computeConceptMastery([original, corrected], 'concept-a').state).toBe('tree');
  });

  it('[TARGET-5] a CHAIN of two re-grades: the fold reads the LATEST re-grade, whatever order the log is folded in — an original re-graded away and then re-graded back qualifies again', () => {
    // g1 (original, qualifying) -> g2 (revisionOf g1, a false-basis correction
    // to `incorrect` — excludes g1 AND fails to qualify itself) -> g3
    // (revisionOf g2, re-graded correct again — the judgement now standing).
    // A fold that stopped at the first `revisionOf` hop (reading only g1's own
    // corrector, g2) would wrongly settle on g2's `incorrect` verdict as final;
    // R10 requires the LATEST re-grade, g3, to be what stands.
    const g1 = gradedExplainBack('relational', { eventId: 'g1' });
    assert(g1.explainBackGrade);
    const g2 = gradedExplainBack('relational', {
      eventId: 'g2',
      timestamp: '2026-02-01T09:00:00-04:00',
      explainBackGrade: {
        ...g1.explainBackGrade,
        correctness: 'incorrect',
        revisionOf: 'g1',
      },
    });
    const g3 = gradedExplainBack('relational', {
      eventId: 'g3',
      timestamp: '2026-02-02T09:00:00-04:00',
      explainBackGrade: {
        ...g1.explainBackGrade,
        correctness: 'correct',
        revisionOf: 'g2',
      },
    });

    expect(computeConceptMastery([g1], 'concept-a').state).toBe('tree');
    // Only the false-basis correction landed so far: g1 is excluded (superseded), g2
    // itself does not qualify (incorrect) — the stage drops, it is not stuck at g1.
    expect(computeConceptMastery([g1, g2], 'concept-a').state).toBe('sprout');
    // The re-grade of the re-grade lands: g2 is now also superseded, g3 is the
    // latest judgement and it qualifies — the stage is granted again, from g3.
    for (const ordering of [
      [g1, g2, g3],
      [g3, g2, g1],
      [g2, g1, g3],
      [g3, g1, g2],
    ]) {
      const result = computeConceptMastery(ordering, 'concept-a');
      expect(result.state).toBe('tree');
      expect(result.evidence.topStageAttempt?.eventId).toBe('g3');
    }
  });
});

// -----------------------------------------------------------------------------
// Knowledge model §8 test 5 / `[D-087]` — strip-invariance
// (features/F2-review.md, "Feature: Knowledge model §8 test 5 / [D-087] —
// Strip-invariance", tagged `@auto:core/mastery/rollup.spec`; no matching
// test previously existed in this file — see ol-v7r5.69's report).
//
// The contract: folding a log and a copy of it with every
// `schedulingObservation` field and every stamped belief (`masteryAtTime`)
// removed must give byte-identical scoring readings — "a property over all
// logs ... the injected-case version is the smoke test, this is the
// contract" (knowledge model §8). A small seeded PRNG stands in for a
// property-test library (none is a dependency of this package) so the suite
// still runs over generated shapes rather than a fixed set of hand-built
// cases, deterministically across runs.
// -----------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) — no `fast-check` dependency in this package. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  const value = values[Math.floor(rand() * values.length)];
  if (value === undefined) throw new Error('pick: empty array');
  return value;
}

const GENERATED_INSTRUMENT_TYPES: readonly InstrumentType[] = [
  'qa',
  'mcq',
  'cloze',
  'explain-back',
];
const GENERATED_RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy'];
const GENERATED_SUPPORT_LEVELS: readonly SupportLevel[] = ['independent', 'prompted', 'guided'];
const GENERATED_SOLO_LEVELS: readonly SoloLevel[] = [
  'prestructural',
  'unistructural',
  'multistructural',
  'relational',
  'extended-abstract',
];
const GENERATED_CORRECTNESS: readonly ('correct' | 'partial' | 'incorrect')[] = [
  'correct',
  'partial',
  'incorrect',
];
const GENERATED_CONCEPT_IDS = ['concept-a', 'concept-b', 'concept-c'] as const;
const GENERATED_MASTERY_STATES = ['seed', 'sprout', 'sapling', 'tree'] as const;

/**
 * One pseudo-random log covering the full space of event shapes this fold
 * reads plus the two fields it must never read
 * (`schedulingObservation`, `masteryAtTime`) — every instrument type, every
 * rating including lapses, present/absent support level, a mix of concepts,
 * and correction chains via `explainBackGrade.revisionOf`.
 */
function generateRandomLog(seed: number, length: number): ReviewLogRecord[] {
  const rand = mulberry32(seed);
  const entries: ReviewLogRecord[] = [];
  let lastExplainBackEventId: string | null = null;
  for (let i = 0; i < length; i += 1) {
    const instrumentType = pick(rand, GENERATED_INSTRUMENT_TYPES);
    const conceptId = pick(rand, GENERATED_CONCEPT_IDS);
    const isExplainBack = instrumentType === 'explain-back';
    const day = 1 + Math.floor(rand() * 25);
    const eventId = `gen-${seed}-${i}`;
    const record = review({
      eventId,
      timestamp: `2026-01-${String(day).padStart(2, '0')}T09:00:00-04:00`,
      instrumentId: `${instrumentType}:${conceptId}:${Math.floor(rand() * 3)}`,
      instrumentType,
      conceptIds: [conceptId],
      rating: isExplainBack ? null : pick(rand, GENERATED_RATINGS),
      ...(rand() > 0.3 ? { supportLevelShown: pick(rand, GENERATED_SUPPORT_LEVELS) } : {}),
      ...(isExplainBack
        ? {
            explainBackGrade: {
              soloLevel: pick(rand, GENERATED_SOLO_LEVELS),
              correctness: pick(rand, GENERATED_CORRECTNESS),
              contentRef: 'content-ref-placeholder',
              // Occasionally supersedes the previous explain-back event, so
              // the generated space includes correction chains too.
              revisionOf: rand() > 0.7 ? lastExplainBackEventId : null,
              artifactProvenance: {
                taskId: 'explain-back-grade',
                promptVersion: 'v0',
                modelId: 'model-placeholder',
              },
            },
          }
        : {}),
      // The two fields the fold must never read — attached on roughly half
      // the events, so both their presence and absence are exercised.
      ...(rand() > 0.5
        ? { schedulingObservation: { neighbourConceptId: pick(rand, GENERATED_CONCEPT_IDS) } }
        : {}),
      ...(rand() > 0.5
        ? {
            masteryAtTime: {
              attribution: 'per-concept' as const,
              byConcept: { [conceptId]: pick(rand, GENERATED_MASTERY_STATES) },
            },
          }
        : {}),
    });
    entries.push(record);
    if (isExplainBack) lastExplainBackEventId = eventId;
  }
  return entries;
}

/** `entries`, with every `schedulingObservation` and every `masteryAtTime` field removed. */
function stripObservationsAndStamps(entries: readonly ReviewLogRecord[]): ReviewLogRecord[] {
  return entries.map((entry) => {
    const { schedulingObservation: _observation, masteryAtTime: _stamp, ...stripped } = entry;
    return stripped as ReviewLogRecord;
  });
}

describe('Knowledge model §8 test 5 / `[D-087]` — strip-invariance', () => {
  it('stripping every scheduling-observation field and every stamped belief changes no scoring reading — generated logs, not a fixed set of injected cases', () => {
    // 30 seeds, varying lengths — the full space of event shapes this module
    // reads (and the two fields it must not), not three hand-built logs.
    let anyHadObservation = false;
    let anyHadStamp = false;
    for (let seed = 1; seed <= 30; seed += 1) {
      const length = 5 + (seed % 12);
      const original = generateRandomLog(seed, length);
      const stripped = stripObservationsAndStamps(original);

      const hadObservation = original.some((e) => e.schedulingObservation !== undefined);
      const hadStamp = original.some((e) => e.masteryAtTime !== undefined);
      anyHadObservation ||= hadObservation;
      anyHadStamp ||= hadStamp;

      const conceptIds = [...new Set(original.flatMap((e) => e.conceptIds))];
      const before = computeAllConceptMastery(original, conceptIds);
      const after = computeAllConceptMastery(stripped, conceptIds);
      expect(
        [...after],
        `seed ${seed} (hadObservation=${hadObservation}, hadStamp=${hadStamp})`,
      ).toEqual([...before]);
    }
    // Not vacuous: across the 30 generated logs, both stripped fields were
    // actually present on at least one event.
    expect(anyHadObservation).toBe(true);
    expect(anyHadStamp).toBe(true);
  });

  it('the exclusion is by field semantics, never by filtering an event type — the same event, minus the field, still counts', () => {
    // One event carrying both a rating the fold must read and a scheduling
    // observation it must not: stripping the field must change nothing,
    // and the event must still be counted (not dropped as a whole).
    const withObservation = review({
      eventId: 'r-1',
      instrumentType: 'qa',
      conceptIds: ['concept-a'],
      rating: 'good',
      supportLevelShown: 'independent',
      schedulingObservation: { neighbourConceptId: 'concept-b' },
    });
    const { schedulingObservation: _observation, ...withoutObservation } = withObservation;

    const withResult = computeConceptMastery([withObservation], 'concept-a');
    const withoutResult = computeConceptMastery([withoutObservation], 'concept-a');
    expect(withoutResult).toEqual(withResult);
    // The rating is still read either way — the event was not dropped.
    expect(withResult.evidence.scoredEventCount).toBe(1);
    expect(withResult.evidence.scoredSuccessCount).toBe(1);
    expect(withoutResult.evidence.scoredEventCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// `ol-egov.141.89.9.60`: vitality is a CURRENT reading, so it excludes the
// evidence of an instrument proven invalid (`[D-338]` item 3; `[D-097]`'s
// read-time exclusion on reject, INV-6) — the same set the attainment fold
// excludes (`./validity.ts#projectInstrumentValidity`'s `provenInvalid`).
// Withheld-but-valid evidence (her suspension, a successor) is not proven
// invalid and keeps counting (`[D-347]`: availability is not validity).
// ---------------------------------------------------------------------------

function verdictOn(
  instrumentId: string,
  value: VerdictLogRecord['verdict'],
  eventId: string,
  timestamp = '2026-01-20T09:00:00-04:00',
): VerdictLogRecord {
  return {
    schemaVersion: 6,
    kind: 'verdict',
    eventId,
    timestamp,
    instrumentId,
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    verdict: value,
    artifactProvenance: { taskId: 't', promptVersion: 'v0', modelId: 'm' },
  };
}

function correctedGradeContest(instrumentId: string): DisputeLogRecord[] {
  const base = {
    schemaVersion: 6,
    kind: 'dispute',
    timestamp: '2026-01-20T09:00:00-04:00',
    claimKind: 'grade',
    claimRendering: 'explain-back-grade',
    conceptIds: ['concept-a'],
    instrumentId,
    evidenceBasis: 'basis-1',
    effect: 'quarantined',
  };
  return [
    { ...base, eventId: 'dispute-open' } as DisputeLogRecord,
    {
      ...base,
      eventId: 'dispute-resolved',
      timestamp: '2026-01-21T09:00:00-04:00',
      resolves: 'dispute-open',
      outcome: 'corrected',
    } as DisputeLogRecord,
  ];
}

describe('readAllConceptVitality / readConceptVitality — proven-invalid evidence is excluded (D-338 item 3, INV-6)', () => {
  // `faded` alone would set the minimum and read the concept as tending.
  const scheduler = stubScheduler({ sound: 0.99, faded: 0.3 });
  const practice: ReviewLogEntry[] = [
    review({ eventId: 'r-sound', instrumentId: 'sound' }),
    review({ eventId: 'r-faded', instrumentId: 'faded' }),
  ];

  it('baseline: with no validity fact the faded instrument sets the minimum', () => {
    const reading = readAllConceptVitality(practice, ['concept-a'], scheduler, NOW, 0.9).get(
      'concept-a',
    );
    expect(reading?.value).toBe('tending');
    expect(reading?.weakest?.instrumentId).toBe('faded');
    expect(reading?.instrumentsRead).toBe(2);
  });

  it('a rejected instrument no longer counts: removing the rejection moves the reading back (metamorphic)', () => {
    const withRejection = [...practice, verdictOn('faded', 'rejected', 'v-reject')];
    const excluded = readAllConceptVitality(withRejection, ['concept-a'], scheduler, NOW, 0.9).get(
      'concept-a',
    );
    expect(excluded).toStrictEqual({
      value: 'holding',
      weakest: { instrumentId: 'sound', recallProbability: 0.99 },
      instrumentsRead: 1,
    });
    const withoutRejection = withRejection.filter((e) => e.eventId !== 'v-reject');
    expect(
      readAllConceptVitality(withoutRejection, ['concept-a'], scheduler, NOW, 0.9).get('concept-a')
        ?.value,
    ).toBe('tending');
  });

  it('readConceptVitality applies the same exclusion as the batched reader', () => {
    const withRejection = [...practice, verdictOn('faded', 'rejected', 'v-reject')];
    expect(readConceptVitality(withRejection, 'concept-a', scheduler, NOW, 0.9)).toStrictEqual(
      readAllConceptVitality(withRejection, ['concept-a'], scheduler, NOW, 0.9).get('concept-a'),
    );
    expect(readConceptVitality(withRejection, 'concept-a', scheduler, NOW, 0.9).value).toBe(
      'holding',
    );
  });

  it('her deliberate restore lifts the rejection, and the evidence counts again (D-396)', () => {
    const restored: ReviewLogEntry[] = [
      ...practice,
      verdictOn('faded', 'rejected', 'v-reject'),
      {
        ...verdictOn('faded', 'accepted', 'v-restore', '2026-01-22T09:00:00-04:00'),
        restores: 'v-reject',
      },
    ];
    const reading = readAllConceptVitality(restored, ['concept-a'], scheduler, NOW, 0.9).get(
      'concept-a',
    );
    expect(reading?.value).toBe('tending');
    expect(reading?.instrumentsRead).toBe(2);
  });

  it('a grade contest resolved corrected, logged in the entries, excludes the instrument', () => {
    const entries = [...practice, ...correctedGradeContest('faded')];
    const reading = readAllConceptVitality(entries, ['concept-a'], scheduler, NOW, 0.9).get(
      'concept-a',
    );
    expect(reading?.value).toBe('holding');
    expect(reading?.instrumentsRead).toBe(1);
  });

  it('disputes read apart from the log reach the exclusion through a supplied validity projection', () => {
    const validity = projectInstrumentValidity(practice, correctedGradeContest('faded'));
    const reading = readAllConceptVitality(
      practice,
      ['concept-a'],
      scheduler,
      NOW,
      0.9,
      validity,
    ).get('concept-a');
    expect(reading?.value).toBe('holding');
    expect(readConceptVitality(practice, 'concept-a', scheduler, NOW, 0.9, validity).value).toBe(
      'holding',
    );
  });

  it('an only instrument proven invalid leaves the concept at the floor, never at a reading built on it', () => {
    const entries = [
      review({ eventId: 'r-faded', instrumentId: 'faded' }),
      verdictOn('faded', 'rejected', 'v-reject'),
    ];
    expect(
      readAllConceptVitality(entries, ['concept-a'], scheduler, NOW, 0.9).get('concept-a'),
    ).toStrictEqual({ value: 'early', weakest: null, instrumentsRead: 0 });
  });

  it('withheld but not proven invalid keeps counting: her suspension is not a defect (D-347)', () => {
    const entries = [
      ...practice,
      suspend({
        eventId: 's-faded',
        instrumentId: 'faded',
        timestamp: '2026-01-20T09:00:00-04:00',
      }),
    ];
    const reading = readAllConceptVitality(entries, ['concept-a'], scheduler, NOW, 0.9).get(
      'concept-a',
    );
    expect(reading?.value).toBe('tending');
    expect(reading?.weakest?.instrumentId).toBe('faded');
  });

  it('her acceptance is not a validity fact: an accepted or edited verdict excludes nothing', () => {
    const entries = [
      ...practice,
      verdictOn('faded', 'accepted', 'v-accept'),
      verdictOn('sound', 'edited', 'v-edit'),
    ];
    expect(
      readAllConceptVitality(entries, ['concept-a'], scheduler, NOW, 0.9).get('concept-a')?.value,
    ).toBe('tending');
  });

  it('excludes exactly the set the attainment reader excludes (one validity rule for vitality)', () => {
    const entries: ReviewLogEntry[] = [
      review({ eventId: 'a1', instrumentId: 'sound' }),
      review({ eventId: 'a2', instrumentId: 'faded' }),
      review({ eventId: 'b1', instrumentId: 'b-sound', conceptIds: ['concept-b'] }),
      review({ eventId: 'b2', instrumentId: 'b-faded', conceptIds: ['concept-b'] }),
      verdictOn('faded', 'rejected', 'v-reject'),
      ...correctedGradeContest('b-faded'),
      suspend({ eventId: 's-b', instrumentId: 'b-sound', timestamp: '2026-01-20T09:00:00-04:00' }),
    ];
    const both = stubScheduler({ sound: 0.99, faded: 0.3, 'b-sound': 0.95, 'b-faded': 0.2 });
    const ids = ['concept-a', 'concept-b', 'concept-nowhere'];
    const plain = readAllConceptVitality(entries, ids, both, NOW, 0.9);
    const eligible = readAllEligibleConceptVitality(
      entries,
      ids,
      both,
      NOW,
      0.9,
      projectInstrumentValidity(entries),
    );
    for (const id of ids) {
      const e = eligible.get(id);
      assert(e !== undefined);
      expect(plain.get(id)).toStrictEqual({
        value: e.value,
        weakest: e.weakest,
        instrumentsRead: e.instrumentsRead,
      });
    }
    expect(plain.get('concept-a')?.value).toBe('holding');
    expect(plain.get('concept-b')?.value).toBe('holding');
  });
});

// ---------------------------------------------------------------------------
// `ol-egov.141.89.9.66` — the rulings of 2026-09-28: which evidence counts,
// and a system failure is never read as hers. One block per rule; ids are
// structural placeholders (INV-3).
// ---------------------------------------------------------------------------

const PROVENANCE = { taskId: 't', promptVersion: 'v0', modelId: 'm' } as const;

function suspendOn(
  instrumentId: string,
  eventId: string,
  reason?: 'defect' | 'source-revision' | 'own-choice',
): SuspendLogRecord {
  return {
    schemaVersion: 6,
    kind: 'suspend',
    eventId,
    timestamp: '2026-01-25T09:00:00-04:00',
    instrumentId,
    conceptIds: ['concept-a'],
    ...(reason !== undefined ? { reason } : {}),
  } as SuspendLogRecord;
}

function correctnessOnly(
  eventId: string,
  verdict: 'correct' | 'partial' | 'incorrect',
  timestamp = '2026-01-10T09:00:00-04:00',
): ReviewLogRecord {
  return review({
    eventId,
    timestamp,
    instrumentId: 'explain-back:concept-a',
    instrumentType: 'explain-back',
    rating: null,
    supportLevelShown: 'independent',
    explainBackCorrectness: { verdict, artifactProvenance: PROVENANCE },
  });
}

function gradeContest(instrumentId: string, opened: string, resolved: string): DisputeLogRecord[] {
  const base = {
    schemaVersion: 6,
    kind: 'dispute',
    claimKind: 'grade',
    claimRendering: 'explain-back-grade',
    conceptIds: ['concept-a'],
    instrumentId,
    evidenceBasis: 'basis-1',
    effect: 'quarantined',
  };
  return [
    { ...base, eventId: `open-${instrumentId}`, timestamp: opened } as DisputeLogRecord,
    {
      ...base,
      eventId: `resolved-${instrumentId}`,
      timestamp: resolved,
      resolves: `open-${instrumentId}`,
      outcome: 'corrected',
    } as DisputeLogRecord,
  ];
}

describe('rule 1 (ol-egov.141.89.9.66): a personal withdrawal never invalidates sound evidence', () => {
  const recall = onConsecutiveDays('2026-01-01', 3, () => ({ instrumentId: 'qa:w' }));
  const scheduler = stubScheduler({ 'qa:w': 0.3 });

  it('her withdrawal, a revision or an unknown reason keeps the stage and the vitality reading', () => {
    const baseline = readAllConceptVitality(recall, ['concept-a'], scheduler, NOW, 0.9).get(
      'concept-a',
    );
    for (const reason of ['own-choice', 'source-revision', undefined] as const) {
      const entries = [...recall, suspendOn('qa:w', 's1', reason)];
      const validity = projectInstrumentValidity(entries);
      expect(computeConceptMastery(entries, 'concept-a').state).toBe('sapling');
      expect(
        computeConceptMastery(entries, 'concept-a', {
          invalidInstrumentIds: [...validity.provenInvalid.keys()],
        }).state,
      ).toBe('sapling');
      expect(
        readAllConceptVitality(entries, ['concept-a'], scheduler, NOW, 0.9).get('concept-a'),
      ).toStrictEqual(baseline);
    }
  });

  it('only a proven defect leaves current vitality: a suspension recorded as a defect does', () => {
    const entries = [...recall, suspendOn('qa:w', 's1', 'defect')];
    const reading = readAllConceptVitality(entries, ['concept-a'], scheduler, NOW, 0.9).get(
      'concept-a',
    );
    expect(reading?.instrumentsRead).toBe(0);
    expect(reading?.value).toBe('early');
  });
});

describe('rule 2 (ol-egov.141.89.9.66): a corrected grade uses the corrected verdict; unrelated reviews are never erased', () => {
  it('a corrective re-grade replaces the attempt it corrects in every fact, not only the top stage', () => {
    const original = gradedExplainBack('relational', { eventId: 'eb-original' });
    const regrade = gradedExplainBack('multistructural', {
      eventId: 'eb-regrade',
      timestamp: '2026-01-12T09:00:00-04:00',
      explainBackGrade: {
        soloLevel: 'multistructural',
        correctness: 'partial',
        contentRef: 'content-ref-placeholder',
        revisionOf: 'eb-original',
        artifactProvenance: PROVENANCE,
      },
    });
    const result = computeConceptMastery([original, regrade], 'concept-a');
    expect(result.state).toBe('sprout');
    expect(result.evidence.deepestSoloLevel).toBe('multistructural');
    expect(result.evidence.depthGateCleared).toBe(false);
    expect(result.evidence.tiersSucceeded?.explanation).toBe(false);
    expect(result.evidence.gradedExplainBackCount).toBe(1);
  });

  it('a corrected contest keeps the contested attempt as practice only and every other review of the instrument', () => {
    const recall = onConsecutiveDays('2026-01-01', 4, () => ({ instrumentId: 'qa:c' }));
    // The contest was about the last answer (nearest the dispute).
    const disputes = gradeContest('qa:c', '2026-01-04T09:05:00-04:00', '2026-01-06T09:00:00-04:00');
    const validity = projectInstrumentValidity(recall, disputes);
    expect([...validity.correctedEvidence.keys()]).toEqual(['d3']);
    expect(validity.provenInvalid.size).toBe(0);
    const result = computeConceptMastery(recall, 'concept-a', {
      correctedEventIds: [...validity.correctedEvidence.keys()],
    });
    // Three sound successes on three days still stand: nothing unrelated was erased.
    expect(result.state).toBe('sapling');
    expect(result.evidence.scoredEventCount).toBe(4);
    expect(result.evidence.scoredSuccessCount).toBe(3);
    expect(result.evidence.successfulScoredDays).toBe(3);
    expect(result.evidence.correctedAttemptCount).toBe(1);
  });

  it('a contested attempt with no corrected verdict is practice: seed lifts to sprout, and nothing more', () => {
    const attempt = gradedExplainBack('relational', { eventId: 'eb-1' });
    const disputes = gradeContest(
      'explain-back:concept-a',
      '2026-01-10T09:05:00-04:00',
      '2026-01-11T09:00:00-04:00',
    );
    const validity = projectInstrumentValidity([attempt], disputes);
    const result = computeConceptMastery([attempt], 'concept-a', {
      correctedEventIds: [...validity.correctedEvidence.keys()],
    });
    expect(result.state).toBe('sprout');
    expect(result.evidence.topStageQualified).toBe(false);
    expect(result.evidence.tiersSucceeded?.explanation).toBe(false);
    expect(result.evidence.deepestSoloLevel).toBeNull();
    expect(result.evidence.gradedExplainBackCount).toBe(0);
  });

  it('vitality replays the instrument without the corrected review, and keeps its other reviews', () => {
    const scheduler = stubScheduler({ 'qa:c': 0.3, 'qa:solo': 0.2 });
    const entries = [
      review({ eventId: 'c-1', instrumentId: 'qa:c', timestamp: '2026-01-02T09:00:00-04:00' }),
      review({ eventId: 'c-2', instrumentId: 'qa:c', timestamp: '2026-01-10T09:00:00-04:00' }),
      review({ eventId: 'solo', instrumentId: 'qa:solo', timestamp: '2026-01-02T09:00:00-04:00' }),
    ];
    const onC = projectInstrumentValidity(
      entries,
      gradeContest('qa:c', '2026-01-10T09:01:00-04:00', '2026-01-12T09:00:00-04:00'),
    );
    expect([...onC.correctedEvidence.keys()]).toEqual(['c-2']);
    const keptC = readAllConceptVitality(entries, ['concept-a'], scheduler, NOW, 0.9, onC).get(
      'concept-a',
    );
    expect(keptC?.instrumentsRead).toBe(2);

    const onSolo = projectInstrumentValidity(
      entries,
      gradeContest('qa:solo', '2026-01-02T09:01:00-04:00', '2026-01-03T09:00:00-04:00'),
    );
    const droppedSolo = readAllConceptVitality(
      entries,
      ['concept-a'],
      scheduler,
      NOW,
      0.9,
      onSolo,
    ).get('concept-a');
    expect(droppedSolo).toStrictEqual({
      value: 'tending',
      weakest: { instrumentId: 'qa:c', recallProbability: 0.3 },
      instrumentsRead: 1,
    });
  });
});

describe('rule 3 (ol-egov.141.89.9.66): sprout means practised — a genuine unsuccessful attempt earns no credit', () => {
  it('an incorrect explanation lifts seed to sprout and earns no explanation credit', () => {
    const result = computeConceptMastery([correctnessOnly('x1', 'incorrect')], 'concept-a');
    expect(result.state).toBe('sprout');
    expect(result.evidence.tiersPracticed.explanation).toBe(true);
    expect(result.evidence.tiersSucceeded?.explanation).toBe(false);
    expect(result.evidence.depthGateCleared).toBe(false);
  });

  it('a missed recall answer lifts to sprout and earns no recall credit, no success day', () => {
    const result = computeConceptMastery([review({ rating: 'again' })], 'concept-a');
    expect(result.state).toBe('sprout');
    expect(result.evidence.scoredSuccessCount).toBe(0);
    expect(result.evidence.successfulScoredDays).toBe(0);
    expect(result.evidence.tiersSucceeded?.recall).toBe(false);
  });

  it('missed answers on three days never reach sapling', () => {
    const misses = onConsecutiveDays('2026-01-01', 3, () => ({ rating: 'again' as Rating }));
    expect(computeConceptMastery(misses, 'concept-a').state).toBe('sprout');
  });
});

describe('rule 4 (ol-egov.141.89.9.66): blank, skipped and unassessable submissions do not establish practice', () => {
  it('an explanation nothing assessed stays seed and is not practice', () => {
    const ungraded = review({
      eventId: 'u1',
      instrumentId: 'explain-back:concept-a',
      instrumentType: 'explain-back',
      rating: null,
    });
    const result = computeConceptMastery([ungraded], 'concept-a');
    expect(result.state).toBe('seed');
    expect(result.evidence.tiersPracticed.explanation).toBe(false);
  });

  it('a scored record with no rating has no reading and establishes nothing', () => {
    const result = computeConceptMastery([review({ rating: null })], 'concept-a');
    expect(result.state).toBe('seed');
    expect(result.evidence.scoredEventCount).toBe(0);
    expect(result.evidence.tiersPracticed.recall).toBe(false);
  });

  it('a skip is a non-attempt record, never a review: nothing moves', () => {
    const skip = {
      schemaVersion: 6,
      kind: 'non-attempt',
      eventId: 'n1',
      timestamp: '2026-01-10T09:00:00-04:00',
      conceptIds: ['concept-a'],
      trigger: 'on-demand',
    } as unknown as ReviewLogEntry;
    expect(computeConceptMastery([skip], 'concept-a').state).toBe('seed');
  });
});

describe('rule 5 (ol-egov.141.89.9.66): an operational failure is never read as hers', () => {
  it('an assessed explanation whose correctness check failed is practice, never a success and never a failure', () => {
    // Depth graded, verdict missing: the correctness check did not run.
    const checkFailed = gradedExplainBack('relational', {
      eventId: 'cf1',
      explainBackGrade: {
        soloLevel: 'relational',
        contentRef: 'content-ref-placeholder',
        revisionOf: null,
        artifactProvenance: PROVENANCE,
      },
    });
    const result = computeConceptMastery([checkFailed], 'concept-a');
    expect(result.state).toBe('sprout');
    expect(result.evidence.tiersSucceeded?.explanation).toBe(false);
    expect(result.evidence.topStageQualified).toBe(false);
  });
});

// Scenarios: features/F2-review.md, "F2.14 — Instruments are enumerated from her
// vault" — the `[D-419]` / `[D-423]` block, `@auto:core/mastery/rollup.spec`
// (`ol-egov.141.89.9.65`). One review scores exactly one concept: the subject the
// record carries, the first of its `conceptIds`; the rest of the list is context.
describe('[D-419] / [D-423] — a review credits only its recorded subject (ol-egov.141.89.9.65)', () => {
  // A note naming two topics: the review is recorded with her order, the
  // scored concept first. `masteryAtTime` names every concept on the record
  // (F2.11's per-concept belief), which is context, not credit.
  const twoTopics = ['concept-a', 'concept-b'];

  it('the first-listed concept reads the evidence; the co-listed concept reads none from that record', () => {
    const entries: ReviewLogEntry[] = [review({ eventId: 'r1', conceptIds: twoTopics })];

    const scored = computeConceptMastery(entries, 'concept-a');
    expect(scored.state).toBe('sprout');
    expect(scored.evidence.scoredEventCount).toBe(1);

    const context = computeConceptMastery(entries, 'concept-b');
    expect(context.state).toBe('seed');
    expect(context.evidence.scoredEventCount).toBe(0);
    expect(context.evidence.scoredSuccessCount).toBe(0);
    expect(context.evidence.tiersPracticed).toEqual({
      recognition: false,
      recall: false,
      explanation: false,
    });
  });

  it('spaced successes on a two-topic instrument lift the scored concept and leave the context concept a seed', () => {
    const entries = onConsecutiveDays('2026-01-01', MIN_SPACED_RETRIEVAL_DAYS, () => ({
      conceptIds: twoTopics,
      rating: 'good',
    }));
    const all = computeAllConceptMastery(entries, twoTopics);
    expect(all.get('concept-a')?.state).toBe('sapling');
    expect(all.get('concept-b')?.state).toBe('seed');
  });

  it('a graded explain-back on a two-concept record opens the depth gate for its subject only', () => {
    const entries: ReviewLogEntry[] = [
      ...onConsecutiveDays('2026-01-01', MIN_SPACED_RETRIEVAL_DAYS, () => ({
        conceptIds: twoTopics,
        rating: 'good',
      })),
      gradedExplainBack('relational', { conceptIds: twoTopics }),
    ];
    const scored = computeConceptMastery(entries, 'concept-a');
    const context = computeConceptMastery(entries, 'concept-b');
    expect(scored.state).toBe('tree');
    expect(scored.evidence.gradedExplainBackCount).toBe(1);
    expect(context.state).toBe('seed');
    expect(context.evidence.gradedExplainBackCount).toBe(0);
  });

  it('the index the fold and the attainment scans read holds a record under its subject only', () => {
    const entries: ReviewLogEntry[] = [review({ eventId: 'r1', conceptIds: twoTopics })];
    expect(reviewRecordsForConcept(entries, 'concept-a').map((r) => r.eventId)).toEqual(['r1']);
    expect(reviewRecordsForConcept(entries, 'concept-b')).toEqual([]);
  });

  it('the vitality axis lists the instrument under the scored concept only', () => {
    const scheduler = stubScheduler({ 'qa:concept-a:1': 0.9 });
    const entries: ReviewLogEntry[] = [review({ eventId: 'r1', conceptIds: twoTopics })];
    const replayed = replaySchedulerStates(entries, scheduler);
    expect(conceptVitalityInstruments(entries, 'concept-a', replayed)).toHaveLength(1);
    expect(conceptVitalityInstruments(entries, 'concept-b', replayed)).toEqual([]);
  });

  it('the belief stamped on a new record still names every concept the record names', () => {
    // Context concepts stay stamped (F2.11's per-concept belief the contract
    // requires to agree with `conceptIds`); only credit narrowed.
    const stamped = masteryAtTimeForConceptIds([], twoTopics);
    expect(Object.keys(stamped.attribution === 'per-concept' ? stamped.byConcept : {})).toEqual(
      twoTopics,
    );
  });

  it('reordering the topics later never reassigns evidence already on the log', () => {
    // Recorded while the note listed concept-a first: three spaced successes.
    const before = onConsecutiveDays('2026-01-01', MIN_SPACED_RETRIEVAL_DAYS, (_day, i) => ({
      eventId: `before-${i}`,
      conceptIds: ['concept-a', 'concept-b'],
      rating: 'good',
    }));
    // She then reorders the note's topics; the same instrument is reviewed once more.
    const after = review({
      eventId: 'after-0',
      timestamp: '2026-02-01T09:00:00-04:00',
      conceptIds: ['concept-b', 'concept-a'],
      rating: 'good',
    });
    const entries: ReviewLogEntry[] = [...before, after];

    const a = computeConceptMastery(entries, 'concept-a');
    const b = computeConceptMastery(entries, 'concept-b');

    // The earlier reviews keep the subject they carried...
    expect(a.evidence.scoredEventCount).toBe(MIN_SPACED_RETRIEVAL_DAYS);
    expect(a.state).toBe('sapling');
    // ...and only the later review credits the new first concept.
    expect(b.evidence.scoredEventCount).toBe(1);
    expect(b.state).toBe('sprout');
    expect(reviewRecordsForConcept(entries, 'concept-b').map((r) => r.eventId)).toEqual([
      'after-0',
    ]);
  });

  it('records from before the ruling read by the subject they carry, and none is rewritten', () => {
    // A record migrated from the one-id shape (a one-element list) and a
    // record written under the every-concept reading (`ol-t3sd`), side by side.
    const migrated = review({ eventId: 'old-one', conceptIds: ['concept-a'] });
    const everyConcept = review({
      eventId: 'old-many',
      timestamp: '2026-01-11T09:00:00-04:00',
      instrumentId: 'qa:concept-c:1',
      conceptIds: ['concept-c', 'concept-a', 'concept-b'],
    });
    const entries: ReviewLogEntry[] = [migrated, everyConcept];
    const snapshot = JSON.stringify(entries);

    expect(computeConceptMastery(entries, 'concept-a').evidence.scoredEventCount).toBe(1);
    expect(computeConceptMastery(entries, 'concept-c').evidence.scoredEventCount).toBe(1);
    expect(computeConceptMastery(entries, 'concept-b').evidence.scoredEventCount).toBe(0);
    expect(conceptIdsInLog(entries)).toEqual(['concept-a', 'concept-c']);
    // A pure reading: the log is exactly as it was handed in.
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});
