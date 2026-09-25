/**
 * The `ConceptKeyRecord` sidecar (`[D-174]`, `ol-2zfj.42`, C7.11).
 *
 * **Design authority:** `docs/dev/concept-key-stamping-design.md` (olea-service), §6 for the
 * schema and §7 for the read-back sketch this module implements. `[D-174]` ratified §2.3 over
 * two rejected candidates: bound-note frontmatter (an INV-6 Part-one write with no carve-out)
 * and a single plugin-data-dir registry file (foreclosed by `[CACHE-1]`'s per-record-file
 * guardrail and its mobile-sync argument). Neither is re-argued here — see the design doc.
 *
 * **What this module is, structurally.** The same shape `../review-log/content-store.ts` and
 * `../misconception/path.ts` already use: one small file per record, under a dot-prefixed Olea
 * folder, written and read through the injected `VaultSource` port. The one property that makes
 * this sidecar different from every sibling under `.olea/`: **it is not cache.** Everything else
 * under `.olea/` is disposable and rebuildable (C6.2); a `ConceptKeyRecord` is not — losing it
 * loses the identity, because there is nothing else to recompute it from (design doc §6's
 * correction to the knowledge model's Identity-layer row). No clear-cache path may ever delete
 * a file this module owns.
 *
 * **Mint vs. lookup, the conservation property (`[D-088]`).** `resolveConceptKey` below is the
 * single seam: given an anchor, it looks up an existing record and returns its key verbatim
 * (refreshing the anchor if it drifted, e.g. a renamed note's `notePath`), or mints a new key and
 * writes a new record when no existing one matches. **Read-back is matching, never minting** — a
 * concept a later run cannot find evidence for is simply not looked up again; nothing here
 * deletes, retires or overwrites a key on a re-run alone. Merge/prune/retirement (F8.6) is a
 * lineage event with its own home (`[D-119]`'s second precondition), entirely out of this
 * module's scope — it never touches a record here.
 *
 * **`bindConceptKeyToNote` (`ol-2zfj.55`) is the second seam, and it is key-driven, not
 * anchor-driven.** F8.4a's accept-a-note-offer flow (`ol-r1by`, `[D-176]`) creates a brand-new
 * note for a concept that already has a key — usually a tier-2/3 `TopicAnchor` record, since a
 * tier-1 concept already has a note. `resolveConceptKey`'s anchor-match seam cannot do this
 * rebind: a `TopicAnchor` never matches the brand-new note's `NoteAnchor` (`kind` differs), so
 * calling it here would MINT A SECOND KEY for the same concept — silently duplicating identity,
 * the exact failure `[D-088]`'s conservation property exists to prevent. `bindConceptKeyToNote`
 * instead looks the record up **by its durable `key`** (the caller already holds it — the
 * concept's join key, not its anchor) and rewrites that one record's `anchor` in place, never
 * minting. Per `[D-183]`'s alias rule (knowledge model §3), the topic wording the record is
 * rebound FROM is folded into `aliases` rather than discarded, so a stale extraction pass that
 * still proposes the old `TopicAnchor` (her `topic:` property hasn't changed, or a reconciliation
 * step hasn't learned about the note yet) still resolves to the same key —
 * `resolveConceptKey`'s matching below is extended accordingly, cross-kind, off `aliases`.
 * Idempotent: calling it twice with the same key and the same note anchor writes nothing the
 * second time.
 *
 * ===========================================================================
 * FILE NAMING (Class A, left open by `[D-174]`/design doc §9) — `encodeURIComponent(key)`
 * ===========================================================================
 * The key itself cannot be used as a filename unescaped in general, so a naming function is
 * needed regardless of what the key contains. **`ol-bo48`'s opaque mint (`./concept-key.ts`'s
 * `mintOpaqueConceptKey`) changed what a NEW key looks like — a `concept-key1:`-prefixed random
 * nonce, no `/` or spaces — but every key minted before that landing is still on disk and still
 * `provisionalConceptKey`'s derivation, embedding a vault path or her verbatim topic name.**
 * Nothing here rewrites an old record's `key` or its filename (the conservation property,
 * `[D-088]`, and the "do not rewrite her vault" constraint `ol-bo48` names) — this scheme has to
 * keep working for both shapes forever, not just the new one. Two shapes were considered:
 *
 *   - A content hash of the key (sharded, e.g. `ab/cd1234….json`). Rejected for now: it buys
 *     nothing this module needs (there is no fan-out large enough for sharding to matter — a
 *     concept-dense vault is hundreds of files, not millions) and it costs inspectability: a
 *     record for a given key can no longer be found by eye or by a plain `ls` while debugging.
 *   - `encodeURIComponent(key) + '.json'`, chosen here. It is a pure, total, injective function
 *     on the key (two distinct keys never collide, because percent-encoding is reversible), it
 *     needs no new dependency, and the encoded name stays legible for the common case — a
 *     pre-`ol-bo48` bound concept's key derives from a note path, so its filename reads as a
 *     recognisably-escaped version of that path (`%20` for spaces, `%2F` for `/`), the same
 *     trade `stampMcqId`-style ids and content-store ids already make for readability over
 *     compactness. A post-`ol-bo48` opaque key encodes just as cleanly (only its `:` separator
 *     needs escaping), so the same function needs no branch for the two key shapes.
 *
 * `conceptKeyRecordPath` is the one function that encodes this choice; nothing else in the
 * module assembles a path itself, matching `content-store.ts` and `misconception/path.ts`'s own
 * discipline of one naming function per store.
 *
 * ===========================================================================
 * LOOKUP HAS NO INDEX — IT SCANS `.olea/concepts/`
 * ===========================================================================
 * Unlike `content-store.ts` (which is always addressed by an id the caller already holds), a
 * concept-key lookup starts from an *anchor* (a note's `noteUid`/`notePath`, or a topic's
 * course/name/aliases) — there is no way to derive the filename from the anchor alone, since the
 * filename is a function of the *key*, which is exactly the thing being looked up. So lookup
 * reads every record under `.olea/concepts/` and matches in memory. This mirrors what
 * `./extract.ts` already does for the whole vault (a full `vault.list` + read pass per
 * extraction), so it adds no new order-of-magnitude cost; a future index file is a pure
 * performance optimisation if this ever proves too slow on a real vault, not a correctness
 * change to this module's contract. `resolveConceptKeys` (the batch form) lists once for a
 * whole extraction pass rather than once per candidate.
 *
 * ===========================================================================
 * ONE WRITER AT A TIME (`ol-egov.141.89.9.52`, `[D-357]`'s follow-up)
 * ===========================================================================
 * Look-up-then-mint is a read followed by a write, and before this landing nothing sat between
 * the two: two passes meeting one brand-new concept at once (two review opens, a review open
 * racing a generation pass, the Today panel's stamped readers loading side by side) both listed
 * before either wrote, both missed, and both minted — two permanent keys for one anchor. Every
 * function here that reads the store in order to write it (`resolveConceptKeys`,
 * `resolveConceptKey`, `bindConceptKeyToNote`) now runs inside `withConceptKeyStoreLock`, a FIFO
 * queue: each holder lists, matches, mints and writes before the next one lists. The queue is
 * module-wide rather than per `VaultSource` object on purpose — the plugin constructs a fresh
 * `ObsidianSource` over the same vault at many call sites, so an object-keyed lock would let two
 * of them race exactly as before. Unrelated vaults in one process (tests, the workbench) merely
 * take turns, which costs latency, never correctness. Two devices minting offline and meeting
 * through her vault sync is a different race no in-process lock can close; the canonical rule
 * below is what makes both devices read the same key afterwards.
 *
 * ===========================================================================
 * SAME-ANCHOR DUPLICATES READ AS ONE IDENTITY (`[D-378]`)
 * ===========================================================================
 * Records sharing an anchor — as the anchor match below already defines it, never a shared
 * cited passage or a shared introducing note alone — are one identity. The earliest-minted
 * record (`mintedAt`, then the key's code-unit order for a same-day tie, since `mintedAt` holds a
 * date only) is canonical; every other record in the group is a superseded duplicate that keeps
 * its file, its key and its bytes: nothing here deletes or rewrites one. Lookup returns the
 * canonical key, and `buildConceptKeyCanonicalIndex` / `readConceptKeyCanonicalIndex` hand every
 * other reader the same mapping, so a historical reference to a superseded key (a relation, an
 * outcome, a registry passage anchor) resolves to the key lookup returns — from one function,
 * never re-derived per reader.
 */

