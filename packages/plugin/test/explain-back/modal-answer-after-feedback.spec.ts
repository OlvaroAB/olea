/**
 * `[D-416]` (`ol-egov.141.89.6.63`), carrying `[D-318]`: an answer given after
 * she read a graded result is a separate attempt at the guided rung, and Try
 * again keeps the attempt before it instead of erasing it.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "F5.9
 * (continued) / [D-416]". Same two instruments as
 * `modal-support-level.spec.ts`: `modal.ts` extends Obsidian's `Modal` and
 * cannot load under Vitest, so the rule lives in the pure
 * `attempt-sequence.ts` and is tested directly, and the view's wiring of it is
 * asserted against the view's source with comments stripped.
 *
 * **v0.9 (`[D-603]`, `ol-egov.141.89.6.129`):** nothing is graded, so the view seals no graded
 * rung and keeps no graded sequence; the rule tests below stay, for when grading returns. The
 * view-wiring tests are rewritten to what the practice view does instead: "Try again" adds the
 * attempt she left to the view's own list, never erasing it, and each later answer's practice
 * explanation names the passages shown after it (D7.1, `[D-614]`); the writer, not the view,
 * works out the support shown.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMITTED_SUPPORT_LEVELS } from '../../../core/src/mastery/rollup.js';
import {
  appendSetAsideAttempt,
  EMPTY_ATTEMPT_SEQUENCE,
  type ExplainBackAttemptSequence,
  feedbackShownBefore,
  sealAttemptSupport,
} from '../../src/explain-back/attempt-sequence.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');

/** What the answering phase shows today: no hint, no source open beside her. */
const UNAIDED = { hintOffered: false, sourceShownWhileAnswering: false } as const;

function setAside(
  sequence: ExplainBackAttemptSequence,
  attemptId: string,
  outcome: 'correct' | 'partial' | 'incorrect' | 'unable-to-assess',
): ExplainBackAttemptSequence {
  return appendSetAsideAttempt(sequence, {
    attemptId,
    outcome:
      outcome === 'unable-to-assess'
        ? { kind: 'unable-to-assess' }
        : { kind: 'graded', verdict: outcome },
    support: sealAttemptSupport(sequence, UNAIDED),
  });
}

