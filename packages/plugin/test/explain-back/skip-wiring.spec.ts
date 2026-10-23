/**
 * `ol-0r92.104` [DOS-I9] (`[D-273]`, `[D-304]`, `[D-305]`, `[D-306]`): that
 * `modal.ts` actually wires the named skip action and the
 * close-without-answering path the way the acceptance criteria require —
 * checked against the source text with comments stripped, the same
 * technique `submit-guard.spec.ts` and `modal-first-full-depth.spec.ts`
 * already use for anything that lives inside `ExplainBackModal`, which
 * cannot be imported under Vitest (`obsidian`'s `package.json` `main` is
 * `""`).
 *
 * **v0.9 (`[D-603]`, `ol-egov.141.89.6.129`):** nothing is graded, so "never reaches the grader"
 * now reads "reaches no grader and no passage": a skip shows nothing, and the one path to the
 * passages is `submitAnswer`, which a skip never reaches (F5.2: the passages follow an answer,
 * never a skip).
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
  expect(start).toBeGreaterThan(-1);
  const end = modal.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return modal.slice(start, end);
}

describe('the named skip action exists and is distinct from the empty-submit guard', () => {
  it("renderAnsweringPhase wires a second button, labelled EXPLAIN_BACK_SKIP_LABEL, to skipPrompt — not to the submit guard's click handler", () => {
    const body = bodyBetween('private renderAnsweringPhase(', 'private renderExplanation(');
    expect(body).toMatch(/text: EXPLAIN_BACK_SKIP_LABEL/);
    expect(body).toMatch(
      /skip\.addEventListener\(\s*'click',\s*\(\)\s*=>\s*this\.skipPrompt\(prompt\)\s*\)/,
    );
  });

  it('skipPrompt never calls deps.grade, directly or through submitAnswer', () => {
    const body = bodyBetween('private skipPrompt(', 'private async recordNonAttemptIfPossible(');
    expect(body).not.toMatch(/deps\.grade\(/);
    expect(body).not.toMatch(/this\.submitAnswer\(/);
  });

  it('deps.grade is called from nowhere in v0.9, and the passages are reached only through submitAnswer, which skipPrompt never reaches', () => {
    expect(modal).not.toMatch(/this\.deps\.grade\(/);
    expect(modal.match(/this\.state = \{ phase: 'passages'/g)).toHaveLength(1);
    const submitAnswerBody = bodyBetween(
      'private async submitAnswer(',
      'private async recordFeedbackShownBeforeDisplay(',
    );
    expect(submitAnswerBody).toMatch(/this\.state = \{ phase: 'passages'/);
  });

  it('skipPrompt is a separate method from the empty-submit guard, called from a separate button', () => {
    expect(modal).toMatch(/private skipPrompt\(prompt: ResolvedPrompt\): void \{/);
    expect(modal).toMatch(/if \(isBlankExplainBackAnswer\(textarea\.value\)\) return;/);
    // Two distinct click handlers in renderAnsweringPhase: the submit
    // button's guard-then-submit, and the skip button's direct skipPrompt.
    const body = bodyBetween('private renderAnsweringPhase(', 'private renderExplanation(');
    const clickHandlers = body.match(/addEventListener\(\s*'click'/g) ?? [];
    expect(clickHandlers.length).toBeGreaterThanOrEqual(2);
  });
});

describe('a skip writes one non-attempt record and calls no grader', () => {
  it('skipPrompt calls recordNonAttemptIfPossible, then transitions straight to the skipped phase', () => {
    const body = bodyBetween('private skipPrompt(', 'private async recordNonAttemptIfPossible(');
    expect(body).toMatch(/void this\.recordNonAttemptIfPossible\(prompt\);/);
    expect(body).toMatch(/this\.state = \{ phase: 'skipped' \};/);
  });

  it('recordNonAttemptIfPossible gates on canRecordNonAttempt and the optional deps.recordNonAttempt, and is the only caller of deps.recordNonAttempt', () => {
    const calls = modal.match(/this\.deps\.recordNonAttempt\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const body = bodyBetween(
      'private async recordNonAttemptIfPossible(',
      'private render(): void {',
    );
    expect(body).toMatch(/canRecordNonAttempt\(prompt\.conceptIds\)/);
    expect(body).toMatch(/this\.deps\.recordNonAttempt\(/);
  });

  it('a failed non-attempt write is caught and logged, never thrown', () => {
    const start = modal.indexOf('private async recordNonAttemptIfPossible(');
    expect(start).toBeGreaterThan(-1);
    const body = modal.slice(start, start + 800);
    expect(body).toMatch(/try \{/);
    expect(body).toMatch(/catch \(error\) \{/);
    expect(body).toMatch(/console\.error\(/);
  });
});

describe('closing without answering is recorded exactly as a skip is ([D-306])', () => {
  it("onClose fires recordNonAttemptIfPossible only when the phase is 'answering'", () => {
    const body = bodyBetween(
      'override onClose(): void {',
      'private async resolveInstrumentPrompt(',
    );
    expect(body).toMatch(
      /if \(this\.state\.phase === 'answering'\) void this\.recordNonAttemptIfPossible\(this\.state\.prompt\);/,
    );
  });

  it('onClose still empties contentEl and fires deps.onClosed unconditionally, exactly as before this bead', () => {
    const body = bodyBetween(
      'override onClose(): void {',
      'private async resolveInstrumentPrompt(',
    );
    expect(body).toMatch(/this\.contentEl\.empty\(\);/);
    expect(body).toMatch(/this\.deps\.onClosed\?\.\(\);/);
  });
});

describe('a skip closes the prompt with no result line ([D-305])', () => {
  it('renderSkippedPhase renders only the shared Done button — no heading, no message, no other text node', () => {
    const start = modal.indexOf('private renderSkippedPhase(root: HTMLElement): void {');
    expect(start).toBeGreaterThan(-1);
    const end = modal.indexOf('\n  }', start) + 4;
    const body = modal.slice(start, end);
    expect(body).toMatch(/this\.renderDoneButton\(root\);/);
    expect(body).not.toMatch(/createEl\(\s*'p'/);
    expect(body).not.toMatch(/createDiv\(/);
  });

  it("every Done button reads registry §39's one constant, never a separately-typed 'Done' string", () => {
    expect(modal).not.toMatch(/text:\s*'Done'/);
    expect(modal.match(/text: EXPLAIN_BACK_DONE_LABEL/g)).toHaveLength(2);
    expect(modal).toMatch(/private renderDoneButton\(root: HTMLElement\): void \{/);
  });

  it('the skipped phase is reached only from skipPrompt, never given a message or a soloLevel', () => {
    const occurrences = modal.match(/phase: 'skipped'/g) ?? [];
    // ModalState's own type declaration, plus exactly one assignment site.
    expect(occurrences).toHaveLength(2);
  });
});

describe('non-attempt conceptIds: the full instrument list for an instrument prompt, none for a topic prompt', () => {
  it('resolveInstrumentPrompt threads instrument.conceptIds onto ResolvedPrompt.conceptIds, unnarrowed', () => {
    const body = bodyBetween(
      'private async resolveInstrumentPrompt(',
      'private async resolveTopicPrompt(',
    );
    expect(body).toMatch(/conceptIds: instrument\.conceptIds,/);
  });

  it('resolveTopicPrompt’s one ResolvedPrompt (refused or answered) reads the computed conceptIds — `[D-322]` (`ol-egov.141.89.6.4`) narrowed the old "always []" to "[] unless the topic matched one concept uniquely"', () => {
    const body = bodyBetween('private async resolveTopicPrompt(', 'private enterNewQuestion(');
    const sharedConceptIds = body.match(/conceptIds,/g) ?? [];
    // One construction, used by the insufficient-notes refusal and the answering phase alike,
    // reading the computed `conceptIds` local, never a literal `[]`.
    expect(sharedConceptIds).toHaveLength(1);
    expect(body).not.toMatch(/conceptIds: \[\],/);
    expect(body).toMatch(
      /const conceptIds = topicMatch\.kind === 'unique' \? \[topicMatch\.conceptId\] : \[\];/,
    );
  });
});

describe('the empty-submit guard is unchanged by this bead, and still distinct from the skip action', () => {
  it('the guard line is untouched: a blank submit still returns before submitAnswer, still calls neither deps.grade nor skipPrompt', () => {
    const body = bodyBetween('private renderAnsweringPhase(', 'private renderExplanation(');
    expect(body).toMatch(
      /if \(isBlankExplainBackAnswer\(textarea\.value\)\) return;\s*void this\.submitAnswer\(prompt, textarea\.value\);/,
    );
  });
});
