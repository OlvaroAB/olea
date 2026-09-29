/**
 * The unresolved composition writes (`ol-egov.141.89.10.97`, David's ruling 2026-09-29, row 52
 * of the decision sheet): what is left when a composition record cannot be written, and how a
 * restart finishes the job.
 *
 * **Why this exists.** `./composition-recorder.ts` retries a failed write under the composition's
 * own identity, bounded, and serves reviews meanwhile stamped with the id the record will be
 * written under (`[D-395]` condition 5). Before this module the queue of unwritten records lived
 * in memory only: when the bound was exhausted, or the plugin restarted first, the record was gone
 * and every review already stamped with its id named nothing. The ruling: bound the immediate
 * retries, keep the reference stable, leave an **explicit unresolved write state** when the bound
 * runs out rather than silently discarding the provenance, and define idempotent reconciliation
 * and recovery after a restart.
 *
 * **Where the state lives: Olea's own layer, beside the log it belongs to.** One append-only
 * journal per device, `unresolved.<deviceId>.jsonl` inside the composition folder
 * (`../../../core/src/study-session/composition-log.ts`'s `COMPOSITION_LOG_FOLDER`). It is a
 * sibling file of the daily logs, not a new folder, so F7.4's export, the full delete and the
 * write seal already cover it (`../privacy/log-discovery.ts` registers the folder), and no reader
 * of the composition log sees it (`readCompositionLog` reads only `<day>.<device>.jsonl`).
 * Nothing outside `.olea/` is ever touched (INV-6): her notes are not read for this, let alone
 * written.
 *
 * **Two entry kinds, append-only, never rewritten** (the composition log's own discipline; a
 * partial trailing line from an interrupted append survives as a prefix and is closed off by the
 * next append, INV-2):
 * - `unresolved`: the whole record that could not be written, in its canonical serialization
 *   (`serializeCompositionRecord`, so no second shape of a composition record exists), and a
 *   `state`: `retrying` (a write failed, the bound is not yet spent) or `exhausted` (the bound is
 *   spent; nothing more is tried in this run of the plugin).
 * - `resolved`: the record's `compositionId`, appended once its record is in the daily log.
 *
 * A write is **open** while its latest `unresolved` line has no `resolved` line. A `resolved` line
 * is terminal: the id is in the daily log, and nothing folds it open again.
 *
 * **Reconciliation, at plugin start** ({@link reconcileUnresolvedCompositionWrites}): for each
 * open write, in journal order, find its record in its daily file by id; append it there only when
 * it is not found; then append the `resolved` line. Every step is safe to repeat:
 * - a write that landed but reported failure is found by id and never appended a second time;
 * - a crash between landing the record and marking it is completed by the next run;
 * - a second run finds nothing open and writes nothing;
 * - a record that fails again stays open, and so does every later record of the same session (an
 *   extension is never written ahead of the record it grew: the daily file's order is the
 *   session's order, `compositionRecordsOfSession`);
 * - no id is minted anywhere in this module: a record lands under the identity it was built with.
 *
 * **Data only.** Nothing here has wording, and nothing here is shown to her: no clause defines a
 * surface for an unresolved write (`ol-egov.141.89.10.97` records the gap). The summaries carry
 * ids, a kind, a time and a state, never a sentence and never a reason. Counts in the report, no
 * ids (D-005).
 */

import type { VaultPath, VaultSource } from 'olea-core';
import { isValidDeviceId } from 'olea-core';
import {
  appendCompositionRecord,
  COMPOSITION_LOG_FOLDER,
  compositionLogPath,
  readCompositionLog,
  resolveCompositionRecord,
} from '../../../core/src/study-session/composition-log.js';
import {
  type CompositionKind,
  type CompositionRecord,
  parseCompositionLog,
  parseCompositionRecord,
  serializeCompositionRecord,
} from '../../../core/src/study-session/composition-record.js';

/** Bumped only on a breaking change to a journal line; a reader never guesses at a version it does not know. */
export const UNRESOLVED_WRITES_SCHEMA_VERSION = 1;

