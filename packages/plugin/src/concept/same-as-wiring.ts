/**
 * `resolveSameAsForPass` — the plugin-side composition that gives the confirmed same-as link
 * (`ol-2zfj.86` ONT-R1, F8.6) its first REGISTRY-SIDE consumer, over `olea-core`'s pure resolver
 * (`same-as-consumer.ts`).
 *
 * **What this does.** `olea-core`'s `resolveConceptsWithSameAsLinks` /
 * `resolveRelationCacheRecordsWithSameAsLinks` are pure functions over records a caller already
 * has in hand — they do not themselves read the vault. This file is the thin, Obsidian-adjacent
 * seam that reads the three inputs a confirmed same-as link needs to change anything (the
 * currently persisted same-as links, the relation cache, and the edge-disposition logs) and
 * applies them to one pass's own concepts and relations.
 *
 * **What changes, concretely.** `./wiring.ts`'s `readConceptsAndRelations` splices this in right
 * after `readRelationSetWithCache` — see that function's own doc for the one-hop reachability
 * chain down to `main.ts:1887`. Two things a consumer reads now differ from before a link is
 * confirmed:
 *
 * 1. **`ConceptAndRelationPass.read.concepts`** — a confirmed pair's two `ReadConcept`s fold to
 *    one, under the canonical key, with `courses` and `sourcePaths` unioned
 *    (`resolveConceptsWithSameAsLinks`'s own doc has the full rule). Every scope/coverage reader
 *    of `read.concepts` sees one concept where it used to see two.
 * 2. **`ConceptAndRelationPass.relations`** — a relation-cache record incident to the losing key
 *    resolves to the canonical key's proposition identity before conversion to a served
 *    `ConceptRelation`, so two records that used to look like two distinct (if similarly-worded)
 *    edges fold into one, with attestations unioned. This is deliberately layered ON TOP of
 *    `readRelationSetWithCache`'s own fold rather than replacing the call to it — see this
 *    file's own `resolveSameAsForPass` doc for why, and note that its own reachability claim
 *    (`relation-wiring.ts`'s module doc) is unaffected: that function is still called, with the
 *    same arguments, on every tick.
 *
 * **A `'proposed'`, `'declined'`, or `'severed'` link changes neither** (requirements 2 and 3 of
 * this lane's brief, plus `'declined'` added by `[D-257]`/`ol-egov.141.33` [TRIAGE-5], which gave
 * the same-as record a fourth status this module's own doc previously did not list) —
 * `buildSameAsKeyRedirect` only ever contributes a `'confirmed'` pair, so the ordinary case (no
 * confirmed link touching this pass's concepts or edges) returns both inputs unchanged.
 *
 * **No persisted shape changes here.** This composes three existing reads
 * (`listSameAsLinkRecords`, `listRelationCacheRecords`, `listEdgeDispositionLogs`) and two pure
 * core functions; it writes nothing and defines no new record shape.
 *
 * **Same-anchor duplicates read as one identity too (`[D-378]`, `ol-egov.141.89.9.56`).** Two
 * `.olea/concepts/` records sharing an anchor are one identity already, before any link;
 * `olea-core`'s canonical-key index names its canonical key. `resolveSameAsForPass` reads that
 * index once and hands it to all three pure functions, so a duplicate's key reads as its canonical
 * key in the pass's concepts, in the relation-cache records, in each link's own keys and in the
 * edge dispositions — a decline recorded under a duplicate's proposition withholds the canonical
 * edge. A concept that shares only an introducing passage is its own identity there and is never
 * folded. Still read-only: no stored key is rewritten.
 *
 * **The index is now a caller-suppliable option (`ol-egov.141.89.9.57`).** `./wiring.ts`'s
 * `readConceptsAndRelations` already reads one canonical-key index per tick to hand to
 * `persistRelationCacheFromPass` and `readRelationSetWithCache` (`relation-wiring.ts`'s own
 * `[D-378]` note); before this change, this function read a THIRD copy of the same index on
 * every tick — one extra `.olea/concepts/` listing for no behavioural difference, since the
 * index cannot change between the three reads within one tick (nothing here mints or rewrites a
 * key). `options.canonicalKeys` lets a caller hand in the one it already read; omitted, this
 * function reads it itself exactly as before, so a caller that does not thread it through sees
 * unchanged behaviour.
 *
 * **Only what the baseline already served is re-merged (`ol-egov.141.89.4.22`).** Since
 * `ol-egov.141.89.4.15`, `readRelationSetWithCache` withholds a cached edge whose endpoint has
 * moved since it was judged (rel.md §3 Default 4's freshness gate, given a `hashStore`). This
 * function used to re-read EVERY non-disposed `.olea/relations/` record and fold it back on top of
 * `pass.relations`, so a stale edge the baseline had just withheld came back downstream. It now
 * re-merges only the records whose canonical proposition `pass.relations` already served — read
 * off the baseline itself rather than by re-running the gate, because that gate's revision lookup
 * is built from the hash store, which this function's caller does not hand it, and one decision
 * about what is servable is safer than two that could drift. Without a `hashStore` the baseline
 * serves every non-disposed record, so every record still qualifies and the fold is unchanged.
 * Freshness is decided per record BEFORE same-as resolution (on each record's own stored keys),
 * which is what the stored judged-at revisions refer to.
 */

