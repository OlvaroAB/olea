/**
 * Decides whether a just-graded explain-back or a just-rated recall
 * instrument counts as M2 resolution evidence for a concept's recorded
 * misconceptions, and which `ResolutionEvidenceKind` it demonstrates when it
 * does — the missing half `./events.js`'s `buildResolutionEvidenceEvent`
 * and `./project.js`'s downgrade fold have had since they were built (both
 * exist, neither had a production caller — `ol-egov.141.89.6.19`,
 * discovered from the XBK chain spec, `docs/dev/intelligence-build/xbk.md`
 * §1's Misconception records row).
 *
 * ===========================================================================
 * WHAT "RESOLUTION EVIDENCE" MEANS HERE (knowledge model M2, R7)
 * ===========================================================================
 * M2: "A misconception moves to *resolved* when she demonstrates the correct
 * understanding, not merely when she passes a related card." R7 ranks
 * evidence recognition (MCQ) < recall (Q&A, cloze) < explanation
 * (explain-back), and `./types.ts`'s `ResolutionEvidenceKind` doc already
 * enforces the recognition exclusion as a type: MCQ is not a member of that
 * union, so a caller literally cannot construct an MCQ-sourced
 * `RecallResolutionCandidate` here (`instrumentType` is `'qa' | 'cloze'`).
 * This module supplies the other half of M2 — which of the two REMAINING
 * evidence tiers a given graded outcome counts as, and whether it counts at
 * all.
 *
 * - **Explanation.** Only a `'correct'` explain-back verdict counts. A
 *   `'partial'` verdict is exactly the case M2's "not merely" guards
 *   against — she engaged the concept but did not demonstrate correct
 *   understanding of it — and `'incorrect'` obviously does not. The fourth
 *   literal, `'unable-to-assess'` — **now landed** (`ol-0r92.130`, `[D-321]`):
 *   `../grading/gradingPipeline.js`'s `AcceptedExplainBackGrading.verdict` is
 *   still exactly `'correct' | 'partial' | 'incorrect'`, never widened,
 *   because `acceptExplainBackGrading` refuses to accept an unable-to-assess
 *   grading in the first place (a caller must route that outcome its own
 *   way before ever reaching accept). So the check below still needed no
 *   edit — no caller can construct an `ExplainBackResolutionCandidate` with
 *   `verdict: 'unable-to-assess'` from a real accepted grading — but the
 *   prediction this paragraph made when the shape was still hypothetical
 *   ("this stays correct once that lands") is now a confirmed fact, not a
 *   forecast.
 * - **Recall.** A Q&A/cloze rating is self-graded, not a correctness flag
 *   (`../instrument/rating.js`'s `CardReviewOutcome` doc: "she is the judge
 *   of whether she produced the answer"), so "demonstrates correct
 *   understanding" is read as any of the three ratings that mean she
 *   produced the answer herself — `'hard'`, `'good'`, `'easy'` — never
 *   `'again'`. Declared as an **allowlist of the three passing literals**,
 *   not "anything but Again": a resolution claim is the higher-harm
 *   direction to get wrong (it downgrades a real, evidenced misconception
 *   record — `./project.js`'s fold), so an unrecognised rating string fails
 *   closed to "no evidence," the opposite default from
 *   `./confusion-routing.js`'s `evaluateConfusionRouting`, whose own
 *   fail-closed case is merely "don't show the extra offer." Flagged as a
 *   Class B tunable in the bead report, same footing as
 *   `CONFUSION_ROUTING_LAPSE_THRESHOLD`: which ratings count is a threshold
 *   choice, not a persisted-shape decision — `ResolutionEvidenceKind`
 *   itself is unchanged either way.
 *
 * Deliberately typed `rating: string` rather than importing `Rating` from
 * `olea-contracts` — the same reasoning `./confusion-routing.js`'s
 * `ConfusionRoutingInput.rating` doc gives: the only thing this function
 * does with it is a small membership check, so narrowing to that keeps this
 * module free of a contracts dependency. A caller already holds a real
 * `Rating` and passes it through unchanged.
 *
 * ===========================================================================
 * WHY `hasOpenMisconceptionOnConcept` IS THE CALLER'S JOB, NOT A LOOKUP HERE
 * ===========================================================================
 * This module performs no I/O and holds no projection — same discipline
 * `./events.js`'s `ObservationInput`/`candidates` doc already states
 * ("Existing misconceptions eligible to reabsorb this occurrence — already
 * filtered ... by the caller"). A caller who already has the local
 * projection (`./project.js`'s `projectMisconceptions` output, or
 * `./store.js`'s all-sources variant) answers "does this concept carry an
 * `active`/`fading` record" with one filter over records it already holds —
 * `../grading/wiring.ts`'s `AcceptExplainBackGradingWithObservationContext
 * .candidateRecordsForConcept` already exists for exactly this shape, one
 * layer up. Skipping the check when it is actually true never suppresses
 * real evidence for the wrong reason; the gate exists purely so a passing
 * card whose concept carries no open misconception does not write a
 * needless no-op `resolution-evidence` event (`./project.js`'s downgrade is
 * a no-op with nothing to downgrade, but the event still costs an append to
 * the vault's misconception log — INV-4/D7.1 discipline, not correctness).
 *
 * ===========================================================================
 * FRESH LOCAL SHAPES, NOT AN IMPORT OF THE GRADING OR RATING MODULES
 * ===========================================================================
 * `ExplainBackResolutionCandidate.verdict` and `RecallResolutionCandidate
 * .instrumentType`/`.rating` are declared locally rather than imported from
 * `../grading/gradingPipeline.js` or `../instrument/rating.js` — mirroring
 * `./accepted-grading-observation.ts`'s own "A FRESH LOCAL MIRROR, NOT AN
 * IMPORT" reasoning: this directory needs the *shape*, not a live coupling
 * to concurrently-edited modules outside `ol-egov.141.89.6.19`'s `owns`. A
 * real `AcceptedExplainBackGrading.verdict` or a real `CardReviewOutcome
 * .rating` already satisfies these shapes with zero adapter code.
 */

