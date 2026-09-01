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

/** A topic-only (tier-2) concept's anchor: the existing course/wording/alias match signal. */
export interface TopicAnchor {
  readonly kind: 'topic';
  readonly course: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

export type ConceptKeyAnchor = NoteAnchor | TopicAnchor;

/**
 * `ConceptKeyRecord` — design doc §6, one file per concept under `.olea/concepts/`.
 *
 * `key` is the durable, never-recomputed field once minted. `anchor` is deliberately NOT part of
 * the identity being protected — it is the current best match signal, allowed to drift (a
 * rename updates `anchor.notePath`; `noteUid`, the part that actually matters, does not move).
 */
export interface ConceptKeyRecord {
  readonly key: string;
  readonly tier: ConceptTier;
  readonly anchor: ConceptKeyAnchor;
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
  if (!isNonEmptyString(v.mintedAt)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
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

/** Structural equality good enough for "does the anchor need rewriting" — anchors are small, flat-ish objects. */
function anchorEquals(a: ConceptKeyAnchor, b: ConceptKeyAnchor): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'note' && b.kind === 'note')
    return a.noteUid === b.noteUid && a.notePath === b.notePath;
  if (a.kind === 'topic' && b.kind === 'topic') {
    return (
      a.course === b.course &&
      a.name === b.name &&
      a.aliases.length === b.aliases.length &&
      a.aliases.every((alias, i) => alias === b.aliases[i])
    );
  }
  return false;
}

function serialize(record: ConceptKeyRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export interface ResolveConceptKeyOptions {
  /** Injectable for deterministic tests. Defaults to `new Date().toISOString().slice(0, 10)`. */
  readonly now?: () => string;
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
 * this function ever rewrites on a hit is `anchor`, and only when it has drifted.
 */
export async function resolveConceptKey(
  vault: VaultSource,
  tier: ConceptTier,
  anchor: ConceptKeyAnchor,
  options: ResolveConceptKeyOptions = {},
): Promise<string> {
  const now = options.now ?? defaultNow;
  const existing = await listConceptKeyRecords(vault);
  const hit = existing.find(({ record }) => anchorMatches(record.anchor, anchor));

  if (hit !== undefined) {
    if (!anchorEquals(hit.record.anchor, anchor)) {
      const refreshed: ConceptKeyRecord = { ...hit.record, anchor };
      await vault.write(hit.path, serialize(refreshed));
    }
    return hit.record.key;
  }

  const key = mintKey(anchor);
  const record: ConceptKeyRecord = {
    key,
    tier,
    anchor,
    mintedAt: now(),
    schemaVersion: CONCEPT_KEY_RECORD_SCHEMA_VERSION,
  };
  await vault.write(conceptKeyRecordPath(key), serialize(record));
  return key;
}
