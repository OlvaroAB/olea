// test/no-synthetic-ids-rendered.spec.ts — the recurrence guard WBF-1
// (`ol-mxw3`) asks for: "no string beginning `syn:` reaches rendered text on
// any workbench surface."
//
// `GapView` (`packages/plugin/src/gap/view.ts`) imports `obsidian`, so it
// cannot run under Vitest — but it is deliberately thin (its own module doc:
// "everything it decides lives in olea-core's gap/, everything it says lives
// in ./copy.ts"), so this file reconstructs exactly the strings it puts on
// screen by calling the SAME `gap/copy.ts` functions it calls, over the SAME
// models the real surfaces build (`oracle-scenarios.ts`, `timeline-
// scenarios.ts`), for every advertised state. If `view.ts` or `copy.ts` ever
// change what they render, this file's `renderedGapStrings` helper needs to
// follow — that coupling is intentional: a helper that drifted from the real
// view would stop being able to catch this leak's recurrence.
//
// The trends surface (`TodayView`) is checked more directly: its rendered
// course text is `CourseMastery.course` and `EffortMeasured.courses[].course`
// verbatim (`packages/core/src/today/mastery-overview.ts`,
// `insights/effort.ts`), so this file asserts those fields directly rather
// than re-deriving `TodayView`'s copy.
//
// The fixture-vault oracle surface (`oracle-fixture`, walkthrough steps 7-8)
// is deliberately NOT covered here: it runs over the real fixture vault, not
// `packages/synthetic`'s coined corpus, so it has no `syn:` id to leak in the
// first place (`oracle/fixture-oracle.ts`'s module doc).

import { describe, expect, it } from 'vitest';
import type { GapCourseView, GapViewModel } from '../src/oracle-bridge.js';
import { buildOracleScenario, ORACLE_STATES } from '../src/oracle-scenarios.js';
import {
  abstainedCourseSentence,
  affordanceLabel,
  coverageScreenCopy,
  gapRowLine,
  rankedCourseFraming,
  readinessNote,
  scopeSourceLine,
} from '../src/plugin-bridge.js';
import {
  buildTimelineScenario,
  DEFAULT_TIMELINE_DAY,
  TIMELINE_STATES,
} from '../src/timeline-scenarios.js';
import { buildTrendsViewModel, TRENDS_STATES } from '../src/trends-scenarios.js';

/** Every string `GapView` actually puts in the DOM for one course, in render order — mirrors `view.ts`'s `renderCourse`/`renderRow` exactly (see this file's module doc). */
function renderedCourseStrings(course: GapCourseView): readonly string[] {
  const lines: string[] = [course.course];
  if (course.status === 'abstained') {
    lines.push(abstainedCourseSentence(course));
    return lines;
  }
  lines.push(...rankedCourseFraming(course.rows));
  for (const row of course.rows) {
    lines.push(String(row.rank), row.conceptName, row.masteryState, gapRowLine(row));
    const note = readinessNote(row);
    if (note !== null) lines.push(note);
    for (const affordance of row.affordances) lines.push(affordanceLabel(affordance));
  }
  return lines;
}

/** Every string `GapView` puts in the DOM for the whole model — courses plus the coverage section (`view.ts`'s `renderCoverage`). */
function renderedGapStrings(model: GapViewModel): readonly string[] {
  const lines: string[] = [];
  for (const course of model.courses) lines.push(...renderedCourseStrings(course));

  const rows = model.courses.flatMap((c) => (c.status === 'ranked' ? c.rows : []));
  const gapRowCount = rows.filter(
    (r) => r.gapClass === 'coverage-gap' || r.gapClass === 'material-gap',
  ).length;
  lines.push(...coverageScreenCopy({ scope: model.scope, gapRowCount }));
  for (const source of model.scope.sources) lines.push(scopeSourceLine(source));

  return lines;
}

function expectNoSyntheticIds(lines: readonly string[], context: string): void {
  for (const line of lines) {
    expect(line, `${context}: rendered text leaked a synthetic id: ${line}`).not.toMatch(/\bsyn:/);
  }
}

describe('WBF-1 (ol-mxw3): no syn: id reaches GapView-rendered text', () => {
  it('every ORACLE_STATES state (the flat oracle surface)', async () => {
    for (const state of ORACLE_STATES) {
      const scenario = await buildOracleScenario(state.id);
      const view = await scenario.deps.load();
      if (view.kind !== 'model') throw new Error(`expected a model for ${state.id}`);
      expectNoSyntheticIds(renderedGapStrings(view.model), `oracle state ${state.id}`);
    }
  });

  it('every TIMELINE_STATES state, at the default day (the walkthrough\'s "fortnight on" screen)', async () => {
    for (const state of TIMELINE_STATES) {
      const scenario = await buildTimelineScenario(state.id, DEFAULT_TIMELINE_DAY);
      const view = await scenario.deps.load();
      if (view.kind !== 'model') throw new Error(`expected a model for ${state.id}`);
      expectNoSyntheticIds(renderedGapStrings(view.model), `timeline state ${state.id}`);
    }
  });
});

describe('WBF-1 (ol-mxw3): no syn: id reaches TodayView-rendered text (trends surface)', () => {
  it('every TRENDS_STATES state', () => {
    for (const state of TRENDS_STATES) {
      const vm = buildTrendsViewModel(state.id);

      const courseLines = (vm.mastery?.courses ?? []).map((c) => c.course);
      expectNoSyntheticIds(courseLines, `trends state ${state.id} (mastery course headers)`);

      const insightLines: string[] = [];
      const effort = vm.insights?.effort;
      if (effort?.status === 'observed' && effort.measured !== null) {
        insightLines.push(...effort.measured.courses.map((c) => c.course));
        if (effort.measured.widestGapCourse !== null) {
          insightLines.push(effort.measured.widestGapCourse);
        }
      }
      expectNoSyntheticIds(insightLines, `trends state ${state.id} (effort insight)`);
    }
  });
});
