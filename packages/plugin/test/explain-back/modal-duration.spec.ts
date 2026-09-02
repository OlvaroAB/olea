/**
 * `ExplainBackModal`'s `durationMs` wiring (`ol-yj0k`) — source-level
 * assertions, not a behavioural test: `modal.ts` extends Obsidian's `Modal`,
 * and `obsidian`'s `package.json` `main` is `""`, so it cannot be loaded
 * under Vitest at all (the same documented constraint `main-wiring.spec.ts`
 * already works around for `main.ts`). That test's own technique is the only
 * instrument available here too — assert against the source text, with
 * comments stripped so a doc paragraph describing the wiring can't satisfy
 * an assertion about the wiring actually existing.
 *
 * What this guards: `docs/dev/proposals/behavioural-signals-capture.md` §3
 * named `solo-review.ts:198`'s hardcoded `durationMs: null` as zero-schema
 * wiring debt — QA/cloze/MCQ already had a working presented-to-rated clock
 * (`review/session.ts:664,673-675`) and explain-back didn't. `solo-review
 * .spec.ts` covers that the value, once supplied, is relayed into the
 * persisted record; it cannot cover where the value comes from, because the
 * two moments being timed (a prompt becoming visible, an answer being
 * submitted) are UI state transitions that only exist in `modal.ts`.
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

describe('ExplainBackModal times an attempt through its own injected clock, never Date.now() at a measurement site', () => {
  it('reads the current time only via this.now(), and falls back to `new Date` in exactly one place — the constructor default for an unwired deps.now', () => {
    const dateConstructions = modal.match(/new Date\(\)/g) ?? [];
    // The ONLY bare `new Date()` allowed in this file is the constructor's
    // fallback for an optional, not-yet-wired `deps.now` — see the class
    // field doc on `now`. Every timing read elsewhere must go through
    // `this.now()`.
    expect(dateConstructions).toHaveLength(1);
    expect(modal).toMatch(/this\.now = deps\.now \?\? \(\(\) => new Date\(\)\);/);
    expect(modal).not.toMatch(/Date\.now\(\)/);
  });

  it('stamps presentedAtMs, through this.now(), every time a prompt enters the answering phase', () => {
    // Initial resolution from an instrument-seeded prompt, a topic-seeded
    // prompt, and re-entry after discarding a grading to retry — three call
    // sites, three fresh presentations.
    const stamps = modal.match(/this\.presentedAtMs = this\.now\(\)\.getTime\(\);/g) ?? [];
    expect(stamps).toHaveLength(3);
  });

  it('computes durationMs at submission from presentedAtMs, guarded against a clock running backwards', () => {
    expect(modal).toMatch(
      /this\.presentedAtMs !== null \? Math\.max\(0, this\.now\(\)\.getTime\(\) - this\.presentedAtMs\) : null/,
    );
  });

  it('carries the computed durationMs through to the recordSoloGradeAndReview call, never re-deriving or dropping it', () => {
    expect(modal).toMatch(
      /await this\.deps\.recordSoloGradeAndReview\(\{[\s\S]{0,300}?durationMs,[\s\S]{0,50}?\}\);/,
    );
  });
});
