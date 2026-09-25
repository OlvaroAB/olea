// `ol-egov.141.89.9.4`: the stage fold's rule options (the attainment chain
// spec's sections 2.3 and 7 in `olea-service`; failure classes A5, A7, A12).
// `[D-346]` (what earns sapling) is OPEN, so its options are built behind a
// default that is today's rule; `[D-319]` (the restatement finding) is ruled.
// Ids are structural placeholders, never fixture vocabulary (INV-3).
import type {
  ReviewLogEntry,
  ReviewLogRecord,
  SoloLevel,
  SupportLevel,
  VerdictLogRecord,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { latestVerdictByInstrument } from '../review-log/verdicts.js';
import {
  computeConceptMastery,
  DEFAULT_SAPLING_RULE,
  foldConceptStage,
  type SaplingRule,
} from './rollup.js';

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'r-default',
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

function onDays(
  days: readonly string[],
  build: (index: number) => Partial<ReviewLogRecord>,
): ReviewLogEntry[] {
  return days.map((day, i) =>
    review({ eventId: `e-${day}-${i}`, timestamp: `${day}T09:00:00-04:00`, ...build(i) }),
  );
}

const THREE_DAYS = ['2026-01-10', '2026-01-12', '2026-01-15'] as const;

function explainBack(
  eventId: string,
  timestamp: string,
  overrides: {
    soloLevel?: SoloLevel;
    correctness?: 'correct' | 'partial' | 'incorrect';
    support?: SupportLevel | null;
    revisionOf?: string | null;
    instrumentId?: string;
  } = {},
): ReviewLogRecord {
  const support = overrides.support === undefined ? 'independent' : overrides.support;
  return review({
    eventId,
    timestamp,
    instrumentId: overrides.instrumentId ?? 'explain-back:concept-a',
    instrumentType: 'explain-back',
    rating: null,
    ...(support === null ? {} : { supportLevelShown: support }),
    explainBackGrade: {
      soloLevel: overrides.soloLevel ?? 'relational',
      ...(overrides.correctness === undefined
        ? { correctness: 'correct' as const }
        : { correctness: overrides.correctness }),
      contentRef: 'content-ref-placeholder',
      revisionOf: overrides.revisionOf ?? null,
      artifactProvenance: { taskId: 'explain-back-grade', promptVersion: 'v0', modelId: 'm' },
    },
  });
}

describe('[D-346] sapling rule — default is today’s rule (the ruling is open)', () => {
  it('the default is any scored success on three distinct days', () => {
    expect(DEFAULT_SAPLING_RULE).toBe('any-scored-success');
  });

  it('quiz answers alone on three days read sapling under the default, exactly as before', () => {
    const entries = onDays(THREE_DAYS, () => ({
      instrumentId: 'mcq:concept-a:1',
      instrumentType: 'mcq',
    }));
    expect(computeConceptMastery(entries, 'concept-a').state).toBe('sapling');
  });
});

describe('[D-346] each option, so a case can record the answer under each (A7)', () => {
  const at = (rule: SaplingRule, entries: readonly ReviewLogEntry[]) =>
    computeConceptMastery(entries, 'concept-a', { saplingRule: rule }).state;

  const quizOnly = onDays(THREE_DAYS, () => ({
    instrumentId: 'mcq:concept-a:1',
    instrumentType: 'mcq',
  }));
  const guidedRecall = onDays(THREE_DAYS, () => ({ supportLevelShown: 'guided' }));
  const promptedRecall = onDays(THREE_DAYS, () => ({ supportLevelShown: 'prompted' }));
  const independentRecall = onDays(THREE_DAYS, () => ({ supportLevelShown: 'independent' }));
  const unknownSupportRecall = onDays(THREE_DAYS, () => ({}));
  const recallOneDay = onDays(['2026-01-10', '2026-01-10', '2026-01-10'], () => ({
    supportLevelShown: 'independent',
  }));
  const mix = [
    ...onDays(['2026-01-10', '2026-01-12'], () => ({
      instrumentId: 'mcq:concept-a:1',
      instrumentType: 'mcq',
    })),
    ...onDays(['2026-01-15'], () => ({ supportLevelShown: 'independent' })),
  ];

  it('(b) unaided-recall: quiz answers and guided recall count toward sprout only', () => {
    expect(at('unaided-recall', quizOnly)).toBe('sprout');
    expect(at('unaided-recall', guidedRecall)).toBe('sprout');
  });

  it('(b) unaided-recall: independent or prompted recall on three days reads sapling', () => {
    expect(at('unaided-recall', promptedRecall)).toBe('sapling');
    expect(at('unaided-recall', independentRecall)).toBe('sapling');
  });

  it('(b) unaided-recall: unknown support never admits, the same discipline the top stage keeps', () => {
    expect(at('unaided-recall', unknownSupportRecall)).toBe('sprout');
  });

  it('(b) and (a): recall crammed into one day stays sprout', () => {
    expect(at('unaided-recall', recallOneDay)).toBe('sprout');
    expect(at('any-scored-success', recallOneDay)).toBe('sprout');
  });

  it('(c) mix-with-unaided-recall: any mix on three days with at least one independent recall success', () => {
    expect(at('mix-with-unaided-recall', mix)).toBe('sapling');
    expect(at('mix-with-unaided-recall', quizOnly)).toBe('sprout');
    expect(at('mix-with-unaided-recall', promptedRecall)).toBe('sprout');
    expect(at('any-scored-success', mix)).toBe('sapling');
    expect(at('unaided-recall', mix)).toBe('sprout');
  });

  it('a failed recall never counts toward any rule', () => {
    const failed = onDays(THREE_DAYS, () => ({
      supportLevelShown: 'independent',
      rating: 'again',
    }));
    for (const rule of [
      'any-scored-success',
      'unaided-recall',
      'mix-with-unaided-recall',
    ] as const) {
      expect(at(rule, failed)).toBe('sprout');
    }
  });

  it('the evidence carries each rule’s input', () => {
    const { evidence } = computeConceptMastery(mix, 'concept-a');
    expect(evidence.successfulScoredDays).toBe(3);
    expect(evidence.unaidedRecallSuccessDays).toBe(1);
    expect(evidence.independentRecallSuccess).toBe(true);
  });

  it('an unknown rule is a programmer error, loudly', () => {
    expect(() =>
      computeConceptMastery(mix, 'concept-a', { saplingRule: 'bogus' as SaplingRule }),
    ).toThrow(/saplingRule/);
  });
});

describe('[D-319] the restatement finding withholds the top stage only when the explanation is missing (A5)', () => {
  const attempt = explainBack('eb-1', '2026-01-10T09:00:00-04:00');

  it('a qualifying attempt with no finding reaches the top stage (resemblance is never read)', () => {
    expect(computeConceptMastery([attempt], 'concept-a').state).toBe('tree');
  });

  it('a finding that the requested explanation is missing withholds the top stage from that attempt', () => {
    const result = computeConceptMastery([attempt], 'concept-a', {
      explanationMissingEventIds: ['eb-1'],
    });
    expect(result.state).toBe('sprout');
    expect(result.evidence.topStageQualified).toBe(false);
    expect(result.evidence.withheldByRestatementFinding).toBe(1);
  });

  it('the finding is per attempt: another qualifying attempt without it still reaches the top stage', () => {
    const second = explainBack('eb-2', '2026-01-12T09:00:00-04:00');
    const result = computeConceptMastery([attempt, second], 'concept-a', {
      explanationMissingEventIds: ['eb-1'],
    });
    expect(result.state).toBe('tree');
    expect(result.evidence.topStageAttempt?.eventId).toBe('eb-2');
  });

  it('the finding never lowers anything below the top stage: the attempt still counts as graded evidence', () => {
    const recall = onDays(THREE_DAYS, () => ({ supportLevelShown: 'independent' }));
    const result = computeConceptMastery([...recall, attempt], 'concept-a', {
      explanationMissingEventIds: ['eb-1'],
    });
    expect(result.state).toBe('sapling');
    expect(result.evidence.gradedExplainBackCount).toBe(1);
  });
});

describe('the qualifying attempt is named (A6, A8 need it for the award)', () => {
  it('names the earliest qualifying attempt by instant, then event id, whatever the input order', () => {
    const late = explainBack('eb-late', '2026-01-20T09:00:00-04:00');
    const early = explainBack('eb-early', '2026-01-11T09:00:00-04:00');
    const shallow = explainBack('eb-shallow', '2026-01-05T09:00:00-04:00', {
      soloLevel: 'multistructural',
    });
    const result = computeConceptMastery([late, shallow, early], 'concept-a');
    expect(result.evidence.topStageAttempt).toEqual({
      eventId: 'eb-early',
      instrumentId: 'explain-back:concept-a',
      at: '2026-01-11T09:00:00-04:00',
    });
  });

  it('is null when no attempt qualifies', () => {
    const result = computeConceptMastery(
      [explainBack('eb-1', '2026-01-10T09:00:00-04:00', { correctness: 'incorrect' })],
      'concept-a',
    );
    expect(result.evidence.topStageAttempt).toBeNull();
  });
});

describe('foldConceptStage — the scoped fold the attainment entry point reads', () => {
  const recall = onDays(THREE_DAYS, (i) => ({
    instrumentId: i === 2 ? 'qa:concept-a:2' : 'qa:concept-a:1',
    supportLevelShown: 'independent',
  }));

  it('with no scope it is computeConceptMastery', () => {
    expect(foldConceptStage(recall, 'concept-a', {}, {}).state).toBe(
      computeConceptMastery(recall, 'concept-a').state,
    );
  });

  it('an excluded instrument is removed at EVERY stage, not only the top one', () => {
    const scoped = foldConceptStage(
      recall,
      'concept-a',
      {},
      { excludedInstrumentIds: new Set(['qa:concept-a:2']) },
    );
    expect(scoped.state).toBe('sprout');
    expect(scoped.evidence.successfulScoredDays).toBe(2);
  });

  it('as of an instant, later records are not yet evidence', () => {
    const asOf = Date.parse('2026-01-12T09:00:00-04:00');
    const scoped = foldConceptStage(recall, 'concept-a', {}, { asOf });
    expect(scoped.evidence.successfulScoredDays).toBe(2);
    expect(scoped.state).toBe('sprout');
  });

  it('as of an instant, a re-grade logged later does not yet supersede', () => {
    const graded = explainBack('eb-1', '2026-01-10T09:00:00-04:00');
    const regrade = explainBack('eb-2', '2026-01-12T09:00:00-04:00', {
      revisionOf: 'eb-1',
      correctness: 'incorrect',
    });
    const entries = [graded, regrade];
    expect(foldConceptStage(entries, 'concept-a', {}, {}).state).toBe('sprout');
    expect(
      foldConceptStage(entries, 'concept-a', {}, { asOf: Date.parse('2026-01-11T09:00:00Z') })
        .state,
    ).toBe('tree');
  });

  it('supersession can be ignored, for the "did anything ever reach higher" check', () => {
    const graded = explainBack('eb-1', '2026-01-10T09:00:00-04:00');
    const regrade = explainBack('eb-2', '2026-01-12T09:00:00-04:00', {
      revisionOf: 'eb-1',
      correctness: 'incorrect',
    });
    expect(
      foldConceptStage([graded, regrade], 'concept-a', {}, { supersession: 'ignored' }).state,
    ).toBe('tree');
  });
});

// -----------------------------------------------------------------------------
// Knowledge model §8 test 6 / `[D-097]` — rejecting an item as defective
// excludes its evidence at read time (features/F2-review.md, "Feature:
// Knowledge model §8 test 6 / [D-097] — Rejecting an item as defective
// excludes at read time", tagged `@auto:core/mastery/rollup.spec`).
//
// The existing "@auto:MAT-C5-instrument-validity" test above (this file's
// sibling `rollup.spec.ts`) proves only that a rejected instrument's TOP
// stage is withheld (`invalidInstrumentIds`, "as today"); it does not prove
// "no reading anywhere moves on those reviews" — the scenario's own words.
// These tests close that: `../review-log/verdicts.ts`'s own
// `latestVerdictByInstrument` (a rejected verdict, exactly as it is
// produced end to end) feeds `foldConceptStage`'s `excludedInstrumentIds`
// scope, and the rejected item's reviews are shown to move NO reading —
// not the stage, not the underlying evidence counts either — whatever the
// timing of the rejection.
// -----------------------------------------------------------------------------

function verdict(
  instrumentId: string,
  value: VerdictLogRecord['verdict'],
  timestamp: string,
  eventId: string,
): VerdictLogRecord {
  return {
    schemaVersion: 5,
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

/** Rejected instruments per `../review-log/verdicts.ts`, ready for `StageFoldScope.excludedInstrumentIds`. */
function rejectedInstrumentIds(entries: readonly ReviewLogEntry[]): ReadonlySet<string> {
  const rejected = new Set<string>();
  for (const [instrumentId, record] of latestVerdictByInstrument(entries)) {
    if (record.verdict === 'rejected') rejected.add(instrumentId);
  }
  return rejected;
}

describe('Knowledge model §8 test 6 / `[D-097]` — a rejected item’s reviews move no scoring reading', () => {
  it('a rejected instrument’s reviews move no reading — not the stage, and not the evidence counts behind it', () => {
    const goodInstrument = onDays(THREE_DAYS, () => ({
      instrumentId: 'qa:concept-a:1',
      supportLevelShown: 'independent',
    }));
    const rejectedInstrument = onDays(['2026-01-11'], () => ({
      instrumentId: 'qa:concept-a:2',
      supportLevelShown: 'independent',
    }));
    const entries = [
      ...goodInstrument,
      ...rejectedInstrument,
      verdict('qa:concept-a:2', 'rejected', '2026-01-20T09:00:00-04:00', 'v1'),
    ];

    // With no exclusion, all four reviews (three good, one on the
    // to-be-rejected instrument) are scoring evidence.
    const unscoped = foldConceptStage(entries, 'concept-a', {}, {});
    expect(unscoped.evidence.scoredEventCount).toBe(4);

    const excluded = rejectedInstrumentIds(entries);
    expect([...excluded]).toEqual(['qa:concept-a:2']);
    const scoped = foldConceptStage(entries, 'concept-a', {}, { excludedInstrumentIds: excluded });

    // The rejected instrument's single review is gone from the evidence
    // entirely — not merely disqualified from the top stage. Only the three
    // good-instrument reviews remain.
    expect(scoped.evidence.scoredEventCount).toBe(3);
    expect(scoped.evidence.successfulScoredDays).toBe(3);
    expect(scoped.state).toBe('sapling');

    // The verdict event itself never becomes scoring evidence either — it
    // carries no rating and is a different `kind` than `review`.
    expect(scoped.evidence.scoredEventCount).toBe(
      foldConceptStage(goodInstrument, 'concept-a', {}, {}).evidence.scoredEventCount,
    );
  });

  it('rejection at any later time works exactly as rejection at first use does — same mechanism, same result', () => {
    // Item A: rejected before its first review is ever folded in (first
    // use). Item B: rejected a month and many reviews after its first use.
    const firstUseId = 'qa:concept-a:first-use';
    const laterId = 'qa:concept-a:later';

    const firstUseEntries = [
      ...onDays(['2026-01-10'], () => ({
        instrumentId: firstUseId,
        supportLevelShown: 'independent',
      })),
      verdict(firstUseId, 'rejected', '2026-01-10T09:05:00-04:00', 'v-first'),
    ];
    const laterEntries = [
      ...onDays(THREE_DAYS, () => ({ instrumentId: laterId, supportLevelShown: 'independent' })),
      verdict(laterId, 'rejected', '2026-02-15T09:00:00-04:00', 'v-later'),
    ];

    for (const entries of [firstUseEntries, laterEntries]) {
      const excluded = rejectedInstrumentIds(entries);
      const scoped = foldConceptStage(
        entries,
        'concept-a',
        {},
        { excludedInstrumentIds: excluded },
      );
      // Whatever reviews the rejected instrument produced, none of them
      // move the fold — the same "seed, no evidence at all" result either
      // way, whether the rejection followed one review or several.
      expect(scoped.evidence.scoredEventCount).toBe(0);
      expect(scoped.state).toBe('seed');
    }
  });
});
