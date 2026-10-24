/**
 * `ol-0r92.89`: proves a refused or unavailable judgment records no learning
 * failure — no observation event, no review-log write — the same
 * source-level technique `modal-duration.spec.ts` already uses and for the
 * same reason: `ExplainBackModal` extends Obsidian's `Modal`, and
 * `obsidian`'s `package.json` `main` is `""`, so it cannot be instantiated
 * under Vitest at all. Comments are stripped before matching so a doc
 * paragraph describing the guard can't satisfy an assertion that the guard
 * actually exists in the code.
 *
 * What this locks in: `deps.acceptWithObservation` and
 * `deps.recordSoloGradeAndReview` — the two calls that can produce a
 * misconception observation event or a review-log write — are each called
 * from exactly one place in this file, inside `acceptGrading`, and
 * `acceptGrading` itself is wired to exactly one control: the Accept button
 * `renderGradedPhase` renders. Neither `submitAnswer`'s two refusal
 * transitions (`pending === null` -> `'unavailable'`; the catch block ->
 * `'insufficient-notes'`/`'check-failed'`) nor `renderRefusedPhase` calls
 * either dep, so a refused or unreachable judgment never reaches the
 * accept-and-observe step at all — there is nothing to make idempotent
 * because nothing was recorded in the first place.
 *
 * **v0.9 (`[D-603]`, `ol-egov.141.89.6.129`):** no judgment is requested at all, so there is
 * nothing to refuse and nothing to accept: the view reaches neither write dep from anywhere, and
 * the only refusal it can show is the free-form topic's insufficient-notes one, before any
 * answer. The view-level blocks below are rewritten to that; `runGradingAttempt`'s own rules
 * stay, tested as the function they are, for when grading returns (the F5 heading note).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CORRECTNESS_OVERALL_BOUND_MS } from 'olea-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGradingAttempt } from '../../src/explain-back/grading-attempt.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with comments removed — see this file's module doc. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');

describe('ExplainBackModal (v0.9) — no judgment is requested, so none is refused and none is recorded', () => {
  it('the view calls neither deps.acceptWithObservation nor deps.recordSoloGradeAndReview, from anywhere', () => {
    expect(modal).not.toMatch(/this\.deps\.acceptWithObservation\(/);
    expect(modal).not.toMatch(/this\.deps\.recordSoloGradeAndReview\(/);
    expect(modal).not.toMatch(/acceptGrading/);
  });

  it('the only refusal is the free-form topic’s insufficient-notes one, reached before any answer', () => {
    expect(modal.match(/phase: 'refused', prompt \}/g)).toHaveLength(1);
    const topic = modal.slice(
      modal.indexOf('private async resolveTopicPrompt('),
      modal.indexOf('private enterNewQuestion('),
    );
    expect(topic).toMatch(
      /if \(context\.referenceAnswer\.trim\(\) === ''\) \{[\s\S]*?phase: 'refused', prompt \}/,
    );
    expect(modal).not.toMatch(/'unavailable'|'check-failed'/);
  });

  it('renderRefusedPhase reaches no write and no grader', () => {
    const refusedPhaseBody = modal.slice(
      modal.indexOf('private renderRefusedPhase('),
      modal.indexOf('private renderFoundList('),
    );
    expect(refusedPhaseBody.length).toBeGreaterThan(0);
    expect(refusedPhaseBody).not.toMatch(/this\.deps\./);
  });
});

// ---------------------------------------------------------------------------
// `[D-482]` (F5.5 / F5.3): a call has a bound, and a failed call is never a verdict
// ---------------------------------------------------------------------------

const GRADE_INPUT = {
  question: 'Why does X happen?',
  studentAnswer: 'Because Y causes Z.',
  referenceAnswer: 'Because Y drives Z.',
  sourceBlocks: [],
  misconceptionDigest: [],
};

describe('runGradingAttempt: a correctness call that cannot answer is could-not-check, never a verdict', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // @auto:plugin/explain-back/modal-refusal.spec
  it('a call that does not return within its bound is refused as check-failed, with nothing to record', async () => {
    const outcome = runGradingAttempt({
      grade: () => new Promise(() => {}),
      input: GRADE_INPUT,
      isCurrent: () => true,
    });
    await vi.advanceTimersByTimeAsync(CORRECTNESS_OVERALL_BOUND_MS + 1);
    expect(await outcome).toEqual({ kind: 'refused', reason: 'check-failed' });
  });

  // @auto:plugin/explain-back/modal-refusal.spec
  it('a transport error, an unusable response and a timeout each read as check-failed: never incorrect, never notes-insufficient', async () => {
    const unusable = new Error('the Worker response was not an object');
    unusable.name = 'WorkerJudgeError';
    const results = await Promise.all([
      runGradingAttempt({
        grade: () => Promise.reject(new Error('socket closed')),
        input: GRADE_INPUT,
        isCurrent: () => true,
      }),
      runGradingAttempt({
        grade: () => Promise.reject(unusable),
        input: GRADE_INPUT,
        isCurrent: () => true,
      }),
    ]);
    for (const result of results) {
      expect(result).toEqual({ kind: 'refused', reason: 'check-failed' });
      expect(JSON.stringify(result)).not.toMatch(/incorrect|insufficient/);
    }
  });

  // @auto:plugin/explain-back/modal-refusal.spec
  it('notes-insufficient stays reserved for an empty reference (UnusableGradingInputError)', async () => {
    const empty = new Error('referenceAnswer is empty');
    empty.name = 'UnusableGradingInputError';
    const result = await runGradingAttempt({
      grade: () => Promise.reject(empty),
      input: GRADE_INPUT,
      isCurrent: () => true,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'insufficient-notes' });
  });

  it('an unconfigured grader (null) is the existing unavailable refusal', async () => {
    const result = await runGradingAttempt({
      grade: () => Promise.resolve(null),
      input: GRADE_INPUT,
      isCurrent: () => true,
    });
    expect(result).toEqual({ kind: 'unavailable' });
  });

  it('v0.9: submitAnswer runs no grading attempt at all, so no failure can follow an answer', () => {
    const submitAnswerBody = modal.slice(
      modal.indexOf('private async submitAnswer('),
      modal.indexOf('private async recordFeedbackShownBeforeDisplay('),
    );
    expect(submitAnswerBody).not.toMatch(/runGradingAttempt|this\.deps\.grade/);
    expect(submitAnswerBody).not.toMatch(/phase: 'refused'/);
  });
});
