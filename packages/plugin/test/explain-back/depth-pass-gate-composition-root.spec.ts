/**
 * `[D-286]` (`ol-egov.141.89.6.4`'s gap table): source-level proof that `explain-back/modal.ts`'s
 * `computeAcceptGrading` gates the depth (SOLO) pass on the correctness verdict — "a clearly
 * incorrect answer makes exactly one call and a partial makes two," the ruling's own acceptance
 * line. Before this bead's fix, `computeAcceptGrading` ran `deps.recordSoloGradeAndReview`
 * whenever `result.status === 'accepted'`, with no read of `pending.grading` at all: accepting a
 * clearly-incorrect attempt still made the second call. This file proves the gate now reads the
 * verdict via `../../src/explain-back/request.ts`'s pure `shouldRunExplainBackDepthPass` (already
 * unit-tested there for both branches) rather than re-deriving the rule inline.
 *
 * Source-level, not behavioural, for the same reason every sibling spec in this directory gives:
 * `modal.ts` extends Obsidian's `Modal` and cannot be imported under Vitest. Comments are stripped
 * before matching, same convention.
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

describe('explain-back/modal.ts: computeAcceptGrading gates the depth pass on the verdict ([D-286])', () => {
  it('imports shouldRunExplainBackDepthPass from ./request.js', () => {
    expect(modal).toMatch(/shouldRunExplainBackDepthPass/);
  });

  it("the recordSoloGradeAndReview call is guarded by grading.outcome === 'graded' && shouldRunExplainBackDepthPass(grading.verdict), never run unconditionally on result.status alone", () => {
    const start = modal.indexOf('private async computeAcceptGrading(');
    expect(start).toBeGreaterThan(-1);
    const end = modal.indexOf('private discardGrading(', start);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(/grading\.outcome === 'graded'/);
    expect(body).toMatch(/shouldRunExplainBackDepthPass\(grading\.verdict\)/);
    // The bug this proves fixed: the guard used to end at `this.deps.recordSoloGradeAndReview)`,
    // with no verdict read at all.
    expect(body).not.toMatch(
      /if \(result !== null && result\.status === 'accepted' && this\.deps\.recordSoloGradeAndReview\)\s*\{/,
    );
  });
});
