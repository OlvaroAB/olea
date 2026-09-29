/**
 * F8.7 — recognition of a concept she has already met in an earlier course
 * (`[D-058]`; component register row 4.5, `RECOG-1`).
 *
 * ## This is a screen, not a new mechanism
 *
 * Row 4.5 names four things that already exist and nothing new to build them
 * from: concept identity is global rather than course-partitioned, mastery is
 * computed with no course parameter at all, the concept-to-course join
 * (`ConceptCourses`, already built for F6.5's effort insight —
 * `../insights/types.js`) is reusable as-is, and the event log never expires.
 * This module's whole job is folding those four things into the one new
 * question F8.7 asks: *of the concepts entering a course's scope, which ones
 * already carry evidence from a DIFFERENT course, and what does that claim
 * rest on.* It calls `computeConceptMastery` for the stage (F8.7: "nothing is
 * copied, migrated or re-derived") and reads `entries` directly for the
 * evidence fields the clause names — it does not invent a second mastery
 * calculation, matching `today/mastery-overview.ts`'s own rule.
 *
 * ## What row 4.5 calls "genuinely missing", and how each is handled here
 *
 * 1. **"No course-setup trigger event to hang it on."** Unresolved by this
 *    module and not in `RECOG-1`'s scope — there is no course-lifecycle
 *    confirmation flow built anywhere in the plugin yet (`grep` across
 *    `packages/plugin/src` for course-setup finds nothing; C7.8/`[D-098]`
 *    contracts "detection proposes, she confirms and names" but it is
 *    unbuilt). `buildEarlierCourseRecognitions` instead takes `newCourse` as
 *    an explicit parameter: whoever eventually builds that confirmation flow
 *    calls this function with the course being confirmed. The trigger is a
 *    caller's job, not this function's.
 * 2. **"The concept-to-course association is a recomputed snapshot ... so THE
 *    earlier course and WHEN IT WAS STUDIED cannot be read off directly."**
 *    Split in two:
 *    - *When it was studied* is read from the review log directly, which
 *      genuinely is append-only (C5.2) — `EarlierCourseEvidence.lastCorrectAt`
 *      and the review count come straight from timestamped events, never from
 *      the course-join snapshot. That half of the gap does not apply to a
 *      fact the log already carries honestly.
 *    - *The earlier course*, though, stays genuinely unresolvable when a
 *      concept sits in more than one other course: `ConceptCourses.courses`
 *      is M:N with no join timestamp, so there is no honest way to name a
 *      single "the" earlier course when several already hold the concept.
 *      This module does not guess. `earlierCourses` is **every other course
 *      the snapshot currently associates with the concept**, plural, sorted —
 *      never narrowed to one by an invented tiebreak. A caller wanting "the"
 *      course for a headline has to decide how to render a list of more than
 *      one; this module will not manufacture false precision to save it that
 *      decision.
 * 3. **"It cannot ship honestly against today's mastery ... a stage the
 *    contract says never moves backward, computed by a mechanism that can
 *    move it backward."** Left OPEN, deliberately. `../mastery/vitality.ts`'s
 *    own module doc asserts growth stage "is a high-water mark ... and never
 *    falls", but `computeConceptMastery` (`../mastery/rollup.ts`) computes it
 *    from a *recent* window that can shrink below a growth threshold on new
 *    negative evidence — nothing in that function enforces a floor at the
 *    previously-reached stage. Building a monotonic wrapper here would mean
 *    (a) a second mastery mechanism outside `../mastery/`'s one authority,
 *    contradicting "nothing ... re-derived", and (b) very likely persisted
 *    state to remember a past high point, which F8.7's "no new storage"
 *    framing forecloses without a decision bead. `state` below is exactly
 *    `computeConceptMastery`'s output, unmodified — this module surfaces the
 *    tension rather than papering over it. See the RECOG-1 report for the
 *    citation trail.
 *
 * ## Vitality is accepted, never computed
 *
 * `readAllConceptVitality` (`../mastery/vitality.js`) needs a `Scheduler`,
 * `now` and a `holdingCut` — real dependencies this pure, log-only module has
 * no business owning. `vitality` is an optional map the caller supplies
 * (already having those three things to hand); when absent, `vitality` on
 * every recognition is `null`, an honest "not read" rather than a fabricated
 * `holding`.
 *
 * ## The practical ceiling (register row 4.5): one identity, never one wording
 *
 * Cross-course concept MERGE is out of scope (F8.6's merge proposal is the
 * separate surface for two records that MAY be one concept). This module
 * never compares names, wording or embeddings — it fires only where both
 * courses' scope holds ONE identity: extraction already assigned the
 * identical `conceptId` in both, or she has CONFIRMED a same-as link joining
 * the two courses' identities. Concept-identity fuzziness is therefore
 * upstream risk (extraction), never a threshold to tune here — see
 * `../checks/earlier-course-recognition.ts`.
 *
 * ## A confirmed same-as link is one identity here (`[D-402]`, `ol-egov.141.89.3.20`)
 *
 * Since `[D-402]`, identical topic wording in two courses is two identities,
 * one per course, until she confirms a same-as link between them — so a
 * concept that genuinely recurs across courses no longer shares one
 * `conceptId`. Given `sameAsLinks`, this module reads every key through
 * `../concept/same-as-consumer.js`'s `buildSameAsKeyRedirect`, the one seam
 * that folds a CONFIRMED link and nothing else: both identities' course
 * memberships join under the link's surviving key, and the evidence and stage
 * are read over the log with each entry's `conceptIds` read the same way (a
 * view in memory; nothing on disk is rewritten). A `'proposed'`, `'declined'`
 * or `'severed'` link folds nothing, so an unconfirmed proposal leaves the two
 * courses exactly as unrelated as they were. `canonicalKeys` (`[D-378]`)
 * resolves a superseded duplicate key to its identity first, as every other
 * same-as reader does.
 *
 * ## Two readings, kept apart: the dated line and the current one (`[D-387]`, `[D-411]`)
 *
 * `[D-387]` (ruled 2026-09-27) keeps both: the historical attainment at an
 * earlier course's cutoff (`[D-283]`'s dated snapshot, never refreshed) and
 * the current reading (`[D-274]`'s earned stage with live vitality), **never
 * merged into one value**. `state`, `vitality` and `evidence` below are the
 * current reading, exactly as before. `historical` is the dated line, one
 * entry per earlier course whose preserved cutoff record
 * (`./course-cutoff-record.ts`) covers the concept, and it is computed from
 * the record alone plus the log:
 *
 * - **the cutoff day comes from the record**, never from her calendar now, so
 *   an edit to an assessment date after the cutoff was first taken cannot move
 *   it;
 * - **the fold runs under the recorded rules**: the recorded arithmetic
 *   version's sapling rule, not the caller's, and only when this build
 *   implements the recorded fold version and historical-award rule version.
 *   A record naming a rule this build does not implement yields no dated line
 *   for that course, never one refolded under a later rule (`[D-387]`
 *   condition 3: a later change of rule cannot silently revise it);
 * - **the evidence is the log up to and including the cutoff day, with
 *   validity as known from that same prefix** (`HISTORICAL_AWARD_RULE_VERSION`),
 *   so later learning, and a defect proven later, move the current line only.
 *
 * A course with no record has no dated line and none is fabricated (condition
 * 5); the current reading stands alone. A provisional record's line is marked
 * provisional (`provisional`), and nothing here reads it as a leaving
 * (condition 2). This module reads records; it never takes or writes one —
 * the plugin's `course-setup/recognition-source.ts` does, through
 * `./course-cutoff-log.ts`.
 */

