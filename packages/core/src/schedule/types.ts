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
