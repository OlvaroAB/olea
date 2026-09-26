/**
 * The composition record (`[D-331]`, `ol-egov.141.89.10.65`, phase 1: pure parts only).
 *
 * `[D-331]` (ruled 2026-09-25): preserve what a composition selected, what it set aside and why,
 * alongside the plan, the shares and the policy versions it used; record actual compositions
 * without accruing attention; the screens describing the active session read that same snapshot.
 * `[D-382]` (ruled the same day) is reconciled through it: while a session is active, Home, Start
 * and the review session describe it from this record, never from a live recomposition, and
 * reading the record never unfreezes or recomposes the session (C5.8, `[D-193]`). A separately
 * labelled preview of the next session is not bound to it.
 *
 * This module builds the record from a composed session, serializes it as one JSONL line, and
 * parses it back. **It writes nothing.** Where the record is written, when a composition counts
 * as actual, and how Home, Start and the review session read it are the write-path half of the
 * bead, specified in its phase-1 report and gated on the shape decisions filed there.
 *
 * ## What the record is, and what it is not
 *
 * - **One record per actual composition**: a fresh one (`kind: 'compose'`) or an outrun extension
 *   of an open one (`kind: 'extend'`, C5.8's "outrunning the target under the same plan's
 *   shares"). Every record is a whole snapshot of its sitting at that point, so the active
 *   session's snapshot is the latest record carrying its `sittingId`; an extension names the
 *   record it grew in `parentCompositionId`.
 * - **Not a review event, and never read as one.** It carries no rating, no duration and no
 *   outcome, and it is kept out of the review log's stream entirely, so no attention, mastery,
 *   scheduling or insight fold can count it. `[D-331]`'s "without accruing attention" holds by
 *   construction rather than by every fold remembering to skip a kind.
 * - **Ids, not content.** Courses, concepts and instruments appear by id only; the record adds no
 *   display name, note title, note path or card text of its own. An instrument id is the review
 *   log's own identifier and is carried exactly as that log carries it — for a note with no uid,
 *   `../session/instrument-id.ts` builds it from the note's path and anchor, so the id itself can
 *   read as a path; nothing beside it does. The one text field is `rankedReason`, the ranking's
 *   own recorded one-clause reason for an item when the ranking supplied one
 *   (`StudySessionItem`'s doc), held because F2.22 and `[D-374]` require the per-item reason to be
 *   the recorded one, never regenerated. Everything stays in her vault (the boundary document,
 *   section 1); nothing here is sent anywhere.
 * - **Frozen facts, not re-derivable ones.** The plan's allocation entries are copied in (less
 *   their prose reason) because the standing views' historical effort reading compares a past
 *   session with the shares that composed it (`docs/dev/intelligence-build/vew.md` section 2.4,
 *   service repo), and the cached plan is replaced long before that reading runs. The composer's
 *   declared constants are copied for the same reason: `URGENCY_OVERRIDE_THRESHOLD` may move one
 *   step at a time under its pre-commitment, and a past branch is only explainable against the
 *   threshold that chose it.
 *
 * ## INV-2: byte-identical round trips
 *
 * {@link serializeCompositionRecord} writes one canonical line: keys in one fixed order, every
 * optional fact an explicit `null` rather than an absent key (the review log's own "explicit
 * nulls, the same shape in every phase" convention), `policyVersions` keys sorted, `-0` written
 * as `0`. {@link parseCompositionRecord} is strict (exact key sets, known enum values, finite
 * numbers, `schemaVersion` read first and never guessed) and returns the same canonical object,
 * so for every line this module writes, `serialize(parse(line)) === line`, and for every record
 * {@link buildCompositionRecord} returns, `parse(serialize(record))` equals it. The log is
 * append-only; no line is ever rewritten, so a hand-edited line in another key order is read but
 * never normalised back to disk.
 *
 * ## F2.19
 *
 * `groupingSignal` is a fact about one composition (see `./types.ts`). No reader may aggregate it
 * across records into a property of a course or of her; F2.19 forbids that entity.
 */

