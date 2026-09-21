/**
 * `qa-card-modal.ts` tests (F2.1, `[D-268]`/`ol-0r92.77` [H-qa-card-modal]).
 *
 * `QaCardModal` extends Obsidian's `Modal`, and `obsidian`'s `package.json`
 * `main` is `""`, so it cannot be instantiated under Vitest at all — the
 * same constraint `explain-back/modal-refusal.spec.ts` and
 * `main-wiring.spec.ts` document for their own targets. Source-level
 * assertions against comment-stripped code are the only instrument
 * available, and what they check here is the clause's own shape: two
 * plain-text fields, a Confirm that is disabled while either is blank, and
 * a Cancel that closes without ever calling `onConfirm` — so no edit is
 * possible on cancel by construction, not by a caller remembering to check.
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

const modal = codeOf('commands/qa-card-modal.ts');

describe('QaCardModal — F2.1 Q&A entry surface, `[D-268]`', () => {
  it('extends Modal, the same base class register-source-modal.ts and setup-modal.ts use', () => {
    expect(modal).toMatch(/class QaCardModal extends Modal/);
  });

  it('renders exactly two textareas — front and back, both plain text', () => {
    const matches = modal.match(/createEl\('textarea'/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('never calls onConfirm from the Cancel button — cancelling writes nothing', () => {
    const cancelBlock = modal.slice(modal.indexOf('cancelButton'));
    expect(cancelBlock).toMatch(
      /cancelButton\.addEventListener\('click',\s*\(\)\s*=>\s*this\.close\(\)\)/,
    );
    expect(cancelBlock).not.toMatch(/onConfirm/);
  });

  it('disables Confirm while either field is blank, and only calls onConfirm with both trimmed non-empty', () => {
    expect(modal).toMatch(
      /confirmButton\.disabled\s*=\s*frontInput\.value\.trim\(\)\s*===\s*''\s*\|\|\s*backInput\.value\.trim\(\)\s*===\s*''/,
    );
    expect(modal).toMatch(/if \(front\.trim\(\) === '' \|\| back\.trim\(\) === ''\) return;/);
  });

  it('confirming closes before calling onConfirm — the modal never stays open on its own callback', () => {
    expect(modal).toMatch(/this\.close\(\);\s*this\.onConfirm\(\{ front, back \}\);/);
  });

  it('empties contentEl on close, the same cleanup every other modal in this package does', () => {
    expect(modal).toMatch(/onClose\(\):\s*void\s*\{\s*this\.contentEl\.empty\(\);\s*\}/);
  });
});
