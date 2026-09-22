/**
 * `ol-l7ew` [DOS-C5a] — the support level an explain-back attempt was shown
 * at, which `[D-281]` item 3 (`ol-95vv.10`) makes one of the four pieces of
 * evidence the top growth stage requires.
 *
 * Two instruments, for the reason `modal-duration.spec.ts`'s own header
 * gives: `modal.ts` extends Obsidian's `Modal` and cannot load under Vitest,
 * so what the view RENDERS is asserted against its source text with comments
 * stripped, while the rule that turns rendered scaffolding into a ladder
 * value is a pure function in `solo-review.ts` and is tested directly.
 *
 * The rule is `[D-094]`'s own, quoted in `olea-contracts`' `supportLevel`
 * doc: record what was SHOWN, never what she said. The answering phase
 * offers no hint and keeps no source open beside her, so `'independent'` is
 * the true reading — not a default, and the constant that says so sits next
 * to the render method whose behaviour it describes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// `ADMITTED_SUPPORT_LEVELS` is `[D-281]`'s own list and lives in
// `olea-core`'s `mastery/rollup.ts`, which another lane owns; it is not
// re-exported from that package's index, so it is read here by deep path
// rather than copied into this file. A copy would be the drift these
// assertions exist to catch.
import { ADMITTED_SUPPORT_LEVELS } from '../../../core/src/mastery/rollup.js';
import { supportLevelShownForExplainBack } from '../../src/explain-back/solo-review.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');

describe('an attempt made with no help on screen records the independent level, and that level admits the top stage', () => {
  it('no hint offered and no source open resolves to independent', () => {
    expect(
      supportLevelShownForExplainBack({ hintOffered: false, sourceShownWhileAnswering: false }),
    ).toBe('independent');
  });

  it('independent is on [D-281]s admitted list, so such an attempt can reach the top stage', () => {
    expect(ADMITTED_SUPPORT_LEVELS).toContain('independent');
  });

  it('the modal declares what its answering phase actually shows, and both affordances are absent', () => {
    expect(modal).toMatch(
      /EXPLAIN_BACK_ANSWERING_SUPPORT_SHOWN[\s\S]{0,200}?hintOffered: false,[\s\S]{0,120}?sourceShownWhileAnswering: false,/,
    );
  });

  it('the resolved level rides to the writer on the same call the depth grade does, keyed on the same attempt', () => {
    expect(modal).toMatch(
      /const supportLevelShown = supportLevelShownForExplainBack\(\s*EXPLAIN_BACK_ANSWERING_SUPPORT_SHOWN,?\s*\);/,
    );
    expect(modal).toMatch(
      /await this\.deps\.recordSoloGradeAndReview\(\{[\s\S]{0,400}?attemptId,[\s\S]{0,400}?\.\.\.\(supportLevelShown !== undefined \? \{ supportLevelShown \} : \{\}\),/,
    );
  });
});

describe('an attempt made with the source open beside her records that level, and it does not admit the top stage', () => {
  it('a source kept open while she answers resolves to guided, whatever else is on screen', () => {
    expect(
      supportLevelShownForExplainBack({ hintOffered: false, sourceShownWhileAnswering: true }),
    ).toBe('guided');
    expect(
      supportLevelShownForExplainBack({ hintOffered: true, sourceShownWhileAnswering: true }),
    ).toBe('guided');
  });

  it('an offered hint with no source resolves to prompted', () => {
    expect(
      supportLevelShownForExplainBack({ hintOffered: true, sourceShownWhileAnswering: false }),
    ).toBe('prompted');
  });

  it('guided is not admitted, so an attempt shown the source cannot reach the top stage', () => {
    expect(ADMITTED_SUPPORT_LEVELS).not.toContain('guided');
  });
});

describe('an attempt whose support level is genuinely unknown stays unknown', () => {
  it('an unobservable presentation resolves to no value at all, never to independent', () => {
    expect(supportLevelShownForExplainBack(null)).toBeUndefined();
  });
});
