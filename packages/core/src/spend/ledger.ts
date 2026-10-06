/**
 * The spend ledger's stored format and its arithmetic (`[D-540]`, client half
 * `ol-egov.141.89.7.76`): the line shape, the 120-day period sum, the admission rule and the opaque
 * refusal key. Pure: the plugin's `spend/vault-spend-ledger.ts` reads and appends the files.
 *
 * ## The format (adopted by the hub as persistence owner)
 *
 * `.olea/spend-ledger/<deviceId>.jsonl`, one append-only file per device, in Olea's own layer of her
 * vault; a reader unions every file in the folder. One JSON object per line, never content and never
 * a vault path, with exactly these fields:
 *
 * - `hold`: `v`, `kind`, `at`, `callId` (random), `taskId`, `holdUsd` (the task's per-call price
 *   ceiling times the combined maximum of two billable calls; `./prices.ts`);
 * - `settle`: `v`, `kind`, `at`, `callId`, `settledUsd` (the response's reported cost), `attempts`
 *   (1 or 2);
 * - `release`: `v`, `kind`, `at`, `callId` (the call was never sent);
 * - `refusal`: `v`, `kind`, `at`, `refusalKey` (an opaque SHA-256 of the part or batch it names),
 *   `taskId`: the reader refused that part or batch once.
 *
 * `v` is 1. `at` is an ISO-8601 UTC instant.
 *
 * ## The arithmetic
 *
 * The period is every entry whose `at` is no more than {@link SPEND_PERIOD_DAYS} days before now
 * (an entry dated after now counts: a clock ahead is not a reason to drop it). A call counts if any
 * of its entries is in the period, at:
 *
 * - its settled cost, when it has a settle (the largest, should a copy hold two);
 * - nothing, when it was released and never settled;
 * - its hold otherwise, open or stale alike: a hold with no settle or release after
 *   {@link STALE_HOLD_HOURS} hours still counts at its hold value, and is reported stale.
 *
 * Lines are grouped by `callId`, so a line copied into a second file (a sync conflict copy) counts
 * once. A line this reader cannot trust (`[D-540]` hub change 1) is never skipped as zero: a torn or
 * malformed line, a line of an unknown kind, and a line of a later version each count as one
 * {@link WORST_CASE_HOLD_USD}, and each is counted in the diagnostics. Such a line ages out by its own
 * `at` when it has a readable one; a line with no readable time counts for as long as it exists.
 * Amounts are summed in whole micro-dollars, each rounded up, so the sum never under-counts.
 *
 * Refusals are counted per key over the same period. A refusal line carries no identity of its own,
 * so a copy of one (a sync conflict copy) counts again: the part is held back sooner, never later.
 *
 * ## Admission
 *
 * A scope read (`demand.classify.v1`, `outcomes.align.v1`) is admitted only while the period's spend
 * plus its hold stays at or under {@link SCOPE_READING_PAUSE_FRACTION} of the limit (USD 9.60);
 * outcome extraction, while it stays at or under the limit (USD 12). Applying the hold to the pause
 * as well as to the limit is a reversible default (Class B): it pauses one hold earlier than reading
 * "at 80 percent" as "once spend reaches 80 percent", and never later. A task with no declared price
 * is never admitted.
 */

import { hashText } from '../ingestion/hash.js';
import { isValidDeviceId } from '../review-log/path.js';
import type { VaultPath } from '../vault/types.js';
import {
  isSpendTaskId,
  SCOPE_READING_PAUSE_FRACTION,
  SPEND_LIMIT_USD,
  SPEND_PERIOD_DAYS,
  SPEND_TASK_PRICES,
  STALE_HOLD_HOURS,
  toMicroUsd,
  WORST_CASE_HOLD_USD,
} from './prices.js';

/** The ledger's folder in Olea's layer, registered with F7.4 (`privacy/log-discovery.ts`). */
export const SPEND_LEDGER_FOLDER: VaultPath = '.olea/spend-ledger';

/** The line format's version. A reader of this version counts a line of a later one as a worst-case hold. */
export const SPEND_LEDGER_VERSION = 1;

