/**
 * `buildKindInputs` — the producer of the inputs `olea-core`'s `primaryKindFor` reads for the
 * sweep's first generation call per concept (F3.3; `ol-egov.141.89.105.7`).
 *
 * **The mapping, as ruled.** F4.8 maps her assessment `type` to a declared format class
 * (`olea-core`'s `formatClassOf`, the table's one home, which `buildFormatMatch` also reads through
 * `assessmentFormatOf`).
 * Each class asks for one first kind ({@link FIRST_KIND_BY_FORMAT_CLASS}):
 *  - recall-style asks for multiple choice (F4.8: "MCQ drilling matches a recall-style paper");
 *  - written and practical ask for a question-and-answer card. F4.8 names structured argument
 *    and ordered-process questions for them, which v0.9 does not have; `[D-550]` (a) rules the
 *    card as the fallback until such an instrument exists, its evidence reported as self-rated
 *    recall and never as demonstrated argument-writing or practical performance (the reporting
 *    half is `ol-egov.141.89.105.13`).
 *
 * **The grain, as ruled.** `[D-551]` (a), a provisional baseline: per course, from the course's
 * nearest assessment not yet passed. Every concept in a course asks for the same first kind, and
 * the kind follows the calendar: when that assessment's date passes, the next one decides. Revisit
 * when assessment records carry a scope (F1.7). "The nearest assessment" is read by
 * `format-match.ts`'s existing {@link nearestUpcomingAssessment}, the sweep register's own
 * reading, so the first kind and the register never disagree on which assessment applies. Giving
 * that rule one home across the sweep, the session composer and the gap view is
 * `ol-egov.141.89.105.15`'s, not this module's.
 *
 * **Her recorded preference, and the floor.** Absent a known format (no assessment still ahead
 * with a readable date), F3.3 falls back to her recorded preference: `olea-core`'s
 * `observedInstrumentTypeOrder`, the kind she has rated most often. That is today's reading, the
 * same one the further-call triggers make, counted across the whole vault rather than per course
 * (`review-log/generation-signals.ts` names that limit). With nothing rated, `primaryKindFor`
 * floors to `DEFAULT_PRIMARY_KIND_FLOOR` (multiple choice). This module never computes the floor;
 * it hands `primaryKindFor` an empty preference and lets it decide.
 *
 * **The knowledge kind is not read here.** `[D-549]`: the assessment format chooses the first
 * instrument; the knowledge classification guides follow-on practice (`ol-egov.141.89.105.8`).
 *
 * **One mapping for two consumers.** {@link KindInputs.formatMatchFor} answers the further-call
 * format-ask trigger's `formatMatchFor` from the same table and the same nearest assessment, so the
 * first kind and that trigger read one mapping (`instrument-primary-call-owner.md` section 5).
 *
 * **A kind change discards nothing.** This module only answers which kind a course asks for next.
 * The sweep's dedupe is per (course, concept) and blind to kind, so a concept drafted under one
 * kind is never re-asked, rewritten or re-scored when its course's kind changes; `[D-551]`'s
 * build constraint is pinned by `test/generation/first-kind-change.ol-egov.141.89.105.7.spec.ts`.
 *
 * **Purity boundary.** {@link deriveKindInputs} is pure. {@link buildKindInputs} reads the review
 * log once and nothing else: no network, no model, and never content (D-005). It runs once per
 * sweep, composed fresh like `buildFormatMatch`, and returns plain synchronous lookups, matching
 * `GenerationPipelineDeps.kindInputsFor`'s signature.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type {
  AssessmentFormatClass,
  AssessmentRecord,
  CalendarDay,
  PrimaryKindInput,
  SchedulableInstrumentType,
  VaultSource,
} from 'olea-core';
import {
  calendarDayFromLocalDate,
  formatClassOf,
  observedInstrumentTypeOrder,
  readReviewLogHistory,
} from 'olea-core';
import { nearestUpcomingAssessment } from './format-match.js';

/**
 * F4.8 as amended by `[D-550]`: the first kind each declared format class asks for. Declared, not
 * fitted. Non-persisted, Class B: a structured-argument or ordered-process instrument replacing
 * `'qa'` for written or practical is a later change here, behind its own decision.
 */
