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
 * ## The practical ceiling (register row 4.5): exact concept-id match only
 *
 * Cross-course concept MERGE is out of scope (F8.6's merge proposal is the
 * separate surface for two records that MAY be one concept). This module
 * never compares names, wording or embeddings — it fires only where
 * extraction already assigned the identical `conceptId` in both courses'
 * scope. Concept-identity fuzziness is therefore upstream risk (extraction),
 * never a threshold to tune here — see `../checks/earlier-course-recognition.ts`.
 */

import type { MasteryState, ReviewLogEntry } from 'olea-contracts';
import type { ConceptCourses } from '../insights/types.js';
import { computeConceptMastery, type MasteryRollupOptions } from '../mastery/rollup.js';
import type { VitalityReading } from '../mastery/vitality.js';

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
}

export interface EarlierCourseRecognitionInput {
  /** The course just entering setup — F8.7 fires "when the course is first set up". */
  readonly newCourse: string;
  readonly entries: readonly ReviewLogEntry[];
  /** The concept-to-course join (F1.3), the same shape `today/mastery-overview.ts` reads. */
  readonly concepts: readonly ConceptCourses[];
  readonly options?: MasteryRollupOptions;
  /**
   * Pre-computed vitality readings, keyed by concept id — typically
   * `readAllConceptVitality`'s result. Optional; see this module's doc.
   */
  readonly vitality?: ReadonlyMap<string, VitalityReading>;
}

/**
 * Evidence fields F8.7 names, read directly from the append-only log — never
 * from the course-join snapshot. The success rule (`rating !== null && rating
 * !== 'again'`) mirrors `../mastery/rollup.ts`'s private `isSuccessRating`;
 * restated here as the one-line rule it is rather than widening that
 * module's export surface for a single boolean.
 */
function evidenceFor(entries: readonly ReviewLogEntry[], conceptId: string): EarlierCourseEvidence {
  let reviewCount = 0;
  let explainedBack = false;
  let lastCorrectAt: string | null = null;
  let lastCorrectInstant = -Infinity;

  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (!entry.conceptIds.includes(conceptId)) continue;

    if (entry.instrumentType === 'explain-back') {
      explainedBack = true;
      continue;
    }

    reviewCount += 1;
    const isSuccess = entry.rating !== null && entry.rating !== 'again';
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

/** Merges every `ConceptCourses` row into one course set per concept id — a concept can be named more than once across the input. */
function courseSetsByConcept(concepts: readonly ConceptCourses[]): Map<string, Set<string>> {
  const byConcept = new Map<string, Set<string>>();
  for (const concept of concepts) {
    const courses = byConcept.get(concept.conceptId) ?? new Set<string>();
    for (const course of concept.courses) {
      if (course !== '') courses.add(course);
    }
    byConcept.set(concept.conceptId, courses);
  }
  return byConcept;
}

/**
 * Pure. Reads no clock beyond what `options`/`vitality` already carry, writes
 * nothing, and computes nothing `../mastery/` does not already compute.
 *
 * Fires only where `newCourse` and at least one other course currently share
 * the identical `conceptId` (the practical ceiling this module's doc names),
 * AND that concept has at least one scored review or explain-back attempt —
 * "already carries history" is not satisfied by an empty evidence set.
 */
export function buildEarlierCourseRecognitions(
  input: EarlierCourseRecognitionInput,
): readonly EarlierCourseRecognition[] {
  const { newCourse, entries, concepts, options, vitality } = input;
  const byConcept = courseSetsByConcept(concepts);

  const results: EarlierCourseRecognition[] = [];

  for (const [conceptId, courses] of byConcept) {
    if (!courses.has(newCourse)) continue;

    const earlierCourses = [...courses].filter((course) => course !== newCourse).sort();
    if (earlierCourses.length === 0) continue;

    const evidence = evidenceFor(entries, conceptId);
    if (evidence.reviewCount === 0 && !evidence.explainedBack) continue;

    const { state } = computeConceptMastery(entries, conceptId, options);

    results.push({
      conceptId,
      newCourse,
      earlierCourses,
      state,
      vitality: vitality?.get(conceptId) ?? null,
      evidence,
    });
  }

  return results.sort((a, b) =>
    a.conceptId < b.conceptId ? -1 : a.conceptId > b.conceptId ? 1 : 0,
  );
}
