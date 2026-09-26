/**
 * The severable same-as link — ONT-R1 (`ol-2zfj.86`, superseding `[D-088]`'s merge-as-lineage
 * mechanism), F8.6, C7.10/C7.11. Design authority: `olea-service`
 * `docs/dev/relation-landing-design.md` §7.1; the ruling text is carried verbatim on `ol-2zfj.86`.
 *
 * **The rule this module builds, exactly as ruled.** "A normalisation collision PROPOSES, it
 * never merges. The proposal is resolved by an evidential read of both identities' introducing
 * passages, and lands as a severable same-as link between the two identities: consumers read
 * them as one, but nothing is unioned, both keys persist, historical evidence keeps the key it
 * was written with, and the link can later be severed if the evidence turns out to be wrong."
 *
 * **Nothing here mints, retires, or unions a concept key.** `./key-store.ts`'s `ConceptKeyRecord`
 * is untouched by every function in this file — a same-as link references two existing keys by
 * their opaque string value and never inspects, requires, or depends on how either was derived
 * (per this lane's brief: "code against the key as an opaque string").
 *
 * **Bias to splits, structurally, not just by convention.** The identity study's measured cost
 * asymmetry (`ol-2zfj.86`'s close reason) is that a false merge is silent, compounds, and has no
 * repair path, while a false split only costs duplicated evidence and is repaired by an explicit
 * link. This module makes the unrepairable direction hard to reach by construction:
 * `proposeSameAsLink` — the one function an automatic collision signal may call — can only ever
 * produce a `'proposed'` record or leave an existing decision (`'proposed'`, `'confirmed'`,
 * `'declined'`, or `'severed'`) exactly as it was, with one named exception (see below). **It
 * never transitions a record itself and never creates a `'confirmed'` one.** Confirming
 * (`confirmSameAsLink`), declining (`declineSameAsLink`) and severing (`severSameAsLink`) are
 * separate, explicit calls a caller makes only after "an evidential read of both identities'
 * introducing passages" — this module does not perform that read; it is the persisted shape the
 * read's verdict lands in, the same separation `./key-store.ts`'s mint/lookup split already
 * draws between deciding an identity and recording one.
 *
 * **Four states, three of them triage states (`[D-257]` ruling 3).** `'proposed'`, `'confirmed'`
 * and `'declined'` are the identity-triage surface's own vocabulary (F8.4a); `'severed'` is this
 * mechanism's own fourth state, reached only from `'confirmed'`, never a triage verdict itself. A
 * decline is a hard labelled negative on a *proposal* — it never asserts the two concepts differ,
 * and never blocks a later confirm; it is re-proposed only on a materially-changed-evidence event
 * (`[D-093]`), which `proposeSameAsLink`'s `evidenceFingerprint` option exists to detect.
 *
 * **Severing is not an automatic reversal of a merge** (ONT-R1's own words) — and, as of
 * `[D-295 / CPT-D2]`, there is nothing on disk to reverse in the first place. This module
 * carried an explicit write-side remap of relation-cache records early in the build
 * (`remapIncidentRelationCacheRecords` / `edgesEligibleForSplitMigration`); `[D-295]` ruled "a
 * confirmed merge rewrites no stored record" and every reader resolves through the same-as fold
 * at read time instead (`./same-as-consumer.ts`), so a sever is exactly the withdrawal of that
 * fold — nothing was ever rewritten, so nothing needs to be un-rewritten. The write-side remap
 * was removed for that reason (`ol-egov.141.89.3.4` [ILB-CPT-4], cpt.md §8: "so there is one
 * merge rule, not two").
 *
 * **Reads by identity, transitions by record (`[D-378]`, `ol-egov.141.89.9.56`).** Two
 * `.olea/concepts/` records sharing an anchor are one identity, and `./key-store.ts`'s canonical-key
 * index names its canonical key. `checkSameAsClosureCompatibility` and `proposeSameAsLink`'s look-up
 * of an existing decision read every link's keys through that index, so a pair confirmed, declined
 * or severed under a superseded duplicate's key counts for its canonical identity. The transitions
 * (`confirmSameAsLink`, `declineSameAsLink`, `severSameAsLink`) still address one record by the
 * keys it was written with, and nothing here rewrites a record's keys. A shared introducing passage
 * alone never makes two concepts one identity, so it never joins two links either.
 */