/** This device's file. Throws on an id that is not a valid device id: a bad path is a bug at the call site. */
export function spendLedgerPath(deviceId: string): VaultPath {
  if (!isValidDeviceId(deviceId)) {
    throw new Error(`spendLedgerPath: not a valid device id: ${JSON.stringify(deviceId)}`);
  }
  return `${SPEND_LEDGER_FOLDER}/${deviceId}.jsonl`;
}

/** The device a ledger file belongs to, or `null` for a path that is not one. */
export function deviceOfSpendLedgerPath(path: VaultPath): string | null {
  const prefix = `${SPEND_LEDGER_FOLDER}/`;
  if (!path.startsWith(prefix) || !path.endsWith('.jsonl')) return null;
  const deviceId = path.slice(prefix.length, path.length - '.jsonl'.length);
  return isValidDeviceId(deviceId) ? deviceId : null;
}

export interface SpendHoldEntry {
  readonly v: 1;
  readonly kind: 'hold';
  readonly at: string;
  readonly callId: string;
  readonly taskId: string;
  readonly holdUsd: number;
}

export interface SpendSettleEntry {
  readonly v: 1;
  readonly kind: 'settle';
  readonly at: string;
  readonly callId: string;
  readonly settledUsd: number;
  readonly attempts: 1 | 2;
}

export interface SpendReleaseEntry {
  readonly v: 1;
  readonly kind: 'release';
  readonly at: string;
  readonly callId: string;
}

export interface SpendRefusalEntry {
  readonly v: 1;
  readonly kind: 'refusal';
  readonly at: string;
  readonly refusalKey: string;
  readonly taskId: string;
}

export type SpendLedgerEntry =
  | SpendHoldEntry
  | SpendSettleEntry
  | SpendReleaseEntry
  | SpendRefusalEntry;

/** Each kind's fields, in the order they are written. A line with any other field is malformed. */
const FIELDS: Readonly<Record<SpendLedgerEntry['kind'], readonly string[]>> = {
  hold: ['v', 'kind', 'at', 'callId', 'taskId', 'holdUsd'],
  settle: ['v', 'kind', 'at', 'callId', 'settledUsd', 'attempts'],
  release: ['v', 'kind', 'at', 'callId'],
  refusal: ['v', 'kind', 'at', 'refusalKey', 'taskId'],
};

const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const CALL_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const TASK_ID_RE = /^[a-z][a-z0-9.-]{0,63}$/;
const REFUSAL_KEY_RE = /^[0-9a-f]{64}$/;

/** The instant `at` names, in milliseconds, or `undefined` when it is not an ISO-8601 UTC instant. */
function instantOf(at: unknown): number | undefined {
  if (typeof at !== 'string' || !AT_RE.test(at)) return undefined;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : undefined;
}

const finiteAtLeast = (value: unknown, min: number, strict: boolean): value is number =>
  typeof value === 'number' && Number.isFinite(value) && (strict ? value > min : value >= min);

/** True when `value` is a well-formed entry of a known kind, with exactly its own fields. */
function isEntry(
  value: Record<string, unknown>,
): value is Record<string, unknown> & SpendLedgerEntry {
  const kind = value.kind;
  if (kind !== 'hold' && kind !== 'settle' && kind !== 'release' && kind !== 'refusal') {
    return false;
  }
  const keys = Object.keys(value);
  const fields = FIELDS[kind];
  if (keys.length !== fields.length || !keys.every((key) => fields.includes(key))) return false;
  if (value.v !== SPEND_LEDGER_VERSION || instantOf(value.at) === undefined) return false;
  switch (kind) {
    case 'hold':
      return (
        typeof value.callId === 'string' &&
        CALL_ID_RE.test(value.callId) &&
        typeof value.taskId === 'string' &&
        TASK_ID_RE.test(value.taskId) &&
        finiteAtLeast(value.holdUsd, 0, true)
      );
    case 'settle':
      return (
        typeof value.callId === 'string' &&
        CALL_ID_RE.test(value.callId) &&
        finiteAtLeast(value.settledUsd, 0, false) &&
        (value.attempts === 1 || value.attempts === 2)
      );
    case 'release':
      return typeof value.callId === 'string' && CALL_ID_RE.test(value.callId);
    case 'refusal':
      return (
        typeof value.refusalKey === 'string' &&
        REFUSAL_KEY_RE.test(value.refusalKey) &&
        typeof value.taskId === 'string' &&
        TASK_ID_RE.test(value.taskId)
      );
  }
}

