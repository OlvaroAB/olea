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
  it('submitAnswer calls deps.grade unconditionally for any non-blank answer — no overlap/restatement check gates it', () => {
    const start = modal.indexOf('private async submitAnswer(');
    const end = modal.indexOf('private acceptGrading(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    expect(body).toMatch(/this\.deps\.grade\(/);
    // Nothing on the path from a typed answer to deps.grade reads an
    // overlap/restatement measurement to decide whether to call it.
    expect(body).not.toMatch(/restat/i);
    expect(body).not.toMatch(/overlap/i);
  });

  it('ModalState has no restatement-intercept-shaped phase — every phase is one of the eight D-279-compatible states', () => {
    const start = modal.indexOf('type ModalState =');
    const end = modal.indexOf('const SVG_NS');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = modal.slice(start, end);
    const phases = [...body.matchAll(/phase:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(phases)).toEqual(
      new Set([
        'topic',
        'loading',
        'answering',
        'grading',
        'graded',
        'refused',
        'accepted',
        'skipped',
      ]),
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

  it('no result-phase render method shows an "in your own words" / restatement string — the optional copy is off, not placed without a clause', () => {
    // renderGradedPhase and renderAcceptedPhase are the two result-facing
    // render methods (the "graded" detail screen and the post-accept
    // screen). Neither D-089 s.6 nor F5.3 names when the optional copy
    // should show, so it is kept off entirely (the safe direction) rather
    // than placed on a guess.
    const gradedStart = modal.indexOf('private renderGradedPhase(');
    const gradedEnd = modal.indexOf('private renderGradedRegions(');
    const acceptedStart = modal.indexOf('private renderAcceptedPhase(');
    const acceptedEnd = modal.indexOf('private renderSkippedPhase(');
    expect(gradedStart).toBeGreaterThan(-1);
    expect(acceptedStart).toBeGreaterThan(-1);
    const gradedBody = modal.slice(gradedStart, gradedEnd);
    const acceptedBody = modal.slice(acceptedStart, acceptedEnd);
    expect(gradedBody).not.toMatch(/own words/i);
    expect(acceptedBody).not.toMatch(/own words/i);
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
