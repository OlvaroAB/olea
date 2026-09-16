/**
 * The `OutcomeRecord` sidecar — the vault record writer named by the design brief, following
 * `../concept/key-store.ts`'s already-ratified shape (`[D-174]`) rather than inventing a second
 * persistence pattern for a second node type. One small file per outcome, under a dot-prefixed
 * Olea folder, written and read through the injected `VaultSource` port — never into her authored
 * notes (INV-6 Part one has no carve-out for that; `.olea/` is Olea's own layer, so Part one has
 * nothing to say about it, mirroring `key-store.ts`'s own argument).
 *
 * **Mint vs. lookup, the same conservation shape `[D-088]` gives concept keys.**
 * `resolveOutcome` is the single mint-or-lookup seam: given a source reference, it looks up an
 * existing record matching that source first and returns its `id` (and record) verbatim, or
 * mints a new one — via `../outcome/events.ts`'s `OutcomeCreatedEvent` folded through
 * `./project.ts`'s `applyOutcomeEvent` — and persists it. **Read-back is matching, never
 * minting**: a re-extraction over the same objectives passage resolves to the same Outcome
 * rather than duplicating it, the identical shape `resolveConceptKey` already holds for concepts.
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
 */

import type { VaultPath, VaultSource } from '../vault/types.js';
import type { OutcomeEvent } from './events.js';
import { applyOutcomeEvent } from './project.js';
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
  return isNonEmptyString(v.path) && typeof v.blockIndex === 'number';
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

/**
 * Every valid `OutcomeRecord` currently under `.olea/outcomes/`, alongside its path. A file that
 * fails to parse or fails validation is skipped rather than thrown on — the same
 * referential-integrity posture `../concept/key-store.ts`'s `listConceptKeyRecords` and
 * `../misconception`'s content-store reader both take, because one corrupt sidecar file must
 * never take down a read of every other outcome.
 */
export async function listOutcomeRecords(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly record: OutcomeRecord }[]> {
  const paths = await vault.list({ under: OUTCOME_STORE_FOLDER, extensions: ['json'] });
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

/** True when two source references name the same passage. */
function sourceMatches(a: OutcomeSourceReference, b: OutcomeSourceReference): boolean {
  return a.path === b.path && a.blockIndex === b.blockIndex;
}

export interface ResolveOutcomeInput {
  readonly courses: readonly string[];
  readonly source: OutcomeSourceReference;
  readonly label: string;
  readonly provenance: OutcomeProvenance;
  /** `[D-253]`'s ratifying amendment — see `../outcome/types.ts`'s `OutcomeRecord.extractorSelfRating` doc. Threaded through only on the genuine-mint path (below); a source that already matches an existing record returns that record verbatim, per this function's own conservation rule, so a re-extraction never overwrites an already-stored self-rating with a fresh one. */
  readonly extractorSelfRating?: number;
}

export interface ResolveOutcomeOptions {
  /** Injectable for deterministic tests. Defaults to `new Date().toISOString().slice(0, 10)`. */
  readonly now?: () => string;
  /** Injectable nonce source for `mintOpaqueOutcomeId`. Defaults to `crypto.randomUUID()`. */
  readonly generateId?: OpaqueIdNonceSource;
}

function defaultNow(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The single mint-or-lookup seam (module doc): resolves `input.source` to an `OutcomeRecord`,
 * reading an existing one back verbatim when its source matches, minting and persisting a new
 * one otherwise. **Never mints a second record for a source that already matches one**, and
 * never mutates `id` on an existing record.
 *
 * A match refreshes nothing else on the existing record (unlike `resolveConceptKey`'s
 * anchor-drift refresh): a source reference does not drift the way a note path does on rename —
 * an objectives document's block index is stable across a re-extraction unless the document
 * itself changed, and a changed document is exactly the "recurring name is a same-as candidate
 * resolved on evidence" case `[ONT-R1]` already names for concepts, out of this seam's scope.
 */
export async function resolveOutcome(
  vault: VaultSource,
  input: ResolveOutcomeInput,
  options: ResolveOutcomeOptions = {},
): Promise<OutcomeRecord> {
  const now = options.now ?? defaultNow;
  const existing = await listOutcomeRecords(vault);
  const hit = existing.find(({ record }) => sourceMatches(record.source, input.source));
  if (hit !== undefined) return hit.record;

  const id = mintOpaqueOutcomeId(options.generateId);
  const event: OutcomeEvent = {
    kind: 'created',
    schemaVersion: 1,
    eventId: globalThis.crypto.randomUUID(),
    timestamp: now(),
    outcomeId: id,
    courses: input.courses,
    source: input.source,
    label: input.label,
    provenance: input.provenance,
    ...(input.extractorSelfRating !== undefined
      ? { extractorSelfRating: input.extractorSelfRating }
      : {}),
  };
  const record = applyOutcomeEvent(undefined, event);
  // `applyOutcomeEvent` always returns a record for a `created` event — see its doc — so this
  // is unreachable, not a real runtime possibility; the guard just keeps the return type honest.
  if (record === undefined) {
    throw new Error('resolveOutcome: applyOutcomeEvent returned undefined for a created event');
  }
  await vault.write(outcomeRecordPath(record.id), serialize(record));
  return record;
}

/**
 * Records the outcome→concept containment edge (component register row 1.1b). Key-driven, not
 * anchor-driven (module doc): the caller already holds `outcomeId`, typically from
 * `resolveOutcome`. Idempotent — attaching the same `conceptKey` twice writes nothing the second
 * time. **Never mints**: an `outcomeId` with no existing record is a caller error, and this
 * function throws rather than silently creating one, mirroring
 * `../concept/key-store.ts`'s `bindConceptKeyToNote`.
 */
export async function attachConceptToOutcome(
  vault: VaultSource,
  outcomeId: string,
  conceptKey: string,
  options: Pick<ResolveOutcomeOptions, 'now'> = {},
): Promise<OutcomeRecord> {
  const now = options.now ?? defaultNow;
  const existing = await listOutcomeRecords(vault);
  const hit = existing.find(({ record }) => record.id === outcomeId);
  if (hit === undefined) {
    throw new Error(
      `attachConceptToOutcome: no existing OutcomeRecord for id "${outcomeId}" — this function ` +
        'attaches to an existing record and never mints one (see the module doc).',
    );
  }

  const event: OutcomeEvent = {
    kind: 'concept-attached',
    schemaVersion: 1,
    eventId: globalThis.crypto.randomUUID(),
    timestamp: now(),
    outcomeId,
    conceptKey,
  };
  const updated = applyOutcomeEvent(hit.record, event);
  if (updated === undefined || updated === hit.record) return hit.record;
  await vault.write(hit.path, serialize(updated));
  return updated;
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
  const existing = await listOutcomeRecords(vault);
  const hit = existing.find(({ record }) => record.id === outcomeId);
  if (hit === undefined) {
    throw new Error(
      `retireOutcome: no existing OutcomeRecord for id "${outcomeId}" — this function retires ` +
        'an existing record and never mints one (see the module doc).',
    );
  }

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
}