/**
 * One entry as its line (no trailing newline), fields in their fixed order. Throws on an entry that
 * is not well formed, including one carrying any field beyond its kind's: nothing else is ever
 * written, so no content or path can reach the ledger through this function.
 */
export function serializeSpendLedgerEntry(entry: SpendLedgerEntry): string {
  const value = entry as unknown as Record<string, unknown>;
  if (typeof value !== 'object' || value === null || !isEntry(value)) {
    throw new Error('serializeSpendLedgerEntry: not a well-formed spend ledger entry');
  }
  const ordered: Record<string, unknown> = {};
  for (const field of FIELDS[entry.kind]) ordered[field] = value[field];
  return JSON.stringify(ordered);
}

export type SpendLineProblem = 'malformed' | 'unknown-kind' | 'future-version';

export type ParsedSpendLine =
  | { readonly entry: SpendLedgerEntry }
  | {
      readonly problem: SpendLineProblem;
      /** The line's own time, when it has a readable one: such a line still ages out. */
      readonly atMs?: number;
    };

/** One line, read. Never throws. A blank line is the caller's to skip. */
export function parseSpendLedgerLine(line: string): ParsedSpendLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { problem: 'malformed' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { problem: 'malformed' };
  }
  const value = parsed as Record<string, unknown>;
  const atMs = instantOf(value.at);
  const withTime = (problem: SpendLineProblem): ParsedSpendLine =>
    atMs === undefined ? { problem } : { problem, atMs };
  if (typeof value.v === 'number' && Number.isInteger(value.v) && value.v > SPEND_LEDGER_VERSION) {
    return withTime('future-version');
  }
  if (
    value.v === SPEND_LEDGER_VERSION &&
    typeof value.kind === 'string' &&
    !Object.hasOwn(FIELDS, value.kind)
  ) {
    return withTime('unknown-kind');
  }
  if (!isEntry(value)) return withTime('malformed');
  return { entry: value as unknown as SpendLedgerEntry };
}

export interface SpendLedgerDiagnostics {
  readonly malformed: number;
  readonly unknownKind: number;
  readonly futureVersion: number;
  /** Holds in the period with no settle or release, younger than {@link STALE_HOLD_HOURS}. */
  readonly openHolds: number;
  /** Holds in the period with no settle or release, older than {@link STALE_HOLD_HOURS}. Counted at their hold. */
  readonly staleHolds: number;
  readonly settled: number;
  readonly released: number;
  /** Refusal lines in the period. */
  readonly refusals: number;
}

export interface SpendSummary {
  /** The period's spend in whole micro-dollars. */
  readonly spentMicroUsd: number;
  readonly spentUsd: number;
  /** Refusals in the period, per opaque refusal key. */
  readonly refusalCounts: ReadonlyMap<string, number>;
  readonly diagnostics: SpendLedgerDiagnostics;
}

interface CallState {
  holdMicro: number;
  holdAtMs: number;
  hasHold: boolean;
  settledMicro: number;
  hasSettle: boolean;
  released: boolean;
  inPeriod: boolean;
}

/**
 * The period's spend and refusal counts over every ledger file's text (any order), as of `now`.
 * See the module doc for the rules.
 */
