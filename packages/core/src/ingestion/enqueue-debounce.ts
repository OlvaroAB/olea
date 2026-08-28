/**
 * The ENQUEUE debounce (`ol-84my` / `[TRG-1]`) — the settle-delay half of a
 * two-knob distinction the bead exists to keep from being conflated:
 *
 * - **ENQUEUE policy** (this module) — *when does a changed file become a
 *   job at all?* Answered here: after `policy.debounceMs` of quiet since the
 *   path was last observed changing, never before.
 * - **DRAIN policy** (`budget.ts`, D-002, P3-T03) — *when does an
 *   already-queued job actually run?* Already contracted; this module has
 *   nothing to do with it and never touches `IngestionQueueEngine`'s
 *   pacing/backoff/budget state.
 *
 * David's original question (`ol-84my`'s description, on D-055): a settle
 * delay so a note being actively written is not re-processed on every save.
 * Content-hash dedupe (`hash.ts`, `engine.ts`'s `enqueue`) already stops that
 * from *charging* twice, but it does nothing about the *churn* of enqueuing
 * and discarding work on every intermediate save while she is mid-paragraph
 * — this closes that gap.
 *
 * **Relationship to the markdown-note materiality debounce**
 * (`packages/plugin/src/ingestion/materiality/constants.ts`,
 * `MATERIALITY_DEBOUNCE_MS`, `ol-tqy3`): that debounce gates a *different*
 * decision — whether an authored note's edit is worth a (future) paid
 * judge call / F3.3's generation sweep — and it already is "the one churn
 * control" for its two consumers (`packages/plugin/src/main.ts`'s own
 * comment on `observedMaterialChange`). This module is not a second,
 * competing debounce for that same decision; it answers the analogous
 * question one layer down, for the raw ingestion queue's own `enqueue` (the
 * PDF/audio/slide/embedded-source jobs `extraction-runner.ts` describes),
 * which has no debounce of its own today. A future caller that already has
 * a settled, debounced verdict from the materiality trigger has no reason to
 * also pay this gate — this exists for callers of the plain ingestion queue
 * that don't.
 *
 * **Pure and stateless, by the same design rule `budget.ts` and the
 * materiality trigger's own free gate (`packages/plugin/src/ingestion/
 * materiality/trigger.ts`) already follow**: given how long a path has sat
 * quiet, decide whether to enqueue now or wait. *Tracking* "when did I last
 * see this path change" is the host's job (a small per-path store, the same
 * split `MaterialityHashStore` uses one level up) — this module needs no
 * store, no `Clock` object, no I/O, and is exhaustively testable as a result.
 */

/** The one enqueue-debounce knob: how long a path must sit quiet before a change to it is allowed to become a job. */
export interface EnqueueDebouncePolicy {
  readonly debounceMs: number;
}

/**
 * Three minutes. **Declared, not derived** — no corpus of real edit sessions
 * exists yet to fit this against, and the run charter's Class B posture
 * ("proceed with the reversible default, flag for retroactive review") is
 * exactly what `ol-84my`'s own text asks for: "a quiet period on the order
 * of a few minutes... recorded with its rationale and tuned from real use
 * rather than guessed precisely now."
 *
 * **Plain-English defence:** long enough that an ordinary autosave or a
 * manual save mid-sentence — the case David named, a note actively being
 * written — essentially never lands during a real editing burst, since a
 * burst on one file rarely settles in under a few minutes; short enough that
 * a genuinely finished pass (she closes the note, moves on) is still picked
 * up within the same sitting rather than waiting for an unrelated event
 * elsewhere to nudge a later batch boundary. Matches the order of magnitude
 * already chosen, independently, for the adjacent materiality debounce
 * (`MATERIALITY_DEBOUNCE_MS`, `ol-tqy3`) — both answer the same underlying
 * "don't react to a note mid-save" concern, and picking the same number
 * where nothing forces a difference is the more defensible choice than an
 * unexplained mismatch between two "a few minutes" gates.
 * **Flagged for retroactive review** (Class B): revisit once real ingestion
 * history exists to derive it properly, same posture and same trigger
 * condition as `MATERIALITY_DEBOUNCE_MS`'s own doc.
 */
export const ENQUEUE_DEBOUNCE_MS = 3 * 60 * 1000;

/** The declared default, bundled for callers that want one object. */
export const DEFAULT_ENQUEUE_DEBOUNCE_POLICY: EnqueueDebouncePolicy = {
  debounceMs: ENQUEUE_DEBOUNCE_MS,
};

export type EnqueueDebounceDecision =
  | { readonly kind: 'settled' }
  /** Too soon since this path was last observed changing — try again no earlier than `resumeNotBefore`. */
  | { readonly kind: 'debounced'; readonly resumeNotBefore: number };

/**
 * Decides whether a path has sat quiet long enough to enqueue.
 * `lastChangedAt: null` means "never observed changing before" (a first
 * sighting) and always settles immediately — there is no burst to wait out
 * for a file nothing has seen yet, the same "first sighting always clears"
 * rule `evaluateMaterialityGate` uses one layer up for the identical reason.
 */
export function evaluateEnqueueDebounce(input: {
  readonly lastChangedAt: number | null;
  readonly now: number;
  readonly policy: EnqueueDebouncePolicy;
}): EnqueueDebounceDecision {
  const { lastChangedAt, now, policy } = input;
  if (lastChangedAt === null) return { kind: 'settled' };

  const quietFor = now - lastChangedAt;
  if (quietFor < policy.debounceMs) {
    return { kind: 'debounced', resumeNotBefore: lastChangedAt + policy.debounceMs };
  }
  return { kind: 'settled' };
}
