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
    ...overrides,
  };
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

  it('an instrument naming several concepts contributes to each', () => {
    const history = buildSupportLevelHistory([
      review(0, { conceptIds: ['concept-a', 'concept-b'] }),
    ]);
    expect(history.outcomesFor('concept-b', 'recall')).toHaveLength(1);
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

describe('hint use is not recorded yet ([D-350] open): read as not taken (L1)', () => {
  it('every outcome says no hint was taken, never a fabricated positive', () => {
    const history = buildSupportLevelHistory([review(0), review(APART, { rating: 'again' })]);
    for (const outcome of history.outcomesFor('concept-a', 'recall')) {
      expect(outcome.hintUptake).toBe(false);
    }
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
