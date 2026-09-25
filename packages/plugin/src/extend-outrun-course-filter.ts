import type { CourseOrTopicOption } from './session-builder/copy.js';

/**
 * `[SESS-8.6]` (`ol-egov.141.89.10.15`, F2.18/C5.6, C5.8 as amended —
 * `[D-193]`): derives the `courseOrTopic` filter `main.ts`'s
 * `extendDefaultStudySession` must pin an outrun extension to — "where she
 * outruns it, C5.8's outrun extends this course's own material under the
 * same plan's shares" (F2.18). Without this, `extendDefaultStudySession`
 * re-ran `composeStudySessionForRequest` with no `courseOrTopic` restriction
 * at all, so `session-builder/provider.ts`'s dominant-course selection
 * (`selectDominantCourse`, `study-session/compose.ts`) reran fresh and was
 * free to pick a DIFFERENT course than the one the frozen composition it was
 * extending actually held — the defect this function closes.
 *
 * Pure, and deliberately its own module rather than a private function on
 * `main.ts`: `main.ts` imports `obsidian` (whose `package.json` `main` is
 * `""`) and cannot be loaded under Vitest at all — see
 * `test/main-wiring.spec.ts`'s own module doc — so the one piece of real
 * decision logic in this bead's fix needs to live somewhere a real,
 * behavioural test can import it.
 *
 * Takes the frozen composition's own `dominantCourse`
 * (`ComposedStudySession.dominantCourse`, `study-session/compose.ts`) —
 * NOT `courseShares.keys()`: `courseShares` carries an entry for every
 * course present in the wider candidate pool (zero for every course but the
 * dominant one) whenever no `courseOrTopic` restriction narrowed the
 * candidate rows first, so its key count is NOT reliably one — confirmed by
 * this file's own behavioural suite
 * (`test/extend-outrun-course-filter.spec.ts`), which is why this reads
 * `dominantCourse` instead. `dominantCourse` is set whenever
 * `focusPolicy !== 'every-course'` ran (`ComposeSessionRowsResult
 * .dominantCourse`'s own doc) — the default since `[FOCUS-5]`, and never
 * overridden by any caller in this package (`session-builder/provider.ts`
 * never sets `focusPolicy`) — so it is populated on every real
 * `extendDefaultStudySession` call except the degenerate "no eligible course
 * at all" case, where `undefined` here asks for no restriction rather than
 * throwing — the same "degrade honestly, never crash the extend" posture
 * `extendDefaultStudySession`'s own `null` handling already takes for
 * "nothing to compose."
 */
export function frozenCourseOrTopicFilter(
  previousDominantCourse: string | undefined,
): CourseOrTopicOption | undefined {
  return previousDominantCourse === undefined
    ? undefined
    : { kind: 'course', label: previousDominantCourse };
}
