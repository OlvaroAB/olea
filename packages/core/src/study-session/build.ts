/**
 * The session builder (F4.6, F4.7, F4.8; P5-T06b, `ol-p5t06b`).
 *
 * > **F4.6 Session builder.** From the gap view, assemble a time-bounded
 * > session ("Build a 20-minute session") drawing on the highest-priority gaps.
 * > **F4.7** Exam countdown driving prioritisation.
 * > **F4.8 Assessment-format matching.** Practice should match the format she
 * > will actually face — MCQ drilling for quizzes, etc.
 *
 * ## What this module does NOT do, and the reason matters
 *
 * **It does not rank anything.** `rankOracle` (`../oracle/rank.ts`) already
 * produced the order, `buildGapView` already applied R7's readiness weight to
 * it, and `GapRow.gapScore` is the result. This module *selects a prefix* of
 * that order that fits in a number of minutes. A second scoring pass here
 * would be a second opinion about what is worth studying, competing silently
 * with the one the whole F4 chain exists to produce.
 *
 * **It does not recompute exam proximity (F4.7).** `computeExamProximity` is
 * inside `rank.ts`'s per-edge contribution and is already folded into the
 * `priorityScore` that becomes `gapScore` — the countdown is *already driving
 * prioritisation* before this module is called. What was missing was that she
 * could not SEE it: no surface named the assessment or the number of days.
 * {@link StudySessionModel.nextAssessment} is that surfacing, and it is plain
 * calendar arithmetic on the assessment's own `due` field (`../dates.ts`'s
 * `daysBetween`), never a re-derivation of the score.
 *
 * **It does not widen the format map (F4.8).** `assessmentFormatOf`
 * (`../gap/readiness.ts`) maps `quiz -> mcq` and nothing else, deliberately,
 * and that module's doc says outright that adding a row is a decision-bead
 * matter and not an implementer's default. This module consumes
 * `GapRow.assessmentFormat` verbatim. An `'unknown'` format expresses no
 * preference and reorders nothing — the honest answer far more often than the
 * other one.
 *
 * ## The fill, stated plainly so the result is auditable
 *
 * Rows are taken in gapScore order (highest first). The fill runs in **passes**:
 * each pass offers every row one instrument, so a 20-minute session spreads
 * across her top gaps before it gives any single concept a second card. Within
 * a row, instruments matching the preferred format come first, then the
 * enumeration's own vault order; the first one that fits the remaining budget
 * is taken. The fill stops when a whole pass adds nothing.
 *
 * Breadth before depth is a **judgement, and a reversible one**: "drawing on
 * the highest-priority gaps" (F4.6, plural) reads as covering several rather
 * than exhausting one, and twenty minutes on one concept is a session she could
 * have built herself. It is not measured against anything and it is not a
 * threshold — swapping it for depth-first is a change to this loop and to
 * nothing else.
 *
 * ## Leaving out is information, not truncation
 *
 * Every considered row that contributed no instrument appears in
 * {@link StudySessionModel.leftOut} with a machine-readable reason. This is the
 * same rule `ol-cvsc` established one screen over: a list she cannot see the
 * edge of is a claim about her material that nothing established. "Did not
 * fit", "no cards yet" and "already in this session" have different
 * consequences for her, so they are different values rather than one absence.
 *
 * ## Framing
 *
 * Nothing here produces prose. Every string she reads lives in
 * `packages/plugin/src/session-builder/copy.ts`, which is where F4.9's three
 * clauses and principle 12 are asserted — the same split `gap/build.ts` and
 * `gap/copy.ts` hold, for the same reason (`ol-09kf`).
 *
 * **INV-1 / §7.1.** Pure. No `obsidian`, no vault I/O, no clock (`asOf` is an
 * argument), nothing stored.
 */

import type { AssessmentRecord } from '../assessment/types.js';
import { daysBetween } from '../dates.js';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import { assessmentFormatOf } from '../gap/readiness.js';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import type { VaultInstrumentRecord } from '../session/types.js';
import type { CalendarDay } from '../today/calendar-day.js';
import { isCalendarDay } from '../today/calendar-day.js';
import type { VaultPath } from '../vault/types.js';
import type { DurationEstimateSource, DurationModel, DurationModelBasis } from './duration.js';
import type { ConceptInstrumentIndex } from './instrument-index.js';

