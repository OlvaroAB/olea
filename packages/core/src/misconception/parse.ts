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
  BeliefResolutionDecision,
  BeliefResolutionEvidence,
  BeliefResolutionOption,
  BeliefResolutionProvenance,
  MisconceptionEvent,
  MisconceptionObservedEvent,
  MisconceptionResolutionEvidenceEvent,
  ResolutionEvidenceKind,
  SourceCitation,
} from './types.js';
import { BELIEF_RESOLUTION_OPTIONS, MISCONCEPTION_EVENT_SCHEMA_VERSION } from './types.js';

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

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function parseProvenance(value: unknown): BeliefResolutionProvenance | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.taskId) || !isNonEmptyString(v.promptVersion)) return null;
  if (!isNonEmptyString(v.modelId)) return null;
  return { taskId: v.taskId, promptVersion: v.promptVersion, modelId: v.modelId };
}

function parseDecision(value: unknown): BeliefResolutionDecision | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.misconceptionId)) return null;
  if (v.option === null && v.provenance === null) {
    return { misconceptionId: v.misconceptionId, option: null, provenance: null };
  }
  if (!BELIEF_RESOLUTION_OPTIONS.includes(v.option as BeliefResolutionOption)) return null;
  const provenance = parseProvenance(v.provenance);
  if (provenance === null) return null;
  return {
    misconceptionId: v.misconceptionId,
    option: v.option as BeliefResolutionOption,
    provenance,
  };
}

/**
 * `[D-485]` part 1: validates a resolution-evidence event's `beliefResolution`
 * field and returns a copy in canonical key order, or `null` when it is
 * malformed. A malformed field makes the whole line invalid — the event is
 * skipped, never folded as if the field were absent, because the concept-wide
 * fade is exactly the over-reaching move this field exists to prevent.
 *
 * Rules: every id is a non-empty string and appears at most once per list; a
 * decision's `option` and `provenance` are both `null` or both present; every
 * target has a decision whose option is `demonstrates`. A `demonstrates`
 * decision need not be a target (a writer may hold one back, e.g. a later
 * confidence cut). Also used by `./events.js`'s builder, so a built event
 * always parses back to itself.
 */
export function parseBeliefResolution(value: unknown): BeliefResolutionEvidence | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.targetMisconceptionIds) || !Array.isArray(v.decisions)) return null;

  const decisions: BeliefResolutionDecision[] = [];
  const optionById = new Map<string, BeliefResolutionOption | null>();
  for (const raw of v.decisions) {
    const decision = parseDecision(raw);
    if (decision === null || optionById.has(decision.misconceptionId)) return null;
    optionById.set(decision.misconceptionId, decision.option);
    decisions.push(decision);
  }

  const targets: string[] = [];
  for (const id of v.targetMisconceptionIds) {
    if (!isNonEmptyString(id) || targets.includes(id)) return null;
    if (optionById.get(id) !== 'demonstrates') return null;
    targets.push(id);
  }

  return { targetMisconceptionIds: targets, decisions };
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

  // `[D-485]`: absent keeps today's shape exactly (INV-2); present must be well formed.
  let beliefResolution: BeliefResolutionEvidence | null = null;
  if (v.beliefResolution !== undefined) {
    beliefResolution = parseBeliefResolution(v.beliefResolution);
    if (beliefResolution === null) return null;
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
    ...(beliefResolution !== null ? { beliefResolution } : {}),
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
