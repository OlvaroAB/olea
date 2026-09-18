/**
 * The confirmed same-as link's first READ consumer (`ol-2zfj.86` ONT-R1, F8.6, C7.10/C7.11,
 * `[D-072]` reachability). Design authority: `olea-service`
 * `docs/dev/relation-landing-design.md` §7.1 and `docs/Olea_knowledge_model.md` §2 (identity)
 * and §3 (reconciliation).
 *
 * **What this closes.** `./same-as.ts` persists the link and its status transitions
 * (`'proposed'` / `'confirmed'` / `'severed'`), and `remapIncidentRelationCacheRecords` gives a
 * confirm an explicit, one-time WRITE-side rewrite of relation-cache records. Until this module,
 * nothing ever READ a confirmed link back: a consumer asking "what does she know about this
 * concept" still saw two identities for one concept, because no read path consulted
 * `.olea/same-as/` at all. This module is that read — given the concept-like records and
 * relation-cache records a caller already has in hand, plus the currently persisted same-as
 * links, it returns the SAME shapes with every confirmed pair folded to one canonical key. It is
 * a VIEW, never a write: nothing here calls `VaultSource.write`, mutates a `ConceptRecord`, a
 * `RelationCacheRecord` or a `SameAsLinkRecord` on disk, or requires the write-side remap to have
 * run first.
 *
 * **Canonical key, stated plainly: the pair's `keyA`.** `./same-as.ts`'s own `canonicalPair` /
 * `byCodeUnit` already sorts and persists `keyA <= keyB` for every link that exists — this module
 * reuses that already-persisted, deterministic order rather than inventing a second one (e.g.
 * "earliest mint"). Two reasons, not one: first, "earliest mint" would need a `ConceptKeyRecord`
 * lookup (`./key-store.ts`) this module does not otherwise need, widening its inputs for a rule
 * that buys nothing a simpler one does not already give (any deterministic, stated rule
 * satisfies "consumers read them as one" — nothing in ONT-R1 or F8.6 requires the survivor to be
 * the older key). Second, and more binding: `./same-as.ts`'s own module doc states "a same-as
 * link references two existing keys by their opaque string value and never inspects, requires,
 * or depends on how either was derived" — a mint-time lookup would cut against that discipline
 * directly. Reusing `keyA` needs nothing beyond the link record itself.
 *
 * **Severability is structural here, not conventional (requirement: a severed link restores
 * both keys with no data loss).** Every function below is pure and read-only. A sever
 * (`./same-as.ts`'s `severSameAsLink`) does not need this module to undo anything, because this
 * module never did anything to the underlying records in the first place — `buildSameAsKeyRedirect`
 * simply stops producing an entry for that pair on the very next call, since it only ever reads
 * `'confirmed'` links (see below), and both keys go back to being read independently. Nothing was
 * rewritten, so nothing needs to be un-rewritten.
 *
 * **A `'proposed'` link changes nothing a consumer sees (requirement 3), and neither does a
 * `'declined'` one** (`[D-257]` ruling 3). `buildSameAsKeyRedirect` contributes an entry for a
 * `'confirmed'` link only — `'proposed'`, `'declined'` and `'severed'` are all read and discarded,
 * mirroring `./same-as.ts`'s own "a collision proposes, it never merges." This module is the read
 * half of that same sentence; a decline is a hard labelled negative on the proposal, never a
 * signal this module treats any differently from the proposal it declined.
 *
 * **Relation-cache resolution works even before the write-side remap ran (requirement 4).**
 * `resolveRelationCacheRecordsWithSameAsLinks` restates the same `fromKey`/`toKey` rewrite
 * `./same-as.ts`'s `remapIncidentRelationCacheRecords` performs on disk, but as a pure read-time
 * projection over records the caller already listed: a record still on file under the losing key
 * resolves to the canonical `propositionKey` on every read, whether or not the one-time
 * write-side remap has executed. The two are deliberately independent — one is a repair that
 * shrinks the vault's own file count; the other is what a reader sees today, regardless of
 * whether that repair has run yet.
 *
 * **Course memberships union, never picked (requirement 5).** `resolveConceptsWithSameAsLinks`
 * unions `courses` (and `sourcePaths`, for the same "no evidence a merge would otherwise drop"
 * reason) across every record folded under one canonical key — never a preference between the
 * two sides', matching `ConceptRecord.courses`'s own existing M:N union discipline
 * (`./types.ts`).
 */

import type { VaultPath } from '../vault/types.js';
import {
  propositionKey,
  type RelationCacheAttestation,
  type RelationCacheRecord,
} from './relation-cache.js';
import type { SameAsLinkRecord } from './same-as.js';

