/**
 * `[SESS-8.2]` (`ol-egov.132.2`), component register row 3.6, `[D-033]` — the
 * one place the composed study session she is shown lives, per
 * `../../../olea-service/docs/dev/one-assembly-path.md` §3a/§3b.
 *
 * ## What this replaces
 *
 * `queue/rebuild-controller.ts` (`olea-core`) is deliberately generic over
 * both chains — its own doc: "3.6 is one controller above both chains, not a
 * second copy per consumer." Production nonetheless held two separate
 * instances of it: one `SittingState<SessionBuilderState>` per
 * session-builder leaf (`session-builder/provider.ts`'s
 * `createLocalSessionBuilderProvider`) and one
 * `SittingState<readonly ReviewQueueItem[]>` inside
 * `review/queue-adapter.ts`'s `createFrozenReviewQueue`. Two holders meant
 * two compositions with no handoff between them — the defect
 * `one-assembly-path.md` §1c names.
 *
 * This module is the one holder both surfaces converge onto: a single
 * `SittingState<ComposedStudySession>` per plugin instance, created once
 * (e.g. alongside the other per-instance providers `main.ts` wires) and
 * shared by every reader — Home, the session builder, Today and the review
 * tab (§3a: "all read that one holder").
 *
 * ## What this module deliberately does NOT do
 *
 * **It does not compose.** `enter` takes an already-built
 * `ComposedStudySession`; this module never calls `buildComposedStudySession`
 * or any other composer, the same discipline `rebuild-controller.ts` itself
 * states for `decideRebuild`'s caller ("it never calls
 * `composeQueue`/`buildStudySession` itself"). Assembling the input a
 * composer needs is client-surface work outside this bead's owned paths.
 *
 * **It does not act on a decision.** `decide` is the one `decideRebuild` call
 * site §3b asks for, called once at the point she presses Start — but it only
 * reports the `RebuildDecision`; it never calls `enter`/`exit` itself.
 * `'sitting-stale'` in particular must not auto-recompose (`[D-162]`: the
 * sitting *ends*, and the caller decides what happens next, never a
 * recompose-the-tail this module could not tell apart from). Folding "decide"
 * and "act" into one call would make it impossible for a future caller to
 * insert §3b's rule that a material change recomposes **before** entering the
 * sitting, never during.
 *
 * **It holds no memory across processes.** No cache file, no vault write, no
 * settings read — a freshly constructed holder always starts idle. Row 2's
 * whole promise is "no new persisted state" (the bead's own words); see the
 * design note §3a, "in memory, in the freeze controller ... and nowhere
 * else."
 *
 * ## Reachability (`[D-072]` clause 5)
 *
 * No plugin surface calls `createStudySessionHolder` yet. Wiring one shared
 * instance into `main.ts` and rewiring Home, the session builder, the review
 * tab and Today to read it is `ol-egov.132.3` (the executor), `.4` (the
 * review tab) and `.5` (Today) — this bead is the holder those rows wire
 * onto, built and tested ahead of its callers per the ordering
 * `one-assembly-path.md` §6 lays out ("2. One session holder ... 3 needs 2").
 */

import type { StudyPlanEnvelope } from 'olea-contracts';
import type {
  ComposedStudySession,
  DecideRebuildInput,
  RebuildDecision,
  SittingState,
} from 'olea-core';
import { decideRebuild, enterSitting, exitSitting, IDLE_SITTING } from 'olea-core';

/** The one shape this holder ever carries — never a queue, never a builder-view union. */
export type StudySessionSitting = SittingState<ComposedStudySession>;

/**
 * One composed-session freeze per plugin instance. Construct exactly one per
 * running plugin (§3a: "Home, the session builder, Today and the review tab
 * all read that one holder") and share it — constructing a second instance
 * would reintroduce the exact two-holder split this bead exists to collapse.
 */
