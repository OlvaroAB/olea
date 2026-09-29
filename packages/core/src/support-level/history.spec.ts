// `ol-egov.141.89.9.4`: the support ladder's history as a core fold over
// clustered sessions (the attainment chain spec's section 2.6 in
// `olea-service`; failure classes L1, L3, L4, L5, L6, L8). Ids are structural
// placeholders, never fixture vocabulary (INV-3).
import type {
  DisputeLogRecord,
  ReviewLogEntry,
  ReviewLogRecord,
  SuspendLogRecord,
  VerdictLogRecord,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { projectInstrumentValidity } from '../mastery/validity.js';
import { SESSION_CLUSTERING_GAP_SECONDS } from '../session/cluster.js';
import { chooseSupportLevel } from '../study-session/support-level-chooser.js';
import { buildSupportLevelHistory, NO_LADDER_SUPPORT_LEVEL } from './history.js';

const MIN = 60 * 1000;
const BASE = Date.parse('2026-02-01T09:00:00.000Z');

function at(minutes: number): string {
  return new Date(BASE + minutes * MIN).toISOString();
}

let counter = 0;
function review(minutes: number, overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  counter += 1;
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: `r-${String(counter).padStart(4, '0')}`,
    timestamp: at(minutes),
    instrumentId: 'qa:a:1',
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
    supportLevelShown: 'prompted',
    // `[D-350]`: a review written today records an explicit true or false. Tests that mean a
    // record older than the field, or a surface that did not observe it, drop the key with
    // `withoutHintField`; nothing else in this file is about hint state.
    hintOpened: false,
    ...overrides,
  };
}

/** A record with no hint-opened value at all: the legacy shape, and any surface that did not observe it. */
function withoutHintField(record: ReviewLogRecord): ReviewLogRecord {
  const { hintOpened: _absent, ...rest } = record;
  return rest;
}

function explainBack(
  minutes: number,
  correctness: 'correct' | 'partial' | 'incorrect' | undefined,
  soloLevel: 'multistructural' | 'relational' = 'relational',
): ReviewLogRecord {
  return review(minutes, {
    instrumentId: 'eb:a',
    instrumentType: 'explain-back',
    rating: null,
    explainBackGrade: {
      soloLevel,
      ...(correctness === undefined ? {} : { correctness }),
      contentRef: 'content-ref-placeholder',
      revisionOf: null,
      artifactProvenance: { taskId: 'explain-back-grade', promptVersion: 'v0', modelId: 'm' },
    },
  });
}

/** Minutes between sessions: comfortably more than the declared clustering gap. */
const APART = SESSION_CLUSTERING_GAP_SECONDS / 60 + 60;

describe('one outcome per SESSION, never per review (L5, [D-094], C5.4)', () => {
  it('two clean answers minutes apart are one clean session: support does not recede yet', () => {
    const history = buildSupportLevelHistory([review(0), review(5)]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: false },
    ]);
    expect(chooseSupportLevel(history.outcomesFor('concept-a', 'recall')).level).toBe('prompted');
  });

  it('two clean sessions apart recede support (L4)', () => {
    const history = buildSupportLevelHistory([review(0), review(APART)]);
    expect(history.outcomesFor('concept-a', 'recall')).toHaveLength(2);
    expect(chooseSupportLevel(history.outcomesFor('concept-a', 'recall')).level).toBe(
      'independent',
    );
  });

  it('a clean answer beside a miss in one sitting is one failing session', () => {
    const history = buildSupportLevelHistory([review(0), review(3, { rating: 'again' })]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
  });

  it('shuffled input gives the same history', () => {
    const entries = [review(0), review(3, { rating: 'again' }), review(APART), review(APART + 2)];
    const a = buildSupportLevelHistory(entries).outcomesFor('concept-a', 'recall');
    const b = buildSupportLevelHistory([...entries].reverse()).outcomesFor('concept-a', 'recall');
    expect(b).toEqual(a);
  });
});