import type { DisputeLogRecord, MasteryState, ReviewLogEntry } from 'olea-contracts';
import type { ConceptKeyCanonicalIndex } from '../concept/key-store.js';
import type { SameAsLinkRecord } from '../concept/same-as.js';
import { buildSameAsKeyRedirect } from '../concept/same-as-consumer.js';
import type { ConceptCourses } from '../insights/types.js';
import {
  ATTAINMENT_FOLD_VERSION,
  attainmentArithmeticVersion,
  DEFAULT_WITHHELD_EVIDENCE_POLICY,
} from '../mastery/attainment.js';
import {
  computeConceptMastery,
  DEFAULT_SAPLING_RULE,
  type MasteryRollupOptions,
} from '../mastery/rollup.js';
import { projectInstrumentValidity } from '../mastery/validity.js';
import type { VitalityReading } from '../mastery/vitality.js';
import { creditsConcept } from '../session/scored-concept.js';
import { type CalendarDay, calendarDayOfTimestamp } from './calendar-day.js';
import {
  type CourseCutoffRecord,
  type CourseCutoffSource,
  firstCourseCutoffByCourse,
  HISTORICAL_AWARD_RULE_VERSION,
  isProvisionalCutoffSource,
  parseRecordedStageArithmetic,
} from './course-cutoff-record.js';