/**
 * Whether a chosen instrument matches the format of the assessment she meets
 * next (F4.8).
 *
 * `'no-preference'` is its own value rather than being folded into
 * `'other-format'`: "this is the format your quiz will use" and "we do not
 * know what format your next assessment takes" are different things to be able
 * to say, and only the first of them is a claim.
 */
export type SessionFormatMatch = 'preferred-format' | 'other-format' | 'no-preference';

/** Why a considered concept contributed nothing to the session. */
export type StudySessionOmissionReason =
  /** Its instruments exist, and none of them fit in the time that was left. */
  | 'did-not-fit'
  /** No instrument practises it at all — the coverage gap (F4.5) or the material gap (F4.10), told apart by the omission's own `gapClass`. */
  | 'no-instruments'
  /** Every instrument that practises it was already in the session, chosen for a higher-ranked concept its note also names (`ol-t3sd`). */
  | 'already-in-session';

/** One instrument the session offers, with everything that put it there kept inspectable. */
export interface StudySessionItem {
  /** 1-based position in the session, in the order she will meet them. */
  readonly position: number;
  readonly instrumentId: string;
  readonly instrumentType: SchedulableInstrumentType;
  readonly notePath: VaultPath;
  readonly noteTitle: string;
  /** The gap row that selected it. An instrument naming several concepts is attributed to the highest-ranked one that reached it. */
  readonly conceptName: string;
  readonly course: string;
  readonly gapClass: GapClass;
  /** `GapRow.rank` — its position within its own course's gap view, so "why is this here" is answerable against the screen she came from. */
  readonly gapRank: number;
  readonly gapScore: number;
  readonly estimatedSeconds: number;
  /** Whether {@link estimatedSeconds} came from her own review history or from Olea's assumption — see `./duration.ts`. */
  readonly durationSource: DurationEstimateSource;
  readonly formatMatch: SessionFormatMatch;
}

/** One considered concept the session does not contain, and why. */
export interface StudySessionOmission {
  readonly conceptName: string;
  readonly course: string;
  readonly gapClass: GapClass;
  readonly gapRank: number;
  readonly reason: StudySessionOmissionReason;
}

/**
 * The assessment she meets next among the ones this session's rows are ranked
 * against (F4.7) — surfaced, never re-scored. See the module doc.
 */
export interface SessionAssessmentCountdown {
  readonly assessmentPath: VaultPath;
  /** The record's own `due`, verbatim, or `null` when it has none. Never reformatted here — R1/R2. */
  readonly due: string | null;
  /**
   * Whole calendar days from `asOf` to `due`, or **`null`** when `due` is
   * absent or not a `YYYY-MM-DD` day.
   *
   * `null` rather than `0`, and this is the one number on this model most
   * likely to be got wrong by a later edit: "we cannot read when this is" and
   * "this is today" are different facts, and rendering the first as the second
   * is a false urgency Olea invented.
   */
  readonly daysUntil: number | null;
  /** The record's own `type`, verbatim, or `null`. The copy layer names the assessment with it; nothing branches on it here. */
  readonly type: string | null;
  /** What {@link type} resolves to under `assessmentFormatOf` — carried so the surface never has to re-derive the format map. */
  readonly format: AssessmentFormat;
}

export interface StudySessionModel {
  readonly asOf: CalendarDay;
  readonly budgetMinutes: number;
  readonly budgetSeconds: number;
  /** Sum of the chosen items' estimates. Never greater than {@link budgetSeconds}. */
  readonly plannedSeconds: number;
  readonly items: readonly StudySessionItem[];
  readonly leftOut: readonly StudySessionOmission[];
  /** Instruments across the considered rows that the session does not contain. A count, because naming every unchosen card is a different screen. */
  readonly leftOutInstrumentCount: number;
  /**
   * How many gap rows this fill looked at.
   *
   * **Zero is a distinct state from an empty `items` list**, and the surface
   * has to be able to tell them apart: zero rows means the oracle had nothing
   * to rank (every course abstained, or her material yielded no evidence),
   * which is "we have nothing to build from" — a very different sentence from
   * "nothing fit in twenty minutes".
   */
  readonly consideredRowCount: number;
  /** The format the fill preferred (F4.8), derived from {@link nextAssessment}. `'unknown'` prefers nothing and reorders nothing. */
  readonly formatPreference: AssessmentFormat;
  readonly nextAssessment: SessionAssessmentCountdown | null;
  /** Whether the times above rest on her review history or on Olea's assumptions — `./duration.ts`'s own basis, passed through. */
  readonly durationBasis: DurationModelBasis;
  /** The concept the caller asked the session to start from, if any (the gap view's `build-session` affordance). Echoed so the surface can say what it did. */
  readonly focusConcept: string | null;
}

