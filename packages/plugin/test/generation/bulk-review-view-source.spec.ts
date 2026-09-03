/**
 * Source-text checks for `bulk-review-view.ts` (`[D-216]` / `ol-egov.105`).
 * The view itself has no logic tests — `obsidian` has no runtime outside a
 * real host, same reasoning that file's own module doc gives — but a
 * grep-shaped assertion over its own text can still prove two things a real
 * DOM test would otherwise be needed for: it reuses the SAME
 * `REGISTRY_ENTRY_ACTION` affordance `review/view.ts` renders rather than
 * declaring a look-alike of its own, and it never claims a key for the
 * source peek. Same "read the file as text, strip comments, assert on the
 * code" discipline `bulk-review.spec.ts`'s own import-boundary test and
 * `main-wiring.spec.ts`'s `codeOf` helper already use — a doc comment
 * describing the reuse must not be what satisfies the assertion.
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

describe('BulkReviewView reuses the existing open-the-source affordance ([D-216])', () => {
  it('imports REGISTRY_ENTRY_ACTION from review/copy.ts rather than declaring its own label', () => {
    expect(viewCode).toMatch(
      /import\s*\{\s*REGISTRY_ENTRY_ACTION\s*\}\s*from\s*'\.\.\/review\/copy\.js'/,
    );
    // Never a second, differently-worded constant standing in for the same thing.
    expect(viewCode).not.toMatch(/const\s+REGISTRY_ENTRY_ACTION/);
  });

  it('renders the peek button with the imported label, not a re-typed string', () => {
    expect(viewCode).toMatch(/text:\s*REGISTRY_ENTRY_ACTION/);
  });

  it('the peek button is absent-by-omission, never disabled-and-shown, when openSource is unset', () => {
    expect(viewCode).toMatch(/if\s*\(openSource\s*&&/);
  });
});
