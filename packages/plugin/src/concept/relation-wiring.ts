/**
 * `relation-wiring.ts` — the plugin-side composition of the persisted relation cache
 * (`[D-119]`, ol-2zfj.14) over `./wiring.ts`'s `readConceptsAndRelations` (`ol-2zfj.12`).
 *
 * **New file, not composed into `./wiring.ts` by this lane.** This lane's file ownership does
 * not include `./wiring.ts` (a live, shared composition root); the one-hop splice —
 * `readConceptsAndRelations`'s own `relations` field switching from
 * `deriveRelationSet(read.relations, corpus.relations ?? [])` to
 * `readRelationSetWithCache(vault, pass)` below, plus a call to `persistRelationCacheFromPass`
 * right after the corpus batch runs — is handed to the orchestrator as a patch, the same
 * procedure `[EXT-11]`/`ol-kw4a` used for `runCorpusRelationBatchIfDue` itself and `ol-2zfj.12`'s
 * own design doc used for the fold before it (`docs/dev/relation-landing-design.md` §8).
 *
 * **What this file does.** Two composed operations, each a thin wrapper over `olea-core`'s
 * persisted-relation modules, so a caller (`./wiring.ts`'s `readConceptsAndRelations`, since the
 * splice below landed) has one seam rather than three separate imports to get right:
 *
 * 1. `persistRelationCacheFromPass` — writes the corpus stage's own key-bearing edges
 *    (`ConceptAndRelationPass.corpus.relations`, `CorpusReconciledRelation[]`, which optionally
 *    carry `fromKey`/`toKey` per `ol-l40p` [REL-9]) into the vault-side cache, patch mode
 *    (default, ONT-R8). The per-document stage's edges are NOT persisted here: `read.relations`
 *    is plain `ConceptRelation[]` with no key threading yet (`is-a`/`part-of` have no production
 *    key-bearing path today), so there is nothing this seam could key a persisted record on
 *    without violating C7.11 — see `writeRelationCache`'s own `droppedNoKey` counter, which is
 *    exactly this case made visible rather than silently guessed around.
 * 2. `readRelationSetWithCache` — the cache-aware replacement for
 *    `deriveRelationSet(read.relations, corpus.relations ?? [])`: folds the SAME two live inputs
 *    plus every currently-un-disposed cached edge from prior passes, so a tick where the corpus
 *    batch's own trigger does not fire still serves the corpus-stage edges a PRIOR tick minted —
 *    the persisted half's whole reason to exist (design doc §1: "a real vault ... was producing
 *    those and throwing them away every ingestion tick"). Read-time exclusion on a declined or
 *    expired disposition (INV-6) is applied before the fold, never after — an excluded edge never
 *    reaches `deriveRelationSet` at all, so every one of that function's existing consumers stays
 *    correct with no change to their own code.
 *
 * **Reachability (`[D-072]`, plan §2.7 clause 5) — LANDED.** Both functions are
 * production-reachable: the one-hop splice this doc names above was applied to `./wiring.ts`'s
 * `readConceptsAndRelations` (`[D-119]`, `ol-2zfj.14`/`.122`/`.124`), itself called from
 * `OleaPlugin.tickIngestionAndMaybeRunCorpusRelations` (`packages/plugin/src/main.ts`) — see that
 * function's own module doc for the full chain. Corrected 2026-09-25, `ol-egov.141.89.15`; this
 * paragraph previously said neither function had a production caller.
 */

import {
  type ConceptRelation,
  currentDisposition,
  deriveRelationSet,
  type EdgeDispositionLog,
  excludeDisposedRelationCacheRecords,
  excludedPropositionKeys,
  isExcludedAtReadTime,
  listEdgeDispositionLogs,
  listRelationCacheRecords,
  type RelationCacheRecord,
  type RelationCacheWriteResult,
  type RelationSet,
  relationCacheRecordsAsConceptRelations,
  type VaultPath,
  type VaultSource,
  writeRelationCache,
} from 'olea-core';
import type { ConceptAndRelationPass } from './wiring.js';

