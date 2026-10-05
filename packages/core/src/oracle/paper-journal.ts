/**
 * The practice paper's resumable journal (`[D-430]` part 3, ruled 2026-09-29, decision sheet row 17):
 * what happens when the service cannot be reached partway through composing a paper.
 *
 * **The ruling.** For an operational outage the unfinished paper is RETAINED, not handed over, and
 * the next request drafts only the missing work. The paper is composed from the state at the moment
 * she asks (F4.11), so a journal is resumed only when its four reuse inputs still agree — source
 * versions, scope, structure and authoring specification (`./paper-structure.ts`'s
 * `paperReuseFingerprint`), not merely unchanged course settings — and is discarded, with the
 * changed components named, when any one differs. Nothing completes in the background: a journal
 * moves only when she asks.
 *
 * **Three states a slot can be in, and the one that is never recorded.**
 *
 * - `landed` — the generator answered; the item is kept and never regenerated on resume.
 * - `empty` — a fact about her material: the generator refused (a grounding refusal) or the slot
 *   depends on an empty part. Final, and it qualifies the paper (`completion`, never an outage).
 * - `owed` — the service could not be reached even after the one retry. **Work owed, never an empty
 *   reason**: it is not a claim that her notes lack anything, it is a claim that nobody asked
 *   successfully yet (`[D-438]` condition 2, "service failure stays a distinct outcome end to end").
 *   A paper with any slot owed is not finished and is never created.
 *
 * **Where a partial paper still comes from.** Only a finished journal (every slot landed or empty)
 * becomes a `PaperRecord`, and an explicitly qualified partial (`PaperCompletion`) is the only kind
 * of partial paper there is. A paper with holes because the service was down does not exist.
 *
 * **What the journal stores, and what it does not.** Slot outcomes as they land, the slot plan (ids,
 * concept, task, dependencies), the fingerprint and its digest. It stores no `sourceChunks` and no
 * copy of her material: the resumed request recomposes the blueprint (deterministic for a matching
 * fingerprint) and this journal supplies only what already landed. Landed items are the generated
 * items the finished paper would hold anyway. One JSON file per journal, under the paper store's own
 * folder (`.olea/papers/journals/`), so the F7.4 export and full delete already carry it, and it is
 * never read as a paper (`isPaperRecord` refuses it: no `compositionAccount`, no `items`).
 *
 * **Single writer.** A journal is rewritten whole on each event, like a paper record, and there is
 * no lock: two devices composing the same course at the same moment could each open a journal, and
 * the later open discards the earlier as abandoned. Composition is a foreground act she starts.
 *
 * **Prompt versions never mix inside one paper.** The authoring specification a resumed call runs
 * under must be the one the landed items were written under: if a resumed slot comes back stamped
 * with a different prompt version for the same task, the journal is discarded as
 * `authoring-spec-changed` rather than landing a paper written by two prompts.
 *
 * **Wire notes for the caller** (`packages/plugin/src/paper/provider.ts`, not this lane's file):
 * `requestPaper` composes the blueprint, computes the fingerprint, calls `openPaperJournal`, then
 * `runPaperJournal` with a generator built from the port, then `finalizePaperFromJournal` on
 * `ready`; on `unfinished` it hands over nothing. The port MUST report the three outcomes apart, and
 * the plugin's `createWorkerPaperSlotOutcomePort` (`packages/plugin/src/oracle/paper-item-port.ts`)
 * does: it reads the real Worker envelope through `classifyPaperSlotWorkerResult` below and reports
 * `generated`, `refused` and `unavailable` apart, never throwing. The flat path's adapter,
 * `createWorkerPaperItemGenerationPort`, reads the same envelope through the same classifier, passes
 * `generated` and `refused` through and throws on an outage, so it is not the port for this driver.
 */

