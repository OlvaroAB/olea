/**
 * F8.7's proposal-time read (`ol-egov.141.89.9.49`, discovered from
 * `ol-egov.141.89.9.47`): assembles the two inputs `../../core/src/today/
 * earlier-course-recognition.ts`'s `buildEarlierCourseRecognitions` needs —
 * the review log and the concept-to-course join (F1.3) — at the moment
 * `main.ts`'s `openNextCourseSetupProposal` is about to show a course-setup
 * proposal, and folds them through it. Everything downstream (the render
 * layers, `./copy.ts#buildRecognitionClaimCopy`, `./view.ts
 * #renderRecognitionClaims`, `./confirmation-view.ts`) already exists; this
 * module is the missing seam `ol-egov.141.89.9.47`'s report named by
 * file:line.
 *
 * ## Follows `../today/data-source.ts`'s own reads — read-only here
 *
 * This bead owns no edit to that file, so both halves below call its already-
 * production functions rather than re-deriving them:
 * - **entries** — `readReviewHistory(vault, deviceId, { today })`, the same
 *   whole-log (not windowed) read Today's mastery overview and insights
 *   already use for the identical "current-state, not trailing" reason
 *   (att.md item 4, `ol-egov.141.89.9.15`).
 * - **concepts** — `extractConceptsFromVault`, mapped `record.key` ->
 *   `conceptId` / `record.courses` -> `courses`, the exact one-line mapping
 *   `createVaultTrendsSource#listConceptCourses` performs for the identical
 *   join. `displayName` is dropped: `buildEarlierCourseRecognitions` only
 *   ever reads `conceptId`/`courses` off this shape, never a name.
 *
 * ## Vitality is omitted, not computed
 *
 * `buildEarlierCourseRecognitions`'s own module doc: "vitality is accepted,
 * never computed" — a live reading needs a `Scheduler`, `now` and
 * `HOLDING_CUT`, dependencies this proposal-time seam has no other reason to
 * construct. Every claim's `vitality` therefore reads `null` here, the same
 * honest "not read" every other caller that omits the option gets, never a
 * fabricated default.
 *
 * ## Confirmed same-as links are followed (`[D-402]`, `ol-egov.141.89.3.20`)
 *
 * Identical topic wording in two courses is two identities since `[D-402]`,
 * joined only by a same-as link she confirms. This seam therefore also reads
 * the persisted links (`listSameAsLinkRecords`) and the key store's
 * canonical-key index (`readConceptKeyCanonicalIndex`, `[D-378]`) and hands
 * both to `buildEarlierCourseRecognitions`, which folds a CONFIRMED link into
 * one identity and ignores every other status — so a concept that recurs
 * across courses is recognised again once she confirms the link, and an
 * unconfirmed proposal changes nothing. A failed read of either degrades to
 * "no links": every recognition by an identical key still shows, and only a
 * linked pair goes unrecognised this time, never a crash.
 *
 * ## Both reads fail closed to `[]`
 *
 * A vault walk or log read that throws mid-way must not crash course
 * detection — the same swallow-to-honest-empty rule `createVaultTrendsSource`
 * / `createVaultInstrumentSource` already use, for the same reason (a
 * throwing vault is not a vault with nothing in it). Unlike a due count or a
 * mastery stage, F8.7 is a reading with nothing to confirm, so collapsing a
 * failed read to "show no recognition claims this time" costs her nothing
 * she was relying on.
 *
 * ## The cutoff is taken and recorded here (`[D-387]`, `[D-411]`)
 *
 * The first time a recognition names an earlier course, this seam takes that
 * course's cutoff and appends it to the course cutoff log in Olea's own layer
 * (`../../../core/src/today/course-cutoff-log.ts`'s `recordCourseCutoffs`):
 * her leaving gesture once C7.8's record exists (none does yet), otherwise
 * the course's last passed assessment date, provisional. A course that already
 * has a record is never written again, so an assessment date she edits later
 * cannot move it. The records then go to `buildEarlierCourseRecognitions`,
 * which draws the dated line from them alone.
 *
 * **A cutoff is recorded only from a trustworthy read of her calendar**, since
 * a record is never rewritten: only when the caller names the assignments
 * Base path (`assignmentsBasePath`; blank means none configured, so her
 * manual entries are the whole calendar), only when a configured Base was
 * actually read (not the manual fallback of an unreadable Base), and only
 * when the read resolved the course and date columns without a config error.
 * Otherwise the existing records are still read and shown, and nothing new is
 * written this time. Every failure here — a log read, an assessment read, a
 * write — degrades to "no dated line this time", never a crash and never a
 * cutoff from a partial read.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  type AssessmentRecord,
  buildEarlierCourseRecognitions,
  type CalendarDay,
  type ConceptCourses,
  type ConceptKeyCanonicalIndex,
  calendarDaysEndingOn,
  type EarlierCourseRecognition,
  type ExtractConceptsOptions,
  listSameAsLinkRecords,
  readConceptKeyCanonicalIndex,
  resolveAssessments,
  type SameAsLinkRecord,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
// `[D-411]` (`ol-v7r5.66`): imported by module path, not the `olea-core` barrel, which other
// lanes are landing exports into this round (`privacy/log-discovery.ts`'s stance).
import {
  courseCutoffLogPath,
  readCourseCutoffLog,
  recordCourseCutoffs,
} from '../../../core/src/today/course-cutoff-log.js';
import type { CourseCutoffRecord } from '../../../core/src/today/course-cutoff-record.js';
import { recognitionArithmeticVersion } from '../../../core/src/today/earlier-course-recognition.js';
import { extractConceptsFromVault } from '../concept/wiring.js';
import { readReviewHistory } from '../today/data-source.js';

export interface CourseSetupRecognitionSourceDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly today: CalendarDay;
  /** Forwarded to `extractConceptsFromVault`; defaults match F1.3's conventions. */
  readonly conceptOptions?: ExtractConceptsOptions;
  /**
   * Her configured assignments Base path (the study-plan settings'
   * `assignmentsBasePath`; blank for none). **Absent means the caller did not
   * say, and no new cutoff is recorded** (module doc): recorded cutoffs are
   * still read and shown.
   */
  readonly assignmentsBasePath?: string;
}

