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
   */
  readonly enter: (now: Date, session: ComposedStudySession) => void;
  /** She finished, or the sitting went stale and the caller is closing it out before composing a fresh one. Releases the freeze. */
  readonly exit: () => void;
  /**
   * The one `decideRebuild` call site (§3b) — called once, at Start, against
   * whatever trigger/staleness facts the caller has assembled. Reports the
   * decision and nothing else; see the module doc's "what this does not do."
   */
  readonly decide: (input: DecideRebuildInput) => RebuildDecision;
}

/**
 * Builds an idle holder. No I/O, no clock read, no persisted state — matches
 * `IDLE_SITTING`, the same "every controller starts here" value
 * `rebuild-controller.ts` declares for any `SittingState<T>`.
 */
export function createStudySessionHolder(): StudySessionHolder {
  let sitting: StudySessionSitting = IDLE_SITTING;

  return {
    getSitting: () => sitting,
    enter: (now, session) => {
      sitting = enterSitting(now, session);
    },
    exit: () => {
      sitting = exitSitting();
    },
    decide: (input) => decideRebuild(sitting, input),
  };
}
