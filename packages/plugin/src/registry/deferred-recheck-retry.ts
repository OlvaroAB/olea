/**
 * `[D-420]` (amends `[D-400]`; functional scope C5.3) — the registry's explicit, bounded
 * "check again" action on a deferred source-change row.
 *
 * ## What "deferred" is
 *
 * `[D-400]` bounds a source-change recheck to ONE automatic retry per original check
 * (`../ingestion/materiality/citation-revision-wiring.ts`'s `[D-400]` section: the gate right
 * before the judge dispatch). Once that retry has also gone unanswered, the persisted
 * `PendingRevalidation` carries `retriedAt` and the batch pass never dispatches for that source
 * revision again; the registry's suspect section marks the row `deferred`
 * (`./provider.ts#suspectSectionFrom`). Before `[D-420]` the only way out was a genuine edit to the
 * cited passage. `[D-420]` (David, 2026-09-28): keep the deferred state visible, and add an
 * explicit action that reuses an existing retry mechanism, with bounded spending, so recovery
 * never requires her to alter correct source material.
 *
 * ## What the action does — and does not do
 *
 * It RE-ARMS the existing `[D-400]` retry; it never calls the judge and never runs a pass itself.
 * {@link rearmSpentRetry} lifts the spent-retry mark (`retriedAt`) from the persisted fact for the
 * item's CURRENT source revision, keeping `dispatchedAt`. The next ordinary batch pass
 * (`main.ts`'s fixed interval, `tickCitationRevisions`) then sees "a dispatch is recorded and
 * still unresolved, retry not yet spent" and takes the `[D-400]` gate's existing retry branch:
 * `recordDispatch(..., retry: true)` re-spends the retry BEFORE the one judge call goes out. So:
 *
 * - **The bound: exactly one judge call per successful press ({@link CHECK_AGAIN_JUDGE_CALLS_PER_PRESS}).**
 *   A press can only re-arm a fact whose retry is already spent (the previous call concluded
 *   unanswered); once re-armed, the row stops reading deferred until that one call concludes,
 *   so at most one call is ever outstanding per item and nothing fires again without another
 *   press. No loop exists anywhere on this path.
 * - **Where it is enforced**, three layers: (1) {@link retryDeferredRecheck} below — no store
 *   write and no call while offline, and nothing re-armed unless the persisted fact is deferred;
 *   (2) the store's compare-and-set re-arm ({@link DeferredRecheckRearmPort}, whose merge is
 *   {@link rearmSpentRetry}) — lifts the mark only when the persisted fact still names the same
 *   source revision AND still carries a spent retry, so a double press, a stale row or a newer
 *   edit re-arms nothing; (3) the unchanged `[D-400]` gate in the batch pass, which records the
 *   dispatch as a retry before calling.
 * - **Offline**, the press writes nothing: the row stays deferred and no call is made. Checked
 *   before any read, never inferred from a failed call (a failed call would itself re-spend the
 *   retry, a pointless round trip).
 * - **Editing the passage still works**: a new source revision gets its own fresh budget in the
 *   batch pass exactly as before; nothing here touches that path.
 * - **Spend is counted like any judge call** (`[D-400]` condition 2): the one call goes through the
 *   same `RevisionJudgePort` every other recheck uses.
 *
 * ## Wiring status — read before assuming this is reachable
 *
 * {@link DeferredRecheckRearmPort}'s production implementation belongs on
 * `ObsidianCitationHashStore` (`../ingestion/materiality/citation-hash-store.ts`), the one writer
 * of the anchor table, as a read-modify-write that applies {@link rearmSpentRetry} — outside this
 * bead's (`ol-egov.141.89.5.28`) owns, so it is reported as a splice on the bead rather than
 * written here. Until it lands, `./provider.ts` receives no port, reports
 * {@link DeferredRecheckActionAvailability} as absent, and `./view.ts` keeps the `[D-400]`
 * sentence with no button: a control with nothing behind it is never shown.
 *
 * Wording (the row's sentence, the action label, the offline note) is PROPOSED, Class B, pending
 * David's ratification — `./copy.ts`, drafted in olea-service
 * `docs/design/copy-pass-2026-09/deferred-recheck.md`.
 */

import type {
  CitationHashStore,
  PendingRevalidation,
} from '../ingestion/materiality/citation-hash-store.js';

