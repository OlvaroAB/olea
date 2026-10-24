/**
 * `[D-347]`'s changed-passage half, as `[D-522]` and `[D-536]` ruled (`ol-egov.141.89.9.98`; F4.3):
 * the cited passages current readings must leave out, read from the plugin's EXISTING
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
 * **Restart, and the rewrite path.** The facts are read from the persisted store on every call,
 * never from memory, so the exclusion stands across a plugin restart (`[D-522]`). A rewrite keeps
 * the old question's entry and fact once it has queued the successor and suspended the old
 * question (`citation-revision-wiring.ts`'s `suspendAndEnqueueSuccessor`), and an accepted
 * successor removes neither (`[D-536]`): the exclusion ends only when a resolving write clears the
 * fact, which is a successful revalidation.
 *
 * **Live instruments only** (`ol-zjke.2`, decision sheet v87 row 4): the store also holds the hold
 * on a pending draft not yet an instrument, under a draft hold key. A draft has no evidence to
 * exclude and is never an instrument, so its key is skipped by the store's one classifier
 * (`anchorKeyKind`); once the draft becomes an instrument its hold is carried to the instrument id,
 * which reads here like any other fact.
 *
 * **A store that cannot be read is uncertainty, never credit** (the 2026-10-06 sheet's correction
 * to the reversible choices). {@link readPendingPassageChanges} reports it as `unreadable`, and
 * {@link passageChangesForReadings} then leaves out the evidence of every instrument that could
 * carry a fact: one the revision rule tracks (a recorded citation), or one her review log names
 * that is no longer in her vault. Only a self-contained card she wrote herself, which the store
 * never tracks, keeps counting. The affected concepts read need unknown, worded as unknown, which
 * says nothing about what she knows (`[D-348]`); the stage is unchanged. The failure is logged
 * without content.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { PassageChangeFact, VaultInstrumentRecord } from 'olea-core';
import {
  anchorKeyKind,
  type CitationHashStore,
} from '../ingestion/materiality/citation-hash-store.js';
import { isTrackedForRevision } from '../ingestion/materiality/citation-revision-wiring.js';

/** What the store gave: its facts, or that it could not be read. */
export type PendingPassageRead =
  | { readonly kind: 'read'; readonly changes: readonly PassageChangeFact[] }
  | { readonly kind: 'unreadable' };

/**
 * The store's persisted pending-revalidation facts as changed, unrevalidated passages, sorted by
 * instrument id. A fact's `since` is when the change was first seen; one recorded later than `now`
 * (another device's clock) is read as standing at `now`, never dropped, since the store holds it
 * now. `unreadable` when the store cannot be read.
 */
export async function readPendingPassageChanges(
  store: CitationHashStore,
  now: Date,
): Promise<PendingPassageRead> {
  let anchors: Awaited<ReturnType<CitationHashStore['loadAll']>>;
  try {
    anchors = await store.loadAll();
  } catch (error) {
    console.error(
      'Olea: could not read the pending-revalidation store; readings it could affect read as unknown',
      error instanceof Error ? error.name : 'unknown',
    );
    return { kind: 'unreadable' };
  }
  const nowMs = now.getTime();
  const changes: PassageChangeFact[] = [];
  for (const instrumentId of [...anchors.keys()].sort()) {
    // `ol-zjke.2`: a draft hold key names no instrument; no reading may take it for one.
    if (anchorKeyKind(instrumentId) !== 'instrument') continue;
    const pending = anchors.get(instrumentId)?.pendingRevalidation;
    if (pending === undefined) continue;
    const seenMs = Number.isFinite(pending.since) ? Math.min(pending.since, nowMs) : nowMs;
    changes.push({
      instrumentIds: [instrumentId],
      changedAt: new Date(seenMs).toISOString(),
      revalidation: [],
    });
  }
  return { kind: 'read', changes };
}

/**
 * The changed passages current readings take (`AttainmentOptions.passageChanges`). `undefined`
 * when no store is wired (a caller with no store: today's reading). A read store gives its facts.
 * An unreadable store gives one fact, standing at `now`, over every instrument that could carry
 * one: each id her review log names, and each instrument the revision rule tracks, less every
 * instrument in her vault the rule does not track (`isTrackedForRevision`), since the store never
 * holds a fact for those. No fact at all when nothing is left.
 */
export function passageChangesForReadings(
  read: PendingPassageRead | undefined,
  records: readonly VaultInstrumentRecord[],
  entries: readonly ReviewLogEntry[],
  now: Date,
): readonly PassageChangeFact[] | undefined {
  if (read === undefined) return undefined;
  if (read.kind === 'read') return read.changes;
  const untracked = new Set<string>();
  const uncertain = new Set<string>();
  for (const record of records) {
    if (isTrackedForRevision(record)) uncertain.add(record.instrumentId);
    else untracked.add(record.instrumentId);
  }
  for (const entry of entries) {
    const instrumentId = (entry as { readonly instrumentId?: unknown }).instrumentId;
    if (typeof instrumentId === 'string' && !untracked.has(instrumentId)) {
      uncertain.add(instrumentId);
    }
  }
  if (uncertain.size === 0) return [];
  return [{ instrumentIds: [...uncertain].sort(), changedAt: now.toISOString(), revalidation: [] }];
}