import { listFolder } from '../vault/list-folder.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import {
  conceptIdentityNormalizationIndex,
  mintOpaqueConceptKey,
  type OpaqueKeyNonceSource,
} from './concept-key.js';
import type { ConceptTier } from './types.js';

/** The vault folder this module owns. Dot-prefixed, sibling to `.olea/reviews/` and `.olea/misconceptions/`. */
export const CONCEPT_KEY_STORE_FOLDER: VaultPath = '.olea/concepts';

/** Bumped only on a breaking change to the record shape. */
export const CONCEPT_KEY_RECORD_SCHEMA_VERSION = 1;

/** A bound (tier-1/3) concept's anchor: the note it is bound to. */
export interface NoteAnchor {
  readonly kind: 'note';
  /** The bound note's `olea-uid` frontmatter value at last match, or `null` if it carries none. */
  readonly noteUid: string | null;
  readonly notePath: VaultPath;
}

/**
 * A topic-only (tier-2) concept's anchor: the existing course/wording/alias match signal.
 *
 * `introducingPaths` (`[D-180 / KEY-2]`, ol-egov.65, additive) holds the candidate's introducing
 * material — `extract.ts`'s `keysFor` populates it from `ConceptRecord.sourcePaths`, sorted. It is
 * the signal `resolveConceptKey`'s rename-signature match (below) uses to recognise the SAME
 * topic-only concept under a re-worded `topic:` value, since a topic-only concept has no note to
 * anchor a rename on the way a bound concept anchors on `noteUid`. **Optional, not required** —
 * unlike `aliases` above, which every anchor-construction site has always populated — so a
 * `ConceptKeyRecord` minted on disk before this field existed still validates and reads back: an
 * absent value is treated as `[]` everywhere it is read (see `anchorIntroducingPaths` below),
 * which by construction never matches the rename-signature branch's non-empty requirement, so an
 * old record is simply never a candidate for that branch until its own next ordinary mint fills
 * the field in.
 */
export interface TopicAnchor {
  readonly kind: 'topic';
  readonly course: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly introducingPaths?: readonly VaultPath[];
}

export type ConceptKeyAnchor = NoteAnchor | TopicAnchor;

/**
 * `ConceptKeyRecord` — design doc §6, one file per concept under `.olea/concepts/`.
 *
 * `key` is the durable, never-recomputed field once minted. `anchor` is deliberately NOT part of
 * the identity being protected — it is the current best match signal, allowed to drift (a
 * rename updates `anchor.notePath`; `noteUid`, the part that actually matters, does not move).
 *
 * `aliases` (added `ol-2zfj.55`, additive/non-breaking — `schemaVersion` unchanged) holds prior
 * wordings this key has answered to, kept per `[D-183]`'s alias rule rather than discarded. Today
 * the only writer is `bindConceptKeyToNote`, which folds a `TopicAnchor`'s `name`/`aliases` in
 * here when rebinding the record onto a `NoteAnchor`. Optional, and absent on every record minted
 * before this field existed — every reader treats a missing value as `[]`, never as invalid.
 *
 * `normalizationCollisions` (added `ol-2zfj.108` [NEW-24], additive/non-breaking — same precedent
 * as `aliases` and `TopicAnchor.introducingPaths`, `schemaVersion` unchanged) — see its own field
 * doc below and `findNormalizationCollisions`'s doc.
 */
