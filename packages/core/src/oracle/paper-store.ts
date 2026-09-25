/**
 * The `PaperRecord` sidecar — F4.11 ruling 6 ("[D-252]"): each generated practice paper lands as
 * its own immutable object in Olea's own layer of the vault, under the instrument-layer
 * repairability rule, never in her authored notes (INV-6). It never recomposes and is never
 * marked stale by a course change; nothing retires it automatically.
 *
 * **Follows `../outcome/store.ts`'s sidecar pattern** — one small JSON file per paper, under a
 * dot-prefixed Olea folder, mint-then-append via an event fold, written/read through the injected
 * `VaultSource` port. **One deliberate difference from Outcome's `resolveOutcome`:** a paper is
 * NEVER deduped by matching inputs. Ruling 5 ("stateless re-ask... no diversity promise... every
 * request composes a fresh snapshot") means two calls with identical course/asOf/scope produce
 * two distinct paper objects, not one looked-up record — `createPaper` therefore always mints,
 * the same way `resolveOutcome`'s sibling would look nothing like "resolve."
 *
 * **What is immutable, and what accumulates.** `items` — the blueprint's filled slots, generated
 * — are fixed forever at creation (ruling 6: "never recomposes"). Three things accumulate
 * AFTER creation, one event each, because F4.11 says the paper "carries... her responses, any
 * hand-offs to review and any explanation results":
 *
 * - `responses` — one per attempted item (`recordPaperResponse`). A determinate item's expected
 *   answer is withheld until she attempts it, then stays revealed on reopening (ruling 2) — this
 *   module represents that as a DERIVED fact (`isAnswerRevealed`), never a separate flag to keep
 *   in sync: "a response exists for this slot" already is "attempted," and nothing here ever
 *   removes a response.
 * - `handoffs` — one per item explicitly handed to ordinary review (`handOffPaperItem`), each
 *   carrying the eliciting-context label `'from a practice paper'` (ruling 1) AS DATA. **This
 *   module does not itself write into her review log or call component register row 2.10's
 *   port** — `review/` is outside this bead's owned files, and the eliciting-context label on a
 *   review record is `[D-252]`'s own named Class C crossing, a persisted-schema decision for
 *   whichever bead wires the actual hand-off. What this module guarantees structurally is the
 *   half F4.11 asks of the PAPER: there is no "hand off the whole paper" event kind at all, only
 *   a per-slot one, so "never the whole paper as one gesture" is a fact about the event vocabulary
 *   this module offers, not a runtime check bolted onto a wider capability.
 * - `explanationResults` — one per free-response item, the depth reading (never a mark) ruling 2's
 *   explain-yourself route returns, recorded here as data (F5's five-level depth vocabulary,
 *   D-217) — this module does not run the grading itself (component register row 2.3's job); it
 *   only has somewhere to put the result once a caller has one.
 *
 * **Never written into her authored notes; never auto-retired; follows the course's archive.**
 * `retirePaper` mirrors `../outcome/store.ts`'s `retireOutcome` (F8.5's withdrawal-not-deletion
 * pattern) for the one case ruling 6 names — "it follows the course's own archive when the course
 * is archived" — but nothing in this repo calls it yet: no production "course archived" event
 * exists to drive it (named here rather than silently assumed).
 */

import { listFolder } from '../vault/list-folder.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { PaperGeneratedItem } from './paper-items.js';
import type { PaperBlueprint, PaperEmptySlot } from './paper-types.js';

/** The vault folder this module owns. Dot-prefixed, sibling to `.olea/outcomes/`, `.olea/concepts/`, `.olea/reviews/`. */
export const PAPER_STORE_FOLDER: VaultPath = '.olea/papers';

/** Marks every id minted by this module — greppable, distinct from `OPAQUE_OUTCOME_ID_PREFIX`/`OPAQUE_CONCEPT_KEY_PREFIX` so an id's node type is visible from the string alone. */
export const OPAQUE_PAPER_ID_PREFIX = 'paper-key1';

