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
 *   carrying the eliciting-context label `'from a practice paper'` (ruling 1) AS DATA. There is
 *   no "hand off the whole paper" event kind at all, only a per-slot one, so "never the whole
 *   paper as one gesture" is a fact about the event vocabulary this module offers, not a runtime
 *   check bolted onto a wider capability. **The hand-off also enters the item as a real
 *   instrument** (`[D-407]`, `[D-391]`): one quiz block, written into the note the caller names,
 *   carrying the paper and slot on its own `paper-origin:` field so the link survives the paper
 *   file's removal; or, for a flashcard item, one Q&A card with the paper and slot in its side
 *   record (`../instrument/paper-origin-store.ts`, sheet v87 row 5). **It never writes into her review log** (`[D-367]`'s clarification): the
 *   review record that carries `origin: 'practice-paper'` is written later, by the ordinary review
 *   path, for the first review after the act — reading the block's field, not this sidecar.
 *   **When the paper READ the slot's demand, the hand-off also writes the instrument's target
 *   record** (`[D-437]`, `../instrument/target-store.ts`; see `handedOffItemDemand` for the rule):
 *   this module is one of the writer's three allow-listed callers
 *   (`../instrument/target-store-callers.spec.ts`).
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

import { applyDocumentEdits } from '../block/edit.js';
import { parseDocument } from '../block/parse.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readScalar } from '../frontmatter/read.js';
import { hashText } from '../ingestion/hash.js';
import { MULTI_LINE_SEPARATOR, parseCards, stampQaCardBlockId } from '../instrument/card-format.js';
import { insertMcqBlock, parseMcqBlocks, stampMcqPaperOrigin } from '../instrument/mcq-format.js';
import { acceptGeneratedMcq } from '../instrument/mcq-generated.js';
import {
  readInstrumentPaperOrigin,
  removeInstrumentPaperOrigin,
  writeInstrumentPaperOrigin,
} from '../instrument/paper-origin-store.js';
import {
  instrumentTargetStorePath,
  questionBindingOf,
  writeInstrumentTarget,
} from '../instrument/target-store.js';
import type { QaCardInstrument } from '../instrument/types.js';
import { provisionalInstrumentId } from '../session/instrument-id.js';
import { OLEA_UID_KEY } from '../uid/stamp.js';
import { listFolder } from '../vault/list-folder.js';
import { withPathQueue } from '../vault/path-queue.js';
import { readStoreRecord } from '../vault/store-record.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import {
  type PaperGeneratedItem,
  type PaperItemCard,
  paperItemCardCandidate,
  paperItemMcqCandidate,
} from './paper-items.js';
import {
  PAPER_STRUCTURE_FORMAT_VERSION,
  type PaperBlueprint,
  type PaperCompletion,
  type PaperDemand,
  type PaperEmptySlot,
  type PaperGapKind,
  type PaperStructuredShape,
} from './paper-types.js';

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
  /**
   * `[D-430]` (ruled 2026-09-29): the structured shape — sections, groups, parts, marks,
   * dependencies, shared material, choices — beside the flat composition account, never instead of
   * it. Absent on every paper composed from a flat blueprint (and on every record written before
   * this field existed), so absent is not empty: it says the paper has no structured reading, not
   * that its structure was empty. Fixed at creation like `items` (ruling 6: never recomposes).
   */
  readonly structure?: PaperStructuredShape;
  /**
   * `[D-430]`: whether the paper is complete or an explicitly qualified partial (a source gap, a
   * capability gap, or both). **An outage is not a value here**: a paper with work owed is never
   * created (`./paper-journal.ts` keeps it unfinished), so a record's `completion` only ever says
   * something about her material and the generators. Absent on a paper composed without one.
   */
  readonly completion?: PaperCompletion;
  /** `[D-430]`: the resumable journal this paper was finished from, so a retried finish never mints a second paper for one journal. Absent on a paper composed in one pass. */
  readonly journalId?: string;
  readonly schemaVersion: number;
}

