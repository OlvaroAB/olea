/**
 * Copy for the kinship question C7.8 (`[D-098]`, point 4) puts at the SAME
 * moment recognition fires at course setup: *"Kinship is a FACT, not an
 * inference: ... that is the moment to ask once 'is this a continuation of
 * X?', writing an explicit kinship link."* `features/F1-sources.md`'s
 * "kinship is asked once" and "kinship is never inferred from names"
 * scenarios are the full BDD for the behaviour; this module holds only the
 * strings.
 *
 * ## A different control about a different object
 *
 * `features/F8-concepts-scope.md`'s F8.7 scenario "the kinship question at
 * the same moment is about the course, not about the recognition" draws the
 * line this module holds: the kinship control asks about the two COURSE
 * records, never about a concept, and answering it must not read as
 * confirming, merging or accepting F8.7's recognition claim (`./copy.ts`).
 * So this module never emits "concept", "recognition", "claim" or "merge" —
 * `kinship-copy.spec.ts` asserts it over every string here, the same corpus
 * discipline `./copy.ts` uses for its own forbidden-word list.
 *
 * ## No string-similarity, ever
 *
 * `kinshipQuestion` takes the earlier course as an explicit parameter — the
 * candidate a caller already has (typically the SAME `earlierCourses` entry
 * F8.7's recognition surfaced, per D-098's "the recognition surface already
 * fires at setup on concept overlap — that is the moment to ask"). This
 * module never computes or compares course names itself; there is nowhere
 * here for a string-similarity heuristic to live.
 */

/** Sits above the yes/no controls wherever course setup renders this question. Asked once — see this module's doc. */
export function kinshipQuestion(earlierCourse: string): string {
  return `Is this a continuation of ${earlierCourse}?`;
}

export const KINSHIP_YES_LABEL = 'Yes, this continues it';
export const KINSHIP_NO_LABEL = 'No, this is a different course';

/**
 * Every string this module can put on screen — the copy test's whole
 * surface, matching `./copy.ts`'s `allRecognitionClaimStrings()` and
 * `../today/copy.ts`'s `allTodayStrings()`.
 */
export function allKinshipStrings(): readonly string[] {
  return [kinshipQuestion('EXAMPLE101'), KINSHIP_YES_LABEL, KINSHIP_NO_LABEL];
}