export interface ConceptKeyRecord {
  readonly key: string;
  readonly tier: ConceptTier;
  readonly anchor: ConceptKeyAnchor;
  /** Prior wordings this key has answered to (`[D-183]`) — see the interface doc above. */
  readonly aliases?: readonly string[];
  /**
   * ONT-R1's mint-time normalisation index (`ol-2zfj.86`, C7.11): other existing keys whose
   * TOPIC-anchor wording normalised (`./concept-key.js`'s `conceptIdentityNormalizationIndex`) to
   * the same index as this record's own wording, at the moment THIS record was minted.
   *
   * **A candidate list, never a merge.** Recording a collision here changes nothing about either
   * key's identity: this record and every key listed here keep their own key, their own history,
   * and their own evidence, exactly as C7.10/F8.6's same-as mechanics require ("nothing is
   * unioned"). Nothing in this module reads this field back to auto-resolve anything — it is
   * provenance for a later evidential read (F8.6's proposal-and-resolve surface, not yet built),
   * the same "record now, act later" posture `TopicAnchor.introducingPaths` already established
   * for the rename-signature match.
   *
   * Absent when no collision was found at mint — the common case, since ONT-R1's own measured
   * fact is that the identity rule bites on roughly one concept in nine. **Never recomputed
   * afterwards**: a record minted later, whose wording happens to normalise the same as THIS
   * one's, gets its OWN entry pointing back here (found via a listing scan at ITS mint time) —
   * this record's own list is not retroactively updated, mirroring `mintedAt`'s "captured once"
   * posture rather than `anchor`'s "allowed to drift" one.
   */
  readonly normalizationCollisions?: readonly string[];
  /** ISO date the key was first minted. Debugging only — not personal, no content. */
  readonly mintedAt: string;
  readonly schemaVersion: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isConceptTier(value: unknown): value is ConceptTier {
  return value === 1 || value === 2 || value === 3;
}

function isNoteAnchor(value: unknown): value is NoteAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'note') return false;
  if (v.noteUid !== null && typeof v.noteUid !== 'string') return false;
  if (typeof v.notePath !== 'string' || v.notePath.length === 0) return false;
  return true;
}

function isTopicAnchor(value: unknown): value is TopicAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'topic') return false;
  if (typeof v.course !== 'string') return false;
  if (typeof v.name !== 'string' || v.name.length === 0) return false;
  if (!Array.isArray(v.aliases) || !v.aliases.every((a) => typeof a === 'string')) return false;
  // Optional and additive (see the interface doc): absent is valid — every record minted before
  // `[D-180]` has no `introducingPaths` field at all — but a present value must be a string array.
  if (v.introducingPaths !== undefined) {
    if (
      !Array.isArray(v.introducingPaths) ||
      !v.introducingPaths.every((p) => typeof p === 'string')
    ) {
      return false;
    }
  }
  return true;
}

function isConceptKeyAnchor(value: unknown): value is ConceptKeyAnchor {
  return isNoteAnchor(value) || isTopicAnchor(value);
}

/** Runtime validation, matching `content-store.ts`'s hand-rolled-guard style (no schema library in this package). */
export function isConceptKeyRecord(value: unknown): value is ConceptKeyRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.key)) return false;
  if (!isConceptTier(v.tier)) return false;
  if (!isConceptKeyAnchor(v.anchor)) return false;
  // Optional and additive (see the interface doc): absent is valid — every record minted before
  // `ol-2zfj.55` has no `aliases` field at all — but a present value must be a string array.
  if (v.aliases !== undefined) {
    if (!Array.isArray(v.aliases) || !v.aliases.every((a) => typeof a === 'string')) return false;
  }
  // Optional and additive (see the interface doc): absent is valid — every record minted before
  // `ol-2zfj.108` [NEW-24] has no `normalizationCollisions` field at all — but a present value
  // must be a string array.
  if (v.normalizationCollisions !== undefined) {
    if (
      !Array.isArray(v.normalizationCollisions) ||
      !v.normalizationCollisions.every((k) => typeof k === 'string')
    ) {
      return false;
    }
  }
  if (!isNonEmptyString(v.mintedAt)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

/** `record.aliases ?? []` — the one place that default lives, so no reader re-invents it. */
function recordAliases(record: ConceptKeyRecord): readonly string[] {
  return record.aliases ?? [];
}

/** `anchor.introducingPaths ?? []` — the one place that default lives, mirroring `recordAliases`. */
function anchorIntroducingPaths(anchor: TopicAnchor): readonly VaultPath[] {
  return anchor.introducingPaths ?? [];
}

/**
 * The vault path for one concept's record. See the module header's "FILE NAMING" section for
 * the choice and why. Deterministic and injective: the same key always encodes to the same path,
 * and no two distinct keys collide.
 */
export function conceptKeyRecordPath(key: string): VaultPath {
  return `${CONCEPT_KEY_STORE_FOLDER}/${encodeURIComponent(key)}.json`;
}

/**
 * Every valid `ConceptKeyRecord` currently under `.olea/concepts/`, alongside its path. A file
 * that fails to parse or fails validation is skipped rather than thrown on — the same
 * referential-integrity posture `content-store.ts`'s `readContentRecord` takes, because a single
 * corrupt sidecar file must never take down extraction for every other concept.
 */
export async function listConceptKeyRecords(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly record: ConceptKeyRecord }[]> {
  // `listFolder`, not `vault.list`: `ObsidianSource.list()` never sees a dot folder, so this scan
  // came back empty on every real host and every lookup re-minted (`ol-egov.141.89.10.52`).
  const paths = await listFolder(vault, CONCEPT_KEY_STORE_FOLDER, { extensions: ['json'] });
  const out: { readonly path: VaultPath; readonly record: ConceptKeyRecord }[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isConceptKeyRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable file: skipped, never thrown — see the doc above.
    }
  }
  return out;
}