/**
 * What F8.7 says the claim must show: "the earlier course, when it was
 * studied, and the evidence itself (reviews, last correct, and whether it
 * was ever explained back)." `reviewCount` and `lastCorrectAt` range over
 * scored (recall/recognition) review events only — explain-back attempts are
 * recorded, never scored (`../mastery/rollup.ts`'s own rule), and are named
 * by `explainedBack` instead so the two evidence kinds stay distinguishable
 * on screen exactly as the clause lists them.
 */
export interface EarlierCourseEvidence {
  /** Scored review events for this concept, across the whole log (not scoped to either course — mastery has no course parameter). */
  readonly reviewCount: number;
  /** At least one explain-back attempt exists for this concept. */
  readonly explainedBack: boolean;
  /** ISO-8601 timestamp of the most recent scored review that was a success, or `null` if none was. Never a course-join date — see this module's doc, point 2. */
  readonly lastCorrectAt: string | null;
}

/**
 * The dated line for one earlier course (`[D-387]`): the growth stage as it
 * stood at that course's preserved cutoff. Attainment only — never a vitality
 * value, which knowledge model R3 forbids dating.
 */
export interface EarlierCourseCutoffSnapshot {
  readonly course: string;
  /** From the cutoff record, never from her calendar now. */
  readonly cutoffDay: CalendarDay;
  readonly source: CourseCutoffSource;
  /** True unless the cutoff is her leaving gesture: the line says provisional and never claims the course is finished or left. */
  readonly provisional: boolean;
  /** The stage folded from the log up to `cutoffDay`, with validity as then known, under the recorded rules. */
  readonly state: MasteryState;
  /** The recorded versions the fold ran under, carried so the line can always say which arithmetic produced it. */
  readonly arithmeticVersion: string;
  readonly historicalAwardRuleVersion: string;
}

/** One concept recognised as carrying history from a course other than the one being set up. */
export interface EarlierCourseRecognition {
  readonly conceptId: string;
  /** The course whose setup triggered this recognition. */
  readonly newCourse: string;
  /**
   * Every OTHER course the concept-to-course snapshot currently associates
   * with this concept — sorted, deduplicated, never narrowed to a single
   * "the" course. See this module's doc, point 2.
   */
  readonly earlierCourses: readonly string[];
  /** `computeConceptMastery`'s current state, read verbatim — never re-derived for this surface. */
  readonly state: MasteryState;
  /** `null` when the caller supplied no vitality reading — an honest "not read", never a fabricated default. */
  readonly vitality: VitalityReading | null;
  readonly evidence: EarlierCourseEvidence;
  /**
   * The dated line, apart from the current reading above and never merged
   * into it: one entry per earlier course (sorted by course) whose preserved
   * cutoff record covers this concept and whose recorded rules this build
   * implements. Empty when there is none — no dated line, none fabricated.
   */
  readonly historical: readonly EarlierCourseCutoffSnapshot[];
}