import {
  type ConceptKeyCanonicalIndex,
  type ConceptRelation,
  deriveRelationSet,
  excludeDisposedRelationCacheRecords,
  listEdgeDispositionLogs,
  listRelationCacheRecords,
  listSameAsLinkRecords,
  propositionKey,
  type ReadConcept,
  type RelationCacheRecord,
  type RelationSet,
  readConceptKeyCanonicalIndex,
  resolveConceptsWithSameAsLinks,
  resolveRelationCacheRecordsWithSameAsLinks,
  type VaultSource,
} from 'olea-core';
import type { ConceptAndRelationPass } from './wiring.js';

export interface SameAsResolvedPass {
  /** `pass.read.concepts`, folded through every currently confirmed same-as link. */
  readonly concepts: readonly ReadConcept[];
  /** `pass.relations`, refolded with same-as-resolved relation-cache records layered on top. */
  readonly relations: RelationSet;
  /** How many concept records were folded into another this call — `0` on the ordinary tick where no confirmed link touches this pass's concepts. */
  readonly conceptsMerged: number;
}

/** The options `resolveSameAsForPass` takes (`ol-egov.141.89.9.57`). */
export interface ResolveSameAsForPassOptions {
  /**
   * The canonical-key index this tick already read (`./wiring.ts`'s `readConceptsAndRelations`
   * reads one for `persistRelationCacheFromPass`/`readRelationSetWithCache` and can hand the
   * same one on here). Omitted, this function reads it itself, exactly as it always did.
   */
  readonly canonicalKeys?: ConceptKeyCanonicalIndex;
}

/** The best (first-ranked) attestation of a resolved relation-cache record, as the `ConceptRelation` `deriveRelationSet` folds — the same per-record projection `olea-core`'s `relationCacheRecordsAsConceptRelations` performs, restated over an in-memory list here because that function always re-reads the vault itself and this caller already holds the same-as-resolved records in memory. */
function bestAttestationAsConceptRelation(
  record: RelationCacheRecord,
): ConceptRelation | undefined {
  const best = record.attestations[0];
  if (best === undefined) return undefined;
  return {
    type: record.type,
    from: best.fromName,
    to: best.toName,
    provenance: best.provenance,
    confidence: best.confidence,
    introducingPassages: best.introducingPassages,
  };
}

/** The fields a served attestation carries, as one comparable string (object keys sorted, so a record read back from JSON in any key order compares equal to the edge built from it). */
function attestationSignature(relation: ConceptRelation): string {
  return JSON.stringify(
    {
      type: relation.type,
      from: relation.from,
      to: relation.to,
      provenance: relation.provenance,
      confidence: relation.confidence,
      introducingPassages: relation.introducingPassages,
    },
    (_key, value: unknown) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : value,
  );
}

