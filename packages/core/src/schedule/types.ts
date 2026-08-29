/**
 * Shared record shapes for the schedule-extraction build chain (RHY-3,
 * `ol-4chx` -> `ol-r6s0` -> `ol-hna1` -> `ol-at1a`). See ./event-line.ts for
 * the single-line grammar and ./discover.ts for the vault-wide scan that
 * produces these.
 */

import type { CalendarDay } from '../today/calendar-day.js';
import type { VaultPath } from '../vault/types.js';

export interface ScheduleTimeRange {
  readonly start: string;
  readonly end: string;
}

/**
 * One matched event line. `label` is a CANDIDATE course label — verbatim as
 * written on the line, uncompared against any course-code roster. Matching
 * it to a known course case-insensitively (RHY-3 §9's own observation is
 * that this vault's calendar casing and folder casing disagree on every
 * single line) is `ol-r6s0`'s job, not this bead's.
 */
export interface ScheduleEventRecord {
  readonly sourcePath: VaultPath;
  /** 1-based line number — an internal diagnostic only; never logged with note content (D-005) and never shown to her. */
  readonly lineNumber: number;
  readonly label: string;
  /** Canonical lowercase weekday name, when recognised. Informational only — never authoritative over `date` (RHY-3 §9). */
  readonly weekday: string | undefined;
  /** Retained per RHY-3 §9 for a possible future same-day disambiguation; unused by anything in this build chain today. */
  readonly timeRange: ScheduleTimeRange | undefined;
  readonly date: CalendarDay;
}

/** One note's scan result. */
export interface ScheduleNoteScan {
  readonly path: VaultPath;
  readonly events: readonly ScheduleEventRecord[];
  /**
   * Task-list lines in this note that looked like an attempt at the event
   * grammar but did not fit — an internal diagnostic only. RHY-3 §8 Class C
   * stop 2: no surface may report this to her; nothing in `[D-047]`'s
   * vocabulary permits a "couldn't read your calendar" line.
   */
  readonly unparseableLineCount: number;
}

/**
 * The full result of scanning the vault for a calendar-events note. An empty
 * `candidateNotes` is the "no calendar signal" case (RHY-3 §6, row 1) —
 * never an error. This layer does not distinguish "no note exists" from "a
 * note exists but nothing in it matched the grammar" — both collapse to the
 * same empty report, and choosing how to degrade from that is a caller's
 * job, out of this bead's scope.
 */
export interface ScheduleDiscoveryReport {
  /** Every markdown note examined, in the vault's stable sorted order. */
  readonly notesScanned: readonly VaultPath[];
  /**
   * Notes with at least one successfully matched event line — the discovery
   * evidence itself, never a single hardcoded winner path. Empty when
   * nothing anywhere in the vault matches.
   */
  readonly candidateNotes: readonly ScheduleNoteScan[];
  /** Every matched event across all candidate notes, flattened, in `candidateNotes` order. */
  readonly events: readonly ScheduleEventRecord[];
  /** Sum of `unparseableLineCount` across every note scanned, not only candidates — an internal diagnostic only, same posture as above. */
  readonly totalUnparseableLines: number;
}

/**
 * Why a candidate label was not associated with a known course (`ol-r6s0`,
 * RHY-3 §9's course-association rule). Both collapse to the same "unusable
 * for schedule inference" treatment downstream — RHY-3 §8 Class C stop 2
 * forbids any surface reporting either to her — but the distinction is kept
 * as an internal diagnostic rather than discarded, the same posture
 * `unparseableLineCount` already takes.
 *
 * - `no-match`: the label matched zero known course codes. Expected and
 *   ordinary — a personal or non-course calendar entry is a legitimate
 *   reason for this, never an error.
 * - `ambiguous`: the label matched more than one known course code
 *   case-insensitively. Not observed in the reference vault (RHY-3 §9), but
 *   named rather than assumed impossible — a longer roster can collide.
 */
export type ScheduleAssociationMiss = 'no-match' | 'ambiguous';

/** One event whose label matched exactly one known course. */
export interface AssociatedScheduleEvent {
  readonly event: ScheduleEventRecord;
  /**
   * The known course code as the roster spelled it — never the calendar
   * label's own casing. RHY-3 §9: this vault's calendar casing and folder
   * casing disagree on every single line, so the roster's spelling is the
   * one later stages (`courseFromPath`'s own codes) already expect.
   */
  readonly courseCode: string;
}

/** One event whose label could not be associated with exactly one known course. */
export interface UnmatchedScheduleEvent {
  readonly event: ScheduleEventRecord;
  readonly reason: ScheduleAssociationMiss;
}

/**
 * The result of associating a set of parsed events against a known
 * course-code roster (`ol-r6s0`). Per RHY-3 §9's last paragraph, ambiguity
 * and gaps degrade **per event**, never per note or across the whole
 * report — one unmatched event never removes another event's match, so
 * both buckets are always populated independently rather than one
 * short-circuiting the other.
 */
export interface ScheduleAssociationReport {
  readonly matched: readonly AssociatedScheduleEvent[];
  readonly unmatched: readonly UnmatchedScheduleEvent[];
}
