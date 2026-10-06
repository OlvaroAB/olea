/**
 * The `OutcomeRecord` sidecar — the vault record writer named by the design brief, following
 * `../concept/key-store.ts`'s already-ratified shape (`[D-174]`) rather than inventing a second
 * persistence pattern for a second node type. One small file per outcome, under a dot-prefixed
 * Olea folder, written and read through the injected `VaultSource` port — never into her authored
 * notes (INV-6 Part one has no carve-out for that; `.olea/` is Olea's own layer, so Part one has
 * nothing to say about it, mirroring `key-store.ts`'s own argument).
 *
 * **Mint vs. lookup, the same conservation shape `[D-088]` gives concept keys.**
 * `resolveOutcomes` (and `resolveOutcome`, a batch of one) is the single mint-or-lookup seam:
 * given one extraction's candidates, it looks up the existing record each one is and returns it
 * verbatim, or mints a new one — via `../outcome/events.ts`'s `OutcomeCreatedEvent` folded through
 * `./project.ts`'s `applyOutcomeEvent` — and persists it. **Read-back is matching, never
 * minting**: a re-extraction over the same objectives passage resolves to the same Outcomes
 * rather than duplicating them, the identical shape `resolveConceptKey` already holds for concepts.
 *
 * **Which record a candidate is (`[D-477]`).** One block (a PDF page) often states several
 * outcomes, so a record is identified by its block AND its own wording: each new record carries
 * `source.labelDigest`, and a candidate matches a record on its block with the same normalised
 * wording, or failing that one near it, one to one. Records minted before that field existed are
 * matched on their block and their stored label, never rewritten. The rule, its threshold and why
 * there is no positional fallback: `./source-identity.ts`'s module doc.
 *
 * **The version stamp, and retiring on revision (`[D-531]`, `ol-egov.141.89.7.68`).** A caller that
 * knows which version of the document a delivery was read from passes it as `options.revision`
 * (`./retire-on-revision.ts`'s `planOutcomeDelivery` decides what it may be): every record minted
 * is stamped with it (`OutcomeRecord.statedInRevision`), and an open delivery — the document's
 * current version, not yet read in full — also restamps each matched record stamped otherwise, and
 * reinstates a matched record that was retired (`[D-272]`). A reread or an unplaced delivery leaves
 * matched records exactly as they are. Once the current version has been read in full,
 * `retireOutcomesOnRevision` retires each active outcome on the document that the version did not
 * state, through `retireOutcome`. Both run as tasks on the folder's queue key, so a retire pass
 * never interleaves with a find-or-mint.
 *
 * **One find-or-mint at a time (`ol-egov.141.89.104.53`, race 1).** Listing the folder and minting
 * a new file span more than one file, so no record file's queue covers them: `resolveOutcomes`
 * runs its whole list, match and mint as one task on the folder's own queue key, taking each new
 * record file's key inside it (`../vault/path-queue.ts`'s set-key order). Overlapping calls
 * therefore run one after the other, in the order they were made, and give the records that order
 * gives.
 *
 * **Opaque id, same C7.11-shaped argument as `ol-bo48`.** `mintOpaqueOutcomeId` mints a random
 * nonce (`crypto.randomUUID()` by default), never a transform of `label`, `source` or `courses` —
 * an Outcome's identity must survive the examiner rewording the objective or restructuring the
 * document the same way a concept's identity must survive her renaming a note.
 *
 * **Attach and retire are key-driven, not anchor-driven** — the same distinction
 * `key-store.ts`'s module doc draws between `resolveConceptKey` (anchor-match) and
 * `bindConceptKeyToNote` (key-driven rebind): a caller that already holds an `outcomeId`
 * (typically because it just resolved or was handed one) calls `attachConceptToOutcome` or
 * `retireOutcome` directly, by id, never by re-deriving a source match.
 *
 * **Concept keys read through the canonical-key index (`[D-378]`, `ol-egov.141.89.9.56`).** An
 * outcome's `conceptKeys` are historical references: a key attached before two same-anchor concept
 * records were read as one identity may be the superseded duplicate's. `listOutcomeRecords`, the
 * reader every consumer goes through, resolves each through `../concept/key-store.ts`'s
 * canonical-key index (duplicates collapsing onto one canonical key, first occurrence kept), and
 * `attachConceptToOutcome` treats an identity already attached under any of its keys as attached
 * and writes a fresh attachment under the canonical key. **Nothing already written is rewritten**:
 * a stored record keeps the key it was written with, and the writers here read records as stored
 * (`listStoredOutcomeRecords`) so a write never carries a resolved view back to disk. A shared
 * introducing passage alone never makes two concepts one identity, so it never collapses two keys.
 */