import { canonicalJson } from '../outcome/canonical-json.js';
import { listFolder } from '../vault/list-folder.js';
import { withPathQueue } from '../vault/path-queue.js';
import { readStoreRecord } from '../vault/store-record.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { PaperGeneratedItem } from './paper-items.js';
import {
  type CreatePaperInput,
  createPaper,
  listPaperRecords,
  type OpaqueIdNonceSource,
  PAPER_STORE_FOLDER,
  type PaperCompositionAccount,
  type PaperRecord,
  type PaperStoreOptions,
} from './paper-store.js';
import {
  classifyPaperCompletion,
  comparePaperReuseFingerprints,
  paperBlueprintDigest,
} from './paper-structure.js';
import type {
  PaperEmptySlot,
  PaperEmptySlotReasonCode,
  PaperGeneratorTaskId,
  PaperReuseFingerprint,
  PaperStructuredShape,
} from './paper-types.js';

/** The vault folder journals live in — under the paper store's own, so it is already registered for export and full delete (F7.4). */
export const PAPER_JOURNAL_FOLDER: VaultPath = `${PAPER_STORE_FOLDER}/journals`;

/** Marks every id minted here — greppable, distinct from `OPAQUE_PAPER_ID_PREFIX`. */
export const OPAQUE_PAPER_JOURNAL_ID_PREFIX = 'paper-journal-key1';

/** Bumped only on a breaking change to `PaperJournalRecord`. */
export const PAPER_JOURNAL_SCHEMA_VERSION = 1;

/**
 * DECLARED, never fitted: a slot is retried once when the service is unavailable (`[D-430]` part 3:
 * "unavailable after one retry"). One retry bounds the calls a bad afternoon can spend.
 */
export const PAPER_SLOT_RETRIES_DECLARED = 1;

/** One slot of the plan, in authoring order. No source text: the resumed request recomposes it. */
export interface PaperJournalPlanSlot {
  readonly slotId: string;
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly taskId: PaperGeneratorTaskId;
  /** Slots this one states a dependency on; each must appear earlier in the plan. */
  readonly dependsOnSlotIds: readonly string[];
}

export type PaperJournalSlotOutcome =
  | { readonly status: 'landed'; readonly item: PaperGeneratedItem }
  | {
      readonly status: 'empty';
      readonly reasonCode: PaperEmptySlotReasonCode;
      readonly reason: string;
      readonly causedBySlotId?: string;
    }
  /** The service could not be reached after the one retry: work owed, never an empty reason. `attempts` is cumulative across runs. */
  | { readonly status: 'owed'; readonly attempts: number };

export type PaperJournalStatus = 'open' | 'completed' | 'discarded';

export type PaperJournalDiscardReason =
  | 'reuse-incompatible'
  | 'authoring-spec-changed'
  | 'abandoned';

export interface PaperJournalDiscard {
  readonly reason: PaperJournalDiscardReason;
  /** Present on `'reuse-incompatible'`: the fingerprint components that differed. */
  readonly changed?: readonly (keyof PaperReuseFingerprint)[];
}

export interface PaperJournalRecord {
  readonly id: string;
  readonly course: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly fingerprint: PaperReuseFingerprint;
  /** One digest over the four components (scp.md 2.6's blueprint digest). */
  readonly blueprintDigest: string;
  readonly plan: readonly PaperJournalPlanSlot[];
  /** Keyed by slot id; a slot with no entry has not been attempted. */
  readonly outcomes: Readonly<Record<string, PaperJournalSlotOutcome>>;
  readonly status: PaperJournalStatus;
  readonly discard?: PaperJournalDiscard;
  /** Set when the journal was finished into a paper. */
  readonly paperId?: string;
  readonly schemaVersion: number;
}

interface JournalEventCommon {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly timestamp: string;
  readonly journalId: string;
}

export type PaperJournalEvent =
  | (JournalEventCommon & {
      readonly kind: 'opened';
      readonly course: string;
      readonly fingerprint: PaperReuseFingerprint;
      readonly blueprintDigest: string;
      readonly plan: readonly PaperJournalPlanSlot[];
    })
  | (JournalEventCommon & {
      readonly kind: 'slot-landed';
      readonly slotId: string;
      readonly item: PaperGeneratedItem;
    })
  | (JournalEventCommon & {
      readonly kind: 'slot-empty';
      readonly slotId: string;
      readonly reasonCode: PaperEmptySlotReasonCode;
      readonly reason: string;
      readonly causedBySlotId?: string;
    })
  | (JournalEventCommon & {
      readonly kind: 'slot-owed';
      readonly slotId: string;
      readonly attempts: number;
    })
  | (JournalEventCommon & { readonly kind: 'completed'; readonly paperId: string })
  | (JournalEventCommon & {
      readonly kind: 'discarded';
      readonly reason: PaperJournalDiscardReason;
      readonly changed?: readonly (keyof PaperReuseFingerprint)[];
    });