import type { ResolutionEvidenceKind } from './types.js';

/** A just-accepted explain-back grading's outcome, reduced to what this decision needs. */
export interface ExplainBackResolutionCandidate {
  readonly source: 'explain-back';
  /** The prompt's subject concept — the caller already holds this (`../grading/gradingPipeline.js`'s own doc: "conceptIds deliberately do not appear" in that module, because the concept binding lives with the instrument, which the caller resolves). */
  readonly conceptId: string;
  /** `AcceptedExplainBackGrading.verdict`, or the wider outcome union `ol-0r92.105` adds — see module doc. */
  readonly verdict: 'correct' | 'partial' | 'incorrect' | 'unable-to-assess';
  /** Whether `conceptId` carries at least one `active`/`fading` `MisconceptionRecord` in the caller's local projection — see module doc for why this is the caller's job. */
  readonly hasOpenMisconceptionOnConcept: boolean;
}

/** A just-recorded Q&A/cloze review's rating, reduced to what this decision needs. Recognition (MCQ) is unrepresentable — see module doc. */
export interface RecallResolutionCandidate {
  readonly source: 'recall';
  readonly conceptId: string;
  /** F2.16's scheduled, self-graded instrument types. `'mcq'` is deliberately excluded from this union (M2, R7 — recognition never counts). */
  readonly instrumentType: 'qa' | 'cloze';
  /** The four-way `olea-contracts` rating just recorded — see module doc for why this is `string`, not the imported `Rating` type. */
  readonly rating: string;
  /** Whether `conceptId` carries at least one `active`/`fading` `MisconceptionRecord` in the caller's local projection — see module doc for why this is the caller's job. */
  readonly hasOpenMisconceptionOnConcept: boolean;
}

export type ResolutionEvidenceCandidate =
  | ExplainBackResolutionCandidate
  | RecallResolutionCandidate;

/** The three `Rating` literals that mean she produced the recall answer herself — see module doc for why this is an allowlist, not `rating !== 'again'`. */
const PASSING_RECALL_RATINGS: ReadonlySet<string> = new Set(['hard', 'good', 'easy']);

/**
 * Decides whether `candidate` is M2 resolution evidence, and which
 * `ResolutionEvidenceKind` it is when it is. Returns `null` when it is not —
 * a caller makes no `buildResolutionEvidenceEvent` call in that case; there
 * is no event to construct or discard.
 *
 * Pure: no clock, no I/O, no module-level state — same discipline every
 * other decision function in this directory follows (`./events.js`,
 * `./confusion-routing.js`), and what makes a replay of a past attempt
 * reproduce the same decision it produced then.
 */
export function decideResolutionEvidence(
  candidate: ResolutionEvidenceCandidate,
): ResolutionEvidenceKind | null {
  if (!candidate.hasOpenMisconceptionOnConcept) return null;

  if (candidate.source === 'explain-back') {
    return candidate.verdict === 'correct' ? 'explanation' : null;
  }

  return PASSING_RECALL_RATINGS.has(candidate.rating) ? 'recall' : null;
}
