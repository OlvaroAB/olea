// `ol-v7r5.65`: `[D-349]` RULED 2026-09-25, accepted with a narrower claim —
// "one qualifying success can provisionally demonstrate that particular
// demand." David's four follow-up criteria, as they bear on THIS module's
// own consumer of a demand-shaped reading (`readinessFactorsFor`'s
// `currentRecognition` input; the full declared-demand vocabulary match
// itself is `../gap/demand.ts`'s and `./build.ts`'s `unmetDemands` gate, read
// only here, never re-implemented):
//
//   (1) define "current" precisely — exercised via the real production path
//       (`../mastery/attainment.ts`'s `readAllCurrentRecognition`), not a
//       hand-set boolean, so the definition this suite pins is the one that
//       actually ships;
//   (2) a subsequent failure on the same instrument withdraws the provisional
//       reading immediately, never leaving a stale credit in place;
//   (3) confidence is expressed as a plain binary gate feeding one fixed
//       discount — never a graded value — which is this module's whole
//       answer to "if it is shown at all";
//   (5) missing qualifying evidence reads as unknown (`weight === 1`, the
//       oracle's own neutral order), never as inability (`weight < 1`).
//
// Criterion (4) (evidence of a different demand, an assisted or recognition
// success mislabelled, a transfer demand on recall-a-fact evidence alone) is
// `../gap/demand.ts`'s contract, already tested there and in
// `./need-row.spec.ts`'s unmet-demand gate; not restated here. Ids are
// structural placeholders, never fixture vocabulary (INV-3).
import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { readAllCurrentRecognition } from '../mastery/attainment.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import { projectInstrumentValidity } from '../mastery/validity.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import { DEFAULT_MCQ_RECOGNITION_WEIGHT, readinessFactorsFor } from './readiness.js';

const DAY = 24 * 60 * 60 * 1000;
const T1 = '2026-01-10T09:00:00-04:00';
const T2 = '2026-01-12T09:00:00-04:00';
const scheduler = createFsrsScheduler();

function quiz(
  eventId: string,
  timestamp: string,
  rating: ReviewLogRecord['rating'],
): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId: 'mcq:a:1',
    instrumentType: 'mcq',
    conceptIds: ['concept-a'],
    rating,
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['mcq'],
      planVersion: null,
    },
  };
}

function currentRecognitionOf(entries: readonly ReviewLogEntry[], now: Date): boolean {
  return (
    readAllCurrentRecognition(
      entries,
      ['concept-a'],
      scheduler,
      now,
      projectInstrumentValidity(entries),
    ).get('concept-a') ?? false
  );
}

function masteryWithPastRecognition(): ConceptMasteryResult {
  return {
    conceptId: 'concept-a',
    state: 'sprout',
    evidence: {
      scoredEventCount: 2,
      scoredSuccessCount: 1,
      explainBackAttempts: 0,
      tiersPracticed: { recognition: true, recall: false, explanation: false },
      tiersSucceeded: { recognition: true, recall: false, explanation: false },
      gradedExplainBackCount: 0,
      recognitionOnly: true,
      successfulScoredDays: 1,
      deepestSoloLevel: null,
      depthGateCleared: false,
      topStageQualified: false,
    },
  };
}

describe('[D-349] ruled: what "current" means for this credit, end to end', () => {
  const soon = new Date(Date.parse(T1) + 1 * DAY);

  it('a correct answer not yet due again is current, and earns the credit', () => {
    const current = currentRecognitionOf([quiz('m1', T1, 'good')], soon);
    expect(current).toBe(true);
    const factors = readinessFactorsFor(masteryWithPastRecognition(), 'recall-style', {}, current);
    expect(factors.applied).toBe(true);
    expect(factors.weight).toBe(DEFAULT_MCQ_RECOGNITION_WEIGHT);
  });
});

describe('[D-349] ruled: a subsequent failure withdraws the provisional reading (criterion 2)', () => {
  const soon = new Date(Date.parse(T1) + 1 * DAY);

  it('a later failed answer on the same instrument turns the credit off immediately, even though an earlier answer succeeded', () => {
    const entries = [quiz('m1', T1, 'good'), quiz('m2', T2, 'again')];
    const current = currentRecognitionOf(entries, soon);
    expect(current).toBe(false);

    const factors = readinessFactorsFor(masteryWithPastRecognition(), 'recall-style', {}, current);
    // The withdrawal is not a measured penalty: it drops to the neutral
    // weight (1), the same "nothing decided" state as no evidence at all —
    // never a value below 1, which would read as demonstrated inability
    // rather than "not provisionally demonstrated right now" (criterion 5).
    expect(factors.applied).toBe(false);
    expect(factors.weight).toBe(1);
    expect(factors.recognitionEvidence).toBe(false);
  });
});

describe('[D-349] ruled: missing qualifying evidence reads unknown, never inability (criterion 5)', () => {
  it('no mastery entry and no currentRecognition input: neutral weight, not a discount', () => {
    const factors = readinessFactorsFor(undefined, 'recall-style');
    expect(factors.weight).toBe(1);
    expect(factors.applied).toBe(false);
  });

  it('a mastery entry with no recognition evidence at all: still neutral, never below 1', () => {
    const noEvidence: ConceptMasteryResult = {
      conceptId: 'concept-a',
      state: 'seed',
      evidence: {
        scoredEventCount: 0,
        scoredSuccessCount: 0,
        explainBackAttempts: 0,
        tiersPracticed: { recognition: false, recall: false, explanation: false },
        tiersSucceeded: { recognition: false, recall: false, explanation: false },
        gradedExplainBackCount: 0,
        recognitionOnly: false,
        successfulScoredDays: 0,
        deepestSoloLevel: null,
        depthGateCleared: false,
        topStageQualified: false,
      },
    };
    const factors = readinessFactorsFor(noEvidence, 'recall-style');
    expect(factors.weight).toBe(1);
    expect(factors.applied).toBe(false);
  });

  it('an explicit currentRecognition=false with no other evidence stays unknown, not inability', () => {
    const factors = readinessFactorsFor(undefined, 'recall-style', {}, false);
    expect(factors.weight).toBeGreaterThanOrEqual(1);
    expect(factors.weight).toBe(1);
  });
});

describe('[D-349] ruled: confidence is expressed only as a binary gate on one fixed discount (criterion 3)', () => {
  it('weight never takes any value other than 1 or the ratified baseline, across every combination', () => {
    const withEvidence = masteryWithPastRecognition();
    const possibleWeights = new Set<number>();
    for (const format of ['recall-style', 'written', 'practical', 'unknown'] as const) {
      for (const mastery of [undefined, withEvidence]) {
        for (const current of [undefined, true, false]) {
          possibleWeights.add(readinessFactorsFor(mastery, format, {}, current).weight);
        }
      }
    }
    expect([...possibleWeights].sort()).toEqual([DEFAULT_MCQ_RECOGNITION_WEIGHT, 1].sort());
  });

  it('the reading carries no separate confidence field — the gate and the fixed weight are the whole answer', () => {
    const factors = readinessFactorsFor(masteryWithPastRecognition(), 'recall-style', {}, true);
    expect(Object.keys(factors).sort()).toEqual(
      ['applied', 'assessmentFormat', 'recognitionEvidence', 'recognitionOnly', 'weight'].sort(),
    );
  });
});
