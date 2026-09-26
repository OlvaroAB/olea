/**
 * Source-text checks for `BulkReviewView`'s `renderRefusals` (`[H-1.8a]` /
 * `ol-0r92.71`, component register row 1.8a, C4.7 / `[D-089]`). Same
 * reasoning `bulk-review-view-source.spec.ts` gives for testing this file by
 * its own text rather than a DOM: `obsidian` has no runtime outside a real
 * host, so a grep-shaped assertion is what stands in for a render test here.
 * `pipeline.spec.ts`'s "a refused concept caches nothing" case already
 * proves the no-evidence/no-lapse half of this bead one layer down — this
 * file covers the half that is specific to the view: the two states render
 * distinct copy, the transient flag is visible on the DOM (not merely
 * carried in the data), and the render never rolls refusals into a
 * standalone count (F6.7).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function codeOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const viewCode = codeOf('../../src/generation/bulk-review-view.ts');

describe('BulkReviewView renders a classified refusal ([H-1.8a])', () => {
  it('imports GenerationRefusalNotice from pipeline.ts rather than re-declaring the shape', () => {
    expect(viewCode).toMatch(
      /import\s+type\s*\{\s*GenerationRefusalNotice\s*\}\s*from\s*'\.\/pipeline\.js'/,
    );
  });

  it('getRefusals is optional and grey-out-by-omission, matching openSource above it', () => {
    expect(viewCode).toMatch(/getRefusals\?:\s*BulkReviewRefusalsProvider/);
    expect(viewCode).toMatch(/this\.getRefusals\?\.\(\)\s*\?\?\s*\[\]/);
  });

  it('renders the classified headline text, not a re-typed string', () => {
    expect(viewCode).toMatch(/text:\s*notice\.copy\.headline/);
  });

  it('the two states get distinct modifier classes keyed on the transient flag', () => {
    expect(viewCode).toMatch(/notice\.copy\.transient\s*\?\s*'transient'\s*:\s*'insufficient'/);
    expect(viewCode).toMatch(/olea-bulk-review-refusal-row--\$\{stateModifier\}/);
  });

  it('the transient flag reaches the DOM as its own attribute, not only as a class', () => {
    expect(viewCode).toMatch(
      /setAttr\('data-olea-bulk-refusal-transient',\s*String\(notice\.copy\.transient\)\)/,
    );
  });

  it('never rolls the list into a standalone count (F6.7) — each notice renders individually', () => {
    // The only length check is the empty-state guard; nothing interpolates
    // `refusals.length` (or any other count of them) into rendered text.
    const refusalsSection = viewCode.slice(viewCode.indexOf('renderRefusals'));
    expect(refusalsSection).not.toMatch(/\$\{refusals\.length\}/);
    expect(refusalsSection).not.toMatch(/refusals\.length\s*\}\}/);
  });

  it('is called from render() unconditionally, so a refusal survives an otherwise-empty group list', () => {
    expect(viewCode).toMatch(/this\.renderRefusals\(root\);/);
  });
});