/**
 * The structural shape this module needs from a concept-like record — deliberately NOT
 * `ConceptRecord` (`./types.ts`) or `ReadConcept` (`./read.ts`) themselves, which are distinct
 * interfaces that happen to share these fields and are not otherwise related. Coding against
 * this narrower shape lets one resolver serve both without either type depending on the other.
 */
export interface SameAsResolvableConcept {
  readonly key: string;
  readonly courses: readonly string[];
  readonly sourcePaths?: readonly VaultPath[];
}

export interface ResolveConceptsWithSameAsResult<T extends SameAsResolvableConcept> {
  readonly concepts: readonly T[];
  /** How many input records were folded into another under this call — `0` when no confirmed link touched this set, the ordinary case (most collisions are proposed, not confirmed; ONT-R1's own measured fact is roughly one concept in nine even reaches a proposal). */
  readonly merged: number;
}

/**
 * The canonical key for a CONFIRMED link — see module doc for the rule and why. `undefined` for
 * a `'proposed'`, `'declined'` or `'severed'` link: none of the three contributes a redirect
 * (requirements 2 and 3). `'declined'` reads exactly like `'proposed'` here, deliberately —
 * `[D-257]` ruling 3's "a decline never asserts the two are different" means a reader must never
 * fold a declined pair, same as it never folds a merely-proposed one.
 */
export function canonicalKeyForLink(link: SameAsLinkRecord): string | undefined {
  return link.status === 'confirmed' ? link.keyA : undefined;
}

/**
 * Every confirmed link's losing key (`keyB`) → canonical key (`keyA`), as a lookup a caller
 * applies to its own keyed records. `'proposed'`, `'declined'` and `'severed'` links contribute
 * nothing (requirements 2 and 3) — this is the one seam through which every function below
 * inherits that discipline, rather than each re-checking `status` itself.
 */
export function buildSameAsKeyRedirect(
  links: readonly SameAsLinkRecord[],
): ReadonlyMap<string, string> {
  const redirect = new Map<string, string>();
  for (const link of links) {
    const canonicalKey = canonicalKeyForLink(link);
    if (canonicalKey === undefined) continue;
    if (link.keyB !== canonicalKey) redirect.set(link.keyB, canonicalKey);
  }
  return redirect;
}

function resolveKey(key: string, redirect: ReadonlyMap<string, string>): string {
  return redirect.get(key) ?? key;
}

function dedupeSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

/**
 * Fold a set of concept-like records through the currently confirmed same-as links: every
 * record whose key redirects lands under its canonical key, unioned with whatever record (if
 * any) already sits there. `courses` and `sourcePaths` union (requirement 5); every other field
 * (name, tier, `boundNotePath`, …) is taken from whichever record already carries the canonical
 * key — the pair's designated survivor by this module's own rule — falling back to the first
 * record seen for a canonical key with no record of its own in THIS particular input (e.g. a
 * caller handed a batch that happened not to include it), so the function is total over any
 * input rather than assuming the canonical side is always present.
 *
 * No confirmed link touching this set (the ordinary case) returns the input completely
 * unchanged, by reference — `merged: 0`.
 */
export function resolveConceptsWithSameAsLinks<T extends SameAsResolvableConcept>(
  concepts: readonly T[],
  links: readonly SameAsLinkRecord[],
): ResolveConceptsWithSameAsResult<T> {
  const redirect = buildSameAsKeyRedirect(links);
  if (redirect.size === 0) return { concepts, merged: 0 };

  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const concept of concepts) {
    const canonicalKey = resolveKey(concept.key, redirect);
    const group = groups.get(canonicalKey);
    if (group === undefined) {
      groups.set(canonicalKey, [concept]);
      order.push(canonicalKey);
    } else {
      group.push(concept);
    }
  }

  let merged = 0;
  const out: T[] = [];
  for (const canonicalKey of order) {
    const group = groups.get(canonicalKey);
    if (group === undefined) continue;
    if (group.length === 1) {
      const [only] = group;
      if (only === undefined) continue;
      out.push(only.key === canonicalKey ? only : { ...only, key: canonicalKey });
      continue;
    }
    merged += group.length - 1;
    const base = group.find((c) => c.key === canonicalKey) ?? group[0];
    if (base === undefined) continue;
    const courses = dedupeSorted(group.flatMap((c) => c.courses));
    const anySourcePaths = group.some((c) => c.sourcePaths !== undefined);
    const sourcePaths = anySourcePaths
      ? dedupeSorted(group.flatMap((c) => c.sourcePaths ?? []))
      : undefined;
    out.push({
      ...base,
      key: canonicalKey,
      courses,
      ...(sourcePaths !== undefined ? { sourcePaths } : {}),
    });
  }
  return { concepts: out, merged };
}

