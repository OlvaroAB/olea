/**
 * `[D-460]` (`ol-egov.141.89.6.86`): the feedback exposure marker read back from her log.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "F5.4 (continued) / [D-460]", and
 * the row-50 scenario it closes ("feedback shown in a view that was then lost").
 *
 * The end-to-end tests compose the very pieces production composes, in the order the view uses
 * them: session one writes through `createRecordFeedbackShown` (the `recordFeedbackShown` dep
 * `main.ts` wires); session two starts from a fresh session note (the plugin restarted) and
 * reads through `createReadLoggedAttemptState` (the `readLoggedAttemptState` dep) over the SAME
 * vault, then `resolvePriorAttemptState` (what `resolveInstrumentPrompt` awaits) and
 * `sealAttemptSupport` (what `submitAnswer` seals with). The rule tests drive
 * `classifyLoggedFeedbackExposure` directly over hand-built entries.
 *
 * Structural placeholders throughout (INV-3): no real ids, no answer text.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  appendSetAsideAttempt,
  EMPTY_ATTEMPT_SEQUENCE,
  sealAttemptSupport,
} from '../../src/explain-back/attempt-sequence.js';
import {
  classifyLoggedFeedbackExposure,
  createFeedbackExposureLedger,
  createRecordFeedbackShown,
  feedbackShownRecordInput,
  type LoggedAttemptHistory,
  resolvePriorAttemptState,
} from '../../src/explain-back/feedback-exposure.js';
import {
  createReadLoggedAttemptState,
  createRecordSetAsideAttempt,
  setAsideRecordInput,
} from '../../src/explain-back/set-aside-record.js';
import { memoryVault } from '../review/memory-vault.js';

const INSTRUMENT = 'explain-back:concept-a';
const OTHER_INSTRUMENT = 'explain-back:concept-b';
const UNAIDED = { hintOffered: false, sourceShownWhileAnswering: false } as const;
const SESSION_ONE = new Date('2026-10-05T14:15:00Z');
const DAY = '2026-10-05';

type Vault = ReturnType<typeof memoryVault>;

/** Session one: a graded result is about to be shown, so the view writes the marker first. */
async function sessionOneShowsFeedback(
  vault: Vault,
  instrumentId: string,
  attemptId: string,
  at: Date = SESSION_ONE,
): Promise<void> {
  await createRecordFeedbackShown({ vault, deviceId: async () => 'device-a' })(
    feedbackShownRecordInput({ instrumentId, attemptId, at }),
  );
}

/** Session one: she chose Try again on a graded result, so the view writes the set-aside record. */
async function sessionOneSetsAside(vault: Vault, instrumentId: string, attemptId: string) {
  const attempt = appendSetAsideAttempt(EMPTY_ATTEMPT_SEQUENCE, {
    attemptId,
    outcome: { kind: 'graded', verdict: 'partial' },
    support: sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED),
  })[0];
  if (attempt === undefined) throw new Error('expected one attempt');
  const input = setAsideRecordInput({
    instrumentId,
    subjectConceptId: 'concept-a',
    attempt,
    pending: {
      status: 'pending-review',
      grading: { outcome: 'graded', verdict: 'partial' },
      overlap: {},
    } as never,
    durationMs: 1000,
    at: new Date(SESSION_ONE.getTime() + 60_000),
  });
  if (input === null) throw new Error('expected an input');
  await createRecordSetAsideAttempt({ vault, deviceId: async () => 'device-a' })(input);
}

/** Session two: a brand-new note (the plugin restarted), the reader wired as main.ts wires it. */
async function sessionTwoFirstSeal(vault: Vault, instrumentId: string) {
  const prior = await resolvePriorAttemptState({
    instrumentId,
    ledger: createFeedbackExposureLedger(),
    readLogged: createReadLoggedAttemptState({ vault }),
  });
  return { prior, sealed: sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED, prior) };
}

function review(over: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: 'review-1',
    timestamp: '2026-10-05T10:30:00-04:00',
    instrumentId: INSTRUMENT,
    instrumentType: 'explain-back',
    conceptIds: ['concept-a'],
    rating: null,
    wasUnsure: false,
    durationMs: 1000,
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    ...over,
  };
}

