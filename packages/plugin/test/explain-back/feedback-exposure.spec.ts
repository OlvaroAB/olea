/**
 * Row 50 of the 2026-09-29 decision sheet (`ol-egov.141.89.6.69`), on top of
 * `[D-416]` and `[D-318]`: whether she was shown the feedback for a question
 * is a recorded fact (shown, not shown or unknown), and an attempt whose
 * exposure is unconfirmed earns no independent-performance credit.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "F5.9
 * (continued) / row 50". The rule lives in the pure `feedback-exposure.ts`
 * and `attempt-sequence.ts`, and the log reader in `set-aside-record.ts`, all
 * tested here directly; `modal.ts` extends Obsidian's `Modal` and cannot load
 * under Vitest, so its wiring is asserted against its source with comments
 * stripped (the same instrument as `modal-answer-after-feedback.spec.ts`).
 *
 * Structural placeholders throughout (INV-3): no real ids, no answer text.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { computeConceptMastery } from '../../../core/src/mastery/rollup.js';
import {
  appendSetAsideAttempt,
  EMPTY_ATTEMPT_SEQUENCE,
  type ExplainBackAttemptSequence,
  feedbackExposureAt,
  sealAttemptSupport,
} from '../../src/explain-back/attempt-sequence.js';
import {
  classifyLoggedFeedbackExposure,
  createFeedbackExposureLedger,
  NO_PRIOR_ATTEMPT,
  type PriorAttemptState,
  resolvePriorAttemptState,
  supportLevelForExposure,
} from '../../src/explain-back/feedback-exposure.js';
import {
  createReadLoggedAttemptState,
  createRecordSetAsideAttempt,
  setAsideRecordInput,
} from '../../src/explain-back/set-aside-record.js';
import { memoryVault } from '../review/memory-vault.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}
const modal = codeOf('explain-back/modal.ts');

const UNAIDED = { hintOffered: false, sourceShownWhileAnswering: false } as const;
const INSTRUMENT = 'explain-back:concept-a';
const OTHER_INSTRUMENT = 'explain-back:concept-b';

// ---------------------------------------------------------------------------
// Log fixtures
// ---------------------------------------------------------------------------

function setAsideEntry(
  attemptId: string,
  outcome: 'graded' | 'unable-to-assess',
  overrides: Record<string, unknown> = {},
): ReviewLogEntry {
  return {
    schemaVersion: 6,
    kind: 'explain-back-set-aside',
    eventId: `evt-${attemptId}`,
    timestamp: '2026-09-28T10:00:00-04:00',
    instrumentId: INSTRUMENT,
    conceptIds: ['concept-a'],
    attemptId,
    outcome:
      outcome === 'graded' ? { kind: 'graded', verdict: 'partial' } : { kind: 'unable-to-assess' },
    acceptance: 'not-accepted',
    durationMs: 1000,
    ...overrides,
  } as ReviewLogEntry;
}

function reviewEntry(attemptId: string, overrides: Partial<ReviewLogRecord> = {}): ReviewLogEntry {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: `evt-${attemptId}`,
    timestamp: '2026-09-28T11:00:00-04:00',
    instrumentId: INSTRUMENT,
    instrumentType: 'explain-back',
    conceptIds: ['concept-a'],
    rating: null,
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    ...overrides,
  } as ReviewLogEntry;
}

function history(entries: readonly ReviewLogEntry[], invalidRaw: readonly string[] = []) {
  return {
    entries,
    invalidLines: invalidRaw.map((raw) => ({ line: { raw } })),
  };
}

function setAside(
  sequence: ExplainBackAttemptSequence,
  attemptId: string,
  outcome: 'correct' | 'partial' | 'incorrect' | 'unable-to-assess',
  prior: PriorAttemptState = NO_PRIOR_ATTEMPT,
): ExplainBackAttemptSequence {
  return appendSetAsideAttempt(sequence, {
    attemptId,
    outcome:
      outcome === 'unable-to-assess'
        ? { kind: 'unable-to-assess' }
        : { kind: 'graded', verdict: outcome },
    support: sealAttemptSupport(sequence, UNAIDED, prior),
  });
}

// ---------------------------------------------------------------------------
// The credit rule
// ---------------------------------------------------------------------------

describe('exposure is one of three facts, and only shown asserts assistance', () => {
  it('shown records guided, whatever the answering phase itself showed', () => {
    for (const own of ['independent', 'prompted', 'guided', undefined] as const) {
      expect(supportLevelForExposure('shown', own)).toBe('guided');
    }
  });

  it('not shown leaves the answering phase own reading untouched, unknown included', () => {
    for (const own of ['independent', 'prompted', 'guided', undefined] as const) {
      expect(supportLevelForExposure('not-shown', own)).toBe(own);
    }
  });

  it('unknown records no rung, so independent credit is withheld without asserting assistance', () => {
    expect(supportLevelForExposure('unknown', 'independent')).toBeUndefined();
    expect(supportLevelForExposure('unknown', 'prompted')).toBeUndefined();
    expect(supportLevelForExposure('unknown', undefined)).toBeUndefined();
  });

  it('unknown never turns into guided by itself, but keeps a guided rung the answering phase itself confirmed', () => {
    expect(supportLevelForExposure('unknown', 'guided')).toBe('guided');
  });

  it('a first attempt with no prior state is sealed at the answering phase own reading, as before', () => {
    expect(sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED)).toEqual({
      supportLevelShown: 'independent',
      followsAttemptId: null,
      feedbackExposure: 'not-shown',
    });
    expect(sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, null).supportLevelShown).toBeUndefined();
  });

  it('a first attempt in a view whose question already showed her feedback is sealed guided and follows that attempt', () => {
    const prior: PriorAttemptState = { exposure: 'shown', lastAttemptId: 'at-earlier' };
    expect(sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED, prior)).toEqual({
      supportLevelShown: 'guided',
      followsAttemptId: 'at-earlier',
      feedbackExposure: 'shown',
    });
    // Known even when the answering phase's own presentation is not.
    expect(sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, null, prior).supportLevelShown).toBe(
      'guided',
    );
  });

  it('a first attempt whose exposure is unknown records no rung and is never guided', () => {
    const prior: PriorAttemptState = { exposure: 'unknown', lastAttemptId: null };
    const sealed = sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED, prior);
    expect(sealed.supportLevelShown).toBeUndefined();
    expect(sealed.feedbackExposure).toBe('unknown');
    expect(sealed.followsAttemptId).toBeNull();
  });

  it('a graded attempt set aside in this view confirms the exposure, even where the earlier state was unknown', () => {
    const prior: PriorAttemptState = { exposure: 'unknown', lastAttemptId: null };
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial', prior);
    // The first attempt in the sequence was itself sealed at unknown: no rung.
    expect(sequence[0]?.supportLevelShown).toBeUndefined();
    expect(sequence[0]?.feedbackExposure).toBe('unknown');
    // The next one follows a graded result she read in this view: confirmed, guided.
    const next = sealAttemptSupport(sequence, UNAIDED, prior);
    expect(next.feedbackExposure).toBe('shown');
    expect(next.supportLevelShown).toBe('guided');
    expect(next.followsAttemptId).toBe('at-1');
  });

  it('a set-aside attempt the check could not assess shows no feedback: unknown stays unknown, not-shown stays not-shown', () => {
    const notShown = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'unable-to-assess');
    expect(feedbackExposureAt(notShown, 'not-shown')).toBe('not-shown');
    expect(sealAttemptSupport(notShown, UNAIDED).supportLevelShown).toBe('independent');
    expect(feedbackExposureAt(notShown, 'unknown')).toBe('unknown');
  });

  it('every entry in the sequence keeps the exposure it was sealed at, in order', () => {
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'incorrect');
    sequence = setAside(sequence, 'at-2', 'partial');
    expect(sequence.map((entry) => entry.feedbackExposure)).toEqual(['not-shown', 'shown']);
  });

  it('the rung on the set-aside record is guided for shown and absent for unknown, never a new field', () => {
    const shown = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial', {
      exposure: 'shown',
      lastAttemptId: 'at-0',
    });
    const unknown = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-2', 'partial', {
      exposure: 'unknown',
      lastAttemptId: null,
    });
    const at = new Date('2026-09-28T14:15:00Z');
    const pending = {
      status: 'pending-review',
      grading: { outcome: 'graded', verdict: 'partial' },
      overlap: {},
    } as never;
    const shownInput = setAsideRecordInput({
      instrumentId: INSTRUMENT,
      subjectConceptId: 'concept-a',
      attempt: shown[0] as never,
      pending,
      durationMs: 1,
      at,
    });
    const unknownInput = setAsideRecordInput({
      instrumentId: INSTRUMENT,
      subjectConceptId: 'concept-a',
      attempt: unknown[0] as never,
      pending,
      durationMs: 1,
      at,
    });
    expect(shownInput?.supportLevelShown).toBe('guided');
    expect(shownInput?.followsAttemptId).toBe('at-0');
    expect(unknownInput).not.toHaveProperty('supportLevelShown');
    // No exposure key reaches her log: the record shape is unchanged.
    expect(JSON.stringify(shownInput)).not.toMatch(/exposure/i);
    expect(JSON.stringify(unknownInput)).not.toMatch(/exposure/i);
  });
});

// ---------------------------------------------------------------------------
// Reading exposure from her log
// ---------------------------------------------------------------------------

describe('a revision in a later session is guided when her log holds a graded attempt she set aside', () => {
  it('an open graded set-aside makes the exposure shown, and names that attempt as the one to follow', () => {
    expect(
      classifyLoggedFeedbackExposure(history([setAsideEntry('at-1', 'graded')]), INSTRUMENT),
    ).toEqual({
      exposure: 'shown',
      lastAttemptId: 'at-1',
    });
  });

  it('an empty log is not shown, and there is nothing to follow', () => {
    expect(classifyLoggedFeedbackExposure(history([]), INSTRUMENT)).toEqual(NO_PRIOR_ATTEMPT);
  });

  it('a set-aside of another question is not this question', () => {
    const other = setAsideEntry('at-9', 'graded', { instrumentId: OTHER_INSTRUMENT });
    expect(classifyLoggedFeedbackExposure(history([other]), INSTRUMENT)).toEqual(NO_PRIOR_ATTEMPT);
  });

  it('attempts the check could not assess showed her no feedback: not shown, though the last one is still the attempt to follow', () => {
    const entries = [setAsideEntry('at-1', 'unable-to-assess')];
    expect(classifyLoggedFeedbackExposure(history(entries), INSTRUMENT)).toEqual({
      exposure: 'not-shown',
      lastAttemptId: 'at-1',
    });
  });

  it('an earlier graded attempt still counts when a later one in the same open chain came back unassessable', () => {
    const entries = [
      setAsideEntry('at-1', 'graded', { timestamp: '2026-09-28T10:00:00-04:00' }),
      setAsideEntry('at-2', 'unable-to-assess', {
        timestamp: '2026-09-28T10:05:00-04:00',
        followsAttemptId: 'at-1',
      }),
    ];
    expect(classifyLoggedFeedbackExposure(history(entries), INSTRUMENT)).toEqual({
      exposure: 'shown',
      lastAttemptId: 'at-2',
    });
  });
});

describe('an exchange that ended in acceptance does not make a later offer a revision', () => {
  it('an accepted review that names the last set-aside attempt closes the exchange, whatever came before it', () => {
    const entries = [
      setAsideEntry('at-1', 'graded'),
      setAsideEntry('at-2', 'graded', {
        timestamp: '2026-09-28T10:05:00-04:00',
        followsAttemptId: 'at-1',
      }),
      reviewEntry('at-3', { followsAttemptId: 'at-2' }),
    ];
    expect(classifyLoggedFeedbackExposure(history(entries), INSTRUMENT)).toEqual(NO_PRIOR_ATTEMPT);
  });

  it('an accepted review later in time closes it too, even one written before retries were linked across views', () => {
    const entries = [setAsideEntry('at-1', 'graded'), reviewEntry('at-2')];
    expect(classifyLoggedFeedbackExposure(history(entries), INSTRUMENT)).toEqual(NO_PRIOR_ATTEMPT);
  });

  it('a set-aside written after the accepted review opens a new exchange', () => {
    const entries = [
      setAsideEntry('at-1', 'graded'),
      reviewEntry('at-2', { followsAttemptId: 'at-1' }),
      setAsideEntry('at-3', 'graded', { timestamp: '2026-09-28T12:00:00-04:00' }),
    ];
    expect(classifyLoggedFeedbackExposure(history(entries), INSTRUMENT)).toEqual({
      exposure: 'shown',
      lastAttemptId: 'at-3',
    });
  });

  it('a review of another question closes nothing here', () => {
    const entries = [
      setAsideEntry('at-1', 'graded'),
      reviewEntry('at-2', { instrumentId: OTHER_INSTRUMENT }),
    ];
    expect(classifyLoggedFeedbackExposure(history(entries), INSTRUMENT).exposure).toBe('shown');
  });

  it('a link that names an attempt whose record was lost is not an open exchange and not unknown', () => {
    const entries = [reviewEntry('at-2', { followsAttemptId: 'at-lost' })];
    expect(classifyLoggedFeedbackExposure(history(entries), INSTRUMENT)).toEqual(NO_PRIOR_ATTEMPT);
  });
});

describe('exposure that cannot be confirmed is unknown', () => {
  it('an unparseable line that names the question makes it unknown', () => {
    const truncated = `{"schemaVersion":6,"kind":"explain-back-set-aside","eventId":"e1","instrumentId":"${INSTRUMENT}","conce`;
    expect(classifyLoggedFeedbackExposure(history([], [truncated]), INSTRUMENT)).toEqual({
      exposure: 'unknown',
      lastAttemptId: null,
    });
  });

  it('an unparseable line that names another question does not', () => {
    const truncated = `{"schemaVersion":6,"instrumentId":"${OTHER_INSTRUMENT}","conce`;
    expect(classifyLoggedFeedbackExposure(history([], [truncated]), INSTRUMENT)).toEqual(
      NO_PRIOR_ATTEMPT,
    );
  });

  it('an unparseable line older than an accepted review of the question no longer matters: that exchange ended', () => {
    const truncated = `{"schemaVersion":6,"timestamp":"2026-09-01T09:00:00-04:00","instrumentId":"${INSTRUMENT}","conce`;
    const entries = [reviewEntry('at-2')];
    expect(classifyLoggedFeedbackExposure(history(entries, [truncated]), INSTRUMENT)).toEqual(
      NO_PRIOR_ATTEMPT,
    );
  });

  it('an unparseable line with no readable timestamp is kept as unknown, conservatively', () => {
    const truncated = `{"schemaVersion":6,"instrumentId":"${INSTRUMENT}","conce`;
    const entries = [reviewEntry('at-2')];
    expect(classifyLoggedFeedbackExposure(history(entries, [truncated]), INSTRUMENT).exposure).toBe(
      'unknown',
    );
  });

  it('a readable graded attempt outranks an unreadable line: the confirmed fact wins', () => {
    const truncated = `{"instrumentId":"${INSTRUMENT}","conce`;
    expect(
      classifyLoggedFeedbackExposure(
        history([setAsideEntry('at-1', 'graded')], [truncated]),
        INSTRUMENT,
      ),
    ).toEqual({ exposure: 'shown', lastAttemptId: 'at-1' });
  });

  it('a log that cannot be read at all makes it unknown, never not shown and never guided', async () => {
    const state = await resolvePriorAttemptState({
      instrumentId: INSTRUMENT,
      ledger: createFeedbackExposureLedger(),
      readLogged: async () => {
        throw new Error('the vault refused the read');
      },
    });
    expect(state).toEqual({ exposure: 'unknown', lastAttemptId: null });
    expect(supportLevelForExposure(state.exposure, 'independent')).toBeUndefined();
  });

  it('no reader wired reads as no prior state, so a caller that does not wire one is unchanged', async () => {
    expect(
      await resolvePriorAttemptState({
        instrumentId: INSTRUMENT,
        ledger: createFeedbackExposureLedger(),
      }),
    ).toEqual(NO_PRIOR_ATTEMPT);
  });
});

// ---------------------------------------------------------------------------
// The session note: re-opened view, lost write
// ---------------------------------------------------------------------------

describe('the view remembers a shown graded result for the session, whether or not anything was written', () => {
  it('a view re-opened after she read the feedback and closed it without choosing seals guided', async () => {
    const ledger = createFeedbackExposureLedger();
    ledger.noteShown(INSTRUMENT, 'at-1');
    const state = await resolvePriorAttemptState({
      instrumentId: INSTRUMENT,
      ledger,
      // The log holds nothing: she never chose Try again, so no record was ever written.
      readLogged: async () => NO_PRIOR_ATTEMPT,
    });
    expect(state).toEqual({ exposure: 'shown', lastAttemptId: 'at-1' });
    expect(sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED, state).supportLevelShown).toBe(
      'guided',
    );
  });

  it('a lost set-aside write leaves the session note in place, so the next view is still guided', async () => {
    const ledger = createFeedbackExposureLedger();
    ledger.noteShown(INSTRUMENT, 'at-1');
    let reads = 0;
    const state = await resolvePriorAttemptState({
      instrumentId: INSTRUMENT,
      ledger,
      readLogged: async () => {
        reads += 1;
        throw new Error('the write and the read both failed');
      },
    });
    expect(state.exposure).toBe('shown');
    // The confirmed session fact needs no log read at all.
    expect(reads).toBe(0);
  });

  it('the latest shown attempt is the one to follow', () => {
    const ledger = createFeedbackExposureLedger();
    ledger.noteShown(INSTRUMENT, 'at-1');
    ledger.noteShown(INSTRUMENT, 'at-2');
    expect(ledger.shown(INSTRUMENT)).toEqual({ attemptId: 'at-2' });
  });

  it('accepting an attempt ends the exchange, so the note is cleared and a later offer is not a revision', async () => {
    const ledger = createFeedbackExposureLedger();
    ledger.noteShown(INSTRUMENT, 'at-1');
    ledger.settle(INSTRUMENT);
    expect(ledger.shown(INSTRUMENT)).toBeUndefined();
    expect(
      await resolvePriorAttemptState({
        instrumentId: INSTRUMENT,
        ledger,
        readLogged: async () => NO_PRIOR_ATTEMPT,
      }),
    ).toEqual(NO_PRIOR_ATTEMPT);
  });

  it('the note is bounded: past its capacity the oldest question is dropped and the newest kept', () => {
    const ledger = createFeedbackExposureLedger(2);
    ledger.noteShown('q-1', 'at-1');
    ledger.noteShown('q-2', 'at-2');
    ledger.noteShown('q-3', 'at-3');
    expect(ledger.shown('q-1')).toBeUndefined();
    expect(ledger.shown('q-2')).toEqual({ attemptId: 'at-2' });
    expect(ledger.shown('q-3')).toEqual({ attemptId: 'at-3' });
  });

  it('the note is per question and holds ids only, never her answer or the feedback (D-005)', () => {
    const ledger = createFeedbackExposureLedger();
    ledger.noteShown(INSTRUMENT, 'at-1');
    expect(ledger.shown(OTHER_INSTRUMENT)).toBeUndefined();
    expect(JSON.stringify(ledger.shown(INSTRUMENT))).toBe('{"attemptId":"at-1"}');
  });
});

// ---------------------------------------------------------------------------
// The reader against a real log
// ---------------------------------------------------------------------------

describe('the log reader (createReadLoggedAttemptState) reads what the writer wrote', () => {
  const AT = new Date('2026-09-28T14:15:00Z');

  async function writeSetAside(
    vault: ReturnType<typeof memoryVault>,
    attemptId: string,
    outcome: 'partial' | 'unable-to-assess',
    instrumentId = INSTRUMENT,
  ) {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, attemptId, outcome);
    const attempt = sequence[0];
    if (attempt === undefined) throw new Error('empty');
    const input = setAsideRecordInput({
      instrumentId,
      subjectConceptId: 'concept-a',
      attempt,
      pending: {
        status: 'pending-review',
        grading:
          outcome === 'unable-to-assess'
            ? { outcome: 'unable-to-assess' }
            : { outcome: 'graded', verdict: outcome },
        overlap: {},
      } as never,
      durationMs: 1000,
      at: AT,
    });
    if (input === null) throw new Error('expected an input');
    await createRecordSetAsideAttempt({ vault, deviceId: async () => 'device-a' })(input);
  }

  it('a graded set-aside written by Try again reads back as shown, naming that attempt', async () => {
    const vault = memoryVault();
    await writeSetAside(vault, 'at-1', 'partial');
    const read = createReadLoggedAttemptState({ vault });
    expect(await read(INSTRUMENT)).toEqual({ exposure: 'shown', lastAttemptId: 'at-1' });
    expect(await read(OTHER_INSTRUMENT)).toEqual(NO_PRIOR_ATTEMPT);
  });

  it('an unassessable set-aside reads back as not shown', async () => {
    const vault = memoryVault();
    await writeSetAside(vault, 'at-1', 'unable-to-assess');
    expect((await createReadLoggedAttemptState({ vault })(INSTRUMENT)).exposure).toBe('not-shown');
  });

  it('an empty vault reads as not shown', async () => {
    expect(await createReadLoggedAttemptState({ vault: memoryVault() })(INSTRUMENT)).toEqual(
      NO_PRIOR_ATTEMPT,
    );
  });

  it('a truncated last line that names the question reads as unknown', async () => {
    const path = reviewLogPath('2026-09-28', 'device-a');
    const vault = memoryVault({
      [path]: `{"schemaVersion":6,"kind":"explain-back-set-aside","instrumentId":"${INSTRUMENT}","conc`,
    });
    expect(await createReadLoggedAttemptState({ vault })(INSTRUMENT)).toEqual({
      exposure: 'unknown',
      lastAttemptId: null,
    });
  });

  it('a vault whose read fails rejects, which the caller reads as unknown', async () => {
    const path = reviewLogPath('2026-09-28', 'device-a');
    const good = memoryVault({ [path]: '' });
    const broken = {
      ...good,
      list: good.list.bind(good),
      exists: async () => true,
      read: async () => {
        throw new Error('read failed');
      },
    } as unknown as typeof good;
    await expect(createReadLoggedAttemptState({ vault: broken })(INSTRUMENT)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Never lowers an earned label
// ---------------------------------------------------------------------------

describe('a revision recorded guided or with no rung never lowers a growth label already earned', () => {
  function earnedTopStage(overrides: Partial<ReviewLogRecord> = {}): ReviewLogEntry {
    return reviewEntry('at-earned', {
      eventId: 'evt-earned',
      timestamp: '2026-09-20T09:00:00-04:00',
      instrumentId: 'explain-back:concept-a',
      supportLevelShown: 'independent',
      explainBackGrade: {
        soloLevel: 'relational',
        correctness: 'correct',
        contentRef: 'content-ref-placeholder',
        revisionOf: null,
        artifactProvenance: { taskId: 'explain-back-grade', promptVersion: 'v0', modelId: 'm' },
      },
      ...overrides,
    } as Partial<ReviewLogRecord>);
  }

  function revision(sealedRung: 'guided' | undefined): ReviewLogEntry {
    const base = earnedTopStage({
      eventId: 'evt-revision',
      timestamp: '2026-09-28T09:00:00-04:00',
      followsAttemptId: 'at-earlier',
    });
    const { supportLevelShown: _dropped, ...rest } = base as ReviewLogRecord;
    return (
      sealedRung === undefined ? rest : { ...rest, supportLevelShown: sealedRung }
    ) as ReviewLogEntry;
  }

  it('the earned attempt alone reaches the top stage', () => {
    expect(computeConceptMastery([earnedTopStage()], 'concept-a').state).toBe('tree');
  });

  it('a later guided revision leaves the stage where it was', () => {
    expect(computeConceptMastery([earnedTopStage(), revision('guided')], 'concept-a').state).toBe(
      'tree',
    );
  });

  it('a later revision with no rung at all leaves the stage where it was', () => {
    expect(computeConceptMastery([earnedTopStage(), revision(undefined)], 'concept-a').state).toBe(
      'tree',
    );
  });

  it('and a revision that is guided or unknown earns the top stage on its own for nobody', () => {
    expect(computeConceptMastery([revision('guided')], 'concept-a').state).not.toBe('tree');
    expect(computeConceptMastery([revision(undefined)], 'concept-a').state).not.toBe('tree');
  });
});

// ---------------------------------------------------------------------------
// Uncertain exposure never reaches the top stage (no producer needed)
// ---------------------------------------------------------------------------

describe('an attempt whose feedback exposure is uncertain never reaches the top stage, whatever its verdict and depth', () => {
  // `ol-egov.141.89.6.87.15`: production never supplies
  // `feedbackExposureUncertainEventIds` to the fold. It does not need to: the
  // rung is sealed at submit (`sealAttemptSupport`), and unknown exposure seals
  // no rung, which the fold reads as unknown support and never admits.
  const VERDICTS = ['correct', 'partial', 'incorrect'] as const;
  const DEPTHS = [
    'prestructural',
    'unistructural',
    'multistructural',
    'relational',
    'extended-abstract',
  ] as const;
  const UNKNOWN: PriorAttemptState = { exposure: 'unknown', lastAttemptId: null };

  /** The record the view writes: the rung and link exactly as sealed, the fold option left unset. */
  function acceptedAttempt(
    sealed: ReturnType<typeof sealAttemptSupport>,
    verdict: (typeof VERDICTS)[number],
    depth: (typeof DEPTHS)[number],
  ): ReviewLogEntry {
    return reviewEntry('at-sealed', {
      eventId: 'evt-sealed',
      instrumentId: 'explain-back:concept-a',
      ...(sealed.supportLevelShown !== undefined
        ? { supportLevelShown: sealed.supportLevelShown }
        : {}),
      ...(sealed.followsAttemptId !== null ? { followsAttemptId: sealed.followsAttemptId } : {}),
      explainBackGrade: {
        soloLevel: depth,
        correctness: verdict,
        contentRef: 'content-ref-placeholder',
        revisionOf: null,
        artifactProvenance: { taskId: 'explain-back-grade', promptVersion: 'v0', modelId: 'm' },
      },
    } as Partial<ReviewLogRecord>);
  }
  const stageOf = (entry: ReviewLogEntry) => computeConceptMastery([entry], 'concept-a').state;

  const unassessed = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-first', 'unable-to-assess', UNKNOWN);
  const paths: Record<string, ReturnType<typeof sealAttemptSupport>> = {
    'a first attempt, exposure unknown': sealAttemptSupport(
      EMPTY_ATTEMPT_SEQUENCE,
      UNAIDED,
      UNKNOWN,
    ),
    'a retry after an attempt the check could not assess': sealAttemptSupport(
      unassessed,
      UNAIDED,
      UNKNOWN,
    ),
  };

  for (const [name, sealed] of Object.entries(paths)) {
    it(`${name}: no verdict and no depth reaches the top stage`, () => {
      expect(sealed.feedbackExposure).toBe('unknown');
      expect(sealed.supportLevelShown).toBeUndefined();
      for (const verdict of VERDICTS) {
        for (const depth of DEPTHS) {
          expect(stageOf(acceptedAttempt(sealed, verdict, depth)), `${verdict}/${depth}`).not.toBe(
            'tree',
          );
        }
      }
    });
  }

  it('a re-opened view whose log cannot be read seals unknown and reaches no top stage', async () => {
    const prior = await resolvePriorAttemptState({
      instrumentId: INSTRUMENT,
      ledger: createFeedbackExposureLedger(),
      readLogged: async () => {
        throw new Error('read failed');
      },
    });
    expect(prior.exposure).toBe('unknown');
    const sealed = sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED, prior);
    for (const verdict of VERDICTS) {
      for (const depth of DEPTHS) {
        expect(stageOf(acceptedAttempt(sealed, verdict, depth))).not.toBe('tree');
      }
    }
  });

  it('a re-opened view whose log holds an unreadable line naming the question seals unknown and reaches no top stage', () => {
    const prior = classifyLoggedFeedbackExposure(
      history(
        [],
        [`{"instrumentId":"${INSTRUMENT}","timestamp":"2026-09-28T10:00:00-04:00" truncated`],
      ),
      INSTRUMENT,
    );
    expect(prior.exposure).toBe('unknown');
    const sealed = sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED, prior);
    expect(stageOf(acceptedAttempt(sealed, 'correct', 'extended-abstract'))).not.toBe('tree');
  });

  it('positive control: the same attempt with exposure known not shown reaches the top stage when it qualifies', () => {
    const sealed = sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED, NO_PRIOR_ATTEMPT);
    expect(sealed.supportLevelShown).toBe('independent');
    expect(stageOf(acceptedAttempt(sealed, 'correct', 'relational'))).toBe('tree');
    expect(stageOf(acceptedAttempt(sealed, 'partial', 'relational'))).not.toBe('tree');
    expect(stageOf(acceptedAttempt(sealed, 'correct', 'prestructural'))).not.toBe('tree');
  });
});