import { listFolder } from '../vault/list-folder.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import {
  type ConceptKeyCanonicalIndex,
  type ConceptKeyRecord,
  readConceptKeyCanonicalIndex,
} from './key-store.js';
import type { KeyedConceptRelation } from './relation-cache.js';

/** The vault folder this module owns. Dot-prefixed, sibling to `.olea/concepts/` and `.olea/relations/`. */
export const SAME_AS_LINK_FOLDER: VaultPath = '.olea/same-as';

export const SAME_AS_LINK_RECORD_SCHEMA_VERSION = 1;

/**
 * `'proposed'` — a collision was found; nothing is read as one yet. `'confirmed'` — an
 * evidential read landed the two identities as one; consumers may treat them as one, neither key
 * is retired. `'declined'` — the evidential read landed the two identities as NOT (yet) one; a
 * hard labelled negative, never a claim that the two ARE different, and never a block on a later
 * confirm (`[D-257]` ruling 3). `'severed'` — a confirmed link was undone because the evidence
 * turned out wrong; both identities go back to reading independently, and the two keys were never
 * unioned in the first place so nothing needs to be un-merged, only the reading undone.
 *
 * **`'declined'` and `'severed'` are not the same state reached two ways.** A decline is the
 * triage-surface verdict on a *proposal* (F8.4a) — reversible by a plain confirm, because the
 * student may simply accept later. A sever undoes a *confirmed* link because the evidence turned
 * out wrong; declining a confirmed link is a caller error (`declineSameAsLink` rejects it and
 * points at `severSameAsLink`), never a silent downgrade. Only three of these four are triage
 * states in F8.4a's sense — proposed, confirmed, declined; severed is the mechanism's own state.
 */
export type SameAsLinkStatus = 'proposed' | 'confirmed' | 'declined' | 'severed';

/**
 * Why the pair was proposed. `'normalisation-collision'` is the one nomination reason ONT-R1
 * itself rules (mint-time normalisation index collision, `./key-store.ts`'s
 * `findNormalizationCollisions`); this is a closed union deliberately, matching
 * `RelationProvenanceKind`'s "nothing here is this module's to choose" discipline — a second
 * nomination reason is a decision, not an implementation detail, exactly as `related`'s missing
 * reader is (`./relation.ts`).
 */
export type SameAsProposalReason = 'normalisation-collision';