function isFinal(outcome: PaperJournalSlotOutcome | undefined): boolean {
  return outcome?.status === 'landed' || outcome?.status === 'empty';
}

/**
 * The pure fold. `undefined` only when there is no journal and the event is not `opened`: an event
 * against a journal that does not exist is dropped, never invented. A landed or empty slot is final
 * (a later owed or landed event for it changes nothing, so a replayed or duplicated event is
 * harmless); an owed slot is replaced by a later landed or empty one; a slot not in the plan is
 * ignored; a completed or discarded journal accepts nothing further. Returns the same reference
 * when nothing changed.
 */
export function applyPaperJournalEvent(
  existing: PaperJournalRecord | undefined,
  event: PaperJournalEvent,
): PaperJournalRecord | undefined {
  if (event.kind === 'opened') {
    if (existing !== undefined) return existing;
    return {
      id: event.journalId,
      course: event.course,
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      fingerprint: event.fingerprint,
      blueprintDigest: event.blueprintDigest,
      plan: event.plan,
      outcomes: {},
      status: 'open',
      schemaVersion: PAPER_JOURNAL_SCHEMA_VERSION,
    };
  }
  if (existing === undefined || existing.status !== 'open') return existing;

  const touch = (patch: Partial<PaperJournalRecord>): PaperJournalRecord => ({
    ...existing,
    ...patch,
    updatedAt: event.timestamp,
  });

  if (event.kind === 'completed') return touch({ status: 'completed', paperId: event.paperId });
  if (event.kind === 'discarded') {
    return touch({
      status: 'discarded',
      discard: {
        reason: event.reason,
        ...(event.changed !== undefined ? { changed: event.changed } : {}),
      },
    });
  }

  if (!existing.plan.some((slot) => slot.slotId === event.slotId)) return existing;
  if (isFinal(existing.outcomes[event.slotId])) return existing;
  let outcome: PaperJournalSlotOutcome;
  if (event.kind === 'slot-landed') outcome = { status: 'landed', item: event.item };
  else if (event.kind === 'slot-empty') {
    outcome = {
      status: 'empty',
      reasonCode: event.reasonCode,
      reason: event.reason,
      ...(event.causedBySlotId !== undefined ? { causedBySlotId: event.causedBySlotId } : {}),
    };
  } else outcome = { status: 'owed', attempts: event.attempts };
  return touch({ outcomes: { ...existing.outcomes, [event.slotId]: outcome } });
}

/** The slots that still have work owed: every plan slot that is neither landed nor empty, in plan order. */
export function paperJournalOwedSlotIds(journal: PaperJournalRecord): readonly string[] {
  return journal.plan
    .filter((slot) => !isFinal(journal.outcomes[slot.slotId]))
    .map((slot) => slot.slotId);
}

export function paperJournalPath(id: string): VaultPath {
  return `${PAPER_JOURNAL_FOLDER}/${encodeURIComponent(id)}.json`;
}

function serialize(record: PaperJournalRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime validation, shallow like `isPaperRecord`. Refuses a paper record: a journal has a `plan` and `outcomes`, a paper has `items`. */
export function isPaperJournalRecord(value: unknown): value is PaperJournalRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.course)) return false;
  if (!isNonEmptyString(v.createdAt) || !isNonEmptyString(v.updatedAt)) return false;
  if (!isNonEmptyString(v.blueprintDigest)) return false;
  if (typeof v.fingerprint !== 'object' || v.fingerprint === null) return false;
  const fp = v.fingerprint as Record<string, unknown>;
  for (const key of ['sourceVersions', 'scope', 'structure', 'authoringSpec']) {
    if (!isNonEmptyString(fp[key])) return false;
  }
  if (!Array.isArray(v.plan)) return false;
  if (typeof v.outcomes !== 'object' || v.outcomes === null || Array.isArray(v.outcomes))
    return false;
  if (v.status !== 'open' && v.status !== 'completed' && v.status !== 'discarded') return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