describe('an answer accepted after she read the feedback records the guided rung', () => {
  it('after one graded attempt set aside, the next attempt is sealed guided, whatever the answering phase shows', () => {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial');
    expect(sealAttemptSupport(sequence, UNAIDED).supportLevelShown).toBe('guided');
    expect(
      sealAttemptSupport(sequence, { hintOffered: true, sourceShownWhileAnswering: false })
        .supportLevelShown,
    ).toBe('guided');
    // Having read a graded result is known even when the answering phase's own presentation is not.
    expect(sealAttemptSupport(sequence, null).supportLevelShown).toBe('guided');
  });

  it('guided is not on the admitted list, so that attempt cannot reach the top growth stage', () => {
    expect(ADMITTED_SUPPORT_LEVELS).not.toContain('guided');
  });

  it('every later attempt in the same sequence stays guided', () => {
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'incorrect');
    sequence = setAside(sequence, 'at-2', 'partial');
    expect(sequence[1]?.supportLevelShown).toBe('guided');
    expect(sealAttemptSupport(sequence, UNAIDED).supportLevelShown).toBe('guided');
  });

  it('v0.9: the view seals no graded rung; the practice explanation’s writer reads the support shown', () => {
    expect(modal).not.toMatch(
      /sealAttemptSupport\(|supportLevelShown =|supportLevelShownForExplainBack\(/,
    );
    expect(modal).toMatch(/await record\(\s*await practiceExplanationInput\(\{/);
  });
});

describe('the rung is sealed when she submits, not when she accepts', () => {
  it('a first answer, with an empty sequence, is sealed at the answering phase own reading', () => {
    expect(sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, UNAIDED)).toEqual({
      supportLevelShown: 'independent',
      followsAttemptId: null,
      // Row 50: nothing known beforehand reads as not shown, so the rung is the answering phase's own.
      feedbackExposure: 'not-shown',
    });
    expect(sealAttemptSupport(EMPTY_ATTEMPT_SEQUENCE, null).supportLevelShown).toBeUndefined();
  });

  it('v0.9: submit mints the attempt’s own id and requests nothing; there is no grading phase to carry a rung', () => {
    const submit = modal.slice(
      modal.indexOf('private async submitAnswer('),
      modal.indexOf('private async recordFeedbackShownBeforeDisplay('),
    );
    expect(submit).toMatch(/const attemptId = this\.deps\.generateInstrumentId\(\);/);
    expect(submit).not.toMatch(/runGradingAttempt|this\.deps\.grade|support/);
    expect(modal).not.toMatch(/phase: 'grading'|phase: 'graded'/);
  });

  it('v0.9: no Accept button exists to forward a sealed support', () => {
    expect(modal).not.toMatch(/acceptGrading|EXPLAIN_BACK_ACCEPT_LABEL/);
  });
});

describe('Try again adds to the attempt sequence and never erases it', () => {
  it('each set-aside attempt keeps its own id, its verdict, and that she did not accept it, in order', () => {
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'incorrect');
    sequence = setAside(sequence, 'at-2', 'partial');
    expect(sequence).toEqual([
      {
        attemptId: 'at-1',
        outcome: { kind: 'graded', verdict: 'incorrect' },
        acceptance: 'not-accepted',
        supportLevelShown: 'independent',
        followsAttemptId: null,
        feedbackExposure: 'not-shown',
      },
      {
        attemptId: 'at-2',
        outcome: { kind: 'graded', verdict: 'partial' },
        acceptance: 'not-accepted',
        supportLevelShown: 'guided',
        followsAttemptId: 'at-1',
        feedbackExposure: 'shown',
      },
    ]);
  });

  it('the new attempt is linked to the one immediately before it', () => {
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'incorrect');
    sequence = setAside(sequence, 'at-2', 'partial');
    expect(sealAttemptSupport(sequence, UNAIDED).followsAttemptId).toBe('at-2');
  });

  it('appending never mutates the sequence it was given', () => {
    const first = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'correct');
    const snapshot = JSON.stringify(first);
    const second = setAside(first, 'at-2', 'correct');
    expect(JSON.stringify(first)).toBe(snapshot);
    expect(second).toHaveLength(2);
    expect(EMPTY_ATTEMPT_SEQUENCE).toHaveLength(0);
  });

  it('an entry holds ids, a verdict and a rung only, never answer text or feedback (D-005)', () => {
    const [entry] = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial');
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      'acceptance',
      'attemptId',
      'feedbackExposure',
      'followsAttemptId',
      'outcome',
      'supportLevelShown',
    ]);
    expect(Object.keys(entry?.outcome ?? {}).sort()).toEqual(['kind', 'verdict']);
  });

  it('v0.9: "Try again" adds the attempt she left to the view’s list, by appending, after its practice explanation is asked for', () => {
    const tryAgain = modal.slice(
      modal.indexOf('private tryAgain('),
      modal.indexOf('private async recordPracticeExplanationIfPossible('),
    );
    expect(tryAgain).toMatch(
      /void this\.recordPracticeExplanationIfPossible\(prompt, answer, attemptId, durationMs\);[\s\S]*?this\.attemptsLeftByTryAgain = \[\.\.\.this\.attemptsLeftByTryAgain, attemptId\];/,
    );
    expect(modal).not.toMatch(/appendSetAsideAttempt|discardExplainBackGrading|attemptSequence/);
  });

  it('v0.9: only "Try again" grows the list, and only a new question resets it', () => {
    expect(modal.match(/this\.attemptsLeftByTryAgain = \[\.\.\./g)).toHaveLength(1);
    expect(modal.match(/this\.attemptsLeftByTryAgain = \[\];/g)).toHaveLength(1);
    const enter = modal.slice(
      modal.indexOf('private enterNewQuestion('),
      modal.indexOf('private async submitAnswer('),
    );
    expect(enter).toContain('this.attemptsLeftByTryAgain = [];');
  });

  it('v0.9: the "Try again" button passes the attempt id and its duration', () => {
    expect(modal.match(/this\.tryAgain\(prompt, answer, attemptId, durationMs\)/g)).toHaveLength(1);
  });
});

describe('an answer the check could not assess is kept but gives no feedback', () => {
  it('is kept in the sequence with no verdict', () => {
    const [entry] = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'unable-to-assess');
    expect(entry?.outcome).toEqual({ kind: 'unable-to-assess' });
    expect(entry?.acceptance).toBe('not-accepted');
  });

  it('does not by itself make the next answer guided', () => {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'unable-to-assess');
    expect(feedbackShownBefore(sequence)).toBe(false);
    expect(sealAttemptSupport(sequence, UNAIDED)).toEqual({
      supportLevelShown: 'independent',
      followsAttemptId: 'at-1',
      feedbackExposure: 'not-shown',
    });
  });

  it('an earlier graded attempt in the same sequence still makes it guided', () => {
    let sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial');
    sequence = setAside(sequence, 'at-2', 'unable-to-assess');
    expect(sealAttemptSupport(sequence, UNAIDED).supportLevelShown).toBe('guided');
  });
});

describe('resubmitting after the check failed is the same attempt, not one after feedback', () => {
  it('v0.9: no check runs, so there is no check-failed refusal and no retry to resubmit from', () => {
    expect(modal).not.toMatch(/renderCouldNotCheckRefusal|check-failed/);
  });

  it('with the sequence unchanged, the resubmission seals the same rung the failed submission did', () => {
    const sequence = setAside(EMPTY_ATTEMPT_SEQUENCE, 'at-1', 'partial');
    expect(sealAttemptSupport(sequence, UNAIDED)).toEqual(sealAttemptSupport(sequence, UNAIDED));
  });
});
