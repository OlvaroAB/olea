/**
 * F5.3a / knowledge model R7 — the scheduling observation's THIRD trigger
 * for F2.21's on-demand explain-back offer (`ol-0r92.11`).
 *
 * `[D-083]` names the reciprocal prompt: her demonstrated use of a neighbour
 * concept Y while explaining subject concept X is recorded as a scheduling
 * observation, never scoring evidence, "marking the reciprocal prompt as
 * likely to succeed and worth surfacing soon." **`[D-185]` (`ol-0r92.34`)
 * widens the SOURCE side of that fact from explain-back only to any graded
 * instrument kind whose scoring subject is X with a neighbour Y as context**
 * — an MCQ, Q&A or cloze review can produce the same observation now, not
 * only an explain-back one. This module's own decision does not change
 * shape for that: it already took `conceptIds` and a `liveObservations` map
 * with no `instrumentType` anywhere in either, so widening the source is
 * invisible here at the type level. What DOES change is
 * {@link schedulingObservationPromptLine}'s wording below, which used to
 * assert "while explaining something else" — no longer honest when the
 * observation's source review was an MCQ, Q&A or cloze item, so the line is
 * kind-neutral now. R7, amended `[D-087]`
 * (docs/Olea_knowledge_model.md:623-625), authorises exactly the reader this
 * module is: "the scheduler reads the field, and the mastery fold never
 * looks at it." That authorises the READ. What the read DRIVES is F2.21's
 * existing offer (docs/Olea_alpha_functional_scope.md:1247-1280) — "explain
 * X, including how it relates to Y" — through the same on-demand channel
 * F2.7/F2.12 already use, alongside F2.12's trouble trigger and F2.21's own
 * strong-recall trigger. **The offer itself stays explain-back-shaped
 * regardless of source kind** — F2.21's reciprocal prompt was never widened,
 * only the set of instrument kinds that can produce the observation FEEDING
 * it. No new surface, no new copy discipline: this module decides WHETHER a
 * THIRD condition proposes that same offer, and what its own reason line
 * says — never WHERE it is shown, and never a fourth thing to persist.
 *
 * **Follows `./confusion-routing.ts`'s F2.12 pattern deliberately** (same
 * shape this repo's CLAUDE.md build spec names): a pure, synchronous
 * decision over a narrow input slice, a prompt-line builder checked against
 * the same `FORBIDDEN_VERDICT_PHRASES` mechanical floor `framing.spec.ts`
 * and `confusion-routing.spec.ts` already apply, and no side effects, no
 * persistence, no call into the grading pipeline.
 *
 * **Scope, deliberately narrow, mirroring confusion-routing.ts's own:** this
 * module decides WHETHER to offer, given the concept(s) an instrument just
 * graded is evidence for and which scheduling observations are still live —
 * it does not compute the live set itself (`../session/replay.js`'s
 * `replayUnconsumedSchedulingObservations` does, over the review log), does
 * not decide WHERE the offer is shown (`packages/plugin/src/review/session.ts`'s
 * `logAndAdvance`, the same call site F2.12 uses), and does not call the
 * grading pipeline. See that file's module doc for the full reachability
 * chain and `packages/plugin/src/grading/wiring.ts`'s module doc for why the
 * review-rating call site is a separate, concurrently-owned lane's work.
 *
 * **Never through queue composition** (F2.14/F2.21): this reads the concept
 * of an instrument a caller already chose to grade — an ordinary, already-
 * scheduled review, exactly as F2.12 does — and never composes, reorders or
 * filters `QueueCandidate`s. Declining changes nothing, matching F2.12/F2.21;
 * the observation itself is untouched by a decline, because nothing here
 * writes anything at all.
 */

import type { UnconsumedSchedulingObservation } from '../session/replay.js';