export interface BuildStudySessionInput {
  /**
   * The gap rows to draw from — `allGapRows(model)` for the whole view, or one
   * course's `rows`. Sorted here rather than assumed sorted: `buildGapView`
   * orders within a course, and a caller flattening several courses has an
   * order this module must not inherit by accident.
   */
  readonly rows: readonly GapRow[];
  readonly instruments: ConceptInstrumentIndex;
  /** Must be finite and greater than zero. */
  readonly budgetMinutes: number;
  readonly durations: DurationModel;
  /** The day the session is being built for, `YYYY-MM-DD` — the countdown's origin. Must be a calendar day. */
  readonly asOf: CalendarDay;
  /**
   * The assessments the rows' `targetAssessmentPath`s point into —
   * `AssessmentReadReport.records`, unmodified. Omitted entirely means no
   * countdown and no format preference, which weights and reorders nothing.
   */
  readonly assessments?: readonly AssessmentRecord[];
  /**
   * Start from this concept (the gap view's `build-session` affordance).
   *
   * It moves the row to the front of the fill and **changes nothing else** —
   * not its gapScore, not the other rows' order, not what the countdown says.
   * A concept absent from `rows` is not an error: the session is built without
   * it and `focusConcept` still echoes what was asked for, so the surface can
   * say "we could not find that in your gap view" rather than silently
   * pretending it was honoured.
   */
  readonly focusConceptName?: string;
}

const SECONDS_PER_MINUTE = 60;

/** Whole calendar days from `asOf` to `due`, or `null` when either is unreadable. See {@link SessionAssessmentCountdown.daysUntil}. */
function daysUntilDue(asOf: CalendarDay, due: string | undefined): number | null {
  if (due === undefined || !isCalendarDay(due) || !isCalendarDay(asOf)) return null;
  return daysBetween(new Date(`${asOf}T00:00:00.000Z`), new Date(`${due}T00:00:00.000Z`));
}

/**
 * Rows in the order the fill will walk them: gapScore descending, then the
 * gap view's own tiebreak (rank, then concept name) so a flattened multi-course
 * list is as deterministic as a single course's was. `focusConceptName`, when it
 * names a row, is lifted to the front afterwards.
 */
function fillOrder(
  rows: readonly GapRow[],
  focusConceptName: string | undefined,
): readonly GapRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.gapScore !== b.gapScore) return b.gapScore - a.gapScore;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.course !== b.course) return a.course < b.course ? -1 : 1;
    return a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0;
  });
  if (focusConceptName === undefined) return sorted;
  const at = sorted.findIndex((row) => row.conceptName === focusConceptName);
  const focused = at <= 0 ? undefined : sorted[at];
  if (focused === undefined) return sorted;
  return [focused, ...sorted.slice(0, at), ...sorted.slice(at + 1)];
}

/**
 * The assessment she meets next in the courses this session covers (F4.7), and
 * therefore the format she will actually face (F4.8).
 *
 * **"Next" is the soonest by DATE, not the highest-contributing.** This is the
 * one place where the session builder deliberately reads something other than
 * `GapRow.targetAssessmentPath`, and the reason is in the contract's own
 * wording: F4.8 says practice should match the format she *will actually face*,
 * and F4.7 is a *countdown*. Both are questions about the calendar.
 * `targetAssessmentPath` answers a different question — which assessment drove
 * this concept's score — and on a real timetable those diverge routinely: a
 * heavily-weighted final three months out can out-contribute a small quiz
 * tomorrow while the quiz is still the thing she sits next. Counting down to
 * the final, and drilling in the final's format, would be the wrong answer to
 * both clauses.
 *
 * The divergence is deliberate and is worth stating beside R7's: the gap view
 * weights *readiness* against the assessment that drove the score, and this
 * matches *format* against the assessment she meets next. They are different
 * questions and may legitimately name different papers.
 *
 * Scoped to the courses the rows are actually about, so a quiz in a course this
 * session contains nothing from never sets its format. An assessment already
 * past is never chosen — `rank.ts` scores it 0 for the same reason, and a
 * countdown to a date behind her is the clearest possible way to be wrong.
 *
 * **`status` is not consulted.** It is her free text (`AssessmentRecord.status`
 * is preserved verbatim and never normalised), and branching on values nobody
 * has enumerated is the guess this pipeline refuses everywhere else. The date
 * filter does the work.
 *
 * When no assessment record has a readable future date, the highest-priority
 * row's own target is named instead, with an explicit `daysUntil: null` — so
 * the surface can still say what the ranking is aimed at without inventing a
 * countdown.
 */
