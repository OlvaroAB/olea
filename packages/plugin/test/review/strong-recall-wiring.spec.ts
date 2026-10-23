/**
 * F2.21's third trigger, joined to a real review log
 * (`src/review/strong-recall-wiring.ts`, `ol-v7r5.40`).
 *
 * `olea-core`'s `strong-recall-proposal.spec.ts` covers the DECISION over an
 * already-computed evidence slice. This file covers the join the plugin owns:
 * that the four facts handed to that decision are folded from the log, that
 * only the asked-for concept is folded, that the scheduler replay happens
 * once, that a completed practice explanation read from the same log
 * suppresses the offer until recall on later days (`[D-613]` (b)), and that
 * the reopening branch is never supplied in v0.9.
 *
 * Feature: F2.21 wiring and F2.21 / [D-613] — features/F2-review.md
 * (olea-service).
 */
import {
  type DisputeLogRecord,
  explainBackOfferTrigger,
  type ReviewLogEntry,
} from 'olea-contracts';
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

function practice(overrides: {
  readonly eventId: string;
  readonly timestamp: string;
  readonly conceptId: string;
  readonly alsoNames?: readonly string[];
  readonly flagged?: true;
}): ReviewLogEntry {
  return {
    schemaVersion: 6,
    kind: 'practice-explanation',
    eventId: overrides.eventId,
    timestamp: overrides.timestamp,
    instrumentId: `explain-back:${overrides.conceptId}`,
    attemptId: `attempt-${overrides.eventId}`,
    conceptIds: [overrides.conceptId, ...(overrides.alsoNames ?? [])],
    promptShape: 'concept',
    trigger: 'on-demand',
    durationMs: 60000,
    supportLevelShown: 'independent',
    contentRef: `device-a.content-${overrides.eventId}`,
    ...(overrides.flagged === true ? { localCheckFlagged: true } : {}),
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

  // `[D-613]` (b), as David changed it (`ol-egov.141.89.6.131`): F2.21 as amended. The offer is
  // suppressed by a completed practice explanation read from the log she already folds.
  it('a completed practice explanation of the concept just graded raises no offer on the reveal screen', () => {
    const entries = [
      ...strongRecallLog('concept-strong'),
      practice({
        eventId: 'p-1',
        timestamp: '2026-08-20T08:30:00+00:00',
        conceptId: 'concept-strong',
      }),
    ];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(read({ conceptIds: ['concept-strong'] })).toEqual({
      shouldPropose: false,
      because: 'practice-explanation-completed',
    });
  });

  it('a practice explanation of another concept does not suppress this one', () => {
    const entries = [
      ...strongRecallLog('concept-strong'),
      practice({
        eventId: 'p-1',
        timestamp: '2026-08-20T08:30:00+00:00',
        conceptId: 'concept-elsewhere',
      }),
    ];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(read({ conceptIds: ['concept-strong'] }).shouldPropose).toBe(true);
  });

  it('a practice entry that names the concept only as context does not suppress it (D-423: index 0 is the concept explained)', () => {
    const entries = [
      ...strongRecallLog('concept-strong'),
      practice({
        eventId: 'p-1',
        timestamp: '2026-08-20T08:30:00+00:00',
        conceptId: 'concept-elsewhere',
        alsoNames: ['concept-strong'],
      }),
    ];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(read({ conceptIds: ['concept-strong'] }).shouldPropose).toBe(true);
  });

  it('an answer the local check flagged does not suppress the offer', () => {
    const entries = [
      ...strongRecallLog('concept-strong'),
      practice({
        eventId: 'p-1',
        timestamp: '2026-08-20T08:30:00+00:00',
        conceptId: 'concept-strong',
        flagged: true,
      }),
    ];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(read({ conceptIds: ['concept-strong'] }).shouldPropose).toBe(true);
  });

  it('a non-attempt, which writes no practice entry, does not suppress the offer', () => {
    const nonAttempt = {
      schemaVersion: 6,
      kind: 'non-attempt',
      eventId: 'na-1',
      timestamp: '2026-08-20T08:30:00+00:00',
      instrumentId: 'explain-back:concept-strong',
      conceptIds: ['concept-strong'],
    } as unknown as ReviewLogEntry;
    const read = createStrongRecallProposalReader({
      entries: [...strongRecallLog('concept-strong'), nonAttempt],
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(read({ conceptIds: ['concept-strong'] }).shouldPropose).toBe(true);
  });

  it('recall before a completion never counts: the same four days, then a completion, propose nothing', () => {
    const entries = [
      ...strongRecallLog('concept-strong'),
      practice({
        eventId: 'p-1',
        timestamp: '2026-08-20T09:00:00+00:00',
        conceptId: 'concept-strong',
      }),
    ];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(read({ conceptIds: ['concept-strong'] }).shouldPropose).toBe(false);
  });

  it('recall on later days meets the same threshold again, counted from the completion alone', () => {
    // Completion on day one; recall on days two to five is four spaced days after it, the
    // spacing gate (3) plus the margin (1). Days before the completion add nothing.
    const instrumentId = 'inst-concept-strong';
    const recallOn = (days: readonly string[]) =>
      days.map((day, index) =>
        review({
          eventId: `late-${index}`,
          timestamp: `${day}T08:00:00+00:00`,
          conceptIds: ['concept-strong'],
          instrumentId,
        }),
      );
    const before = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13'];
    const completion = practice({
      eventId: 'p-1',
      timestamp: '2026-08-14T10:00:00+00:00',
      conceptId: 'concept-strong',
    });
    const decide = (after: readonly string[]) =>
      createStrongRecallProposalReader({
        entries: [
          ...recallOn(before),
          completion,
          ...recallOn(after).map((e, i) => ({ ...e, eventId: `after-${i}` })),
        ],
        scheduler: createFsrsScheduler(),
        now: NOW,
      })({ conceptIds: ['concept-strong'] });

    // Three days after: the spacing gate, not yet the margin.
    expect(decide(['2026-08-15', '2026-08-16', '2026-08-17']).shouldPropose).toBe(false);
    // The completion's own day is not a spaced day after it.
    expect(decide(['2026-08-14', '2026-08-16', '2026-08-17']).shouldPropose).toBe(false);
    const again = decide(['2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18']);
    expect(again.shouldPropose).toBe(true);
    if (!again.shouldPropose) return;
    expect(again.reason.successfulScoredDays).toBe(4);
    expect(again.trigger).toBe('strong-recall-proposal');
  });

  it('the latest completion is the one counted from', () => {
    const entries = [
      ...strongRecallLog('concept-strong'),
      practice({
        eventId: 'p-1',
        timestamp: '2026-08-16T09:00:00+00:00',
        conceptId: 'concept-strong',
      }),
      practice({
        eventId: 'p-2',
        timestamp: '2026-08-19T09:00:00+00:00',
        conceptId: 'concept-strong',
      }),
    ];
    const read = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    expect(read({ conceptIds: ['concept-strong'] }).shouldPropose).toBe(false);
  });

  it('the reopening branch is never supplied in v0.9, whatever the misconception-observed records say', () => {
    // A misconception after a completion, and no concept at the top stage (none can be in v0.9):
    // nothing is proposed on the reopening branch, and the offer's own reason kind is never it.
    const completed = [
      ...strongRecallLog('concept-strong'),
      practice({
        eventId: 'p-1',
        timestamp: '2026-08-19T10:00:00+00:00',
        conceptId: 'concept-strong',
      }),
      misconception({
        eventId: 'm-1',
        timestamp: '2026-08-20T08:30:00+00:00',
        conceptIds: ['concept-strong'],
      }),
    ];
    const read = (entries: readonly ReviewLogEntry[]) =>
      createStrongRecallProposalReader({
        entries,
        scheduler: createFsrsScheduler(),
        now: NOW,
      })({ conceptIds: ['concept-strong'] });

    expect(read(completed).shouldPropose).toBe(false);
    // With no completion the offer is the ordinary one: a misconception changes nothing.
    const plain = read([
      ...strongRecallLog('concept-strong'),
      misconception({
        eventId: 'm-2',
        timestamp: '2026-08-20T08:30:00+00:00',
        conceptIds: ['concept-strong'],
      }),
    ]);
    expect(plain.shouldPropose).toBe(true);
    if (!plain.shouldPropose) return;
    expect(plain.reason.kind).toBe('strong-recall');
  });

  it('a practice entry is read, never written: the entries are not mutated and the trigger stays strong-recall-proposal', () => {
    const entries = [
      ...strongRecallLog('concept-strong'),
      practice({
        eventId: 'p-1',
        timestamp: '2026-08-10T09:00:00+00:00',
        conceptId: 'concept-strong',
      }),
    ];
    const snapshot = JSON.stringify(entries);
    const decision = createStrongRecallProposalReader({
      entries,
      scheduler: createFsrsScheduler(),
      now: NOW,
    })({ conceptIds: ['concept-strong'] });

    expect(JSON.stringify(entries)).toBe(snapshot);
    expect(decision.shouldPropose).toBe(true);
    if (!decision.shouldPropose) return;
    expect(decision.trigger).toBe('strong-recall-proposal');
    expect(Object.keys(decision).sort()).toEqual([
      'conceptId',
      'promptText',
      'reason',
      'shouldPropose',
      'trigger',
    ]);
  });

  it("the offer's copy names no stage and no check and promises no advancement (F2.21, registry sections 9 and 39)", () => {
    const decision = createStrongRecallProposalReader({
      entries: strongRecallLog('concept-strong'),
      scheduler: createFsrsScheduler(),
      now: NOW,
    })({ conceptIds: ['concept-strong'] });
    if (!decision.shouldPropose) throw new Error('expected an offer');
    const words = decision.promptText.toLowerCase();
    for (const forbidden of [
      'seed',
      'sprout',
      'sapling',
      'tree',
      'stage',
      'vitality',
      'holding',
      'check',
      'grade',
      'graded',
      'score',
      'level',
      'depth',
      'unlock',
      'advance',
      'progress',
      'earn',
      'reach',
      'next',
      'durable',
      'permanent',
      'will ',
    ]) {
      expect(words).not.toContain(forbidden);
    }
  });

  it('the offer log trigger enum is unchanged: the proposal logs under the existing strong-recall-proposal value', () => {
    expect(explainBackOfferTrigger.options).toEqual([
      'repeated-failure',
      'strong-recall-proposal',
      'on-demand',
      'scheduling-observation',
    ]);
    const decision = createStrongRecallProposalReader({
      entries: strongRecallLog('concept-strong'),
      scheduler: createFsrsScheduler(),
      now: NOW,
    })({ conceptIds: ['concept-strong'] });
    if (!decision.shouldPropose) throw new Error('expected an offer');
    expect(explainBackOfferTrigger.options).toContain(decision.trigger);
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

  it("`[D-281]` item 4: a defect suspension still removes the instrument's recall from the fold, so nothing is offered until it is lifted", () => {
    const suspend = (kind: 'suspend' | 'unsuspend', eventId: string, timestamp: string) =>
      ({
        schemaVersion: 6,
        kind,
        eventId,
        timestamp,
        instrumentId: 'inst-concept-strong',
        conceptIds: ['concept-strong'],
        ...(kind === 'suspend' ? { reason: 'defect' } : {}),
      }) as ReviewLogEntry;
    const entries = [
      ...strongRecallLog('concept-strong'),
      suspend('suspend', 'suspend-1', '2026-08-20T08:30:00+00:00'),
    ];
    const read = (log: readonly ReviewLogEntry[]) =>
      createStrongRecallProposalReader({
        entries: log,
        scheduler: createFsrsScheduler(),
        now: NOW,
      })({ conceptIds: ['concept-strong'] });

    expect(read(entries).shouldPropose).toBe(false);
    expect(
      read([...entries, suspend('unsuspend', 'unsuspend-1', '2026-08-20T08:45:00+00:00')])
        .shouldPropose,
    ).toBe(true);
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
