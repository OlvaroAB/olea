/**
 * F2.10's heading-offer settings copy (`ol-0r92.29`).
 *
 * Held as pure data for the same reason `assignments-base-path-field-
 * copy.ts` and `term-dates-field-copy.ts` are: assertable without a DOM,
 * and kept out of `settings-tab.ts` so that file stays wiring-only.
 *
 * Wording states the clause's own two facts — F2.10, `docs/Olea_alpha_
 * functional_scope.md` (`olea-service`): the offer proposes, it never
 * creates silently, and turning it off stops it everywhere in the vault
 * (the `@manual` "toggleable off, cleanly" scenario in `features/F2-
 * review.md`). Neither sentence claims she is being checked on or
 * expected to act — same copy discipline `term-dates-field-copy.ts`
 * documents for its own field.
 */

export const HEADING_OFFER_SETTING_SECTION_HEADING = 'Heading offers';

export const HEADING_OFFER_SETTING_NAME = 'Offer cards for question-shaped headings';

export const HEADING_OFFER_SETTING_DESCRIPTION =
  'When a note heading reads as a question and has no card yet, Olea offers to create one — it never creates anything until you accept. Turn this off and no such offers appear anywhere in your vault.';