import { STUDY_PLAN_KIND, type StudyPlanAllocationEntry } from 'olea-contracts';
import type { QueueItemReason } from '../queue/types.js';
import { type CalendarDay, isCalendarDay } from '../today/calendar-day.js';
import type { SessionFormatMatch, StudySessionItem } from './build.js';
import {
  type ComposedStudySession,
  FOCUS_BRANCH_SENTENCE,
  type FocusBranch,
  type FocusPolicy,
  MATERIAL_ARRIVAL_COHORT_HALF_LIFE_DAYS,
  type ObligationClass,
  URGENCY_OVERRIDE_THRESHOLD,
  WITHIN_BLOCK_PROXIMITY_HALF_LIFE_DAYS,
} from './compose.js';
import {
  type CompositionSetAside,
  GROUPING_SIGNALS,
  type GroupingSignal,
  SET_ASIDE_CONCEPT_REASONS,
  SET_ASIDE_COURSE_REASONS,
  SET_ASIDE_INSTRUMENT_REASONS,
  type SetAsideConcept,
  type SetAsideCourse,
  type SetAsideInstrument,
} from './types.js';

/** Bumped only on a breaking change to {@link CompositionRecord}'s shape; a reader never guesses at a version it does not know. */
export const COMPOSITION_RECORD_SCHEMA_VERSION = 1;

/** Marks every id {@link mintOpaqueCompositionId} mints, so a composition id is recognisable from the string alone (the `paper-key1` convention). */
export const OPAQUE_COMPOSITION_ID_PREFIX = 'composition-key1';

/** A source of randomness for {@link mintOpaqueCompositionId}. Injectable for deterministic tests. */
export type CompositionIdNonceSource = () => string;

/** An opaque composition id: a random nonce, never derived from what was composed. */
export function mintOpaqueCompositionId(
  nonceSource: CompositionIdNonceSource = () => globalThis.crypto.randomUUID(),
): string {
  return `${OPAQUE_COMPOSITION_ID_PREFIX}:${nonceSource()}`;
}

/** A fresh composition (`'compose'`), or C5.8's outrun growth of an open one (`'extend'`). */
export const COMPOSITION_KINDS = ['compose', 'extend'] as const;
export type CompositionKind = (typeof COMPOSITION_KINDS)[number];

/** One served instrument, in session order, with the reasons the composition recorded for it. */
export interface CompositionChosenItem {
  readonly instrumentId: string;
  /** The concept it was composed under; `null` only when that could not be told apart (`./compose.ts`'s module doc, "`[D-331]`"). */
  readonly conceptKey: string | null;
  /** Which obligation put its concept in front of her today (F6.7); `null` when the composer supplied none. */
  readonly obligationClass: ObligationClass | null;
  /** Whether it matched the format her course's nearest assessment prefers (F4.8). */
  readonly formatMatch: SessionFormatMatch;
  /** `'recall-overdue'` when an overdue recall card was served ahead of format preference (`[D-240]` item 2); otherwise `null`. */
  readonly dedupeReason: QueueItemReason | null;
  /** The ranking's own one-clause reason for its concept, verbatim, when the ranking supplied one; otherwise `null`. Never regenerated. */
  readonly rankedReason: string | null;
}

/** One course's entry of the plan's allocation, frozen as the composition read it: `StudyPlanAllocationEntry` less its prose `reason`. */
export interface CompositionAllocationEntry {
  readonly courseId: string;
  readonly share: number;
  readonly minBlockSeconds: number;
  /** The named lifts that produced `share` (`risk`, `floor`, ...), verbatim. */
  readonly contributions: readonly { readonly name: string; readonly value: number }[];
}

/** The composer's declared constants in force when it ran (`./compose.ts`). */
export interface CompositionDeclaredConstants {
  readonly urgencyOverrideThreshold: number;
  readonly withinBlockProximityHalfLifeDays: number;
  readonly materialArrivalCohortHalfLifeDays: number;
}

/** Her own course-or-topic steering on this composition ([STEER-1]), by id; `null` for no restriction. */
export interface CompositionSteering {
  readonly courses: readonly string[] | null;
  readonly conceptIds: readonly string[] | null;
}

