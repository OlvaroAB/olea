/**
 * Her correction history for a model-decided link — `[D-533]` (`ol-egov.141.89.7.71`, ruled
 * 2026-10-06, A strengthened), built under `ol-egov.141.89.7.26` (`[D-433]`); keyed on the course
 * and the objective's wording, and given her control in the grove, under `[D-537]`
 * (`ol-egov.141.89.7.79`, built under `ol-egov.141.89.7.77`).
 *
 * **What it records.** `[D-433]` lets an alignment that the per-basis gate validated count
 * directly: an objectives declaration containing a concept, or an assessment's stated scope giving
 * a concept standing. Such a link is read at read time from `[D-429]`'s alignment results
 * (`./reconcile.ts`'s `readModelDecidedContainment`) and is never written anywhere. Her correction
 * of it is the one thing that is written: a separate, append-only history per (declaration,
 * concept), here. **This module only records and reads her decisions; it never creates, writes or
 * counts a link.** An `accepted` entry is her reversal of a decline, read as "not excluded", and
 * never makes a link count where the read's own conditions do not hold.
 *
 * **The shape: `[D-097]`'s, as the concept-relation dispositions use it** (`../concept/disposition.ts`).
 * One JSON file per pair, its events `{kind, at}` oldest first, `declined` or `accepted`
 * (`[D-097]`'s own words; `expired` is not used here, so a file carrying it is a newer build's and is
 * read as unreadable). Append-only: nothing earlier is rewritten or removed, the latest event
 * decides, and an immediately repeated decision writes nothing. The folder is its own, never the
 * near-match record's (`[D-256]`, whose states are final) nor the scope-reading log (`[D-429]`, the
 * model's readings): `[D-533]` rejected both homes.
 *
 * **The declaration identity it is keyed on, so a rejection persists across unrelated edits.**
 * - *Objectives*: the course plus `[D-477]`'s wording key — the record's `source.labelDigest`, or
 *   the digest of its stored label for a record minted before that field, exactly as
 *   `./source-identity.ts` reads it. **Never the document's path** (`[D-537]`: her choice holds
 *   when the document is renamed or moved, so a rename is an unrelated edit) **and never the
 *   outcome's id**: `[D-477]` matches a re-extracted outcome only on the same unit, so an unrelated
 *   edit that moves a declaration to another unit (a page or paragraph inserted before it) mints a
 *   new outcome record with a new id. Its wording key is unchanged, so her rejection still applies.
 *   A record never refreshes its wording key on a near match (`./store.ts`), so one record always
 *   has one key. Wording changed beyond `[D-477]`'s near rule mints a new outcome with a new key:
 *   new evidence, as `[D-533]` part 3 says. One wording stated twice in a course (two units, or two
 *   objectives documents of the course) shares one history: one judgement about one wording and one
 *   concept in one course. Another course is another history, because she judges it there.
 * - *Stated scope*: the assessment's scope key — `ScopeSourceRef.sourcePath` for a `stated-scope`
 *   reading, which the scope-reading store keeps apart from the digest of the scope's text
 *   (`revisionDigest`), so an edit of her stated scope keeps the key. Standing is per assessment,
 *   so the declaration is the assessment's stated scope as a whole.
 *
 * **The file name is opaque**: the SHA-256 hex of the canonical JSON of `{conceptKey, declaration}`.
 * Paths and wording digests stay inside the file, in Olea's own layer (INV-6: `.olea/` is not her
 * authored notes). A pair's file is found by computing its name, never by listing the folder, so a
 * host that cannot list a dot folder still reads every decision. The folder is registered with the
 * F7.4 export and full delete (`packages/plugin/src/privacy/log-discovery.ts`), as `[D-533]`
 * requires.
 *
 * **Failing closed.** A file that does not read as a history (torn, or a newer build's shape) is
 * never written over (`../vault/store-record.ts`, T12) and, at read time, excludes its pair: a
 * rejection inside it must never be lost by reading the file as absent. A file at a pair's path
 * that names another pair is read the same way, never as this pair's.
 *
 * **The earlier path-keyed shape (`[D-537]`).** Schema version 1 keyed an objectives declaration on
 * the document's path. The key changed to the course before any history existed in her vault
 * (nothing is installed yet), so nothing is migrated. A history in that shape is unreadable to this
 * build, by its schema version and by its declaration's fields, so it fails closed rather than
 * being matched to a pair it was not written for.
 *
 * **Concept identity (`[D-378]`).** A decision recorded under a superseded duplicate key and one
 * under the canonical key are one concept's history: `isCorrectedAway` reads every key of the
 * identity, and the latest event across them decides (the canonical key's history wins a
 * same-instant tie), as `../concept/disposition.ts` reads its logs.
 *
 * D-005: nothing here logs; the files hold opaque keys, a vault path and a one-way digest.
 */