/** Bumped only on a breaking change to `PaperRecord`'s shape. A flat paper is written at this version, exactly as before `[D-430]`. */
export const PAPER_RECORD_SCHEMA_VERSION = 1;

/** The version a record carries when it holds a structure, a completion or a journal link (`[D-430]`): additive over version 1, so a version-1 reader that ignores unknown fields still reads it. */
export const PAPER_RECORD_STRUCTURED_SCHEMA_VERSION = 2;

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
  /** `[D-430]`: see `PaperRecord.structure`. Omitted, never `undefined`, on a flat paper. */
  readonly structure?: PaperStructuredShape;
  /** `[D-430]`: see `PaperRecord.completion`. */
  readonly completion?: PaperCompletion;
  /** `[D-430]`: see `PaperRecord.journalId`. */
  readonly journalId?: string;
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
  const structured =
    event.structure !== undefined ||
    event.completion !== undefined ||
    event.journalId !== undefined;
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
    ...(event.structure !== undefined ? { structure: event.structure } : {}),
    ...(event.completion !== undefined ? { completion: event.completion } : {}),
    ...(event.journalId !== undefined ? { journalId: event.journalId } : {}),
    schemaVersion: structured
      ? PAPER_RECORD_STRUCTURED_SCHEMA_VERSION
      : PAPER_RECORD_SCHEMA_VERSION,
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
  if (v.structure !== undefined && !isPaperStructuredShape(v.structure)) return false;
  if (v.completion !== undefined && !isPaperCompletion(v.completion)) return false;
  if (v.journalId !== undefined && !isNonEmptyString(v.journalId)) return false;
  return true;
}

/** Shallow validation of a persisted structure — its format version and that its four collections are arrays; deeper well-formedness is `./paper-structure.ts`'s `validatePaperStructure`, run by a caller that means to use the shape. */
function isPaperStructuredShape(value: unknown): value is PaperStructuredShape {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.formatVersion === PAPER_STRUCTURE_FORMAT_VERSION &&
    Array.isArray(v.sections) &&
    Array.isArray(v.groups) &&
    Array.isArray(v.parts) &&
    typeof v.structureSlotCount === 'number'
  );
}

const PAPER_GAP_KINDS: readonly PaperGapKind[] = ['source', 'capability'];

function isPaperCompletion(value: unknown): value is PaperCompletion {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.status === 'complete') return true;
  return (
    v.status === 'qualified-partial' &&
    Array.isArray(v.gaps) &&
    v.gaps.length > 0 &&
    v.gaps.every((gap) => PAPER_GAP_KINDS.includes(gap as PaperGapKind))
  );
}

export interface CreatePaperInput {
  readonly course: string;
  readonly asOf: string;
  readonly compositionAccount: PaperCompositionAccount;
  readonly items: readonly PaperGeneratedItem[];
  readonly emptySlots: readonly PaperEmptySlot[];
  /** `[D-430]`: the structured shape, when the paper was composed from a structured blueprint. */
  readonly structure?: PaperStructuredShape;
  /** `[D-430]`: complete, or an explicitly qualified partial. Never an outage (see `PaperRecord.completion`). */
  readonly completion?: PaperCompletion;
  /** `[D-430]`: the journal this paper was finished from (`./paper-journal.ts`). */
  readonly journalId?: string;
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
    ...(input.structure !== undefined ? { structure: input.structure } : {}),
    ...(input.completion !== undefined ? { completion: input.completion } : {}),
    ...(input.journalId !== undefined ? { journalId: input.journalId } : {}),
  };
  const record = applyPaperEvent(undefined, event);
  if (record === undefined) {
    throw new Error('createPaper: applyPaperEvent returned undefined for a generated event');
  }
  const path = paperRecordPath(record.id);
  await withPathQueue(path, () => vault.write(path, serialize(record)));
  return record;
}