export interface RelationCacheSyncOptions {
  readonly now?: () => string;
}

/**
 * Persist the corpus stage's own key-bearing edges from one pass into `.olea/relations/`.
 * `pass.corpus.relations` is `undefined` on a tick whose trigger did not fire (the ordinary
 * case) — that is not an error, and this function writes nothing rather than treating an
 * un-triggered tick as an empty result to cache.
 */
export async function persistRelationCacheFromPass(
  vault: VaultSource,
  pass: ConceptAndRelationPass,
  options: RelationCacheSyncOptions = {},
): Promise<RelationCacheWriteResult | null> {
  const edges = pass.corpus.relations;
  if (edges === undefined) return null;
  return writeRelationCache(vault, edges, {
    mode: 'patch',
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

/**
 * The cache-aware fold: this pass's own live edges plus every currently-served cached edge from
 * prior passes, with a declined/expired disposition excluded before either reaches
 * `deriveRelationSet`. See module doc for why this exists alongside, rather than inside,
 * `./wiring.ts`'s own `readConceptsAndRelations`.
 */
export async function readRelationSetWithCache(
  vault: VaultSource,
  pass: ConceptAndRelationPass,
): Promise<RelationSet> {
  const dispositionLogs = (await listEdgeDispositionLogs(vault)).map((entry) => entry.log);
  const excluded = excludedPropositionKeys(dispositionLogs);
  const cached = await relationCacheRecordsAsConceptRelations(vault, {
    excludePropositionKeys: excluded,
  });
  const fresh: readonly ConceptRelation[] = pass.corpus.relations ?? [];
  return deriveRelationSet(pass.read.relations, fresh, cached);
}

/**
 * Convenience composition of both operations, in the order a real tick needs them: persist this
 * pass's fresh corpus edges first, then fold the now-updated cache back in — so an edge minted
 * on THIS tick is immediately reflected in the RelationSet this same tick returns, rather than
 * lagging one tick behind its own write.
 */
export async function syncRelationCacheAndDerive(
  vault: VaultSource,
  pass: ConceptAndRelationPass,
  options: RelationCacheSyncOptions = {},
): Promise<{ readonly write: RelationCacheWriteResult | null; readonly relations: RelationSet }> {
  const write = await persistRelationCacheFromPass(vault, pass, options);
  const relations = await readRelationSetWithCache(vault, pass);
  return { write, relations };
}

/**
 * Every cached edge whose CURRENT disposition (`./disposition.ts`'s `currentDisposition`) is a
 * declined or expired proposition — a small diagnostic surface, not itself a triage view (no
 * clause names a concept-relation triage surface yet, `docs/dev/relation-landing-design.md` §7.2;
 * this function builds no surface, only a value a future one could read).
 */
export async function excludedEdgeDispositionSummary(vault: VaultSource): Promise<{
  readonly excludedCount: number;
  readonly excludedLogs: readonly EdgeDispositionLog[];
}> {
  const logs = (await listEdgeDispositionLogs(vault)).map((entry) => entry.log);
  const excludedLogs = logs.filter((log) => isExcludedAtReadTime(currentDisposition(log)));
  return { excludedCount: excludedLogs.length, excludedLogs };
}

/** For a caller that wants the raw filtered records rather than the folded `ConceptRelation`s — used by `relation-wiring.spec.ts` and available to a future triage surface's read model. */
export async function relationCacheRecordsExcludingDisposed(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly record: RelationCacheRecord }[]> {
  const [records, logs] = await Promise.all([
    listRelationCacheRecords(vault),
    listEdgeDispositionLogs(vault).then((entries) => entries.map((entry) => entry.log)),
  ]);
  const included = excludeDisposedRelationCacheRecords(
    records.map((entry) => entry.record),
    logs,
  );
  const includedKeys = new Set(included.map((record) => record.propositionKey));
  return records.filter((entry) => includedKeys.has(entry.record.propositionKey));
}