/** The composition account (F6.11(c)) — the blueprint restated minus its slots/empty-slots, which become `PaperRecord.items`/`emptySlots` instead once generation has run. */
export type PaperCompositionAccount = Omit<PaperBlueprint, 'slots' | 'emptySlots'>;

export function paperCompositionAccountFromBlueprint(
  blueprint: PaperBlueprint,
): PaperCompositionAccount {
  const { slots: _slots, emptySlots: _emptySlots, ...account } = blueprint;
  return account;
}

/** F8.5's withdrawal-not-deletion pattern, applied to a paper (ruling 6: "follows the course's own archive"). `'retired'` never deletes the record. */
export const PAPER_STATUSES = ['active', 'retired'] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];

/** One attempted item — her response, recorded as exam-simulation evidence by default (ruling 1). `responseText` is whatever her answer serialises to (a selected option's text for a determinate item, prose for free response) — this module does not interpret it. */
export interface PaperResponseRecord {
  readonly slotId: string;
  readonly responseText: string;
  readonly respondedAt: string;
}

/** One item explicitly handed to ordinary review — ruling 1, "never the whole paper as one gesture." `elicitingContextLabel` is always the one literal F4.11 names; a field rather than a bare boolean so the label's own text lives in exactly one place. */
export interface PaperHandoffRecord {
  readonly slotId: string;
  readonly elicitingContextLabel: 'from a practice paper';
  readonly handedOffAt: string;
}

/** F5's five-level depth reading (D7.1, `[D-117]`), never a mark — ruling 2's free-response route. */
export const PAPER_DEPTH_READINGS = [
  'surface',
  'one-point',
  'several-points',
  'connected',
  'full-depth',
] as const;
export type PaperDepthReading = (typeof PAPER_DEPTH_READINGS)[number];

/** One free-response item's explain-yourself result — ruling 2: graded against the item's own grounding, never the parent concept's defining passages, never a mark. */
export interface PaperExplanationRecord {
  readonly slotId: string;
  readonly depthReading: PaperDepthReading;
  readonly recordedAt: string;
}

/** The persisted, immutable-at-the-item-set-grain paper object — ruling 6. */
export interface PaperRecord {
  readonly id: string;
  readonly course: string;
  readonly generatedAt: string;
  readonly asOf: string;
  readonly compositionAccount: PaperCompositionAccount;
  readonly items: readonly PaperGeneratedItem[];
  readonly emptySlots: readonly PaperEmptySlot[];
  readonly responses: readonly PaperResponseRecord[];
  readonly handoffs: readonly PaperHandoffRecord[];
  readonly explanationResults: readonly PaperExplanationRecord[];
  readonly status: PaperStatus;
  readonly schemaVersion: number;
}

/** Bumped only on a breaking change to `PaperRecord`'s shape. */
export const PAPER_RECORD_SCHEMA_VERSION = 1;

interface PaperEventCommon {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly timestamp: string;
}

export interface PaperGeneratedEvent extends PaperEventCommon {
  readonly kind: 'generated';
  readonly paperId: string;
  readonly course: string;
  readonly asOf: string;
  readonly compositionAccount: PaperCompositionAccount;
  readonly items: readonly PaperGeneratedItem[];
  readonly emptySlots: readonly PaperEmptySlot[];
}

export interface PaperResponseRecordedEvent extends PaperEventCommon {
  readonly kind: 'response-recorded';
  readonly paperId: string;
  readonly slotId: string;
  readonly responseText: string;
}

export interface PaperItemHandedOffEvent extends PaperEventCommon {
  readonly kind: 'item-handed-off';
  readonly paperId: string;
  readonly slotId: string;
}

export interface PaperExplanationRecordedEvent extends PaperEventCommon {
  readonly kind: 'explanation-recorded';
  readonly paperId: string;
  readonly slotId: string;
  readonly depthReading: PaperDepthReading;
}

export interface PaperRetiredEvent extends PaperEventCommon {
  readonly kind: 'retired';
  readonly paperId: string;
}