function marker(
  eventId: string,
  attemptId: string,
  timestamp = '2026-10-05T10:15:00-04:00',
  instrumentId = INSTRUMENT,
): ReviewLogEntry {
  return {
    schemaVersion: 6,
    kind: 'explain-back-feedback-shown',
    eventId,
    timestamp,
    instrumentId,
    attemptId,
  };
}

function history(
  entries: readonly ReviewLogEntry[],
  invalidRaw: readonly string[] = [],
): LoggedAttemptHistory {
  return { entries, invalidLines: invalidRaw.map((raw) => ({ line: { raw } })) };
}

describe('the reload window: feedback shown, then the view lost before Try again or accept ([D-460])', () => {
  it('a marker alone, written in an earlier session, seals the first attempt guided and follows the attempt she read', async () => {
    const vault = memoryVault();
    await sessionOneShowsFeedback(vault, INSTRUMENT, 'at-1');

    const { prior, sealed } = await sessionTwoFirstSeal(vault, INSTRUMENT);

    expect(prior).toEqual({ exposure: 'shown', lastAttemptId: 'at-1' });
    expect(sealed).toEqual({
      supportLevelShown: 'guided',
      followsAttemptId: 'at-1',
      feedbackExposure: 'shown',
    });
  });

  it('the control: the same session with no marker written reads as a first attempt', async () => {
    const vault = memoryVault();

    const { prior, sealed } = await sessionTwoFirstSeal(vault, INSTRUMENT);

    expect(prior).toEqual({ exposure: 'not-shown', lastAttemptId: null });
    expect(sealed.supportLevelShown).toBe('independent');
  });

  it('the marker lands in the review log the reader reads, as one line holding ids and a time', async () => {
    const vault = memoryVault();
    await sessionOneShowsFeedback(vault, INSTRUMENT, 'at-1');

    const text = vault.contentOf(reviewLogPath(DAY, 'device-a')) ?? '';
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(Object.keys(JSON.parse(lines[0] ?? '{}') as object).sort()).toEqual(
      ['attemptId', 'eventId', 'instrumentId', 'kind', 'schemaVersion', 'timestamp'].sort(),
    );
  });

  it('a marker for another question makes nothing here a revision', async () => {
    const vault = memoryVault();
    await sessionOneShowsFeedback(vault, OTHER_INSTRUMENT, 'at-1');

    const { prior } = await sessionTwoFirstSeal(vault, INSTRUMENT);

    expect(prior).toEqual({ exposure: 'not-shown', lastAttemptId: null });
  });

  it('after Try again and a second shown result, a new attempt follows the latest one she read', async () => {
    const vault = memoryVault();
    await sessionOneShowsFeedback(vault, INSTRUMENT, 'at-1');
    await sessionOneSetsAside(vault, INSTRUMENT, 'at-1');
    await sessionOneShowsFeedback(
      vault,
      INSTRUMENT,
      'at-2',
      new Date(SESSION_ONE.getTime() + 120_000),
    );

    const { prior, sealed } = await sessionTwoFirstSeal(vault, INSTRUMENT);

    expect(prior).toEqual({ exposure: 'shown', lastAttemptId: 'at-2' });
    expect(sealed.followsAttemptId).toBe('at-2');
  });
});

describe('a marker whose exchange ended in acceptance makes nothing later a revision ([D-460])', () => {
  it('the accepted review carries the marked attempt as its own id', () => {
    const state = classifyLoggedFeedbackExposure(
      history([marker('m1', 'at-1'), review({ attemptId: 'at-1' })]),
      INSTRUMENT,
    );
    expect(state).toEqual({ exposure: 'not-shown', lastAttemptId: null });
  });

  it('even when the accepting device clock ran behind the one that wrote the marker', () => {
    const state = classifyLoggedFeedbackExposure(
      history([
        marker('m1', 'at-1', '2026-10-05T10:15:00-04:00'),
        review({ attemptId: 'at-1', timestamp: '2026-10-05T10:10:00-04:00' }),
      ]),
      INSTRUMENT,
    );
    expect(state.exposure).toBe('not-shown');
  });

  it('a later accepted review names the marked attempt in its chain, or is simply later', () => {
    expect(
      classifyLoggedFeedbackExposure(
        history([
          marker('m1', 'at-1'),
          review({
            attemptId: 'at-2',
            followsAttemptId: 'at-1',
            timestamp: '2026-10-05T10:05:00-04:00',
          }),
        ]),
        INSTRUMENT,
      ).exposure,
    ).toBe('not-shown');
    // A review written before reviews carried their own attempt id, later than the marker.
    expect(
      classifyLoggedFeedbackExposure(history([marker('m1', 'at-1'), review()]), INSTRUMENT)
        .exposure,
    ).toBe('not-shown');
  });

  it('a marker written after that acceptance opens a new exchange', () => {
    const state = classifyLoggedFeedbackExposure(
      history([
        marker('m1', 'at-1', '2026-10-05T10:15:00-04:00'),
        review({ attemptId: 'at-1', timestamp: '2026-10-05T10:20:00-04:00' }),
        marker('m2', 'at-5', '2026-10-06T09:00:00-04:00'),
      ]),
      INSTRUMENT,
    );
    expect(state).toEqual({ exposure: 'shown', lastAttemptId: 'at-5' });
  });
});

