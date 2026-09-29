/**
 * F2.21's third trigger, joined to a real review log
 * (`src/review/strong-recall-wiring.ts`, `ol-v7r5.40`).
 *
 * `olea-core`'s `strong-recall-proposal.spec.ts` covers the DECISION over an
 * already-computed evidence slice. This file covers the join the plugin owns:
 * that the four facts handed to that decision are folded from the log, that
 * only the asked-for concept is folded, that the scheduler replay happens
 * once, and that F2.21's reopening branch is supplied from the log's own
 * `misconception-observed` records rather than invented.
 *
 * Feature: F2.21 wiring — features/F2-review.md (olea-service), "the reader
 * folds one concept, not the vault" and "the reopening branch is supplied
 * from the log's own misconception-observed records".
 */
import type { DisputeLogRecord, ReviewLogEntry } from 'olea-contracts';
import { createFsrsScheduler, projectInstrumentValidity, type Scheduler } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createStrongRecallProposalReader } from '../../src/review/strong-recall-wiring.js';

const NOW = new Date('2026-08-20T09:00:00Z');

function review(overrides: {
  readonly eventId: string;
  readonly timestamp: string;
  readonly conceptIds: readonly string[];
  readonly instrumentId?: string;
  readonly instrumentType?: 'qa' | 'cloze' | 'mcq' | 'explain-back';
  readonly rating?: 'again' | 'hard' | 'good' | 'easy' | null;
  readonly explainBackGrade?: { readonly soloLevel: 'relational' | 'multistructural' };
}): ReviewLogEntry {
  const instrumentType = overrides.instrumentType ?? 'qa';
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: overrides.eventId,
    timestamp: overrides.timestamp,
    instrumentId: overrides.instrumentId ?? `inst-${overrides.eventId}`,
    instrumentType,
    rating: overrides.rating === undefined ? 'good' : overrides.rating,
    wasUnsure: false,
    durationMs: null,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [instrumentType],
      planVersion: null,
    },
    conceptIds: [...overrides.conceptIds],
    // `[D-281]`: a graded explain-back only qualifies the top stage with all
    // four pieces of evidence on the one attempt — this fixture's graded
    // events are meant to be qualifying ones, so they carry them.
    ...(overrides.explainBackGrade !== undefined
      ? {
          supportLevelShown: 'independent',
          explainBackGrade: { ...overrides.explainBackGrade, correctness: 'correct' },
        }
      : {}),
  } as ReviewLogEntry;
}

function misconception(overrides: {
  readonly eventId: string;
  readonly timestamp: string;
  readonly conceptIds: readonly string[];
}): ReviewLogEntry {
  return {
    schemaVersion: 6,
    kind: 'misconception-observed',
    eventId: overrides.eventId,
    timestamp: overrides.timestamp,
    instrumentId: 'inst-mcq-1',
    conceptIds: [...overrides.conceptIds],
    reviewEventId: 'review-event-1',
    misconceptionId: `misc-${overrides.eventId}`,
    distractor: {
      text: 'the plausible wrong option',
      believes: 'the wrong belief this option encodes',
      source_says: 'what the source actually says',
    },
  } as ReviewLogEntry;
}

/**
 * Four distinct successful days on one recall-tier instrument — the spacing
 * gate (3) plus `STRONG_RECALL_MARGIN_DAYS` (1) — with no explain-back at
 * all. Recent enough that vitality reads `holding` at `NOW`.
 */
function strongRecallLog(conceptId: string): ReviewLogEntry[] {
  return ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20'].map((day, index) =>
    review({
      eventId: `e-${conceptId}-${index}`,
      timestamp: `${day}T08:00:00+00:00`,
      conceptIds: [conceptId],
      instrumentId: `inst-${conceptId}`,
    }),
  );
}