import {
  type ConceptKeyCanonicalIndex,
  readConceptKeyCanonicalIndex,
} from '../concept/key-store.js';
import { listFolder } from '../vault/list-folder.js';
import { withPathQueue } from '../vault/path-queue.js';
import { readStoreRecord } from '../vault/store-record.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { OutcomeEvent } from './events.js';
import { applyOutcomeEvent } from './project.js';
import {
  isRetiredByRevision,
  type OutcomeDeliveryRevision,
  type OutcomeRevisionPages,
  outcomeRevisionReadInFull,
} from './retire-on-revision.js';
import {
  matchOutcomeCandidates,
  outcomeLabelDigest,
  outcomeSourceBlockKey,
} from './source-identity.js';
import {
  OUTCOME_STATUSES,
  type OutcomeProvenance,
  type OutcomeRecord,
  type OutcomeSourceReference,
  type OutcomeStatus,
} from './types.js';

/** The vault folder this module owns. Dot-prefixed, sibling to `.olea/concepts/`, `.olea/reviews/` and `.olea/misconceptions/`. */
export const OUTCOME_STORE_FOLDER: VaultPath = '.olea/outcomes';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isOutcomeSourceReference(value: unknown): value is OutcomeSourceReference {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.path) || typeof v.blockIndex !== 'number') return false;
  // `[D-477]`: optional, so a record minted before the field existed stays valid; only a PRESENT
  // value that is not a non-empty string is rejected.
  return v.labelDigest === undefined || isNonEmptyString(v.labelDigest);
}

function isOutcomeProvenance(value: unknown): value is OutcomeProvenance {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isNonEmptyString(v.promptVersion) && isNonEmptyString(v.modelVersion);
}

function isOutcomeStatus(value: unknown): value is OutcomeStatus {
  return typeof value === 'string' && (OUTCOME_STATUSES as readonly string[]).includes(value);
}

