/**
 * The persisted records of the unit manifest store (`[D-445]`, `ol-egov.141.89.8.43`): what one
 * line of `.olea/unit-manifests/<date>.<deviceId>.jsonl` says, how it is written and how it is read
 * back. Pure: no vault, no clock. `./log.ts` moves these to and from the vault, `./projection.ts`
 * folds them into the `UnitManifest` consumers read.
 *
 * **Three kinds of record, so nothing is left to be inferred from silence.**
 *
 *  - `enumerated` names the pages one source revision holds (`pages`). This is what makes an unread
 *    page **unknown, never absent**: a revision's manifest has exactly the pages this record names,
 *    whether or not any page has a state record yet, and a revision with no enumeration record has no
 *    manifest at all, however many state records name it. A crash between two appends can lose a
 *    page's state record, never the fact that the page exists.
 *  - `unit` is one page's whole state after a change: its reading state and its concept-extraction
 *    state as two separate fields ([D-326] condition 1), so the fold is "latest record per page" with
 *    no delta to replay. A writer that changes one field copies the other from the folded value.
 *    Since `[D-531]` (`ol-egov.141.89.7.78`) it may also carry the per-page "outcomes extracted"
 *    mark, `outcomeExtractionState`, the one stored field that ruling's option B authorises. It is
 *    written only as `'complete'` and placed after `conceptExtractionState`; a record without it is
 *    a page whose outcomes are not extracted, so every line written before it reads unchanged and
 *    writes back byte for byte. The record version is unchanged: an older build reading a marked
 *    line drops only the mark, which reads as not extracted, the safe direction for the rule.
 *  - `retired` is the explicit retirement of one source revision: the bytes it speaks for are no
 *    longer the source's, or the source is gone. It is what a device writes when it sees the change;
 *    the fold also lets a later enumeration supersede an earlier revision when no device wrote one.
 *
 * **Every record carries `clock` and `deviceId`.** `clock` is a Lamport counter (the writer takes the
 * highest clock it has seen and adds one), `deviceId` breaks a tie, and `at` is wall time kept for a
 * human reading the file and never compared: no ordering here depends on two devices' clocks agreeing.
 *
 * **INV-2, and why serialisation is canonical.** A line this module writes parses back to a record
 * that serialises to the identical bytes (`serialiseUnitManifestRecord` fixes every key's position,
 * nested ones included), and nothing here ever rewrites a line: the log is append-only. A line this
 * build cannot read (a future version, a torn write) is reported and skipped, never thrown, never
 * touched.
 *
 * **D-005.** Paths, page numbers, digests, closed-enum states and producer provenance are structure.
 * The one content-adjacent field is a `partial` state's `coverage`, the model's own words about what
 * it covered; it lives only in her vault, and nothing here logs, counts by value or reports it.
 */

import type { VaultPath } from '../../vault/types.js';
import { stableUnitId } from './manifest.js';
import type {
  ConceptExtractionState,
  OutcomeExtractionState,
  UnitFailedReason,
  UnitPendingReason,
  UnitProducerProvenance,
  UnitReadingState,
  UnitReadMethod,
  UnitUnreadableReason,
} from './types.js';

/** The `v` every record of this build carries. A record of another version is invalid to this reader. */
export const UNIT_MANIFEST_RECORD_VERSION = 1 as const;

/** Why a revision was retired: replaced by another revision of the same path, or its source is gone. */
export type RevisionRetirementReason = 'superseded' | 'source-removed';

interface UnitManifestRecordBase {
  readonly v: typeof UNIT_MANIFEST_RECORD_VERSION;
  readonly deviceId: string;
  /** Lamport counter. A positive integer. */
  readonly clock: number;
  /** Wall time with its UTC offset, informational only: never compared, never used to order. */
  readonly at: string;
  readonly sourcePath: VaultPath;
  /** Content hash of the source's bytes (`../hash.ts#hashContent`, the hash a queue job is keyed by). */
  readonly revisionDigest: string;
}

/** The pages one source revision holds. Pages are 1-based and listed in ascending order. */
export interface RevisionEnumeratedRecord extends UnitManifestRecordBase {
  readonly kind: 'enumerated';
  readonly pages: readonly number[];
}

/** One page's whole state after a change. */
export interface UnitStateRecord extends UnitManifestRecordBase {
  readonly kind: 'unit';
  readonly unitId: string;
  readonly page: number;
  readonly readingState: UnitReadingState;
  readonly conceptExtractionState: ConceptExtractionState;
  /**
   * `[D-531]`: present, and `'complete'`, only when this page's outcomes were extracted from this
   * record's reading under its revision. Never written as `'not-started'`: absence says that.
   */
  readonly outcomeExtractionState?: Extract<OutcomeExtractionState, 'complete'>;
}

/** The retirement of the revision named by `revisionDigest`. */
export interface RevisionRetiredRecord extends UnitManifestRecordBase {
  readonly kind: 'retired';
  readonly reason: RevisionRetirementReason;
}