export interface SameAsLinkRecord {
  /** The pair's two opaque keys, in canonical sorted order (`byCodeUnit`) — this record's own identity is symmetric: "keyA is same as keyB" carries no direction. */
  readonly keyA: string;
  readonly keyB: string;
  readonly status: SameAsLinkStatus;
  readonly reason: SameAsProposalReason;
  readonly proposedAt: string;
  readonly confirmedAt?: string;
  /** Set when `declineSameAsLink` records the verdict, and left in place across a later `[D-093]` re-proposal — "decline history kept" (`[D-257]` ruling 3): the record shows it was once declined even after `status` has moved back to `'proposed'` or on to `'confirmed'`. */
  readonly declinedAt?: string;
  readonly severedAt?: string;
  /**
   * An opaque, caller-computed identity of the evidence passages the CURRENT proposal rests on —
   * same discipline as `keyA`/`keyB`: this module never inspects, hashes, or requires anything
   * about how it was derived (a caller might use `../ingestion/hash.ts`'s `hashText` over both
   * introducing passages, or anything else stable). Its one job is the smallest hook `[D-257]`
   * ruling 3 needs: **`proposeSameAsLink` compares it against a `'declined'` record's stored value
   * to detect the `[D-093]` "evidence passages meaningfully changed" event** — a caller that never
   * passes one gets the old, conservative behaviour (a declined link is never reopened
   * automatically). Not compared for any other status; a `'proposed'`/`'confirmed'`/`'severed'`
   * record's own bias-to-splits no-op is unaffected by this field either way.
   */
  readonly evidenceFingerprint?: string;
  readonly schemaVersion: number;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical `[keyA, keyB]` order for a pair — sorted, so the same two keys always resolve to the same record regardless of call order. */
function canonicalPair(keyA: string, keyB: string): readonly [string, string] {
  return byCodeUnit(keyA, keyB) <= 0 ? [keyA, keyB] : [keyB, keyA];
}

/** This record's own file identity — distinct from `./relation-cache.ts`'s `propositionKey`, which is per-edge-type; a same-as link has no relation type, only a pair. */
function linkIdentity(keyA: string, keyB: string): string {
  const [a, b] = canonicalPair(keyA, keyB);
  return `${a} ${b}`;
}

export function sameAsLinkRecordPath(keyA: string, keyB: string): VaultPath {
  return `${SAME_AS_LINK_FOLDER}/${encodeURIComponent(linkIdentity(keyA, keyB))}.json`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isSameAsLinkRecord(value: unknown): value is SameAsLinkRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.keyA) || !isNonEmptyString(v.keyB)) return false;
  if (
    v.status !== 'proposed' &&
    v.status !== 'confirmed' &&
    v.status !== 'declined' &&
    v.status !== 'severed'
  )
    return false;
  if (v.reason !== 'normalisation-collision') return false;
  if (!isNonEmptyString(v.proposedAt)) return false;
  if (v.confirmedAt !== undefined && !isNonEmptyString(v.confirmedAt)) return false;
  if (v.declinedAt !== undefined && !isNonEmptyString(v.declinedAt)) return false;
  if (v.severedAt !== undefined && !isNonEmptyString(v.severedAt)) return false;
  if (v.evidenceFingerprint !== undefined && !isNonEmptyString(v.evidenceFingerprint)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

function serialize(record: SameAsLinkRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export async function listSameAsLinkRecords(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly record: SameAsLinkRecord }[]> {
  // `listFolder`, not `vault.list`: `ObsidianSource.list()` never sees a dot folder, so this scan
  // must walk the raw adapter instead (`ol-egov.141.89.10.52`, `ol-egov.141.89.10.56`).
  const paths = await listFolder(vault, SAME_AS_LINK_FOLDER, { extensions: ['json'] });
  const out: { readonly path: VaultPath; readonly record: SameAsLinkRecord }[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isSameAsLinkRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable file: skipped, never thrown — same posture as every sibling sidecar.
    }
  }
  return out;
}

async function findLink(
  vault: VaultSource,
  keyA: string,
  keyB: string,
): Promise<{ readonly path: VaultPath; readonly record: SameAsLinkRecord } | undefined> {
  const path = sameAsLinkRecordPath(keyA, keyB);
  if (!(await vault.exists(path))) return undefined;
  try {
    const parsed: unknown = JSON.parse(await vault.read(path));
    if (isSameAsLinkRecord(parsed)) return { path, record: parsed };
  } catch {
    // Corrupt: treated as absent, matching `listSameAsLinkRecords`'s posture.
  }
  return undefined;
}

/**
 * A link already recorded for this identity pair under other keys (`[D-378]`, module doc): a record
 * whose two keys resolve, through the canonical-key index, to the pair `keyA`/`keyB` resolve to. A
 * decision outranks a pending proposal when there are several (the first `'confirmed'`,
 * `'declined'` or `'severed'` record in listing order, else the first `'proposed'` one).
 * `undefined` on a store with no duplicates, without listing a single link.
 */
async function findLinkForIdentityPair(
  vault: VaultSource,
  keyA: string,
  keyB: string,
  canonicalKeys: ConceptKeyCanonicalIndex,
): Promise<{ readonly path: VaultPath; readonly record: SameAsLinkRecord } | undefined> {
  if (canonicalKeys.superseded.size === 0) return undefined;
  const target = linkIdentity(canonicalKeys.canonicalOf(keyA), canonicalKeys.canonicalOf(keyB));
  const matches = (await listSameAsLinkRecords(vault)).filter(
    ({ record }) =>
      linkIdentity(
        canonicalKeys.canonicalOf(record.keyA),
        canonicalKeys.canonicalOf(record.keyB),
      ) === target,
  );
  return matches.find(({ record }) => record.status !== 'proposed') ?? matches[0];
}

function defaultNow(): string {
  return new Date().toISOString();
}

export interface ProposeSameAsLinkOptions {
  readonly reason?: SameAsProposalReason;
  readonly now?: () => string;
  /**
   * The proposal's evidence identity, stored on the record as `evidenceFingerprint`. Only ever
   * compared when the existing record is `'declined'` (see below) — a caller that omits this on
   * every other status gets exactly the prior behaviour.
   */
  readonly evidenceFingerprint?: string;
  /**
   * `[D-378]`: the canonical-key index an existing decision is looked up through (see below). Read
   * from the vault's `.olea/concepts/` store when omitted and the exact pair has no record.
   */
  readonly canonicalKeys?: ConceptKeyCanonicalIndex;
}

/**
 * The one function an automatic collision signal may call. **Bias-to-splits, structurally:**
 * this function transitions nothing on its own initiative — it writes a brand-new `'proposed'`
 * record only when NO record exists for this pair at all, and is a no-op (returns the existing
 * record unchanged) in every other case: already `'proposed'` (do not re-propose, same "does not
 * fire again" discipline `[D-183]`'s rename proposal uses), already `'confirmed'` (already read as
 * one, nothing to propose), already `'severed'` (the evidence was already read and rejected once —
 * an automatic signal re-finding the same normalisation collision is not new evidence, and
 * re-opening a severed link is a decision for the same evidential read that would confirm one,
 * never something this function does on its own), or already `'declined'` **with unchanged
 * evidence** (the triage verdict holds; `[D-257]` ruling 3: "not re-proposed on the evidence it
 * was declined from"). The ambiguous-resolves-to-no-link property this module is held to is
 * exactly this: every pre-existing state outnumbers and outranks the single case that writes
 * anything, and the only thing that case ever writes is a proposal, never a link.
 *
 * **The one case this function DOES transition:** a `'declined'` record whose stored
 * `evidenceFingerprint` differs from `options.evidenceFingerprint` — the `[D-093]`
 * materially-changed-evidence event ruling 3 names as the sole re-proposal trigger. That record
 * moves back to `'proposed'` with a fresh `proposedAt`, and `declinedAt` is left in place —
 * "decline history kept" — so a later reader can still see it was declined once. A caller that
 * never passes `evidenceFingerprint` never triggers this path: a declined link with no fingerprint
 * on either side compares `undefined === undefined` and stays declined, matching the
 * conservative default every other branch already has.
 *
 * **An existing decision is found by identity (`[D-378]`, module doc).** When this exact pair has
 * no record, a record for the same identity pair under a superseded duplicate's key is this pair's
 * record, and every rule above applies to it — so a pair declined under one key of an identity is
 * not re-proposed under another. A brand-new record carries the keys as given; a caller proposing
 * from the concept store resolves them first (`packages/plugin/src/concept/wiring.ts`'s
 * `proposeSameAsForMovedNoteAnchors`).
 */
export async function proposeSameAsLink(
  vault: VaultSource,
  keyA: string,
  keyB: string,
  options: ProposeSameAsLinkOptions = {},
): Promise<SameAsLinkRecord> {
  const now = options.now ?? defaultNow;
  const existing =
    (await findLink(vault, keyA, keyB)) ??
    (await findLinkForIdentityPair(
      vault,
      keyA,
      keyB,
      options.canonicalKeys ?? (await readConceptKeyCanonicalIndex(vault)),
    ));
  if (existing !== undefined) {
    if (
      existing.record.status === 'declined' &&
      options.evidenceFingerprint !== undefined &&
      options.evidenceFingerprint !== existing.record.evidenceFingerprint
    ) {
      const reproposed: SameAsLinkRecord = {
        ...existing.record,
        status: 'proposed',
        proposedAt: now(),
        evidenceFingerprint: options.evidenceFingerprint,
      };
      await vault.write(existing.path, serialize(reproposed));
      return reproposed;
    }
    return existing.record;
  }

  const [a, b] = canonicalPair(keyA, keyB);
  const record: SameAsLinkRecord = {
    keyA: a,
    keyB: b,
    status: 'proposed',
    reason: options.reason ?? 'normalisation-collision',
    proposedAt: now(),
    schemaVersion: SAME_AS_LINK_RECORD_SCHEMA_VERSION,
    ...(options.evidenceFingerprint !== undefined
      ? { evidenceFingerprint: options.evidenceFingerprint }
      : {}),
  };
  await vault.write(sameAsLinkRecordPath(keyA, keyB), serialize(record));
  return record;
}

/**
 * The mint-time half of the collision-to-proposal step (`docs/dev/intelligence-build/cpt.md`
 * §2 "1.1a proposals", §7 `[D-295 / CPT-D2]`) — the other half, the moved-note anchor case, is
 * `packages/plugin/src/concept/wiring.ts`'s `proposeSameAsForMovedNoteAnchors`, landed by
 * `ol-egov.141.89.3.8`. `./key-store.ts`'s `resolveOne` already computes and stores a
 * normalisation collision at mint time (`ConceptKeyRecord.normalizationCollisions`, topic
 * anchors only — see that field's own doc), but nothing before this function ever read it back
 * to propose anything: it sat as "provenance for a later evidential read ... not yet built" (that
 * field's own words). This is that seam.
 *
 * Turns every stored `normalizationCollisions` entry into a `'proposed'` same-as link, through
 * `proposeSameAsLink`'s own bias-to-splits seam — so calling this over the same `records` twice,
 * or once per run over a store that keeps accumulating unrelated mints, writes nothing new for a
 * pair that already has a decision (`proposeSameAsLink`'s own no-op rule: already `'proposed'`,
 * `'confirmed'`, `'severed'`, or `'declined'` with unchanged evidence). Nothing here is ever
 * confirmed automatically — this function only ever calls `proposeSameAsLink`, never
 * `confirmSameAsLink`.
 *
 * **Takes a listing, not a vault scan of its own** (`records`, typically a caller's own
 * `listConceptKeyRecords(vault)` result — `./key-store.ts`'s `resolveConceptKeys` already reads
 * one per batch), so a caller already holding this pass's listing need not read the vault a
 * second time. Scans every record that carries a collision, not only ones a caller names,
 * because a collision recorded on an earlier run and never proposed (the mint-time half not yet
 * wired into production, cpt.md §2) is exactly the backlog this seam exists to catch up on once
 * it is wired in — see this function's own "no production caller yet" note below.
 *
 * **Keys by identity (`[D-378]`).** Every key — a record's own and each of its collisions — is
 * resolved through `canonicalKeys` before proposing, the same discipline
 * `proposeSameAsForMovedNoteAnchors` already applies: two records sharing an anchor are one
 * identity, so a collision against a superseded duplicate's key proposes against that identity's
 * canonical key, never a second link for the same pair under a different key. A collision that
 * normalises to the record's OWN canonical identity (already-merged duplicates) proposes nothing
 * — there is no split to reconcile. Each canonical pair is proposed at most once per call, even
 * when several records point at the same collision.
 *
 * **No production caller yet ([D-072]).** Wiring this into the real ingestion tick — after
 * `key-store.ts`'s `resolveConceptKeys` in `packages/plugin/src/concept/wiring.ts`'s
 * `buildConceptWiring`/`readConceptsAndRelations` composition, alongside
 * `proposeSameAsForMovedNoteAnchors` — is `[ILB-CPT-4]`'s remaining to-do; this function is the
 * tested, composable unit that step calls.
 */
export async function proposeSameAsFromMintCollisions(
  vault: VaultSource,
  records: readonly { readonly record: ConceptKeyRecord }[],
  options: { readonly now?: () => string; readonly canonicalKeys?: ConceptKeyCanonicalIndex } = {},
): Promise<readonly SameAsLinkRecord[]> {
  const canonicalKeys = options.canonicalKeys ?? (await readConceptKeyCanonicalIndex(vault));
  const proposed: SameAsLinkRecord[] = [];
  const proposedPairs = new Set<string>();

  for (const { record } of records) {
    const collisions = record.normalizationCollisions ?? [];
    if (collisions.length === 0) continue;
    const ownKey = canonicalKeys.canonicalOf(record.key);
    for (const collisionKey of collisions) {
      const otherKey = canonicalKeys.canonicalOf(collisionKey);
      if (otherKey === ownKey) continue; // already one identity: nothing to propose.
      const pair = JSON.stringify(canonicalPair(ownKey, otherKey));
      if (proposedPairs.has(pair)) continue;
      proposedPairs.add(pair);
      proposed.push(
        await proposeSameAsLink(vault, ownKey, otherKey, {
          canonicalKeys,
          ...(options.now !== undefined ? { now: options.now } : {}),
        }),
      );
    }
  }
  return proposed;
}

/**
 * A conflict `checkSameAsClosureCompatibility` found: two keys inside the class a confirm would
 * close, which are already linked as `'declined'` or `'severed'` — evidence she has already read
 * as (for now) two identities, not one.
 */
export interface SameAsClosureConflict {
  /** The conflicting pair, in canonical sorted order — see `canonicalPair`. */
  readonly keyA: string;
  readonly keyB: string;
  readonly status: 'declined' | 'severed';
}

export interface SameAsClosureCheckResult {
  readonly compatible: boolean;
  /** Present only when `compatible` is `false`. */
  readonly conflict?: SameAsClosureConflict;
  /** Every key that would share one equivalence class if `keyA`/`keyB` were confirmed, sorted. Computed whether or not the check finds a conflict, so a caller can log or display the class either way. */
  readonly resultingClass: readonly string[];
}

/**
 * The class-level compatibility check `[D-295 / CPT-D2]` item 2 and `docs/dev/intelligence-build
 * /cpt.md` section 2's "1.1a closure" row require, run before a confirm closes a class
 * transitively (`[IL-D8]`). **Never a write** — this is a pure read over the currently persisted
 * same-as links, so a caller may compute it before deciding whether to confirm at all.
 *
 * **What "the resulting class" means.** Same-as links form an undirected graph; a `'confirmed'`
 * link is an edge two keys already share, so confirming `keyA`/`keyB` adds one more edge to that
 * graph. This function takes every `'confirmed'` edge on file, adds the hypothetical `keyA`/`keyB`
 * edge, and returns the connected component (the transitive class) `keyA` and `keyB` would then
 * both belong to — the three-way case `docs/dev/intelligence-build/cpt.md` section 4 names by
 * example (A=B proposed, B=C confirmed, A and C declined) is exactly two existing keys reached
 * through one hop each, not a hardcoded three-key special case.
 *
 * **What counts as a conflict.** Every pair of DISTINCT keys within that resulting class, other
 * than the `keyA`/`keyB` pair itself, is checked against the currently persisted same-as link (if
 * any) between them: a `'declined'` or `'severed'` status there blocks the confirm. The
 * `keyA`/`keyB` pair's OWN history is never checked here — `[D-257]` ruling 3's "a decline never
 * blocks a future confirm" already governs that pair directly (`confirmSameAsLink` allows
 * confirming a `'declined'` or `'severed'` record for the SAME pair); this function only adds the
 * further, transitive check ONT-R1 and `[D-295]` ask for: pairs OTHER than the one being decided,
 * that closing this class would newly read as one identity.
 *
 * A `'proposed'` link between two class members is never a conflict — proposing something is not
 * her evidential read of it, and this function's whole job is checking against what she HAS read
 * (`'declined'`/`'severed'`), never against an unresolved proposal.
 *
 * **Keys are read by identity (`[D-378]`, module doc).** Every link's keys, and `keyA`/`keyB`
 * themselves, are resolved through the canonical-key index before the class is walked, so a pair
 * declined or severed under a superseded duplicate's key conflicts exactly as it would under the
 * canonical key, and `resultingClass` and `conflict` name canonical keys. A pair with several
 * records under duplicate keys conflicts when any one of them was declined or severed. On a store
 * with no duplicates this reads exactly as it did before. `canonicalKeys` is read from the vault's
 * `.olea/concepts/` store when omitted.
 */
export async function checkSameAsClosureCompatibility(
  vault: VaultSource,
  keyA: string,
  keyB: string,
  options: { readonly canonicalKeys?: ConceptKeyCanonicalIndex } = {},
): Promise<SameAsClosureCheckResult> {
  const canonicalKeys = options.canonicalKeys ?? (await readConceptKeyCanonicalIndex(vault));
  const canonicalOf = (key: string): string => canonicalKeys.canonicalOf(key);
  const all = await listSameAsLinkRecords(vault);
  const readApart = new Map<string, 'declined' | 'severed'>();
  for (const { record } of all) {
    if (record.status !== 'declined' && record.status !== 'severed') continue;
    const identity = linkIdentity(canonicalOf(record.keyA), canonicalOf(record.keyB));
    if (!readApart.has(identity)) readApart.set(identity, record.status);
  }

  const adjacency = new Map<string, Set<string>>();
  const addEdge = (x: string, y: string): void => {
    if (!adjacency.has(x)) adjacency.set(x, new Set());
    if (!adjacency.has(y)) adjacency.set(y, new Set());
    adjacency.get(x)?.add(y);
    adjacency.get(y)?.add(x);
  };
  for (const { record } of all) {
    if (record.status === 'confirmed') {
      addEdge(canonicalOf(record.keyA), canonicalOf(record.keyB));
    }
  }
  // The hypothetical edge this confirm would add — included so keyA's and keyB's existing
  // classes (if any) are reached in the same walk, whether or not either key has any confirmed
  // link yet.
  const startA = canonicalOf(keyA);
  const startB = canonicalOf(keyB);
  addEdge(startA, startB);

  const visited = new Set<string>([startA]);
  const stack: string[] = [startA];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
  }
  const resultingClass = [...visited].sort(byCodeUnit);
  const [confirmingA, confirmingB] = canonicalPair(startA, startB);

  for (let i = 0; i < resultingClass.length; i += 1) {
    for (let j = i + 1; j < resultingClass.length; j += 1) {
      const x = resultingClass[i];
      const y = resultingClass[j];
      if (x === undefined || y === undefined) continue;
      if (x === confirmingA && y === confirmingB) continue; // the pair being decided: not its own conflict ([D-257] ruling 3).
      const status = readApart.get(linkIdentity(x, y));
      if (status !== undefined) {
        return {
          compatible: false,
          conflict: { keyA: x, keyB: y, status },
          resultingClass,
        };
      }
    }
  }

  return { compatible: true, resultingClass };
}