/**
 * Runs `update` on the current copy of paper `paperId`'s record, as one task on its file's queue
 * (`../vault/path-queue.ts`, `ol-egov.141.89.104.2`): the listing finds the file, and the record is
 * read again inside the queue before anything is decided, so two overlapping responses (or a
 * response and a retirement) both land instead of the later one writing back a copy that lacks the
 * earlier one. Throws, as before, when there is no record for the id, or the one found no longer
 * reads as a record.
 */
async function updateExistingPaper<T>(
  vault: VaultSource,
  paperId: string,
  fnName: string,
  update: (hit: { readonly path: VaultPath; readonly record: PaperRecord }) => Promise<T>,
): Promise<T> {
  const missing = () =>
    new Error(`${fnName}: no existing PaperRecord for id "${paperId}" — never mints one.`);
  const existing = await listPaperRecords(vault);
  const hit = existing.find(({ record }) => record.id === paperId);
  if (hit === undefined) throw missing();
  return withPathQueue(hit.path, async () => {
    const fresh = await readStoreRecord(vault, hit.path, isPaperRecord);
    if (fresh.kind !== 'record' || fresh.record.id !== paperId) throw missing();
    return update({ path: hit.path, record: fresh.record });
  });
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
  return updateExistingPaper(vault, paperId, 'recordPaperResponse', async ({ path, record }) => {
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
  });
}

/**
 * Where a handed-off item is entered, and which of its questions is the item. Both are the
 * caller's (the paper view's per-item hand-off control): the note is hers to choose, since the act
 * is her consent to the write (INV-6), and the service returns several questions (or cards) per
 * slot, so which one the paper presents as the item is the view's to say
 * (`./paper-items.ts`'s `paperItemMcqCandidate`, `paperItemCardCandidate`). For a flashcard item
 * `questionIndex` names the card.
 */
export interface PaperHandoffTarget {
  readonly notePath: VaultPath;
  readonly questionIndex: number;
}

export interface PaperHandoffResult {
  readonly record: PaperRecord;
  /**
   * The entered instrument's id: for a quiz item always `paperItemInstrumentId(paperId, slotId)`;
   * for a flashcard item the id a vault walk derives for the card at its stamped block id
   * (`paperItemCardBlockId(paperId, slotId)`) in the target note.
   */
  readonly instrumentId: string;
  /**
   * `true` when this call wrote the quiz block or card (or repaired a missing `paper-origin:` on a
   * quiz block); `false` on a repeat of an earlier hand-off, which writes nothing to any note.
   */
  readonly instrumentWritten: boolean;
}

/**
 * The instrument id a handed-off paper item enters review under, derived from the paper id and
 * the slot id alone (`[D-391]` binding condition 1: paper, slot and instrument are each found from
 * the others — the block's `paper-origin:` names the paper and slot; this names the instrument).
 * Deterministic, so a repeated or interrupted hand-off converges on one id rather than minting a
 * second; same `mcq-` + 16-hex shape `materialize-mcq.ts` derives for accepted drafts, with a
 * distinct `kind` in the hashed input so the two families never hash the same input.
 */
export async function paperItemInstrumentId(paperId: string, slotId: string): Promise<string> {
  const digest = await hashText(JSON.stringify({ kind: 'paper-handoff', paperId, slotId }));
  return `mcq-${digest.slice(0, 16)}`;
}

/** `stampQaCardBlockId`'s own block-id alphabet (`../instrument/card-format.ts`). */
const CARD_BLOCK_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * The block id a handed-off flashcard is stamped with, derived from the paper id and the slot id
 * alone — the card's half of `[D-391]` binding condition 1. A Q&A card carries no explicit id: a
 * vault walk derives its instrument id from the note and this block id (`provisionalInstrumentId`,
 * rule 4), so paper and slot find the card through this id, and the card finds its paper and slot
 * through its side record (`../instrument/paper-origin-store.ts`). Deterministic, so a repeated or
 * interrupted hand-off finds the card it already entered rather than entering a second; six
 * characters of the card alphabet, the shape `materialize-card.ts`'s `deriveCardBlockId` gives, with
 * a distinct `kind` in the hashed input.
 */
