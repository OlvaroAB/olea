/**
 * `[ol-egov.141.89.6.18]` — the full-depth-first-time encouragement had no
 * first-time check at all: `explainBackFullDepthEncouragement`
 * (`review/copy.ts:315`) is only a correctness proxy ("correct, with nothing
 * the grader found to flag") and its own doc says the caller must confirm
 * this is genuinely the first full-depth explanation ever, and that no
 * caller did so. `modal.ts`'s only caller invoked it unconditionally
 * whenever the accept result was `'accepted'`, so every REPEAT full-depth
 * explanation of an already-mastered concept printed the milestone sentence
 * again — a fact Olea had not measured (F6.8, "no invented progress"), and
 * in effect a correctness/depth verdict printed via wording (`[D-217]`).
 *
 * `isConfirmedFirstFullDepth` (`explain-back/modal.ts`) is the fix: a pure,
 * directly-testable gate `computeAcceptGrading` now checks before it will
 * even call `explainBackFullDepthEncouragement`. It defaults to UNCONFIRMED
 * (safe direction) whenever first-time-ness cannot actually be checked —
 * `getMasteryState` unwired (`main.ts`'s current construction call omits it,
 * confirmed by `main-wiring.spec.ts`'s own inventory) or a free-form topic
 * entry with no concept.
 *
 * Two halves, for the reason every other `modal.ts` spec in this directory
 * gives: `modal.ts` extends Obsidian's `Modal` and cannot be instantiated
 * (or even imported) under Vitest (`obsidian`'s `package.json` `main` is
 * `""`). The gate itself lives in a separate, `obsidian`-free file
 * (`./first-full-depth.ts`, following `./solo-review.ts`'s own precedent
 * for exactly this constraint) and is tested directly with real inputs, not
 * regex; that `modal.ts` actually calls it, before the write that would let
 * it see its own attempt, is checked against the source text with comments
 * stripped (`modal-idempotency.spec.ts`'s own technique) so a doc paragraph
 * describing the wiring can't satisfy an assertion that the wiring exists.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isConfirmedFirstFullDepth } from '../../src/explain-back/first-full-depth.js';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with comments removed — see this file's module doc. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');
const mainTs = codeOf('main.ts');

describe('isConfirmedFirstFullDepth — the safe default is unconfirmed', () => {
  it('unconfirmed when getMasteryState is not wired, whatever the concept', () => {
    expect(isConfirmedFirstFullDepth('concept-1', undefined)).toBe(false);
  });

  it('unconfirmed for a free-form topic entry (no concept id), even if getMasteryState is wired', () => {
    expect(isConfirmedFirstFullDepth(null, () => 'seed')).toBe(false);
  });

  it('unconfirmed when the mastery state itself is unknown (null) — never treated as "not tree" by default', () => {
    expect(isConfirmedFirstFullDepth('concept-1', () => null)).toBe(false);
  });

  it("REGRESSION: unconfirmed when the concept already reached the top growth stage — a repeat full-depth explanation, exactly the bug's reported case", () => {
    expect(isConfirmedFirstFullDepth('concept-1', () => 'tree')).toBe(false);
  });

  it('confirmed for every pre-tree growth stage, where firstness can actually be checked', () => {
    for (const state of ['seed', 'sprout', 'sapling'] as const) {
      expect(isConfirmedFirstFullDepth('concept-1', () => state)).toBe(true);
    }
  });

  it('reads by the concept id it is given, not a fixed id', () => {
    const seen: string[] = [];
    isConfirmedFirstFullDepth('concept-42', (id) => {
      seen.push(id);
      return 'seed';
    });
    expect(seen).toEqual(['concept-42']);
  });
});

describe('computeAcceptGrading gates the milestone sentence on the confirmed-first-time check', () => {
  it('resolves isConfirmedFirstFullDepth before either write this call makes (the correctness accept, then the SOLO depth write)', () => {
    const body = modal.slice(
      modal.indexOf('private async computeAcceptGrading('),
      modal.indexOf('private renderMasteryTag('),
    );
    expect(body.length).toBeGreaterThan(0);
    const gateIndex = body.indexOf('isConfirmedFirstFullDepth(');
    const acceptWriteIndex = body.indexOf('this.deps.acceptWithObservation(');
    const soloWriteIndex = body.indexOf('this.deps.recordSoloGradeAndReview(');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(acceptWriteIndex).toBeGreaterThan(-1);
    expect(soloWriteIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(acceptWriteIndex);
    expect(gateIndex).toBeLessThan(soloWriteIndex);
  });

  it('never calls explainBackFullDepthEncouragement except behind that gate', () => {
    const body = modal.slice(
      modal.indexOf('private async computeAcceptGrading('),
      modal.indexOf('private renderMasteryTag('),
    );
    expect(body).toMatch(/explainBackFullDepthEncouragement\(result\.accepted\)/);
    // The call sits inside a conditional keyed on the gate's own result —
    // not merely present somewhere in the same function body.
    const gateVarMatch = body.match(/const (\w+) = isConfirmedFirstFullDepth\(/);
    expect(gateVarMatch).not.toBeNull();
    const gateVar = gateVarMatch?.[1] ?? '';
    expect(body).toMatch(
      new RegExp(
        `${gateVar}\\s*\\?\\s*explainBackFullDepthEncouragement\\(result\\.accepted\\)\\s*:\\s*null`,
      ),
    );
  });
});

describe('main.ts wires getMasteryState into the modal (ol-egov.141.89.6.41), so the gate is live in production', () => {
  it("openExplainBackModal's construction call supplies a getMasteryState field", () => {
    const start = mainTs.indexOf('private openExplainBackModal(');
    expect(start).toBeGreaterThan(-1);
    // Scan a generous window after the method start for the deps object
    // literal it builds; getMasteryState must now appear in it.
    const window = mainTs.slice(start, start + 4000);
    expect(window).toMatch(/getMasteryState:/);
  });
});
