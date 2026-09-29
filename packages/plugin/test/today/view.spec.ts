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

describe('TodayView.renderLadderRow — the vitality breakdown is absent, not blank, at zero (ol-l5og.18 STY-5)', () => {
  const LADDER_START = VIEW.indexOf('private renderLadderRow(');
  const LADDER_END = VIEW.indexOf('private renderScope(', LADDER_START);
  if (LADDER_START === -1 || LADDER_END === -1) {
    throw new Error('view.spec.ts: renderLadderRow markers moved in view.ts');
  }
  const LADDER_BODY = VIEW.slice(LADDER_START, LADDER_END);

  it('guards the breakdown element with an early return when every vitality bucket is zero', () => {
    const guardIndex = LADDER_BODY.indexOf(
      'if (!VITALITY_ORDER.some((vitality) => byVitality[vitality] > 0)) return;',
    );
    const createIndex = LADDER_BODY.indexOf(
      "createDiv({ cls: 'olea-today-mastery-ladder-vitality' })",
    );
    expect(guardIndex, 'expected the zero-bucket guard').toBeGreaterThan(-1);
    expect(
      createIndex,
      'expected the breakdown element to still be created on the non-zero path',
    ).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(createIndex);
  });

  it('still creates the dots container unconditionally (the dots stay decorative, not the guard)', () => {
    const dotsIndex = LADDER_BODY.indexOf("createDiv({ cls: 'olea-today-mastery-ladder-dots' })");
    const guardIndex = LADDER_BODY.indexOf(
      'if (!VITALITY_ORDER.some((vitality) => byVitality[vitality] > 0)) return;',
    );
    expect(dotsIndex, 'expected the dots container').toBeGreaterThan(-1);
    expect(dotsIndex).toBeLessThan(guardIndex);
  });
});

describe("TodayView.renderInsightsBody — a withheld effort comparison gets its own explanation (ol-egov.141.89.11.23, David's ruling on ol-egov.141.89.11.20)", () => {
  const BODY_START = VIEW.indexOf('private renderInsightsBody(');
  const BODY_END = VIEW.indexOf('private insightLines(');
  if (BODY_START === -1 || BODY_END === -1) {
    throw new Error('view.spec.ts: renderInsightsBody markers moved in view.ts');
  }
  const BODY = VIEW.slice(BODY_START, BODY_END);

  it("reads effort's comparison-unavailable as its own condition, not folded into not-enough-history", () => {
    expect(BODY).toMatch(
      /effortComparisonUnavailable = insights\.effort\.status === 'comparison-unavailable'/,
    );
  });

  it('reserves too-early for both readings genuinely lacking history — never a withheld comparison', () => {
    expect(BODY).toMatch(
      /genuinelyTooEarly =\s*insights\.spacing\.status === 'not-enough-history' &&\s*insights\.effort\.status === 'not-enough-history'/,
    );
    // `genuinelyTooEarly` is built from status equality checks alone — it
    // never reads `effortComparisonUnavailable`, so a comparison-unavailable
    // reading can never satisfy it (the exact conflation the prior wording,
    // `allDeclined`, produced by folding comparison-unavailable into the same
    // bucket as not-enough-history).
    const genuinelyTooEarlyStart = BODY.indexOf('const genuinelyTooEarly =');
    const genuinelyTooEarlySemicolon = BODY.indexOf(';', genuinelyTooEarlyStart);
    expect(genuinelyTooEarlyStart, 'expected a genuinelyTooEarly declaration').toBeGreaterThan(-1);
    const genuinelyTooEarlyExpr = BODY.slice(genuinelyTooEarlyStart, genuinelyTooEarlySemicolon);
    expect(genuinelyTooEarlyExpr).not.toMatch(/effortComparisonUnavailable/);
  });

  it('renders the distinct comparison-unavailable explanation in its own guard, separate from the too-early branch', () => {
    expect(BODY).toMatch(/text: INSIGHTS_EFFORT_COMPARISON_UNAVAILABLE/);
    const tooEarlyGuard = BODY.indexOf('if (lines.length === 0 && genuinelyTooEarly)');
    const noteGuard = BODY.indexOf('if (effortComparisonUnavailable)');
    expect(tooEarlyGuard, 'expected the too-early guard').toBeGreaterThan(-1);
    expect(noteGuard, 'expected a guard rendering the distinct note').toBeGreaterThan(-1);
    expect(noteGuard).not.toBe(tooEarlyGuard);
    // The too-early guard returns before the distinct-note guard is ever
    // reached, so the two renderings are mutually exclusive on that path.
    const tooEarlyBlock = BODY.slice(tooEarlyGuard, noteGuard);
    expect(tooEarlyBlock).toMatch(/return;/);
  });

  it('still renders the plain too-early note for the genuine case, unchanged wording', () => {
    expect(BODY).toMatch(/text: INSIGHTS_TOO_EARLY/);
  });
});

// `ol-egov.141.89.11.24`, `[D-426]` (row 25 of the 2026-09-29 rulings): the rhythm section is fed
// first-processed days, which are processing days and never an exact arrival time. Same
// source-text constraint as above (`today/view.ts` cannot be loaded under Vitest), so this pins
// what `renderRhythmBody` is allowed to do with the reading rather than mounting it; the
// reading's own behaviour is `core/today/arrivals.spec` and `today/data-source.spec`'s.
// @auto:plugin/today/view.spec
describe('TodayView.renderRhythmBody — never words a processing day as an arrival (D-426, ol-egov.141.89.11.24)', () => {
  const START = VIEW.indexOf('private renderRhythmBody(');
  const END = VIEW.indexOf('private renderTermDatesPointer(');
  if (START === -1 || END === -1) {
    throw new Error('view.spec.ts: renderRhythmBody markers moved in view.ts');
  }
  const BODY = VIEW.slice(START, END);
  /** The string and template literals in the body: the only place the view could put words of its own. */
  const LITERALS = [...BODY.matchAll(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g)].map((match) => match[0]);

  it('takes every sentence from copy.ts, never from a string of its own', () => {
    expect(BODY).toMatch(/rhythmQuietLine\(reading\.course, reading\.quietDays\)/);
    expect(BODY).toMatch(/rhythmYardstickLine\(/);
    expect(BODY).toMatch(/text: line\.text/);
    // Only class names and the section label constant are written here.
    for (const literal of LITERALS) {
      expect(literal, 'a sentence written in the view').not.toMatch(/arriv|process|since|on \d/i);
    }
  });

  it('reads a quiet course’s day count and nothing that carries a processing day', () => {
    expect(BODY).toMatch(/reading\.quietDays/);
    for (const field of [
      'lastMaterialArrivalDay',
      'firstProcessedDay',
      'noLaterThan',
      'arrivedDay',
    ]) {
      expect(BODY, `the view reads ${field}`).not.toContain(field);
    }
  });

  it('draws nothing for a reading that is not a measured quiet finding: pending, unreadable and unknown-day courses stay silent', () => {
    // Everything but `'observed'` returns before any DOM is built for the quiet reading, which is
    // what leaves `'not-enough-history'` (an unknown day) and `'unreadable'` (a pending or failed
    // version) without a line: no sentence exists for either, and none is added here.
    const guard = BODY.indexOf("rhythm === null || rhythm.status !== 'observed'");
    const dom = BODY.indexOf('createDiv', guard);
    expect(guard, 'expected the observed-only guard').toBeGreaterThan(-1);
    expect(BODY.slice(guard, dom)).toMatch(/return;/);
  });
});