export async function paperItemCardBlockId(paperId: string, slotId: string): Promise<string> {
  const digest = await hashText(JSON.stringify({ kind: 'paper-handoff-card', paperId, slotId }));
  let id = '';
  for (let i = 0; i < 6; i++) {
    const byte = Number.parseInt(digest.slice(i * 2, i * 2 + 2), 16);
    id += CARD_BLOCK_ID_ALPHABET[byte % CARD_BLOCK_ID_ALPHABET.length];
  }
  return id;
}

/** A note's `olea-uid`, read the way a vault walk reads it (`materialize-card.ts`'s `noteUidOf`). */
function noteUidOf(source: string): string | null {
  const first = parseDocument(source).blocks[0];
  if (first?.kind !== 'frontmatter') return null;
  const uid = readScalar(parseFrontmatter(first.inner), OLEA_UID_KEY).scalar;
  return uid === '' ? null : uid;
}

/**
 * The instrument id a vault walk derives for the card stamped `blockId` in this note: the same
 * exported `provisionalInstrumentId` the walk calls, with ordinal 1, since the derived block id
 * anchors this card alone (`materialize-card.ts`'s "THE IDENTITY DERIVATION").
 */
function paperCardInstrumentId(notePath: VaultPath, source: string, blockId: string): string {
  return provisionalInstrumentId({
    noteUid: noteUidOf(source),
    notePath,
    blockId,
    heading: null,
    ordinal: 1,
    explicitId: null,
    instrumentType: 'qa',
  });
}

/**
 * The note with one Q&A card for `card` inserted at the top of its content (after a leading
 * frontmatter block, so the note's concept binding survives) and stamped `blockId`, and the card as
 * it parses back. The placement and the multi-line form are `materialize-card.ts`'s, so the card
 * reads exactly as a generated card accepted from a draft. Pure: it writes nothing, and throws when
 * the text would not read back as the same card (a front or back holding a line the card format
 * reads as structure), so such an item is refused before anything is written.
 */
function insertPaperCard(
  source: string,
  card: PaperItemCard,
  blockId: string,
): { readonly content: string; readonly entered: QaCardInstrument } {
  const front = card.front.trim();
  const back = card.back.trim();
  const doc = parseDocument(source);
  const firstBlock = doc.blocks[0];
  const anchor = firstBlock?.kind === 'frontmatter' ? firstBlock : null;
  const terminator = source.includes('\r\n') ? '\r\n' : '\n';
  const cardText = `${front}${terminator}${MULTI_LINE_SEPARATOR}${terminator}${back}${terminator}`;
  const next = anchor === null ? doc.blocks[0] : doc.blocks[1];
  const followsBlank = next?.kind === 'blank';
  const insertAt = anchor === null ? 0 : followsBlank && next ? next.end : anchor.end;
  const endsWithNewline = insertAt === 0 || source.slice(0, insertAt).endsWith('\n');
  const lead =
    insertAt === 0
      ? ''
      : endsWithNewline
        ? followsBlank
          ? ''
          : terminator
        : `${terminator}${terminator}`;
  const trail = insertAt < source.length ? terminator : '';
  const inserted = applyDocumentEdits(doc, [
    { kind: 'insert', at: insertAt, text: `${lead}${cardText}${trail}` },
  ]);
  const span = inserted.spans[0];
  const found =
    span === undefined
      ? undefined
      : parseCards(inserted.content).find(
          (c) => c.type === 'qa' && c.span.start >= span.start && c.span.end <= span.end,
        );
  const stamped =
    found === undefined
      ? undefined
      : stampQaCardBlockId(inserted.content, found.span, { generateBlockId: () => blockId });
  const entered =
    stamped === undefined
      ? undefined
      : parseCards(stamped.content).find(
          (c): c is QaCardInstrument => c.type === 'qa' && c.blockId === blockId,
        );
  if (
    stamped === undefined ||
    entered === undefined ||
    entered.front !== front ||
    entered.back !== back
  ) {
    throw new Error(
      'handOffPaperItem: the flashcard would not read back as the same card in the note; nothing was written',
    );
  }
  return { content: stamped.content, entered };
}