/** Every valid journal under `.olea/papers/journals/`. A corrupt or unreadable file is skipped, never thrown on. */
export async function listPaperJournals(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly record: PaperJournalRecord }[]> {
  const paths = await listFolder(vault, PAPER_JOURNAL_FOLDER, { extensions: ['json'] });
  const out: { readonly path: VaultPath; readonly record: PaperJournalRecord }[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isPaperJournalRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable: skipped.
    }
  }
  return out;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function eventBase(journalId: string, options: PaperStoreOptions): JournalEventCommon {
  return {
    schemaVersion: 1,
    eventId: globalThis.crypto.randomUUID(),
    timestamp: (options.now ?? defaultNow)(),
    journalId,
  };
}

async function loadJournal(
  vault: VaultSource,
  journalId: string,
  fnName: string,
): Promise<PaperJournalRecord> {
  const path = paperJournalPath(journalId);
  if (await vault.exists(path)) {
    const parsed: unknown = JSON.parse(await vault.read(path));
    if (isPaperJournalRecord(parsed)) return parsed;
  }
  throw new Error(`${fnName}: no journal "${journalId}" — never mints one.`);
}

/**
 * Folds one event into the stored journal and writes it back only if something changed.
 *
 * The fold reads the journal file again, as one task on its queue (`../vault/path-queue.ts`,
 * `ol-egov.141.89.104.2`), rather than folding onto the caller's copy: a run holds its copy across
 * slow drafting work, and folding onto it would write back a journal that lacks whatever another
 * task recorded meanwhile (a discard, say). `journal` names the file; a journal that is gone or no
 * longer reads as one is refused, never recreated from the caller's copy.
 */
async function appendJournalEvent(
  vault: VaultSource,
  journal: PaperJournalRecord,
  event: PaperJournalEvent,
): Promise<PaperJournalRecord> {
  const path = paperJournalPath(journal.id);
  return withPathQueue(path, async () => {
    const fresh = await readStoreRecord(vault, path, isPaperJournalRecord);
    if (fresh.kind !== 'record' || fresh.record.id !== journal.id) {
      throw new Error(`appendJournalEvent: journal "${journal.id}" is no longer readable on disk.`);
    }
    const current = fresh.record;
    const updated = applyPaperJournalEvent(current, event);
    if (updated === undefined || updated === current) return current;
    await vault.write(path, serialize(updated));
    return updated;
  });
}

function assertDependencyOrder(plan: readonly PaperJournalPlanSlot[]): void {
  const seen = new Set<string>();
  for (const slot of plan) {
    if (seen.has(slot.slotId)) {
      throw new Error(`openPaperJournal: plan lists slot "${slot.slotId}" twice`);
    }
    for (const dependency of slot.dependsOnSlotIds) {
      if (!seen.has(dependency)) {
        throw new Error(
          `openPaperJournal: plan is not in dependency order ("${slot.slotId}" precedes what it depends on)`,
        );
      }
    }
    seen.add(slot.slotId);
  }
}

export interface OpenPaperJournalInput {
  readonly course: string;
  readonly fingerprint: PaperReuseFingerprint;
  /** In authoring (dependency) order. */
  readonly plan: readonly PaperJournalPlanSlot[];
}

export type PaperJournalOpenDecision = 'fresh' | 'resumed' | 'discarded-and-fresh';

export interface PaperJournalOpenResult {
  readonly decision: PaperJournalOpenDecision;
  readonly journal: PaperJournalRecord;
  /** Journals set aside by this call, with the components that differed (empty for a plain fresh start). */
  readonly discarded?: readonly {
    readonly journalId: string;
    readonly changed: readonly (keyof PaperReuseFingerprint)[];
  }[];
}

/**
 * Finds what to do with an unfinished paper when she asks again for `input.course`:
 *
 * - an OPEN journal for the course whose four fingerprint components all match, and whose stored
 *   plan is the plan now proposed, is RESUMED (`'resumed'`) — the caller then drafts only the
 *   missing slots;
 * - an open journal that differs in any component is DISCARDED, naming the components, and a fresh
 *   one is opened (`'discarded-and-fresh'`);
 * - none: a fresh one (`'fresh'`).
 *
 * Other open journals for the same course (a second device's, an earlier abandoned one) are set
 * aside as abandoned, so one course has one open journal. A journal for another course is never
 * touched.
 */