import type { ConceptKeyCanonicalIndex } from '../concept/key-store.js';
import { hashText } from '../ingestion/hash.js';
import { withPathQueue } from '../vault/path-queue.js';
import {
  readStoreRecord,
  readStoreRecordForWrite,
  type StoreRecordRead,
} from '../vault/store-record.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { canonicalJson } from './canonical-json.js';
import { outcomeLabelDigest } from './source-identity.js';
import type { OutcomeRecord } from './types.js';

/** The vault folder this module owns (`[D-533]`). */
export const OUTCOME_CONTAINMENT_CORRECTION_FOLDER: VaultPath =
  '.olea/outcome-containment-corrections';

/**
 * Bumped only on a breaking change to the stored shape. A file with any other value is unreadable
 * to this build. 2: an objectives declaration is keyed on the course, not the document's path
 * (`[D-537]`, module doc).
 */
export const OUTCOME_CONTAINMENT_CORRECTION_SCHEMA_VERSION = 2;

/** The declaration a correction is about — see the module doc for why each kind is keyed so. */
export type ContainmentDeclaration =
  | {
      readonly kind: 'objectives';
      /** The course she judged the placement in (`[D-537]`): never the document's path. */
      readonly courseId: string;
      /** `[D-477]`'s wording key: `v1:` plus the SHA-256 hex of the normalised wording. */
      readonly wordingKey: string;
    }
  | {
      readonly kind: 'stated-scope';
      /** The assessment's scope key (`ScopeSourceRef.sourcePath` of a `stated-scope` reading). */
      readonly scopeKey: string;
    };

/** `[D-097]`'s words, two of its three (module doc). */
export type ContainmentCorrectionKind = 'declined' | 'accepted';

export interface ContainmentCorrectionEvent {
  readonly kind: ContainmentCorrectionKind;
  readonly at: string;
}

/** One (declaration, concept) pair's full history, append-only, oldest first. */
export interface ContainmentCorrectionLog {
  readonly declaration: ContainmentDeclaration;
  /** The concept's opaque key as it was given when the history began. */
  readonly conceptKey: string;
  readonly events: readonly ContainmentCorrectionEvent[];
  readonly schemaVersion: number;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** True when `value` has exactly these own keys: a declaration is an identity, so one field more is another one. */
function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function isDeclaration(value: unknown): value is ContainmentDeclaration {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'objectives')
    return (
      hasExactly(v, ['kind', 'courseId', 'wordingKey']) &&
      isNonEmptyString(v.courseId) &&
      isNonEmptyString(v.wordingKey)
    );
  if (v.kind === 'stated-scope')
    return hasExactly(v, ['kind', 'scopeKey']) && isNonEmptyString(v.scopeKey);
  return false;
}

function isEvent(value: unknown): value is ContainmentCorrectionEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.kind === 'declined' || v.kind === 'accepted') && isNonEmptyString(v.at);
}

export function isContainmentCorrectionLog(value: unknown): value is ContainmentCorrectionLog {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isDeclaration(v.declaration) &&
    isNonEmptyString(v.conceptKey) &&
    Array.isArray(v.events) &&
    v.events.length > 0 &&
    v.events.every(isEvent) &&
    v.schemaVersion === OUTCOME_CONTAINMENT_CORRECTION_SCHEMA_VERSION
  );
}

/**
 * The declaration identity of an objectives outcome read for `courseId` (module doc): the course and
 * `[D-477]`'s wording key, never the document's path and never the outcome's id.
 */
export async function objectivesDeclarationOf(
  outcome: Pick<OutcomeRecord, 'source' | 'label'>,
  courseId: string,
): Promise<ContainmentDeclaration> {
  return {
    kind: 'objectives',
    courseId,
    wordingKey: outcome.source.labelDigest ?? (await outcomeLabelDigest(outcome.label)),
  };
}

/** The declaration identity of an assessment's stated scope (module doc). */
export function statedScopeDeclarationOf(scopeKey: string): ContainmentDeclaration {
  return { kind: 'stated-scope', scopeKey };
}

/** One file per pair, named by the SHA-256 hex of `{conceptKey, declaration}`'s canonical JSON. */
export async function containmentCorrectionPath(
  declaration: ContainmentDeclaration,
  conceptKey: string,
): Promise<VaultPath> {
  const name = await hashText(canonicalJson({ conceptKey, declaration }));
  return `${OUTCOME_CONTAINMENT_CORRECTION_FOLDER}/${name}.json`;
}

/**
 * A history this build reads AND that names the pair asked for: a file at a pair's path that names
 * another pair (or the earlier path-keyed shape) is unreadable, never read as this pair's.
 */
function isHistoryOf(
  declaration: ContainmentDeclaration,
  conceptKey: string,
): (value: unknown) => value is ContainmentCorrectionLog {
  const wanted = canonicalJson({ conceptKey, declaration });
  return (value: unknown): value is ContainmentCorrectionLog =>
    isContainmentCorrectionLog(value) &&
    canonicalJson({ conceptKey: value.conceptKey, declaration: value.declaration }) === wanted;
}

