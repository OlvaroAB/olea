/**
 * `[D-286]` (`ol-egov.141.89.6.4`'s gap table), as v0.9 has it (`[D-603]`,
 * `ol-egov.141.89.6.129`): the depth (SOLO) pass is dormant. The explain-back view runs no
 * correctness call and no depth pass, so there is no verdict for a gate to read; the gate itself,
 * `../../src/explain-back/request.ts`'s pure `shouldRunExplainBackDepthPass` ("a clearly
 * incorrect answer makes exactly one call and a partial makes two"), stays in the codebase for
 * when grading returns (F5 heading note), and is checked here as the function it is.
 *
 * The view half is source-level (comments stripped): `modal.ts` extends Obsidian's `Modal`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shouldRunExplainBackDepthPass } from '../../src/explain-back/request.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with comments removed — see this file's module doc. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');

describe('the dormant depth-pass gate ([D-286]) is unchanged, for when grading returns', () => {
  it('a clearly incorrect verdict makes no depth call; a partial or correct one would', () => {
    expect(shouldRunExplainBackDepthPass('incorrect')).toBe(false);
    expect(shouldRunExplainBackDepthPass('partial')).toBe(true);
    expect(shouldRunExplainBackDepthPass('correct')).toBe(true);
  });
});

describe('explain-back/modal.ts runs no depth pass in v0.9 ([D-603])', () => {
  it('the view reaches neither the gate nor the depth write, and reads no verdict', () => {
    expect(modal).not.toMatch(/shouldRunExplainBackDepthPass/);
    expect(modal).not.toMatch(/this\.deps\.recordSoloGradeAndReview/);
    expect(modal).not.toMatch(/const depthPass|\bdepthPass,/);
    expect(modal).not.toMatch(/\.verdict\b/);
  });
});