/** What entering one item wrote, and how to take that back if the paper's own write then fails. */
interface EnteredPaperItem {
  readonly instrumentId: string;
  readonly instrumentWritten: boolean;
  readonly rollback?: () => Promise<void>;
}

/**
 * Enters a quiz item as one quiz block carrying `paper-origin:` — `handOffPaperItem`'s steps 2 to 4
 * for a `quiz.generate.v1` item, unchanged by the card branch beside it.
 */
async function enterPaperQuizBlock(
  vault: VaultSource,
  record: PaperRecord,
  item: PaperGeneratedItem,
  paperId: string,
  target: PaperHandoffTarget,
  now: () => string,
): Promise<EnteredPaperItem> {
  const slotId = item.slotId;
  const candidate = paperItemMcqCandidate(item, target.questionIndex);
  const origin = { paperId, slotId };
  const instrumentId = await paperItemInstrumentId(paperId, slotId);

  const source = await vault.read(target.notePath);
  const already = parseMcqBlocks(source).instruments.find((i) => i.id === instrumentId);
  if (already !== undefined) {
    const stamped = stampMcqPaperOrigin(source, already.span, origin);
    if (!stamped.changed) return { instrumentId, instrumentWritten: false };
    await vault.write(target.notePath, stamped.content);
    return { instrumentId, instrumentWritten: true };
  }
  if (record.handoffs.some((h) => h.slotId === slotId)) {
    return { instrumentId, instrumentWritten: false };
  }
  const firstBlock = parseDocument(source).blocks[0];
  const { content } = insertMcqBlock({
    source,
    afterBlockIndex: firstBlock?.kind === 'frontmatter' ? 0 : -1,
    fields: { ...acceptGeneratedMcq(candidate, instrumentId), paperOrigin: origin },
  });
  const declaredDemand = handedOffItemDemand(record, item);
  if (declaredDemand !== undefined) {
    const entered = parseMcqBlocks(content).instruments.find((i) => i.id === instrumentId);
    const targetPath = instrumentTargetStorePath(instrumentId);
    if (entered !== undefined && !(await vault.exists(targetPath))) {
      await writeInstrumentTarget(vault, {
        instrumentId,
        declaredDemand,
        origin: 'paper-handoff',
        questionBinding: await questionBindingOf(entered),
        authoredAt: now(),
        generator: { taskId: item.taskId, promptVersion: item.promptVersion },
      });
    }
  }
  await vault.write(target.notePath, content);
  return { instrumentId, instrumentWritten: true };
}

/**
 * Enters a flashcard item as one Q&A card, its paper and slot in the side record (sheet v87 row 5,
 * `ol-egov.141.89.7.114`) — `handOffPaperItem`'s steps 2 to 4 for a `cards.generate.v1` item.
 * See `handOffPaperItem`'s doc for the order and for what a failed attempt takes back.
 */