// ---------------------------------------------------------------------------
// The view's wiring (source-level: modal.ts cannot load under Vitest)
// ---------------------------------------------------------------------------

describe('the view reads the exposure once, when the question is resolved, and seals it at submit', () => {
  it('resolves the prior state for an instrument-seeded question before the answering phase appears', () => {
    const resolve = modal.slice(
      modal.indexOf('private async resolveInstrumentPrompt('),
      modal.indexOf('private async resolveTopicPrompt('),
    );
    expect(resolve).toMatch(
      /this\.priorAttemptState = await resolvePriorAttemptState\(\{[\s\S]*?instrumentId: prompt\.originInstrumentId,[\s\S]*?readLogged: this\.deps\.readLoggedAttemptState,/,
    );
    const awaitAt = resolve.indexOf('this.priorAttemptState = await');
    const answeringAt = resolve.indexOf("this.state = { phase: 'answering'");
    expect(awaitAt).toBeGreaterThan(0);
    expect(answeringAt).toBeGreaterThan(awaitAt);
  });

  it('a freeform topic mints a fresh id every time, so it has no earlier state to read', () => {
    const resolve = modal.slice(
      modal.indexOf('private async resolveTopicPrompt('),
      modal.indexOf('private async submitAnswer(') > 0
        ? modal.indexOf('private async submitAnswer(')
        : undefined,
    );
    expect(resolve).toMatch(/this\.priorAttemptState = NO_PRIOR_ATTEMPT;/);
    expect(resolve).not.toMatch(/readLoggedAttemptState/);
  });

  it('seals every attempt with the prior state at submit, before grading is requested', () => {
    const submit = modal.slice(
      modal.indexOf('private async submitAnswer('),
      modal.indexOf('private acceptGrading('),
    );
    expect(submit).toMatch(
      /const support = sealAttemptSupport\(\s*this\.attemptSequence,\s*EXPLAIN_BACK_ANSWERING_SUPPORT_SHOWN,\s*this\.priorAttemptState,?\s*\);[\s\S]*?runGradingAttempt\(/,
    );
  });

  it('notes a graded result for the session when it is shown, and only a graded one', () => {
    const submit = modal.slice(
      modal.indexOf('private async submitAnswer('),
      modal.indexOf('private acceptGrading('),
    );
    // `[D-460]` (ol-egov.141.89.6.86) added a closed-view guard before the note and the marker
    // write after it, inside the same graded-only branch; behaviour is pinned in
    // `modal-feedback-shown-marker.spec.ts`.
    expect(submit).toMatch(
      /if \(pending\.grading\.outcome === 'graded'\) \{\s*if \(this\.closed\) return;\s*this\.feedbackExposureLedger\.noteShown\(prompt\.originInstrumentId, attemptId\);/,
    );
    expect(submit.match(/noteShown\(/g)).toHaveLength(1);
  });

  it('clears the note only when an attempt is accepted, never on a stale or failed accept', () => {
    const accept = modal.slice(
      modal.indexOf('private async computeAcceptGrading('),
      modal.indexOf('private discardGrading('),
    );
    expect(accept).toMatch(
      /result !== null && result\.status === 'accepted'\) \{\s*this\.feedbackExposureLedger\.settle\(prompt\.originInstrumentId\);/,
    );
  });

  it('uses the shared session note unless a caller injects one, and the reader stays optional', () => {
    expect(modal).toMatch(
      /this\.feedbackExposureLedger = deps\.feedbackExposureLedger \?\? sessionFeedbackExposureLedger;/,
    );
    expect(modal).toMatch(/readonly readLoggedAttemptState\?:/);
  });
});
