/**
 * Every static string the "Explain it back" view (`./modal.ts`, `ol-12gs`)
 * renders — the voice charter (`[D-096]`, vocabulary registry §9) binds all
 * of them, the same discipline `../review/copy.ts` already applies to F2.7's
 * on-demand channel and F5's own folded-path refusals. `copy.spec.ts` sweeps
 * this file's exported strings the same way `review/copy.spec.ts` sweeps
 * its own.
 *
 * `explainBackOutcomeHeading` deliberately never prints "correct" / "partial"
 * / "incorrect" (V6, and GLOSSARY's "never exposed to her by name" posture
 * for graded jargon) — it names what the grading found in plain language,
 * leaving the model's own generated `feedback` text (governed separately,
 * `@manual` per `features/F5-explain-back.md`) to carry the substance.
 */

import type { ExplainBackGradingWireResponse } from 'olea-core';

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
 * Plain-language framing of the judge's `correct`/`partial`/`incorrect`
 * verdict, never the enum word itself (V6). The model's own `feedback` text
 * always renders alongside this as the specific evidence — this heading is
 * orientation, not the whole answer.
 */
export function explainBackOutcomeHeading(
  verdict: ExplainBackGradingWireResponse['verdict'],
): string {
  switch (verdict) {
    case 'correct':
      return 'This holds up.';
    case 'partial':
      return 'Part of this holds up.';
    case 'incorrect':
      return "This doesn't hold up yet.";
  }
}