export async function openPaperJournal(
  vault: VaultSource,
  input: OpenPaperJournalInput,
  options: PaperStoreOptions = {},
): Promise<PaperJournalOpenResult> {
  assertDependencyOrder(input.plan);
  const blueprintDigest = await paperBlueprintDigest(input.fingerprint);
  const planText = canonicalJson(input.plan);

  const openForCourse = (await listPaperJournals(vault))
    .map((entry) => entry.record)
    .filter((record) => record.course === input.course && record.status === 'open')
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  const discarded: { journalId: string; changed: readonly (keyof PaperReuseFingerprint)[] }[] = [];
  let resumed: PaperJournalRecord | undefined;
  for (const record of openForCourse) {
    const comparison = comparePaperReuseFingerprints(record.fingerprint, input.fingerprint);
    const samePlan = canonicalJson(record.plan) === planText;
    if (resumed === undefined && comparison.compatible && samePlan) {
      resumed = record;
      continue;
    }
    // A matching fingerprint over a different plan means the caller's fingerprint did not cover
    // the plan: name it a structure change rather than trust it.
    const changed: readonly (keyof PaperReuseFingerprint)[] = comparison.compatible
      ? samePlan
        ? []
        : ['structure']
      : comparison.changed;
    const isDuplicateOfCompatible = comparison.compatible && samePlan;
    await appendJournalEvent(vault, record, {
      ...eventBase(record.id, options),
      kind: 'discarded',
      reason: isDuplicateOfCompatible ? 'abandoned' : 'reuse-incompatible',
      ...(isDuplicateOfCompatible ? {} : { changed }),
    });
    discarded.push({ journalId: record.id, changed });
  }

  if (resumed !== undefined) {
    return {
      decision: 'resumed',
      journal: resumed,
      ...(discarded.length > 0 ? { discarded } : {}),
    };
  }

  const nonce: OpaqueIdNonceSource = options.generateId ?? (() => globalThis.crypto.randomUUID());
  const journalId = `${OPAQUE_PAPER_JOURNAL_ID_PREFIX}:${nonce()}`;
  const opened = applyPaperJournalEvent(undefined, {
    ...eventBase(journalId, options),
    kind: 'opened',
    course: input.course,
    fingerprint: input.fingerprint,
    blueprintDigest,
    plan: input.plan,
  });
  if (opened === undefined)
    throw new Error('openPaperJournal: an opened event produced no journal');
  const openedPath = paperJournalPath(opened.id);
  await withPathQueue(openedPath, () => vault.write(openedPath, serialize(opened)));
  const incompatibleDiscards = discarded.filter((d) => d.changed.length > 0);
  return {
    decision: incompatibleDiscards.length > 0 ? 'discarded-and-fresh' : 'fresh',
    journal: opened,
    ...(discarded.length > 0 ? { discarded } : {}),
  };
}

/** Sets an open journal aside. A journal that is already completed or discarded is left as it is. */
export async function discardPaperJournal(
  vault: VaultSource,
  journalId: string,
  discard: PaperJournalDiscard,
  options: PaperStoreOptions = {},
): Promise<PaperJournalRecord> {
  const journal = await loadJournal(vault, journalId, 'discardPaperJournal');
  return appendJournalEvent(vault, journal, {
    ...eventBase(journalId, options),
    kind: 'discarded',
    reason: discard.reason,
    ...(discard.changed !== undefined ? { changed: discard.changed } : {}),
  });
}

// --------------------------------------------------------------------------------------------
// The generation seam and the run
// --------------------------------------------------------------------------------------------

/** What the generator is asked for one slot: the slot, and the landed items of the parts it states a dependency on. */
export interface PaperSlotGenerationRequest {
  readonly slot: PaperJournalPlanSlot;
  readonly dependencyItems: readonly PaperGeneratedItem[];
}

/**
 * The three ways a slot's generation can end, apart:
 * `generated` (an item), `refused` (the generator declined to invent — a grounding refusal, a fact
 * about her material) and `unavailable` (the service could not be reached or answered unusably —
 * an outage). `reason` is a short structural string (D-005: no content).
 */