/**
 * The cache records `pass.relations` already served (module doc, `ol-egov.141.89.4.22`).
 * Records are grouped by the proposition their endpoints' canonical keys make — the same grouping
 * `readRelationSetWithCache` serves by — and a group is kept whole when any record's best
 * attestation appears among the baseline's attestations. A group the baseline withheld (stale, an
 * unverified endpoint, or disposed) has no attestation there, so none of its records is re-merged.
 */
function recordsServedByBaseline(
  records: readonly RelationCacheRecord[],
  baseline: RelationSet,
  canonicalKeys: ConceptKeyCanonicalIndex,
): RelationCacheRecord[] {
  const served = new Set<string>();
  for (const entry of baseline.entries) {
    for (const attestation of entry.attestations) served.add(attestationSignature(attestation));
  }
  const groups = new Map<string, RelationCacheRecord[]>();
  for (const record of records) {
    const key = propositionKey(
      record.type,
      canonicalKeys.canonicalOf(record.fromKey),
      canonicalKeys.canonicalOf(record.toKey),
    );
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [record]);
    else group.push(record);
  }
  const kept: RelationCacheRecord[] = [];
  for (const group of groups.values()) {
    const wasServed = group.some((record) => {
      const best = bestAttestationAsConceptRelation(record);
      return best !== undefined && served.has(attestationSignature(best));
    });
    if (wasServed) kept.push(...group);
  }
  return kept;
}

/**
 * Fold one pass's concepts and relations through the currently confirmed same-as links.
 *
 * `pass.relations` (already computed by `readRelationSetWithCache`) is used as this fold's
 * baseline rather than recomputed from scratch, so `readRelationSetWithCache` keeps being called
 * with the same arguments it always was — its own reachability claim is untouched. This function
 * only adds one more group: the same-as-resolved, disposition-excluded relation-cache records,
 * which can carry a merged attestation set `pass.relations`'s own fold never saw (two records
 * that only collide onto one proposition identity AFTER same-as resolution). Only records the
 * baseline already served enter that group (`ol-egov.141.89.4.22`, module doc), so an edge the
 * baseline withheld as stale stays withheld.
 *
 * `options.canonicalKeys` (`ol-egov.141.89.9.57`): a caller already holding this tick's
 * canonical-key index passes it through rather than making this function read a third copy of
 * it (see module doc). Omitted, it is read here exactly as before.
 */
export async function resolveSameAsForPass(
  vault: VaultSource,
  pass: ConceptAndRelationPass,
  options: ResolveSameAsForPassOptions = {},
): Promise<SameAsResolvedPass> {
  const sameAsLinkEntries = await listSameAsLinkRecords(vault);
  const links = sameAsLinkEntries.map((entry) => entry.record);
  const canonicalKeys = options.canonicalKeys ?? (await readConceptKeyCanonicalIndex(vault));

  const conceptsResult = resolveConceptsWithSameAsLinks(pass.read.concepts, links, canonicalKeys);

  const [cacheRecordEntries, dispositionLogEntries] = await Promise.all([
    listRelationCacheRecords(vault),
    listEdgeDispositionLogs(vault),
  ]);
  const dispositionLogs = dispositionLogEntries.map((entry) => entry.log);
  const resolvedCacheRecords = resolveRelationCacheRecordsWithSameAsLinks(
    recordsServedByBaseline(
      cacheRecordEntries.map((entry) => entry.record),
      pass.relations,
      canonicalKeys,
    ),
    links,
    canonicalKeys,
  );
  const servedCacheRecords = excludeDisposedRelationCacheRecords(
    resolvedCacheRecords,
    dispositionLogs,
    canonicalKeys,
  );
  const sameAsCachedRelations: ConceptRelation[] = [];
  for (const record of servedCacheRecords) {
    const relation = bestAttestationAsConceptRelation(record);
    if (relation !== undefined) sameAsCachedRelations.push(relation);
  }

  const existingEdges = pass.relations.entries.map((entry) => entry.edge);
  const relations = deriveRelationSet(existingEdges, sameAsCachedRelations);

  return { concepts: conceptsResult.concepts, relations, conceptsMerged: conceptsResult.merged };
}
