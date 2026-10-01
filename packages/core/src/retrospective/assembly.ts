/**
 * What she had attempted, and what she had demonstrated, by an assessment's date — the
 * retrospective's assembly step (`ol-egov.141.89.11.4`; vew.md section 2.7: "attempted = a scored
 * review or explain-back attempt before the assessment's date; demonstrated = ATT's displayed stage
 * from evidence before that date").
 *
 * **Assembled apart, drawn nowhere.** These two facts feed the reading's checks (is the stage she is
 * shown only from evidence that preceded the paper?); the view draws only F8.8's own lines, and no
 * line is added here (no clause defines one). They are neither a fourth group beside held, faded and
 * too early nor a score: a boolean and a stage word, per concept.
 *
 * **Before the date means a calendar day strictly earlier.** A record counts when her own local day
 * (the first ten characters of its offset timestamp, `../today/calendar-day.ts`) falls before the
 * assessment's day; the assessment's own day is a separate bucket elsewhere in the views (`[D-422]`)
 * and is not evidence that preceded the paper. A record whose day cannot be read counts for
 * nothing, as every as-of fold leaves it out.
 *
 * **One stage rule.** The stage is `foldConceptStage` over the filtered log with the same validity
 * exclusions `buildRetrospective` uses for its own displayed stage; nothing here restates the stage
 * rule, so a ruled change to it moves this too.
 *
 * Pure: no clock, no vault, nothing stored.
 */

import type { MasteryState, ReviewLogEntry } from 'olea-contracts';
import { foldConceptStage, type MasteryRollupOptions } from '../mastery/rollup.js';
import { type CalendarDay, calendarDayOfTimestamp } from '../today/calendar-day.js';
import type { RetrospectiveAssemblyEntry, RetrospectiveConceptCoverage } from './types.js';

export function assembleBeforeAssessment(input: {
  readonly scope: readonly RetrospectiveConceptCoverage[];
  readonly entries: readonly ReviewLogEntry[];
  /** The assessment's own calendar day. Evidence from this day on is not read. */
  readonly assessmentDate: CalendarDay;
  readonly stageOptions: MasteryRollupOptions;
}): readonly RetrospectiveAssemblyEntry[] {
  const before = input.entries.filter((entry) => {
    const day = calendarDayOfTimestamp(entry.timestamp);
    return day !== null && day < input.assessmentDate;
  });
  return input.scope.map(({ conceptId, conceptName }) => {
    const { state, evidence } = foldConceptStage(before, conceptId, input.stageOptions, {});
    const demonstrated: MasteryState = state;
    return {
      conceptId,
      conceptName,
      attempted: evidence.scoredEventCount > 0 || evidence.explainBackAttempts > 0,
      demonstrated,
    };
  });
}
