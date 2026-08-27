/**
 * Every user-facing string F8.7's recognition claim can render (`RECOG-1`,
 * `[D-058]`).
 *
 * Same discipline as `../today/copy.ts`: strings live here, away from the DOM,
 * so `test/course-setup/copy.spec.ts` can assert over every one of them and
 * `view.ts` renders nothing it did not get from this module.
 *
 * ## The one rule this file exists to hold the line on
 *
 * F8.7: *"Recognition is a reading, not an action: she is not asked to
 * confirm, merge or accept anything, there is no decision to make, and
 * declining is not a state."* Nothing in this module produces a string that
 * reads as a question, a button label for confirm/merge/accept, or a
 * declined/dismissed state — `test/course-setup/copy.spec.ts` asserts this
 * over `allRecognitionClaimStrings()`, the same shape `today/copy.spec.ts`
 * uses for F6.1.
 *
 * ## Course codes are runtime data, never a compiled string
 *
 * `RecognitionClaimCopy.earlierCourses` is the array of real course codes,
 * left for `view.ts` to render directly — the same split `today/copy.ts`'s
 * `EffortInsightLine` uses (`course` kept apart from the assembled `text`).
 * No function here takes a course code and bakes it into a returned string,
 * so there is nowhere for a real course name to end up compiled into this
 * module (INV-3).
 *
 * ## Vitality's words are a stopgap, not a second vocabulary site
 *
 * `olea-core`'s `mastery/display.ts` is F2.11's single vocabulary site for
 * growth stage, and this module reads `MASTERY_DISPLAY` from it rather than
 * repeating the four words. Vitality has no equivalent site yet —
 * `display.ts`'s own doc defers wiring vitality's display words to `MAT-2`
 * (`ol-95vv`), unbuilt at the time this shipped. `VITALITY_LABEL` below is a
 * stopgap copied VERBATIM from `mastery/vitality.ts`'s own module doc ("the
 * student sees *holding*, *needs tending* and *too early to say*") — nothing
 * invented — and is meant to be deleted in favour of `MAT-2`'s mapping once it
 * ships, not extended. Flagged in the `RECOG-1` report for retroactive review
 * (Class B).
 */

import type { MasteryState } from 'olea-contracts';
import type { EarlierCourseEvidence, EarlierCourseRecognition, Vitality } from 'olea-core';
import { MASTERY_DISPLAY } from 'olea-core';

/** Sits above the claim block wherever course setup renders one. States the fact, asks nothing. */
export const RECOGNITION_CLAIM_HEADING = 'Already met';

/** See this module's doc: copied verbatim from `mastery/vitality.ts`, not invented. */
const VITALITY_LABEL: Readonly<Record<Vitality, string>> = {
  holding: 'holding',
  tending: 'needs tending',
  early: 'too early to say',
};

/** `3 reviews` · `1 review` · `0 reviews` — a count, flat, matching `today/copy.ts`'s `conceptCountLabel`. */
export function reviewCountLabel(count: number): string {
  return count === 1 ? '1 review' : `${count} reviews`;
}

/**
 * `last correct 12 Aug 2026`, or `null` when no scored review has ever
 * succeeded — a fact that can be true even when `explainedBack` is true, so
 * it is a real state and not an error.
 */
export function lastCorrectClause(lastCorrectAt: string | null): string | null {
  if (lastCorrectAt === null) return null;
  const parsed = new Date(lastCorrectAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const formatted = parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `last correct ${formatted}`;
}

/**
 * The whole evidence line F8.7 names: reviews, last correct, and whether it
 * was ever explained back — joined, never dropped for brevity, because
 * "showing what the claim rests on" is the entire point of the clause.
 */
export function evidenceLine(evidence: EarlierCourseEvidence): string {
  const parts = [reviewCountLabel(evidence.reviewCount)];
  const lastCorrect = lastCorrectClause(evidence.lastCorrectAt);
  if (lastCorrect !== null) parts.push(lastCorrect);
  if (evidence.explainedBack) parts.push('explained back at least once');
  return parts.join(' · ');
}

/** `MASTERY_DISPLAY`'s label for the state — the one growth-stage vocabulary site, read, never repeated. */
export function stageLabel(state: MasteryState): string {
  return MASTERY_DISPLAY[state].label;
}

/** See this module's doc — stopgap only. `null` when no vitality reading was supplied (honest "not read"). */
export function vitalityLabel(vitality: Vitality | null): string | null {
  return vitality === null ? null : VITALITY_LABEL[vitality];
}

/** One recognition, reduced to exactly what F8.7 says the claim shows. */
export interface RecognitionClaimCopy {
  readonly conceptId: string;
  /** Every other course this concept currently sits in — real vault data, rendered by `view.ts`, never a compiled string. */
  readonly earlierCourses: readonly string[];
  readonly stage: string;
  /** `null` when no vitality reading was supplied — see `vitalityLabel`. */
  readonly vitality: string | null;
  readonly evidence: string;
}

export function buildRecognitionClaimCopy(
  recognition: EarlierCourseRecognition,
): RecognitionClaimCopy {
  return {
    conceptId: recognition.conceptId,
    earlierCourses: recognition.earlierCourses,
    stage: stageLabel(recognition.state),
    vitality: vitalityLabel(recognition.vitality?.value ?? null),
    evidence: evidenceLine(recognition.evidence),
  };
}

/**
 * Every string this module can put on screen, sampled across the values that
 * change their wording — the copy test's whole surface, matching
 * `today/copy.ts`'s `allTodayStrings()`.
 */
export function allRecognitionClaimStrings(): readonly string[] {
  return [
    RECOGNITION_CLAIM_HEADING,
    reviewCountLabel(0),
    reviewCountLabel(1),
    reviewCountLabel(4),
    lastCorrectClause('2026-08-12T09:00:00+02:00') ?? '',
    evidenceLine({
      reviewCount: 3,
      explainedBack: true,
      lastCorrectAt: '2026-08-12T09:00:00+02:00',
    }),
    evidenceLine({ reviewCount: 0, explainedBack: true, lastCorrectAt: null }),
    ...(['seed', 'sprout', 'sapling', 'tree'] as const).map((state) => stageLabel(state)),
    ...(['holding', 'tending', 'early'] as const).map((v) => vitalityLabel(v) ?? ''),
  ];
}