/** `retrying`: a write failed and the bound is not spent. `exhausted`: the bound is spent for this run of the plugin. */
export const UNRESOLVED_WRITE_STATES = ['retrying', 'exhausted'] as const;
export type UnresolvedWriteState = (typeof UNRESOLVED_WRITE_STATES)[number];

/**
 * The journal of one device's unresolved writes, beside its daily composition logs. Throws on a
 * malformed device id, like `compositionLogPath`.
 */
export function unresolvedCompositionWritesPath(deviceId: string): VaultPath {
  if (!isValidDeviceId(deviceId)) {
    throw new Error(
      `unresolvedCompositionWritesPath: not a valid device id: ${JSON.stringify(deviceId)}`,
    );
  }
  return `${COMPOSITION_LOG_FOLDER}/unresolved.${deviceId}.jsonl`;
}

/** One composition write that has not landed, as data: ids, a kind, a time and a state. */
export interface UnresolvedCompositionWrite {
  readonly compositionId: string;
  readonly sessionId: string;
  readonly kind: CompositionKind;
  readonly composedAt: string;
  readonly state: UnresolvedWriteState;
}

/** An open write with the record it will write: what reconciliation needs, never shown. */
export interface OpenUnresolvedCompositionWrite extends UnresolvedCompositionWrite {
  readonly record: CompositionRecord;
}

export function summarizeUnresolvedWrite(
  record: CompositionRecord,
  state: UnresolvedWriteState,
): UnresolvedCompositionWrite {
  return {
    compositionId: record.compositionId,
    sessionId: record.sessionId,
    kind: record.kind,
    composedAt: record.composedAt,
    state,
  };
}

// ---------------------------------------------------------------------------
// The journal's lines
// ---------------------------------------------------------------------------

function unresolvedLine(record: CompositionRecord, state: UnresolvedWriteState): string {
  // The record is embedded as its own canonical line, so the journal states it byte for byte as
  // the daily log will.
  const embedded = serializeCompositionRecord(record).trimEnd();
  return `{"schemaVersion":${UNRESOLVED_WRITES_SCHEMA_VERSION},"entry":"unresolved","state":"${state}","record":${embedded}}\n`;
}

function resolvedLine(compositionId: string): string {
  return `{"schemaVersion":${UNRESOLVED_WRITES_SCHEMA_VERSION},"entry":"resolved","compositionId":${JSON.stringify(compositionId)}}\n`;
}

type JournalEntry =
  | {
      readonly entry: 'unresolved';
      readonly state: UnresolvedWriteState;
      readonly record: CompositionRecord;
    }
  | { readonly entry: 'resolved'; readonly compositionId: string };

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function parseJournalLine(json: unknown): JournalEntry | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const line = json as Record<string, unknown>;
  if (line.schemaVersion !== UNRESOLVED_WRITES_SCHEMA_VERSION) return null;
  if (line.entry === 'resolved') {
    if (!hasExactKeys(line, ['schemaVersion', 'entry', 'compositionId'])) return null;
    if (typeof line.compositionId !== 'string' || line.compositionId === '') return null;
    return { entry: 'resolved', compositionId: line.compositionId };
  }
  if (line.entry === 'unresolved') {
    if (!hasExactKeys(line, ['schemaVersion', 'entry', 'state', 'record'])) return null;
    const state = UNRESOLVED_WRITE_STATES.find((known) => known === line.state);
    if (state === undefined) return null;
    const record = parseCompositionRecord(line.record);
    if (record === null) return null;
    return { entry: 'unresolved', state, record };
  }
  return null;
}

export interface ReadUnresolvedCompositionWritesResult {
  /** Every write still open, in the order it was first journaled (a session's records in append order). */
  readonly open: readonly OpenUnresolvedCompositionWrite[];
  /** Journal lines this build could not read (a torn append, a newer schema): a count, never their text. They are left where they are. */
  readonly invalidLineCount: number;
}

/**
 * Folds one device's journal: a write is open until a `resolved` line names it. An empty or absent
 * journal is nothing open. Throws only when the vault itself cannot be read.
 */