function attestationsEqual(a: RelationCacheAttestation, b: RelationCacheAttestation): boolean {
  return (
    a.provenance === b.provenance &&
    a.confidence === b.confidence &&
    a.fromName === b.fromName &&
    a.toName === b.toName &&
    a.introducingPassages.from.sourcePath === b.introducingPassages.from.sourcePath &&
    a.introducingPassages.to.sourcePath === b.introducingPassages.to.sourcePath
  );
}

/** Provenance outranks confidence, never the reverse (`[D-070]`) — restated rather than imported: `./relation-cache.ts`'s own `rankAttestations` is private to that module, the same "restated rather than imported" trade that module's own doc makes for `corpus-relations/verdict.ts`'s pair-key helper. */
function rankAttestations(a: RelationCacheAttestation, b: RelationCacheAttestation): number {
  const aHers = a.provenance === 'hers' ? 0 : 1;
  const bHers = b.provenance === 'hers' ? 0 : 1;
  if (aHers !== bHers) return aHers - bHers;
  return b.confidence - a.confidence;
}

/**
 * The read-time counterpart of `./same-as.ts`'s `remapIncidentRelationCacheRecords` (requirement
 * 4) — the same endpoint rewrite, applied as a pure projection over records the caller already
 * listed, never a write. A record touching neither side of any confirmed link passes through
 * unchanged, by reference, so a caller that skips reference-equal records downstream pays nothing
 * extra for the ordinary case.
 *
 * Two records that resolve to the same `propositionKey` after the rewrite — the same collision
 * `remapIncidentRelationCacheRecords` counts and deliberately leaves unremapped on disk — are
 * folded here instead: a reader must see one edge per proposition, so the read side cannot leave
 * the gap the write side leaves on purpose. Attestations are unioned (deduplicated on content,
 * never on object identity) and ranked the same provenance-then-confidence way the write side's
 * cache does.
 */
export function resolveRelationCacheRecordsWithSameAsLinks(
  records: readonly RelationCacheRecord[],
  links: readonly SameAsLinkRecord[],
): readonly RelationCacheRecord[] {
  const redirect = buildSameAsKeyRedirect(links);
  if (redirect.size === 0) return records;

  const groups = new Map<string, RelationCacheRecord[]>();
  const order: string[] = [];
  for (const record of records) {
    const fromKey = resolveKey(record.fromKey, redirect);
    const toKey = resolveKey(record.toKey, redirect);
    const unaffected = fromKey === record.fromKey && toKey === record.toKey;
    const newKey = unaffected ? record.propositionKey : propositionKey(record.type, fromKey, toKey);
    const resolved = unaffected ? record : { ...record, propositionKey: newKey, fromKey, toKey };

    const group = groups.get(newKey);
    if (group === undefined) {
      groups.set(newKey, [resolved]);
      order.push(newKey);
    } else {
      group.push(resolved);
    }
  }

  const out: RelationCacheRecord[] = [];
  for (const key of order) {
    const group = groups.get(key);
    if (group === undefined) continue;
    if (group.length === 1) {
      const [only] = group;
      if (only !== undefined) out.push(only);
      continue;
    }
    out.push(mergeRelationCacheRecordGroup(group));
  }
  return out;
}

function mergeRelationCacheRecordGroup(group: readonly RelationCacheRecord[]): RelationCacheRecord {
  const base = group[0];
  if (base === undefined) {
    throw new Error('mergeRelationCacheRecordGroup: called with an empty group.');
  }

  const attestations: RelationCacheAttestation[] = [];
  for (const record of group) {
    for (const attestation of record.attestations) {
      if (!attestations.some((existing) => attestationsEqual(existing, attestation))) {
        attestations.push(attestation);
      }
    }
  }
  attestations.sort(rankAttestations);

  const mintedAt = group.reduce((min, r) => (r.mintedAt < min ? r.mintedAt : min), base.mintedAt);
  const updatedAt = group.reduce(
    (max, r) => (r.updatedAt > max ? r.updatedAt : max),
    base.updatedAt,
  );
  const schemaVersion = group.reduce(
    (max, r) => Math.max(max, r.schemaVersion),
    base.schemaVersion,
  );

  return {
    ...base,
    attestations,
    mintedAt,
    updatedAt,
    schemaVersion,
  };
}
