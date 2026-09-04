/**
 * `today/view.ts`'s contest-gesture guard (`ol-3ux7.64.20`, ruled 2026-09-04):
 * a Today claim whose `conceptIds` comes back empty (her course has no
 * concept layer yet) must not render the contest gesture at all —
 * `contestClaim`'s "must name at least one concept" precondition
 * (`packages/core/src/review-log/contest.ts`) stays as is, so a claim that
 * would only fail it never offers the tap.
 *
 * Also pins the fix for the swallowed-throw half of the same bead: the
 * `.olea-today-contest-record` click used to run as
 * `void this.recordDispute()`, and `recordDispute` itself had no
 * `try`/`catch` around `support.contest(claim)` — so a throw there (as
 * happened for a concept-less claim before the render guard existed) left
 * the dispute sheet open forever with no visible error. `recordDispute` now
 * catches and logs instead.
 *
 * **Why this is a source-text assertion, not a mounted-DOM test.** Same
 * constraint `packages/plugin/test/review/view.spec.ts` documents:
 * `today/view.ts` imports `ItemView` from `obsidian`, whose `package.json`
 * `main` is `""`, so it cannot be loaded under Vitest at all. The pure claim
 * model half of this fix (`claimHasConcepts`) is unit-tested directly in
 * `packages/core/src/today/contest.spec.ts`; this file only pins that
 * `view.ts` actually calls it in the right place, and that the record path
 * no longer swallows a throw.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped — a doc paragraph describing the guard must not satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(join(__dirname, '..', '..', relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const VIEW = codeOf('src/today/view.ts');

/** The body of `renderContestGesture`, isolated so assertions about it can't be satisfied by unrelated code elsewhere in the file. */
const RENDER_START = VIEW.indexOf('private renderContestGesture(');
const RENDER_END = VIEW.indexOf('private async openDisputeSheet(');
if (RENDER_START === -1 || RENDER_END === -1) {
  throw new Error('view.spec.ts: renderContestGesture markers moved in view.ts');
}
const RENDER_BODY = VIEW.slice(RENDER_START, RENDER_END);

/** The body of `recordDispute`, isolated the same way — sliced to the next `private` method after it. */
const RECORD_START = VIEW.indexOf('private async recordDispute(');
if (RECORD_START === -1) {
  throw new Error('view.spec.ts: recordDispute marker moved in view.ts');
}
const RECORD_END = VIEW.indexOf('private ', RECORD_START + 'private async recordDispute('.length);
const RECORD_BODY = VIEW.slice(RECORD_START, RECORD_END === -1 ? undefined : RECORD_END);

describe('TodayView.renderContestGesture — no gesture for a concept-less claim (ol-3ux7.64.20)', () => {
  it('imports claimHasConcepts from olea-core', () => {
    expect(VIEW).toMatch(/claimHasConcepts/);
  });

  it('guards the gesture render on claimHasConcepts(claim), before any DOM is created', () => {
    const domIndex = RENDER_BODY.indexOf('createDiv');
    const guardIndex = RENDER_BODY.indexOf('if (!claimHasConcepts(claim)) return;');
    expect(guardIndex, 'expected an early return guarded by claimHasConcepts').toBeGreaterThan(-1);
    expect(domIndex, 'expected the gesture row to be built with createDiv').toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(domIndex);
  });
});

describe('TodayView.recordDispute — a throw no longer leaves the sheet silently open', () => {
  it('wraps support.contest(claim) in a try/catch', () => {
    expect(RECORD_BODY).toMatch(/try\s*\{[\s\S]*support\.contest\(claim\)[\s\S]*\}\s*catch/);
  });

  it('logs the caught error rather than swallowing it', () => {
    const catchIndex = RECORD_BODY.indexOf('catch');
    expect(catchIndex).toBeGreaterThan(-1);
    const catchBlock = RECORD_BODY.slice(catchIndex);
    expect(catchBlock).toMatch(/console\.error\(/);
  });

  it('does not rebuild openSheet or refresh() after a caught error (never falsely reports success)', () => {
    const catchIndex = RECORD_BODY.indexOf('catch');
    const successIndex = RECORD_BODY.indexOf('this.openSheet = { claimId: open.claimId');
    expect(catchIndex).toBeGreaterThan(-1);
    expect(
      successIndex,
      'expected the success path to rebuild openSheet, not clear it',
    ).toBeGreaterThan(-1);
    // The success path's rebuild must come after the whole try/catch, i.e.
    // after the catch block's own closing brace — checked structurally by
    // requiring a `return;` inside the catch block before it.
    const catchToSuccess = RECORD_BODY.slice(catchIndex, successIndex);
    expect(catchToSuccess).toMatch(/return;/);
  });
});

describe('TodayView.recordDispute — the recorded state stays visible (ol-l5og.18.12 [STY-3], `[D-046]` clause 4)', () => {
  it('rebuilds the sheet from support.sheetFor(claim) on the success path, rather than closing it', () => {
    expect(RECORD_BODY).toMatch(
      /this\.openSheet = \{ claimId: open\.claimId, sheet: await support\.sheetFor\(claim\) \};/,
    );
  });

  it('never sets openSheet back to null on the success path', () => {
    // The only `= null` allowed in this method is none at all any more —
    // closing the sheet on a successful record is exactly the bug (goldens
    // byte-identical before/after) `ol-l5og.18.12` fixes.
    expect(RECORD_BODY).not.toMatch(/this\.openSheet = null;/);
  });
});
