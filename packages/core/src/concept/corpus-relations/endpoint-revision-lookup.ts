/**
 * A concept-keyed `EndpointRevisionLookup` (`./eligibility.ts`, rel.md §3 Default 4) — built over
 * records that already exist, per `ol-egov.141.89.4.13`'s brief: no new stored shape.
 *
 * **The gap this closes.** `evaluateRelationCacheRecordFreshness` (`../relation-cache.ts`) and
 * `evaluatePropositionFreshnessWithLookup` (`./eligibility.ts`) both take an
 * `EndpointRevisionLookup: (key: string) => string | undefined` as an injected port — "reads an
 * endpoint's CURRENT source revision" — and neither module builds one: `./eligibility.ts`'s own
 * doc calls this "a separate, later composition step." The source-change chain's own revision
 * records (`packages/plugin/src/ingestion/materiality/hash-store.ts`'s `MaterialityRecord`) are
 * keyed by vault PATH, one per file; a relation endpoint is keyed by opaque CONCEPT KEY
 * (`[D-088]`, C7.11). Nothing bridges the two today.
 *
 * **What bridges them: `ConceptKeyRecord.anchor` (`../key-store.ts`), already on disk.** A bound
 * (tier-1/3) concept's anchor names its one note (`NoteAnchor.notePath`); a topic-only (tier-2)
 * concept's anchor names its candidate introducing material (`TopicAnchor.introducingPaths`,
 * `[D-180 / KEY-2]`, populated from `ConceptRecord.sourcePaths` at mint time). `verdict.ts`'s own
 * `anchorOf` — what stamps `RelationCacheAttestation.introducingPassages.*.sourcePath` at
 * judgment time — reads a narrower thing, `CorpusConcept.anchor: Provenance`: ONE passage
 * (verified by reading `verdict.ts:174-176` and `packages/plugin/src/concept/wiring.ts`'s
 * `corpusConceptsFrom`), not necessarily the full `introducingPaths` set a topic-only concept may
 * carry. This module deliberately reads the WIDER set (every introducing path on record for the
 * key), not the one passage a given attestation happened to be judged against — see
 * `computeConceptRevision`'s own doc for why that is the conservative, never-hide-a-change choice
 * this bead's brief calls for, and this bead's report for the exact consequence: a concept with
 * more than one introducing path can read `'stale'` here on a path change that the specific
 * attestation in question was never judged against. No new field, no new store either way.
 *
 * **The per-path current revision itself is still the one piece not fully built (`[ILB-CHG-4]`,
 * rel.md §9: "this chain is a dependant of CHG here").** This module does not read a vault, an
 * Obsidian data blob, or a `MaterialityHashStore` — `olea-core` holds no such access and this
 * package has no dependency on `packages/plugin`. It takes a `PathRevisionLookup` as a plain,
 * synchronous, pure function — the same "injected port, not a guess at that store's shape"
 * discipline `./eligibility.ts`'s own module doc uses for `EndpointRevisionLookup` itself. A
 * caller (plugin-side; see this bead's report for the exact composition point, not edited by
 * this bead) is free to back it with `MaterialityRecord.hashes.rawHash`, its `revision` counter,
 * or `[ILB-CHG-4]`'s own future per-source revision record, once built — this module does not
 * care which, as long as two reads of an unchanged source return the same string and two reads of
 * a changed one do not.
 *
 * Pure throughout: no I/O, no clock, no identity minting — same discipline as `./eligibility.ts`.
 */

import type { VaultPath } from '../../vault/types.js';
import type { ConceptKeyAnchor, ConceptKeyRecord } from '../key-store.js';
import type { EndpointRevisionLookup } from './eligibility.js';

/**
 * The source path(s) that introduce a concept, read from its `ConceptKeyRecord.anchor`
 * (`../key-store.ts`) — never searched for or recomputed. A `NoteAnchor` names its one bound
 * note; a `TopicAnchor` names its recorded `introducingPaths`, or none when the field predates
 * `[D-180 / KEY-2]` or was never populated (`anchor.introducingPaths ?? []`, the same default
 * `../key-store.ts`'s own `anchorIntroducingPaths` uses).
 */