export const FIRST_KIND_BY_FORMAT_CLASS: Readonly<
  Record<AssessmentFormatClass, SchedulableInstrumentType>
> = Object.freeze({
  'recall-style': 'mcq',
  written: 'qa',
  practical: 'qa',
});

/** The first kind `formatClass` asks for — {@link FIRST_KIND_BY_FORMAT_CLASS}. */
export function firstKindForFormatClass(
  formatClass: AssessmentFormatClass,
): SchedulableInstrumentType {
  return FIRST_KIND_BY_FORMAT_CLASS[formatClass];
}

/** The three lookups one reading produces; every one is synchronous and never throws. */
export interface KindInputs {
  /** `GenerationPipelineDeps.kindInputsFor`: the inputs `primaryKindFor` reads for a course. */
  readonly kindInputsFor: (courseCode: string) => PrimaryKindInput;
  /**
   * The further-call triggers' and the arrival queue's `formatMatchFor`: the kind the course's
   * nearest assessment's format asks for, `undefined` when no format is known.
   */
  readonly formatMatchFor: (courseCode: string) => SchedulableInstrumentType | undefined;
  /** The arrival queue's `recordedPreferenceFor`: her observed order, the same for every course today. */
  readonly recordedPreferenceFor: (courseCode: string) => readonly SchedulableInstrumentType[];
}

export interface DeriveKindInputsInput {
  /** Every course's assessment records, e.g. `resolveAssessments(...).records`. */
  readonly assessments: readonly AssessmentRecord[];
  /** Her review log's entries, e.g. `readReviewLogHistory(...).entries`. Empty means nothing rated yet. */
  readonly reviewLog: readonly ReviewLogEntry[];
  /** The local day the nearest assessment is read against. */
  readonly today: CalendarDay;
}

/** The pure core of {@link buildKindInputs}: no vault, no clock. */
export function deriveKindInputs(input: DeriveKindInputsInput): KindInputs {
  const recordedPreference = observedInstrumentTypeOrder(input.reviewLog);
  const formatKinds = new Map<string, SchedulableInstrumentType>();
  const courses = new Set<string>();
  for (const record of input.assessments) {
    if (record.course !== undefined) courses.add(record.course);
  }
  for (const course of courses) {
    const nearest = nearestUpcomingAssessment(course, input.assessments, input.today);
    if (nearest === undefined) continue;
    formatKinds.set(course, firstKindForFormatClass(formatClassOf(nearest.type)));
  }
  return {
    kindInputsFor: (courseCode) => ({
      formatMatch: formatKinds.get(courseCode) ?? null,
      recordedPreference,
    }),
    formatMatchFor: (courseCode) => formatKinds.get(courseCode),
    recordedPreferenceFor: () => recordedPreference,
  };
}

export interface KindInputsDeps {
  readonly vault: VaultSource;
  /** Every course's assessment records — the same list `buildFormatMatch` is handed for the sweep. */
  readonly assessments: readonly AssessmentRecord[];
  /** Defaults to `() => new Date()`; the plugin's one clock seam in production. */
  readonly now?: () => Date;
}

/**
 * Composes {@link KindInputs} for one sweep: her review log, read once, and the assessments the
 * caller already holds. A review log that cannot be read leaves her preference empty, never a
 * thrown sweep: the course then asks for its format's kind, or the floor.
 */
export async function buildKindInputs(deps: KindInputsDeps): Promise<KindInputs> {
  let reviewLog: readonly ReviewLogEntry[] = [];
  try {
    reviewLog = (await readReviewLogHistory(deps.vault)).entries;
  } catch {
    reviewLog = [];
  }
  return deriveKindInputs({
    assessments: deps.assessments,
    reviewLog,
    today: calendarDayFromLocalDate(deps.now ? deps.now() : new Date()),
  });
}
