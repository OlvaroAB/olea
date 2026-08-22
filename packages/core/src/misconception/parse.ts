/**
 * Misconception-log reader — tolerant of a partially-written trailing line,
 * same discipline as `../review-log/parse.js`: a line that fails to parse as
 * JSON, or fails validation, is reported in `invalidLines` and skipped,
 * never thrown, never affecting any other line.
 *
 * **No `zod` here, deliberately.** `olea-core` has no direct dependency on
 * `zod` anywhere (only `packages/contracts` does, for the frozen review-log
 * shape this store is explicitly not touching) — every other hand-rolled
 * persisted shape in this package (`../keyword-index/`, `../retrieval/`)
 * validates with plain type guards, and this module follows that existing
 * convention rather than introducing a new dependency for one file.
 */

import type {
  MisconceptionEvent,
  MisconceptionObservedEvent,
  MisconceptionResolutionEvidenceEvent,
  ResolutionEvidenceKind,
  SourceCitation,
} from './types.js';
import { MISCONCEPTION_EVENT_SCHEMA_VERSION } from './types.js';

export interface InvalidMisconceptionLogLine {
  /** 1-based line number, matching what an editor would show. */
  readonly lineNumber: number;
  readonly raw: string;
  readonly reason: string;
}

export interface ParseMisconceptionLogResult {
  readonly events: readonly MisconceptionEvent[];
  readonly invalidLines: readonly InvalidMisconceptionLogLine[];
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCitation(value: unknown): value is SourceCitation {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isString(v.path) && typeof v.blockIndex === 'number' && Number.isInteger(v.blockIndex);
}

const RESOLUTION_EVIDENCE_KINDS: readonly ResolutionEvidenceKind[] = ['recall', 'explanation'];

function isCommonFieldsValid(v: Record<string, unknown>): boolean {
  return (
    v.schemaVersion === MISCONCEPTION_EVENT_SCHEMA_VERSION &&
    isString(v.eventId) &&
    v.eventId.length > 0 &&
    isString(v.timestamp) &&
    isString(v.originInstrumentId) &&
    v.originInstrumentId.length > 0 &&
    isNullableString(v.originReviewEventId)
  );
}

function parseObserved(v: Record<string, unknown>): MisconceptionObservedEvent | null {
  if (
    !isCommonFieldsValid(v) ||
    !isString(v.misconceptionId) ||
    v.misconceptionId.length === 0 ||
    !isString(v.conceptId) ||
    v.conceptId.length === 0 ||
    !isNullableString(v.confusedWithConceptId) ||
    !isString(v.statement) ||
    !isString(v.correction) ||
    !isCitation(v.citation)
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    kind: 'observed',
    eventId: v.eventId as string,
    timestamp: v.timestamp as string,
    originInstrumentId: v.originInstrumentId as string,
    originReviewEventId: v.originReviewEventId as string | null,
    misconceptionId: v.misconceptionId as string,
    conceptId: v.conceptId as string,
    confusedWithConceptId: v.confusedWithConceptId as string | null,
    statement: v.statement as string,
    correction: v.correction as string,
    citation: v.citation as SourceCitation,
  };
}

function parseResolutionEvidence(
  v: Record<string, unknown>,
): MisconceptionResolutionEvidenceEvent | null {
  if (
    !isCommonFieldsValid(v) ||
    !isString(v.conceptId) ||
    v.conceptId.length === 0 ||
    !isString(v.evidenceKind) ||
    !RESOLUTION_EVIDENCE_KINDS.includes(v.evidenceKind as ResolutionEvidenceKind)
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    kind: 'resolution-evidence',
    eventId: v.eventId as string,
    timestamp: v.timestamp as string,
    originInstrumentId: v.originInstrumentId as string,
    originReviewEventId: v.originReviewEventId as string | null,
    conceptId: v.conceptId as string,
    evidenceKind: v.evidenceKind as ResolutionEvidenceKind,
  };
}

/** Validates a parsed JSON value as a `MisconceptionEvent`; `null` on any shape failure. Exported for callers (e.g. tests) that already have a parsed value and want the same validation `parseMisconceptionLog` applies per line. */
export function parseMisconceptionEvent(json: unknown): MisconceptionEvent | null {
  if (typeof json !== 'object' || json === null) return null;
  const v = json as Record<string, unknown>;
  if (v.kind === 'observed') return parseObserved(v);
  if (v.kind === 'resolution-evidence') return parseResolutionEvidence(v);
  return null;
}

/**
 * Parses append-only misconception-log JSONL content. `\n`-terminated
 * lines, `\r\n` tolerated. Blank lines are silently skipped, never reported.
 */
export function parseMisconceptionLog(content: string): ParseMisconceptionLogResult {
  const events: MisconceptionEvent[] = [];
  const invalidLines: InvalidMisconceptionLogLine[] = [];

  const lines = content.split('\n');
  lines.forEach((rawLine, index) => {
    const isFinalSplitArtifact = index === lines.length - 1;
    if (isFinalSplitArtifact && rawLine === '') return;

    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') return;

    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (err) {
      invalidLines.push({
        lineNumber: index + 1,
        raw: rawLine,
        reason: err instanceof Error ? err.message : 'invalid JSON',
      });
      return;
    }

    const event = parseMisconceptionEvent(json);
    if (event === null) {
      invalidLines.push({
        lineNumber: index + 1,
        raw: rawLine,
        reason: 'does not match a known misconception-event shape at its declared schemaVersion',
      });
      return;
    }

    events.push(event);
  });

  return { events, invalidLines };
}
