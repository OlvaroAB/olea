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
import { describe, expect, it } from 'vitest';

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
      modal.indexOf('private async acceptGrading('),
      modal.indexOf('private discardGrading('),
    );
    expect(acceptGradingBody).toMatch(/this\.deps\.acceptWithObservation\(/);
  });

  it('calls deps.recordSoloGradeAndReview exactly once in the whole file, and only inside acceptGrading', () => {
    const calls = modal.match(/this\.deps\.recordSoloGradeAndReview\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const acceptGradingBody = modal.slice(
      modal.indexOf('private async acceptGrading('),
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
      modal.indexOf('private async acceptGrading('),
    );
    expect(submitAnswerBody).toMatch(/phase: 'refused', prompt, answer, reason: 'unavailable'/);
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
