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
 * ## Vitality is computed here, once, over the identity-resolved log
 * (`ol-egov.141.89.9.62`, discovered from `ol-egov.141.89.9.60`)
 *
 * `buildEarlierCourseRecognitions`'s own module doc: "vitality is accepted,
 * never computed" — so this IS the seam that constructs the `Scheduler`,
 * `now` and `HOLDING_CUT` a live reading needs, the same posture
 * `today/data-source.ts` and `registry/provider.ts` already take for their
 * own callers of `readAllConceptVitality`/its eligible-reader sibling.
 * `deps.now`/`.scheduler`/`.holdingCut` are all optional, defaulting to a
 * fresh clock, `createFsrsScheduler()` and the ratified `[D-115]` cut — so
 * `main.ts`'s existing call (`ol-egov.141.89.9.49`'s seam, unchanged by this
 * bead) gets a real reading with no caller change.
 *
 * Two things this reading must get right that a naive `readAllConceptVitality`
 * call would not:
 *
 * - **Identity.** A confirmed same-as link (`[D-402]`, above) folds two
 *   `conceptId`s into one identity everywhere else this module reads the log
 *   (`buildEarlierCourseRecognitions`'s own private `entriesByIdentity`) —
 *   vitality must read the SAME resolved log, or a linked pair's evidence
 *   recorded under the losing key would silently drop out of its vitality
 *   reading even though it still counts for `state`/`evidence`.
 *   `entriesResolvedByIdentity` below mirrors that private fold (six lines,
 *   duplicated across the owns boundary rather than widening `earlier-
 *   course-recognition.ts`'s export surface for this bead — the same
 *   precedent `today/data-source.ts`'s own `disputesFromFiles` states for
 *   itself). The map is then looked up by `buildEarlierCourseRecognitions`
 *   under exactly the identities its own `byConcept` fold produces (its own
 *   doc: "the reading is looked up under the link's surviving key").
 * - **Proven-invalid exclusion, dispute-aware.** `readReviewHistory` above
 *   already reads `disputes` off the SAME log walk `entries` comes from (its
 *   own `ReviewHistory.disputes` field) — so there is no "disputes
 *   unavailable, entries available" case at this call site to degrade from:
 *   whenever `entries` is real, `disputes` is too, both from one read that
 *   fails closed together. `projectInstrumentValidity(vitalityEntries,
 *   disputes)` therefore folds in a `[D-095]` grade contest resolved
 *   `corrected`, not just a bare `rejected` verdict — the same fact
 *   `ol-egov.141.89.9.60` named missing from this seam's vitality.
 *
 * Vitality is a CURRENT reading (module doc, elsewhere: "never a vitality
 * value, which knowledge model R3 forbids dating") — it is computed over the
 * whole current log, never bounded by a recorded cutoff the way `historical`
 * is; the cutoff mechanism below is unchanged and untouched by this reading.
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

import type { DisputeLogRecord, ReviewLogEntry } from 'olea-contracts';
import {
  type AssessmentRecord,
  buildEarlierCourseRecognitions,
  buildSameAsKeyRedirect,
  type CalendarDay,
  type ConceptCourses,
  type ConceptKeyCanonicalIndex,
  calendarDaysEndingOn,
  createFsrsScheduler,
  type EarlierCourseRecognition,
  type ExtractConceptsOptions,
  HOLDING_CUT,
  listSameAsLinkRecords,
  projectInstrumentValidity,
  readConceptKeyCanonicalIndex,
  resolveAssessments,
  type SameAsLinkRecord,
  type Scheduler,
  type VaultPath,
  type VaultSource,
  type VitalityReading,
} from 'olea-core';
// `readAllConceptVitality` is deliberately not on the `olea-core` barrel
// (`packages/core/src/index.ts`'s own comment: only `conceptVitalityInstruments`
// and `HOLDING_CUT` are, for readers outside core) — same deep-import posture
// as the `[D-411]` block below, not a second precedent.
import { readAllConceptVitality } from '../../../core/src/mastery/rollup.js';
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
  /**
   * Injected for determinism under test; production omits it and gets a
   * fresh `new Date()` (module doc) — the same `?? new Date()` fallback
   * this seam's own `deps.today` default would take if it had one, and the
   * reason `main.ts`'s existing call needs no change for this bead.
   */
  readonly now?: () => Date;
  /** Overrides `HOLDING_CUT` (`[D-115]`) for F2.11's vitality axis — injected for determinism under test, the same `?? HOLDING_CUT` pattern `registry/provider.ts`'s `CreateLocalRegistryProviderDeps.holdingCut` already uses. */
  readonly holdingCut?: number;
  /** Overridable for tests; production gets a fresh `createFsrsScheduler()`, the same posture `registry/provider.ts` and `grove/provider.ts` already take. */
  readonly scheduler?: Scheduler;
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
 * The log as read under the confirmed same-as links — mirrors
 * `../../../core/src/today/earlier-course-recognition.ts`'s own private
 * `entriesByIdentity` exactly (six lines, duplicated across the owns
 * boundary rather than widening that bead's export surface for this one;
 * see this module's own doc, "Vitality is computed here"). An entry no link
 * touches is returned as-is, by reference; so is the whole log when there is
 * nothing to resolve. In memory only — nothing is written.
 */
function entriesResolvedByIdentity(
  entries: readonly ReviewLogEntry[],
  redirect: ReadonlyMap<string, string>,
): readonly ReviewLogEntry[] {
  if (redirect.size === 0) return entries;
  return entries.map((entry) => {
    if (!('conceptIds' in entry) || !Array.isArray(entry.conceptIds)) return entry;
    const ids: readonly string[] = entry.conceptIds;
    if (!ids.some((id) => redirect.has(id))) return entry;
    const resolved = [...new Set(ids.map((id) => redirect.get(id) ?? id))];
    return { ...entry, conceptIds: resolved } as ReviewLogEntry;
  });
}

/**
 * F8.7's vitality reading (`ol-egov.141.89.9.62`; module doc "Vitality is
 * computed here, once, over the identity-resolved log"): one
 * `readAllConceptVitality` replay, keyed by exactly the identities
 * `buildEarlierCourseRecognitions`'s own `byConcept` fold will look it up
 * under — every `concepts` row's `conceptId`, resolved through the SAME
 * same-as redirect, deduplicated.
 */
function vitalityForRecognitions(
  entries: readonly ReviewLogEntry[],
  disputes: readonly DisputeLogRecord[],
  concepts: readonly ConceptCourses[],
  sameAsLinks: readonly SameAsLinkRecord[],
  canonicalKeys: ConceptKeyCanonicalIndex | undefined,
  deps: CourseSetupRecognitionSourceDeps,
): ReadonlyMap<string, VitalityReading> {
  const redirect = buildSameAsKeyRedirect(sameAsLinks, canonicalKeys);
  const vitalityEntries = entriesResolvedByIdentity(entries, redirect);
  const conceptIds = [...new Set(concepts.map((c) => redirect.get(c.conceptId) ?? c.conceptId))];
  const scheduler = deps.scheduler ?? createFsrsScheduler();
  const now = deps.now?.() ?? new Date();
  const holdingCut = deps.holdingCut ?? HOLDING_CUT;
  // `disputes` is real whenever `entries` is (module doc) — the dispute-
  // aware validity projection is therefore always in play here, never the
  // log-only default `readAllConceptVitality` itself would fall back to.
  const validity = projectInstrumentValidity(vitalityEntries, disputes);
  return readAllConceptVitality(vitalityEntries, conceptIds, scheduler, now, holdingCut, validity);
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
  let disputes: readonly DisputeLogRecord[];
  try {
    const history = await readReviewHistory(deps.vault, deps.deviceId, { today: deps.today });
    entries = history.entries;
    disputes = history.disputes;
  } catch {
    entries = [];
    disputes = [];
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

  // `[D-116]`/F2.11, `ol-egov.141.89.9.62`: computed once, over the SAME
  // `entries`/`disputes`/`sameAsLinks`/`canonicalKeys` this call already
  // read above — no second vault or log read (module doc, "Vitality is
  // computed here").
  const vitality = vitalityForRecognitions(
    entries,
    disputes,
    concepts,
    sameAsLinks,
    canonicalKeys,
    deps,
  );

  const input = {
    newCourse,
    entries,
    disputes,
    concepts,
    sameAsLinks,
    vitality,
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
