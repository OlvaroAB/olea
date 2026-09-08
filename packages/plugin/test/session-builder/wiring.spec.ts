/**
 * Scenario: `features/F4-oracle.md`, "the build-session affordance actually
 * builds a session" — @auto:plugin/session-builder/wiring.spec
 *
 * **Amended by `[D-243]` (`ol-egov.132.7` [SESS-8.7]).** Both doors this file
 * checks — the palette command and the gap view's `build-session` affordance
 * — used to open `SessionBuilderView` directly; F4.6 as amended rules "there
 * is no builder screen to pass through", so both now open `HomeView`
 * instead (the gap view's door seeding Home's own `setFocusConcept`). This
 * file's assertions were rewritten to match; `features/F6-today.md`'s "The
 * start gate" section carries the fuller scenario set this same amendment
 * adds, including the "no navigation target left" scenario the last
 * `describe` block below is for.
 *
 * The same instrument, and the same reasoning, as `test/main-wiring.spec.ts`:
 * `main.ts` imports `obsidian`, whose `package.json` `main` is `""`, so it
 * cannot be loaded under Vitest at all — and the defect this bead repairs is
 * *entirely* a wiring defect. `'build-session'` has been a `GapAffordance`
 * value and a copy string since P5-T06a, granted to every mastery-gap and
 * coverage-gap row, rendered as a label, and connected to nothing. Every test
 * in this package was green while that was true.
 *
 * A source-level assertion is the only instrument that can catch that class of
 * regression. What it checks is *reachability*: the view is registered, the
 * affordance calls something, the command exists, and the composer wired in is
 * the real one rather than a stub. What it cannot check is that Obsidian then
 * does what its API says — that stays `@manual`.
 *
 * Kept as its own file rather than a section of `test/main-wiring.spec.ts`
 * because that file belongs to another lane in this run's ownership map; the
 * two may reasonably be merged later.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** Source with prose removed — a doc paragraph describing the wiring must not satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const main = codeOf('main.ts');
const gapView = codeOf('gap/view.ts');

describe('the session builder is registered, not merely written (ol-p5t06b)', () => {
  it('registers the session-builder view type alongside Review, Today and the gap view', () => {
    expect(main).toMatch(/registerView\(\s*VIEW_TYPE_OLEA_SESSION/);
  });

  it('constructs a real SessionBuilderView against the real, on-device provider', () => {
    expect(main).toMatch(
      /new SessionBuilderView\(\s*leaf,\s*createLocalSessionBuilderProvider\(\{\s*vault,\s*deviceId,\s*settingsHost:\s*this,/,
    );
  });

  it('imports the provider from session-builder/provider, not a placeholder', () => {
    // `[SESS-8.4]` (`ol-egov.132.4`): `main.ts` also imports
    // `composeStudySessionForRequest` from this same module now (the review
    // tab's composer port) — a multi-line named import, so this checks the
    // module specifier and `createLocalSessionBuilderProvider`'s presence in
    // it independently rather than one single-name import statement.
    expect(main).toMatch(
      /createLocalSessionBuilderProvider,?\s*\n\}\s*from\s*'\.\/session-builder\/provider\.js'/,
    );
  });

  // `[D-243]`: there is no `revealSessionBuilderView` any more to reuse a
  // leaf — the view type is still registered (see the test above) but
  // nothing in the product reveals one; see the "no longer a navigation
  // target" `describe` block below.

  // `[D-243]`: the palette command's door used to open `SessionBuilderView`
  // directly (`revealSessionBuilderView(undefined)`); it opens Home now.
  it('the command palette entry opens Home, unfocused ([D-243])', () => {
    expect(main).toMatch(/buildSession:\s*\(\)\s*=>\s*\{\s*void this\.revealHomeView\(\);/);
  });
});

describe('the build-session affordance is no longer an inert label', () => {
  // `[D-243]`: the gap view's door used to seed `SessionBuilderView` directly;
  // it seeds Home's own steering instead — "a pre-fill of a steering input
  // on Home, never a second entry" (F4.6 as amended).
  it('the gap view is constructed with a buildSession handler that reaches Home ([D-243])', () => {
    expect(main).toMatch(
      /buildSession:\s*\(row\)\s*=>\s*\{\s*void this\.revealHomeView\(row\.conceptName\);/,
    );
  });

  it('GapView actually binds that handler to the build-session affordance and to no other', () => {
    // The specific defect: a label rendered in a loop with nothing attached.
    expect(gapView).toMatch(/affordance === 'build-session'/);
    expect(gapView).toMatch(/addEventListener\('click'/);
    // F4.10's rule is enforced in core, and this loop must not start deciding
    // affordances of its own — `draft-cards` and `find-source` get no handler.
    expect(gapView).not.toMatch(/affordance === 'draft-cards'/);
  });

  it('the seed reaches Home through setFocusConcept, so a second row rebuilds the open pane ([D-243])', () => {
    expect(main).toMatch(/view instanceof HomeView/);
    expect(main).toMatch(/setFocusConcept\(conceptName\)/);
  });
});

// `[D-243]` (`ol-egov.132.7` [SESS-8.7]): the session-builder view "stops
// being a destination (no command or navigation target of its own that
// leads anywhere but Home)" — `features/F6-today.md`'s "The start gate"
// scenario of the same name. `VIEW_TYPE_OLEA_SESSION` stays registered (a
// saved workspace layout may still reference it) but nothing in the product
// chooses to open it.
describe('the session-builder view is no longer a navigation target ([D-243])', () => {
  it('the view type is still registered, so a saved workspace layout does not error', () => {
    expect(main).toMatch(/registerView\(\s*VIEW_TYPE_OLEA_SESSION/);
  });

  it('nothing in main.ts calls revealSessionBuilderView any more — it is gone, not merely unused', () => {
    expect(main).not.toMatch(/revealSessionBuilderView/);
  });

  // `[SESS-8.4]` (`ol-egov.132.4`): Start now enters the shared composed-
  // session holder (`enterStudySessionHolderForStart`, one `decideRebuild`
  // call) BEFORE revealing the review surface — see that method's own doc —
  // but it is still the review surface it reveals, never the session
  // builder.
  it("Home's own Start action enters the shared holder, then opens the review surface directly, never the session builder", () => {
    expect(main).toMatch(
      /startSession:\s*\(\)\s*=>\s*\{\s*void \(async \(\) => \{\s*await this\.enterStudySessionHolderForStart\(\);\s*void this\.revealReviewView\(\);/,
    );
    expect(main).not.toMatch(/startSession:[^}]*revealSessionBuilderView/);
  });
});

describe('the session builder reads what only a real vault has', () => {
  const provider = codeOf('session-builder/provider.ts');

  it('composes the real oracle chain rather than re-implementing a ranking', () => {
    expect(provider).toMatch(/composeOracleRanking\(\{/);
    expect(provider).toMatch(/buildGapView\(\{/);
  });

  // F6.6 (`ol-v7r5.18`): `buildComposedStudySession` is no longer called
  // directly here — `composeReentrySession` is, so an absence-aware branch
  // exists at all. See that module's own reachability note, which named this
  // exact call site as the missing wiring.
  it('composes through composeReentrySession, not buildComposedStudySession directly (ol-v7r5.18)', () => {
    expect(provider).toMatch(/composeReentrySession\(\{/);
    expect(provider).not.toMatch(/buildComposedStudySession\(\{/);
  });

  it('SESS-2: replays scheduling state through the same Scheduler the Today panel uses, and reads its own scheduler dep rather than building a second instance', () => {
    expect(provider).toMatch(/replaySchedulerStates\(entries,\s*deps\.scheduler\)/);
    expect(main).toMatch(
      // `ol-egov.132.1` [SESS-8.1]: `plan` now lands between `relations` and
      // the closing `}),` — see that field's own doc on
      // `CreateLocalSessionBuilderProviderDeps` (session-builder/provider.ts).
      /scheduler,\s*relations:\s*\(\)\s*=>\s*this\.servedRelationEdges\(\),\s*plan:\s*\(\)\s*=>\s*this\.review\?\.plan\s*\?\?\s*null,\s*\}\),/,
    );
  });

  it('F2.19 (ol-v7r5.11): resolves relatedConceptKeys/assessmentContext from real fixtures and threads them into the composed session, and main.ts wires the same served relation fold the Today panel and composeReviewSession already read', () => {
    expect(provider).toMatch(
      /resolveRelatedConceptKeys\(\s*deps\.relations\?\.\(\)\s*\?\?\s*\[\],\s*enumeration\.concepts,?\s*\)/,
    );
    expect(provider).toMatch(
      /resolveAssessmentGroupingContext\(\s*edges\.assessmentsRead\.records,\s*enumeration\.concepts,?\s*\)/,
    );
    expect(provider).toMatch(/relatedConceptKeys,\s*assessmentContext,/);
    expect(main).toMatch(/relations:\s*\(\)\s*=>\s*this\.servedRelationEdges\(\)/);
  });

  it('is the first production reader of the review log’s durationMs (INV-4)', () => {
    expect(provider).toMatch(/durations:\s*estimateInstrumentDurations\(entries\)/);
  });

  it('passes the assessments the ranking itself read, so the countdown cannot disagree with the order', () => {
    expect(provider).toMatch(/assessments:\s*edges\.assessmentsRead\.records/);
  });

  it('indexes real enumerated instruments rather than a fixture list', () => {
    expect(provider).toMatch(/instruments:\s*buildConceptInstrumentIndex\(enumeration\.records\)/);
  });
});