/**
 * The narrow slice this decision needs: which concepts the instrument just
 * graded is evidence for, and every scheduling observation currently live
 * (`../session/replay.js`'s `replayUnconsumedSchedulingObservations`,
 * keyed by `neighbourConceptId`). A caller holding the full replayed map
 * passes it through unchanged — this function never re-derives it from a
 * log itself, the same "pure, over entries someone else read" posture
 * `replay.ts`'s own module doc states for its own inputs.
 */
export interface SchedulingObservationRoutingInput {
  /** `ReviewInstrumentCommon.conceptIds` — every concept the just-graded instrument is evidence for. */
  readonly conceptIds: readonly string[];
  /** `replayUnconsumedSchedulingObservations`'s result — every neighbour concept with a still-live observation. */
  readonly liveObservations: ReadonlyMap<string, UnconsumedSchedulingObservation>;
}

export interface SchedulingObservationOffer {
  readonly shouldOffer: true;
  /** The concept the reciprocal offer is about (Y) — the matched key from `liveObservations`. */
  readonly neighbourConceptId: string;
  /** This trigger's own reason line, built by `schedulingObservationPromptLine` below. */
  readonly promptText: string;
}

export interface SchedulingObservationNoOffer {
  readonly shouldOffer: false;
}

export type SchedulingObservationDecision =
  | SchedulingObservationOffer
  | SchedulingObservationNoOffer;

const NO_OFFER: SchedulingObservationNoOffer = { shouldOffer: false };

/**
 * This trigger's own reason line — distinct from F2.12's lapse framing
 * ("You've missed this N times…") and F2.21's strong-recall framing, per
 * the build spec's requirement, under the same V3 fact / evidence-grounded
 * reinterpretation / one available action shape: fact ("you used this
 * correctly elsewhere"), reinterpretation ("that's usually a sign it's
 * ready"), one action ("want to explain it back?").
 *
 * **Kind-neutral wording, `[D-185]`.** The line used to say "while
 * explaining something else" — true only when the source review that
 * produced the observation was itself an explain-back. Now that any
 * instrument kind can produce one (`ol-0r92.34`), that phrasing would be a
 * false claim on an MCQ, Q&A or cloze source review — she was never
 * "explaining" anything in an MCQ. "Elsewhere" is honest regardless of
 * which kind the source review was, without this module needing to know
 * or carry that kind at all (see the module doc: `SchedulingObservation`
 * has no `instrumentType`, so there is nothing to interpolate even if the
 * line wanted to name it).
 *
 * Deliberately names no concept: `ReviewInstrumentCommon` carries no
 * human-readable concept name (only opaque `conceptIds`, a course code and
 * a note title — see `packages/plugin/src/review/types.ts`), so — same
 * discipline `confusion-routing.ts`'s prompt line already keeps
 * content-free — this stays generic rather than fabricating a display name
 * to interpolate.
 */
export function schedulingObservationPromptLine(): string {
  return (
    "You used this correctly elsewhere. That's usually a sign " +
    "it's ready — want to explain it back?"
  );
}

/**
 * F5.3a's third-trigger decision, in one pure function: does the
 * just-graded instrument's concept match a still-live scheduling
 * observation, and if so, what does the offer say?
 *
 * The FIRST matching concept id wins (an instrument's `conceptIds` are
 * already in "her authored `topic:` order" per `ReviewInstrumentCommon`'s
 * own doc, so the first match is the one she'd recognise as primary) —
 * `conceptIds` realistically carries very few entries in v0.9, and ties are
 * not a case this clause needs to adjudicate. No live observation names any
 * of the instrument's concepts: no offer, honestly (SCOPE point 4 — zero
 * unconsumed observations changes no behaviour anywhere in this chain).
 */
export function evaluateSchedulingObservationRouting(
  input: SchedulingObservationRoutingInput,
): SchedulingObservationDecision {
  for (const conceptId of input.conceptIds) {
    if (input.liveObservations.has(conceptId)) {
      return {
        shouldOffer: true,
        neighbourConceptId: conceptId,
        promptText: schedulingObservationPromptLine(),
      };
    }
  }
  return NO_OFFER;
}
