/**
 * Course association for parsed schedule events (RHY-3 §9, `ol-r6s0` — step 2
 * of the build chain `ol-4chx` -> `ol-r6s0` -> `ol-hna1` -> `ol-at1a`).
 * `./discover.ts` (step 1) hands over `ScheduleEventRecord`s carrying a raw,
 * uncompared `label`; this module's whole job is matching that label against
 * the known course-code roster and nothing else — no recurrence, no
 * extrapolation, no freshness measure (`ol-hna1`'s job).
 *
 * **The roster is a caller-supplied fact, not something this module derives.**
 * Same split `../course/lifecycle.ts`'s `detectCourseProposals` already uses
 * for `knownCourseCodes`: this module never calls `courseFromPath` itself, it
 * takes the resulting set of course codes as an explicit `ReadonlySet<string>`
 * argument. Whoever builds that set from the vault's `01 Courses/` folders
 * (F1.3) is a caller's job, out of scope here.
 *
 * **Matching is case-insensitive, exact string comparison — never a prefix or
 * fuzzy match.** RHY-3 §9: "match each candidate label against the known
 * course-code roster case-insensitively, since this vault's own data shows
 * the calendar's casing and the folder casing disagree on every single
 * event." The design names case as the *only* observed discrepancy and
 * states the three-way outcome (exactly one / zero / more than one) in terms
 * of "matches" without ever asking for substring or prefix matching, even
 * where it notes that a *longer* roster makes ambiguity plausible — that
 * remark motivates handling ambiguity at all, not broadening what counts as a
 * match. Widening to prefix or fuzzy matching is a reversible default this
 * module deliberately does not take; see this bead's report for the
 * class-B note.
 *
 * **Three-way outcome, per RHY-3 §9:** exactly one case-insensitive match
 * associates the event; zero matches makes the event "unusable for schedule
 * inference (not an error — a personal or non-course calendar entry is a
 * legitimate reason for this)"; more than one match is treated as unmatched
 * rather than guessed at, "silent misattribution is worse than an unused
 * event." All three are read straight off `types.ts`'s
 * `ScheduleAssociationMiss` and `AssociatedScheduleEvent`/
 * `UnmatchedScheduleEvent` split.
 *
 * **Degrades per event, never per note or per report.** One event that
 * cannot be associated never affects any other event's match — both output
 * buckets are always built independently over the whole input list.
 */

import type {
  AssociatedScheduleEvent,
  ScheduleAssociationMiss,
  ScheduleAssociationReport,
  ScheduleEventRecord,
  UnmatchedScheduleEvent,
} from './types.js';

// Re-exported so the package barrel (`../index.ts`) can name the report
// shapes from this one module, per this bead's `owns` scope limiting the
// barrel to a single export statement — the same convention `./discover.ts`
// already established for step 1's types.
export type {
  AssociatedScheduleEvent,
  ScheduleAssociationMiss,
  ScheduleAssociationReport,
  UnmatchedScheduleEvent,
} from './types.js';

/** One label's outcome against the roster, in isolation — the per-event decision `associateScheduleEvents` applies across a whole list. */
export type CourseLabelMatch =
  | { readonly status: 'matched'; readonly courseCode: string }
  | { readonly status: 'unmatched'; readonly reason: ScheduleAssociationMiss };

/**
 * Matches one candidate label against `knownCourseCodes`, case-insensitively
 * and by exact string comparison (RHY-3 §9). Returns the roster's own
 * spelling on a unique match — never the label's casing, since the label is
 * exactly what disagrees with the roster in this vault's own data. Exported
 * separately from `associateScheduleEvents` so a caller (or a test) can
 * exercise one label's match without a whole event list.
 */
export function matchCourseLabel(
  label: string,
  knownCourseCodes: ReadonlySet<string>,
): CourseLabelMatch {
  const lowered = label.toLowerCase();
  const matches: string[] = [];
  for (const code of knownCourseCodes) {
    if (code.toLowerCase() === lowered) matches.push(code);
  }

  if (matches.length === 0) return { status: 'unmatched', reason: 'no-match' };
  if (matches.length > 1) return { status: 'unmatched', reason: 'ambiguous' };
  // Non-null: `matches.length === 1` was just checked.
  return { status: 'matched', courseCode: matches[0] as string };
}

/**
 * Associates every event in `events` against `knownCourseCodes` (RHY-3 §9).
 * Pure: reads only its arguments, writes nothing. `matched` and `unmatched`
 * are always both populated independently over the full input — one event's
 * outcome never affects another's (module doc, "degrades per event").
 */
export function associateScheduleEvents(
  events: readonly ScheduleEventRecord[],
  knownCourseCodes: ReadonlySet<string>,
): ScheduleAssociationReport {
  const matched: AssociatedScheduleEvent[] = [];
  const unmatched: UnmatchedScheduleEvent[] = [];

  for (const event of events) {
    const result = matchCourseLabel(event.label, knownCourseCodes);
    if (result.status === 'matched') {
      matched.push({ event, courseCode: result.courseCode });
    } else {
      unmatched.push({ event, reason: result.reason });
    }
  }

  return { matched, unmatched };
}