async function enterPaperCard(
  vault: VaultSource,
  record: PaperRecord,
  item: PaperGeneratedItem,
  paperId: string,
  target: PaperHandoffTarget,
  now: () => string,
): Promise<EnteredPaperItem> {
  const slotId = item.slotId;
  const card = paperItemCardCandidate(item, target.questionIndex);
  const origin = { paperId, slotId };
  const blockId = await paperItemCardBlockId(paperId, slotId);

  const source = await vault.read(target.notePath);
  const instrumentId = paperCardInstrumentId(target.notePath, source, blockId);
  const already = parseCards(source).find(
    (c): c is QaCardInstrument => c.type === 'qa' && c.blockId === blockId,
  );
  if (already !== undefined) {
    // An earlier call entered this card. Its side record is written before the note, so it is
    // there unless something removed it; a card at this block id with neither its record nor this
    // item's text is not this item's, and is refused rather than claimed.
    const recorded = await readInstrumentPaperOrigin(vault, instrumentId);
    if (recorded !== undefined && (recorded.paperId !== paperId || recorded.slotId !== slotId)) {
      throw new Error(
        "handOffPaperItem: a card at this item's block id names another paper or slot; nothing was written",
      );
    }
    if (recorded === undefined) {
      if (already.front !== card.front.trim() || already.back !== card.back.trim()) {
        throw new Error(
          "handOffPaperItem: a card at this item's block id is not this item's card; nothing was written",
        );
      }
      await writeInstrumentPaperOrigin(vault, instrumentId, origin);
    }
    return { instrumentId, instrumentWritten: false };
  }
  if (record.handoffs.some((h) => h.slotId === slotId)) {
    // Handed off before, and the card is no longer in this note: she may have moved or removed it,
    // which a repeated press must not undo.
    return { instrumentId, instrumentWritten: false };
  }

  // Everything that can refuse is decided before the first write: the card's text, and whether a
  // failed attempt could take its side record back out.
  const { content, entered } = insertPaperCard(source, card, blockId);
  if (vault.delete === undefined) {
    throw new Error(
      'handOffPaperItem: this vault cannot delete files, so a failed flashcard hand-off could not take its origin record back; nothing was written',
    );
  }
  const declaredDemand = handedOffItemDemand(record, item);
  const targetPath = instrumentTargetStorePath(instrumentId);
  let targetWritten = false;
  let noteTouched = false;

  const rollback = async (): Promise<void> => {
    // Best effort, and never in place of the failure that called it: a step that cannot be taken
    // back is left for the retry, which converges (steps 2 and 3).
    try {
      if (noteTouched && (await vault.read(target.notePath)) === content) {
        await vault.write(target.notePath, source);
      }
    } catch {}
    try {
      if (targetWritten) await vault.delete?.(targetPath);
    } catch {}
    try {
      await removeInstrumentPaperOrigin(vault, instrumentId, origin);
    } catch {}
  };

  try {
    await writeInstrumentPaperOrigin(vault, instrumentId, origin);
    if (declaredDemand !== undefined && !(await vault.exists(targetPath))) {
      await writeInstrumentTarget(vault, {
        instrumentId,
        declaredDemand,
        origin: 'paper-handoff',
        questionBinding: await questionBindingOf(entered),
        authoredAt: now(),
        generator: { taskId: item.taskId, promptVersion: item.promptVersion },
      });
      targetWritten = true;
    }
    noteTouched = true;
    await vault.write(target.notePath, content);
  } catch (error) {
    await rollback();
    throw error;
  }
  return { instrumentId, instrumentWritten: true, rollback };
}

/**
 * The demand a handed-off item was authored for, when the paper READ it (`[D-437]` R1, `[D-438]`
 * P1; design `demand-carriage.md` sections 4.1 and 5.1), or `undefined` for every other case, which
 * hands the item off UNSPECIFIED: no record, and never a default put in a reading's place.
 *
 * - **A structured paper (`[D-430]`)**: the basis lives on each part, so the part that slot fills
 *   decides, and the flat account's basis is not consulted. Only a part whose demand status is
 *   `'read'` counts: `'not-read'` and `'cannot-tell'` are no reading, and `'unsupported'` is an
 *   operation outside the vocabulary that never becomes a `declaredDemand` (a slot for it is an
 *   empty slot, so no item of it can be handed off; refused here regardless). A slot with no part is
 *   not read.
 * - **A flat paper**: the composition account's `intendedDemandBasis` is exactly `'read'`. `'default-no-reading'`
 *   is the recall fallback recorded as a default; and a paper written before P1 has no basis at all,
 *   which is never read as `'read'` (legacy stays unspecified, row 36).
 * - **The reading must be the demand the item was authored for.** The record states what the
 *   author was asked (`item.intendedDemand`, carried from the slot). A part that read a different
 *   demand than the one this item was generated under certifies nothing about it, so the item is
 *   unspecified rather than recorded under either word.
 *
 * The basis is read structurally (not through `PaperBlueprint`'s type) so a record written before
 * the field existed, and a hand-edited value, both fall through to unspecified.
 */
