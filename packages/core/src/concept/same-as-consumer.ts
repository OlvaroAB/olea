/**
 * The confirmed same-as link's first READ consumer (`ol-2zfj.86` ONT-R1, F8.6, C7.10/C7.11,
 * `[D-072]` reachability). Design authority: `olea-service`
 * `docs/dev/relation-landing-design.md` §7.1 and `docs/Olea_knowledge_model.md` §2 (identity)
 * and §3 (reconciliation).
 *
 * **What this closes.** `./same-as.ts` persists the link and its status transitions
 * (`'proposed'` / `'confirmed'` / `'severed'`); a confirm rewrites no stored record
 * (`[D-295 / CPT-D2]`). Until this module,
 * nothing ever READ a confirmed link back: a consumer asking "what does she know about this
 * concept" still saw two identities for one concept, because no read path consulted
 * `.olea/same-as/` at all. This module is that read — given the concept-like records and
 * relation-cache records a caller already has in hand, plus the currently persisted same-as
 * links, it returns the SAME shapes with every confirmed pair folded to one canonical key. It is
 * a VIEW, never a write: nothing here calls `VaultSource.write`, mutates a `ConceptRecord`, a
 * `RelationCacheRecord` or a `SameAsLinkRecord` on disk.
 *
 * **Classes, not pairs (`[D-295]`, KG-W1a).** Confirmed links read over canonical keys form
 * connected classes (a chain `a=b, b=c` and a star `a=c, b=c` are each one class), and every member
 * redirects straight to the class's one representative: its code-unit-first canonical key. The
 * result depends on the set of confirmed links, never on the order the link files arrive in.
 * A severed or declined link contributes no edge; what a sever does inside a class that stays
 
 *
 * **Canonical key for a single pair: the pair's `keyA`.** `./same-as.ts`'s own `canonicalPair` /
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
 * **Relation-cache resolution is read-time only (requirement 4).**
 * `resolveRelationCacheRecordsWithSameAsLinks` applies a confirmed link's `fromKey`/`toKey`
 * rewrite as a pure read-time projection over records the caller already listed: a record on file
 * under the losing key resolves to the canonical `propositionKey` on every read. There is no
 * write-side counterpart (`[D-295 / CPT-D2]`: a confirmed merge rewrites no stored record), so this
 * fold is the one merge rule every reader goes through.
 *
 * **Course memberships union, never picked (requirement 5).** `resolveConceptsWithSameAsLinks`
 * unions `courses` (and `sourcePaths`, for the same "no evidence a merge would otherwise drop"
 * reason) across every record folded under one canonical key — never a preference between the
 * two sides', matching `ConceptRecord.courses`'s own existing M:N union discipline
 * (`./types.ts`).
 *
 * **Same-anchor duplicates first, then links (`[D-378]`, `ol-egov.141.89.9.56`).** A same-as link
 * joins two identities; two `.olea/concepts/` records sharing an anchor are already ONE identity,
 * whose canonical key `./key-store.ts`'s canonical-key index names (the earliest-minted record).
 * Every function below takes that index as an optional last argument. Given it, each key — a
 * concept's, a relation-cache endpoint's, and each link's own two — is resolved to its canonical
 * key before any link redirect applies, so a superseded duplicate reads as its canonical key, and a
 * link confirmed under a superseded key still folds its identity. A link whose two keys resolve to
 * one identity redirects nothing, and a confirmed link's surviving key is the code-unit-first of
 * its two canonical keys (the same `keyA` rule, applied after resolution). Two concepts that share
 * only an introducing passage are two identities in the index, so nothing here folds them. Omitted,
 * every function reads exactly as it did before the index existed. Still a view: nothing is
 * written, and no stored key is rewritten.
 */

import type { VaultPath } from '../vault/types.js';
import type { ConceptKeyCanonicalIndex } from './key-store.js';
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
 * Every non-representative member of each confirmed class → the class's representative (its
 * code-unit-first canonical key), as a lookup a caller applies to its own keyed records. One step
 * reaches the final key. `'proposed'`, `'declined'` and `'severed'` links contribute
 * nothing (requirements 2 and 3) — this is the one seam through which every function below
 * inherits that discipline, rather than each re-checking `status` itself.
 *
 * **Given `canonicalKeys` (`[D-378]`, module doc)**, the map also sends every superseded duplicate
 * key to its identity's key — its canonical key, or where a confirmed link folds that identity into
 * another, the link's surviving key — and each link is read over its two canonical keys, so the
 * returned map alone resolves any key a caller holds.
 */
