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

describe('ExplainBackModal — ol-egov.141.89.6.15: a stale accept writes no depth review event', () => {
  it('gates the recordSoloGradeAndReview call on the correctness accept result being status "accepted"', () => {
    const computeBody = bodyBetween(
      'private async computeAcceptGrading(',
      'private discardGrading(',
    );
    const resultIndex = computeBody.indexOf(
      'const result = await this.deps.acceptWithObservation(pending, context);',
    );
    expect(resultIndex).toBeGreaterThanOrEqual(0);
    const recordIndex = computeBody.indexOf('this.deps.recordSoloGradeAndReview(');
    expect(recordIndex).toBeGreaterThan(resultIndex);

    // The span between resolving `result` and actually calling the depth
    // write must contain a guard checking result is a non-null accepted
    // outcome — never an unconditional `if (this.deps.recordSoloGradeAndReview)`
    // alone.
    const guardSpan = computeBody.slice(resultIndex, recordIndex);
    expect(guardSpan).toMatch(/result\s*!==\s*null\s*&&\s*result\.status\s*===\s*'accepted'/);
  });
});
