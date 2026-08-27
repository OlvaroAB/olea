/**
 * Copy for the course-setup confirmation surface itself — C7.8's course
 * lifecycle BEGINNING clause (`[D-098]`, point 1): *"detection proposes
 * ('this looks like a course'), she confirms and names."*
 *
 * Detection (the root-path mapping, `features/F1-sources.md`'s
 * `core/course/lifecycle.spec` / `core/course/mapping.spec`) is core-side and
 * unbuilt (ol-0r92.5's report). This module holds only the strings the
 * plugin-side confirmation renders once a proposal already exists — it takes
 * the suggested name and root path as given, the same "caller supplies the
 * fact, this module never derives it" split `../today/copy.ts` and `./copy.ts`
 * both use.
 *
 * ## Never implies a course record already exists
 *
 * `features/F1-sources.md`'s scenario "detection proposes a course and never
 * creates one" is explicit: *"no course record exists until she confirms it
 * and supplies its name; nothing is auto-created and silently populated."*
 * `COURSE_PROPOSAL_HEADING` states a reading ("looks like"), never a fact
 * ("is") — `confirmation-copy.spec.ts` asserts no string here reads as
 * "created", "added" or "saved" ahead of her confirming.
 */

/** States a reading, never a fact — no course record exists yet. See this module's doc. */
export const COURSE_PROPOSAL_HEADING = 'This looks like a course';

/** Label for the name field she confirms or overwrites — "she confirms and names" (C7.8/[D-098] point 1). */
export const COURSE_NAME_FIELD_LABEL = 'Name';

/** The one action this surface offers: accepting the proposal and the name as it stands (edited or not). */
export const CONFIRM_BUTTON_LABEL = 'Confirm';

/** Every string this module can put on screen — same corpus-test shape as `./kinship-copy.ts` and `./copy.ts`. */
export function allConfirmationStrings(): readonly string[] {
  return [COURSE_PROPOSAL_HEADING, COURSE_NAME_FIELD_LABEL, CONFIRM_BUTTON_LABEL];
}
