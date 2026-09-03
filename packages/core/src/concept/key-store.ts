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
 * The key itself cannot be used as a filename unescaped: today's key (still
 * `provisionalConceptKey`'s derivation — see `./concept-key.ts`) embeds a vault path or her
 * verbatim topic name, both of which may contain `/`, spaces, and other characters a filesystem
 * either forbids or treats as a path separator. Two shapes were considered:
 *
 *   - A content hash of the key (sharded, e.g. `ab/cd1234….json`). Rejected for now: it buys
 *     nothing this module needs (there is no fan-out large enough for sharding to matter — a
 *     concept-dense vault is hundreds of files, not millions) and it costs inspectability: a
 *     record for a given key can no longer be found by eye or by a plain `ls` while debugging.
 *   - `encodeURIComponent(key) + '.json'`, chosen here. It is a pure, total, injective function
 *     on the key (two distinct keys never collide, because percent-encoding is reversible), it
 *     needs no new dependency, and the encoded name stays legible for the common case — a bound
 *     concept's key derives from a note path, so its filename reads as a recognisably-escaped
 *     version of that path (`%20` for spaces, `%2F` for `/`), the same trade `stampMcqId`-style
 *     ids and content-store ids already make for readability over compactness.
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
 * change to this module's contract.
 */

import type { VaultPath, VaultSource } from '../vault/types.js';
import { provisionalConceptKey } from './concept-key.js';
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
 * material — `extract.ts`'s `keyFor` populates it from `ConceptRecord.sourcePaths`, sorted. It is
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
 */
export interface ConceptKeyRecord {
  readonly key: string;
  readonly tier: ConceptTier;
  readonly anchor: ConceptKeyAnchor;
  /** Prior wordings this key has answered to (`[D-183]`) — see the interface doc above. */
  readonly aliases?: readonly string[];
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
  const paths = await vault.list({ under: CONCEPT_KEY_STORE_FOLDER, extensions: ['json'] });
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
 * `key = "concept-prov1:" + (boundNotePath ?? name)`, per `./concept-key.ts`, for a note anchor.
 * This module writes that same string once into a durable record rather than treating it as
 * re-derivable every call — the instrument-id pattern (`../session/instrument-id.ts`): the
 * *prefix* keeps marking that no real opaque-id ruling has landed yet, but the *string*, once
 * minted here, is now read, never recomputed.
 *
 * A topic anchor folds `course` into the root too, deliberately widening
 * `provisionalConceptKey`'s own derivation rather than reusing it verbatim: `anchorMatches`
 * below treats two topic anchors with the same name but different courses as distinct (the
 * lookup is course-scoped, matching `[D-088]`'s course/wording/alias precedence), and a mint
 * that ignored `course` would silently collide two unrelated concepts onto one key and one
 * sidecar file the moment both happened to share a name. `extractConcepts` itself never asks for
 * two records under one name in different courses (it dedupes at the name level before minting,
 * `./extract.ts`'s `byName`), so this only bites a caller that mints directly per course — but a
 * key derivation that is wrong in that case is wrong, not merely untested.
 */
function mintKey(anchor: ConceptKeyAnchor): string {
  if (anchor.kind === 'note')
    return provisionalConceptKey({ name: '', boundNotePath: anchor.notePath });
  return provisionalConceptKey({ name: `${anchor.course} ${anchor.name}`, boundNotePath: null });
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
  if (record.anchor.kind !== 'topic') return false;
  const existingAnchor = record.anchor;
  if (existingAnchor.course !== candidate.course) return false;
  if (existingAnchor.name === candidate.name) return false; // anchorMatches already covers this
  const candidatePaths = anchorIntroducingPaths(candidate);
  if (candidatePaths.length === 0) return false;
  if (!stringArraysEqual(anchorIntroducingPaths(existingAnchor), candidatePaths)) return false;
  if (runTopicNames?.has(existingAnchor.name) === true) return false;
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
}

function defaultNow(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The single seam (design doc §7): given this candidate's anchor and tier, resolve its durable
 * key — reading an existing record back verbatim when one matches, minting and persisting a new
 * one otherwise. **Never mints a second record for an anchor that already matches one** (the
 * scenario "re-extraction resolves to the existing key"), and **never deletes, retires or
 * mutates `key` on any existing record** (the conservation property, `[D-088]`) — the only field
 * this function ever rewrites on a hit is `anchor`, and only when it has drifted **within the same
 * anchor kind**. A cross-kind match (`recordMatchesAnchor`'s `[D-183]` alias fallback, above)
 * never rewrites `anchor` here: a stale `TopicAnchor` candidate matching a rebound `NoteAnchor`
 * record must resolve to the same key without regressing the record back off the note it was
 * bound to — undoing that is `bindConceptKeyToNote`'s job to prevent, not this function's to
 * cause.
 */
export async function resolveConceptKey(
  vault: VaultSource,
  tier: ConceptTier,
  anchor: ConceptKeyAnchor,
  options: ResolveConceptKeyOptions = {},
): Promise<string> {
  const now = options.now ?? defaultNow;
  const existing = await listConceptKeyRecords(vault);
  const hit = existing.find(({ record }) => recordMatchesAnchor(record, anchor));

  if (hit !== undefined) {
    if (hit.record.anchor.kind === anchor.kind && !anchorEquals(hit.record.anchor, anchor)) {
      const refreshed: ConceptKeyRecord = { ...hit.record, anchor };
      await vault.write(hit.path, serialize(refreshed));
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
    const renameHit = existing.find(({ record }) =>
      isRenameSignatureMatch(record, anchor, options.runTopicNames),
    );
    if (renameHit !== undefined) return renameHit.record.key;
  }

  const key = mintKey(anchor);
  const record: ConceptKeyRecord = {
    key,
    tier,
    anchor,
    aliases: [],
    mintedAt: now(),
    schemaVersion: CONCEPT_KEY_RECORD_SCHEMA_VERSION,
  };
  await vault.write(conceptKeyRecordPath(key), serialize(record));
  return key;
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
 */
export async function bindConceptKeyToNote(
  vault: VaultSource,
  key: string,
  noteAnchor: NoteAnchor,
): Promise<void> {
  const existing = await listConceptKeyRecords(vault);
  const hit = existing.find(({ record }) => record.key === key);
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
