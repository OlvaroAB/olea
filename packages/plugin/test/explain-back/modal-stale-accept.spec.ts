/**
 * `ol-egov.141.89.6.15`: a stale explain-back accept must write no review
 * event of any kind — correctness or depth-only. Source-level assertion, not
 * a behavioural test, for the same reason every other `modal-*.spec.ts` in
 * this directory gives: `modal.ts` extends Obsidian's `Modal`, and
 * `obsidian`'s `package.json` `main` is `""`, so it cannot be instantiated
 * under Vitest. Comments are stripped before matching so a doc paragraph
 * describing the gate can't satisfy an assertion that the gate actually
 * exists in the code.
 *
 * `computeAcceptGrading` calls `this.deps.acceptWithObservation` and gets
 * back an `AcceptExplainBackGradingWithObservationResult | null` —
 * `{status: 'stale'}` (or `null`) meaning `grading/wiring.ts`'s own
 * `acceptExplainBackGradingWithObservation` recorded nothing at all (see
 * that function's `ol-0r92.89` doc: "REJECTS ON A STALE SOURCE, NEVER
 * ACCEPTS SILENTLY"). Before this bead's fix, the correctness-accept
 * `message` read `result.status`, but the `recordSoloGradeAndReview` depth
 * write right above it did not: it ran unconditionally whenever the dep was
 * wired, regardless of whether `result` was `'stale'` or `null`. This locks
 * in that the depth write only runs once `result` is confirmed
 * `{status: 'accepted'}`.
 *
 * **v0.9 (`[D-603]`, `ol-egov.141.89.6.129`):** nothing is accepted, so the gate has nothing to
 * guard in the view; the rule stays in `../grading/wiring.ts` for when grading returns. The
 * assertions below pin that the view reaches no accept or depth write at all.
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

function bodyBetween(startMarker: string, endMarker: string): string {
  const start = modal.indexOf(startMarker);
  const end = modal.indexOf(endMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return modal.slice(start, end);
}

describe('ExplainBackModal (v0.9) — no accept exists, so no stale accept can write anything', () => {
  it('the view calls neither the correctness accept nor the depth write', () => {
    expect(modal).not.toMatch(/this\.deps\.acceptWithObservation\(/);
    expect(modal).not.toMatch(/this\.deps\.recordSoloGradeAndReview\(/);
  });

  it('leaving an answer writes only its practice explanation, through the one practice write', () => {
    const leaving = bodyBetween(
      'private finishPractice(',
      'private async recordPracticeExplanationIfPossible(',
    );
    expect(leaving).not.toMatch(/this\.deps\.(?!recordPracticeExplanation)\w+\(/);
    expect(modal.match(/const record = this\.deps\.recordPracticeExplanation;/g)).toHaveLength(1);
  });
});
