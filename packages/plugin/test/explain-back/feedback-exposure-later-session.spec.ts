/**
 * Row 50 of the 2026-09-29 decision sheet (`ol-egov.141.89.6.72`, the wiring
 * follow-up of `ol-egov.141.89.6.69`): a revision in a LATER session reads the
 * exposure from her log.
 *
 * The session note (`feedbackExposureLedger`) is the only source that is live
 * inside one plugin session. Across a restart it is empty, so the fact has to
 * come from the log, through the `readLoggedAttemptState` dep `main.ts` now
 * passes to `ExplainBackModal`. `main.ts` and `modal.ts` cannot load under
 * Vitest (they import `obsidian`), so this suite composes the very same pieces
 * in the order the view does: the session-one writer (`createRecordSetAsideAttempt`,
 * the `recordSetAsideAttempt` dep), a fresh session-two note, the log reader
 * (`createReadLoggedAttemptState`, the `readLoggedAttemptState` dep) over the
 * SAME vault, `resolvePriorAttemptState` (what `resolveInstrumentPrompt` awaits
 * before the answering phase appears) and `sealAttemptSupport` (what
 * `submitAnswer` seals with). `test/main-wiring.spec.ts` pins that `main.ts`
 * passes the reader, over the same vault source as the writer.
 *
 * Structural placeholders throughout (INV-3): no real ids, no answer text.
 */

import { reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  appendSetAsideAttempt,
  EMPTY_ATTEMPT_SEQUENCE,
  sealAttemptSupport,
} from '../../src/explain-back/attempt-sequence.js';
import {
  createFeedbackExposureLedger,
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
const SESSION_ONE = new Date('2026-09-28T14:15:00Z');

/** Session one: she reads a graded result and chooses Try again, so the view writes the set-aside record. */
async function sessionOneSetsAside(
  vault: ReturnType<typeof memoryVault>,
  instrumentId: string,
  attemptId: string,
  outcome: 'graded' | 'unable-to-assess',
): Promise<void> {
  const attempt = appendSetAsideAttempt(EMPTY_ATTEMPT_SEQUENCE, {
    attemptId,
    outcome:
      outcome === 'graded' ? { kind: 'graded', verdict: 'partial' } : { kind: 'unable-to-assess' },
    support: sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED),
  })[0];
  if (attempt === undefined) throw new Error('expected one attempt');
  const input = setAsideRecordInput({
    instrumentId,
    subjectConceptId: 'concept-a',
    attempt,
    pending: {
      status: 'pending-review',
      grading:
        outcome === 'graded'
          ? { outcome: 'graded', verdict: 'partial' }
          : { outcome: 'unable-to-assess' },
      overlap: {},
    } as never,
    durationMs: 1000,
    at: SESSION_ONE,
  });
  if (input === null) throw new Error('expected an input');
  await createRecordSetAsideAttempt({ vault, deviceId: async () => 'device-a' })(input);
}

/** Session two: a brand-new note (the plugin restarted), the reader wired as main.ts wires it. */
async function sessionTwoFirstSeal(
  vault: ReturnType<typeof memoryVault>,
  instrumentId: string,
  wired: boolean,
) {
  const prior = await resolvePriorAttemptState({
    instrumentId,
    ledger: createFeedbackExposureLedger(),
    readLogged: wired ? createReadLoggedAttemptState({ vault }) : undefined,
  });
  return { prior, sealed: sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED, prior) };
}

describe('a revision in a later session reads the exposure from her log (row 50, ol-egov.141.89.6.72)', () => {
  it('a graded set-aside written in an earlier session seals the first attempt guided, and follows it', async () => {
    const vault = memoryVault();
    await sessionOneSetsAside(vault, INSTRUMENT, 'at-1', 'graded');

    const { prior, sealed } = await sessionTwoFirstSeal(vault, INSTRUMENT, true);

    expect(prior).toEqual({ exposure: 'shown', lastAttemptId: 'at-1' });
    expect(sealed).toEqual({
      supportLevelShown: 'guided',
      followsAttemptId: 'at-1',
      feedbackExposure: 'shown',
    });
  });

  it('the same later session with no reader wired seals independent: the wiring is what closes the gap', async () => {
    const vault = memoryVault();
    await sessionOneSetsAside(vault, INSTRUMENT, 'at-1', 'graded');

    const { prior, sealed } = await sessionTwoFirstSeal(vault, INSTRUMENT, false);

    expect(prior.exposure).toBe('not-shown');
    expect(sealed.supportLevelShown).toBe('independent');
    expect(sealed.followsAttemptId).toBeNull();
  });

  it('another question in the same log is not a revision: its first attempt keeps the answering phase reading', async () => {
    const vault = memoryVault();
    await sessionOneSetsAside(vault, INSTRUMENT, 'at-1', 'graded');

    const { prior, sealed } = await sessionTwoFirstSeal(vault, OTHER_INSTRUMENT, true);

    expect(prior.exposure).toBe('not-shown');
    expect(sealed.supportLevelShown).toBe('independent');
    expect(sealed.followsAttemptId).toBeNull();
  });

  it('an attempt the check could not assess showed her no feedback, so the revision is not guided', async () => {
    const vault = memoryVault();
    await sessionOneSetsAside(vault, INSTRUMENT, 'at-1', 'unable-to-assess');

    const { prior, sealed } = await sessionTwoFirstSeal(vault, INSTRUMENT, true);

    expect(prior.exposure).toBe('not-shown');
    expect(sealed.supportLevelShown).toBe('independent');
    // The unfinished exchange is still linked, so the retry chain stays whole.
    expect(sealed.followsAttemptId).toBe('at-1');
  });

  it('a log that cannot be read in the later session withholds independent credit and asserts no assistance', async () => {
    const good = memoryVault({ [reviewLogPath('2026-09-28', 'device-a')]: '' });
    const broken = {
      ...good,
      list: good.list.bind(good),
      exists: async () => true,
      read: async () => {
        throw new Error('read failed');
      },
    } as unknown as typeof good;
    // The reader rejects, and the view reads a rejection as unknown.
    const { prior, sealed } = await sessionTwoFirstSeal(broken, INSTRUMENT, true);

    expect(prior).toEqual({ exposure: 'unknown', lastAttemptId: null });
    expect(sealed.feedbackExposure).toBe('unknown');
    expect(sealed.supportLevelShown).toBeUndefined();
  });
});
