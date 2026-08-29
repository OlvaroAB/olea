/**
 * F7.2's term-dates settings copy, amended in by `[D-147]` (`ol-0r92.6`).
 *
 * Held as pure data for the same reason `base-url-field-copy.ts` and
 * `token-field-copy.ts` are: assertable without a DOM, and kept out of
 * `settings-tab.ts` so that file stays wiring-only.
 *
 * **Wording is a Class B default, not a ratified string.** The proposal
 * (`docs/dev/proposals/D-term-dates-ask-once.md` §5, open question 5) is
 * explicit that its own example sentence is "a draft for illustration, not
 * a proposed final string" — `[D-147]`'s ratification did not resolve that
 * question. This module adopts the proposal's draft near-verbatim because
 * it already satisfies the clause's own copy rules (states a fact about the
 * calendar, never compliance framing) and there is nothing cheaper to
 * derive it from; it should go through whatever review the rest of F6.9's
 * sentences get before ship, per that section's own "must survive being
 * read on a bad week" test.
 *
 * **Forbidden shapes, checked directly in the test file:** no framing that
 * implies she is being checked on or expected to keep up, and the skip
 * label reads as a dismissal, never a promise to ask again later — F7.2's
 * own words: *"never again after either"* rules out anything shaped like
 * "Remind me later".
 */

export const TERM_DATES_SECTION_HEADING = 'Term dates';

export const TERM_DATES_FIELD_DESCRIPTION =
  "When does this term run? Olea uses this to say whether material is arriving at the usual pace for a course — not to track how you're doing. Leave blank, or skip below, and the reading still works; it just has no yardstick.";

export const TERM_START_FIELD_NAME = 'Term start';

export const TERM_END_FIELD_NAME = 'Term end';

/**
 * Never "Remind me later" — F7.2's ask is until-answered-or-dismissed, and a
 * label promising a future reminder would reintroduce the recurring-prompt
 * shape the clause rules out.
 */
export const TERM_DATES_SKIP_BUTTON_LABEL = 'Skip for now';

export const TERM_DATES_SKIP_DESCRIPTION =
  'Stops Olea asking about term dates. You can still add them here any time.';