/**
 * The tail of the store's FIFO queue — see the module doc's "ONE WRITER AT A TIME". Module-wide on
 * purpose: many `VaultSource` objects can front one vault.
 */
let conceptKeyStoreTail: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` once every task queued before it has settled, and holds the queue until `task`
 * settles. A rejected task releases the queue exactly as a fulfilled one does, and its rejection
 * reaches only its own caller.
 */
function withConceptKeyStoreLock<T>(task: () => Promise<T>): Promise<T> {
  const run = conceptKeyStoreTail.then(task, task);
  conceptKeyStoreTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** `(mintedAt, key)` code-unit order — the canonical rule's "earliest-created" (`[D-378]`). */
function mintedEarlier(a: ConceptKeyRecord, b: ConceptKeyRecord): number {
  if (a.mintedAt !== b.mintedAt) return a.mintedAt < b.mintedAt ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Every key the store holds, mapped to the canonical key of its identity (`[D-378]`). */
export interface ConceptKeyCanonicalIndex {
  /**
   * `key`'s canonical key: itself when it is canonical, and itself when the store holds no
   * record for it (a stand-in key, or one from another vault) — never a guess.
   */
  canonicalOf(key: string): string;
  /** Superseded duplicate key -> its canonical key. Empty on a store with no duplicates. */
  readonly superseded: ReadonlyMap<string, string>;
}

/**
 * The bucket tags two records must share before `recordMatchesAnchor` is even asked about the
 * pair — an over-approximation, checked exactly afterwards, so grouping costs one pass over the
 * records plus the pairs inside each bucket rather than every pair in the store.
 */
function linkTags(record: ConceptKeyRecord): readonly string[] {
  const { anchor } = record;
  if (anchor.kind === 'note') {
    const tags = [`path\u0000${anchor.notePath}`];
    if (anchor.noteUid !== null) tags.push(`uid\u0000${anchor.noteUid}`);
    for (const alias of recordAliases(record)) tags.push(`wording\u0000${alias}`);
    return tags;
  }
  const tags = [`topic\u0000${anchor.course}\u0000${anchor.name}`, `wording\u0000${anchor.name}`];
  for (const alias of anchor.aliases) {
    tags.push(`topic\u0000${anchor.course}\u0000${alias}`, `wording\u0000${alias}`);
  }
  return tags;
}

/** The exact "shares an anchor" test, in either direction — the same one lookup uses. */
function recordsShareAnchor(a: ConceptKeyRecord, b: ConceptKeyRecord): boolean {
  return recordMatchesAnchor(a, b.anchor) || recordMatchesAnchor(b, a.anchor);
}

/**
 * Groups `records` into identities and names each group's canonical key (`[D-378]`). Pure; reads
 * and writes nothing.
 *
 * **What joins two records.** Only a shared anchor as `recordMatchesAnchor` already defines it:
 * one note by `olea-uid`, or by path where either side carries no uid; one course-and-wording
 * topic, or a wording a rebound record keeps as an alias (`[D-183]`). A shared introducing note or
 * cited passage alone never joins two records (`[D-378]`'s clarification), and neither does a
 * normalisation-collision entry, which is a candidate list, never a merge.
 *
 * **Two notes with different uids are never one identity**, even when a uid-less record at a
 * path both once held links to each of them: the anchor match is not transitive there, so a
 * join that would put two distinct uids in one group is refused.
 *
 * Deterministic: pairs are joined in `(mintedAt, key)` order of their earlier member, then of
 * their later one, so the same store always yields the same groups.
 */
export function buildConceptKeyCanonicalIndex(
  records: readonly ConceptKeyRecord[],
): ConceptKeyCanonicalIndex {
  const seenKeys = new Set<string>();
  const ordered: ConceptKeyRecord[] = [];
  for (const record of records) {
    if (seenKeys.has(record.key)) continue;
    seenKeys.add(record.key);
    ordered.push(record);
  }
  ordered.sort(mintedEarlier);

  const buckets = new Map<string, number[]>();
  ordered.forEach((record, index) => {
    for (const tag of new Set(linkTags(record))) {
      const bucket = buckets.get(tag);
      if (bucket === undefined) buckets.set(tag, [index]);
      else bucket.push(index);
    }
  });
  const pairKeys = new Set<number>();
  const pairs: (readonly [number, number])[] = [];
  const width = ordered.length;
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const low = bucket[i] as number;
        const high = bucket[j] as number;
        const pairKey = low * width + high;
        if (pairKeys.has(pairKey)) continue;
        pairKeys.add(pairKey);
        if (
          recordsShareAnchor(ordered[low] as ConceptKeyRecord, ordered[high] as ConceptKeyRecord)
        ) {
          pairs.push([low, high]);
        }
      }
    }
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // Union-find whose root is always the group's earliest member, carrying the group's one uid.
  const parent = ordered.map((_, index) => index);
  const groupUid: (string | null)[] = ordered.map((record) =>
    record.anchor.kind === 'note' ? record.anchor.noteUid : null,
  );
  function find(index: number): number {
    let root = index;
    while (parent[root] !== root) root = parent[root] as number;
    let cursor = index;
    while (parent[cursor] !== root) {
      const next = parent[cursor] as number;
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  }
  for (const [a, b] of pairs) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) continue;
    const uidA = groupUid[rootA] ?? null;
    const uidB = groupUid[rootB] ?? null;
    if (uidA !== null && uidB !== null && uidA !== uidB) continue;
    const root = Math.min(rootA, rootB);
    const child = Math.max(rootA, rootB);
    parent[child] = root;
    groupUid[root] = uidA ?? uidB;
  }

  const canonicalByKey = new Map<string, string>();
  const superseded = new Map<string, string>();
  ordered.forEach((record, index) => {
    const canonical = (ordered[find(index)] as ConceptKeyRecord).key;
    canonicalByKey.set(record.key, canonical);
    if (canonical !== record.key) superseded.set(record.key, canonical);
  });
  return {
    canonicalOf: (key) => canonicalByKey.get(key) ?? key,
    superseded,
  };
}

/**
 * The canonical index over the store as it stands — for a reader resolving a historical key
 * (a relation, an outcome, a registry passage anchor) to the key lookup now returns. Reads only;
 * waits its turn behind any lookup or mint already queued, so it never sees half a pass.
 */
export async function readConceptKeyCanonicalIndex(
  vault: VaultSource,
): Promise<ConceptKeyCanonicalIndex> {
  return withConceptKeyStoreLock(async () =>
    buildConceptKeyCanonicalIndex((await listConceptKeyRecords(vault)).map(({ record }) => record)),
  );
}

/**
 * `ol-bo48` (ONT-R1 `ol-2zfj.86`, ONT-R6 `ol-2zfj.88`, `[D-174]`): mints a durable, opaque key
 * via `./concept-key.ts`'s `mintOpaqueConceptKey` — a random nonce, never a derivation of
 * `anchor`. This module writes that string once into a durable record rather than treating it
 * as re-derivable every call — the instrument-id pattern (`../session/instrument-id.ts`): once
 * minted here, the string is read, never recomputed, exactly as it was before this landing.
 *
 * **What changed and what did not, versus the pre-`ol-bo48` derivation.** `anchor` is no longer
 * consulted to build the key at all — opacity means the key carries no trace of the note path
 * or the course/wording pair that anchored it. What is unchanged: `anchor` still decides
 * whether a mint happens in the first place (`resolveConceptKey`'s match against `existing`,
 * below, runs before this function is ever called), and course-scoping of topic anchors is
 * still enforced there, by `anchorMatches`, not by folding `course` into the key the way the
 * pre-opaque derivation had to. A pre-`ol-bo48` record's `key` (still `concept-prov1:`-prefixed,
 * still content-derived — and, on at least one historical record, corrupted by a NUL byte
 * where a space was intended, `git show`-verifiable in this file's own history at the join
 * this function used to perform) is read back verbatim by the match path and never touched by
 * this function — this is the mint-only half; the read-back half is what makes old keys stay
 * valid, corruption included, since rewriting an existing key is exactly what conservation
 * (`[D-088]`) forbids.
 */
function mintKey(nonceSource?: OpaqueKeyNonceSource): string {
  return mintOpaqueConceptKey(nonceSource);
}

/** True when two anchors name the same lookup target (not necessarily byte-identical — see match rules below). */
function anchorMatches(existing: ConceptKeyAnchor, candidate: ConceptKeyAnchor): boolean {
  if (existing.kind === 'note' && candidate.kind === 'note') {
    // noteUid ?? notePath, mirroring `instrument-id.ts` rule 2/3: a stable uid wins when both
    // sides carry one; otherwise fall back to the path.
    if (existing.noteUid !== null && candidate.noteUid !== null) {
      return existing.noteUid === candidate.noteUid;
    }
    return existing.notePath === candidate.notePath;
  }
  if (existing.kind === 'topic' && candidate.kind === 'topic') {
    if (existing.course !== candidate.course) return false;
    if (existing.name === candidate.name) return true;
    // Existing course/wording/alias precedence (knowledge model §3, `[D-088]`): a candidate
    // matching a recorded alias, or a candidate name the record already carries as an alias, is
    // the same "matched" bucket a rename/re-extraction already resolves to.
    if (existing.aliases.includes(candidate.name)) return true;
    if (candidate.aliases.includes(existing.name)) return true;
    return false;
  }
  return false;
}

/**
 * `anchorMatches` extended cross-kind (`ol-2zfj.55`, `[D-183]`): a record already rebound onto a
 * `NoteAnchor` (`bindConceptKeyToNote`, below) still answers to the `TopicAnchor` wording it was
 * rebound FROM, because that wording lives on in `record.aliases` rather than being discarded.
 * Without this, a stale extraction pass still proposing the old topic wording would find no
 * match on the now-note-anchored record and mint a second key — exactly the duplication
 * `bindConceptKeyToNote` exists to prevent from the other direction. Only `note`-existing /
 * `topic`-candidate is meaningful here: nothing rebinds a record the other way, and a
 * `note`-candidate has no wording to compare against `aliases` (a plain string list, not
 * anchors).
 */
function recordMatchesAnchor(record: ConceptKeyRecord, candidate: ConceptKeyAnchor): boolean {
  if (anchorMatches(record.anchor, candidate)) return true;
  if (record.anchor.kind === 'note' && candidate.kind === 'topic') {
    const aliases = recordAliases(record);
    if (aliases.includes(candidate.name)) return true;
    if (candidate.aliases.some((alias) => aliases.includes(alias))) return true;
  }
  return false;
}

/**
 * ONT-R1's "at mint" half (`ol-2zfj.86`, C7.11): finds every EXISTING key whose topic-anchor
 * wording normalises (`./concept-key.js`'s `conceptIdentityNormalizationIndex`) to the same index
 * as any of `candidateWordings`. Called only on the path that is about to MINT a genuinely new
 * key — `resolveConceptKey`, below — never on the exact-match or rename-signature paths, which
 * already resolve to an existing key by a stronger signal and are not "collisions" in this sense.
 *
 * **Proposes, never merges** (the ruling's own words): the result is a plain list of other keys,
 * recorded on the new record as provenance for a later evidential read (F8.6's same-as surface,
 * not yet built). Nothing here returns an existing key in place of a new one, unions two records,
 * or mutates anything this function is not explicitly asked to read.
 *
 * Deliberately narrow to TOPIC anchors' wordings (`name` + `aliases`). A `NoteAnchor`'s identity
 * is already the stronger `noteUid`/path signal `anchorMatches` uses; comparing bound notes by a
 * normalised-wording index would add nothing there and risks a spurious hit between two unrelated
 * notes that merely share a title fragment after folding.
 */
export function findNormalizationCollisions(
  existing: readonly { readonly record: ConceptKeyRecord }[],
  candidateWordings: readonly string[],
): readonly string[] {
  const candidateIndex = new Set(candidateWordings.map(conceptIdentityNormalizationIndex));
  const collisions: string[] = [];
  for (const { record } of existing) {
    if (record.anchor.kind !== 'topic') continue;
    const wordings = [record.anchor.name, ...recordAliases(record)];
    const collides = wordings.some((wording) =>
      candidateIndex.has(conceptIdentityNormalizationIndex(wording)),
    );
    if (collides) collisions.push(record.key);
  }
  return collisions;
}

/** Order-preserving de-duplication, dropping empty strings — the one place `aliases` merges live. */
function dedupeAliases(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Structural equality good enough for "does the anchor need rewriting" — anchors are small, flat-ish objects. */
function anchorEquals(a: ConceptKeyAnchor, b: ConceptKeyAnchor): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'note' && b.kind === 'note')
    return a.noteUid === b.noteUid && a.notePath === b.notePath;
  if (a.kind === 'topic' && b.kind === 'topic') {
    return (
      a.course === b.course &&
      a.name === b.name &&
      stringArraysEqual(a.aliases, b.aliases) &&
      // `introducingPaths` drifts the same way `notePath` does above (module doc: "the anchor
      // is ... allowed to drift") — comparing it here means the ordinary same-name match's
      // in-place anchor refresh (below) keeps it current as new introducing notes appear.
      stringArraysEqual(anchorIntroducingPaths(a), anchorIntroducingPaths(b))
    );
  }
  return false;
}

function serialize(record: ConceptKeyRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * `[D-180 / KEY-2]` / `[D-183 / NAME-1]`'s rename-signature test — the fix for case (b) named on
 * `ol-zfty`: a topic-only concept has no note to anchor a rename on, so a re-worded `topic:` value
 * fails `anchorMatches`'s ordinary name/alias test and, before this, minted a second key.
 *
 * A candidate matches an EXISTING record on this branch only when all three hold: the anchor
 * course is equal; the two `introducingPaths` sets are EQUAL (not merely overlapping — the
 * narrower of the ruling's two mitigation options, chosen because `findings/topic-anchor-
 * collision-rate.md` measured the plain equal-sets test alone colliding on 55–61% of a real
 * vault's topic-only concepts, before this temporal qualifier); and the record's CURRENT wording
 * is absent from `runTopicNames` — the caller's full set of this run's candidate names — which is
 * exactly what tells a genuine rename (the old wording is gone) apart from two distinct concepts
 * that merely share one introducing note (both wordings are still present in the same run, so
 * neither one's "old wording" is actually absent). An empty `introducingPaths` set never matches:
 * treating "no introducing note recorded" as a shared signal would match everything.
 *
 * Deliberately excludes anything `anchorMatches` already accepts (same name, or an existing
 * alias) — this is a fallback for candidates that already failed that test, never a widening of
 * it.
 */
function isRenameSignatureMatch(
  record: ConceptKeyRecord,
  candidate: TopicAnchor,
  runTopicNames: ReadonlySet<string> | undefined,
): boolean {
  // Omitted means disabled, as `ResolveConceptKeyOptions.runTopicNames` documents: without this
  // run's wordings there is no way to tell a rename from two concepts sharing an introducing
  // note, and a shared note alone never proves one identity (`[D-378]`). Before
  // `ol-egov.141.89.9.30` an omitted set fell through to a match — unreached then, because only
  // `extract.ts` asked this branch and it always passes the set; the concept read does not.
  if (runTopicNames === undefined) return false;
  if (record.anchor.kind !== 'topic') return false;
  const existingAnchor = record.anchor;
  if (existingAnchor.course !== candidate.course) return false;
  if (existingAnchor.name === candidate.name) return false; // anchorMatches already covers this
  const candidatePaths = anchorIntroducingPaths(candidate);
  if (candidatePaths.length === 0) return false;
  if (!stringArraysEqual(anchorIntroducingPaths(existingAnchor), candidatePaths)) return false;
  if (runTopicNames.has(existingAnchor.name)) return false;
  return true;
}

export interface ResolveConceptKeyOptions {
  /** Injectable for deterministic tests. Defaults to `new Date().toISOString().slice(0, 10)`. */
  readonly now?: () => string;
  /**
   * `[D-180]`/`[D-183]` rename-signature test only (see `isRenameSignatureMatch` above): every
   * topic wording this extraction run has already seen — `extract.ts`'s `byName` keys, computed
   * once before any candidate in the run is resolved. Used solely to confirm a candidate's
   * matched record's OLD wording is genuinely absent from the current run, distinguishing a
   * rename from two co-listed, distinct concepts. Omitted disables the rename-signature branch
   * entirely (a topic-only candidate then behaves exactly as it did before this ruling) rather
   * than guessing the run is empty.
   */
  readonly runTopicNames?: ReadonlySet<string>;
  /**
   * `ol-bo48`: injectable nonce source for `./concept-key.ts`'s `mintOpaqueConceptKey`, the
   * same shape `now` above already uses for determinism. Defaults to `crypto.randomUUID()` —
   * omit this in production; tests inject a fixed generator to assert on the minted key's shape
   * without asserting on real randomness.
   */
  readonly generateKey?: OpaqueKeyNonceSource;
}

function defaultNow(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One candidate for `resolveConceptKeys`: the tier it would mint at, and its anchor. */
export interface ConceptKeyRequest {
  readonly tier: ConceptTier;
  readonly anchor: ConceptKeyAnchor;
}

/**
 * The store as one lookup pass sees it: the listing, kept current as this pass mints and
 * refreshes, plus the canonical index over it, rebuilt only after a write changed an anchor.
 */
interface StoreState {
  readonly entries: { path: VaultPath; record: ConceptKeyRecord }[];
  index: ConceptKeyCanonicalIndex | null;
}

function canonicalIndexOf(state: StoreState): ConceptKeyCanonicalIndex {
  if (state.index === null) {
    state.index = buildConceptKeyCanonicalIndex(state.entries.map(({ record }) => record));
  }
  return state.index;
}

/**
 * The canonical entry among `hits` (`[D-378]`): each hit is mapped to its identity's canonical
 * key, and the earliest-minted of those wins. Usually every hit is one identity and this is its
 * canonical record; when a candidate matches two identities (a uid-less note path both once held),
 * the earlier identity wins, the same way on every read.
 */
function canonicalEntryAmong(
  state: StoreState,
  hits: readonly { readonly path: VaultPath; readonly record: ConceptKeyRecord }[],
): { path: VaultPath; record: ConceptKeyRecord } | undefined {
  const index = canonicalIndexOf(state);
  const byKey = new Map(state.entries.map((entry) => [entry.record.key, entry]));
  let best: { path: VaultPath; record: ConceptKeyRecord } | undefined;
  for (const hit of hits) {
    const canonical = byKey.get(index.canonicalOf(hit.record.key));
    if (canonical === undefined) continue;
    if (best === undefined || mintedEarlier(canonical.record, best.record) < 0) best = canonical;
  }
  return best;
}

/**
 * One candidate against the store as `state` holds it. Everything `resolveConceptKey`'s doc
 * promises is decided here; the only difference a batch makes is that a later candidate sees
 * what an earlier one minted or refreshed, exactly as it would had the two been resolved one
 * after the other.
 */
async function resolveOne(
  vault: VaultSource,
  state: StoreState,
  request: ConceptKeyRequest,
  options: ResolveConceptKeyOptions,
): Promise<string> {
  const { tier, anchor } = request;
  const hits = state.entries.filter(({ record }) => recordMatchesAnchor(record, anchor));
  const hit = canonicalEntryAmong(state, hits);

  if (hit !== undefined) {
    if (hit.record.anchor.kind === anchor.kind && !anchorEquals(hit.record.anchor, anchor)) {
      const refreshed: ConceptKeyRecord = { ...hit.record, anchor };
      await vault.write(hit.path, serialize(refreshed));
      hit.record = refreshed;
      state.index = null;
    }
    return hit.record.key;
  }

  // `[D-180]`/`[D-183]` rename signature (see `isRenameSignatureMatch`'s doc above): a topic-only
  // candidate that failed the ordinary match above may still be the same concept, re-worded.
  // **Never writes anything on this path** — the persisted record, and the wording it answers to,
  // are left exactly as they are. Surfacing this as a formal rename proposal she can accept or
  // decline (`[D-183]`'s existing accept/decline path, `ol-2zfj.58`/`ol-2zfj.59`) is a follow-up;
  // this seam only stops the orphaning.
  if (anchor.kind === 'topic') {
    const renameHits = state.entries.filter(({ record }) =>
      isRenameSignatureMatch(record, anchor, options.runTopicNames),
    );
    const renameHit = canonicalEntryAmong(state, renameHits);
    if (renameHit !== undefined) return renameHit.record.key;
  }

  const key = mintKey(options.generateKey);
  // ONT-R1's "at mint" normalisation index (`ol-2zfj.86`, C7.11): only meaningful for a topic
  // anchor (see `findNormalizationCollisions`'s doc for why a note anchor is excluded). Computed
  // against the listing this pass already holds — no second vault read — over this candidate's
  // own wording (`name` plus any `aliases` it already carries).
  const normalizationCollisions =
    anchor.kind === 'topic'
      ? findNormalizationCollisions(state.entries, [anchor.name, ...anchor.aliases])
      : [];
  const record: ConceptKeyRecord = {
    key,
    tier,
    anchor,
    aliases: [],
    ...(normalizationCollisions.length > 0 ? { normalizationCollisions } : {}),
    mintedAt: (options.now ?? defaultNow)(),
    schemaVersion: CONCEPT_KEY_RECORD_SCHEMA_VERSION,
  };
  const path = conceptKeyRecordPath(key);
  await vault.write(path, serialize(record));
  // A fresh mint matched no record, so it joins no identity: the index gains a singleton, which a
  // rebuild on the next lookup that needs it picks up.
  state.entries.push({ path, record });
  state.index = null;
  return key;
}

/**
 * The batch seam: resolves every request in order, as one turn of the store's queue (module doc,
 * "ONE WRITER AT A TIME") over one listing. `keys[i]` answers `requests[i]`. Equivalent to calling
 * `resolveConceptKey` for each request one after the other, with nothing else touching the store
 * in between — which is the property a concurrent second pass could otherwise break.
 */
export async function resolveConceptKeys(
  vault: VaultSource,
  requests: readonly ConceptKeyRequest[],
  options: ResolveConceptKeyOptions = {},
): Promise<readonly string[]> {
  if (requests.length === 0) return [];
  return withConceptKeyStoreLock(async () => {
    const state: StoreState = {
      entries: (await listConceptKeyRecords(vault)).map(({ path, record }) => ({ path, record })),
      index: null,
    };
    const keys: string[] = [];
    for (const request of requests) keys.push(await resolveOne(vault, state, request, options));
    return keys;
  });
}

/**
 * The single seam (design doc §7): given this candidate's anchor and tier, resolve its durable
 * key — reading an existing record back verbatim when one matches, minting and persisting a new
 * one otherwise. **Never mints a second record for an anchor that already matches one** (the
 * scenario "re-extraction resolves to the existing key"), not even when two passes ask at once
 * (the store's queue, module doc), and **never deletes, retires or mutates `key` on any existing
 * record** (the conservation property, `[D-088]`) — the only field this function ever rewrites on
 * a hit is `anchor`, and only when it has drifted **within the same anchor kind**. A cross-kind
 * match (`recordMatchesAnchor`'s `[D-183]` alias fallback, above) never rewrites `anchor` here: a
 * stale `TopicAnchor` candidate matching a rebound `NoteAnchor` record must resolve to the same
 * key without regressing the record back off the note it was bound to — undoing that is
 * `bindConceptKeyToNote`'s job to prevent, not this function's to cause.
 *
 * **Several matching records answer with the canonical one (`[D-378]`)** — the earliest-minted
 * record of the matched identity (module doc, "SAME-ANCHOR DUPLICATES"), never whichever file
 * lists first; only that canonical record's anchor is ever refreshed, and no duplicate is touched.
 */
export async function resolveConceptKey(
  vault: VaultSource,
  tier: ConceptTier,
  anchor: ConceptKeyAnchor,
  options: ResolveConceptKeyOptions = {},
): Promise<string> {
  const [key] = await resolveConceptKeys(vault, [{ tier, anchor }], options);
  return key as string;
}

/**
 * The second seam (`ol-2zfj.55`) — key-driven, not anchor-driven. See the module doc's
 * "`bindConceptKeyToNote`" section for why `resolveConceptKey`'s anchor-match seam cannot do
 * this rebind at all.
 *
 * Looks the record up by its durable `key` (never by matching `noteAnchor` against anything —
 * matching is `resolveConceptKey`'s job, not this function's), rewrites its `anchor` to
 * `noteAnchor`, and — per `[D-183]`'s alias rule — folds whatever wording the record is being
 * rebound FROM into `aliases` rather than discarding it:
 *
 *   - Rebinding a `TopicAnchor` record: that anchor's own `name` and `aliases` are folded in.
 *   - Rebinding an already-`NoteAnchor` record (calling this again, e.g. idempotently, or on a
 *     record `resolveConceptKey` already bound by note): nothing new to fold in beyond what
 *     `aliases` already holds — the old anchor carries no wording of its own.
 *
 * **Never mints.** A key with no existing record is a caller error — there is nothing to rebind
 * — and this function throws rather than silently minting one, which would be exactly the
 * "second record for the same concept" `[D-088]`'s conservation property forbids.
 *
 * **Idempotent.** Calling this twice with the same `key` and the same `noteAnchor` writes
 * nothing the second time: both `anchor` and the merged `aliases` are already exactly what this
 * call would produce, so the no-op is a real no-op (no file write), not merely a harmless
 * duplicate write.
 *
 * **Moves the identity, never a duplicate (`[D-378]`).** A `key` that names a superseded
 * duplicate rebinds its identity's canonical record — the one lookup returns — so the identity
 * moves onto the note as `[D-183]` intends and the duplicate itself is never rewritten. Runs as
 * one turn of the store's queue (module doc), so a lookup racing it sees the record either wholly
 * before or wholly after the rebind.
 */
export async function bindConceptKeyToNote(
  vault: VaultSource,
  key: string,
  noteAnchor: NoteAnchor,
): Promise<void> {
  return withConceptKeyStoreLock(() => bindUnderLock(vault, key, noteAnchor));
}

async function bindUnderLock(
  vault: VaultSource,
  key: string,
  noteAnchor: NoteAnchor,
): Promise<void> {
  const existing = await listConceptKeyRecords(vault);
  const canonicalKey = buildConceptKeyCanonicalIndex(
    existing.map(({ record }) => record),
  ).canonicalOf(key);
  const hit = existing.find(({ record }) => record.key === canonicalKey);
  if (hit === undefined) {
    throw new Error(
      `bindConceptKeyToNote: no existing ConceptKeyRecord for key "${key}" — this function ` +
        'rebinds an existing record and never mints one (see the module doc).',
    );
  }

  const priorWordings =
    hit.record.anchor.kind === 'topic'
      ? [hit.record.anchor.name, ...hit.record.anchor.aliases]
      : [];
  const mergedAliases = dedupeAliases([...recordAliases(hit.record), ...priorWordings]);

  const anchorChanged = !anchorEquals(hit.record.anchor, noteAnchor);
  const aliasesChanged = !stringArraysEqual(recordAliases(hit.record), mergedAliases);
  if (!anchorChanged && !aliasesChanged) return;

  const updated: ConceptKeyRecord = {
    ...hit.record,
    anchor: noteAnchor,
    aliases: mergedAliases,
  };
  await vault.write(hit.path, serialize(updated));
}
