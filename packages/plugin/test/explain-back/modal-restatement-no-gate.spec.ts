/**
 * `ol-egov.141.89.6.26`: `[D-279]` (superseding `[D-089]` section 6 and
 * `[D-138]`) rules that there is NO restatement gate anywhere in the
 * product — the overlap between her answer and the source is a measured
 * signal only, never a verdict, never an intercept, never a compelled
 * elaboration before she may proceed. `[D-089]`'s ratified "in your own
 * words" wording survives only as OPTIONAL copy shown on a RESULT, never as
 * a gate in front of one.
 *
 * This bead found no restatement-gate code anywhere in this file (confirmed
 * by a fresh full read against today's source, after several same-day
 * changes to `modal.ts`) — `submitAnswer` calls `deps.grade` unconditionally
 * for any non-blank answer, and `ModalState` has no intercept-shaped phase.
 * So there was nothing to remove; this file pins that absence as a
 * regression test rather than leaving the invariant unasserted, the same
 * "obsidian cannot be imported under Vitest" workaround
 * `submit-guard.spec.ts`'s own module doc documents and this file reuses
 * verbatim (structural assertions against the extracted source text, never
 * an import of the class).
 *
 * Also pins the companion half of the acceptance criteria: neither this file
 * nor `review/copy.ts` (this bead's other owned file) renders the ratified
 * "in your own words" / restatement copy as optional display text on the
 * result. Neither `[D-089]` section 6 nor F5 (`features/F5-explain-it-
 * back.md`, `docs/Olea_alpha_functional_scope.md` F5.3) states WHEN or on
 * which result that optional copy should appear — F5.3 only ever names the
 * five-step depth description as "the line above the detail" on the result
 * view, and D-319's ruling (2026-09-25) sends a restates-source finding, if
 * one is ever built, to a separate chain-build bead (`ol-egov.141.89.6.4`)
 * with its own semantic criteria, never a lexical-overlap display. Absent a
 * clause naming a placement, the safe direction is to keep the copy off, so
 * this test also pins that absence — never inventing a placement no
 * document names.
 *
 * **v0.9 (`[D-603]`, `ol-egov.141.89.6.129`):** nothing is graded, so the answer reaches no grader
 * at all; the absence of a gate now reads: a non-blank "Show the passages" always shows the
 * passages, with no overlap or restatement check in front of them, and the passages phase shows
 * no "own words" line.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with comments removed, same technique `submit-guard.spec.ts` uses. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modalWithComments = readFileSync(`${srcDir}explain-back/modal.ts`, 'utf8');
const modal = codeOf('explain-back/modal.ts');
const reviewCopy = codeOf('review/copy.ts');

describe('ExplainBackModal — no restatement gate exists (D-279 supersedes D-089 s.6/D-138)', () => {
  it('submitAnswer shows the passages for any non-blank answer — no overlap/restatement check gates them', () => {
    const start = modal.indexOf('private async submitAnswer(');
    const end = modal.indexOf('private async recordFeedbackShownBeforeDisplay(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(/this\.state = \{ phase: 'passages'/);
    expect(body).not.toMatch(/this\.deps\.grade\(/);
    // Nothing on the path from a typed answer to the passages reads an overlap/restatement measurement.
    expect(body).not.toMatch(/restat/i);
    expect(body).not.toMatch(/overlap/i);
  });

  it('ModalState has no restatement-intercept-shaped phase — every phase is one of the six v0.9 states', () => {
    const start = modal.indexOf('type ModalState =');
    const end = modal.indexOf('export class ExplainBackModal');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    const phases = [...body.matchAll(/phase:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(phases)).toEqual(
      new Set(['topic', 'loading', 'answering', 'revealing', 'passages', 'skipped']),
    );
    expect(body).not.toMatch(/restat/i);
    expect(body).not.toMatch(/overlap/i);
  });

  it('the whole file contains no restatement/overlap gate vocabulary at all — nothing to intercept with', () => {
    expect(modal).not.toMatch(/restat/i);
    expect(modal).not.toMatch(/overlap/i);
  });

  it('the ratified D-089 s.6 intercept wording is not present anywhere, including comments — it was never reintroduced', () => {
    // The brief's exact ratified sentence (docs/direction/briefs/08-refusal-
    // posture.md line 175, service repo): "You are just quoting your notes.
    // Try explaining it in your own words to prove you understand it." No
    // fragment of that punitive framing appears, commented or live.
    expect(modalWithComments).not.toMatch(/just quoting your notes/i);
    expect(modalWithComments).not.toMatch(/prove you understand/i);
  });

  it('the one phase shown after an answer shows no "in your own words" / restatement string — the optional copy is off, not placed without a clause', () => {
    // renderPassagesPhase is the one phase after an answer in v0.9. Neither D-089 s.6 nor F5.3
    // names when the optional copy should show, so it stays off (the safe direction).
    const start = modal.indexOf('private renderPassagesPhase(');
    const end = modal.indexOf('private renderSkippedPhase(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(modal.slice(start, end)).not.toMatch(/own words/i);
  });
});

describe('review/copy.ts — no restatement-gate copy exists (D-279)', () => {
  it('contains no restatement/overlap gate vocabulary', () => {
    expect(reviewCopy).not.toMatch(/restat/i);
    expect(reviewCopy).not.toMatch(/overlap/i);
  });

  it('does not export the ratified D-089 s.6 intercept wording as a gate prompt', () => {
    expect(reviewCopy).not.toMatch(/just quoting your notes/i);
    expect(reviewCopy).not.toMatch(/prove you understand/i);
  });
});