export type UnitManifestRecord = RevisionEnumeratedRecord | UnitStateRecord | RevisionRetiredRecord;

export interface InvalidUnitManifestLogLine {
  /** 1-based, as an editor would show it. */
  readonly lineNumber: number;
  readonly raw: string;
  readonly reason: string;
}

export interface ParseUnitManifestLogResult {
  readonly records: readonly UnitManifestRecord[];
  readonly invalidLines: readonly InvalidUnitManifestLogLine[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const READ_METHODS: readonly UnitReadMethod[] = ['text-layer', 'image', 'text-and-image'];
const UNREADABLE_REASONS: readonly UnitUnreadableReason[] = [
  'blank-page',
  'not-legible',
  'no-text-on-page',
];
const PENDING_REASONS: readonly UnitPendingReason[] = ['budget', 'queued'];
const FAILED_REASONS: readonly UnitFailedReason[] = [
  'render-failed',
  'type-not-accepted',
  'no-renderer-for-format',
  'malformed-response-twice',
];
const EXTRACTION_STATES: readonly ConceptExtractionState[] = ['not-started', 'complete'];
const RETIREMENT_REASONS: readonly RevisionRetirementReason[] = ['superseded', 'source-removed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** `undefined` when absent, `null` when present but not a valid provenance. */
function parseProvenance(value: unknown): UnitProducerProvenance | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const { task, promptVersion, modelIdentity, imageDigest } = value;
  if (
    typeof task !== 'string' ||
    typeof promptVersion !== 'string' ||
    typeof modelIdentity !== 'string' ||
    typeof imageDigest !== 'string'
  ) {
    return null;
  }
  return { task, promptVersion, modelIdentity, imageDigest };
}

/**
 * Validates a parsed JSON value as a `UnitReadingState`, rebuilding it key by key so the result is
 * canonical whatever order the line held. `null` on anything outside the closed enums: an unknown
 * value is a line this build cannot vouch for, not a state to guess at.
 */
export function parseUnitReadingState(value: unknown): UnitReadingState | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'read': {
      if (!oneOf(value.method, READ_METHODS)) return null;
      const provenance = parseProvenance(value.provenance);
      if (provenance === null) return null;
      return provenance === undefined
        ? { kind: 'read', method: value.method }
        : { kind: 'read', method: value.method, provenance };
    }
    case 'partial': {
      if (!oneOf(value.method, READ_METHODS) || typeof value.coverage !== 'string') return null;
      const provenance = parseProvenance(value.provenance);
      if (provenance === null) return null;
      return provenance === undefined
        ? { kind: 'partial', method: value.method, coverage: value.coverage }
        : { kind: 'partial', method: value.method, coverage: value.coverage, provenance };
    }
    case 'unreadable': {
      if (!oneOf(value.reason, UNREADABLE_REASONS)) return null;
      const provenance = parseProvenance(value.provenance);
      if (provenance === null) return null;
      return provenance === undefined
        ? { kind: 'unreadable', reason: value.reason }
        : { kind: 'unreadable', reason: value.reason, provenance };
    }
    case 'pending':
      return oneOf(value.reason, PENDING_REASONS)
        ? { kind: 'pending', reason: value.reason }
        : null;
    case 'unavailable':
      return { kind: 'unavailable' };
    case 'failed':
      return oneOf(value.reason, FAILED_REASONS) && typeof value.retryable === 'boolean'
        ? { kind: 'failed', reason: value.reason, retryable: value.retryable }
        : null;
    default:
      return null;
  }
}

function parseBase(v: Record<string, unknown>): UnitManifestRecordBase | null {
  if (v.v !== UNIT_MANIFEST_RECORD_VERSION) return null;
  if (!isNonEmptyString(v.deviceId) || !isPositiveInteger(v.clock)) return null;
  if (!isNonEmptyString(v.at) || !isNonEmptyString(v.sourcePath)) return null;
  if (!isNonEmptyString(v.revisionDigest)) return null;
  return {
    v: UNIT_MANIFEST_RECORD_VERSION,
    deviceId: v.deviceId,
    clock: v.clock,
    at: v.at,
    sourcePath: v.sourcePath,
    revisionDigest: v.revisionDigest,
  };
}

/** True for an ascending list of distinct positive integers. */
function isAscendingPages(value: unknown): value is number[] {
  if (!Array.isArray(value)) return false;
  let previous = 0;
  for (const page of value) {
    if (!isPositiveInteger(page) || page <= previous) return false;
    previous = page;
  }
  return true;
}

