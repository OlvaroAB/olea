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
 * `[D-321]` / `ol-0r92.130`: pass one could not tell whether this was a
 * genuine attempt at all — a defined non-verdict (`GroundedGrading`'s
 * `outcome: 'unable-to-assess'` branch, `olea-core`), never a wrong-answer
 * grade. `./modal.ts`'s `renderGradedPhase` shows this instead of any
 * feedback/missed-points/cited-issues detail and renders no Accept button —
 * `EXPLAIN_BACK_DISCARD_LABEL` ("Try again") is the one action, and it
 * writes nothing (see that method's own doc).
 *
 * **PLACEHOLDER COPY — no ruled string exists for this outcome.** Neither
 * the vocabulary registry nor F5 (`features/F5-explain-it-back.md`,
 * `docs/Olea_alpha_functional_scope.md`) names wording for it yet; this is a
 * plain, voice-charter-plausible sentence, not a ratified one — flagged in
 * this bead's report for the same reason `copy.spec.ts` sweeps this file.
 */
export const EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE =
  "Olea couldn't tell whether this was a real attempt at an answer, so nothing was graded.";

/**
 * `[D-322]` (vocabulary registry §19, "Practice-only"): shown before she answers a freeform
 * explain-back prompt (command palette or Home, naming no subject) whose topic did not resolve to
 * one concept — an ambiguous match, or no match at all (`./request.ts`'s
 * `matchFreeformTopicToConcept`). The registry ratifies the SHAPE only ("an upfront designation,
 * offered before grading") and explicitly leaves the wording open: *"The exact copy is a design
 * question this ruling does not settle."*
 *
 * **PLACEHOLDER COPY — no ruled string exists for this outcome**, the same posture
 * `EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE` above states for itself and for the same reason:
 * flagged in this bead's report, swept by `copy.spec.ts`'s voice-charter checks like every other
 * string in this file, but not itself a ratified sentence.
 */
export const EXPLAIN_BACK_PRACTICE_ONLY_NOTICE =
  "This one's for practice — it won't count as scored evidence.";

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

// ---------------------------------------------------------------------------
// [STY-0h] (`ol-l5og.18.8`) — the two refusal families, told apart the way
// `docs/design/pass5-refusal-trends-shell/ui_kits/olea-plugin/Pass5Refusal.jsx`
// (`olea-service`) draws them (C4.7, `[D-089]`). `./modal.ts`'s
// `renderRefusedPhase` renders the FACT sentence from `../review/copy.ts`'s
// `explainBackInsufficientNotesRefusal`/`EXPLAIN_BACK_CHECK_FAILED_REFUSAL` —
// unchanged here — and reads these two eyebrows plus the found-list caption
// to draw the edge, mark and evidence cues around it. The third reason,
// `'unavailable'` (no Worker configured), is NOT one of these two: it is
// F7.8's degradation posture, not a C4.7 refusal, so it takes neither eyebrow
// (see `./modal.ts`'s own doc on that branch).
// ---------------------------------------------------------------------------

/** `reason: 'insufficient-notes'` — retrieval ran and came back too thin. */
export const EXPLAIN_BACK_NOTHING_MATCHED_EYEBROW = 'Nothing matched · what your notes returned';

/** `reason: 'check-failed'` — the check itself did not run. */
export const EXPLAIN_BACK_COULD_NOT_CHECK_EYEBROW = "Couldn't check · nothing was decided";

/**
 * The found-list caption (C4.7's permitted content: which notes, at what
 * position — never a summary claim about the vault beyond them). Shown only
 * when `prompt.sourceBlocks` is non-empty; an empty list renders no found-list
 * at all rather than an empty one, the same "nothing to show" restraint
 * `gap/copy.ts`'s coverage screen already holds.
 */
export const EXPLAIN_BACK_FOUND_LIST_CAPTION = 'What your notes returned';