export interface EarlierCourseRecognitionInput {
  /** The course just entering setup — F8.7 fires "when the course is first set up". */
  readonly newCourse: string;
  readonly entries: readonly ReviewLogEntry[];
  /** The concept-to-course join (F1.3), the same shape `today/mastery-overview.ts` reads. */
  readonly concepts: readonly ConceptCourses[];
  /**
   * Passed through to `computeConceptMastery` for every concept. `[D-281]`
   * item 4's `invalidInstrumentIds` and the ruled `correctedEventIds`
   * (`ol-egov.141.89.9.66`) are derived internally from `entries` and
   * `disputes` (`../mastery/validity.js`'s `projectInstrumentValidity`, the
   * same fold `oracle/compose.ts` and `retrospective/build.ts` do) and always
   * win over any value passed here — this module owns that fold the same way
   * the other readers own theirs, so a caller cannot accidentally show a
   * stage that still counts a proven-invalid instrument's evidence or a grade
   * a contest proved wrong.
   */
  readonly options?: MasteryRollupOptions;
  /**
   * `[D-095]` grade-contest records read apart from `entries`, folded into
   * the same validity projection (`ol-egov.141.89.9.68`). A contest resolved
   * `corrected` proves ONE review's grade wrong: that review stays practice,
   * earns no stage and no last-correct date, and the instrument's other
   * reviews keep counting. Optional and defaults to none — rejections and
   * defect suspensions, inside `entries`, still count without it.
   */
  readonly disputes?: readonly DisputeLogRecord[];
  /**
   * Pre-computed vitality readings, keyed by concept id — typically
   * `readAllConceptVitality`'s result. Optional; see this module's doc. Where
   * `sameAsLinks` folds two identities, the reading is looked up under the
   * link's surviving key.
   */
  readonly vitality?: ReadonlyMap<string, VitalityReading>;
  /**
   * The persisted same-as links (`../concept/same-as.js`), every status. Only a
   * `'confirmed'` one joins two identities; see this module's doc. Omitted,
   * identity is exactly `conceptId`, as before.
   */
  readonly sameAsLinks?: readonly SameAsLinkRecord[];
  /** The key store's canonical-key index (`[D-378]`), read with `sameAsLinks`. Optional. */
  readonly canonicalKeys?: ConceptKeyCanonicalIndex;
  /**
   * The preserved course cutoff records (`./course-cutoff-log.ts`'s
   * `readCourseCutoffLog`, or `recordCourseCutoffs`' result), in file order;
   * the first per course is the one read. Omitted, no recognition has a dated
   * line.
   */
  readonly cutoffRecords?: readonly CourseCutoffRecord[];
}

/**
 * The arithmetic version this module's stage fold runs under for `options`:
 * `../mastery/attainment.ts`'s one version string, with the sapling rule the
 * fold reads and the withheld-evidence default (the stage keeps withheld
 * evidence under every option). The version a cutoff taken now records, so
 * the dated line can later be folded under exactly this arithmetic.
 */
export function recognitionArithmeticVersion(
  options: MasteryRollupOptions = {},
  schedulerVersion?: string,
): string {
  return attainmentArithmeticVersion({
    saplingRule: options.saplingRule ?? DEFAULT_SAPLING_RULE,
    withheldEvidence: DEFAULT_WITHHELD_EVIDENCE_POLICY,
    schedulerVersion,
  });
}

/**
 * Evidence fields F8.7 names, read directly from the append-only log — never
 * from the course-join snapshot. The success rule (`rating !== null && rating
 * !== 'again'`) mirrors `../mastery/rollup.ts`'s private `isSuccessRating`;
 * restated here as the one-line rule it is rather than widening that
 * module's export surface for a single boolean.
 */