/** The durable composition record, schema version 1. Field order here is the serialized order. */
export interface CompositionRecord {
  readonly schemaVersion: 1;
  readonly kind: CompositionKind;
  readonly compositionId: string;
  /** The sitting this composition belongs to: its own id for `'compose'`, the parent's `sittingId` for `'extend'`. */
  readonly sittingId: string;
  /** `null` for `'compose'`; the record this extension grew for `'extend'`. */
  readonly parentCompositionId: string | null;
  /** When the composition became actual. ISO-8601 with offset: "when did she study" is local. */
  readonly composedAt: string;
  /** The calendar day the composition computed against. */
  readonly asOf: CalendarDay;
  /** Whether F6.6's re-entry sizing composed it. */
  readonly reentry: boolean;
  readonly focusPolicy: FocusPolicy;
  /** The session's one course (C5.6, F2.18); `null` only under the harness's `'every-course'` baseline. */
  readonly course: string | null;
  /** Which of C5.6's tests chose `course`; `null` exactly when `course` is. The sentence is rendered from it (`FOCUS_BRANCH_SENTENCE`), never stored. */
  readonly branch: FocusBranch | null;
  /** Which F2.19 signal decided the within-course grouping (`./types.ts`). */
  readonly groupingSignal: GroupingSignal;
  readonly steering: CompositionSteering;
  /** The declared target, in minutes, this composition filled toward (`[D-091]`: a target, never a cap). */
  readonly budgetMinutes: number;
  /** The study plan's `policyVersion` whose allocation the composition read; `null` when no plan was in force (the interim shares). */
  readonly planVersion: string | null;
  /** Every OTHER delivered policy artifact the composition read, by artifact kind (for example `rank-weights`); an absent kind means its declared client fallback applied. */
  readonly policyVersions: Readonly<Record<string, string>>;
  /** The plan's allocation as read; empty when none was in force. */
  readonly planAllocation: readonly CompositionAllocationEntry[];
  readonly declaredConstants: CompositionDeclaredConstants;
  /** Every served instrument, in the order she meets them. */
  readonly chosen: readonly CompositionChosenItem[];
  readonly setAside: CompositionSetAside;
}

/** What {@link buildCompositionRecord} needs beyond the session itself — facts the composer's caller holds. */
export interface CompositionRecordContext {
  /** Minted by {@link mintOpaqueCompositionId}. */
  readonly compositionId: string;
  /** ISO-8601 with offset. */
  readonly composedAt: string;
  /** The `policyVersion` of the plan whose `allocation` is passed below, or `null`. */
  readonly planVersion: string | null;
  /** Other delivered policy artifacts the composition read, by kind. Omitted means none. Never the study plan's, which is {@link planVersion}. */
  readonly policyVersions?: Readonly<Record<string, string>>;
  readonly reentry: boolean;
  /** The composer input's own `allocation`, passed through unmodified. */
  readonly allocation?: readonly StudyPlanAllocationEntry[];
  /** The composer input's own `courses` steering, passed through unmodified. */
  readonly courses?: readonly string[];
  /** The composer input's own `conceptIds` steering, passed through unmodified. */
  readonly conceptIds?: readonly string[];
}

/** What {@link buildExtendedCompositionRecord} needs beyond the parent record and the extended session. */
export interface ExtendedCompositionRecordContext {
  readonly compositionId: string;
  readonly composedAt: string;
  /** The day the extension composed against. */
  readonly asOf: CalendarDay;
  /** The widened target the extension filled toward. */
  readonly budgetMinutes: number;
}

const FOCUS_BRANCHES = Object.keys(FOCUS_BRANCH_SENTENCE) as readonly FocusBranch[];
const FOCUS_POLICIES = Object.keys({
  single: true,
  'every-course': true,
} satisfies Record<FocusPolicy, true>) as readonly FocusPolicy[];
const OBLIGATION_CLASSES = Object.keys({
  unmet: true,
  'recall-due': true,
  'baseline-due': true,
  elective: true,
} satisfies Record<ObligationClass, true>) as readonly ObligationClass[];
const FORMAT_MATCHES = Object.keys({
  'preferred-format': true,
  'other-format': true,
  'no-preference': true,
} satisfies Record<SessionFormatMatch, true>) as readonly SessionFormatMatch[];
const QUEUE_ITEM_REASONS = Object.keys({
  'format-match': true,
  'recall-overdue': true,
} satisfies Record<QueueItemReason, true>) as readonly QueueItemReason[];

/** An artifact kind as the envelope names one (`rank-weights`, `depth-gate`). */
const ARTIFACT_KIND_RE = /^[a-z][a-z0-9-]*$/;
/** ISO-8601 with seconds and an offset, the review log's own timestamp discipline. */
const TIMESTAMP_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const RECORD_KEYS = [
  'schemaVersion',
  'kind',
  'compositionId',
  'sittingId',
  'parentCompositionId',
  'composedAt',
  'asOf',
  'reentry',
  'focusPolicy',
  'course',
  'branch',
  'groupingSignal',
  'steering',
  'budgetMinutes',
  'planVersion',
  'policyVersions',
  'planAllocation',
  'declaredConstants',
  'chosen',
  'setAside',
] as const satisfies readonly (keyof CompositionRecord)[];