export function buildSameAsKeyRedirect(
  links: readonly SameAsLinkRecord[],
  canonicalKeys?: ConceptKeyCanonicalIndex,
): ReadonlyMap<string, string> {
  const { find, redirect } = foldClasses(links, canonicalKeys);
  if (canonicalKeys !== undefined) {
    for (const [superseded, canonical] of canonicalKeys.superseded) {
      redirect.set(superseded, find(canonical));
    }
  }
  return redirect;
}

/** One link's two keys, read over canonical keys when an index is given. */
function endpoints(
  link: SameAsLinkRecord,
  canonicalKeys: ConceptKeyCanonicalIndex | undefined,
): readonly [string, string] {
  return canonicalKeys === undefined
    ? [link.keyA, link.keyB]
    : [canonicalKeys.canonicalOf(link.keyA), canonicalKeys.canonicalOf(link.keyB)];
}

/**
 * Union-find over canonical keys. The representative of a class is its code-unit-first member,
 * chosen by value, never by link order, so the result is the same for every arrival order of the
 * link files.
 */
function closure(edges: readonly (readonly [string, string])[]): (key: string) => string {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    for (let next = parent.get(root); next !== undefined; next = parent.get(root)) root = next;
    for (let cur = key; cur !== root; ) {
      const next = parent.get(cur) ?? root;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const [x, y] of edges) {
    const rx = find(x);
    const ry = find(y);
    if (rx === ry) continue;
    // keep the code-unit-first key as the root, so the root is the representative
    if (rx < ry) parent.set(ry, rx);
    else parent.set(rx, ry);
  }
  return find;
}

/**
 * Sever rule (`[D-498]`, KG-W1b). A confirmed class in which she severed a link, while other
 * confirmed links still connect the severed pair, is CONFLICTED: it stays unfolded — none of its
 * confirmed links contributes an edge — so each identity reads alone until she resolves it (by
 * severing or re-deciding a link so the severed pair is no longer connected). No other path
 * through the class may override her rejection. The confirmed and severed records are untouched.
 */
function foldClasses(
  links: readonly SameAsLinkRecord[],
  canonicalKeys: ConceptKeyCanonicalIndex | undefined,
): { find: (key: string) => string; redirect: Map<string, string> } {
  const confirmed: (readonly [string, string])[] = [];
  const severed: (readonly [string, string])[] = [];
  for (const link of links) {
    if (link.status === 'confirmed') confirmed.push(endpoints(link, canonicalKeys));
    else if (link.status === 'severed') severed.push(endpoints(link, canonicalKeys));
  }
  const first = closure(confirmed);
  const conflicted = new Set<string>();
  for (const [x, y] of severed) {
    if (x !== y && first(x) === first(y)) conflicted.add(first(x));
  }
  const held =
    conflicted.size === 0 ? confirmed : confirmed.filter(([x]) => !conflicted.has(first(x)));
  const find = closure(held);
  const redirect = new Map<string, string>();
  for (const [x, y] of held) {
    for (const key of [x, y]) {
      const root = find(key);
      if (root !== key) redirect.set(key, root);
    }
  }
  return { find, redirect };
}

/** One conflicted class: what she severed, the confirmed links that still connect it, and its held members. */
export interface SameAsSeverConflict {
  readonly severed: readonly { readonly keyA: string; readonly keyB: string }[];
  readonly confirmed: readonly { readonly keyA: string; readonly keyB: string }[];
  readonly members: readonly string[];
}

/**
 * The conflicts `buildSameAsKeyRedirect` holds unfolded, as an in-memory projection for whatever
 * later surface asks her to resolve them (none exists yet; a surface needs a clause). Persists
 * nothing. Ordered by code-unit-first member; pairs are as stored (keyA, keyB).
 */