describe('createStrongRecallProposalReader — F2.21’s trigger over a real log (ol-v7r5.40)', () => {
  it('proposes for a concept with strong recall, holding vitality and no depth evidence, and says why', () => {
    const read = createStrongRecallProposalReader({
      entries: strongRecallLog('concept-strong'),
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    const decision = read({ conceptIds: ['concept-strong'] });

    expect(decision.shouldPropose).toBe(true);
    if (!decision.shouldPropose) return;
    expect(decision.conceptId).toBe('concept-strong');
    expect(decision.trigger).toBe('strong-recall-proposal');
    expect(decision.reason.kind).toBe('strong-recall');
    expect(decision.promptText).toContain('explain it back');
  });

  it('does not propose for a concept sitting exactly on the sapling line — clearing a floor is not strong recall', () => {
    const entries = strongRecallLog('concept-just-sapling').slice(0, 3);
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    const decision = read({ conceptIds: ['concept-just-sapling'] });

    expect(decision).toEqual({ shouldPropose: false, because: 'recall-not-yet-strong' });
  });

  it('folds only the concept asked about, however many the log names', () => {
    const entries = [
      ...strongRecallLog('concept-strong'),
      ...strongRecallLog('concept-other-1'),
      ...strongRecallLog('concept-other-2'),
    ];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    const decision = read({ conceptIds: ['concept-other-2'] });

    expect(decision.shouldPropose).toBe(true);
    if (!decision.shouldPropose) return;
    expect(decision.conceptId).toBe('concept-other-2');
  });

  it('replays the scheduler once for the whole session, not once per grade, and answers a repeated ask from memory', () => {
    const real = createFsrsScheduler();
    const retrievability = vi.fn(real.retrievability.bind(real));
    const scheduler: Scheduler = { schedule: real.schedule.bind(real), retrievability };
    const read = createStrongRecallProposalReader({
      entries: strongRecallLog('concept-strong'),
      scheduler,
      now: NOW,
    });

    read({ conceptIds: ['concept-strong'] });
    const callsAfterFirst = retrievability.mock.calls.length;
    read({ conceptIds: ['concept-strong'] });
    read({ conceptIds: ['concept-strong'] });

    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(retrievability.mock.calls).toHaveLength(callsAfterFirst);
  });

  it('never runs a fold at all until the first grade — an opened session she does not rate costs nothing', () => {
    const real = createFsrsScheduler();
    const retrievability = vi.fn(real.retrievability.bind(real));
    const scheduler: Scheduler = { schedule: real.schedule.bind(real), retrievability };

    createStrongRecallProposalReader({
      entries: strongRecallLog('concept-strong'),
      scheduler,
      now: NOW,
    });

    expect(retrievability).not.toHaveBeenCalled();
  });

  it('returns the FIRST concept that proposes when the graded instrument teaches several (D-031)', () => {
    const entries = [...strongRecallLog('concept-strong'), ...strongRecallLog('concept-also')];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    const decision = read({ conceptIds: ['concept-weak', 'concept-also', 'concept-strong'] });

    expect(decision.shouldPropose).toBe(true);
    if (!decision.shouldPropose) return;
    expect(decision.conceptId).toBe('concept-also');
  });

  it('a misconception recorded AFTER the last graded explain-back reopens eligibility on a top-stage concept', () => {
    const entries: ReviewLogEntry[] = [
      ...strongRecallLog('concept-tree'),
      review({
        eventId: 'eb-1',
        timestamp: '2026-08-19T10:00:00+00:00',
        conceptIds: ['concept-tree'],
        instrumentType: 'explain-back',
        instrumentId: 'inst-eb-1',
        rating: null,
        explainBackGrade: { soloLevel: 'relational' },
      }),
      misconception({
        eventId: 'm-1',
        timestamp: '2026-08-20T08:30:00+00:00',
        conceptIds: ['concept-tree'],
      }),
    ];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    const decision = read({ conceptIds: ['concept-tree'] });

    expect(decision.shouldPropose).toBe(true);
    if (!decision.shouldPropose) return;
    expect(decision.reason.kind).toBe('reopened-by-misconception');
  });

  it('a misconception recorded BEFORE the last graded explain-back reopens nothing — the stage already accounts for it', () => {
    const entries: ReviewLogEntry[] = [
      ...strongRecallLog('concept-tree'),
      misconception({
        eventId: 'm-1',
        timestamp: '2026-08-18T08:30:00+00:00',
        conceptIds: ['concept-tree'],
      }),
      review({
        eventId: 'eb-1',
        timestamp: '2026-08-19T10:00:00+00:00',
        conceptIds: ['concept-tree'],
        instrumentType: 'explain-back',
        instrumentId: 'inst-eb-1',
        rating: null,
        explainBackGrade: { soloLevel: 'relational' },
      }),
    ];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(read({ conceptIds: ['concept-tree'] })).toEqual({
      shouldPropose: false,
      because: 'depth-evidence-present',
    });
  });

  // `ol-egov.141.89.9.76` (`[D-419]`, `[D-423]`): a graded explain-back is the last explanation OF
  // the one concept it scored — the first id of its own record. A record that names the concept
  // only as context is not an explanation of it, so it never moves "fresh" past a misconception.
  it('a graded explain-back that names the concept only as context is not its last explanation', () => {
    const entries: ReviewLogEntry[] = [
      ...strongRecallLog('concept-tree'),
      review({
        eventId: 'eb-1',
        timestamp: '2026-08-19T10:00:00+00:00',
        conceptIds: ['concept-tree'],
        instrumentType: 'explain-back',
        instrumentId: 'inst-eb-1',
        rating: null,
        explainBackGrade: { soloLevel: 'relational' },
      }),
      misconception({
        eventId: 'm-1',
        timestamp: '2026-08-19T12:00:00+00:00',
        conceptIds: ['concept-tree'],
      }),
      review({
        eventId: 'eb-2',
        timestamp: '2026-08-19T14:00:00+00:00',
        conceptIds: ['concept-other', 'concept-tree'],
        instrumentType: 'explain-back',
        instrumentId: 'inst-eb-2',
        rating: null,
        explainBackGrade: { soloLevel: 'relational' },
      }),
    ];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    const decision = read({ conceptIds: ['concept-tree'] });

    expect(decision.shouldPropose).toBe(true);
    if (!decision.shouldPropose) return;
    expect(decision.reason.kind).toBe('reopened-by-misconception');
  });

  it('a misconception on another concept never reopens this one', () => {
    const entries: ReviewLogEntry[] = [
      ...strongRecallLog('concept-tree'),
      review({
        eventId: 'eb-1',
        timestamp: '2026-08-19T10:00:00+00:00',
        conceptIds: ['concept-tree'],
        instrumentType: 'explain-back',
        instrumentId: 'inst-eb-1',
        rating: null,
        explainBackGrade: { soloLevel: 'relational' },
      }),
      misconception({
        eventId: 'm-1',
        timestamp: '2026-08-20T08:30:00+00:00',
        conceptIds: ['concept-elsewhere'],
      }),
    ];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(read({ conceptIds: ['concept-tree'] }).shouldPropose).toBe(false);
  });

  it('an empty log proposes nothing, and an empty concept list is not an error', () => {
    const read = createStrongRecallProposalReader({
      entries: [],
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(read({ conceptIds: [] }).shouldPropose).toBe(false);
    expect(read({ conceptIds: [''] }).shouldPropose).toBe(false);
    expect(read({ conceptIds: ['never-seen'] }).shouldPropose).toBe(false);
  });

  it('a scheduler that throws is a diagnostic, never a broken review — the reader reads as "no proposal"', () => {
    const real = createFsrsScheduler();
    const scheduler: Scheduler = {
      schedule: real.schedule.bind(real),
      retrievability: () => {
        throw new Error('scheduler exploded');
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const read = createStrongRecallProposalReader({
      entries: strongRecallLog('concept-strong'),
      scheduler,
      now: NOW,
    });

    expect(read({ conceptIds: ['concept-strong'] }).shouldPropose).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('writes nothing and mutates no input — F2.21 proposes, it does not schedule', () => {
    const entries = strongRecallLog('concept-strong');
    const snapshot = JSON.stringify(entries);
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    const decision = read({ conceptIds: ['concept-strong'] });

    expect(JSON.stringify(entries)).toBe(snapshot);
    expect(decision).not.toHaveProperty('gapScore');
    expect(decision).not.toHaveProperty('instrumentId');
    expect(decision).not.toHaveProperty('dueAt');
  });

  it("`[D-281]` item 4 (ol-a07q, ol-v7r5.69): a `rejected` verdict against the sole qualifying explain-back drops the concept out of `tree` — the reopening branch above (state === 'tree') no longer fires, and a fresh misconception is answered as `stage-below-sapling` instead of `reopened-by-misconception`", () => {
    // One qualifying explain-back is enough to reach `tree` alone (no other
    // recall-tier reviews needed) — the same minimal shape
    // `registry/build.invalid-instruments.spec.ts` (olea-core) uses to prove
    // the identical fold directly.
    const entries: ReviewLogEntry[] = [
      review({
        eventId: 'eb-1',
        timestamp: '2026-08-19T10:00:00+00:00',
        conceptIds: ['concept-tree'],
        instrumentType: 'explain-back',
        instrumentId: 'inst-eb-1',
        rating: null,
        explainBackGrade: { soloLevel: 'relational' },
      }),
      misconception({
        eventId: 'm-1',
        timestamp: '2026-08-20T08:30:00+00:00',
        conceptIds: ['concept-tree'],
      }),
    ];

    const withoutRejection = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const decisionWithout = withoutRejection({ conceptIds: ['concept-tree'] });
    expect(decisionWithout.shouldPropose).toBe(true);
    if (!decisionWithout.shouldPropose) throw new Error('expected the reopening branch to fire');
    expect(decisionWithout.reason.kind).toBe('reopened-by-misconception');

    // A real refusal, not a mere suspend — the proven-invalid signal D-281
    // item 4 and ol-v7r5.69's close reason both require.
    const rejectedVerdict: ReviewLogEntry = {
      schemaVersion: 6,
      kind: 'verdict',
      eventId: 'verdict-1',
      timestamp: '2026-08-19T10:30:00+00:00',
      instrumentId: 'inst-eb-1',
      instrumentType: 'explain-back',
      conceptIds: ['concept-tree'],
      verdict: 'rejected',
      artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
    } as ReviewLogEntry;

    const withRejection = createStrongRecallProposalReader({
      entries: [...entries, rejectedVerdict],
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const decisionWith = withRejection({ conceptIds: ['concept-tree'] });

    // The exact regression this bead fixes: before the fix,
    // `createStrongRecallProposalReader` called `computeAllConceptMastery`
    // with no `invalidInstrumentIds` at all, so a rejected verdict never
    // reached the fold, the concept stayed at `tree`, and the reopening
    // branch (which requires `state === 'tree'`) still fired.
    expect(decisionWith).toEqual({ shouldPropose: false, because: 'stage-below-sapling' });
  });
});

/**
 * `ol-owyn`: this reader used to fall back to a locally declared `0.8`,
 * never the `[D-115]`-ratified `0.90`, whenever no `holdingCut` override was
 * supplied — which production never does. `evaluateStrongRecallProposal`
 * requires `vitality === 'holding'` to propose at all (`strong-recall-
 * proposal.ts:330`), which makes the wrong fallback directly observable
 * here: the SAME four-spaced-day log `strongRecallLog` builds above, read 25
 * days after its last review, lands the real FSRS scheduler's retrievability
 * at roughly 0.87 (`>= 0.8`, `< 0.9`). The old fallback would read `holding`
 * and wrongly offer the extra explain-back; the ratified cut must read
 * `tending` and decline it.
 */
/**
 * `ol-egov.141.89.9.61`: vitality is a CURRENT reading too (`[D-338]` item
 * 3) — the reader already folds `invalidInstrumentIds` into `mastery`
 * above (the `[D-281]`/`ol-a07q` suite just above proves that half), but
 * fed `conceptVitalityInstruments`'s UNFILTERED list into `readVitality`,
 * so a rejected instrument could still set the weakest reading and read the
 * concept `tending` when it should read `holding` once its evidence is
 * excluded.
 */
describe('createStrongRecallProposalReader — a rejected instrument no longer sets the weakest vitality reading (ol-egov.141.89.9.61)', () => {
  it('a second, badly faded instrument reads `tending`; once its verdict is rejected, vitality reads `holding` again and the proposal returns', () => {
    const strong = strongRecallLog('concept-mixed');
    const faded = review({
      eventId: 'faded-1',
      // Six years stale with a miss — the real FSRS scheduler reads this as
      // deeply faded, well under the holding cut.
      timestamp: '2020-01-01T08:00:00+00:00',
      conceptIds: ['concept-mixed'],
      instrumentId: 'inst-faded',
      rating: 'again',
    });

    const withoutRejection = createStrongRecallProposalReader({
      entries: [...strong, faded],
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const decisionWithout = withoutRejection({ conceptIds: ['concept-mixed'] });
    expect(decisionWithout).toEqual({ shouldPropose: false, because: 'recall-not-holding' });

    const rejectedVerdict: ReviewLogEntry = {
      schemaVersion: 6,
      kind: 'verdict',
      eventId: 'verdict-faded',
      timestamp: '2020-01-02T08:00:00+00:00',
      instrumentId: 'inst-faded',
      instrumentType: 'qa',
      conceptIds: ['concept-mixed'],
      verdict: 'rejected',
      artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
    } as ReviewLogEntry;

    const withRejection = createStrongRecallProposalReader({
      entries: [...strong, faded, rejectedVerdict],
      scheduler: createFsrsScheduler(),
      now: NOW,
    });
    const decisionWith = withRejection({ conceptIds: ['concept-mixed'] });

    // The exact regression this bead fixes: before the fix, `readVitality`
    // was called over `conceptVitalityInstruments`'s unfiltered list, so
    // the rejected instrument kept setting the weakest reading and the
    // decision stayed `recall-not-holding` even after the rejection.
    expect(decisionWith.shouldPropose).toBe(true);
    if (!decisionWith.shouldPropose) return;
    expect(decisionWith.reason.kind).toBe('strong-recall');
  });
});

/**
 * `ol-egov.141.89.9.68` (rulings of 2026-09-28, `ol-egov.141.89.9.66`): the
 * reader reads the one validity projection, handed in with the dispute
 * records read beside the log. A corrected contest proves ONE review's grade
 * wrong — never the instrument — and a suspension recorded as a defect proves
 * the instrument invalid.
 */
function correctedContest(
  instrumentId: string,
  conceptId: string,
  openedAt: string,
  resolvedAt: string,
): DisputeLogRecord[] {
  const base = {
    schemaVersion: 6 as const,
    kind: 'dispute' as const,
    timestamp: openedAt,
    claimKind: 'grade' as const,
    claimRendering: 'explain-back-grade' as const,
    conceptIds: [conceptId],
    instrumentId,
    evidenceBasis: 'evidence-fingerprint-1',
    effect: 'quarantined' as const,
  };
  return [
    { ...base, eventId: 'contest-open' } as DisputeLogRecord,
    {
      ...base,
      eventId: 'contest-resolved',
      timestamp: resolvedAt,
      resolves: 'contest-open',
      outcome: 'corrected' as const,
    } as DisputeLogRecord,
  ];
}

describe('createStrongRecallProposalReader — the ruled validity scope (ol-egov.141.89.9.68)', () => {
  const explainBack = (eventId: string, timestamp: string) =>
    review({
      eventId,
      timestamp,
      conceptIds: ['concept-tree'],
      instrumentType: 'explain-back',
      instrumentId: 'inst-eb-1',
      rating: null,
      explainBackGrade: { soloLevel: 'relational' },
    });
  const freshMisconception = misconception({
    eventId: 'm-1',
    timestamp: '2026-08-20T08:30:00+00:00',
    conceptIds: ['concept-tree'],
  });
  const contest = correctedContest(
    'inst-eb-1',
    'concept-tree',
    '2026-08-19T11:00:00+00:00',
    '2026-08-19T12:00:00+00:00',
  );

  function decide(entries: readonly ReviewLogEntry[], disputes: readonly DisputeLogRecord[] = []) {
    return createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
      validity: projectInstrumentValidity(entries, disputes),
    })({ conceptIds: ['concept-tree'] });
  }

  it('a corrected contest on the sole qualifying explain-back withholds the top stage it earned', () => {
    const entries = [explainBack('eb-1', '2026-08-19T10:00:00+00:00'), freshMisconception];
    expect(decide(entries).shouldPropose).toBe(true);
    expect(decide(entries, contest)).toEqual({
      shouldPropose: false,
      because: 'stage-below-sapling',
    });
  });

  it('a corrected contest no longer drops the instrument’s other reviews: an earlier sound explain-back still holds the top stage', () => {
    const entries = [
      explainBack('eb-0', '2026-08-10T10:00:00+00:00'),
      explainBack('eb-1', '2026-08-19T10:00:00+00:00'),
      freshMisconception,
    ];
    const decision = decide(entries, contest);
    expect(decision.shouldPropose).toBe(true);
    if (!decision.shouldPropose) return;
    expect(decision.reason.kind).toBe('reopened-by-misconception');
  });

  it('vitality replays without a corrected review: a faded instrument whose only review was proven wrong no longer sets the weakest reading', () => {
    const strong = strongRecallLog('concept-mixed');
    const faded = review({
      eventId: 'faded-1',
      timestamp: '2020-01-01T08:00:00+00:00',
      conceptIds: ['concept-mixed'],
      instrumentId: 'inst-faded',
      rating: 'again',
    });
    const entries = [...strong, faded];
    const reader = (disputes: readonly DisputeLogRecord[]) =>
      createStrongRecallProposalReader({
        entries,
        scheduler: createFsrsScheduler(),
        now: NOW,
        validity: projectInstrumentValidity(entries, disputes),
      })({ conceptIds: ['concept-mixed'] });

    expect(reader([])).toEqual({ shouldPropose: false, because: 'recall-not-holding' });
    const decision = reader(
      correctedContest(
        'inst-faded',
        'concept-mixed',
        '2020-01-01T08:01:00+00:00',
        '2020-01-02T08:00:00+00:00',
      ),
    );
    expect(decision.shouldPropose).toBe(true);
    if (!decision.shouldPropose) return;
    expect(decision.reason.kind).toBe('strong-recall');
  });

  it('a suspension recorded as a defect invalidates the instrument until a later unsuspend', () => {
    const suspension = (kind: 'suspend' | 'unsuspend', eventId: string, timestamp: string) =>
      ({
        schemaVersion: 6,
        kind,
        eventId,
        timestamp,
        instrumentId: 'inst-eb-1',
        conceptIds: ['concept-tree'],
        ...(kind === 'suspend' ? { reason: 'defect' } : {}),
      }) as ReviewLogEntry;
    const entries = [
      explainBack('eb-1', '2026-08-19T10:00:00+00:00'),
      suspension('suspend', 'suspend-1', '2026-08-19T10:30:00+00:00'),
      freshMisconception,
    ];
    expect(decide(entries)).toEqual({ shouldPropose: false, because: 'stage-below-sapling' });
    expect(
      decide([...entries, suspension('unsuspend', 'unsuspend-1', '2026-08-19T11:30:00+00:00')])
        .shouldPropose,
    ).toBe(true);
  });
});

describe('createStrongRecallProposalReader — the no-override holding cut is the ratified 0.90, not 0.8 (ol-owyn)', () => {
  it('does not propose once retrievability has faded into the 0.8–0.9 gap — the ratified cut, not the old 0.8 guess', () => {
    const lastReviewedAt = new Date('2026-08-20T08:00:00+00:00');
    const read = createStrongRecallProposalReader({
      entries: strongRecallLog('concept-owyn'),
      scheduler: createFsrsScheduler(),
      now: new Date(lastReviewedAt.getTime() + 25 * 24 * 60 * 60 * 1000),
    });

    const decision = read({ conceptIds: ['concept-owyn'] });

    expect(decision).toEqual({ shouldPropose: false, because: 'recall-not-holding' });
  });
});