export interface StudySessionHolder {
  /** The current sitting, for a reader that only needs to look — Home's preview, Today's render, a review tab finding the holder idle (§3c). Never mutates. */
  readonly getSitting: () => StudySessionSitting;
  /**
   * She opens a sitting on `session`. Always transitions to `'active'`, even
   * from an already-active state — `rebuild-controller.ts`'s own
   * `enterSitting` doc: a caller re-entering mid-sitting is choosing to start
   * a new one, and this module has no fact that would let it tell that apart
   * from "she finished and started another."
   *
   * `plan` (`ol-egov.141.89.10.45`, C5.8/`[D-193]`): the plan in force at
   * this fresh entry, captured beside the session and returned by every
   * later {@link resolveCompositionPlan} call for THIS sitting, no matter
   * what the live plan becomes meanwhile. Always reset here — a fresh
   * `enter()` is a fresh sitting, so any previously captured plan is
   * discarded along with the previous `session`, the same "choosing to
   * start a new one" discipline the sitting itself already gets. Omitted
   * (every caller outside this package's own `review/open-session.ts`,
   * e.g. `main.ts`'s `enterStudySessionHolderForStart`, which has no
   * plan in hand at Start) leaves it uncaptured — {@link
   * resolveCompositionPlan}'s own doc says what that means for the first
   * reader that supplies one.
   */
  readonly enter: (
    now: Date,
    session: ComposedStudySession,
    plan?: StudyPlanEnvelope | null,
  ) => void;
  /**
   * `[SESS-8.6]`'s outrun growth (`ol-v7r5.35`): the SAME sitting gets a
   * wider `session`, never a new one — `open-session.ts`'s own call site
   * preserves `enteredAt` for exactly this reason. Unlike {@link enter},
   * this never touches the captured composition plan: an extension grows
   * the held composition under "the same plan's shares" (C5.8's own
   * words), so the plan {@link resolveCompositionPlan} already froze for
   * this sitting must stay frozen through the growth too.
   */
  readonly growActiveSitting: (now: Date, session: ComposedStudySession) => void;
  /** She finished, or the sitting went stale and the caller is closing it out before composing a fresh one. Releases the freeze, including the captured composition plan. */
  readonly exit: () => void;
  /**
   * The one `decideRebuild` call site (§3b) — called once, at Start, against
   * whatever trigger/staleness facts the caller has assembled. Reports the
   * decision and nothing else; see the module doc's "what this does not do."
   */
  readonly decide: (input: DecideRebuildInput) => RebuildDecision;
  /**
   * C5.8's freeze, extended to the plan a held sitting is joined against
   * (`[D-193]`, `ol-egov.141.89.10.45`): a sitting's composition plan is
   * captured once and every later call returns that same frozen value,
   * ignoring whatever `candidate` it is next called with.
   *
   * "Captured once" has two sources. The ordinary one is {@link enter}'s own
   * `plan` argument — `open-session.ts`'s fresh-compose branch always
   * supplies it, so the freeze starts at the exact instant the sitting
   * begins. The fallback is lazy: when nothing has been captured yet (a
   * sitting `enter()`ed with `plan` omitted, e.g. `main.ts`'s
   * `enterStudySessionHolderForStart`, which composes and enters a fresh
   * sitting before the review tab — and this method — ever run), the FIRST
   * call here captures `candidate` and freezes it from then on. Either way
   * the result is the same contract: once this sitting has answered once,
   * it answers identically for the rest of its life, regardless of what the
   * live plan does meanwhile — never a comparison to make live vs. captured,
   * just "was anything captured yet."
   */
  readonly resolveCompositionPlan: (
    candidate: StudyPlanEnvelope | null,
  ) => StudyPlanEnvelope | null;
}

/**
 * Builds an idle holder. No I/O, no clock read, no persisted state — matches
 * `IDLE_SITTING`, the same "every controller starts here" value
 * `rebuild-controller.ts` declares for any `SittingState<T>`.
 */
export function createStudySessionHolder(): StudySessionHolder {
  let sitting: StudySessionSitting = IDLE_SITTING;
  // `undefined` = nothing captured yet for the CURRENT sitting — distinct
  // from a captured `null` (a real "no plan" reading). See `enter` and
  // `resolveCompositionPlan`'s own docs.
  let compositionPlan: StudyPlanEnvelope | null | undefined;

  return {
    getSitting: () => sitting,
    enter: (now, session, plan) => {
      sitting = enterSitting(now, session);
      compositionPlan = plan;
    },
    growActiveSitting: (now, session) => {
      sitting = enterSitting(now, session);
      // Deliberately no write to `compositionPlan` — see this method's own doc.
    },
    exit: () => {
      sitting = exitSitting();
      compositionPlan = undefined;
    },
    decide: (input) => decideRebuild(sitting, input),
    resolveCompositionPlan: (candidate) => {
      if (compositionPlan === undefined) compositionPlan = candidate;
      return compositionPlan;
    },
  };
}