function nextAssessmentOf(
  rows: readonly GapRow[],
  assessments: readonly AssessmentRecord[] | undefined,
  asOf: CalendarDay,
): SessionAssessmentCountdown | null {
  if (rows.length === 0) return null;
  const byPath = new Map<VaultPath, AssessmentRecord>();
  for (const record of assessments ?? []) byPath.set(record.path, record);
  const courses = new Set(rows.map((row) => row.course));

  let soonest: AssessmentRecord | null = null;
  let soonestDays = Number.POSITIVE_INFINITY;
  for (const record of assessments ?? []) {
    if (record.course === undefined || !courses.has(record.course)) continue;
    const days = daysUntilDue(asOf, record.due);
    if (days === null || days < 0) continue;
    const closer =
      days < soonestDays ||
      // Deterministic tiebreak on the same day, so two assessments due together
      // do not depend on the order the Base was read in.
      (days === soonestDays && soonest !== null && record.path < soonest.path);
    if (soonest === null || closer) {
      soonest = record;
      soonestDays = days;
    }
  }

  if (soonest !== null) {
    return {
      assessmentPath: soonest.path,
      due: soonest.due ?? null,
      daysUntil: soonestDays,
      type: soonest.type ?? null,
      format: assessmentFormatOf(soonest.type),
    };
  }

  // Nothing with a readable future date. Name what the top row is aimed at,
  // with an explicit null countdown — see this function's doc.
  const top = rows.find((row) => row.targetAssessmentPath !== null);
  if (top === undefined || top.targetAssessmentPath === null) return null;
  const record = byPath.get(top.targetAssessmentPath);
  return {
    assessmentPath: top.targetAssessmentPath,
    due: record?.due ?? null,
    daysUntil: daysUntilDue(asOf, record?.due),
    type: record?.type ?? null,
    // The gap row's own reading, verbatim — this branch has no record to
    // resolve a format from, and the row already resolved one.
    format: top.assessmentFormat,
  };
}

/** Instrument types that satisfy an `AssessmentFormat`. One entry, matching `assessmentFormatOf`'s one entry — this module widens nothing. */
function typesMatching(format: AssessmentFormat): readonly SchedulableInstrumentType[] {
  return format === 'mcq' ? ['mcq'] : [];
}

/**
 * One row's instruments, preferred format first, the enumeration's own order
 * within each half. A stable partition, not a sort — the vault order
 * `enumerateVaultInstruments` guarantees survives inside both halves.
 */
function orderedForFormat(
  records: readonly VaultInstrumentRecord[],
  format: AssessmentFormat,
): readonly VaultInstrumentRecord[] {
  const preferred = typesMatching(format);
  if (preferred.length === 0) return records;
  const first: VaultInstrumentRecord[] = [];
  const rest: VaultInstrumentRecord[] = [];
  for (const record of records) {
    if (preferred.includes(record.instrumentType)) first.push(record);
    else rest.push(record);
  }
  return [...first, ...rest];
}

function formatMatchOf(
  instrumentType: SchedulableInstrumentType,
  format: AssessmentFormat,
): SessionFormatMatch {
  const preferred = typesMatching(format);
  if (preferred.length === 0) return 'no-preference';
  return preferred.includes(instrumentType) ? 'preferred-format' : 'other-format';
}

/**
 * Build a time-bounded study session from the gap view.
 *
 * Pure: same inputs, same session, always. Throws on a budget that is not a
 * positive finite number of minutes and on an `asOf` that is not a calendar
 * day — both are caller errors that would otherwise produce a confidently
 * wrong session, which is the failure mode this whole surface is built to
 * avoid. Everything else that can go missing (no rows, no instruments, no
 * assessments, no history) is an ordinary state with an honest answer.
 */
