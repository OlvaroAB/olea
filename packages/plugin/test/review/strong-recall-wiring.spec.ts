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
import type { ReviewLogEntry } from 'olea-contracts';
import { createFsrsScheduler, type Scheduler } from 'olea-core';
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
    schemaVersion: 5,
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
    ...(overrides.explainBackGrade !== undefined
      ? { explainBackGrade: overrides.explainBackGrade }
      : {}),
  } as ReviewLogEntry;
}

function misconception(overrides: {
  readonly eventId: string;
  readonly timestamp: string;
  readonly conceptIds: readonly string[];
}): ReviewLogEntry {
  return {
    schemaVersion: 5,
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
});