function handedOffItemDemand(
  record: PaperRecord,
  item: PaperGeneratedItem,
): PaperDemand | undefined {
  if (record.structure !== undefined) {
    const part = record.structure.parts.find((p) => p.slotId === item.slotId);
    if (part === undefined || part.demand.status !== 'read') return undefined;
    return part.demand.demand === item.intendedDemand ? item.intendedDemand : undefined;
  }
  const { intendedDemandBasis } = record.compositionAccount as {
    readonly intendedDemandBasis?: unknown;
  };
  return intendedDemandBasis === 'read' ? item.intendedDemand : undefined;
}

/**
 * Hands ONE item to ordinary review — never the whole paper (module doc) — and enters it as a real
 * instrument carrying its paper and slot (`[D-407]`). A quiz item enters as one quiz block with the
 * origin on its own `paper-origin:` field; a flashcard item (`cards.generate.v1`) enters as one Q&A
 * card with the origin in its side record (`../instrument/paper-origin-store.ts`; sheet v87 row 5,
 * `ol-egov.141.89.7.114`), since a card's plain-text format has no field line to carry it.
 *
 * In order, and each step idempotent (`[D-391]` binding condition 2: a double press or a retry
 * after restart yields one hand-off and one instrument):
 *
 * 1. The item's question (or card) is read and validated before anything is written. For a card,
 *    the note as it would be written is built in memory first, and an item whose text would not
 *    read back as the same card is refused here, as is a vault that cannot delete (step 4's
 *    take-back needs it).
 * 2. If `target.notePath` already holds the item's instrument (a quiz block with the derived id, or
 *    a card stamped with the derived block id), an earlier call wrote it. A quiz block's
 *    `paper-origin:` is stamped if somehow missing (`stampMcqPaperOrigin`, read-then-mint); a card's
 *    side record is restored if somehow missing; otherwise the note is left byte-identical.
 * 3. Else, if the paper already records this slot as handed off, nothing is written to any note:
 *    the instrument exists (step 4 always precedes step 5) and she may have moved or removed it
 *    since, which a repeated press must not undo.
 * 4. Else the instrument is inserted after the note's frontmatter when it opens with one (the
 *    placement `materialize-mcq.ts` and `materialize-card.ts` use, so the note's concept binding
 *    survives), every other byte of the note untouched. A quiz block carries `id:` and
 *    `paper-origin:` in one write. A card's side record is written first, then the note. When the
 *    paper read this item's demand (`handedOffItemDemand`), its target record (`[D-437]`, origin
 *    `paper-handoff`) is written before the note, once, bound to the instrument as inserted, behind
 *    an exists guard so a retry that an interrupted attempt already reached leaves it untouched.
 * 5. Finally the paper's own hand-off event is recorded (a repeat changes nothing).
 *
 * The note is written before the paper record, so a recorded hand-off always has its instrument.
 * No review-log record is written here (`[D-367]`).
 *
 * **A failed flashcard hand-off takes back what it wrote** (the ruling: "a failed add leaves
 * neither a stray card nor an orphan origin record"). When a write in step 4 or 5 throws, the card
 * is taken out of the note again (only while the note still holds exactly what this call wrote),
 * and the side record and any target record this call wrote are removed; then the failure is
 * thrown. An attempt stopped outright (a crash) cannot take anything back, and a retry converges
 * through steps 2 and 3 instead. A quiz item's hand-off keeps its earlier behaviour: an interrupted
 * attempt leaves its block for the retry to find.
 *
 * **The target record is written on step 4 only, never on a repeat.** A repeat (step 2 or 3) finds
 * the instrument already entered, or the hand-off already recorded, and writes no record: an item
 * handed off before this record existed stays unspecified for good and is never backfilled
 * (`[D-277]` (f); `../instrument/target-store-callers.spec.ts`). An item whose demand the paper did
 * not read (a defaulted basis, a part not read, a paper written before the basis existed) hands
 * off unspecified in the same way.
 */