/** Runtime validation, matching `../concept/key-store.ts`'s hand-rolled-guard style (no schema library in this package). */
export function isOutcomeRecord(value: unknown): value is OutcomeRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.id)) return false;
  if (!isStringArray(v.courses)) return false;
  if (!isOutcomeSourceReference(v.source)) return false;
  if (typeof v.label !== 'string') return false;
  if (!isStringArray(v.conceptKeys)) return false;
  if (!isOutcomeStatus(v.status)) return false;
  if (!isOutcomeProvenance(v.provenance)) return false;
  // `[D-253]`'s ratifying amendment: optional, so ABSENT is valid (an older record minted
  // before this field existed, or a caller that supplied none) — only a PRESENT value that
  // fails the type check is rejected.
  if (v.extractorSelfRating !== undefined && typeof v.extractorSelfRating !== 'number') {
    return false;
  }
  // `[D-531]`: optional, so ABSENT is valid; a PRESENT stamp must be a non-empty string.
  if (v.statedInRevision !== undefined && !isNonEmptyString(v.statedInRevision)) return false;
  if (!isNonEmptyString(v.mintedAt)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

/**
 * The vault path for one outcome's record. `encodeURIComponent`, the same injective, total
 * choice `../concept/key-store.ts`'s `conceptKeyRecordPath` makes and for the same reason: the
 * id is opaque by construction (see `mintOpaqueOutcomeId` below) so nothing here needs to shard
 * or hash it, but the naming function is still the one and only place that assembles a path.
 */
export function outcomeRecordPath(id: string): VaultPath {
  return `${OUTCOME_STORE_FOLDER}/${encodeURIComponent(id)}.json`;
}

export interface ListOutcomeRecordsOptions {
  /**
   * `[D-378]`: the canonical-key index each attached concept key is resolved through (module doc).
   * Read from the vault's `.olea/concepts/` store when omitted; a caller already holding one for
   * this pass passes it to save a second listing.
   */
  readonly canonicalKeys?: ConceptKeyCanonicalIndex;
}

/**
 * `record` with each attached concept key resolved to its canonical key, a duplicate that resolves
 * to a key already listed dropped (first occurrence kept, attachment order otherwise unchanged).
 * The same object when nothing changes.
 */
function outcomeRecordThroughCanonicalKeys(
  record: OutcomeRecord,
  canonicalKeys: ConceptKeyCanonicalIndex,
): OutcomeRecord {
  const conceptKeys = [...new Set(record.conceptKeys.map((key) => canonicalKeys.canonicalOf(key)))];
  const unchanged =
    conceptKeys.length === record.conceptKeys.length &&
    conceptKeys.every((key, index) => key === record.conceptKeys[index]);
  return unchanged ? record : { ...record, conceptKeys };
}

/**
 * Every valid `OutcomeRecord` currently under `.olea/outcomes/`, alongside its path, with each
 * attached concept key read through the canonical-key index (module doc) — so an outcome that
 * parents a superseded duplicate reads as parenting its canonical key. `path` still names the file
 * as stored; this is a read, and nothing here writes. A file that fails to parse or fails
 * validation is skipped rather than thrown on — the same referential-integrity posture
 * `../concept/key-store.ts`'s `listConceptKeyRecords` and `../misconception`'s content-store reader
 * both take, because one corrupt sidecar file must never take down a read of every other outcome.
 */
export async function listOutcomeRecords(
  vault: VaultSource,
  options: ListOutcomeRecordsOptions = {},
): Promise<readonly { readonly path: VaultPath; readonly record: OutcomeRecord }[]> {
  const stored = await listStoredOutcomeRecords(vault);
  const canonicalKeys = options.canonicalKeys ?? (await readConceptKeyCanonicalIndex(vault));
  return stored.map(({ path, record }) => ({
    path,
    record: outcomeRecordThroughCanonicalKeys(record, canonicalKeys),
  }));
}

/**
 * The records exactly as stored — the listing this module's writers read before they write, so a
 * write never carries `listOutcomeRecords`' resolved view back to disk (module doc).
 */
async function listStoredOutcomeRecords(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly record: OutcomeRecord }[]> {
  // `listFolder`, not `vault.list`: `ObsidianSource.list()` never sees a dot folder (`ol-egov.141.89.10.52`).
  const paths = await listFolder(vault, OUTCOME_STORE_FOLDER, { extensions: ['json'] });
  const out: { readonly path: VaultPath; readonly record: OutcomeRecord }[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isOutcomeRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable file: skipped, never thrown — see the doc above.
    }
  }
  return out;
}

/**
 * Runs `update` on the current copy of outcome `outcomeId`'s record, as one task on its file's
 * queue (`../vault/path-queue.ts`, `ol-egov.141.89.104.2`): the listing finds the file, and the
 * record is read again inside the queue before anything is decided, so two overlapping
 * attachments, or an attachment and a retirement, both land rather than the later one writing back
 * a copy that lacks the earlier one. `missing` is thrown when no record for the id is there, or the
 * one found no longer reads as a record.
 */