export type PaperEvent =
  | PaperGeneratedEvent
  | PaperResponseRecordedEvent
  | PaperItemHandedOffEvent
  | PaperExplanationRecordedEvent
  | PaperRetiredEvent;

function applyGenerated(
  existing: PaperRecord | undefined,
  event: PaperGeneratedEvent,
): PaperRecord {
  // Ruling 6: "never recomposes." A duplicate `generated` for an id that already has a record
  // changes nothing — mirrors `../outcome/project.ts`'s `applyCreated` idempotence.
  if (existing !== undefined) return existing;
  return {
    id: event.paperId,
    course: event.course,
    generatedAt: event.timestamp,
    asOf: event.asOf,
    compositionAccount: event.compositionAccount,
    items: event.items,
    emptySlots: event.emptySlots,
    responses: [],
    handoffs: [],
    explanationResults: [],
    status: 'active',
    schemaVersion: PAPER_RECORD_SCHEMA_VERSION,
  };
}

function applyResponseRecorded(
  existing: PaperRecord,
  event: PaperResponseRecordedEvent,
): PaperRecord {
  return {
    ...existing,
    responses: [
      ...existing.responses,
      { slotId: event.slotId, responseText: event.responseText, respondedAt: event.timestamp },
    ],
  };
}

function applyItemHandedOff(existing: PaperRecord, event: PaperItemHandedOffEvent): PaperRecord {
  // Idempotent on a repeated hand-off of the same slot — matches ../outcome's attach idempotence.
  if (existing.handoffs.some((h) => h.slotId === event.slotId)) return existing;
  return {
    ...existing,
    handoffs: [
      ...existing.handoffs,
      {
        slotId: event.slotId,
        elicitingContextLabel: 'from a practice paper',
        handedOffAt: event.timestamp,
      },
    ],
  };
}

function applyExplanationRecorded(
  existing: PaperRecord,
  event: PaperExplanationRecordedEvent,
): PaperRecord {
  return {
    ...existing,
    explanationResults: [
      ...existing.explanationResults,
      { slotId: event.slotId, depthReading: event.depthReading, recordedAt: event.timestamp },
    ],
  };
}

function applyRetired(existing: PaperRecord, _event: PaperRetiredEvent): PaperRecord {
  if (existing.status === 'retired') return existing;
  return { ...existing, status: 'retired' };
}

/**
 * The pure fold, mirroring `../outcome/project.ts`'s `applyOutcomeEvent` shape exactly: `undefined`
 * only when `existing` was `undefined` and `event` was not `'generated'` — every other event
 * against a non-existent record is dropped rather than inventing one.
 */
export function applyPaperEvent(
  existing: PaperRecord | undefined,
  event: PaperEvent,
): PaperRecord | undefined {
  if (event.kind === 'generated') return applyGenerated(existing, event);
  if (existing === undefined) return undefined;
  if (event.kind === 'response-recorded') return applyResponseRecorded(existing, event);
  if (event.kind === 'item-handed-off') return applyItemHandedOff(existing, event);
  if (event.kind === 'explanation-recorded') return applyExplanationRecorded(existing, event);
  return applyRetired(existing, event);
}