/** The composer's declared constants as this build holds them. */
function currentDeclaredConstants(): CompositionDeclaredConstants {
  return {
    urgencyOverrideThreshold: URGENCY_OVERRIDE_THRESHOLD,
    withinBlockProximityHalfLifeDays: WITHIN_BLOCK_PROXIMITY_HALF_LIFE_DAYS,
    materialArrivalCohortHalfLifeDays: MATERIAL_ARRIVAL_COHORT_HALF_LIFE_DAYS,
  };
}

/** `-0` reads back from JSON as `0`; writing it as `0` keeps a record equal to its own round trip. */
function num(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The record rebuilt key by key in its one serialized order. Every writer and the parser go through it. */
function canonical(record: CompositionRecord): CompositionRecord {
  return {
    schemaVersion: record.schemaVersion,
    kind: record.kind,
    compositionId: record.compositionId,
    sittingId: record.sittingId,
    parentCompositionId: record.parentCompositionId,
    composedAt: record.composedAt,
    asOf: record.asOf,
    reentry: record.reentry,
    focusPolicy: record.focusPolicy,
    course: record.course,
    branch: record.branch,
    groupingSignal: record.groupingSignal,
    steering: {
      courses: record.steering.courses === null ? null : [...record.steering.courses],
      conceptIds: record.steering.conceptIds === null ? null : [...record.steering.conceptIds],
    },
    budgetMinutes: num(record.budgetMinutes),
    planVersion: record.planVersion,
    policyVersions: Object.fromEntries(
      Object.entries(record.policyVersions).sort(([a], [b]) => compareStrings(a, b)),
    ),
    planAllocation: record.planAllocation.map((entry) => ({
      courseId: entry.courseId,
      share: num(entry.share),
      minBlockSeconds: num(entry.minBlockSeconds),
      contributions: entry.contributions.map((c) => ({ name: c.name, value: num(c.value) })),
    })),
    declaredConstants: {
      urgencyOverrideThreshold: num(record.declaredConstants.urgencyOverrideThreshold),
      withinBlockProximityHalfLifeDays: num(
        record.declaredConstants.withinBlockProximityHalfLifeDays,
      ),
      materialArrivalCohortHalfLifeDays: num(
        record.declaredConstants.materialArrivalCohortHalfLifeDays,
      ),
    },
    chosen: record.chosen.map((item) => ({
      instrumentId: item.instrumentId,
      conceptKey: item.conceptKey,
      obligationClass: item.obligationClass,
      formatMatch: item.formatMatch,
      dedupeReason: item.dedupeReason,
      rankedReason: item.rankedReason,
    })),
    setAside: {
      courses: record.setAside.courses.map((entry) => ({
        courseId: entry.courseId,
        reason: entry.reason,
      })),
      concepts: record.setAside.concepts.map((entry) => ({
        conceptKey: entry.conceptKey,
        reason: entry.reason,
      })),
      instruments: record.setAside.instruments.map((entry) => ({
        instrumentId: entry.instrumentId,
        conceptKey: entry.conceptKey,
        reason: entry.reason,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Validation (hand-rolled guards: this package carries no schema library)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function isNullableStringList(value: unknown): value is readonly string[] | null {
  return value === null || (Array.isArray(value) && value.every(isNonEmptyString));
}

function isTimestampWithOffset(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    TIMESTAMP_WITH_OFFSET_RE.test(value) &&
    isCalendarDay(value.slice(0, 10))
  );
}

function isSteering(value: unknown): value is CompositionSteering {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['courses', 'conceptIds']) &&
    isNullableStringList(value.courses) &&
    isNullableStringList(value.conceptIds)
  );
}

function isPolicyVersions(value: unknown): value is Record<string, string> {
  return (
    isPlainObject(value) &&
    Object.entries(value).every(
      ([kind, version]) =>
        ARTIFACT_KIND_RE.test(kind) && kind !== STUDY_PLAN_KIND && isNonEmptyString(version),
    )
  );
}

function isAllocationEntry(value: unknown): value is CompositionAllocationEntry {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['courseId', 'share', 'minBlockSeconds', 'contributions']) &&
    isNonEmptyString(value.courseId) &&
    isFiniteNumber(value.share) &&
    value.share >= 0 &&
    value.share <= 1 &&
    isFiniteNumber(value.minBlockSeconds) &&
    Number.isInteger(value.minBlockSeconds) &&
    value.minBlockSeconds > 0 &&
    Array.isArray(value.contributions) &&
    value.contributions.length > 0 &&
    value.contributions.every(
      (c: unknown) =>
        isPlainObject(c) &&
        hasExactKeys(c, ['name', 'value']) &&
        isNonEmptyString(c.name) &&
        isFiniteNumber(c.value),
    )
  );
}

function isDeclaredConstants(value: unknown): value is CompositionDeclaredConstants {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      'urgencyOverrideThreshold',
      'withinBlockProximityHalfLifeDays',
      'materialArrivalCohortHalfLifeDays',
    ]) &&
    isFiniteNumber(value.urgencyOverrideThreshold) &&
    isFiniteNumber(value.withinBlockProximityHalfLifeDays) &&
    isFiniteNumber(value.materialArrivalCohortHalfLifeDays)
  );
}

