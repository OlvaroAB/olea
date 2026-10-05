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

describe('ExplainBackModal — a refused or unavailable judgment records no learning failure', () => {
  it('calls deps.acceptWithObservation exactly once in the whole file, and only inside acceptGrading', () => {
    const calls = modal.match(/this\.deps\.acceptWithObservation\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const acceptGradingBody = modal.slice(
      modal.indexOf('private acceptGrading('),
      modal.indexOf('private discardGrading('),
    );
    expect(acceptGradingBody).toMatch(/this\.deps\.acceptWithObservation\(/);
  });

  it('calls deps.recordSoloGradeAndReview exactly once in the whole file, and only inside acceptGrading', () => {
    const calls = modal.match(/this\.deps\.recordSoloGradeAndReview\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const acceptGradingBody = modal.slice(
      modal.indexOf('private acceptGrading('),
      modal.indexOf('private discardGrading('),
    );
    expect(acceptGradingBody).toMatch(/this\.deps\.recordSoloGradeAndReview\(/);
  });

  it('acceptGrading is invoked from exactly one place: the Accept button renderGradedPhase renders', () => {
    const calls = modal.match(/void this\.acceptGrading\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const gradedPhaseBody = modal.slice(
      modal.indexOf('private renderGradedPhase('),
      modal.indexOf('private renderGradedRegions('),
    );
    expect(gradedPhaseBody).toMatch(/void this\.acceptGrading\(/);
  });

  it('neither refusal transition in submitAnswer calls acceptWithObservation or recordSoloGradeAndReview', () => {
    const submitAnswerBody = modal.slice(
      modal.indexOf('private async submitAnswer('),
      modal.indexOf('private acceptGrading('),
    );
    expect(submitAnswerBody).toMatch(
      /phase: 'refused',\s*prompt,\s*answer,\s*reason: outcome\.kind === 'unavailable' \? 'unavailable' : outcome\.reason/,
    );
    expect(submitAnswerBody).not.toMatch(/acceptWithObservation/);
    expect(submitAnswerBody).not.toMatch(/recordSoloGradeAndReview/);
  });

  it('renderRefusedPhase never calls acceptWithObservation or recordSoloGradeAndReview', () => {
    const refusedPhaseBody = modal.slice(
      modal.indexOf('private renderRefusedPhase('),
      modal.indexOf('private renderNothingMatchedRefusal('),
    );
    expect(refusedPhaseBody.length).toBeGreaterThan(0);
    expect(refusedPhaseBody).not.toMatch(/acceptWithObservation/);
    expect(refusedPhaseBody).not.toMatch(/recordSoloGradeAndReview/);
  });
});

describe('ExplainBackModal — acceptGrading threads the graded query through for the live staleness check (ol-gavc)', () => {
  it('passes prompt.query — the exact string frozen at retrieval time, never a re-derived prompt.context.question (ol-egov.141.89.6.16) — as query on the buildObservationContext call', () => {
    const acceptGradingBody = modal.slice(
      modal.indexOf('private acceptGrading('),
      modal.indexOf('private discardGrading('),
    );
    expect(acceptGradingBody).toMatch(
      /this\.deps\.buildObservationContext\(\{\s*subjectConceptId:\s*prompt\.subjectConceptId,\s*permittedConceptIds:\s*prompt\.context\.permittedConceptIds \?\? \[\],\s*originInstrumentId:\s*prompt\.originInstrumentId,\s*sourceBlocks:\s*prompt\.sourceBlocks,\s*query:\s*prompt\.query,\s*\}\)\),\s*attemptId,\s*afterFeedback:\s*support\.feedbackExposure === 'shown',\s*\};/,
    );
    expect(acceptGradingBody).not.toMatch(/query:\s*prompt\.context\.question/);
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

  it('submitAnswer routes every failure through runGradingAttempt and never calls a write dep', () => {
    const submitAnswerBody = modal.slice(
      modal.indexOf('private async submitAnswer('),
      modal.indexOf('private acceptGrading('),
    );
    expect(submitAnswerBody).toMatch(/await runGradingAttempt\(/);
    expect(submitAnswerBody).not.toMatch(/reason: 'insufficient-notes'/);
  });
});