function serialize(log: ContainmentCorrectionLog): string {
  return `${JSON.stringify(log, null, 2)}\n`;
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Appends her decision to the pair's history, creating it on the first. Never rewrites or drops an
 * earlier event; the same kind as the latest event writes nothing. A file this build cannot read
 * throws `UnreadableStoreRecordError` and is left as it is. The read and the write are one task on
 * the file's queue, so two overlapping decisions both land, in the order made.
 *
 * Her control in the grove is its only production caller (`[D-537]`; plugin `grove/provider.ts`).
 */
export async function recordContainmentCorrection(
  vault: VaultSource,
  declaration: ContainmentDeclaration,
  conceptKey: string,
  kind: ContainmentCorrectionKind,
  options: { readonly now?: () => string } = {},
): Promise<ContainmentCorrectionLog> {
  const now = options.now ?? defaultNow;
  const path = await containmentCorrectionPath(declaration, conceptKey);
  return withPathQueue(path, async () => {
    const existing = await readStoreRecordForWrite(
      vault,
      path,
      isHistoryOf(declaration, conceptKey),
    );
    const events = existing?.events ?? [];
    if (existing !== undefined && events[events.length - 1]?.kind === kind) return existing;
    const log: ContainmentCorrectionLog = {
      declaration,
      conceptKey,
      events: [...events, { kind, at: now() }],
      schemaVersion: OUTCOME_CONTAINMENT_CORRECTION_SCHEMA_VERSION,
    };
    await vault.write(path, serialize(log));
    return log;
  });
}

/** The pair's history as stored: absent, unreadable (bytes untouched), or the history. */
export async function readContainmentCorrection(
  vault: VaultSource,
  declaration: ContainmentDeclaration,
  conceptKey: string,
): Promise<StoreRecordRead<ContainmentCorrectionLog>> {
  return readStoreRecord(
    vault,
    await containmentCorrectionPath(declaration, conceptKey),
    isHistoryOf(declaration, conceptKey),
  );
}

/** The latest decision in one history, or `undefined` for none. */
export function currentContainmentCorrection(
  log: ContainmentCorrectionLog | undefined,
): ContainmentCorrectionKind | undefined {
  return log?.events[log.events.length - 1]?.kind;
}

/**
 * Her choice for one pair as the read applies it (`[D-537]`): `'none'` (no history), the latest
 * decision across every key of the concept's identity, or `'unreadable'` when any of those
 * histories cannot be read. The grove lists a `'declined'` pair for putting back, and lists an
 * `'unreadable'` one nowhere, so no control is offered for it.
 */
export type ContainmentCorrectionState = 'none' | ContainmentCorrectionKind | 'unreadable';

/**
 * The pair's state (see `ContainmentCorrectionState`): the latest event across every key of the
 * concept's identity decides, the canonical key's history winning a same-instant tie; any
 * unreadable history makes the whole pair `'unreadable'`. Reads each history by its computed
 * path, never by listing.
 */
export async function readContainmentCorrectionState(
  vault: VaultSource,
  declaration: ContainmentDeclaration,
  conceptKey: string,
  canonicalKeys: ConceptKeyCanonicalIndex,
): Promise<ContainmentCorrectionState> {
  const canonical = canonicalKeys.canonicalOf(conceptKey);
  const keys = [canonical];
  for (const [duplicate, owner] of canonicalKeys.superseded) {
    if (owner === canonical && duplicate !== canonical) keys.push(duplicate);
  }
  let latest: { readonly event: ContainmentCorrectionEvent; readonly own: boolean } | undefined;
  for (const key of keys) {
    const read = await readContainmentCorrection(vault, declaration, key);
    if (read.kind === 'unreadable') return 'unreadable';
    if (read.kind === 'absent') continue;
    const event = read.record.events[read.record.events.length - 1];
    if (event === undefined) continue;
    const own = key === canonical;
    if (
      latest === undefined ||
      event.at > latest.event.at ||
      (event.at === latest.event.at && own && !latest.own)
    ) {
      latest = { event, own };
    }
  }
  return latest?.event.kind ?? 'none';
}

/**
 * True when her decision removes the pair at read time: the latest event across every key of the
 * concept's identity is `declined`, or any of those histories is unreadable (failing closed: a
 * rejection inside it is never lost). No history at all, or a latest `accepted`, is false.
 */
export async function isCorrectedAway(
  vault: VaultSource,
  declaration: ContainmentDeclaration,
  conceptKey: string,
  canonicalKeys: ConceptKeyCanonicalIndex,
): Promise<boolean> {
  const state = await readContainmentCorrectionState(vault, declaration, conceptKey, canonicalKeys);
  return state === 'declined' || state === 'unreadable';
}
