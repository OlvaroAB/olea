/**
 * `ol-0r92.98`: an empty or whitespace-only explain-back submit must produce
 * no grading call and no assessment. `modal.ts` extends Obsidian's `Modal`,
 * and `obsidian`'s `package.json` `main` is `""`, so the module cannot be
 * IMPORTED under Vitest at all (confirmed: `import`-ing it fails resolving
 * `obsidian`) — the same documented constraint `modal-duration.spec.ts` and
 * `modal-refusal.spec.ts` already work around by asserting against source
 * text instead. This file follows the same technique: it extracts the
 * exported `isBlankExplainBackAnswer` guard's own function body as text and
 * evaluates that text directly (never `import`-ing the module), so the
 * blank/not-blank behaviour below is asserted against the guard's actual
 * logic, not a hand-written duplicate of it. A second block then checks,
 * structurally, that the submit button's click handler calls this same
 * guard and returns before ever reaching `submitAnswer` — the only path to
 * `deps.grade` in this file — so a click with a blank answer reaches
 * `deps.grade` zero times.
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

/**
 * Extracts `isBlankExplainBackAnswer`'s own source and evaluates it as a
 * standalone function — the guard's real logic, run for real, without
 * importing the `obsidian`-dependent module it lives in.
 */
function extractIsBlankExplainBackAnswer(): (answer: string) => boolean {
  const start = modal.indexOf('export function isBlankExplainBackAnswer');
  expect(start).toBeGreaterThan(-1);
  const end = modal.indexOf('\n}', start) + 2;
  const source = modal
    .slice(start, end)
    .replace('export function', 'return function')
    .replace('(answer: string)', '(answer)')
    .replace('): boolean {', ') {');
  // eslint-disable-next-line no-new-func
  return new Function(source)();
}

describe('isBlankExplainBackAnswer — the submit guard predicate, run for real from its own source', () => {
  const isBlank = extractIsBlankExplainBackAnswer();

  it.each(['', '   ', '\n', '\t\t', ' \n \t '])(
    'treats %j as blank: a submit of it must call deps.grade zero times',
    (blank) => {
      expect(isBlank(blank)).toBe(true);
    },
  );

  it.each(['x', ' a real answer ', 'a\nmulti-line answer'])('treats %j as not blank', (answer) => {
    expect(isBlank(answer)).toBe(false);
  });
});

describe('ExplainBackModal — the submit button guard is actually wired in', () => {
  it("renderAnsweringPhase's submit button returns on a blank answer before ever calling submitAnswer", () => {
    const start = modal.indexOf('private renderAnsweringPhase(');
    const end = modal.indexOf('private renderGradedPhase(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(
      /if \(isBlankExplainBackAnswer\(textarea\.value\)\) return;\s*void this\.submitAnswer\(prompt, textarea\.value\);/,
    );
  });

  it('submitAnswer is the only path to deps.grade in this file, so the guard above is the only thing standing between a click and a grading call', () => {
    const calls = modal.match(/this\.deps\.grade\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const submitAnswerBody = modal.slice(
      modal.indexOf('private async submitAnswer('),
      modal.indexOf('private async acceptGrading('),
    );
    expect(submitAnswerBody).toMatch(/this\.deps\.grade\(/);
  });

  it('the empty-submit guard is not the explicit skip action — the guard itself introduces no skip event', () => {
    // `ol-0r92.104` [DOS-I9] added the real named skip action to this same
    // file, so `modal` now legitimately contains "skip" — this test's job
    // narrows from "the word never appears" to "the guard's own click
    // handler is not where it appears": the guard returns before
    // `submitAnswer` and touches neither `skipPrompt` nor
    // `deps.recordNonAttempt`, so a blank submit still writes no event of
    // any kind, named-skip or otherwise. See `skip-wiring.spec.ts` for the
    // skip action's own, separately-wired tests.
    const guardLine = modal.match(/if \(isBlankExplainBackAnswer\(textarea\.value\)\) return;/);
    expect(guardLine).not.toBeNull();
    const start = modal.indexOf('private renderAnsweringPhase(');
    const end = modal.indexOf('private renderGradedPhase(');
    const body = modal.slice(start, end);
    const guardBlockStart = body.indexOf("button.addEventListener('click', () => {");
    expect(guardBlockStart).toBeGreaterThan(-1);
    const guardBlockEnd = body.indexOf('});', guardBlockStart) + 3;
    const guardBlock = body.slice(guardBlockStart, guardBlockEnd);
    expect(guardBlock).not.toMatch(/skip/i);
  });
});