function isChosenItem(value: unknown): value is CompositionChosenItem {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      'instrumentId',
      'conceptKey',
      'obligationClass',
      'formatMatch',
      'dedupeReason',
      'rankedReason',
    ]) &&
    isNonEmptyString(value.instrumentId) &&
    isNullableNonEmptyString(value.conceptKey) &&
    (value.obligationClass === null || isOneOf(OBLIGATION_CLASSES, value.obligationClass)) &&
    isOneOf(FORMAT_MATCHES, value.formatMatch) &&
    (value.dedupeReason === null || isOneOf(QUEUE_ITEM_REASONS, value.dedupeReason)) &&
    (value.rankedReason === null || typeof value.rankedReason === 'string')
  );
}

function isSetAsideCourse(value: unknown): value is SetAsideCourse {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['courseId', 'reason']) &&
    isNonEmptyString(value.courseId) &&
    isOneOf(SET_ASIDE_COURSE_REASONS, value.reason)
  );
}

function isSetAsideConcept(value: unknown): value is SetAsideConcept {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['conceptKey', 'reason']) &&
    isNonEmptyString(value.conceptKey) &&
    isOneOf(SET_ASIDE_CONCEPT_REASONS, value.reason)
  );
}

function isSetAsideInstrument(value: unknown): value is SetAsideInstrument {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['instrumentId', 'conceptKey', 'reason']) &&
    isNonEmptyString(value.instrumentId) &&
    isNonEmptyString(value.conceptKey) &&
    isOneOf(SET_ASIDE_INSTRUMENT_REASONS, value.reason)
  );
}

function isSetAside(value: unknown): value is CompositionSetAside {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['courses', 'concepts', 'instruments']) &&
    Array.isArray(value.courses) &&
    value.courses.every(isSetAsideCourse) &&
    Array.isArray(value.concepts) &&
    value.concepts.every(isSetAsideConcept) &&
    Array.isArray(value.instruments) &&
    value.instruments.every(isSetAsideInstrument)
  );
}

/**
 * Validates one parsed JSON value as a {@link CompositionRecord} and returns it in canonical
 * form, or `null` on any failure. `schemaVersion` is read first: any value but `1` (missing,
 * non-numeric, or a newer version this build does not know) is unreadable here, never
 * reinterpreted. Exact key sets throughout: a field this build does not know is a shape it does
 * not understand, so the line is refused rather than silently narrowed.
 */