export type PaperSlotGenerationOutcome =
  | { readonly status: 'generated'; readonly item: PaperGeneratedItem }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly reason: string };

export type PaperSlotGenerator = (
  request: PaperSlotGenerationRequest,
) => Promise<PaperSlotGenerationOutcome>;

/** The result of classifying one Worker body, before an item is built from it. */
export type PaperSlotWorkerResult =
  | { readonly status: 'generated'; readonly promptVersion: string; readonly response: unknown }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly reason: string };

/**
 * Reads the REAL Worker envelope (`olea-contracts`' `workerResponse`: `{ ok: true, stamp, result }`
 * or `{ ok: false, code, message }`) into the three outcomes.
 *
 * - `ok: true` with a stamped prompt version: `generated`, the whole body kept as the item's
 *   response (`paperItemMcqCandidate` reads `result` off it). No stamp means the D7.3 provenance
 *   cannot be recorded, so it is `unavailable` (`no-stamp`), never a guessed version.
 * - `grounding-refused`: `refused` — the one code that is a fact about her material ("a success of
 *   the system", worker.ts).
 * - every other code, and any malformed body: `unavailable`. An upstream failure, a quota, an
 *   expired token, a plugin below the floor, a bad request — none of these says anything about her
 *   notes, so none may become an empty slot.
 *
 * This is the one envelope reader: the plugin's `createWorkerPaperSlotOutcomePort` and
 * `createWorkerPaperItemGenerationPort` (`packages/plugin/src/oracle/paper-item-port.ts`) both read
 * a body through it and add no second reader. (An earlier version of the flat adapter checked
 * `{ success, error }`, which is not this envelope, so a real error body fell through to
 * `generated`; that is fixed, `ol-egov.141.89.7.29`.)
 */
export function classifyPaperSlotWorkerResult(body: unknown): PaperSlotWorkerResult {
  if (typeof body !== 'object' || body === null) {
    return { status: 'unavailable', reason: 'malformed-response' };
  }
  const envelope = body as Record<string, unknown>;
  if (envelope.ok === true) {
    const stamp = envelope.stamp;
    const promptVersion =
      typeof stamp === 'object' && stamp !== null
        ? (stamp as Record<string, unknown>).promptVersion
        : undefined;
    if (!isNonEmptyString(promptVersion)) return { status: 'unavailable', reason: 'no-stamp' };
    return { status: 'generated', promptVersion, response: body };
  }
  if (envelope.ok === false) {
    const code = envelope.code;
    if (code === 'grounding-refused') return { status: 'refused', reason: 'grounding-refused' };
    return { status: 'unavailable', reason: isNonEmptyString(code) ? code : 'unknown-error' };
  }
  return { status: 'unavailable', reason: 'malformed-response' };
}

export interface RunPaperJournalInput {
  readonly generate: PaperSlotGenerator;
  /** Retries after an `unavailable` answer. Defaults to `PAPER_SLOT_RETRIES_DECLARED` (one). */
  readonly retries?: number;
}

export type PaperJournalRunResult =
  /** Every slot is landed or empty: the journal may be finished into a paper. */
  | { readonly kind: 'ready'; readonly journal: PaperJournalRecord }
  /** The service was unavailable after the retry: work is owed, the paper is not handed over, the journal is kept. */
  | {
      readonly kind: 'unfinished';
      readonly journal: PaperJournalRecord;
      readonly owedSlotIds: readonly string[];
    }
  /** A resumed slot came back under a different prompt version than the landed items: the journal was discarded. */
  | {
      readonly kind: 'authoring-spec-changed';
      readonly journal: PaperJournalRecord;
      readonly taskId: PaperGeneratorTaskId;
    };

function landedPromptVersionFor(
  journal: PaperJournalRecord,
  taskId: PaperGeneratorTaskId,
): string | undefined {
  for (const slot of journal.plan) {
    const outcome = journal.outcomes[slot.slotId];
    if (outcome?.status === 'landed' && outcome.item.taskId === taskId)
      return outcome.item.promptVersion;
  }
  return undefined;
}

