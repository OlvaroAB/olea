/**
 * `ExplainBackModal`'s `answerEdits` capture (`ol-0r92.56`, `[D-228 /
 * SIG-3]`) — source-level assertions, not a behavioural test, for the same
 * reason `modal-duration.spec.ts` gives at its own header: `modal.ts`
 * extends Obsidian's `Modal`, and `obsidian`'s `package.json` `main` is
 * `""`, so it cannot be instantiated under Vitest at all. Assertions run
 * against the source text with comments stripped, so a doc paragraph
 * describing the capture can't satisfy an assertion about the capture code
 * actually existing.
 *
 * Covers DF-20 scenarios 5–7 of `features/F5-explain-it-back.md`'s
 * "F2.16 / [D-228]" block (`@auto:plugin/explain-back/modal.spec`):
 *   5. an answer typed once, straight through, is recorded as one burst and
 *      not as an absent signal;
 *   6. the counter survives the modal re-rendering the answering phase;
 *   7. nothing about the count is shown to her while she writes.
 * Scenarios 1–4 (the schema itself) live in `contracts/review-log-v5.spec
 * .ts`; scenario 8 (the rating and grade untouched) is `solo-review.ts`'s
 * own spec, a file this bead does not own.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with comments removed — a doc paragraph must not satisfy an assertion about the code doing the thing. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');

describe('ExplainBackModal adds exactly one capture listener, on the answering textarea', () => {
  it('renderAnsweringPhase adds exactly one input listener, and it is the only one in the file', () => {
    const listeners = modal.match(/\.addEventListener\('input',/g) ?? [];
    expect(listeners).toHaveLength(1);
  });

  it('the listener is attached inside renderAnsweringPhase, on the textarea it just created', () => {
    const renderStart = modal.indexOf('private renderAnsweringPhase(');
    const nextMethodStart = modal.indexOf('private ', renderStart + 1);
    expect(renderStart).toBeGreaterThan(-1);
    const body = modal.slice(renderStart, nextMethodStart);
    expect(body).toMatch(/textarea\.addEventListener\('input', \(\) => \{/);
  });

  it('the listener never reads or captures textarea.value — it only times and counts (D-005)', () => {
    const renderStart = modal.indexOf('private renderAnsweringPhase(');
    const listenerStart = modal.indexOf("textarea.addEventListener('input',", renderStart);
    const listenerEnd = modal.indexOf('});', listenerStart);
    expect(listenerStart).toBeGreaterThan(-1);
    const listenerBody = modal.slice(listenerStart, listenerEnd);
    expect(listenerBody).not.toMatch(/textarea\.value/);
  });
});

describe('ExplainBackModal counts burst 5: one straight-through composition is one burst, not an absent signal', () => {
  it('the first input event of a fresh textarea increments this.editBursts exactly once, via a call-scoped flag', () => {
    const renderStart = modal.indexOf('private renderAnsweringPhase(');
    const nextMethodStart = modal.indexOf('private ', renderStart + 1);
    const body = modal.slice(renderStart, nextMethodStart);
    // A closure-local flag, freshly `false` every call — not a field on the
    // textarea and not a module-level variable — is what stops a second,
    // third, … keystroke in the SAME presentation from incrementing
    // `editBursts` again (that would make it a keystroke count, the
    // REJECTED option).
    expect(body).toMatch(/let burstStarted = false;/);
    expect(body).toMatch(
      /if \(!burstStarted\) \{\s*burstStarted = true;\s*this\.editBursts \+= 1;\s*\}/,
    );
  });

  it('editBursts starts at 0 on a fresh modal instance — absent-signal-distinct: 0 before any input, 1 after one', () => {
    expect(modal).toMatch(/private editBursts = 0;/);
  });

  it('firstEditAtMs is stamped, through this.now(), on the first input event only', () => {
    expect(modal).toMatch(
      /if \(this\.firstEditAtMs === null\) this\.firstEditAtMs = this\.now\(\)\.getTime\(\);/,
    );
  });
});

describe('ExplainBackModal counter 6: editBursts lives on the modal instance and survives a re-render', () => {
  it('editBursts is a private instance field, never reset outside its own initializer', () => {
    // Exactly one assignment site for `this.editBursts` in the whole file:
    // the `+= 1` inside the input listener. If a second site ever set it
    // back to 0 (e.g. alongside `presentedAtMs`'s reset at discard), the
    // count would NOT survive a discard-and-retry re-render, which is
    // exactly the bug this scenario guards against.
    const assignments = modal.match(/this\.editBursts (\+=|=)/g) ?? [];
    expect(assignments).toEqual(['this.editBursts +=']);
  });

  it('firstEditAtMs, unlike editBursts, IS reset alongside presentedAtMs — at all three re-stamp sites', () => {
    // `firstEditMs` shares `durationMs`'s "this attempt" clock origin
    // (`presentedAtMs`), so it resets everywhere `presentedAtMs` does:
    // `resolveInstrumentPrompt`, `resolveTopicPrompt`, `discardGrading`.
    const stamps = modal.match(/this\.presentedAtMs = this\.now\(\)\.getTime\(\);/g) ?? [];
    const resets = modal.match(/this\.firstEditAtMs = null;/g) ?? [];
    expect(stamps).toHaveLength(3);
    expect(resets).toHaveLength(3);
  });

  it('answerEdits is sealed once, at submitAnswer, and carried through to recordSoloGradeAndReview unconditionally', () => {
    expect(modal).toMatch(/const answerEdits: ModalAnswerEdits = \{/);
    // Never conditionally spread (unlike `supportLevelShown`) — this field
    // is always computable for a genuine submit through this view. Bare
    // `answerEdits,` (not `answerEdits,\n\s*});`): `ol-egov.141.89.6.50`
    // appended `sourceMaterial`/`relationExpected` after it, so this no
    // longer has to be the LAST field, only present unconditionally.
    expect(modal).toMatch(
      /await this\.deps\.recordSoloGradeAndReview\(\{[\s\S]{0,900}?\n\s*answerEdits,\n/,
    );
  });

  it('answerEdits is threaded through the grading and graded phases, and to acceptGrading on Accept', () => {
    expect(modal).toMatch(
      /this\.state = \{ phase: 'grading', prompt, answer, durationMs, attemptId, answerEdits \};/,
    );
    expect(modal).toMatch(
      /this\.state = \{ phase: 'graded', prompt, answer, pending, durationMs, attemptId, answerEdits \};/,
    );
    expect(modal).toMatch(
      /this\.acceptGrading\(prompt, answer, pending, durationMs, attemptId, answerEdits\)/,
    );
  });
});

describe('ExplainBackModal counter 7: nothing about the count is ever rendered', () => {
  it('editBursts and firstEditAtMs are never passed to a DOM-creating call anywhere in the file', () => {
    // Every DOM-creating call in this file is `createEl`/`createDiv`/
    // `createSpan`/`setText`/`appendChild` (Obsidian's `HTMLElement`
    // helpers) — none of them may ever appear on the same statement as
    // either capture field.
    const domCreators = /\.(createEl|createDiv|createSpan|setText)\(/;
    for (const line of modal.split('\n')) {
      if (/editBursts|firstEditAtMs/.test(line)) {
        expect(line).not.toMatch(domCreators);
      }
    }
  });

  it('the input listener body creates no DOM and renders nothing', () => {
    const renderStart = modal.indexOf('private renderAnsweringPhase(');
    const listenerStart = modal.indexOf("textarea.addEventListener('input',", renderStart);
    const listenerEnd = modal.indexOf('});', listenerStart);
    const listenerBody = modal.slice(listenerStart, listenerEnd);
    expect(listenerBody).not.toMatch(/create(El|Div|Span)\(/);
    expect(listenerBody).not.toMatch(/this\.render\(\)/);
  });
});