export function introducingPathsOfAnchor(anchor: ConceptKeyAnchor): readonly VaultPath[] {
  if (anchor.kind === 'note') return [anchor.notePath];
  return anchor.introducingPaths ?? [];
}

/**
 * Reads one source path's CURRENT revision, or `undefined` when none is on record yet — the
 * per-path seam a caller supplies (module doc). Pure: no I/O of its own.
 */
export type PathRevisionLookup = (path: VaultPath) => string | undefined;

const PATH_REVISION_SEPARATOR = '\u0001';
const PATH_JOIN_SEPARATOR = '\u0000';

/**
 * One concept's revision, over ALL of its introducing paths, computed the SAME way whichever side
 * of a freshness comparison calls it — this function, or a future writer stamping
 * `RelationCacheAttestation.endpointRevisions` at judgment time (not yet built; see this bead's
 * report) MUST agree bit-for-bit, or a concept with zero real source changes would never compare
 * `'current'` again.
 *
 * Deterministic and order-independent (de-duplicated, then sorted by path): a concept with more
 * than one introducing path (a topic-only concept, `TopicAnchor.introducingPaths`) reads as
 * `'current'` only when EVERY one of its paths still matches what was recorded — the same "one
 * stale endpoint is never hidden by the other" discipline `./eligibility.ts`'s `worseOf` already
 * applies one level up, at the proposition's two endpoints; this is that same discipline one
 * level down, across one endpoint's several source paths.
 *
 * A path with no revision on record makes the whole concept's revision `undefined` — never a
 * partial or fabricated value, so the caller (`evaluateEndpointFreshness`) reads it as
 * `'unverified'`, never silently `'current'`. Zero introducing paths reads the same way.
 */
export function computeConceptRevision(
  paths: readonly VaultPath[],
  revisionOfPath: PathRevisionLookup,
): string | undefined {
  const distinctSortedPaths = [...new Set(paths)].sort();
  if (distinctSortedPaths.length === 0) return undefined;
  const parts: string[] = [];
  for (const path of distinctSortedPaths) {
    const revision = revisionOfPath(path);
    if (revision === undefined) return undefined;
    parts.push(`${path}${PATH_REVISION_SEPARATOR}${revision}`);
  }
  return parts.join(PATH_JOIN_SEPARATOR);
}

/**
 * Build an `EndpointRevisionLookup` (`./eligibility.ts`) over concept-key records that already
 * exist (module doc) and a caller-supplied per-path current-revision reader.
 *
 * `keys` is indexed by `ConceptKeyRecord.key` exactly as given — the relation cache's own stored
 * `fromKey`/`toKey` are already resolved through the canonical-key index before they key a
 * proposition (`../relation-cache.ts`'s `writeRelationCache` module doc, `[D-378]`), so this
 * function does no canonicalisation of its own; a caller holding a raw, pre-canonical key must
 * resolve it first (`../key-store.ts`'s `readConceptKeyCanonicalIndex`).
 *
 * A key with no matching record, or whose anchor names no path, or whose path has no current
 * revision on record, all read as `undefined` — "unverified," never "current" by default,
 * per this bead's acceptance criterion.
 */
export function buildEndpointRevisionLookup(
  keys: readonly Pick<ConceptKeyRecord, 'key' | 'anchor'>[],
  revisionOfPath: PathRevisionLookup,
): EndpointRevisionLookup {
  const pathsByKey = new Map<string, readonly VaultPath[]>(
    keys.map((record) => [record.key, introducingPathsOfAnchor(record.anchor)]),
  );
  return (key: string): string | undefined => {
    const paths = pathsByKey.get(key);
    if (paths === undefined) return undefined;
    return computeConceptRevision(paths, revisionOfPath);
  };
}