/**
 * Drafts what the journal still owes, in plan (dependency) order, persisting each slot's outcome
 * the moment it lands so a crash loses at most the call in flight.
 *
 * Per slot: an outcome already landed or empty is skipped (a resume never regenerates); a slot
 * whose stated dependency ended empty is recorded `depends-on-empty-part` without a call (never
 * filled standalone); a slot whose dependency is still owed cannot proceed and ends the run; else
 * the generator is called with the dependency items, retried up to `retries` times on
 * `unavailable`. `generated` lands (after the prompt-version check), `refused` records
 * `generator-refused`, and an `unavailable` that survives the retry records the slot as owed and
 * STOPS the run: an outage is unlikely to end mid-run, so continuing would spend calls to learn the
 * same thing, while everything that already landed is kept for the next request. A generator that
 * throws counts as unavailable.
 */
export async function runPaperJournal(
  vault: VaultSource,
  journalId: string,
  input: RunPaperJournalInput,
  options: PaperStoreOptions = {},
): Promise<PaperJournalRunResult> {
  let journal = await loadJournal(vault, journalId, 'runPaperJournal');
  if (journal.status !== 'open') {
    throw new Error(`runPaperJournal: journal "${journalId}" is ${journal.status}, not open.`);
  }
  const retries = Math.max(0, input.retries ?? PAPER_SLOT_RETRIES_DECLARED);

  for (const slot of journal.plan) {
    if (isFinal(journal.outcomes[slot.slotId])) continue;

    const dependencyOutcomes = slot.dependsOnSlotIds.map((id) => ({
      id,
      outcome: journal.outcomes[id],
    }));
    const emptyDependency = dependencyOutcomes.find((d) => d.outcome?.status === 'empty');
    if (emptyDependency !== undefined) {
      const dependency = emptyDependency.outcome;
      const root =
        dependency?.status === 'empty' &&
        dependency.reasonCode === 'depends-on-empty-part' &&
        dependency.causedBySlotId !== undefined
          ? dependency.causedBySlotId
          : emptyDependency.id;
      journal = await appendJournalEvent(vault, journal, {
        ...eventBase(journal.id, options),
        kind: 'slot-empty',
        slotId: slot.slotId,
        reasonCode: 'depends-on-empty-part',
        reason: 'the part depends on an earlier part that ended empty',
        causedBySlotId: root,
      });
      continue;
    }
    const dependencyItems: PaperGeneratedItem[] = [];
    let dependencyOwed = false;
    for (const { outcome } of dependencyOutcomes) {
      if (outcome?.status === 'landed') dependencyItems.push(outcome.item);
      else dependencyOwed = true;
    }
    if (dependencyOwed) break;

    let outcome: PaperSlotGenerationOutcome = { status: 'unavailable', reason: 'not-attempted' };
    let made = 0;
    while (made <= retries) {
      made += 1;
      try {
        outcome = await input.generate({ slot, dependencyItems });
      } catch {
        outcome = { status: 'unavailable', reason: 'threw' };
      }
      if (outcome.status !== 'unavailable') break;
    }

    if (outcome.status === 'unavailable') {
      const previous = journal.outcomes[slot.slotId];
      const attempts = (previous?.status === 'owed' ? previous.attempts : 0) + made;
      journal = await appendJournalEvent(vault, journal, {
        ...eventBase(journal.id, options),
        kind: 'slot-owed',
        slotId: slot.slotId,
        attempts,
      });
      break;
    }
    if (outcome.status === 'refused') {
      journal = await appendJournalEvent(vault, journal, {
        ...eventBase(journal.id, options),
        kind: 'slot-empty',
        slotId: slot.slotId,
        reasonCode: 'generator-refused',
        reason: `generator refused: ${outcome.reason}`,
      });
      continue;
    }

    const landedVersion = landedPromptVersionFor(journal, outcome.item.taskId);
    if (landedVersion !== undefined && landedVersion !== outcome.item.promptVersion) {
      journal = await appendJournalEvent(vault, journal, {
        ...eventBase(journal.id, options),
        kind: 'discarded',
        reason: 'authoring-spec-changed',
      });
      return { kind: 'authoring-spec-changed', journal, taskId: outcome.item.taskId };
    }
    journal = await appendJournalEvent(vault, journal, {
      ...eventBase(journal.id, options),
      kind: 'slot-landed',
      slotId: slot.slotId,
      item: outcome.item,
    });
  }

  const owedSlotIds = paperJournalOwedSlotIds(journal);
  return owedSlotIds.length === 0
    ? { kind: 'ready', journal }
    : { kind: 'unfinished', journal, owedSlotIds };
}