describe('tiers are separate ladders; explanations read correctness first (L8, [D-286], [D-281])', () => {
  it('a clean recall answer never papers over a failing explanation in the same sitting', () => {
    const history = buildSupportLevelHistory([review(0), explainBack(4, 'incorrect')]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: false },
    ]);
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
  });

  it('a relational but incorrect explanation is a failure, never clean', () => {
    const history = buildSupportLevelHistory([explainBack(0, 'incorrect', 'relational')]);
    expect(history.outcomesFor('concept-a', 'explanation')[0]?.failureShape).toBe('wrong-concept');
  });

  it('unknown correctness never reads as a clean pass — nor as a slip of hers (ruling 2026-09-28)', () => {
    const history = buildSupportLevelHistory([explainBack(0, undefined, 'relational')]);
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([]);
  });

  it('a correct, relational explanation is clean', () => {
    const history = buildSupportLevelHistory([explainBack(0, 'correct', 'relational')]);
    expect(history.outcomesFor('concept-a', 'explanation')[0]?.failureShape).toBe('none');
  });
});

/** An explain-back carrying only the independent verdict, no depth grade (`[D-303]` top level). */
function correctnessOnly(
  minutes: number,
  verdict: 'correct' | 'partial' | 'incorrect',
): ReviewLogRecord {
  return review(minutes, {
    instrumentId: 'eb:a',
    instrumentType: 'explain-back',
    rating: null,
    explainBackCorrectness: {
      verdict,
      artifactProvenance: { taskId: 'explain-back-correctness', promptVersion: 'v0', modelId: 'm' },
    },
  });
}

describe('a verdict with no depth grade counts where correctness alone counts (ol-ryrh, [D-094], F2.20)', () => {
  it('an incorrect verdict with no depth pass is a wrong-concept session and escalates the explanation ladder', () => {
    const history = buildSupportLevelHistory([correctnessOnly(0, 'incorrect')]);
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
    expect(chooseSupportLevel(history.outcomesFor('concept-a', 'explanation')).level).toBe(
      'guided',
    );
  });

  it('after support has receded, an incorrect correctness-only explanation brings it back', () => {
    const history = buildSupportLevelHistory([
      explainBack(0, 'correct', 'relational'),
      explainBack(APART, 'correct', 'relational'),
      correctnessOnly(2 * APART, 'incorrect'),
    ]);
    const outcomes = history.outcomesFor('concept-a', 'explanation');
    expect(chooseSupportLevel(outcomes.slice(0, 2)).level).toBe('independent');
    expect(chooseSupportLevel(outcomes).level).not.toBe('independent');
  });

  it('it fails the sitting it sits in, beside a clean depth-graded explanation', () => {
    const history = buildSupportLevelHistory([
      explainBack(0, 'correct', 'relational'),
      correctnessOnly(4, 'incorrect'),
    ]);
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
  });

  it.each(['correct', 'partial'] as const)(
    'a %s verdict with no depth grade is skipped: fading needs depth evidence (F2.20)',
    (verdict) => {
      const history = buildSupportLevelHistory([
        correctnessOnly(0, verdict),
        correctnessOnly(APART, verdict),
      ]);
      expect(history.outcomesFor('concept-a', 'explanation')).toEqual([]);
      expect(chooseSupportLevel(history.outcomesFor('concept-a', 'explanation')).level).toBe(
        'prompted',
      );
    },
  );
});