/**
 * ~10 years of this device's own cutoff-log files, probed by exact path so a
 * host that cannot list a dot folder still finds the records it wrote — the
 * probe window `privacy/log-discovery.ts` uses (`DEFAULT_LOG_PROBE_DAYS`).
 * Without it such a host would see no record and take the cutoff again.
 */
const CUTOFF_LOG_PROBE_DAYS = 3650;

function ownCutoffLogPaths(deviceId: string, today: CalendarDay): readonly VaultPath[] {
  try {
    return calendarDaysEndingOn(today, CUTOFF_LOG_PROBE_DAYS).map((day) =>
      courseCutoffLogPath(day, deviceId),
    );
  } catch {
    return [];
  }
}

/**
 * Her assessments, or `null` when this read is not one a permanent cutoff may
 * be taken from (module doc).
 */
async function assessmentsForCutoff(
  vault: VaultSource,
  assignmentsBasePath: string | undefined,
): Promise<readonly AssessmentRecord[] | null> {
  if (assignmentsBasePath === undefined) return null;
  try {
    const report = await resolveAssessments(vault, assignmentsBasePath);
    if (assignmentsBasePath.trim() !== '' && report.source !== 'base') return null;
    if (report.configErrors.length > 0) return null;
    if (report.unresolvedFields.includes('course') || report.unresolvedFields.includes('due')) {
      return null;
    }
    return report.records;
  } catch {
    return null;
  }
}

/**
 * The cutoff records to read the dated lines from: every recorded one, plus
 * any this call takes and writes for `earlierCourses` (module doc). `[]` on a
 * failed log read — nothing is written from a read that could not see what
 * was already recorded.
 */
async function cutoffRecordsFor(
  earlierCourses: readonly string[],
  concepts: readonly ConceptCourses[],
  deps: CourseSetupRecognitionSourceDeps,
): Promise<readonly CourseCutoffRecord[]> {
  let existing: readonly CourseCutoffRecord[];
  try {
    existing = (await readCourseCutoffLog(deps.vault, ownCutoffLogPaths(deps.deviceId, deps.today)))
      .records;
  } catch {
    return [];
  }
  const assessments = await assessmentsForCutoff(deps.vault, deps.assignmentsBasePath);
  if (assessments === null) return existing;
  try {
    const { byCourse } = await recordCourseCutoffs(deps.vault, {
      courseIds: earlierCourses,
      existing,
      concepts,
      assessments,
      arithmeticVersion: recognitionArithmeticVersion(),
      today: deps.today,
      deviceId: deps.deviceId,
    });
    return [...byCourse.values()];
  } catch {
    return existing;
  }
}

/**
 * `newCourse`: the course code the proposal is about —
 * `CourseDetectionProposal.code`, read from `courseFromPath` the same way
 * `ConceptCourses.courses` already is (`../concept/course.ts`), so the two
 * need no translation between them.
 *
 * Pure fold aside, this function itself is not: it performs the two vault
 * reads `buildEarlierCourseRecognitions` needs and then calls it, so a
 * caller gets recognition claims in one await rather than assembling the
 * core call's input by hand.
 */
export async function readCourseSetupRecognitions(
  newCourse: string,
  deps: CourseSetupRecognitionSourceDeps,
): Promise<readonly EarlierCourseRecognition[]> {
  let entries: readonly ReviewLogEntry[];
  try {
    entries = (await readReviewHistory(deps.vault, deps.deviceId, { today: deps.today })).entries;
  } catch {
    entries = [];
  }

  let concepts: readonly ConceptCourses[];
  try {
    const records = await extractConceptsFromVault(deps.vault, deps.conceptOptions ?? {});
    concepts = records.map((record) => ({ conceptId: record.key, courses: record.courses }));
  } catch {
    concepts = [];
  }

  let sameAsLinks: readonly SameAsLinkRecord[];
  let canonicalKeys: ConceptKeyCanonicalIndex | undefined;
  try {
    sameAsLinks = (await listSameAsLinkRecords(deps.vault)).map((entry) => entry.record);
    canonicalKeys = await readConceptKeyCanonicalIndex(deps.vault);
  } catch {
    sameAsLinks = [];
    canonicalKeys = undefined;
  }

  const input = {
    newCourse,
    entries,
    concepts,
    sameAsLinks,
    ...(canonicalKeys !== undefined ? { canonicalKeys } : {}),
  };
  const current = buildEarlierCourseRecognitions(input);
  const earlierCourses = [...new Set(current.flatMap((r) => r.earlierCourses))];
  if (earlierCourses.length === 0) return current;

  // `[D-387]`/`[D-411]`: take and record each earlier course's cutoff the first
  // time, then read the dated lines from the records alone (module doc).
  const cutoffRecords = await cutoffRecordsFor(earlierCourses, concepts, deps);
  if (cutoffRecords.length === 0) return current;
  return buildEarlierCourseRecognitions({ ...input, cutoffRecords });
}