export function buildStudySession(input: BuildStudySessionInput): StudySessionModel {
  const { rows, instruments, budgetMinutes, durations, asOf } = input;

  if (!Number.isFinite(budgetMinutes) || budgetMinutes <= 0) {
    throw new Error(
      `buildStudySession: budgetMinutes must be a finite number greater than 0, got ${budgetMinutes}`,
    );
  }
  if (!isCalendarDay(asOf)) {
    throw new Error(
      `buildStudySession: asOf must be a YYYY-MM-DD day, got ${JSON.stringify(asOf)}`,
    );
  }

  const ordered = fillOrder(rows, input.focusConceptName);
  const nextAssessment = nextAssessmentOf(ordered, input.assessments, asOf);
  const formatPreference: AssessmentFormat = nextAssessment?.format ?? 'unknown';
  const budgetSeconds = budgetMinutes * SECONDS_PER_MINUTE;

  // Per row: its instruments in fill order, and how far the fill has walked
  // that list. Built once so the passes below are a walk rather than a
  // repeated lookup.
  const queues = ordered.map((row) => ({
    row,
    records: orderedForFormat(instruments.instrumentsFor(row.conceptName), formatPreference),
    at: 0,
    chose: false,
    /** Set when a row still had instruments left that the remaining budget could not take. */
    blockedByBudget: false,
  }));

  const chosenInstrumentIds = new Set<string>();
  const items: StudySessionItem[] = [];
  let plannedSeconds = 0;

  for (;;) {
    let addedThisPass = false;
    for (const queue of queues) {
      let taken = false;
      let sawUnaffordable = false;
      // Walk from where this row left off. Instruments already in the session
      // (chosen for a higher-ranked concept the same note names) are consumed
      // silently — F2.17's dedupe, over the concept SET, applied to a session
      // instead of a queue.
      while (queue.at < queue.records.length) {
        const record = queue.records[queue.at];
        if (record === undefined) break;
        if (chosenInstrumentIds.has(record.instrumentId)) {
          queue.at += 1;
          continue;
        }
        const seconds = durations.secondsFor(record.instrumentType);
        if (plannedSeconds + seconds > budgetSeconds) {
          // Do NOT advance `at`: this instrument is still a candidate if a
          // later pass has room, and skipping past it would drop it silently.
          sawUnaffordable = true;
          break;
        }
        queue.at += 1;
        chosenInstrumentIds.add(record.instrumentId);
        plannedSeconds += seconds;
        items.push({
          position: items.length + 1,
          instrumentId: record.instrumentId,
          instrumentType: record.instrumentType,
          notePath: record.notePath,
          noteTitle: record.noteTitle,
          conceptName: queue.row.conceptName,
          course: queue.row.course,
          gapClass: queue.row.gapClass,
          gapRank: queue.row.rank,
          gapScore: queue.row.gapScore,
          estimatedSeconds: seconds,
          durationSource: durations.sourceFor(record.instrumentType),
          formatMatch: formatMatchOf(record.instrumentType, formatPreference),
        });
        queue.chose = true;
        taken = true;
        break;
      }
      if (taken) addedThisPass = true;
      else if (sawUnaffordable) queue.blockedByBudget = true;
    }
    if (!addedThisPass) break;
  }

  const leftOut: StudySessionOmission[] = [];
  let leftOutInstrumentCount = 0;
  for (const queue of queues) {
    const unchosen = queue.records.filter(
      (record) => !chosenInstrumentIds.has(record.instrumentId),
    ).length;
    leftOutInstrumentCount += unchosen;
    if (queue.chose) continue;
    const reason: StudySessionOmissionReason =
      queue.records.length === 0
        ? 'no-instruments'
        : queue.blockedByBudget || unchosen > 0
          ? 'did-not-fit'
          : 'already-in-session';
    leftOut.push({
      conceptName: queue.row.conceptName,
      course: queue.row.course,
      gapClass: queue.row.gapClass,
      gapRank: queue.row.rank,
      reason,
    });
  }

  return {
    asOf,
    budgetMinutes,
    budgetSeconds,
    plannedSeconds,
    items,
    leftOut,
    leftOutInstrumentCount,
    consideredRowCount: ordered.length,
    formatPreference,
    nextAssessment,
    durationBasis: durations.basis,
    focusConcept: input.focusConceptName ?? null,
  };
}