/**
 * The evidential-read verdict, recorded. **Never mints a proposal** — a confirm with no existing
 * record at all is a caller error (there was no candidate to resolve), mirroring
 * `./key-store.ts`'s `bindConceptKeyToNote` throwing rather than silently minting. Idempotent:
 * confirming an already-`'confirmed'` link for the same pair writes nothing new — and, since the
 * class is already closed in that case, the closure check below is skipped rather than re-run.
 *
 * **Confirming a `'declined'` link is allowed, deliberately** (`[D-257]` ruling 3: "a decline
 * never asserts the two are different and never blocks a future confirm"). A decline is a hard
 * labelled negative on the *proposal*, not a verdict that the two concepts differ, so the student
 * accepting later is not a contradiction this function needs to guard against — it is exactly the
 * outcome the ruling anticipates.
 *
 * **The class-level compatibility check (`[D-295 / CPT-D2]` item 2, `[IL-D8]`) runs before the
 * write.** If closing this pair would transitively join the resulting equivalence class to a pair
 * she has already declined or severed, `checkSameAsClosureCompatibility` reports the conflict and
 * this function throws instead of writing — the record on file is left exactly as it was. The
 * check reads keys by identity (`[D-378]`); `options.canonicalKeys` is handed to it when given.
 */
export async function confirmSameAsLink(
  vault: VaultSource,
  keyA: string,
  keyB: string,
  options: { readonly now?: () => string; readonly canonicalKeys?: ConceptKeyCanonicalIndex } = {},
): Promise<SameAsLinkRecord> {
  const now = options.now ?? defaultNow;
  const existing = await findLink(vault, keyA, keyB);
  if (existing === undefined) {
    throw new Error(
      `confirmSameAsLink: no proposed same-as link for this pair — a collision proposes, it ` +
        'never merges, so a confirm must follow an existing proposal (ONT-R1).',
    );
  }
  if (existing.record.status === 'confirmed') return existing.record;

  const closureCheck = await checkSameAsClosureCompatibility(
    vault,
    keyA,
    keyB,
    options.canonicalKeys !== undefined ? { canonicalKeys: options.canonicalKeys } : {},
  );
  if (!closureCheck.compatible) {
    const conflict = closureCheck.conflict;
    throw new Error(
      `confirmSameAsLink: confirming ${JSON.stringify(keyA)} = ${JSON.stringify(keyB)} would ` +
        `close an equivalence class also containing ${JSON.stringify(conflict?.keyA)} and ` +
        `${JSON.stringify(conflict?.keyB)}, which are already '${conflict?.status}' — the ` +
        'class-level compatibility check blocks this closure (ONT-R1, [D-295 / CPT-D2]).',
    );
  }

  const confirmed: SameAsLinkRecord = {
    ...existing.record,
    status: 'confirmed',
    confirmedAt: now(),
  };
  await vault.write(existing.path, serialize(confirmed));
  return confirmed;
}

