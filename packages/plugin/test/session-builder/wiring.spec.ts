/**
 * Scenario: `features/F4-oracle.md`, "the build-session affordance actually
 * builds a session" — @auto:plugin/session-builder/wiring.spec
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
    expect(main).toMatch(
      /import\s*\{\s*createLocalSessionBuilderProvider\s*\}\s*from\s*'\.\/session-builder\/provider\.js'/,
    );
  });

  it('reveals an existing leaf rather than stacking a second one, same shape as the gap view', () => {
    expect(main).toMatch(/getLeavesOfType\(VIEW_TYPE_OLEA_SESSION\)/);
  });

  it('the command palette entry opens it, unfocused', () => {
    expect(main).toMatch(
      /buildSession:\s*\(\)\s*=>\s*\{\s*void this\.revealSessionBuilderView\(undefined\);/,
    );
  });
});

describe('the build-session affordance is no longer an inert label', () => {
  it('the gap view is constructed with a buildSession handler that reaches the session builder', () => {
    expect(main).toMatch(
      /buildSession:\s*\(row\)\s*=>\s*\{\s*void this\.revealSessionBuilderView\(row\.conceptName\);/,
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

  it('the seed reaches the view through setFocusConcept, so a second row rebuilds the open pane', () => {
    expect(main).toMatch(/view instanceof SessionBuilderView/);
    expect(main).toMatch(/setFocusConcept\(conceptName\)/);
  });
});

describe('the session builder reads what only a real vault has', () => {
  const provider = codeOf('session-builder/provider.ts');

  it('composes the real oracle chain rather than re-implementing a ranking', () => {
    expect(provider).toMatch(/composeOracleRanking\(\{/);
    expect(provider).toMatch(/buildGapView\(\{/);
    expect(provider).toMatch(/buildComposedStudySession\(\{/);
  });

  it('SESS-2: replays scheduling state through the same Scheduler the Today panel uses, and reads its own scheduler dep rather than building a second instance', () => {
    expect(provider).toMatch(/replaySchedulerStates\(entries,\s*deps\.scheduler\)/);
    expect(main).toMatch(
      /scheduler,\s*relations:\s*\(\)\s*=>\s*this\.servedRelationEdges\(\),\s*\}\),/,
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