export async function readUnresolvedCompositionWrites(
  vault: VaultSource,
  deviceId: string,
): Promise<ReadUnresolvedCompositionWritesResult> {
  const path = unresolvedCompositionWritesPath(deviceId);
  if (!(await vault.exists(path))) return { open: [], invalidLineCount: 0 };
  const lines = (await vault.read(path)).split('\n');
  const open = new Map<string, OpenUnresolvedCompositionWrite>();
  const resolved = new Set<string>();
  let invalidLineCount = 0;
  lines.forEach((rawLine, index) => {
    if (index === lines.length - 1 && rawLine === '') return;
    const text = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (text.trim() === '') return;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      invalidLineCount += 1;
      return;
    }
    const entry = parseJournalLine(json);
    if (entry === null) {
      invalidLineCount += 1;
      return;
    }
    if (entry.entry === 'resolved') {
      resolved.add(entry.compositionId);
      open.delete(entry.compositionId);
      return;
    }
    if (resolved.has(entry.record.compositionId)) return;
    open.set(entry.record.compositionId, {
      ...summarizeUnresolvedWrite(entry.record, entry.state),
      record: entry.record,
    });
  });
  return { open: [...open.values()], invalidLineCount };
}

/** Appends one line to the journal, closing off a torn trailing line first. `true` when it landed; never throws. */
async function appendJournalLine(
  vault: VaultSource,
  deviceId: string,
  line: string,
): Promise<boolean> {
  try {
    const path = unresolvedCompositionWritesPath(deviceId);
    const existing = (await vault.exists(path)) ? await vault.read(path) : '';
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? `${existing}\n` : existing;
    await vault.write(path, prefix + line);
    return true;
  } catch {
    return false;
  }
}

/**
 * Journals `record` as an unresolved write in `state`. `true` when the line landed; `false` when
 * the vault refused it, in which case the state is still held in memory by the caller and the
 * next failure tries again. Never throws.
 */
export function journalUnresolvedCompositionWrite(
  vault: VaultSource,
  deviceId: string,
  record: CompositionRecord,
  state: UnresolvedWriteState,
): Promise<boolean> {
  return appendJournalLine(vault, deviceId, unresolvedLine(record, state));
}

/** Marks `compositionId`'s write resolved: its record is in the daily log. `true` when the line landed; never throws. */
export function journalResolvedCompositionWrite(
  vault: VaultSource,
  deviceId: string,
  compositionId: string,
): Promise<boolean> {
  return appendJournalLine(vault, deviceId, resolvedLine(compositionId));
}

/**
 * Whether `record`'s id is already in its daily file for this device: how a retry, and a
 * reconciliation, tell a write that landed but reported failure from one that never landed. Throws
 * when the vault cannot be read; the caller treats that as a failed attempt.
 */