export function parseCompositionRecord(json: unknown): CompositionRecord | null {
  if (!isPlainObject(json)) return null;
  if (json.schemaVersion !== COMPOSITION_RECORD_SCHEMA_VERSION) return null;
  if (!hasExactKeys(json, RECORD_KEYS)) return null;
  const v = json;
  if (!isOneOf(COMPOSITION_KINDS, v.kind)) return null;
  if (!isNonEmptyString(v.compositionId) || !isNonEmptyString(v.sittingId)) return null;
  if (!isNullableNonEmptyString(v.parentCompositionId)) return null;
  // A fresh composition opens its own sitting; an extension always names what it grew.
  if (v.kind === 'compose' && (v.parentCompositionId !== null || v.sittingId !== v.compositionId)) {
    return null;
  }
  if (v.kind === 'extend' && v.parentCompositionId === null) return null;
  if (!isTimestampWithOffset(v.composedAt)) return null;
  if (typeof v.asOf !== 'string' || !isCalendarDay(v.asOf)) return null;
  if (typeof v.reentry !== 'boolean') return null;
  if (!isOneOf(FOCUS_POLICIES, v.focusPolicy)) return null;
  if (!isNullableNonEmptyString(v.course)) return null;
  if (!(v.branch === null || isOneOf(FOCUS_BRANCHES, v.branch))) return null;
  if ((v.course === null) !== (v.branch === null)) return null;
  if (!isOneOf(GROUPING_SIGNALS, v.groupingSignal)) return null;
  if (!isSteering(v.steering)) return null;
  if (!isFiniteNumber(v.budgetMinutes) || v.budgetMinutes <= 0) return null;
  if (!isNullableNonEmptyString(v.planVersion)) return null;
  if (!isPolicyVersions(v.policyVersions)) return null;
  if (!Array.isArray(v.planAllocation) || !v.planAllocation.every(isAllocationEntry)) return null;
  if (!isDeclaredConstants(v.declaredConstants)) return null;
  if (!Array.isArray(v.chosen) || !v.chosen.every(isChosenItem)) return null;
  if (!isSetAside(v.setAside)) return null;
  return canonical(v as unknown as CompositionRecord);
}

/** One record as one JSONL line, `\n`-terminated, in canonical form (see the module doc's INV-2 section). */
export function serializeCompositionRecord(record: CompositionRecord): string {
  return `${JSON.stringify(canonical(record))}\n`;
}

export interface InvalidCompositionLogLine {
  /** 1-based, as an editor shows it. */
  readonly lineNumber: number;
  readonly reason: string;
}

export interface ParseCompositionLogResult {
  /** Every valid record, in file order. */
  readonly records: readonly CompositionRecord[];
  /** Lines that failed JSON or the schema — reported, never thrown, never affecting another line. A partial trailing line from an interrupted append lands here. Carries no line text: a record line holds ids and may hold a recorded reason, and a diagnostic has no need of either. */
  readonly invalidLines: readonly InvalidCompositionLogLine[];
}

/**
 * Parses append-only composition-log JSONL content, the misconception and review logs' own
 * line discipline: `\n`-terminated lines, `\r\n` tolerated, blank lines skipped, every line
 * validated on its own so a crash mid-append costs only its own line.
 */
export function parseCompositionLog(content: string): ParseCompositionLogResult {
  const records: CompositionRecord[] = [];
  const invalidLines: InvalidCompositionLogLine[] = [];
  const lines = content.split('\n');
  lines.forEach((rawLine, index) => {
    if (index === lines.length - 1 && rawLine === '') return;
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      invalidLines.push({ lineNumber: index + 1, reason: 'invalid JSON' });
      return;
    }
    const record = parseCompositionRecord(json);
    if (record === null) {
      invalidLines.push({
        lineNumber: index + 1,
        reason: 'not a composition record this build can read at its declared schemaVersion',
      });
      return;
    }
    records.push(record);
  });
  return { records, invalidLines };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

interface CompositionAccount {
  readonly groupingSignal: GroupingSignal;
  readonly setAside: CompositionSetAside;
  readonly itemConceptKeys: ReadonlyMap<string, string>;
}

/** The session's `[D-331]` account, required: a session without one was not built by the composer, and a record of it would state facts nobody computed. */
function requireAccount(session: ComposedStudySession, caller: string): CompositionAccount {
  const { groupingSignal, setAside, itemConceptKeys } = session;
  if (groupingSignal === undefined || setAside === undefined || itemConceptKeys === undefined) {
    throw new Error(
      `${caller}: the session carries no composition account; compose it with buildComposedStudySession or extendComposedStudySessionWithAccount`,
    );
  }
  return { groupingSignal, setAside, itemConceptKeys };
}

function chosenItems(
  items: readonly StudySessionItem[],
  itemConceptKeys: ReadonlyMap<string, string>,
): readonly CompositionChosenItem[] {
  return items.map((item) => ({
    instrumentId: item.instrumentId,
    conceptKey: itemConceptKeys.get(item.instrumentId) ?? null,
    obligationClass: item.obligationClass ?? null,
    formatMatch: item.formatMatch,
    dedupeReason: item.dedupeReason ?? null,
    rankedReason: item.rankedReason ?? null,
  }));
}