describe('writing the marker twice is harmless ([D-460])', () => {
  it('two writes for one attempt read exactly as one: the exposure and the attempt a revision follows', async () => {
    const once = memoryVault();
    await sessionOneShowsFeedback(once, INSTRUMENT, 'at-1');
    const twice = memoryVault();
    await sessionOneShowsFeedback(twice, INSTRUMENT, 'at-1');
    await sessionOneShowsFeedback(twice, INSTRUMENT, 'at-1');

    const lines = (twice.contentOf(reviewLogPath(DAY, 'device-a')) ?? '').split('\n');
    expect(lines.filter(Boolean)).toHaveLength(2);
    const fromOnce = await sessionTwoFirstSeal(once, INSTRUMENT);
    expect(fromOnce.prior).toEqual({ exposure: 'shown', lastAttemptId: 'at-1' });
    expect(await sessionTwoFirstSeal(twice, INSTRUMENT)).toEqual(fromOnce);
  });

  it('a duplicate of a marker whose exchange ended stays ended', () => {
    const state = classifyLoggedFeedbackExposure(
      history([marker('m1', 'at-1'), marker('m1-again', 'at-1'), review({ attemptId: 'at-1' })]),
      INSTRUMENT,
    );
    expect(state.exposure).toBe('not-shown');
  });
});

describe('a marker line cut short reads as exposure uncertain, never as not shown ([D-460])', () => {
  const full = JSON.stringify(marker('m1', 'at-1'));
  const cutShort = full.slice(0, full.indexOf('"attemptId"'));

  it('the cut-short line names the question and does not parse', () => {
    expect(cutShort).toContain(INSTRUMENT);
    expect(() => JSON.parse(cutShort)).toThrow();
  });

  it('a later session reads unknown: no rung, so no independent credit, and not guided', async () => {
    const vault = memoryVault({ [reviewLogPath(DAY, 'device-a')]: `${cutShort}\n` });

    const { prior, sealed } = await sessionTwoFirstSeal(vault, INSTRUMENT);

    expect(prior.exposure).toBe('unknown');
    expect(sealed.feedbackExposure).toBe('unknown');
    expect(sealed.supportLevelShown).toBeUndefined();
  });

  it('an accepted review after the cut-short line ended that exchange', () => {
    const state = classifyLoggedFeedbackExposure(
      history([review({ timestamp: '2026-10-05T10:30:00-04:00' })], [cutShort]),
      INSTRUMENT,
    );
    expect(state.exposure).toBe('not-shown');
  });
});

describe('an old log with no marker reads exactly as it did before the marker existed ([D-460])', () => {
  it('a graded set-aside still reads shown, from the set-aside alone', async () => {
    const vault = memoryVault();
    await sessionOneSetsAside(vault, INSTRUMENT, 'at-1');

    const { prior } = await sessionTwoFirstSeal(vault, INSTRUMENT);

    expect(prior).toEqual({ exposure: 'shown', lastAttemptId: 'at-1' });
  });

  it('a question with no records, or whose exchange ended in acceptance, reads not shown, never unknown', () => {
    expect(classifyLoggedFeedbackExposure(history([]), INSTRUMENT)).toEqual({
      exposure: 'not-shown',
      lastAttemptId: null,
    });
    // An accepted first attempt, written before the marker existed: no marker, no set-aside.
    expect(
      classifyLoggedFeedbackExposure(
        history([review({ supportLevelShown: 'independent' })]),
        INSTRUMENT,
      ),
    ).toEqual({ exposure: 'not-shown', lastAttemptId: null });
  });
});