export async function compositionRecordLanded(
  vault: VaultSource,
  deviceId: string,
  record: CompositionRecord,
): Promise<boolean> {
  const path = compositionLogPath(record.composedAt.slice(0, 10), deviceId);
  if (!(await vault.exists(path))) return false;
  const { records } = parseCompositionLog(await vault.read(path));
  return records.some((landed) => landed.compositionId === record.compositionId);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface CompositionReconciliationDeps {
  readonly vault: VaultSource;
  /** This install's device id: the journal and the daily files are its own. */
  readonly deviceId: string;
}

/** What one reconciliation did, as counts only: no id, no time, no text. */
export interface CompositionReconciliationReport {
  /** Open writes found in the journal. */
  readonly examined: number;
  /** Found already in the daily log (a write that landed but reported failure, or a crash before the mark). */
  readonly alreadyLanded: number;
  /** Appended to the daily log by this run. */
  readonly written: number;
  /** Still open after this run: their write failed again, or an earlier record of their session did. */
  readonly stillUnresolved: number;
  /** Journal lines this build could not read, left as they are. */
  readonly invalidLines: number;
}

const NOTHING_TO_DO: CompositionReconciliationReport = {
  examined: 0,
  alreadyLanded: 0,
  written: 0,
  stillUnresolved: 0,
  invalidLines: 0,
};

// One pass at a time per vault and device: a second start-up call shares the running one.
const inFlight = new WeakMap<VaultSource, Map<string, Promise<CompositionReconciliationReport>>>();

/**
 * Finds this device's unresolved composition writes and lands each record under the identity it
 * was built with, once. Meant to run at plugin start (`main.ts`'s `onload`), and safe to run at any
 * other time and any number of times: see the module doc for why every step is idempotent. Never
 * throws: a vault that cannot be read leaves everything as it was for the next start.
 */
export function reconcileUnresolvedCompositionWrites(
  deps: CompositionReconciliationDeps,
): Promise<CompositionReconciliationReport> {
  let byDevice = inFlight.get(deps.vault);
  if (byDevice === undefined) {
    byDevice = new Map();
    inFlight.set(deps.vault, byDevice);
  }
  const running = byDevice.get(deps.deviceId);
  if (running !== undefined) return running;
  const pass = reconcile(deps).finally(() => byDevice.delete(deps.deviceId));
  byDevice.set(deps.deviceId, pass);
  return pass;
}

async function reconcile(
  deps: CompositionReconciliationDeps,
): Promise<CompositionReconciliationReport> {
  let read: ReadUnresolvedCompositionWritesResult;
  try {
    read = await readUnresolvedCompositionWrites(deps.vault, deps.deviceId);
  } catch {
    return NOTHING_TO_DO;
  }
  let alreadyLanded = 0;
  let written = 0;
  let stillUnresolved = 0;
  // A session whose earlier record did not land holds back its later ones.
  const heldSessions = new Set<string>();
  for (const write of read.open) {
    if (heldSessions.has(write.sessionId)) {
      stillUnresolved += 1;
      continue;
    }
    try {
      if (await compositionRecordLanded(deps.vault, deps.deviceId, write.record)) {
        alreadyLanded += 1;
      } else {
        await appendCompositionRecord(deps.vault, write.record, deps.deviceId);
        written += 1;
      }
    } catch {
      heldSessions.add(write.sessionId);
      stillUnresolved += 1;
      continue;
    }
    // Best effort: a mark that does not land is found landed and marked again by the next run.
    await journalResolvedCompositionWrite(deps.vault, deps.deviceId, write.compositionId);
  }
  return {
    examined: read.open.length,
    alreadyLanded,
    written,
    stillUnresolved,
    invalidLines: read.invalidLineCount,
  };
}

// ---------------------------------------------------------------------------
// Resolving a reference
// ---------------------------------------------------------------------------

export type CompositionReference =
  /** The id names exactly one landed record. */
  | { readonly status: 'recorded'; readonly record: CompositionRecord }
  /** The id names a composition whose record has not landed: an explicit unresolved write, not nothing. */
  | { readonly status: 'unresolved'; readonly write: UnresolvedCompositionWrite }
  /** Nothing names this id, or more than one record does (`[D-395]` condition 5). Never resolved by time. */
  | { readonly status: 'unknown' };

/**
 * Where a review's `compositionId` leads: a landed record, an explicit unresolved write, or
 * nothing. The one place a reader can tell "its record has not landed yet" from "there is no such
 * composition", which `resolveCompositionRecord` alone reports the same way. Throws when the vault
 * cannot be read.
 */
export async function resolveCompositionReference(
  vault: VaultSource,
  deviceId: string,
  compositionId: string,
): Promise<CompositionReference> {
  const { records } = await readCompositionLog(vault);
  const record = resolveCompositionRecord(records, compositionId);
  if (record !== null) return { status: 'recorded', record };
  if (records.some((landed) => landed.compositionId === compositionId))
    return { status: 'unknown' };
  const { open } = await readUnresolvedCompositionWrites(vault, deviceId);
  const write = open.find((candidate) => candidate.compositionId === compositionId);
  if (write === undefined) return { status: 'unknown' };
  return {
    status: 'unresolved',
    write: summarizeUnresolvedWrite(write.record, write.state),
  };
}
