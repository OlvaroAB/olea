// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4a / [D-176] —
// The offer-to-create-a-note gate", tagged `@auto:core/concept/note-offer.spec`.
// That scenario text was drafted by this lane and handed back for the F8-file
// owner to place (another lane owns that file today) — see this task's report.
//
// Concept, course and instrument identifiers below are structural
// placeholders ("concept-a", "CRS101", "qa:concept-a:1"), never fixture
// vocabulary — INV-3.

import { describe, expect, it } from 'vitest';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import type { ConceptPriority, CourseOracleRanking } from '../oracle/types.js';
import type { VaultInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import { noteOfferEligible } from './note-offer.js';

const CONCEPT_KEY = 'concept-a';
const COURSE = 'CRS101';
const ASSESSMENT_PATH = '02 Assessments/final.md' as VaultPath;

function instrument(): VaultInstrumentRecord {
  return {
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    conceptIds: [CONCEPT_KEY],
    courses: [COURSE],
    notePath: '01 Courses/CRS101/note.md' as VaultPath,
    noteTitle: 'note',
    noteUid: null,
    blockId: 'abc123',
    heading: null,
    ordinal: 1,
    card: {
      raw: 'Q: x\nA: y',
      span: { start: 0, end: 10 },
      blockId: 'abc123',
      foreignScheduling: null,
      type: 'qa',
      style: 'single-line',
      front: 'x',
      back: 'y',
      reversed: false,
    },
  } as VaultInstrumentRecord;
}

function mastery(scoredEventCount: number): ConceptMasteryResult {
  return {
    conceptId: CONCEPT_KEY,
    state: scoredEventCount > 0 ? 'sprout' : 'seed',
    evidence: {
      scoredEventCount,
      scoredSuccessCount: scoredEventCount,
      explainBackAttempts: 0,
      tiersPracticed: { recognition: false, recall: scoredEventCount > 0, explanation: false },
      gradedExplainBackCount: 0,
      recognitionOnly: false,
      successfulScoredDays: scoredEventCount > 0 ? 1 : 0,
      deepestSoloLevel: null,
      depthGateCleared: false,
    },
  };
}

/** A minimal, valid `ConceptPriority` — every field beyond `conceptKey`/`rank` is filler this suite never inspects. */
function rankedEntry(conceptKey: string, rank: number): ConceptPriority {
  return {
    conceptName: conceptKey,
    conceptKey,
    course: COURSE,
    rank,
    priorityScore: 1 / rank,
    factors: {
      citations: [],
      distinctSourceCount: 0,
      contributions: [],
      preMasteryScore: 1 / rank,
      masteryState: 'sprout',
      masteryNeedWeight: 1,
      priorityScore: 1 / rank,
    },
    citations: [],
    reasoning: `Ranked ${rank}.`,
  };
}

/** Six-entry course ranking — `TOP_BAND_DIVISOR = 3` puts ranks 1-2 in the top band, 3-6 outside it. */
function sixWayRanking(entries: readonly ConceptPriority[]): CourseOracleRanking {
  return { course: COURSE, status: 'ranked', ranked: entries };
}

const FULL_RANKING = sixWayRanking([
  rankedEntry(CONCEPT_KEY, 1), // top band
  rankedEntry('concept-b', 2),
  rankedEntry('concept-c', 3),
  rankedEntry('concept-d', 4),
  rankedEntry('concept-e', 5),
  rankedEntry('concept-f', 6),
]);

const BELOW_BAND_RANKING = sixWayRanking([
  rankedEntry('concept-b', 1),
  rankedEntry('concept-c', 2),
  rankedEntry(CONCEPT_KEY, 3), // outside the top two of six
  rankedEntry('concept-d', 4),
  rankedEntry('concept-e', 5),
  rankedEntry('concept-f', 6),
]);

const ABSENT_FROM_RANKING = sixWayRanking([
  rankedEntry('concept-b', 1),
  rankedEntry('concept-c', 2),
]);

const ABSTAINED_RANKING: CourseOracleRanking = {
  course: COURSE,
  status: 'abstained',
  reason: 'no-evidence',
  detail: 'No assessment named any evidence for this course.',
  assessmentPaths: [ASSESSMENT_PATH],
};

describe('noteOfferEligible — the [D-176] three-way gate', () => {
  // The eight truth-table cases over (accepted instruments, reviewed at
  // least once, top band). `eligible` is true in exactly one of them — "All
  // three", per the ratified clause.

  it('T T T — accepted instruments, reviewed, top band: eligible', () => {
    const verdict = noteOfferEligible(
      { conceptKey: CONCEPT_KEY },
      { instruments: [instrument()], mastery: mastery(3), ranking: FULL_RANKING },
    );
    expect(verdict).toEqual({
      eligible: true,
      hasAcceptedInstruments: true,
      hasBeenReviewed: true,
      inTopBand: true,
    });
  });

  it('T T F — accepted instruments, reviewed, but below the top band: not eligible', () => {
    const verdict = noteOfferEligible(
      { conceptKey: CONCEPT_KEY },
      { instruments: [instrument()], mastery: mastery(3), ranking: BELOW_BAND_RANKING },
    );
    expect(verdict).toEqual({
      eligible: false,
      hasAcceptedInstruments: true,
      hasBeenReviewed: true,
      inTopBand: false,
    });
  });

  it('T F T — accepted instruments, top band, but no mastery entry at all: not eligible', () => {
    const verdict = noteOfferEligible(
      { conceptKey: CONCEPT_KEY },
      { instruments: [instrument()], mastery: undefined, ranking: FULL_RANKING },
    );
    expect(verdict).toEqual({
      eligible: false,
      hasAcceptedInstruments: true,
      hasBeenReviewed: false,
      inTopBand: true,
    });
  });

  it('T F F — accepted instruments only, zero scored reviews, absent from the ranking: not eligible', () => {
    const verdict = noteOfferEligible(
      { conceptKey: CONCEPT_KEY },
      { instruments: [instrument()], mastery: mastery(0), ranking: ABSENT_FROM_RANKING },
    );
    expect(verdict).toEqual({
      eligible: false,
      hasAcceptedInstruments: true,
      hasBeenReviewed: false,
      inTopBand: false,
    });
  });

  it('F T T — no accepted instruments, reviewed, top band: not eligible', () => {
    const verdict = noteOfferEligible(
      { conceptKey: CONCEPT_KEY },
      { instruments: [], mastery: mastery(3), ranking: FULL_RANKING },
    );
    expect(verdict).toEqual({
      eligible: false,
      hasAcceptedInstruments: false,
      hasBeenReviewed: true,
      inTopBand: true,
    });
  });

  it('F T F — no accepted instruments, reviewed, course abstained (no ranking to sit in): not eligible', () => {
    const verdict = noteOfferEligible(
      { conceptKey: CONCEPT_KEY },
      { instruments: [], mastery: mastery(3), ranking: ABSTAINED_RANKING },
    );
    expect(verdict).toEqual({
      eligible: false,
      hasAcceptedInstruments: false,
      hasBeenReviewed: true,
      inTopBand: false,
    });
  });

  it('F F T — no accepted instruments, never reviewed, top band: not eligible', () => {
    const verdict = noteOfferEligible(
      { conceptKey: CONCEPT_KEY },
      { instruments: [], mastery: undefined, ranking: FULL_RANKING },
    );
    expect(verdict).toEqual({
      eligible: false,
      hasAcceptedInstruments: false,
      hasBeenReviewed: false,
      inTopBand: true,
    });
  });

  it('F F F — none of the three: not eligible', () => {
    const verdict = noteOfferEligible(
      { conceptKey: CONCEPT_KEY },
      { instruments: [], mastery: undefined, ranking: BELOW_BAND_RANKING },
    );
    expect(verdict).toEqual({
      eligible: false,
      hasAcceptedInstruments: false,
      hasBeenReviewed: false,
      inTopBand: false,
    });
  });

  it('a pruned instrument still counts as "accepted" — pruning is a queue-visibility flag, not an un-accept', () => {
    const verdict = noteOfferEligible(
      { conceptKey: CONCEPT_KEY },
      {
        instruments: [{ ...instrument() } as VaultInstrumentRecord],
        mastery: mastery(3),
        ranking: FULL_RANKING,
      },
    );
    expect(verdict.hasAcceptedInstruments).toBe(true);
  });

  it('explain-back attempts alone do not satisfy "reviewed at least once" — only a scored event does', () => {
    const evidence = mastery(0);
    const explainBackOnly: ConceptMasteryResult = {
      ...evidence,
      evidence: { ...evidence.evidence, explainBackAttempts: 4 },
    };
    const verdict = noteOfferEligible(
      { conceptKey: CONCEPT_KEY },
      { instruments: [instrument()], mastery: explainBackOnly, ranking: FULL_RANKING },
    );
    expect(verdict.hasBeenReviewed).toBe(false);
  });
});