async function updateStoredOutcome<T>(
  vault: VaultSource,
  outcomeId: string,
  missing: () => Error,
  update: (hit: { readonly path: VaultPath; readonly record: OutcomeRecord }) => Promise<T>,
): Promise<T> {
  const located = (await listStoredOutcomeRecords(vault)).find(
    ({ record }) => record.id === outcomeId,
  );
  if (located === undefined) throw missing();
  return withPathQueue(located.path, async () => {
    const fresh = await readStoreRecord(vault, located.path, isOutcomeRecord);
    if (fresh.kind !== 'record' || fresh.record.id !== outcomeId) throw missing();
    return update({ path: located.path, record: fresh.record });
  });
}

/** A source of randomness for `mintOpaqueOutcomeId`. Injectable for deterministic tests, the same shape `../concept/concept-key.ts`'s `OpaqueKeyNonceSource` already uses. */
export type OpaqueIdNonceSource = () => string;

function defaultOpaqueIdNonceSource(): string {
  return globalThis.crypto.randomUUID();
}

/** Marks every id minted by this module — greppable, and distinct from `../concept/concept-key.ts`'s `OPAQUE_CONCEPT_KEY_PREFIX` so an id's node type is visible from the string alone. */
export const OPAQUE_OUTCOME_ID_PREFIX = 'outcome-key1';

/**
 * Mints a durable, opaque outcome id: a random nonce, never a transform of `label`, `source` or
 * `courses`. See the module doc for why this is the same C7.11-shaped argument `ol-bo48` makes
 * for concept identity, applied to the sibling node type `[ONT-R5]` named.
 */
export function mintOpaqueOutcomeId(
  nonceSource: OpaqueIdNonceSource = defaultOpaqueIdNonceSource,
): string {
  return `${OPAQUE_OUTCOME_ID_PREFIX}:${nonceSource()}`;
}