function frozenAllocation(
  allocation: readonly StudyPlanAllocationEntry[] | undefined,
): readonly CompositionAllocationEntry[] {
  return (allocation ?? []).map((entry) => ({
    courseId: entry.courseId,
    share: entry.share,
    minBlockSeconds: entry.minBlockSeconds,
    contributions: entry.contributions.map((c) => ({ name: c.name, value: c.value })),
  }));
}

/** Every record a builder returns passes the parser, so nothing unreadable can reach a writer. */
function validated(record: CompositionRecord, caller: string): CompositionRecord {
  const parsed = parseCompositionRecord(record);
  if (parsed === null) {
    throw new Error(`${caller}: the composition does not make a valid composition record`);
  }
  return parsed;
}

/**
 * The record of one fresh, actual composition (`kind: 'compose'`). `session` must come from
 * `buildComposedStudySession` (directly or as `composeReentrySession`'s `full`), which carries
 * the `[D-331]` account; `context` carries what only the caller holds — the id and instant, the
 * plan version and other policy versions it read, whether this was a re-entry, and the composer
 * input's own `allocation` and steering, passed through unmodified. Throws on a caller error (no
 * account, a malformed timestamp or id, a policy version filed under the study plan's kind): a
 * record that cannot be read back is a bug at the call site, never something to write.
 */
export function buildCompositionRecord(
  session: ComposedStudySession,
  context: CompositionRecordContext,
): CompositionRecord {
  const account = requireAccount(session, 'buildCompositionRecord');
  return validated(
    canonical({
      schemaVersion: 1,
      kind: 'compose',
      compositionId: context.compositionId,
      sittingId: context.compositionId,
      parentCompositionId: null,
      composedAt: context.composedAt,
      asOf: session.model.asOf,
      reentry: context.reentry,
      focusPolicy: session.focusPolicy ?? 'single',
      course: session.dominantCourse ?? null,
      branch: session.focusBranch ?? null,
      groupingSignal: account.groupingSignal,
      steering: { courses: context.courses ?? null, conceptIds: context.conceptIds ?? null },
      budgetMinutes: session.model.budgetMinutes,
      planVersion: context.planVersion,
      policyVersions: context.policyVersions ?? {},
      planAllocation: frozenAllocation(context.allocation),
      declaredConstants: currentDeclaredConstants(),
      chosen: chosenItems(session.model.items, account.itemConceptKeys),
      setAside: account.setAside,
    }),
    'buildCompositionRecord',
  );
}

/**
 * The record of C5.8's outrun growth of an open sitting (`kind: 'extend'`). `session` must be the
 * extended session `extendComposedStudySessionWithAccount` returns (its account kept true through
 * the growth). Everything the extension holds "under the same plan's shares" — the course, the
 * branch, the grouping signal, the steering, the plan version, the other policy versions, the
 * frozen allocation, the declared constants and the re-entry flag — is carried from `parent`,
 * never re-read; what changed (the served list, the set-asides, the widened target, the day and
 * instant) comes from `session` and `context`. What the extension dropped under `[D-330]` is
 * readable as `parent.chosen` less this record's `chosen`, and is listed in `setAside` as
 * `'cited-passage-changed'`. Throws when `session` is not the parent's course (a different
 * sitting's session) or carries no account.
 */
export function buildExtendedCompositionRecord(
  parent: CompositionRecord,
  session: ComposedStudySession,
  context: ExtendedCompositionRecordContext,
): CompositionRecord {
  const account = requireAccount(session, 'buildExtendedCompositionRecord');
  if ((session.dominantCourse ?? null) !== parent.course) {
    throw new Error(
      "buildExtendedCompositionRecord: the extended session is not the parent composition's course",
    );
  }
  return validated(
    canonical({
      ...parent,
      kind: 'extend',
      compositionId: context.compositionId,
      parentCompositionId: parent.compositionId,
      composedAt: context.composedAt,
      asOf: context.asOf,
      budgetMinutes: context.budgetMinutes,
      chosen: chosenItems(session.model.items, account.itemConceptKeys),
      setAside: account.setAside,
    }),
    'buildExtendedCompositionRecord',
  );
}
