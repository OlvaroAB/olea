/**
 * Scenario: `features/F2-review.md`, "F2.16 — One rating mapping, not two" —
 * @auto:plugin/review/rating-source.spec.
 *
 * `packages/plugin/src/review/rating.ts` existed from P2-T08 until run 9's
 * Lane 3. It was three lines, it was correct, and its own module doc said what
 * to do about it: *"When `ol-p2t06` lands its core module, this file should be
 * replaced by an import from it rather than kept as a second implementation."*
 * `ol-p2t06` landed. The file did not go, and for a while the product carried
 * two implementations of F2.16 — each with its own passing test, which is
 * exactly the state in which two implementations drift without either suite
 * noticing.
 *
 * Deleting it fixes today. This suite is what stops it coming back, and it is a
 * source-tree assertion for the same reason `today/styles.spec.ts` is one: the
 * property being asserted is *about the code*, not about a value the code
 * produces, and there is no runtime observation that distinguishes "the plugin
 * calls core's mapping" from "the plugin has an identical copy".
 *
 * ## What counts as a rating mapping here
 *
 * A module that turns a *correctness or confidence signal* into a `Rating`.
 * That is deliberately narrower than "mentions a rating": `keymap.ts` maps the
 * digits 1-4 onto the four ratings and `interval.ts` orders them for the button
 * row, and both are presentation, not F2.16. The distinguishing evidence is
 * whether the same module also handles `correct`/`wasUnsure` — the two facts
 * F2.16 says must travel separately as far as the mapping and no further.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const reviewSrc = fileURLToPath(new URL('../../src/review/', import.meta.url));

/** Source with prose removed — a doc paragraph explaining the rule must not satisfy the rule. */
function codeOf(file: string): string {
  return readFileSync(reviewSrc + file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function reviewModules(): readonly string[] {
  return readdirSync(reviewSrc)
    .filter((f) => f.endsWith('.ts'))
    .sort();
}

const RATING_LITERAL = /'(again|hard|good|easy)'/;
const OUTCOME_SIGNAL = /\bwasUnsure\b|\bcorrect\b/;

describe('F2.16 lives in olea-core, and the plugin has no second copy', () => {
  it('the provisional stand-in is gone, not merely unused', () => {
    expect(existsSync(`${reviewSrc}rating.ts`)).toBe(false);
  });

  it('no review module turns a correctness or confidence signal into a rating', () => {
    const offenders = reviewModules().filter((file) => {
      const code = codeOf(file);
      return RATING_LITERAL.test(code) && OUTCOME_SIGNAL.test(code);
    });
    expect(offenders).toEqual([]);
  });

  it('no review module declares a mapper of its own', () => {
    const offenders = reviewModules().filter((file) =>
      /\b(function|const)\s+map(Mcq|Card|Review)\w*\s*[(=]/.test(codeOf(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('the session reaches for core, by name', () => {
    const code = codeOf('session.ts');
    // Named in the `olea-core` import list — not necessarily alone in it.
    // `ol-v7r5.40` added `STRONG_RECALL_PROPOSAL_TRIGGER` beside it, which is
    // the same discipline this suite is defending (reach for core's literal,
    // never hand-type one), so pinning `mapMcqRating` as the SOLE import was
    // asserting a coincidence rather than the rule.
    expect(code).toMatch(/import\s*\{[^}]*\bmapMcqRating\b[^}]*\}\s*from\s*'olea-core'/);
  });

  it('the rating literals that remain are keyboard and layout order, not a decision', () => {
    // Stated rather than left implicit: these two files are *expected* to name
    // the four ratings, and the guard above only lets them because neither
    // knows what "correct" means.
    const naming = reviewModules().filter((file) => RATING_LITERAL.test(codeOf(file)));
    expect(naming).toEqual(['interval.ts', 'keymap.ts']);
  });
});