/** Validates a parsed JSON value as a record; `null` on any shape failure. */
export function parseUnitManifestRecord(json: unknown): UnitManifestRecord | null {
  if (!isRecord(json)) return null;
  const base = parseBase(json);
  if (base === null) return null;
  switch (json.kind) {
    case 'enumerated':
      return isAscendingPages(json.pages)
        ? { ...base, kind: 'enumerated', pages: json.pages }
        : null;
    case 'unit': {
      if (!isPositiveInteger(json.page) || !oneOf(json.conceptExtractionState, EXTRACTION_STATES)) {
        return null;
      }
      // The id is derived from the path and page; a line whose id disagrees was not written by a
      // writer that knew the rule, so it is not a record of that unit.
      if (json.unitId !== stableUnitId(base.sourcePath, json.page)) return null;
      const readingState = parseUnitReadingState(json.readingState);
      if (readingState === null) return null;
      // `[D-531]`: absent, or exactly `'complete'`. Any other value is not a mark this build wrote,
      // so the line is not vouched for (its page reads as unknown, never as extracted).
      const outcomeMark = json.outcomeExtractionState;
      if (outcomeMark !== undefined && outcomeMark !== 'complete') return null;
      return {
        ...base,
        kind: 'unit',
        unitId: json.unitId,
        page: json.page,
        readingState,
        conceptExtractionState: json.conceptExtractionState,
        ...(outcomeMark === 'complete' ? { outcomeExtractionState: outcomeMark } : {}),
      };
    }
    case 'retired':
      return oneOf(json.reason, RETIREMENT_REASONS)
        ? { ...base, kind: 'retired', reason: json.reason }
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

function canonicalReadingState(state: UnitReadingState): Record<string, unknown> {
  const withProvenance = (
    head: Record<string, unknown>,
    provenance: UnitProducerProvenance | undefined,
  ): Record<string, unknown> =>
    provenance === undefined
      ? head
      : {
          ...head,
          provenance: {
            task: provenance.task,
            promptVersion: provenance.promptVersion,
            modelIdentity: provenance.modelIdentity,
            imageDigest: provenance.imageDigest,
          },
        };
  switch (state.kind) {
    case 'read':
      return withProvenance({ kind: 'read', method: state.method }, state.provenance);
    case 'partial':
      return withProvenance(
        { kind: 'partial', method: state.method, coverage: state.coverage },
        state.provenance,
      );
    case 'unreadable':
      return withProvenance({ kind: 'unreadable', reason: state.reason }, state.provenance);
    case 'pending':
      return { kind: 'pending', reason: state.reason };
    case 'unavailable':
      return { kind: 'unavailable' };
    case 'failed':
      return { kind: 'failed', reason: state.reason, retryable: state.retryable };
  }
}

/**
 * Whether two reading states are the same state, whatever order their keys were built in: the
 * comparison is over the canonical form a record is written in, never over object identity or key
 * order. A writer uses it to tell "the reading this unit already has" from "a different reading".
 */
export function sameUnitReadingState(a: UnitReadingState, b: UnitReadingState): boolean {
  return JSON.stringify(canonicalReadingState(a)) === JSON.stringify(canonicalReadingState(b));
}

/**
 * The one line for `record`, `\n`-terminated, with every key in a fixed position. A record this
 * module parsed serialises back to the bytes it was read from, which is what lets a reader compare
 * a file with what it would have written.
 */
export function serialiseUnitManifestRecord(record: UnitManifestRecord): string {
  const head = {
    v: record.v,
    kind: record.kind,
    deviceId: record.deviceId,
    clock: record.clock,
    at: record.at,
    sourcePath: record.sourcePath,
    revisionDigest: record.revisionDigest,
  };
  switch (record.kind) {
    case 'enumerated':
      return `${JSON.stringify({ ...head, pages: [...record.pages] })}\n`;
    case 'unit':
      return `${JSON.stringify({
        ...head,
        unitId: record.unitId,
        page: record.page,
        readingState: canonicalReadingState(record.readingState),
        conceptExtractionState: record.conceptExtractionState,
        // Last, and only when set: an unmarked record writes exactly the bytes it always did.
        ...(record.outcomeExtractionState === 'complete'
          ? { outcomeExtractionState: record.outcomeExtractionState }
          : {}),
      })}\n`;
    case 'retired':
      return `${JSON.stringify({ ...head, reason: record.reason })}\n`;
  }
}

/**
 * Parses append-only log content. `\n`-terminated lines, `\r\n` tolerated, blank lines skipped
 * silently. A line that is not JSON, or not a record of this version, is reported in `invalidLines`
 * and skipped: a torn last line from an interrupted append costs that one record, and the page it
 * named reads as unknown (pending), never as read.
 */
export function parseUnitManifestLog(content: string): ParseUnitManifestLogResult {
  const records: UnitManifestRecord[] = [];
  const invalidLines: InvalidUnitManifestLogLine[] = [];
  const lines = content.split('\n');
  lines.forEach((rawLine, index) => {
    if (index === lines.length - 1 && rawLine === '') return;
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (error) {
      invalidLines.push({
        lineNumber: index + 1,
        raw: rawLine,
        reason: error instanceof Error ? error.message : 'invalid JSON',
      });
      return;
    }
    const record = parseUnitManifestRecord(json);
    if (record === null) {
      invalidLines.push({
        lineNumber: index + 1,
        raw: rawLine,
        reason: 'not a unit manifest record of this version',
      });
      return;
    }
    records.push(record);
  });
  return { records, invalidLines };
}
