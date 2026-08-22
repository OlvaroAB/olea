/**
 * Concept and course DISPLAY names for the synthetic-corpus oracle surfaces
 * (`ol-mxw3`, WBF-1).
 *
 * `buildGapView` (`olea-core`) sets `GapRow.conceptName` and
 * `GapCourseView.course` to whatever the caller's ranking used as identity —
 * for the real product that is a Zettelkasten note title (R2), but for
 * `packages/synthetic`'s coined curriculum it is the concept/course **id**
 * itself (`syn:concept:melspar`, `syn:course:vantrel` — see `olea-core`'s
 * `oracle/types.ts` on why v0.9 has no separate canonical-name layer, and
 * `packages/synthetic/src/curriculum.ts`'s module doc on why every edge below
 * this driver is keyed on the id for self-consistency). `GapView`
 * (`packages/plugin/src/gap/view.ts`) renders both fields verbatim, so over
 * the synthetic corpus it was rendering the raw id — a walkthrough screen
 * David clicked through and saw as the visible concept name.
 *
 * **This module is the one place that turns the id back into something a
 * person reads**, applied AFTER `buildGapView`/`deriveOracle` and never
 * before: every consumer upstream of this point (the ranking, the mastery
 * map, the material-presence map, `deriveOracle`'s own test suite —
 * `test/oracle.spec.ts:56-58` asserts on the literal `syn:concept:…` string)
 * still keys on the id, unchanged. Nothing here renames a concept; it maps a
 * `GapViewModel`'s display fields to `olea-synthetic`'s
 * `conceptDisplayName`/`courseDisplayName`/`sourceDisplayName` (a
 * title-cased form of the same vetted, coined token — never a real-sounding
 * term, per N-015) one layer above every join, right before a caller hands
 * the model to `GapView`.
 *
 * **`scope.sources[].sourcePath` is the same leak, one field over.**
 * `GapView`'s coverage section renders `CoverageScopeSource.sourcePath`
 * verbatim (`gap/copy.ts`'s `scopeSourceLine`), and over the synthetic
 * corpus that path is `syn:source:vantrel:past-paper-1`, exactly the same
 * shape of raw id `conceptName`/`course` were carrying. `distinctSourceCount`
 * and the ranking-attribution count (`gap/copy.ts`'s `rankingAttribution`,
 * which only ever sizes a `Set` of citation source paths) are untouched —
 * they read the *ids*, computed before this function ever runs, never the
 * display text.
 *
 * **`GapRow.reasoning` is a THIRD leak, and a harder one.** `olea-core`'s
 * `oracle/rank.ts` (`buildReasoning`) embeds `conceptName`, `course` and the
 * top-contributing assessment's path directly into a mechanically-assembled
 * sentence — free text, not a structured field, deliberately: the module doc
 * there says the whole point is that the sentence "matches what actually
 * drove the score", so this file cannot ask core for a differently-shaped
 * `reasoning` without breaking that property. The fix here is a targeted
 * substring substitution: replace the row's OWN raw `conceptName`/`course`
 * and its OWN `targetAssessmentPath` (guaranteed to be the same
 * `contributions[0]` `buildReasoning` used — both modules' comments say so,
 * `gap/build.ts`'s explicitly: "the format we match on and the assessment we
 * name are one assessment") with their display names, inside that one row's
 * reasoning string only. Nothing about the sentence's numbers or structure
 * changes — only the three id-shaped substrings a person would otherwise
 * read raw.
 */

import type { CoverageScope, GapCourseView, GapRow, GapViewModel } from '../oracle-bridge.js';
import {
  assessmentDisplayName,
  conceptDisplayName,
  courseDisplayName,
  sourceDisplayName,
} from '../synthetic-bridge.js';

/** `text` with every occurrence of `from` replaced by `to` — `split`/`join` rather than a `RegExp`, so none of these ids' colons need escaping. */
function replaceAll(text: string, from: string, to: string): string {
  return from.length === 0 ? text : text.split(from).join(to);
}

function withRowDisplayNames(row: GapRow): GapRow {
  const rawConceptName = row.conceptName;
  const rawCourse = row.course;
  const displayConceptName = conceptDisplayName(rawConceptName);
  const displayCourse = courseDisplayName(rawCourse);

  let reasoning = replaceAll(row.reasoning, rawConceptName, displayConceptName);
  reasoning = replaceAll(reasoning, rawCourse, displayCourse);
  if (row.targetAssessmentPath !== null) {
    reasoning = replaceAll(
      reasoning,
      row.targetAssessmentPath,
      assessmentDisplayName(row.targetAssessmentPath),
    );
  }

  return {
    ...row,
    conceptName: displayConceptName,
    course: displayCourse,
    reasoning,
  };
}

function withCourseDisplayNames(course: GapCourseView): GapCourseView {
  const displayCourse = courseDisplayName(course.course);
  if (course.status === 'abstained') {
    return { ...course, course: displayCourse };
  }
  return {
    ...course,
    course: displayCourse,
    rows: course.rows.map(withRowDisplayNames),
  };
}

function withScopeDisplayNames(scope: CoverageScope): CoverageScope {
  return {
    ...scope,
    sources: scope.sources.map((source) => ({
      ...source,
      sourcePath: sourceDisplayName(source.sourcePath),
    })),
  };
}

/**
 * `model`, with every `course`, `conceptName`, `reasoning` and
 * `scope.sources[].sourcePath` field replaced by (or, for `reasoning`,
 * scrubbed of) its raw synthetic id. Everything else — ids used as keys,
 * ranks, scores, citations, affordances — passes through untouched. Throws
 * if a course, concept, assessment or source id is not one `olea-synthetic`
 * minted (see `conceptDisplayName`/`courseDisplayName`/
 * `assessmentDisplayName`/`sourceDisplayName`): a caller feeding this a
 * fixture-vault-derived model (real note titles and paths, no `syn:` prefix)
 * is a wiring mistake, not a case to render around silently.
 */
export function withSyntheticDisplayNames(model: GapViewModel): GapViewModel {
  return {
    ...model,
    courses: model.courses.map(withCourseDisplayNames),
    scope: withScopeDisplayNames(model.scope),
  };
}