function evidenceFor(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
  correctedEventIds: ReadonlySet<string>,
): EarlierCourseEvidence {
  let reviewCount = 0;
  let explainedBack = false;
  let lastCorrectAt: string | null = null;
  let lastCorrectInstant = -Infinity;

  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    // `[D-423]`: evidence is the reviews that scored the concept, never ones that name it as context.
    if (!creditsConcept(entry, conceptId)) continue;

    if (entry.instrumentType === 'explain-back') {
      explainedBack = true;
      continue;
    }

    reviewCount += 1;
    // A review whose grade a corrected contest proved wrong stays practice
    // (counted above) but is never a correct answer (`ol-egov.141.89.9.66`).
    const isSuccess =
      entry.rating !== null && entry.rating !== 'again' && !correctedEventIds.has(entry.eventId);
    if (isSuccess) {
      const instant = Date.parse(entry.timestamp);
      if (Number.isFinite(instant) && instant > lastCorrectInstant) {
        lastCorrectInstant = instant;
        lastCorrectAt = entry.timestamp;
      }
    }
  }

  return { reviewCount, explainedBack, lastCorrectAt };
}

/** Merges every `ConceptCourses` row into one course set per identity — a concept can be named more than once across the input, and a confirmed same-as link names one identity by two ids (`identityOf`). */
function courseSetsByConcept(
  concepts: readonly ConceptCourses[],
  identityOf: (conceptId: string) => string,
): Map<string, Set<string>> {
  const byConcept = new Map<string, Set<string>>();
  for (const concept of concepts) {
    const identity = identityOf(concept.conceptId);
    const courses = byConcept.get(identity) ?? new Set<string>();
    for (const course of concept.courses) {
      if (course !== '') courses.add(course);
    }
    byConcept.set(identity, courses);
  }
  return byConcept;
}

/**
 * The log as read under the confirmed same-as links (this module's doc): each
 * entry's `conceptIds` resolved to identities, deduplicated in her order. An
 * entry no link touches is returned as-is, by reference; so is the whole log
 * when there is nothing to resolve. In memory only — nothing is written.
 */
