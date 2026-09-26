/**
 * The fair backlog — `docs/dev/intelligence-build/rel.md` §2's diagram ("fair backlog: pairs cut by
 * the cap wait and age, oldest first") and `[D-297]` (`olea-service`, `ol-egov.141.89.4.7`): "a
 * result for every pair judged, and capped pairs wait in a stored backlog with ageing."
 *
 * **The defect this closes.** `./types.ts`'s own doc on
 * `CORPUS_RELATIONS_CANDIDATE_CAP_PER_CALL_DECLARED_PENDING` and `./batch.ts`'s
 * `runCorpusRelationBatch` both name it: today a capped-out candidate is simply dropped —
 * `runCorpusRelationBatchIfDue` (plugin) marks every concept "known" after any batch runs, so a
 * cut pair's endpoints fall out of `newConcepts` and the pair is never re-nominated. This module is
 * the missing half: candidates the cap cuts THIS run are kept, aged, and merged ahead of next run's
 * fresh nominations so the same top pairs do not always win.
 *
 * **Oldest first, and fair in the literal sense: age, not confidence or signal strength, breaks
 * ties.** A pair backlogged five runs ago is judged before one backlogged twice, and both are
 * judged before this run's brand-new nominations, so no pair waits forever behind a stream of
 * fresh candidates.
 *
 * Pure: no I/O, no clock (age is a plain counter the caller increments), no identity minting —
 * `keyOf` is the caller's own pair identity (a `pairId`, or `./nominate.ts`'s name-pair key today,
 * moving to opaque keys once `[ONT-R8]`'s remaining nomination piece lands).
 */

/** One backlogged item, aged in whole "batch runs cut" units — never wall-clock time, matching `[D-297]`'s own "oldest first" without needing a clock this module has no business owning. */
export interface BacklogEntry<T> {
  readonly item: T;
  /** How many batch runs this item has been cut from nomination, oldest = highest. */
  readonly age: number;
}

export interface MergeWithBacklogResult<T> {
  /** Backlog entries (oldest first) followed by fresh candidates not already in the backlog, capped at `cap`. */
  readonly ordered: readonly T[];
  /** Everything beyond `cap` this run — the next call's backlog, each one run older. */
  readonly cappedOut: readonly BacklogEntry<T>[];
}

/**
 * Merge the standing backlog (oldest first) with this run's fresh candidates, cap the result, and
 * age whatever is cut. A fresh candidate that duplicates a backlogged item (`keyOf` agrees) is
 * treated as the backlogged item — same identity, no double-judging, and the backlog's own age is
 * what ages forward, not a fresh age of zero.
 */
export function mergeWithBacklog<T>(
  backlog: readonly BacklogEntry<T>[],
  fresh: readonly T[],
  keyOf: (item: T) => string,
  cap: number,
): MergeWithBacklogResult<T> {
  // Oldest first: sort a defensive copy rather than assume the caller already did.
  const sortedBacklog = [...backlog].sort((a, b) => b.age - a.age);
  const backlogKeys = new Set(sortedBacklog.map((entry) => keyOf(entry.item)));
  const freshOnly = fresh.filter((item) => !backlogKeys.has(keyOf(item)));

  const orderedEntries: BacklogEntry<T>[] = [
    ...sortedBacklog,
    ...freshOnly.map((item) => ({ item, age: 0 })),
  ];

  const kept = orderedEntries.slice(0, Math.max(cap, 0));
  const cut = orderedEntries.slice(Math.max(cap, 0));

  return {
    ordered: kept.map((entry) => entry.item),
    cappedOut: cut.map((entry) => ({ item: entry.item, age: entry.age + 1 })),
  };
}
