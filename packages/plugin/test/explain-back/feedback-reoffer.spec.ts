/**
 * `[D-459]` (`ol-egov.141.89.6.78`): accepting feedback and immediately
 * reopening the same question continues the original exchange, so the reopened
 * attempt stays assisted; a genuinely later practice encounter (a later
 * session, which reads her log) is a fresh attempt that earns only the credit
 * its own assistance and performance evidence support.
 *
 * Composed in the order the view runs it (`resolveInstrumentPrompt` awaits
 * `resolvePriorAttemptState`, `submitAnswer` seals with `sealAttemptSupport`,
 * an accepted attempt settles the note), because `modal.ts` imports `obsidian`
 * and cannot load here. `feedback-exposure.spec.ts` pins the source shape of
 * the settle call. Structural placeholders only (INV-3).
 */

import type { ReviewLogEntry } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_ATTEMPT_SEQUENCE,
  sealAttemptSupport,
} from '../../src/explain-back/attempt-sequence.js';
import {
  classifyLoggedFeedbackExposure,
  createFeedbackExposureLedger,
  NO_PRIOR_ATTEMPT,
  resolvePriorAttemptState,
} from '../../src/explain-back/feedback-exposure.js';

const INSTRUMENT = 'explain-back:concept-a';
const OTHER_INSTRUMENT = 'explain-back:concept-b';
const UNAIDED = { hintOffered: false, sourceShownWhileAnswering: false } as const;
const SOURCE_OPEN = { hintOffered: false, sourceShownWhileAnswering: true } as const;

/** What a log read gives once the question was accepted: nothing open, so not shown. */
const logAfterAcceptance = async () => NO_PRIOR_ATTEMPT;

async function reopen(
  ledger: ReturnType<typeof createFeedbackExposureLedger>,
  instrumentId: string,
  shown: typeof UNAIDED | typeof SOURCE_OPEN = UNAIDED,
) {
  const prior = await resolvePriorAttemptState({
    instrumentId,
    ledger,
    readLogged: logAfterAcceptance,
  });
  return sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, shown, prior);
}

/** The view's own two moments: feedback shown, then an attempt accepted. */
function readFeedbackThenAccept(ledger: ReturnType<typeof createFeedbackExposureLedger>): void {
  ledger.noteShown(INSTRUMENT, 'at-1');
  ledger.settle(INSTRUMENT);
}

describe('accepting the feedback and immediately reopening stays assisted ([D-459])', () => {
  it('the same session reopening the accepted question seals guided, not independent', async () => {
    const ledger = createFeedbackExposureLedger();
    readFeedbackThenAccept(ledger);
    const sealed = await reopen(ledger, INSTRUMENT);
    expect(sealed.supportLevelShown).toBe('guided');
    expect(sealed.feedbackExposure).toBe('shown');
  });

  it('it follows no attempt, because the accepted attempt is a review and never a set-aside', async () => {
    const ledger = createFeedbackExposureLedger();
    readFeedbackThenAccept(ledger);
    expect((await reopen(ledger, INSTRUMENT)).followsAttemptId).toBeNull();
  });

  it('reopening again and again in the same session stays assisted', async () => {
    const ledger = createFeedbackExposureLedger();
    readFeedbackThenAccept(ledger);
    await reopen(ledger, INSTRUMENT);
    expect((await reopen(ledger, INSTRUMENT)).supportLevelShown).toBe('guided');
  });

  it('the continued exchange needs no log read at all', async () => {
    const ledger = createFeedbackExposureLedger();
    readFeedbackThenAccept(ledger);
    const prior = await resolvePriorAttemptState({
      instrumentId: INSTRUMENT,
      ledger,
      readLogged: async () => {
        throw new Error('the log was not needed');
      },
    });
    expect(prior).toEqual({ exposure: 'shown', lastAttemptId: null });
  });

  it('an acceptance with no feedback shown (a first attempt accepted unaided) continues nothing', async () => {
    const ledger = createFeedbackExposureLedger();
    ledger.settle(INSTRUMENT);
    const sealed = await reopen(ledger, INSTRUMENT);
    expect(sealed.supportLevelShown).toBe('independent');
    expect(sealed.feedbackExposure).toBe('not-shown');
  });

  it('only the question she accepted: another question keeps the answering phase reading', async () => {
    const ledger = createFeedbackExposureLedger();
    readFeedbackThenAccept(ledger);
    const sealed = await reopen(ledger, OTHER_INSTRUMENT);
    expect(sealed.supportLevelShown).toBe('independent');
    expect(sealed.feedbackExposure).toBe('not-shown');
  });

  it('a graded result shown on the reopen is noted again and carries the new attempt', async () => {
    const ledger = createFeedbackExposureLedger();
    readFeedbackThenAccept(ledger);
    ledger.noteShown(INSTRUMENT, 'at-2');
    expect(ledger.shown(INSTRUMENT)).toEqual({ attemptId: 'at-2' });
    expect((await reopen(ledger, INSTRUMENT)).followsAttemptId).toBe('at-2');
  });
});

describe('a genuinely later practice encounter is fresh ([D-459])', () => {
  /** A later session: an empty note, and her log holding the accepted review. */
  function laterSession() {
    return createFeedbackExposureLedger();
  }

  it('a later session whose log leaves nothing open (the accepted exchange ended) reads not shown; the rung is its own', async () => {
    const accepted: ReviewLogEntry[] = [];
    const prior = classifyLoggedFeedbackExposure(
      { entries: accepted, invalidLines: [] },
      INSTRUMENT,
    );
    expect(prior).toEqual(NO_PRIOR_ATTEMPT);
    const sealed = await reopen(laterSession(), INSTRUMENT);
    expect(sealed.supportLevelShown).toBe('independent');
    expect(sealed.followsAttemptId).toBeNull();
  });

  it('the later attempt earns only what its own assistance supports: source open beside her is guided', async () => {
    const sealed = await reopen(laterSession(), INSTRUMENT, SOURCE_OPEN);
    expect(sealed.supportLevelShown).toBe('guided');
    expect(sealed.feedbackExposure).toBe('not-shown');
  });

  it('records no new field: the sealed support is the rung, the link and the exposure fact only', async () => {
    const ledger = createFeedbackExposureLedger();
    readFeedbackThenAccept(ledger);
    expect(Object.keys(await reopen(ledger, INSTRUMENT)).sort()).toEqual([
      'feedbackExposure',
      'followsAttemptId',
      'supportLevelShown',
    ]);
  });
});
