/**
 * `[D-321]` / `ol-0r92.130`: the judge's `unable-to-assess` outcome — no grade shown, no verdict
 * badge, nothing written, misconception/mastery never run off it, and no referral to item
 * validation. As v0.9 has it (`[D-603]`, `ol-egov.141.89.6.129`) no answer is sent to the judge,
 * so the view never receives the outcome at all: it has no unable-to-assess phase, renders no
 * decline message, and reaches no write a grading could lead to. The outcome's own handling stays
 * where it lives — `./decline-kind.ts` (`decline-kind.spec.ts`) and `olea-core`'s grading pipeline
 * — for when grading returns (the F5 heading note).
 *
 * Checked against the source text with comments stripped: `ExplainBackModal` extends Obsidian's
 * `Modal`. `practice-view.spec.ts` renders the view itself.
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

describe('v0.9: the view never receives an unable-to-assess outcome', () => {
  it('no phase, render method or branch for it', () => {
    expect(modal).not.toMatch(/unable-to-assess|renderUnableToAssessPhase|renderGradedPhase/);
  });

  it('no decline message is chosen or rendered by the view', () => {
    expect(modal).not.toMatch(
      /declineMessageFor|declineKindOf|EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE/,
    );
  });

  it('nothing that could write a review, run misconception matching or mastery, or refer the instrument to validation', () => {
    expect(modal).not.toMatch(/acceptWithObservation\(|recordSoloGradeAndReview\(/);
    expect(modal).not.toMatch(/appendReviewLogRecord/);
    expect(modal).not.toMatch(/referr?al/i);
  });
});