function serialize(record: OutcomeRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export interface ResolveOutcomeInput {
  readonly courses: readonly string[];
  /** Where the outcome was found. Only `path` and `blockIndex` are read: `labelDigest` is computed here from `label`, never taken from a caller (`./types.ts`). */
  readonly source: OutcomeSourceReference;
  readonly label: string;
  readonly provenance: OutcomeProvenance;
  /** `[D-253]`'s ratifying amendment — see `../outcome/types.ts`'s `OutcomeRecord.extractorSelfRating` doc. Threaded through only on the genuine-mint path (below); a candidate that matches an existing record gets that record back verbatim, per this seam's conservation rule, so a re-extraction never overwrites an already-stored self-rating with a fresh one. */
  readonly extractorSelfRating?: number;
}

export interface ResolveOutcomeOptions {
  /** Injectable for deterministic tests. Defaults to `new Date().toISOString().slice(0, 10)`. */
  readonly now?: () => string;
  /** Injectable nonce source for `mintOpaqueOutcomeId`. Defaults to `crypto.randomUUID()`. */
  readonly generateId?: OpaqueIdNonceSource;
  /**
   * `[D-531]`: the version of the document this delivery was read from, and whether it restates
   * (module doc). Omitted when the delivery's version is unknown: then records are minted with no
   * stamp and matched records are left as they are, as before the rule.
   */
  readonly revision?: OutcomeDeliveryRevision;
}

function defaultNow(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The single mint-or-lookup seam (module doc): resolves one extraction's outcome candidates to
 * `OutcomeRecord`s, one per input and in input order. Each candidate gets the existing record it
 * is under `./source-identity.ts`'s rule (same block, then same normalised wording, then a near
 * wording, one to one), read back verbatim; candidates that match none mint new records, one per
 * distinct wording on a block, each carrying `source.labelDigest`. **Never mints a second record
 * for a wording a record on that block already has**, and changes an existing record only in its
 * version stamp and status, and only for an open delivery (`[D-531]`, below).
 *
 * A match refreshes nothing of what was read on the existing record (unlike `resolveConceptKey`'s
 * anchor-drift refresh): its label, self-rating and digest stay as first minted. With
 * `options.revision` restating (an open delivery, `[D-531]`), a match moves the record's version
 * stamp to that version, and a retired match is reinstated; the record returned is then the one
 * written. Wording that has changed beyond the near rule is a different outcome and mints a new
 * record; the record it may have replaced is left as it is — retiring it is
 * `retireOutcomesOnRevision`'s call, once the version has been read in full.
 *
 * **Resolve one extraction's candidates in one call.** Only records stored before the call can be
 * claimed by a near wording, so two wordings from one extraction never fold onto one record. The
 * whole call is one task on the outcome folder's queue key (module doc), so overlapping calls run
 * one after the other.
 */
export async function resolveOutcomes(
  vault: VaultSource,
  inputs: readonly ResolveOutcomeInput[],
  options: ResolveOutcomeOptions = {},
): Promise<readonly OutcomeRecord[]> {
  if (inputs.length === 0) return [];
  const now = options.now ?? defaultNow;

  // Queued before anything is awaited, so overlapping calls run in the order they were made.
  return withPathQueue(OUTCOME_STORE_FOLDER, async () => {
    const digests = await Promise.all(inputs.map((input) => outcomeLabelDigest(input.label)));
    const candidates = inputs.map((input, index) => ({
      source: { path: input.source.path, blockIndex: input.source.blockIndex },
      label: input.label,
      digest: digests[index] as string,
    }));
    const blocks = new Set(candidates.map(({ source }) => outcomeSourceBlockKey(source)));
    const stored = (await listStoredOutcomeRecords(vault)).filter(({ record }) =>
      blocks.has(outcomeSourceBlockKey(record.source)),
    );
    const pathOf = new Map(stored.map(({ path, record }) => [record, path] as const));
    const keyed = await Promise.all(
      stored.map(async ({ record }) => ({
        record,
        key: record.source.labelDigest ?? (await outcomeLabelDigest(record.label)),
      })),
    );

    const resolved: OutcomeRecord[] = [];
    for (const group of matchOutcomeCandidates(keyed, candidates)) {
      const [firstIndex] = group.members;
      const first = firstIndex === undefined ? undefined : inputs[firstIndex];
      const digest = firstIndex === undefined ? undefined : candidates[firstIndex]?.digest;
      if (first === undefined || digest === undefined) continue;
      // A group mints once, from its first candidate: every member shares one normalised wording.
      const matched = group.match?.record;
      const record =
        matched === undefined
          ? await mintOutcome(vault, first, digest, now, options.generateId, options.revision)
          : await restateMatched(vault, matched, pathOf.get(matched), now, options.revision);
      for (const index of group.members) resolved[index] = record;
    }
    return resolved;
  });
}

/**
 * `resolveOutcomes` for one candidate — a batch of one, on the same queue. **A caller resolving
 * one extraction's several candidates calls `resolveOutcomes` once instead**: resolved one call at
 * a time, a later candidate could take, by a near wording, a record an earlier candidate of the
 * same extraction has just minted.
 */
export async function resolveOutcome(
  vault: VaultSource,
  input: ResolveOutcomeInput,
  options: ResolveOutcomeOptions = {},
): Promise<OutcomeRecord> {
  const [record] = await resolveOutcomes(vault, [input], options);
  // One input always resolves to one record (`resolveOutcomes`' own contract); the guard keeps
  // the return type honest.
  if (record === undefined) throw new Error('resolveOutcome: no record resolved for one input');
  return record;
}

/**
 * `[D-531]`: a matched record as an open delivery of `revision.digest` leaves it — reinstated when
 * retired, restamped when stamped otherwise — written on its own file's queue after reading it
 * again. Returned as it stands when the delivery does not restate, or nothing changes.
 */
async function restateMatched(
  vault: VaultSource,
  matched: OutcomeRecord,
  path: VaultPath | undefined,
  now: () => string,
  revision: OutcomeDeliveryRevision | undefined,
): Promise<OutcomeRecord> {
  if (revision === undefined || !revision.restates || path === undefined) return matched;
  if (matched.status === 'active' && matched.statedInRevision === revision.digest) return matched;
  return withPathQueue(path, async () => {
    const fresh = await readStoreRecord(vault, path, isOutcomeRecord);
    if (fresh.kind !== 'record' || fresh.record.id !== matched.id) return matched;
    const event: OutcomeEvent = {
      kind: fresh.record.status === 'retired' ? 'reinstated' : 'restated',
      schemaVersion: 1,
      eventId: globalThis.crypto.randomUUID(),
      timestamp: now(),
      outcomeId: matched.id,
      revisionDigest: revision.digest,
    };
    const updated = applyOutcomeEvent(fresh.record, event);
    if (updated === undefined || updated === fresh.record) return fresh.record;
    await vault.write(path, serialize(updated));
    return updated;
  });
}

/** Mints and persists one record for `input`, its source carrying `labelDigest`, stamped with `revision.digest` when given. Runs inside `resolveOutcomes`' folder task. */
async function mintOutcome(
  vault: VaultSource,
  input: ResolveOutcomeInput,
  labelDigest: string,
  now: () => string,
  generateId: OpaqueIdNonceSource | undefined,
  revision: OutcomeDeliveryRevision | undefined,
): Promise<OutcomeRecord> {
  const id = mintOpaqueOutcomeId(generateId);
  const event: OutcomeEvent = {
    kind: 'created',
    schemaVersion: 1,
    eventId: globalThis.crypto.randomUUID(),
    timestamp: now(),
    outcomeId: id,
    courses: input.courses,
    source: { path: input.source.path, blockIndex: input.source.blockIndex, labelDigest },
    label: input.label,
    provenance: input.provenance,
    ...(input.extractorSelfRating !== undefined
      ? { extractorSelfRating: input.extractorSelfRating }
      : {}),
    ...(revision !== undefined ? { statedInRevision: revision.digest } : {}),
  };
  const record = applyOutcomeEvent(undefined, event);
  // `applyOutcomeEvent` always returns a record for a `created` event — see its doc — so this
  // is unreachable, not a real runtime possibility; the guard just keeps the return type honest.
  if (record === undefined) {
    throw new Error('resolveOutcomes: applyOutcomeEvent returned undefined for a created event');
  }
  const path = outcomeRecordPath(record.id);
  await withPathQueue(path, () => vault.write(path, serialize(record)));
  return record;
}

/**
 * Records the outcome→concept containment edge (component register row 1.1b). Key-driven, not
 * anchor-driven (module doc): the caller already holds `outcomeId`, typically from
 * `resolveOutcome`. Idempotent — attaching the same `conceptKey` twice writes nothing the second
 * time. **Never mints**: an `outcomeId` with no existing record is a caller error, and this
 * function throws rather than silently creating one, mirroring
 * `../concept/key-store.ts`'s `bindConceptKeyToNote`.
 *
 * **By identity (`[D-378]`, module doc).** An identity already attached under any of its keys — a
 * superseded duplicate's included — counts as attached, and writes nothing; a fresh attachment is
 * written under the canonical key. Keys already stored are never rewritten, and the record returned
 * is `listOutcomeRecords`' resolved view of it. `canonicalKeys` is read from the vault's
 * `.olea/concepts/` store when omitted.
 */
export async function attachConceptToOutcome(
  vault: VaultSource,
  outcomeId: string,
  conceptKey: string,
  options: Pick<ResolveOutcomeOptions, 'now'> & ListOutcomeRecordsOptions = {},
): Promise<OutcomeRecord> {
  const now = options.now ?? defaultNow;
  const canonicalKeys = options.canonicalKeys ?? (await readConceptKeyCanonicalIndex(vault));
  const missing = () =>
    new Error(
      `attachConceptToOutcome: no existing OutcomeRecord for id "${outcomeId}" — this function ` +
        'attaches to an existing record and never mints one (see the module doc).',
    );
  return updateStoredOutcome(vault, outcomeId, missing, async (hit) => {
    const canonicalKey = canonicalKeys.canonicalOf(conceptKey);
    const alreadyAttached = hit.record.conceptKeys.some(
      (key) => canonicalKeys.canonicalOf(key) === canonicalKey,
    );
    if (alreadyAttached) return outcomeRecordThroughCanonicalKeys(hit.record, canonicalKeys);

    const event: OutcomeEvent = {
      kind: 'concept-attached',
      schemaVersion: 1,
      eventId: globalThis.crypto.randomUUID(),
      timestamp: now(),
      outcomeId,
      conceptKey: canonicalKey,
    };
    const updated = applyOutcomeEvent(hit.record, event);
    if (updated === undefined || updated === hit.record) {
      return outcomeRecordThroughCanonicalKeys(hit.record, canonicalKeys);
    }
    await vault.write(hit.path, serialize(updated));
    return outcomeRecordThroughCanonicalKeys(updated, canonicalKeys);
  });
}

/**
 * F8.5's pruning-is-withdrawal pattern: moves an outcome to `'retired'` without deleting its
 * record. Idempotent — retiring an already-retired outcome writes nothing. **Never mints**, same
 * argument as `attachConceptToOutcome`.
 */
export async function retireOutcome(
  vault: VaultSource,
  outcomeId: string,
  options: Pick<ResolveOutcomeOptions, 'now'> = {},
): Promise<OutcomeRecord> {
  const now = options.now ?? defaultNow;
  const missing = () =>
    new Error(
      `retireOutcome: no existing OutcomeRecord for id "${outcomeId}" — this function retires ` +
        'an existing record and never mints one (see the module doc).',
    );
  return updateStoredOutcome(vault, outcomeId, missing, async (hit) => {
    const event: OutcomeEvent = {
      kind: 'retired',
      schemaVersion: 1,
      eventId: globalThis.crypto.randomUUID(),
      timestamp: now(),
      outcomeId,
    };
    const updated = applyOutcomeEvent(hit.record, event);
    if (updated === undefined || updated === hit.record) return hit.record;
    await vault.write(hit.path, serialize(updated));
    return updated;
  });
}

export interface RetireOutcomesOnRevisionOptions {
  /** Injectable for deterministic tests. Defaults to `new Date().toISOString().slice(0, 10)`. */
  readonly now?: () => string;
}

/**
 * The retire pass (`[D-531]`, `ol-egov.141.89.7.68`): once `revision` — the document's current
 * version, as its page record holds it — has been read in full (`./retire-on-revision.ts`'s
 * `outcomeRevisionReadInFull`), retires each active outcome on that document stamped with another
 * version the page record has listed, through `retireOutcome`. Records are kept, never deleted, and
 * no reason is stored. Returns the records it retired, in id order.
 *
 * **Refuses, and writes nothing, while the version is not read in full**: the completeness rule is
 * enforced here, at the store, so no caller can retire on a partial reading. Idempotent: run again
 * for the same version (a reread, a reload, a crash between the last page and this pass), it
 * retires only what is still due, which after its first run is nothing. One task on the outcome
 * folder's queue key, so it never interleaves with `resolveOutcomes`.
 */
export async function retireOutcomesOnRevision(
  vault: VaultSource,
  revision: OutcomeRevisionPages,
  options: RetireOutcomesOnRevisionOptions = {},
): Promise<readonly OutcomeRecord[]> {
  if (!outcomeRevisionReadInFull(revision)) return [];
  return withPathQueue(OUTCOME_STORE_FOLDER, async () => {
    const due = (await listStoredOutcomeRecords(vault))
      .map(({ record }) => record)
      .filter((record) => isRetiredByRevision(record, revision))
      .map((record) => record.id)
      .sort();
    const retireOptions = options.now === undefined ? {} : { now: options.now };
    const retired: OutcomeRecord[] = [];
    for (const id of due) retired.push(await retireOutcome(vault, id, retireOptions));
    return retired;
  });
}
