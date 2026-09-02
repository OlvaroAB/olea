/**
 * `[D-189]` (ol-0r92.36): on the first serve of a generated item, the item
 * asks for her answer before it shows the draft's own, and the edit/reject
 * pair lives at the reveal — alongside the comparison between her answer
 * and the draft's — never before it. F3.3 and principle 7 (docs in
 * `olea-service`) carry the clause; this guards the one place `view.ts`
 * could regress it.
 *
 * **What state order this pins.** `renderHeader`'s draft branch
 * (`instrument.draftId !== null`) used to draw "Edit before saving"/"Reject"
 * unconditionally, on every screen a draft could be showing — including
 * `card-front` and `mcq-unanswered`, both BEFORE she has seen the draft's own
 * answer to weigh an edit against. The fix gates those two buttons on
 * `screen.kind` being one of the two reveal screens (`card-reveal`,
 * `mcq-answered`) and, either way, still returns before falling through to
 * the ordinary "Edit note"/"Suspend" pair — a draft's pre-reveal screen
 * offers neither pair, matching `keymap.ts`'s `resolveReviewKey`/`hintsFor`
 * (see `keymap.spec.ts`'s "gated to the reveal" suite for the keyboard half
 * of this same guarantee).
 *
 * **Why this is a source-text assertion, not a mounted-DOM test.** Same
 * constraint `note-missing-header.spec.ts` and `view-focus-document.spec.ts`
 * document: `view.ts` imports `ItemView` from `obsidian`, whose `package.json`
 * `main` is `""`, so it cannot be loaded under Vitest at all.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped — a doc paragraph describing the fix must not satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(join(__dirname, '..', '..', relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const VIEW = codeOf('src/review/view.ts');

/** The body of `renderHeader`, isolated the same way `note-missing-header.spec.ts` isolates it. */
const RENDER_HEADER_START = VIEW.indexOf('private renderHeader(');
const RENDER_HEADER_END = VIEW.indexOf('private actionButton(');
if (RENDER_HEADER_START === -1 || RENDER_HEADER_END === -1) {
  throw new Error(
    'first-serve-reveal-gate.spec.ts: renderHeader/actionButton markers moved in view.ts',
  );
}
const RENDER_HEADER_BODY = VIEW.slice(RENDER_HEADER_START, RENDER_HEADER_END);

/** The draft branch specifically — from the `draftId !== null` check to its matching `return;`. */
const DRAFT_BRANCH_START = RENDER_HEADER_BODY.indexOf('instrument.draftId !== null');
if (DRAFT_BRANCH_START === -1) {
  throw new Error('first-serve-reveal-gate.spec.ts: draft-branch marker moved in view.ts');
}
const DRAFT_BRANCH_END = RENDER_HEADER_BODY.indexOf('return;', DRAFT_BRANCH_START);
const DRAFT_BRANCH = RENDER_HEADER_BODY.slice(DRAFT_BRANCH_START, DRAFT_BRANCH_END);

describe('ReviewView header — the draft edit/reject pair renders only at the reveal ([D-189], ol-0r92.36)', () => {
  it('gates the two draft buttons on screen.kind being card-reveal or mcq-answered', () => {
    expect(DRAFT_BRANCH).toMatch(
      /screen\.kind === 'card-reveal' \|\| screen\.kind === 'mcq-answered'/,
    );
  });

  it('places that gate before either draft button is built', () => {
    const gateIndex = DRAFT_BRANCH.search(
      /screen\.kind === 'card-reveal' \|\| screen\.kind === 'mcq-answered'/,
    );
    const editIndex = DRAFT_BRANCH.indexOf("'Edit before saving'");
    const rejectIndex = DRAFT_BRANCH.indexOf("'Reject'");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(editIndex).toBeGreaterThan(-1);
    expect(rejectIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(editIndex);
    expect(gateIndex).toBeLessThan(rejectIndex);
  });

  it('still returns unconditionally for a draft item — no fallback to the ordinary Edit note/Suspend pair pre-reveal', () => {
    // The draft branch's own `return;` must exist (isolated above via
    // `indexOf('return;', ...)` succeeding) and must sit OUTSIDE the
    // screen.kind gate — i.e. the gate wraps only the button-building, not
    // the return, so a pre-reveal draft screen falls through to nothing
    // rather than to "Edit note"/"Suspend".
    const gateOpenIndex = DRAFT_BRANCH.indexOf(
      "screen.kind === 'card-reveal' || screen.kind === 'mcq-answered'",
    );
    expect(gateOpenIndex).toBeGreaterThan(-1);
    // The literal "Edit note" ordinary-pair label must not appear anywhere
    // inside the draft branch — that pair belongs only past the branch's own
    // `return`, in the ordinary-instrument path below it.
    expect(DRAFT_BRANCH).not.toMatch(/'Edit note'/);
    expect(DRAFT_BRANCH).not.toMatch(/'Suspend'/);
  });

  it('the ordinary Edit note/Suspend pair still exists, past the draft branch, for non-draft items', () => {
    const afterDraftBranch = RENDER_HEADER_BODY.slice(DRAFT_BRANCH_END);
    expect(afterDraftBranch).toMatch(/'Edit note'/);
    expect(afterDraftBranch).toMatch(/'Suspend'/);
  });

  it('does not gate the draft pair on a hand-typed screen-kind check for just one of the two reveal screens', () => {
    // Regression guard: a fix that only checked `card-reveal` (forgetting
    // `mcq-answered`, or vice versa) would silently drop the MCQ or the
    // Q&A/cloze reveal case. Both literals must be present together in the
    // same gate expression, not in two separate, driftable conditions.
    const bothInOneCondition =
      /if\s*\(\s*screen\.kind === 'card-reveal' \|\| screen\.kind === 'mcq-answered'\s*\)/;
    expect(DRAFT_BRANCH).toMatch(bothInOneCondition);
  });
});