/**
 * `[D-420]`'s spending bound, declared (plain English, never fitted): one successful press grants
 * exactly one further judge call for the item's current source revision. Enforced by the
 * mechanism, not by counting — see the module doc — and pinned by
 * `test/registry/deferred-recheck-retry.spec.ts`.
 */
export const CHECK_AGAIN_JUDGE_CALLS_PER_PRESS = 1;

/**
 * The store-side compare-and-set re-arm. `true` when the persisted fact for `instrumentId` still
 * named `expectedSourceContentHash` with a spent retry and the mark was lifted; `false` (nothing
 * written) otherwise. Implemented on the store as one read-modify-write applying
 * {@link rearmSpentRetry} to the freshest persisted record — never against a snapshot.
 */
export interface DeferredRecheckRearmPort {
  grantExplicitRetry(instrumentId: string, expectedSourceContentHash: string): Promise<boolean>;
}

/**
 * The pure half of the compare-and-set: the re-armed fact, or `null` when there is nothing to
 * re-arm (no pending fact, a different source revision, or a retry not yet spent). The result
 * keeps `sinceContentHash` and `since`, keeps `dispatchedAt` (falling back to `retriedAt`, which
 * `recordDispatch` always writes alongside it) so the batch pass takes the RETRY branch and
 * re-spends before calling, and drops `retriedAt`.
 */
export function rearmSpentRetry(
  pending: PendingRevalidation | undefined,
  expectedSourceContentHash: string,
): PendingRevalidation | null {
  if (pending === undefined) return null;
  if (pending.sinceContentHash !== expectedSourceContentHash) return null;
  if (pending.retriedAt === undefined) return null;
  return {
    sinceContentHash: pending.sinceContentHash,
    since: pending.since,
    dispatchedAt: pending.dispatchedAt ?? pending.retriedAt,
  };
}

/**
 * Whether a deferred row offers the action, and in what state. Absent (`undefined`) means the
 * re-arm port is not wired: no action is shown and the `[D-400]` sentence stays.
 */
export type DeferredRecheckActionAvailability = 'available' | 'needs-connection';

export function deferredRecheckActionAvailability(input: {
  readonly wired: boolean;
  readonly online: boolean;
}): DeferredRecheckActionAvailability | undefined {
  if (!input.wired) return undefined;
  return input.online ? 'available' : 'needs-connection';
}

/**
 * - `'rearmed'`: the next batch pass makes the one further check.
 * - `'offline'`: nothing written, nothing dispatched; the row stays deferred.
 * - `'not-deferred'`: nothing to re-arm (a newer edit, a resolved check, or a press already taken).
 * - `'not-wired'`: no store or no re-arm port; nothing written.
 */
export type DeferredRecheckRetryOutcome = 'rearmed' | 'offline' | 'not-deferred' | 'not-wired';

export interface RetryDeferredRecheckInput {
  readonly instrumentId: string;
  readonly store: CitationHashStore | undefined;
  readonly rearm: DeferredRecheckRearmPort | undefined;
  readonly isOnline: () => boolean;
}

/**
 * The action's whole controller — see the module doc for the bound and where it is enforced.
 * Reads the persisted fact fresh (never the row she saw), so the hash handed to the
 * compare-and-set is the current one; a row that went stale between render and press re-arms
 * nothing because the fresh fact is no longer deferred.
 */
export async function retryDeferredRecheck(
  input: RetryDeferredRecheckInput,
): Promise<DeferredRecheckRetryOutcome> {
  if (input.store === undefined || input.rearm === undefined) return 'not-wired';
  if (!input.isOnline()) return 'offline';
  const pending = (await input.store.loadAll()).get(input.instrumentId)?.pendingRevalidation;
  if (pending === undefined || pending.retriedAt === undefined) return 'not-deferred';
  const rearmed = await input.rearm.grantExplicitRetry(
    input.instrumentId,
    pending.sinceContentHash,
  );
  return rearmed ? 'rearmed' : 'not-deferred';
}

/**
 * The production `isOnline` default when `main.ts` supplies none: the same `navigator.onLine`
 * source `main.ts` hands `process-now.ts`. Reads as online where no `navigator` exists (a test
 * host), so a caller that needs offline behaviour passes its own.
 */
export function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