describe('what has no ladder, or no honest reading, is skipped (L6)', () => {
  it('a quiz item has no ladder', () => {
    const history = buildSupportLevelHistory([
      review(0, { instrumentId: 'mcq:a:1', instrumentType: 'mcq' }),
    ]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([]);
    expect(chooseSupportLevel(history.outcomesFor('concept-a', 'recall')).level).toBe('prompted');
  });

  it('a recall review with no rating, and an ungraded explain-back, are skipped', () => {
    const ungraded = review(1, {
      instrumentId: 'eb:a',
      instrumentType: 'explain-back',
      rating: null,
    });
    const history = buildSupportLevelHistory([review(0, { rating: null }), ungraded]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([]);
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([]);
  });

  // `ol-egov.141.89.9.73` (`[D-419]`, `[D-423]`): a review is a session outcome for the one concept
  // it scored — the first id of its own list — and for no concept it merely names as context.
  it('a record naming several concepts is an outcome for its scored concept only', () => {
    const history = buildSupportLevelHistory([
      review(0, { conceptIds: ['concept-a', 'concept-b'], rating: 'again' }),
    ]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
    expect(history.outcomesFor('concept-b', 'recall')).toEqual([]);
  });

  it('a record written with another concept first credits that one, whatever the note lists today', () => {
    const history = buildSupportLevelHistory([
      review(0, { conceptIds: ['concept-b', 'concept-a'], rating: 'again' }),
    ]);
    expect(history.outcomesFor('concept-b', 'recall')).toHaveLength(1);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([]);
  });

  it('an explanation of a two-concept record is read at its scored concept only', () => {
    const history = buildSupportLevelHistory([
      review(0, {
        instrumentId: 'eb:a',
        instrumentType: 'explain-back',
        rating: null,
        conceptIds: ['concept-a', 'concept-b'],
        explainBackCorrectness: {
          verdict: 'incorrect',
          artifactProvenance: { taskId: 't', promptVersion: 'v0', modelId: 'm' },
        },
      }),
    ]);
    expect(history.outcomesFor('concept-a', 'explanation')).toHaveLength(1);
    expect(history.outcomesFor('concept-b', 'explanation')).toEqual([]);
  });
});

describe("the recognition tier's level is the ruled sentinel, never a ladder cold start ([D-094] item 4)", () => {
  it("is the attainment case set's S5 a4 target: 'none'", () => {
    expect(NO_LADDER_SUPPORT_LEVEL).toBe('none');
  });

  it("is never the recall tier's cold-start answer, even from an mcq-only log", () => {
    const history = buildSupportLevelHistory([
      review(0, { instrumentId: 'mcq:a:1', instrumentType: 'mcq' }),
    ]);
    // An mcq review leaves the recall cell cold, so its chosen level is the
    // recall/explanation ladder's cold start ('prompted', L6) — a caller
    // that mistakenly ran the recognition tier through this same path would
    // read that value, not the ruled recognition answer.
    const recallCellLevel = chooseSupportLevel(history.outcomesFor('concept-a', 'recall')).level;
    expect(recallCellLevel).toBe('prompted');
    expect(recallCellLevel).not.toBe(NO_LADDER_SUPPORT_LEVEL);
  });
});

// `[D-350]` (ol-egov.141.89.9.13, ruled 2026-09-25; built in ol-egov.141.89.9.83). The ruling's
// operative sentences: "Change the legacy default. Add the hint-opened field, but treat a missing
// value as unknown." and, as its clarification, "Absence of a record cannot establish unaided
// performance. Preserve historical awards unless there is evidence warranting correction; record
// explicit true or false for new reviews." The contract's field doc adds that an absent value is
// "never `false` and never inferred from `supportLevelShown`, which records that a hint was
// *offered*, not taken". Locked targets: eval/data/ilb/att, classes L1 and L2, matching-rule
// section 6 (judgement J5: an answer shown at independent support has no hint to open).
describe('hint state is three-valued: opened, not opened, unknown ([D-350], L1, L2)', () => {
  it('"add the hint-opened field": an opened hint on a prompted recall success reads as taken', () => {
    const history = buildSupportLevelHistory([review(0, { hintOpened: true })]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: true },
    ]);
  });

  it('"record explicit true or false": a recorded not-opened reads as not taken', () => {
    const history = buildSupportLevelHistory([review(0, { hintOpened: false })]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: false },
    ]);
  });

  it('"treat a missing value as unknown": an absent value on a prompted answer is neither true nor false', () => {
    const history = buildSupportLevelHistory([withoutHintField(review(0))]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'none', hintUptake: 'unknown' },
    ]);
  });

  it('an absent value on a guided answer is unknown as well', () => {
    const history = buildSupportLevelHistory([
      withoutHintField(review(0, { supportLevelShown: 'guided' })),
    ]);
    expect(history.outcomesFor('concept-a', 'recall')[0]?.hintUptake).toBe('unknown');
  });

  it('an absent value on a record with no support level either is unknown, never inferred', () => {
    const { supportLevelShown: _shown, ...noLevel } = withoutHintField(review(0));
    const history = buildSupportLevelHistory([noLevel]);
    expect(history.outcomesFor('concept-a', 'recall')[0]?.hintUptake).toBe('unknown');
  });

  // J5 (locked v2 targets, matching-rule section 6): independent support is no hints, so the
  // present support record shows the answer unhinted; nothing is inferred from a missing field.
  it('an answer shown at independent support has no hint to open: absent reads not opened (J5)', () => {
    const history = buildSupportLevelHistory([
      withoutHintField(review(0, { supportLevelShown: 'independent' })),
    ]);
    expect(history.outcomesFor('concept-a', 'recall')[0]?.hintUptake).toBe(false);
  });

  it('an explicit value always wins, even against the support level shown', () => {
    const history = buildSupportLevelHistory([
      review(0, { supportLevelShown: 'independent', hintOpened: true }),
    ]);
    expect(history.outcomesFor('concept-a', 'recall')[0]?.hintUptake).toBe(true);
  });

  it('the explanation tier reads the field the same way', () => {
    const opened = { ...explainBack(0, 'correct'), hintOpened: true };
    const unknown = withoutHintField(explainBack(APART, 'correct'));
    const history = buildSupportLevelHistory([opened, unknown]);
    expect(history.outcomesFor('concept-a', 'explanation').map((o) => o.hintUptake)).toEqual([
      true,
      'unknown',
    ]);
  });

  it('one session reads the worst state shown: opened, then unknown, then not opened', () => {
    const cases: readonly [readonly (boolean | undefined)[], boolean | 'unknown'][] = [
      [[false, false], false],
      [[false, undefined], 'unknown'],
      [[false, true], true],
      [[undefined, true], true],
      [[undefined, undefined], 'unknown'],
    ];
    for (const [states, expected] of cases) {
      const entries = states.map((state, i) =>
        state === undefined
          ? withoutHintField(review(i * 2))
          : review(i * 2, { hintOpened: state }),
      );
      const outcomes = buildSupportLevelHistory(entries).outcomesFor('concept-a', 'recall');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?.hintUptake).toBe(expected);
    }
  });

  it('the hint state is read from the answer she gave, not from a corrective re-grade of it', () => {
    const original = { ...explainBack(0, 'correct', 'relational'), hintOpened: true };
    const regrade = review(APART * 3, {
      instrumentId: 'eb:a',
      instrumentType: 'explain-back',
      rating: null,
      hintOpened: false,
      explainBackGrade: {
        soloLevel: 'multistructural',
        contentRef: 'content-ref-placeholder',
        revisionOf: original.eventId,
        artifactProvenance: { taskId: 'explain-back-grade', promptVersion: 'v0', modelId: 'm' },
      },
      explainBackCorrectness: {
        verdict: 'partial',
        artifactProvenance: { taskId: 'c', promptVersion: 'v0', modelId: 'm' },
      },
    });
    const history = buildSupportLevelHistory([original, regrade]);
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'minor-slip', hintUptake: true },
    ]);
  });
});