function entriesByIdentity(
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
 * The stage as it stood at `record`'s cutoff (module doc), or `null` when the
 * record names a rule this build does not implement. `entries` is already
 * read under the confirmed same-as links.
 */
function stageAtCutoff(
  entries: readonly ReviewLogEntry[],
  identity: string,
  record: CourseCutoffRecord,
  options: MasteryRollupOptions | undefined,
  disputes: readonly DisputeLogRecord[],
): MasteryState | null {
  if (record.historicalAwardRuleVersion !== HISTORICAL_AWARD_RULE_VERSION) return null;
  const recorded = parseRecordedStageArithmetic(record.arithmeticVersion);
  if (recorded === null || recorded.foldVersion !== ATTAINMENT_FOLD_VERSION) return null;
  const byCutoff = (event: { readonly timestamp?: unknown }): boolean => {
    const timestamp: unknown = event.timestamp;
    if (typeof timestamp !== 'string') return false;
    const day = calendarDayOfTimestamp(timestamp);
    return day !== null && day <= record.cutoffDay;
  };
  const prefix = entries.filter(byCutoff);
  // Validity as it stood at the cutoff: only events and contest resolutions
  // logged by then.
  const validity = projectInstrumentValidity(prefix, disputes.filter(byCutoff));
  return computeConceptMastery(prefix, identity, {
    ...options,
    saplingRule: recorded.saplingRule,
    invalidInstrumentIds: [...validity.provenInvalid.keys()],
    correctedEventIds: [...validity.correctedEvidence.keys()],
  }).state;
}

/**
 * Pure. Reads no clock beyond what `options`/`vitality` already carry, writes
 * nothing, and computes nothing `../mastery/` does not already compute.
 *
 * Fires only where `newCourse` and at least one other course currently share
 * one identity — the identical `conceptId`, or two joined by a confirmed
 * same-as link (the practical ceiling this module's doc names),
 * AND that concept has at least one scored review or explain-back attempt —
 * "already carries history" is not satisfied by an empty evidence set.
 */
export function buildEarlierCourseRecognitions(
  input: EarlierCourseRecognitionInput,
): readonly EarlierCourseRecognition[] {
  const { newCourse, concepts, options, vitality } = input;
  // `[D-402]`: a confirmed same-as link is one identity (module doc); with no
  // links, or none confirmed, the redirect is empty and every id is its own.
  const redirect =
    input.sameAsLinks !== undefined
      ? buildSameAsKeyRedirect(input.sameAsLinks, input.canonicalKeys)
      : new Map<string, string>();
  const entries = entriesByIdentity(input.entries, redirect);
  const byConcept = courseSetsByConcept(concepts, (id) => redirect.get(id) ?? id);
  // `[D-281]` item 4 at the ruled scope (`ol-egov.141.89.9.47`,
  // `ol-egov.141.89.9.68`): the same dispute-aware validity projection every
  // other reader folds, once over the whole input log. An instrument proven
  // invalid (a standing rejection, a defect suspension) qualifies nothing at
  // the top stage; a review a corrected contest proved wrong is practice
  // only, with any re-grade read in its place. Never a withdrawal.
  const disputes = input.disputes ?? [];
  const validity = projectInstrumentValidity(entries, disputes);
  const correctedEventIds = new Set(validity.correctedEvidence.keys());
  const resolvedOptions: MasteryRollupOptions = {
    ...options,
    invalidInstrumentIds: [...validity.provenInvalid.keys()],
    correctedEventIds: [...correctedEventIds],
  };
  // `[D-387]`/`[D-411]`: one record per course, and each record's covered
  // concept ids read under the same identity redirect as everything else.
  const cutoffByCourse = firstCourseCutoffByCourse(input.cutoffRecords ?? []);
  const coveredByCourse = new Map<string, ReadonlySet<string>>();
  for (const [course, record] of cutoffByCourse) {
    coveredByCourse.set(course, new Set(record.conceptIds.map((id) => redirect.get(id) ?? id)));
  }

  const results: EarlierCourseRecognition[] = [];

  for (const [conceptId, courses] of byConcept) {
    if (!courses.has(newCourse)) continue;

    const earlierCourses = [...courses].filter((course) => course !== newCourse).sort();
    if (earlierCourses.length === 0) continue;

    const evidence = evidenceFor(entries, conceptId, correctedEventIds);
    if (evidence.reviewCount === 0 && !evidence.explainedBack) continue;

    const { state } = computeConceptMastery(entries, conceptId, resolvedOptions);

    const historical: EarlierCourseCutoffSnapshot[] = [];
    for (const course of earlierCourses) {
      const record = cutoffByCourse.get(course);
      if (record === undefined || !coveredByCourse.get(course)?.has(conceptId)) continue;
      const stoodAt = stageAtCutoff(entries, conceptId, record, options, disputes);
      if (stoodAt === null) continue;
      historical.push({
        course,
        cutoffDay: record.cutoffDay,
        source: record.source,
        provisional: isProvisionalCutoffSource(record.source),
        state: stoodAt,
        arithmeticVersion: record.arithmeticVersion,
        historicalAwardRuleVersion: record.historicalAwardRuleVersion,
      });
    }

    results.push({
      conceptId,
      newCourse,
      earlierCourses,
      state,
      vitality: vitality?.get(conceptId) ?? null,
      evidence,
      historical,
    });
  }

  return results.sort((a, b) =>
    a.conceptId < b.conceptId ? -1 : a.conceptId > b.conceptId ? 1 : 0,
  );
}