export function findSameAsSeverConflicts(
  links: readonly SameAsLinkRecord[],
  canonicalKeys?: ConceptKeyCanonicalIndex,
): readonly SameAsSeverConflict[] {
  const confirmedLinks = links.filter((l) => l.status === 'confirmed');
  const find = closure(confirmedLinks.map((l) => endpoints(l, canonicalKeys)));
  const byRoot = new Map<string, { severed: SameAsLinkRecord[] }>();
  for (const link of links) {
    if (link.status !== 'severed') continue;
    const [x, y] = endpoints(link, canonicalKeys);
    if (x === y || find(x) !== find(y)) continue;
    const entry = byRoot.get(find(x)) ?? { severed: [] };
    entry.severed.push(link);
    byRoot.set(find(x), entry);
  }
  const out: SameAsSeverConflict[] = [];
  for (const [root, { severed }] of [...byRoot.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const inClass = confirmedLinks.filter((l) => find(endpoints(l, canonicalKeys)[0]) === root);
    const members = new Set<string>();
    for (const l of inClass) for (const k of endpoints(l, canonicalKeys)) members.add(k);
    const pair = (l: SameAsLinkRecord) => ({ keyA: l.keyA, keyB: l.keyB });
    out.push({
      severed: severed.map(pair),
      confirmed: inClass.map(pair),
      members: [...members].sort(),
    });
  }
  return out;
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
 *
 * Given `canonicalKeys` (`[D-378]`, module doc), a same-anchor pair folds exactly as a confirmed
 * pair does, under its canonical key; the unchanged-by-reference return then also needs a store
 * with no duplicates.
 */
export function resolveConceptsWithSameAsLinks<T extends SameAsResolvableConcept>(
  concepts: readonly T[],
  links: readonly SameAsLinkRecord[],
  canonicalKeys?: ConceptKeyCanonicalIndex,
): ResolveConceptsWithSameAsResult<T> {
  const redirect = buildSameAsKeyRedirect(links, canonicalKeys);
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

/**
 * Provenance outranks confidence, never the reverse (`[D-070]`) — restated rather than imported: `./relation-cache.ts`'s own `rankAttestations` is private to that module, the same "restated rather than imported" trade that module's own doc makes for `corpus-relations/verdict.ts`'s pair-key helper.
 *
 * **What the `'hers'` rank claims (`[D-490]`).** The persisted literal keeps its name, but it means *linked in a note she keeps*: curation, never her vouching unless that note is declared `made-by: me`. An undeclared note's link keeps the rank it always had. A pairing only links in notes declared `made-by: assistant` nominated was stamped `'model-proposed'` before it was cached (`corpus-relations/verdict.ts`'s `provenanceFor`), so it competes here on confidence alone.
 */
function rankAttestations(a: RelationCacheAttestation, b: RelationCacheAttestation): number {
  const aHers = a.provenance === 'hers' ? 0 : 1;
  const bHers = b.provenance === 'hers' ? 0 : 1;
  if (aHers !== bHers) return aHers - bHers;
  return b.confidence - a.confidence;
}

/**
 * The read-time fold of every confirmed same-as link over relation-cache records (requirement 4,
 * `[D-295 / CPT-D2]`) — the endpoint rewrite applied as a pure projection over records the caller
 * already listed, never a write. A record touching neither side of any confirmed link passes through
 * unchanged, by reference, so a caller that skips reference-equal records downstream pays nothing
 * extra for the ordinary case.
 *
 * Two records that resolve to the same `propositionKey` after the rewrite are folded into one: a
 * reader must see one edge per proposition. Attestations are unioned (deduplicated on content,
 * never on object identity) and ranked the same provenance-then-confidence way
 * `./relation-cache.ts` ranks them on write.
 *
 * Given `canonicalKeys` (`[D-378]`, module doc), a record cached under a superseded duplicate's key
 * resolves to its canonical proposition and folds with the record already there, the same way.
 */
export function resolveRelationCacheRecordsWithSameAsLinks(
  records: readonly RelationCacheRecord[],
  links: readonly SameAsLinkRecord[],
  canonicalKeys?: ConceptKeyCanonicalIndex,
): readonly RelationCacheRecord[] {
  const redirect = buildSameAsKeyRedirect(links, canonicalKeys);
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
