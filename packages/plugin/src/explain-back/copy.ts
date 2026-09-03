/**
 * Every static string the "Explain it back" view (`./modal.ts`, `ol-12gs`)
 * renders — the voice charter (`[D-096]`, vocabulary registry §9) binds all
 * of them, the same discipline `../review/copy.ts` already applies to F2.7's
 * on-demand channel and F5's own folded-path refusals. `copy.spec.ts` sweeps
 * this file's exported strings the same way `review/copy.spec.ts` sweeps
 * its own.
 *
 * `explainBackDepthHeading` (`[D-217]`, `ol-egov.104`, F5.3) replaces the
 * former `explainBackOutcomeHeading`, which printed one of three correctness
 * verdicts ("This holds up." / "Part of this holds up." / "This doesn't hold
 * up yet."). The ruling's own test — cover the detail beneath and read the
 * line alone — found that heading was a verdict wearing plain language, not
 * a fact, and its `holding` word family borrowed vocabulary the registry
 * reserves for recall over time (vocabulary registry §9, the `holds up` /
 * `hold up` rejected row). The replacement states what her explanation DID,
 * mapped from the five-level SOLO depth field (`[D-117]`), in the SAME five
 * phrases `../registry/copy.ts`'s `explainBackDepthPhrase` already speaks
 * for F8.4b's history rows — imported, never re-typed, so the two surfaces
 * she meets this wording in cannot drift apart. Fixed wording per level; it
 * never flexes with the grader's confidence (`[D-217]` clause 3) — a close
 * call belongs beneath the heading as a stated fact, not a change of
 * heading wording.
 *
 * **Timing note (`[D-217]`, `ol-0r92.48`):** the correctness verdict this
 * heading used to read is available the moment `./modal.ts`'s
 * `renderGradedPhase` runs; the SOLO depth level this heading now reads is
 * not — it is graded later, best-effort, inside `acceptGrading` (`ol-cqz8`).
 * So `modal.ts` never calls this function from `renderGradedPhase` — that
 * phase shows the fact-based detail (feedback, missed points, cited issues,
 * misconceptions) with no heading at all, never a verdict-shaped
 * placeholder. This heading is called from `renderAcceptedPhase`, once
 * `deps.recordSoloGradeAndReview` has actually run, and only when it
 * reports a level — see that file's own doc for the reachability gap this
 * leaves open (the real depth level does not yet reach that call in
 * production; the render path is real and ready for the day it does).
 */

import type { SoloLevel } from 'olea-contracts';

import { explainBackDepthPhrase } from '../registry/copy.js';

export const EXPLAIN_BACK_MODAL_TITLE = 'Explain it back';

export const EXPLAIN_BACK_TOPIC_PROMPT = 'What would you like to explain?';
export const EXPLAIN_BACK_TOPIC_CONTINUE_LABEL = 'Continue';

export const EXPLAIN_BACK_QUESTION_LABEL = 'The question';
export const EXPLAIN_BACK_ANSWER_PLACEHOLDER = 'Explain it in your own words.';
export const EXPLAIN_BACK_SUBMIT_LABEL = 'Check this';
export const EXPLAIN_BACK_GRADING_LABEL = 'Checking against your notes…';

export const EXPLAIN_BACK_MISSED_HEADING = "What your notes cover that this didn't";
export const EXPLAIN_BACK_CITED_HEADING = 'From your notes';
export const EXPLAIN_BACK_MISCONCEPTION_HEADING = 'Worth a closer look';

export const EXPLAIN_BACK_ACCEPT_LABEL = 'Keep this';
export const EXPLAIN_BACK_DISCARD_LABEL = 'Try again';

/**
 * `[D-171]`'s one-step affordance, worded for this surface: F8.4 asks every
 * instrument-rendering surface for a single pointer to that instrument's
 * registry entry, never a printed source path, heading or page here. One
 * control for the whole cited-issues list, not one per issue — every cited
 * issue in a single attempt is grounded in the same originating instrument.
 *
 * **F8.4b (`[D-175]`) reuses this exact string and click target rather than
 * adding a second affordance for "see my explain-back history".** The
 * ruling's own words: "mirroring `[D-171]`'s existing provenance shape...
 * rather than inventing a second pattern for a second kind of history." The
 * registry entry this button already opens (`prompt.originInstrumentId`,
 * `./modal.ts`) now also carries that instrument's explain-back history
 * (`packages/plugin/src/registry/view.ts`'s `renderExplainBackHistory`) —
 * no functional change needed here beyond this note, since the button
 * already lands on the right row.
 */
export const EXPLAIN_BACK_REGISTRY_ENTRY_ACTION = 'See in registry';

/**
 * The session-builder / Today-suggestion affordance's own label (F4.6, F6.4
 * — two of `[D-163]`'s four ruled entry points). Declared here, in the
 * OWNED explain-back package, rather than in `session-builder/copy.ts`,
 * so that module's own exhaustiveness sweep (`allSessionBuilderStrings`)
 * never needs to learn about a string this cluster owns.
 */
export const EXPLAIN_BACK_SESSION_ENTRY_LABEL = 'Explain something back';

/**
 * States what her explanation did, never whether it passed (`[D-217]`, F5.3
 * — see the module doc for the full argument and the timing note that
 * governs where `./modal.ts` may call this). `explainBackDepthPhrase`
 * (`../registry/copy.ts`) is reused verbatim, not re-typed, so this heading
 * and F8.4b's history rows never drift onto different wording for the same
 * depth level. Fixed per level; this function takes no confidence/closeness
 * argument at all, so there is nothing here that could vary the wording —
 * a close call is a fact for the caller to render beneath this heading, not
 * an input to it.
 */
export function explainBackDepthHeading(soloLevel: SoloLevel): string {
  return `You explained this ${explainBackDepthPhrase(soloLevel)}.`;
}