describe('what the ladder does with each hint state ([D-350], [D-094] items 5 and 6; L1, L2)', () => {
  const level = (entries: readonly ReviewLogEntry[], concept = 'concept-a') =>
    chooseSupportLevel(buildSupportLevelHistory(entries).outcomesFor(concept, 'recall')).level;

  it('L1: two clean sessions with the hint recorded not opened recede', () => {
    expect(level([review(0), review(APART)])).toBe('independent');
  });

  it('L1: two clean sessions with the hint opened hold the level: uptake never raises, never recedes', () => {
    expect(level([review(0, { hintOpened: true }), review(APART, { hintOpened: true })])).toBe(
      'prompted',
    );
  });

  it('L1: an opened hint between two unopened ones restarts the streak', () => {
    expect(level([review(0), review(APART, { hintOpened: true }), review(2 * APART)])).toBe(
      'prompted',
    );
  });

  it('L2: after a failure, every later clean session with the hint opened holds guided', () => {
    const entries = [
      review(0, { rating: 'again' }),
      ...[1, 2, 3, 4].map((n) =>
        review(n * APART, { supportLevelShown: 'guided', hintOpened: true }),
      ),
    ];
    expect(level(entries)).toBe('guided');
  });

  it('"absence of a record cannot establish unaided performance": absent values never recede a prompted answer', () => {
    expect(level([withoutHintField(review(0)), withoutHintField(review(APART))])).toBe('prompted');
    expect(
      level([
        withoutHintField(review(0)),
        withoutHintField(review(APART)),
        withoutHintField(review(2 * APART)),
        withoutHintField(review(3 * APART)),
      ]),
    ).toBe('prompted');
  });

  it('absent values never recede a guided cell either', () => {
    const entries = [
      review(0, { rating: 'again' }),
      ...[1, 2, 3].map((n) => withoutHintField(review(n * APART, { supportLevelShown: 'guided' }))),
    ];
    expect(level(entries)).toBe('guided');
  });

  it('an unknown session neither escalates nor recedes, and it restarts the streak', () => {
    expect(level([review(0), withoutHintField(review(APART)), review(2 * APART)])).toBe('prompted');
    expect(
      level([review(0), withoutHintField(review(APART)), review(2 * APART), review(3 * APART)]),
    ).toBe('independent');
  });

  it('a failure escalates whatever the hint state: unknown never blocks the fast half of the ladder', () => {
    expect(level([withoutHintField(review(0, { rating: 'again' }))])).toBe('guided');
    expect(level([review(0, { rating: 'again', hintOpened: true })])).toBe('guided');
  });

  it('answers shown at independent support with no field still count as unhinted (J5)', () => {
    const independent = (minutes: number) =>
      withoutHintField(review(minutes, { supportLevelShown: 'independent' }));
    expect(level([review(0), review(APART), independent(2 * APART), independent(3 * APART)])).toBe(
      'independent',
    );
  });

  it('is per concept: one concept with hints opened does not hold another', () => {
    const entries = [
      review(0),
      review(0, { conceptIds: ['concept-b'], hintOpened: true, instrumentId: 'qa:b:1' }),
      review(APART),
      review(APART, { conceptIds: ['concept-b'], hintOpened: true, instrumentId: 'qa:b:1' }),
    ];
    expect(level(entries, 'concept-a')).toBe('independent');
    expect(level(entries, 'concept-b')).toBe('prompted');
  });
});