/** `true` once ANY response is recorded for `slotId` — ruling 2's "withholds until attempted, then keeps it revealed." Monotonic: nothing in this module ever removes a response, so this can only ever go from `false` to `true`, never back. */
export function isAnswerRevealed(record: PaperRecord, slotId: string): boolean {
  return record.responses.some((r) => r.slotId === slotId);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** The vault path for one paper's record. `encodeURIComponent`, same injective, total choice `../outcome/store.ts`'s `outcomeRecordPath` makes. */
export function paperRecordPath(id: string): VaultPath {
  return `${PAPER_STORE_FOLDER}/${encodeURIComponent(id)}.json`;
}

function serialize(record: PaperRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** A source of randomness for `mintOpaquePaperId`. Injectable for deterministic tests. */
export type OpaqueIdNonceSource = () => string;

function defaultOpaqueIdNonceSource(): string {
  return globalThis.crypto.randomUUID();
}

export function mintOpaquePaperId(
  nonceSource: OpaqueIdNonceSource = defaultOpaqueIdNonceSource,
): string {
  return `${OPAQUE_PAPER_ID_PREFIX}:${nonceSource()}`;
}

/** Every valid `PaperRecord` currently under `.olea/papers/`. A corrupt/unreadable file is skipped, never thrown on — same referential-integrity posture `../outcome/store.ts`'s `listOutcomeRecords` takes. */
export async function listPaperRecords(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly record: PaperRecord }[]> {
  // `listFolder`, not `vault.list`: `ObsidianSource.list()` never sees a dot folder (`ol-egov.141.89.10.52`).
  const paths = await listFolder(vault, PAPER_STORE_FOLDER, { extensions: ['json'] });
  const out: { readonly path: VaultPath; readonly record: PaperRecord }[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isPaperRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable file: skipped, never thrown.
    }
  }
  return out;
}

/** Runtime validation, hand-rolled to match this package's existing sidecar convention (no schema library). Deliberately shallow on `items`/`compositionAccount` (structural presence only) — this is a referential-integrity guard against a corrupt file, not a full re-validation of every generated item's shape. */
export function isPaperRecord(value: unknown): value is PaperRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNonEmptyString(v.course)) return false;
  if (!isNonEmptyString(v.generatedAt)) return false;
  if (!isNonEmptyString(v.asOf)) return false;
  if (typeof v.compositionAccount !== 'object' || v.compositionAccount === null) return false;
  if (!Array.isArray(v.items)) return false;
  if (!Array.isArray(v.emptySlots)) return false;
  if (!Array.isArray(v.responses)) return false;
  if (!Array.isArray(v.handoffs)) return false;
  if (!Array.isArray(v.explanationResults)) return false;
  if (v.status !== 'active' && v.status !== 'retired') return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

export interface CreatePaperInput {
  readonly course: string;
  readonly asOf: string;
  readonly compositionAccount: PaperCompositionAccount;
  readonly items: readonly PaperGeneratedItem[];
  readonly emptySlots: readonly PaperEmptySlot[];
}