// --------------------------------------------------------------------------------------------
// Finishing
// --------------------------------------------------------------------------------------------

/** Thrown by `finalizePaperFromJournal` while any slot is still owed: an unfinished paper is never created. */
export class PaperJournalUnfinishedError extends Error {
  readonly owedSlotIds: readonly string[];
  constructor(journalId: string, owedSlotIds: readonly string[]) {
    super(
      `finalizePaperFromJournal: journal "${journalId}" still owes ${owedSlotIds.length} slot(s); an unfinished paper is not handed over.`,
    );
    this.name = 'PaperJournalUnfinishedError';
    this.owedSlotIds = owedSlotIds;
  }
}

export interface FinalizePaperFromJournalInput {
  readonly asOf: string;
  readonly compositionAccount: PaperCompositionAccount;
  /** The empty slots the blueprint itself decided before any call (rank exclusion, unserved demand, no held source, no held stimulus): recomputed by the resumed request, identical for a matching fingerprint. */
  readonly planTimeEmptySlots: readonly PaperEmptySlot[];
  readonly structure?: PaperStructuredShape;
}

/**
 * Turns a FINISHED journal (every slot landed or empty) into the paper, exactly once.
 *
 * Items are the landed slots in plan order; empty slots are the blueprint's plan-time empties
 * followed by the journal's, in plan order; `completion` is `classifyPaperCompletion` over all of
 * them — complete, or a qualified partial naming its gaps. Idempotent: a journal already completed
 * returns its paper; a paper already written for this journal (a crash between the write and the
 * journal's own completion) is found by its `journalId` and reused, never minted twice. Throws
 * `PaperJournalUnfinishedError` while anything is owed, and refuses a discarded journal.
 */
export async function finalizePaperFromJournal(
  vault: VaultSource,
  journalId: string,
  input: FinalizePaperFromJournalInput,
  options: PaperStoreOptions = {},
): Promise<PaperRecord> {
  let journal = await loadJournal(vault, journalId, 'finalizePaperFromJournal');
  if (journal.status === 'discarded') {
    throw new Error(`finalizePaperFromJournal: journal "${journalId}" was discarded.`);
  }

  const existing = (await listPaperRecords(vault)).find(
    ({ record }) => record.journalId === journalId,
  );
  if (existing !== undefined) {
    if (journal.status === 'open') {
      await appendJournalEvent(vault, journal, {
        ...eventBase(journal.id, options),
        kind: 'completed',
        paperId: existing.record.id,
      });
    }
    return existing.record;
  }

  const owed = paperJournalOwedSlotIds(journal);
  if (owed.length > 0) throw new PaperJournalUnfinishedError(journalId, owed);

  const items: PaperGeneratedItem[] = [];
  const journalEmpties: PaperEmptySlot[] = [];
  for (const slot of journal.plan) {
    const outcome = journal.outcomes[slot.slotId];
    if (outcome?.status === 'landed') items.push(outcome.item);
    else if (outcome?.status === 'empty') {
      journalEmpties.push({
        slotId: slot.slotId,
        conceptKey: slot.conceptKey,
        conceptName: slot.conceptName,
        reasonCode: outcome.reasonCode,
        reason: outcome.reason,
        ...(outcome.causedBySlotId !== undefined ? { causedBySlotId: outcome.causedBySlotId } : {}),
      });
    }
  }
  const emptySlots = [...input.planTimeEmptySlots, ...journalEmpties];

  const create: CreatePaperInput = {
    course: journal.course,
    asOf: input.asOf,
    compositionAccount: input.compositionAccount,
    items,
    emptySlots,
    completion: classifyPaperCompletion(emptySlots),
    journalId,
    ...(input.structure !== undefined ? { structure: input.structure } : {}),
  };
  const paper = await createPaper(vault, create, options);
  journal = await appendJournalEvent(vault, journal, {
    ...eventBase(journal.id, options),
    kind: 'completed',
    paperId: paper.id,
  });
  return paper;
}