describe('levels are fixed at composition, extension included (L3, [D-186])', () => {
  const earlier = [review(0), review(APART)];
  const composedAt = new Date(BASE + 2 * APART * MIN);
  const inSession = [review(2 * APART + 5, { rating: 'again' }), review(2 * APART + 10)];

  it('reads only sessions closed before the composition', () => {
    const atComposition = buildSupportLevelHistory(earlier, { composedAt });
    expect(chooseSupportLevel(atComposition.outcomesFor('concept-a', 'recall')).level).toBe(
      'independent',
    );
  });

  it('an extension asks as of the same composition and reads the same levels, whatever she answered since', () => {
    const later = buildSupportLevelHistory([...earlier, ...inSession], { composedAt });
    expect(later.outcomesFor('concept-a', 'recall')).toEqual(
      buildSupportLevelHistory(earlier, { composedAt }).outcomesFor('concept-a', 'recall'),
    );
  });

  it('a new composition while the sitting is still open does not read the session in progress', () => {
    const tenMinutesAfter = new Date(BASE + (2 * APART + 20) * MIN);
    const history = buildSupportLevelHistory([...earlier, ...inSession], {
      composedAt: tenMinutesAfter,
    });
    expect(history.outcomesFor('concept-a', 'recall')).toHaveLength(2);
  });

  it('once the sitting has closed, the next composition reads it', () => {
    const wellAfter = new Date(BASE + 3 * APART * MIN);
    const history = buildSupportLevelHistory([...earlier, ...inSession], { composedAt: wellAfter });
    expect(history.outcomesFor('concept-a', 'recall')).toHaveLength(3);
    expect(history.outcomesFor('concept-a', 'recall')[2]?.failureShape).toBe('wrong-concept');
  });

  it('without a composition instant it reads every session, as the plugin fold does today', () => {
    const history = buildSupportLevelHistory([...earlier, ...inSession]);
    expect(history.outcomesFor('concept-a', 'recall')).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// `ol-egov.141.89.9.66` — the rulings of 2026-09-28: only her own failures
// move the ladder.
// ---------------------------------------------------------------------------

const PROVENANCE = { taskId: 't', promptVersion: 'v0', modelId: 'm' } as const;

function verdictAt(minutes: number, instrumentId: string, eventId: string): VerdictLogRecord {
  return {
    schemaVersion: 6,
    kind: 'verdict',
    eventId,
    timestamp: at(minutes),
    instrumentId,
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    verdict: 'rejected',
    artifactProvenance: PROVENANCE,
  };
}

function suspendAt(
  minutes: number,
  instrumentId: string,
  reason?: 'defect' | 'own-choice',
): SuspendLogRecord {
  return {
    schemaVersion: 6,
    kind: 'suspend',
    eventId: `s-${minutes}`,
    timestamp: at(minutes),
    instrumentId,
    conceptIds: ['concept-a'],
    ...(reason !== undefined ? { reason } : {}),
  } as SuspendLogRecord;
}

function correctedContest(
  instrumentId: string,
  opened: number,
  resolved: number,
): DisputeLogRecord[] {
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
    { ...base, eventId: `o-${instrumentId}`, timestamp: at(opened) } as DisputeLogRecord,
    {
      ...base,
      eventId: `c-${instrumentId}`,
      timestamp: at(resolved),
      resolves: `o-${instrumentId}`,
      outcome: 'corrected',
    } as DisputeLogRecord,
  ];
}

describe('rule 1: her withdrawal keeps her history; a proven defect does not count as her failure', () => {
  const miss = (minutes: number) => review(minutes, { rating: 'again', instrumentId: 'qa:w' });

  it('a suspended instrument (her choice, or no reason) keeps its sessions', () => {
    for (const reason of ['own-choice', undefined] as const) {
      const history = buildSupportLevelHistory([miss(0), suspendAt(10, 'qa:w', reason)]);
      expect(history.outcomesFor('concept-a', 'recall')).toEqual([
        { failureShape: 'wrong-concept', hintUptake: false },
      ]);
    }
  });

  it('a miss on a rejected or defective instrument is not read as hers', () => {
    expect(
      buildSupportLevelHistory([miss(0), verdictAt(10, 'qa:w', 'v1')]).outcomesFor(
        'concept-a',
        'recall',
      ),
    ).toEqual([]);
    expect(
      buildSupportLevelHistory([miss(0), suspendAt(10, 'qa:w', 'defect')]).outcomesFor(
        'concept-a',
        'recall',
      ),
    ).toEqual([]);
  });

  it('fixed at composition: a rejection logged after the composition instant does not rewrite it', () => {
    const history = buildSupportLevelHistory([miss(0), verdictAt(APART * 2, 'qa:w', 'v1')], {
      composedAt: new Date(BASE + APART * MIN),
    });
    expect(history.outcomesFor('concept-a', 'recall')).toHaveLength(1);
  });
});

describe('rule 2: a corrected grade is read through its corrected verdict; the rest stands', () => {
  it('a corrective re-grade stands in for the grade it corrects, in that session', () => {
    const original = explainBack(0, 'correct', 'relational');
    const regrade = review(APART * 3, {
      instrumentId: 'eb:a',
      instrumentType: 'explain-back',
      rating: null,
      explainBackGrade: {
        soloLevel: 'multistructural',
        contentRef: 'content-ref-placeholder',
        revisionOf: original.eventId,
        artifactProvenance: PROVENANCE,
      },
      explainBackCorrectness: { verdict: 'incorrect', artifactProvenance: PROVENANCE },
    });
    const history = buildSupportLevelHistory([original, regrade]);
    // One session, read with the corrected verdict — and the re-grade is not a second session.
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
  });

  it('a miss whose grade a contest proved wrong is not hers; her other sessions stand', () => {
    const first = review(0, { rating: 'again', instrumentId: 'mcq-free-recall' });
    const contested = review(APART, { rating: 'again', instrumentId: 'mcq-free-recall' });
    const entries: ReviewLogEntry[] = [first, contested];
    const validity = projectInstrumentValidity(
      entries,
      correctedContest('mcq-free-recall', APART - 1, APART * 3),
    );
    expect([...validity.correctedEvidence.keys()]).toEqual([contested.eventId]);
    const history = buildSupportLevelHistory(entries, { validity });
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
  });
});

describe('rules 4 and 5: nothing she did not genuinely attempt, and no system failure, escalates the ladder', () => {
  it('an explanation nothing assessed has no reading (blank, unassessable)', () => {
    const ungraded = review(0, {
      instrumentId: 'eb:a',
      instrumentType: 'explain-back',
      rating: null,
    });
    expect(buildSupportLevelHistory([ungraded]).outcomesFor('concept-a', 'explanation')).toEqual(
      [],
    );
  });

  it('a skip is a non-attempt record: no session outcome at all', () => {
    const skip = {
      schemaVersion: 6,
      kind: 'non-attempt',
      eventId: 'n1',
      timestamp: at(0),
      conceptIds: ['concept-a'],
      trigger: 'on-demand',
    } as unknown as ReviewLogEntry;
    const history = buildSupportLevelHistory([skip]);
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([]);
    expect(history.outcomesFor('concept-a', 'recall')).toEqual([]);
  });

  it('a failed correctness check neither escalates nor breaks a clean run of hers', () => {
    const clean = (minutes: number) => explainBack(minutes, 'correct', 'relational');
    const checkFailed = explainBack(APART, undefined, 'multistructural');
    const history = buildSupportLevelHistory([clean(0), checkFailed, clean(APART * 2)]);
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'none', hintUptake: false },
      { failureShape: 'none', hintUptake: false },
    ]);
  });

  it('a depth grade that reads she missed the point still counts, verdict or not', () => {
    const history = buildSupportLevelHistory([
      review(0, {
        instrumentId: 'eb:a',
        instrumentType: 'explain-back',
        rating: null,
        explainBackGrade: {
          soloLevel: 'prestructural',
          contentRef: 'content-ref-placeholder',
          revisionOf: null,
          artifactProvenance: PROVENANCE,
        },
      }),
    ]);
    expect(history.outcomesFor('concept-a', 'explanation')[0]?.failureShape).toBe('wrong-concept');
  });

  it('a genuine incorrect explanation still escalates (rule 3: practice that can raise support)', () => {
    const incorrect = review(0, {
      instrumentId: 'eb:a',
      instrumentType: 'explain-back',
      rating: null,
      explainBackCorrectness: { verdict: 'incorrect', artifactProvenance: PROVENANCE },
    });
    const history = buildSupportLevelHistory([incorrect]);
    expect(history.outcomesFor('concept-a', 'explanation')).toEqual([
      { failureShape: 'wrong-concept', hintUptake: false },
    ]);
    expect(chooseSupportLevel(history.outcomesFor('concept-a', 'explanation')).level).toBe(
      'guided',
    );
  });
});
