/**
 * Chunking and cancellation primitives for the keyword index build (C2.6).
 * Q6.2 forbids blocking Obsidian's renderer, and so requires heavy work to
 * be broken into chunks that a host can stop part-way.
 *
 * Two seams, deliberately explicit, in the same spirit as the ingestion
 * queue's `Clock`/`RandomSource` (`../ingestion/types.ts`) — injected rather
 * than reached for globally, because chunked, stoppable work is untestable
 * without them:
 *
 * - **`YieldScheduler`** — no direct `setTimeout`/`requestIdleCallback` call
 *   inside `build.ts`. Production hands the renderer back between chunks via
 *   `macrotaskScheduler`; a test hands in a scheduler it fully controls, so a
 *   test can assert exactly how much work happened before and after a
 *   cancellation without a single real timer running (`build.spec.ts`'s
 *   cancellation test).
 * - **`CancellationSignal`/`CancellationController`** — a plain, cheaply
 *   pollable flag rather than an `AbortController`/`AbortSignal` (which pairs
 *   naturally with cancelling an in-flight fetch, not with "stop starting new
 *   chunks"). `buildFullIndex` polls `signal.cancelled` between chunks; a
 *   host cancels through the paired controller — from a settings-panel
 *   "stop" button, or a test.
 */

/** Hands control back to the host between index-build chunks. */
export interface YieldScheduler {
  /**
   * Resolves once the host has had a turn. Production's default
   * (`macrotaskScheduler`) yields via a macrotask so Obsidian's renderer gets
   * to paint/handle input before the next chunk starts — the concrete
   * mechanism Q6.2's "never block the renderer" rests on. Tests must inject
   * their own scheduler rather than rely on this: a real timer, even a
   * zero-delay one, is a real timer.
   */
  yield(): Promise<void>;
}

/** Production default: yields via a macrotask (`setTimeout(0)`), so the event loop drains pending renderer work first. */
export const macrotaskScheduler: YieldScheduler = {
  yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

/** Read-only view a build polls. Never mutated except through the paired `CancellationController`. */
export interface CancellationSignal {
  readonly cancelled: boolean;
}

/** The paired write side — held by whoever may decide to stop a build (a UI action, a test). */
export interface CancellationController {
  readonly signal: CancellationSignal;
  cancel(): void;
}

/** Fresh, uncancelled controller/signal pair for one build attempt. */
export function createCancellationController(): CancellationController {
  const signal = { cancelled: false };
  return {
    signal,
    cancel(): void {
      signal.cancelled = true;
    },
  };
}