/**
 * The triage-surface "no" (F8.4a, `[D-257]` ruling 3) — a hard labelled negative, recorded.
 * **Never mints a proposal**, same discipline as `confirmSameAsLink`: a decline with no existing
 * record is a caller error. Idempotent: declining an already-`'declined'` link for the same pair
 * writes nothing new (mirrors `confirmSameAsLink`'s already-`'confirmed'` no-op).
 *
 * **Only a `'proposed'` link can be declined.** A `'confirmed'` link is rejected with a pointer at
 * `severSameAsLink`: "declining a confirmed link is not a decline, it is a sever" is this ruling's
 * own words, restated as the guard a caller hits rather than left to a comment. A `'severed'` link
 * is rejected too — there is no pending proposal left to answer.
 */
export async function declineSameAsLink(
  vault: VaultSource,
  keyA: string,
  keyB: string,
  options: { readonly now?: () => string } = {},
): Promise<SameAsLinkRecord> {
  const now = options.now ?? defaultNow;
  const existing = await findLink(vault, keyA, keyB);
  if (existing === undefined) {
    throw new Error(
      `declineSameAsLink: no proposed same-as link for this pair — a collision proposes, it ` +
        'never merges, so a decline must follow an existing proposal (ONT-R1).',
    );
  }
  if (existing.record.status === 'declined') return existing.record;
  if (existing.record.status === 'confirmed') {
    throw new Error(
      `declineSameAsLink: link is already 'confirmed' — declining a confirmed link is not a ` +
        'decline, it is a sever; call severSameAsLink instead ([D-257] ruling 3).',
    );
  }
  if (existing.record.status === 'severed') {
    throw new Error(
      "declineSameAsLink: link is 'severed', not 'proposed' — there is no pending proposal left " +
        'to decline for this pair.',
    );
  }

  const declined: SameAsLinkRecord = {
    ...existing.record,
    status: 'declined',
    declinedAt: now(),
  };
  await vault.write(existing.path, serialize(declined));
  return declined;
}

/**
 * Undoes the READING, never the record of it having happened. `severedAt` is set, `confirmedAt`
 * is kept (both facts persist — the same "expired and declined are distinct facts in the record"
 * discipline `[D-097]` rules for dispositions, applied here to a link's own history). Throws when
 * there is no confirmed link to sever, for the same reason `confirmSameAsLink` throws on a
 * missing proposal.
 */
export async function severSameAsLink(
  vault: VaultSource,
  keyA: string,
  keyB: string,
  options: { readonly now?: () => string } = {},
): Promise<SameAsLinkRecord> {
  const now = options.now ?? defaultNow;
  const existing = await findLink(vault, keyA, keyB);
  if (existing === undefined || existing.record.status !== 'confirmed') {
    throw new Error('severSameAsLink: no confirmed same-as link for this pair to sever.');
  }
  const severed: SameAsLinkRecord = { ...existing.record, status: 'severed', severedAt: now() };
  await vault.write(existing.path, serialize(severed));
  return severed;
}

/** Re-exported for callers composing a same-as-aware relation cache write without a second import — see `./relation-wiring.ts` (plugin). */
export type { KeyedConceptRelation };