export interface PaperStoreOptions {
  /** Injectable for deterministic tests. Defaults to `new Date().toISOString()`. */
  readonly now?: () => string;
  readonly generateId?: OpaqueIdNonceSource;
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Mints and persists a NEW paper — always, never a lookup (module doc: ruling 5's stateless
 * re-ask means no two calls are ever the "same" paper, however identical their inputs).
 */
export async function createPaper(
  vault: VaultSource,
  input: CreatePaperInput,
  options: PaperStoreOptions = {},
): Promise<PaperRecord> {
  const now = options.now ?? defaultNow;
  const id = mintOpaquePaperId(options.generateId);
  const event: PaperGeneratedEvent = {
    kind: 'generated',
    schemaVersion: 1,
    eventId: globalThis.crypto.randomUUID(),
    timestamp: now(),
    paperId: id,
    course: input.course,
    asOf: input.asOf,
    compositionAccount: input.compositionAccount,
    items: input.items,
    emptySlots: input.emptySlots,
  };
  const record = applyPaperEvent(undefined, event);
  if (record === undefined) {
    throw new Error('createPaper: applyPaperEvent returned undefined for a generated event');
  }
  await vault.write(paperRecordPath(record.id), serialize(record));
  return record;
}

async function loadExisting(
  vault: VaultSource,
  paperId: string,
  fnName: string,
): Promise<{ readonly path: VaultPath; readonly record: PaperRecord }> {
  const existing = await listPaperRecords(vault);
  const hit = existing.find(({ record }) => record.id === paperId);
  if (hit === undefined) {
    throw new Error(`${fnName}: no existing PaperRecord for id "${paperId}" — never mints one.`);
  }
  return hit;
}

/** Validates that `slotId` names an item this paper actually has — the module's guard against handing off, responding to, or explaining an item the paper never generated. */
function assertKnownSlot(record: PaperRecord, slotId: string, fnName: string): void {
  if (!record.items.some((item) => item.slotId === slotId)) {
    throw new Error(`${fnName}: "${slotId}" is not an item on paper "${record.id}".`);
  }
}

/** Records her response to one item — exam-simulation evidence by default (ruling 1); never touches ordinary review or mastery state itself. */
export async function recordPaperResponse(
  vault: VaultSource,
  paperId: string,
  slotId: string,
  responseText: string,
  options: PaperStoreOptions = {},
): Promise<PaperRecord> {
  const now = options.now ?? defaultNow;
  const { path, record } = await loadExisting(vault, paperId, 'recordPaperResponse');
  assertKnownSlot(record, slotId, 'recordPaperResponse');
  const event: PaperResponseRecordedEvent = {
    kind: 'response-recorded',
    schemaVersion: 1,
    eventId: globalThis.crypto.randomUUID(),
    timestamp: now(),
    paperId,
    slotId,
    responseText,
  };
  const updated = applyPaperEvent(record, event);
  if (updated === undefined || updated === record) return record;
  await vault.write(path, serialize(updated));
  return updated;
}

/**
 * Hands ONE item to ordinary review — never the whole paper (module doc). This function itself
 * writes only to the paper's own sidecar record; it does not call component register row 2.10's
 * review-log port (outside this bead's owned files — see the module doc's own note).
 */
export async function handOffPaperItem(
  vault: VaultSource,
  paperId: string,
  slotId: string,
  options: PaperStoreOptions = {},
): Promise<PaperRecord> {
  const now = options.now ?? defaultNow;
  const { path, record } = await loadExisting(vault, paperId, 'handOffPaperItem');
  assertKnownSlot(record, slotId, 'handOffPaperItem');
  const event: PaperItemHandedOffEvent = {
    kind: 'item-handed-off',
    schemaVersion: 1,
    eventId: globalThis.crypto.randomUUID(),
    timestamp: now(),
    paperId,
    slotId,
  };
  const updated = applyPaperEvent(record, event);
  if (updated === undefined || updated === record) return record;
  await vault.write(path, serialize(updated));
  return updated;
}

/** Records a free-response item's explain-yourself depth reading — ruling 2, never a mark. */
export async function recordPaperExplanationResult(
  vault: VaultSource,
  paperId: string,
  slotId: string,
  depthReading: PaperDepthReading,
  options: PaperStoreOptions = {},
): Promise<PaperRecord> {
  const now = options.now ?? defaultNow;
  const { path, record } = await loadExisting(vault, paperId, 'recordPaperExplanationResult');
  assertKnownSlot(record, slotId, 'recordPaperExplanationResult');
  const event: PaperExplanationRecordedEvent = {
    kind: 'explanation-recorded',
    schemaVersion: 1,
    eventId: globalThis.crypto.randomUUID(),
    timestamp: now(),
    paperId,
    slotId,
    depthReading,
  };
  const updated = applyPaperEvent(record, event);
  if (updated === undefined || updated === record) return record;
  await vault.write(path, serialize(updated));
  return updated;
}

/** F8.5's withdrawal, applied to a paper (ruling 6). No production caller yet — see the module doc. */
export async function retirePaper(
  vault: VaultSource,
  paperId: string,
  options: PaperStoreOptions = {},
): Promise<PaperRecord> {
  const now = options.now ?? defaultNow;
  const { path, record } = await loadExisting(vault, paperId, 'retirePaper');
  const event: PaperRetiredEvent = {
    kind: 'retired',
    schemaVersion: 1,
    eventId: globalThis.crypto.randomUUID(),
    timestamp: now(),
    paperId,
  };
  const updated = applyPaperEvent(record, event);
  if (updated === undefined || updated === record) return record;
  await vault.write(path, serialize(updated));
  return updated;
}