export function summarizeSpendLedger(texts: readonly string[], now: Date): SpendSummary {
  const nowMs = now.getTime();
  const periodStart = nowMs - SPEND_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  const staleBefore = nowMs - STALE_HOLD_HOURS * 60 * 60 * 1000;
  const inPeriod = (ms: number) => ms >= periodStart;
  const worstMicro = toMicroUsd(WORST_CASE_HOLD_USD);

  const calls = new Map<string, CallState>();
  const refusalCounts = new Map<string, number>();
  let refusalLines = 0;
  let untrustedMicro = 0;
  const problems = { malformed: 0, unknownKind: 0, futureVersion: 0 };

  for (const text of texts) {
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      const read = parseSpendLedgerLine(line);
      if ('problem' in read) {
        if (read.problem === 'malformed') problems.malformed++;
        else if (read.problem === 'unknown-kind') problems.unknownKind++;
        else problems.futureVersion++;
        if (read.atMs === undefined || inPeriod(read.atMs)) untrustedMicro += worstMicro;
        continue;
      }
      const entry = read.entry;
      const atMs = instantOf(entry.at) as number;
      if (entry.kind === 'refusal') {
        if (!inPeriod(atMs)) continue;
        refusalLines++;
        refusalCounts.set(entry.refusalKey, (refusalCounts.get(entry.refusalKey) ?? 0) + 1);
        continue;
      }
      let state = calls.get(entry.callId);
      if (state === undefined) {
        state = {
          holdMicro: 0,
          holdAtMs: Number.NEGATIVE_INFINITY,
          hasHold: false,
          settledMicro: 0,
          hasSettle: false,
          released: false,
          inPeriod: false,
        };
        calls.set(entry.callId, state);
      }
      if (inPeriod(atMs)) state.inPeriod = true;
      if (entry.kind === 'hold') {
        state.hasHold = true;
        state.holdMicro = Math.max(state.holdMicro, toMicroUsd(entry.holdUsd));
        state.holdAtMs = Math.max(state.holdAtMs, atMs);
      } else if (entry.kind === 'settle') {
        state.hasSettle = true;
        state.settledMicro = Math.max(state.settledMicro, toMicroUsd(entry.settledUsd));
      } else {
        state.released = true;
      }
    }
  }

  let spentMicroUsd = untrustedMicro;
  const counts = { openHolds: 0, staleHolds: 0, settled: 0, released: 0 };
  for (const state of calls.values()) {
    if (!state.inPeriod) continue;
    if (state.hasSettle) {
      spentMicroUsd += state.settledMicro;
      counts.settled++;
    } else if (state.released) {
      counts.released++;
    } else if (state.hasHold) {
      spentMicroUsd += state.holdMicro;
      if (state.holdAtMs < staleBefore) counts.staleHolds++;
      else counts.openHolds++;
    }
  }

  return {
    spentMicroUsd,
    spentUsd: spentMicroUsd / 1e6,
    refusalCounts,
    diagnostics: { ...problems, ...counts, refusals: refusalLines },
  };
}

export type SpendAdmission =
  | { readonly admitted: true }
  | {
      readonly admitted: false;
      readonly reason: 'scope-reading-paused' | 'limit-reached' | 'unknown-task';
    };

/** Whether one call of `taskId` holding `holdUsd` may be reserved against `summary`. See the module doc. */
export function admitSpend(summary: SpendSummary, taskId: string, holdUsd: number): SpendAdmission {
  if (!isSpendTaskId(taskId)) return { admitted: false, reason: 'unknown-task' };
  const after = summary.spentMicroUsd + toMicroUsd(holdUsd);
  if (after > toMicroUsd(SPEND_LIMIT_USD)) return { admitted: false, reason: 'limit-reached' };
  if (
    SPEND_TASK_PRICES[taskId].pausesForScopeReading &&
    after > toMicroUsd(SPEND_LIMIT_USD * SCOPE_READING_PAUSE_FRACTION)
  ) {
    return { admitted: false, reason: 'scope-reading-paused' };
  }
  return { admitted: true };
}

/** What a demand part's refusal key is the hash of: the structure record and the part. */
export function demandRefusalMaterial(structureId: string, partId: string): string {
  return JSON.stringify(['demand', structureId, partId]);
}

/** What an alignment batch's refusal key is the hash of: the course, the batch plan and the batch. */
export function alignmentRefusalMaterial(
  courseId: string,
  batchPlanDigest: string,
  batchId: string,
): string {
  return JSON.stringify(['align', courseId, batchPlanDigest, batchId]);
}

/** The opaque key a refusal is stored under: the SHA-256 of its material, hex. Nothing it names is recoverable from the file. */
export async function spendRefusalKey(material: string): Promise<string> {
  return hashText(material);
}