export async function handOffPaperItem(
  vault: VaultSource,
  paperId: string,
  slotId: string,
  target: PaperHandoffTarget,
  options: PaperStoreOptions = {},
): Promise<PaperHandoffResult> {
  const now = options.now ?? defaultNow;
  return updateExistingPaper(vault, paperId, 'handOffPaperItem', async ({ path, record }) => {
    assertKnownSlot(record, slotId, 'handOffPaperItem');
    const item = record.items.find((i) => i.slotId === slotId);
    if (item === undefined) throw new Error('handOffPaperItem: internal error, slot vanished');
    const entered =
      item.taskId === 'cards.generate.v1'
        ? await enterPaperCard(vault, record, item, paperId, target, now)
        : await enterPaperQuizBlock(vault, record, item, paperId, target, now);
    const { instrumentId, instrumentWritten } = entered;

    const event: PaperItemHandedOffEvent = {
      kind: 'item-handed-off',
      schemaVersion: 1,
      eventId: globalThis.crypto.randomUUID(),
      timestamp: now(),
      paperId,
      slotId,
    };
    const updated = applyPaperEvent(record, event);
    if (updated === undefined || updated === record) {
      return { record, instrumentId, instrumentWritten };
    }
    try {
      await vault.write(path, serialize(updated));
    } catch (error) {
      await entered.rollback?.();
      throw error;
    }
    return { record: updated, instrumentId, instrumentWritten };
  });
}

/**
 * Throws exactly the refusals `handOffPaperItem`'s step 1 would throw for this item, and writes
 * nothing: an unknown paper or slot, a question or card that cannot be read at `questionIndex`, a
 * card whose text would not read back as the same card, and (for a card) a vault that cannot
 * delete. A caller that writes something of its own before the hand-off (the plugin's home note)
 * calls this first, so a refused item leaves nothing behind (`ol-egov.141.89.7.114`).
 */
export async function checkPaperItemHandoff(
  vault: VaultSource,
  paperId: string,
  slotId: string,
  questionIndex: number,
): Promise<void> {
  const hit = (await listPaperRecords(vault)).find(({ record }) => record.id === paperId);
  if (hit === undefined) {
    throw new Error(
      `handOffPaperItem: no existing PaperRecord for id "${paperId}" — never mints one.`,
    );
  }
  assertKnownSlot(hit.record, slotId, 'handOffPaperItem');
  const item = hit.record.items.find((i) => i.slotId === slotId);
  if (item === undefined) throw new Error('handOffPaperItem: internal error, slot vanished');
  if (item.taskId !== 'cards.generate.v1') {
    paperItemMcqCandidate(item, questionIndex);
    return;
  }
  const card = paperItemCardCandidate(item, questionIndex);
  insertPaperCard('', card, await paperItemCardBlockId(paperId, slotId));
  if (vault.delete === undefined) {
    throw new Error(
      'handOffPaperItem: this vault cannot delete files, so a failed flashcard hand-off could not take its origin record back; nothing was written',
    );
  }
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
  return updateExistingPaper(
    vault,
    paperId,
    'recordPaperExplanationResult',
    async ({ path, record }) => {
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
    },
  );
}

/** F8.5's withdrawal, applied to a paper (ruling 6). No production caller yet — see the module doc. */
export async function retirePaper(
  vault: VaultSource,
  paperId: string,
  options: PaperStoreOptions = {},
): Promise<PaperRecord> {
  const now = options.now ?? defaultNow;
  return updateExistingPaper(vault, paperId, 'retirePaper', async ({ path, record }) => {
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
  });
}
