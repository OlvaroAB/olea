/**
 * F2.19's assessment-scope resolver (`ol-v7r5.11`): turns F1.7's free-text
 * `AssessmentRecord.scope` into the `scopeConceptKeys` the within-block
 * grouping seam reads (`study-session/compose.ts`'s
 * `AssessmentGroupingContext`) — the second of the two reachability gaps
 * `ol-v7r5.10`'s handback names ("Data path — assessment scope"), and the one
 * `ol-2zfj.27`'s free-text-vs-exact-match concern is aimed straight at.
 *
 * **Exact/normalized-exact matching only. No fuzzy matching, and this is a
 * hard rule here, not a starting point** (`ol-2zfj.27`): a similarity-scored
 * matcher over her own free prose needs its own measurement against a
 * labelled set before it can be trusted, and none has been run for this
 * bead. What is built here is the conservative floor: split the scope text on
 * commas — the same convention `./scope.js`'s `resolveScope` already uses to
 * CONSTRUCT the inferred-scope string
 * (`candidates.map((c) => c.label).join(', ')`), so splitting on `,` is the
 * inverse of a shape this codebase already commits to, not a new one — then
 * compare each trimmed segment against every concept name offered for the
 * assessment's own course, case- and whitespace-normalized (trim, lowercase,
 * collapse runs of whitespace), STRING EQUALITY only. A segment matching
 * nothing is dropped and counted, never guessed at by substring or
 * similarity.
 *
 * **Course-scoped**, the same caution `oracle/compose.ts`'s
 * `resolveCaseInsensitiveConceptKeys` applies for a different join: a segment
 * is only checked against concepts whose `courses` include the assessment's
 * own `course` (exact string match — both fields are verbatim per
 * `./base-file.js`'s doc). A same-named concept in a different course is
 * never pulled in by a scope match; an assessment with no known `course`
 * matches nothing (every segment counts as unresolved) rather than searching
 * every course.
 *
 * **`dueDay`** is `AssessmentRecord.due` read as a `CalendarDay` only when it
 * already is one — the same `YYYY-MM-DD` shape check `oracle/rank.ts`'s
 * `dateFromCalendarDay` and `today/calendar-day.ts`'s `isCalendarDay` already
 * apply to this exact field for the identical F4.7 arithmetic; `undefined` or
 * an unparseable value both read as "no known deadline" (`null`), never a
 * fabricated date.
 *
 * **`AssessmentConceptContext` is declared independently, not imported from
 * `study-session/compose.js`.** It is structurally identical to that module's
 * `AssessmentGroupingContext`, restated here so `assessment/` — a layer
 * `study-session/` is built on top of — never depends on the composition
 * layer above it. `ReadonlyMap`'s value position is covariant, so the map
 * this module returns is assignable straight into
 * `ComposeSessionRowsInput.assessmentContext` with no cast at the call site.
 */

import type { ConceptRecord } from '../concept/types.js';
import { type CalendarDay, isCalendarDay } from '../today/calendar-day.js';
import type { VaultPath } from '../vault/types.js';
import type { AssessmentRecord } from './types.js';

/** Structurally identical to `study-session/compose.ts`'s `AssessmentGroupingContext` — see this module's doc for why it is restated rather than imported. */
export interface AssessmentConceptContext {
  readonly dueDay: CalendarDay | null;
  readonly scopeConceptKeys: ReadonlySet<string>;
}

/** {@link resolveAssessmentGroupingContext}'s result: the context map plus the honest miss count. */
export interface AssessmentGroupingContextResolution {
  /** Keyed by `AssessmentRecord.path` — the same `VaultPath` a row's own `GapRow.targetAssessmentPath` names. */
  readonly assessmentContext: ReadonlyMap<VaultPath, AssessmentConceptContext>;
  /**
   * Count of comma-split scope segments that matched no concept name in the
   * assessment's own course — dropped, never guessed at by substring or
   * similarity; counted so a caller or a test can assert on the miss rate
   * rather than have it disappear silently.
   */
  readonly unresolvedScopeSegmentCount: number;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dueDayOf(due: string | undefined): CalendarDay | null {
  return due !== undefined && isCalendarDay(due) ? due : null;
}

/**
 * Resolve F1.7's per-assessment scope text and F4.7's due date into the
 * `VaultPath`-keyed context map the F2.19 grouping seam reads. Pure: no I/O,
 * no identity minting — `concepts` supplies every key this function can ever
 * produce. An assessment contributing neither a known due day nor any
 * matched scope key is omitted from the map entirely (a no-op entry is
 * indistinguishable from an absent one at the seam — see
 * `withinBlockGroupingScore`'s reading of a missing map entry).
 */
export function resolveAssessmentGroupingContext(
  assessments: readonly AssessmentRecord[],
  concepts: readonly ConceptRecord[],
): AssessmentGroupingContextResolution {
  const assessmentContext = new Map<VaultPath, AssessmentConceptContext>();
  let unresolvedScopeSegmentCount = 0;

  for (const assessment of assessments) {
    const dueDay = dueDayOf(assessment.due);
    const course = assessment.course;
    const scopeConceptKeys = new Set<string>();

    if (assessment.scope !== undefined && assessment.scope !== '') {
      const candidatesInCourse =
        course === undefined ? [] : concepts.filter((concept) => concept.courses.includes(course));
      const keyByNormalizedName = new Map(
        candidatesInCourse.map((concept) => [normalize(concept.name), concept.key]),
      );
      const segments = assessment.scope
        .split(',')
        .map((segment) => segment.trim())
        .filter((segment) => segment !== '');
      for (const segment of segments) {
        const key = keyByNormalizedName.get(normalize(segment));
        if (key === undefined) {
          unresolvedScopeSegmentCount += 1;
          continue;
        }
        scopeConceptKeys.add(key);
      }
    }

    if (dueDay !== null || scopeConceptKeys.size > 0) {
      assessmentContext.set(assessment.path, { dueDay, scopeConceptKeys });
    }
  }

  return { assessmentContext, unresolvedScopeSegmentCount };
}
