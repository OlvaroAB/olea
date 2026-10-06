/**
 * `[D-347]`'s changed-passage half, as `[D-522]` ruled (`ol-egov.141.89.9.98`; F4.3): the
 * cited passages current readings must leave out, read from the plugin's EXISTING
 * pending-revalidation store, with no new record.
 *
 * **The one input.** `CitationHashStore` (`../ingestion/materiality/citation-hash-store.ts`)
 * persists, per tracked instrument, a `pendingRevalidation` fact in the plugin's local
 * `data.json` (`[D-351]`). Every such fact reads here as a cited passage changed and not yet
 * revalidated (`olea-core`'s `PassageChangeFact` with no revalidation outcome), whatever reason it
 * records: a difference awaiting the judge, a passage that could not be found or told apart, or a
 * changed non-markdown source. Each leaves the evidence's support unresolved, which is what
 * `[D-347]` excludes; none of them claims a change was established, and nothing here says one was.
 * The readers (`readAllConceptReadiness`, `readAllCurrentRecognition`, `unmetDemandsByConcept`)
 * then exclude those instruments from readiness, need, the recognition credit and a demand met
 * now; the displayed stage and the historical award never read this input (`[D-338]` items 1 and
 * 2; `[D-522]`: historical labels kept).
 *
 * **Restart.** The facts are read from the persisted store on every call, never from memory, so
 * the exclusion stands across a plugin restart (`[D-522]`). It ends when a resolving write clears
 * the fact while the passage stays tracked, which is a successful revalidation.
 *
 * **Not met here: an entry that disappears without a successful revalidation.** The
 * citation-revision trigger removes the whole entry once it has queued a successor and suspended
 * the old question (`citation-revision-wiring.ts`'s `suspendAndEnqueueSuccessor`), and the store
 * then keeps no trace of the change. `[D-522]` says the exclusion must not end that way; keeping
 * the fact through to a successful revalidation is a change to that trigger, outside this reader
 * (pinned failing in `test/gap/provider.spec.ts`; named on `ol-egov.141.89.9.98`).
 *
 * **Operational failure is never a fact about her.** A store that cannot be read yields
 * `undefined`, which every reader takes as no passage input: today's reading, logged.
 */

import type { PassageChangeFact } from 'olea-core';
import type { CitationHashStore } from '../ingestion/materiality/citation-hash-store.js';

/**
 * The store's persisted pending-revalidation facts as changed, unrevalidated passages, sorted by
 * instrument id. A fact's `since` is when the change was first seen; one recorded later than `now`
 * (another device's clock) is read as standing at `now`, never dropped, since the store holds it
 * now. `undefined` when the store cannot be read.
 */
export async function readPendingPassageChanges(
  store: CitationHashStore,
  now: Date,
): Promise<readonly PassageChangeFact[] | undefined> {
  let anchors: Awaited<ReturnType<CitationHashStore['loadAll']>>;
  try {
    anchors = await store.loadAll();
  } catch (error) {
    console.error(
      'Olea: could not read the pending-revalidation store; current readings keep every passage',
      error instanceof Error ? error.name : 'unknown',
    );
    return undefined;
  }
  const nowMs = now.getTime();
  const changes: PassageChangeFact[] = [];
  for (const instrumentId of [...anchors.keys()].sort()) {
    const pending = anchors.get(instrumentId)?.pendingRevalidation;
    if (pending === undefined) continue;
    const seenMs = Number.isFinite(pending.since) ? Math.min(pending.since, nowMs) : nowMs;
    changes.push({
      instrumentIds: [instrumentId],
      changedAt: new Date(seenMs).toISOString(),
      revalidation: [],
    });
  }
  return changes;
}
