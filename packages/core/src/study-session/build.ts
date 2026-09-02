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
 * Rows are taken in gapScore order (highest first) — valid only within one
 * course; `rows` spanning several courses under this default order is
 * rejected outright (XCRS-1, `ol-dq1c`; {@link assertSingleCourseUnderDefaultOrder}),
 * because `gapScore` is never comparable across a course boundary
 * (`packages/contracts/src/study-plan.ts`) — or, when a caller passes
 * `order: 'given'` (`./compose.ts`'s `buildComposedStudySession`,
 * SESS-2/`ol-4a78`), in the order it was handed, already encoding obligation
 * class, cross-course allocation and F2.18's course blocking. The fill runs
 * in **passes**:
 * each pass offers every row one instrument, so a 20-minute session spreads
 * across her top gaps before it gives any single concept a second card. Within
 * a row, instruments matching the preferred format come first, then the
 * enumeration's own vault order.
 *
 * **The budget is a declared target, never a cap (`[D-091]`, component
 * register §3.7; `ol-zji3` [BUD-1]).** While the running total is still below
 * the target, the next instrument is taken regardless of its own length — she
 * is "always free to outrun" the target, in the ruling's own words, so the
 * fill rounds up to the item that crosses the line rather than refusing it.
 * Once the running total reaches or passes the target, nothing further is
 * taken. This replaces an earlier ceiling reading
 * (`features/F4-oracle.md`'s `@auto:core/study-session/build.spec` scenario
 * said the opposite, and was stale against `[D-091]`; both are now
 * corrected). The fill stops when a whole pass adds nothing.
 *
 * Breadth before depth is a **judgement, and a reversible one**: "drawing on
 * the highest-priority gaps" (F4.6, plural) reads as covering several rather
 * than exhausting one, and twenty minutes on one concept is a session she could
 * have built herself. It is not measured against anything and it is not a
 * threshold — swapping it for depth-first is a change to this loop and to
 * nothing else.
 *
 * ## Accepted explain-back (F2.14a, `[D-126]`)
 *
 * `input.acceptedExplainBacks` prices explain-backs she already accepted and
 * produced during this session (`./explain-back.js`) and folds their cost
 * into {@link StudySessionModel.plannedSeconds} and {@link
 * StudySessionModel.explainBackItems} — **never** into `items` or the
 * candidate fill below. They are a given fact, not a candidate: nothing here
 * ranks them against `rows`, and they never compete for or get chosen from a
 * `GapRow`. F2.14a's own requirement is only that "minutes spent inside a
 * time-bounded session come out of that session's declared budget rather
 * than being invisible to the number on screen" — so their total is
 * subtracted from the target before the candidate fill runs (whatever room
 * is left, never negative), and added back into `plannedSeconds` once it is
 * done, so the final total is honest either way. See `./explain-back.js`'s
 * module doc for why this is a separate shape from `StudySessionItem`.
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
import type { ConceptSizeBand } from '../concept/size.js';
import { daysBetween } from '../dates.js';
import type { GapClass, GapRow } from '../gap/build.js';
import type { AssessmentFormat } from '../gap/readiness.js';
import { assessmentFormatOf } from '../gap/readiness.js';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import type { VaultInstrumentRecord } from '../session/types.js';
import type { SelfAssessmentFeeling } from '../support-level/self-assessment.js';
import type { SessionSupportOutcome, SupportLadderTier } from '../support-level/types.js';
import type { CalendarDay } from '../today/calendar-day.js';
import { isCalendarDay } from '../today/calendar-day.js';
import type { VaultPath } from '../vault/types.js';
// Type-only, and the one place this module reaches "up" to `./compose.js`
// (which itself imports value bindings from here) — erased at compile time,
// so it introduces no runtime cycle. `ObligationClass` (F6.7, `ol-y237`) is
// `compose.ts`'s own classification, threaded through so a `StudySessionItem`
// can carry it without this module re-deriving or duplicating it.
import type { ObligationClass } from './compose.js';
import type { DurationEstimateSource, DurationModel, DurationModelBasis } from './duration.js';
import {
  type AcceptedExplainBack,
  type ComposedExplainBackItem,
  priceAcceptedExplainBacks,
  totalExplainBackSeconds,
} from './explain-back.js';
import type { ConceptInstrumentIndex } from './instrument-index.js';
import { chooseSupportLevel, type SupportLevelPresentation } from './support-level-chooser.js';

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

/**
 * Row 3.9's chooser input, threaded through composition ([SUPP-2],
 * `ol-95vv.4`). One cell per concept × ladder tier: every outcome from a
 * SESSION that closed **strictly before** the composition instant of the
 * session this fill call is building — never anything from that session
 * itself. This fill loop calls {@link chooseSupportLevel} once per eligible
 * item, in the same step that composes the rest of the session's contents
 * (never at review time), and every item this call produces reads the same
 * frozen `supportHistory` handed in here — so two items on the same concept
 * × tier in one session always agree, and nothing decided for an earlier
 * item in this same fill can feed the later one. See
 * `./support-level-chooser.js`'s module doc and F2.20 (Amended Sep 2026 —
 * `[D-186]`, "Fixed at composition") for why: a lookup that (accidentally or
 * not) folded in an outcome from the session being composed would answer a
 * different, retroactively-wrong question — exactly the mid-session drift
 * the freeze forbids — and neither this module nor the chooser has a clock
 * or a session id to catch the mistake — the discipline is on whatever
 * builds this lookup, stated here rather than left implicit.
 *
 * A cell with no signal (a concept never reviewed at this tier, or a caller
 * with no history to offer) returns an empty array — the chooser's own cold
 * start (`[D-094]`'s `'prompted'`) already covers it; this is not a case
 * this module special-cases.
 */
export interface SupportLevelHistoryLookup {
  outcomesFor(conceptKey: string, tier: SupportLadderTier): readonly SessionSupportOutcome[];
}

/**
 * `SchedulableInstrumentType` -> the ladder tier row 3.9 scores it at, or
 * `null` when the instrument is out of the ladder's scope entirely.
 *
 * `'mcq'` is the only exclusion: `[D-094]`'s own scope clause gives
 * recognition-tier instruments no ladder at all ("its options are its
 * scaffolding"), and `support-level-signal.ts`'s `deriveFailureShape` throws
 * on one for the same reason. `'qa'`/`'cloze'` are both `'recall'` — row
 * 3.9's ladder does not distinguish card format within the recall tier.
 */
function supportLadderTierFor(instrumentType: SchedulableInstrumentType): SupportLadderTier | null {
  return instrumentType === 'mcq' ? null : 'recall';
}

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
  /**
   * Row 3.9's chooser decision for this item ([SUPP-2], `ol-95vv.4`) — the
   * support level she will be shown, plus why. `undefined` when no decision
   * was made: an `'mcq'` item (out of `[D-094]`'s ladder scope by rule,
   * {@link supportLadderTierFor}) or a caller that supplied no
   * {@link BuildStudySessionInput.supportHistory} at all. Never a fabricated
   * `'independent'`/`'not-offered'` value standing in for "we did not ask" —
   * an absent field says exactly that, the same "state the absence" rule
   * `nextAssessment`/`durationSource` already follow on this shape.
   */
  readonly supportLevel?: SupportLevelPresentation;
  /**
   * SESS-2's obligation classification for this item's own concept (F6.7,
   * `ol-y237`) — which of `'unmet'`/`'recall-due'`/`'baseline-due'`/
   * `'elective'` put it in front of her today, computed once by
   * `./compose.ts`'s `composeSessionRows` and threaded straight through
   * rather than re-derived here (this module "does not rank anything", see
   * the module doc — classifying is ranking's sibling judgement, not this
   * module's to make a second time). Paired with this item's own `notePath`/
   * `noteTitle`, a caller can write F6.7's by-source sentence ("new material
   * from Tuesday's lecture") without touching `ObligationClass` counts or
   * duplicating `classifyObligation`'s logic.
   *
   * `undefined` when no classification was supplied for this row's
   * `conceptKey` — no {@link BuildStudySessionInput.obligationClasses} map at
   * all (every caller before `ol-y237`, and every caller other than
   * `buildComposedStudySession`), or a map that has no entry for this
   * concept. Never a fabricated class standing in for "we did not classify
   * this" — the same "state the absence" rule `supportLevel` above already
   * follows on this shape.
   */
  readonly obligationClass?: ObligationClass;
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
  /**
   * Sum of the chosen items' estimates, **plus every accepted explain-back's
   * price** (F2.14a, `[D-126]`) — the number on screen accounts for both.
   *
   * **May exceed {@link budgetSeconds}** — `[D-091]` (component register
   * §3.7) rules the budget "a declared target never a cap", and she is
   * "always free to outrun it". The candidate fill (see the module doc)
   * keeps taking items while its running total is still below whatever of
   * the target remains after `explainBackItems` and stops once it is at or
   * past it, so at most one candidate item's worth of overshoot is possible
   * from the fill (`ol-zji3` [BUD-1]) — an accepted explain-back can push the
   * total further past target on top of that, honestly, because F2.14a
   * prices it rather than disclaiming it.
   */
  readonly plannedSeconds: number;
  readonly items: readonly StudySessionItem[];
  /**
   * Every explain-back she accepted and produced during this session,
   * priced (F2.14a, `[D-126]`). **Never a member of {@link items}** and
   * never chosen by the fill below — see `./explain-back.js`'s module doc
   * for why this is a separate array rather than a fourth `StudySessionItem`
   * shape. Optional so a hand-built `StudySessionModel` fixture predating
   * F2.14a remains valid; `buildStudySession` always sets it, empty when the
   * caller reports no accepted explain-backs.
   */
  readonly explainBackItems?: readonly ComposedExplainBackItem[];
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
  /**
   * Whether the times above rest on her review history or on Olea's
   * assumptions — `./duration.ts`'s own basis for the candidate items,
   * folded with the accepted explain-back's own source when
   * {@link explainBackItems} is non-empty (a session with only measured
   * cards and one 'assumed' explain-back honestly reads `'mixed'`, never
   * silently `'measured'`).
   */
  readonly durationBasis: DurationModelBasis;
  /** The concept the caller asked the session to start from, if any (the gap view's `build-session` affordance). Echoed so the surface can say what it did. */
  readonly focusConcept: string | null;
}

export interface BuildStudySessionInput {
  /**
   * The gap rows to draw from.
   *
   * **Under the default order (`'gapScore'`), `rows` must come from ONE
   * course.** `packages/contracts/src/study-plan.ts`'s `weight` doc is
   * explicit that a per-course score is "never compared across courses", and
   * `rankOracle`/`buildGapView` both honour that by ranking each course
   * separately (`GapViewModel.courses`) — `allGapRows(model)` exists for
   * *display* (the coverage screen's flat list) and concatenates course by
   * course, it does **not** produce a cross-course score order. Handing that
   * straight to this function with the default order used to silently re-sort
   * it by `gapScore` across the course boundary — the exact defect XCRS-1
   * (`ol-dq1c`) names. {@link buildStudySession} now throws instead (see
   * {@link assertSingleCourseUnderDefaultOrder}) rather than doing that
   * comparison. A caller with rows from several courses needs
   * `composeSessionRows`/`buildComposedStudySession` (`./compose.ts`,
   * SESS-2), which allocates across courses first and calls this function
   * with `order: 'given'`.
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
  /**
   * Whether {@link rows} should be re-sorted by gapScore (the default,
   * `'gapScore'`) or trusted as already in the order the fill should walk
   * them (`'given'`).
   *
   * `'given'` exists for `buildComposedStudySession` (`./compose.ts`,
   * SESS-2/`ol-4a78`), which hands over an order that already encodes
   * obligation class, cross-course allocation and F2.18's course-block
   * presentation — re-deriving gapScore order here would discard all three.
   * Every other caller keeps the default; `focusConceptName`'s front-lift
   * still applies either way.
   */
  readonly order?: 'gapScore' | 'given';
  /**
   * Explain-backs she already accepted and produced during this session
   * (F2.14a, `[D-126]`) — a given fact, never a candidate the fill selects.
   * Omitted or empty means none happened; see the module doc's "Accepted
   * explain-back" section and `./explain-back.js`.
   */
  readonly acceptedExplainBacks?: readonly AcceptedExplainBack[];
  /**
   * Row 3.9's chooser input ([SUPP-2], `ol-95vv.4`) — see
   * {@link SupportLevelHistoryLookup}. Omitted entirely means no support
   * level is computed for any item: every {@link StudySessionItem} carries
   * `supportLevel: undefined`, exactly today's (pre-`ol-95vv.4`) behaviour,
   * so every existing caller and fixture needs no change.
   */
  readonly supportHistory?: SupportLevelHistoryLookup;
  /**
   * The session's one pre-session self-assessment (row 3.9's transient,
   * per-session input, F2.20). `ol-7883` left "per item or per session"
   * undecided for the LEVEL; the self-assessment INPUT itself is
   * unambiguously singular ("her pre-session self-assessment"), so the same
   * feeling is applied to every item this fill scores. Ignored entirely when
   * {@link supportHistory} is not supplied — there is nothing for it to
   * adjust.
   */
  readonly supportSelfAssessment?: SelfAssessmentFeeling;
  /**
   * SESS-2 (`./compose.ts`, F6.7, `ol-y237`): each concept's own
   * {@link ObligationClass}, keyed by `conceptKey` — `buildComposedStudySession`
   * always supplies its own `composeSessionRows` output here (overriding
   * anything a caller passed, since it is derived rather than a caller
   * input; see `BuildComposedStudySessionInput`'s `Omit`). **Omitted entirely
   * means no item carries `obligationClass` at all** — exactly today's
   * (pre-`ol-y237`) behaviour for every plain `buildStudySession` caller,
   * none of which classifies obligations. A `conceptKey` absent from the map
   * behaves the same as an absent map for that one item.
   */
  readonly obligationClasses?: ReadonlyMap<string, ObligationClass>;
}

const SECONDS_PER_MINUTE = 60;

/**
 * How much more of the session's budget a `'coarse'` concept's slot costs
 * against a `'fine'` one's, at the same instrument type (F2.17, `[D-066]`;
 * `ol-urvq` [SIZE-2]).
 *
 * **Declared, not derived** (the component register's declared/derived
 * rule — `docs/Olea_component_register.md`, and `concept/size.ts`'s own
 * `COARSE_EXTENT_FLOOR` sets the precedent for this module). Plain-English
 * defence: `concept/size.ts` already establishes that a `'coarse'` concept is
 * grounded across more of her material than a `'fine'` one — by construction,
 * more than `COARSE_EXTENT_FLOOR` separately-authored notes or passages. A
 * single card cannot honestly stand for that much material at the same cost
 * as a card that stands for one or two places; pricing it at one and a half
 * times prices the slot without inventing a second instrument type or a
 * per-concept minimum count (the module doc's two rejected alternatives).
 * Never fitted against the vault or a corpus — `size.spec.ts`'s own
 * discipline, carried here.
 *
 * A concept with no size reading at all (`GapRow.conceptSize` absent) prices
 * as `'fine'` — the same err-fine asymmetry `concept/size.ts` defends: merging
 * two concepts later is cheap, so understating breadth costs nothing that
 * cannot be corrected, and overstating it would silently shrink a session for
 * no material reason.
 */
export const CONCEPT_SIZE_SECONDS_MULTIPLIER: Readonly<Record<ConceptSizeBand, number>> =
  Object.freeze({
    fine: 1,
    coarse: 1.5,
  });

/** Whole calendar days from `asOf` to `due`, or `null` when either is unreadable. See {@link SessionAssessmentCountdown.daysUntil}. */
function daysUntilDue(asOf: CalendarDay, due: string | undefined): number | null {
  if (due === undefined || !isCalendarDay(due) || !isCalendarDay(asOf)) return null;
  return daysBetween(new Date(`${asOf}T00:00:00.000Z`), new Date(`${due}T00:00:00.000Z`));
}

/**
 * `rows` under the default (`'gapScore'`) order, by distinct `course` —
 * XCRS-1 (`ol-dq1c`)'s check. **Never called for `order: 'given'`**: a
 * caller using `'given'` (`composeSessionRows`/`buildComposedStudySession`)
 * has already allocated across courses without comparing `gapScore` or
 * `overdueDays` across the boundary, which is exactly what this guard exists
 * to force for everyone else.
 */
function assertSingleCourseUnderDefaultOrder(rows: readonly GapRow[]): void {
  const courses = new Set(rows.map((row) => row.course));
  if (courses.size <= 1) return;
  throw new Error(
    `buildStudySession: rows span ${courses.size} courses (${[...courses].sort().join(', ')}) under the default 'gapScore' order. ` +
      "gapScore is never compared across courses (packages/contracts/src/study-plan.ts's `weight` doc; XCRS-1 / ol-dq1c) — " +
      'sort within one course before calling this, or use composeSessionRows/buildComposedStudySession (./compose.ts) ' +
      "to allocate across courses first and pass its result here with order: 'given'.",
  );
}

/**
 * Rows in the order the fill will walk them: gapScore descending, then the
 * gap view's own tiebreak (rank, then concept name) — valid only within one
 * course, which {@link assertSingleCourseUnderDefaultOrder} enforces before
 * this ever runs — or, when `order` is `'given'`, the caller's own order
 * untouched (see {@link BuildStudySessionInput.order}). `focusConceptName`,
 * when it names a row, is lifted to the front afterwards either way.
 */
function fillOrder(
  rows: readonly GapRow[],
  focusConceptName: string | undefined,
  order: 'gapScore' | 'given',
): readonly GapRow[] {
  const sorted =
    order === 'given'
      ? [...rows]
      : [...rows].sort((a, b) => {
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
 * positive finite number of minutes, on an `asOf` that is not a calendar
 * day, and — under the default order — on `rows` spanning more than one
 * course (XCRS-1, `ol-dq1c`; see {@link assertSingleCourseUnderDefaultOrder})
 * — all three are caller errors that would otherwise produce a confidently
 * wrong session, which is the failure mode this whole surface is built to
 * avoid. Everything else that can go missing (no rows, no instruments, no
 * assessments, no history) is an ordinary state with an honest answer.
 */
export function buildStudySession(input: BuildStudySessionInput): StudySessionModel {
  const { rows, instruments, budgetMinutes, durations, asOf } = input;
  const order = input.order ?? 'gapScore';

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
  if (order === 'gapScore') {
    assertSingleCourseUnderDefaultOrder(rows);
  }

  const ordered = fillOrder(rows, input.focusConceptName, order);
  const nextAssessment = nextAssessmentOf(ordered, input.assessments, asOf);
  const formatPreference: AssessmentFormat = nextAssessment?.format ?? 'unknown';
  const budgetSeconds = budgetMinutes * SECONDS_PER_MINUTE;

  // F2.14a (`[D-126]`): priced here, never selected — see the module doc's
  // "Accepted explain-back" section and `./explain-back.js`. Their total
  // comes out of the declared target before the candidate fill below runs,
  // so the fill sees however much of the budget genuinely remains.
  const explainBackItems = priceAcceptedExplainBacks(input.acceptedExplainBacks ?? [], durations);
  const explainBackSeconds = totalExplainBackSeconds(explainBackItems);
  const candidateBudgetSeconds = Math.max(0, budgetSeconds - explainBackSeconds);

  // Per row: its instruments in fill order, and how far the fill has walked
  // that list. Built once so the passes below are a walk rather than a
  // repeated lookup.
  const queues = ordered.map((row) => ({
    row,
    // `row.conceptKey`, not `row.conceptName` (`ol-63e1`) — `instruments`
    // indexes `VaultInstrumentRecord.conceptIds`, which `session/enumerate.ts`
    // now mints as the opaque key; a display-name lookup here would silently
    // find nothing for every row.
    records: orderedForFormat(instruments.instrumentsFor(row.conceptKey), formatPreference),
    at: 0,
    chose: false,
    /** Set when a row still had instruments left that the remaining budget could not take. */
    blockedByBudget: false,
  }));

  const chosenInstrumentIds = new Set<string>();
  const items: StudySessionItem[] = [];
  let candidatePlannedSeconds = 0;

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
        // `[D-091]` (component register §3.7): the budget is a declared
        // target, never a cap, and she is "always free to outrun" it. Once
        // the running total has REACHED the target nothing further is taken;
        // until then, the next instrument is taken regardless of its own
        // length, so the fill rounds up to the item that crosses the line
        // rather than refusing it (`ol-zji3` [BUD-1]). Measured against
        // `candidateBudgetSeconds`, not `budgetSeconds` — F2.14a already
        // spent `explainBackSeconds` of the declared target before this loop
        // started.
        if (candidatePlannedSeconds >= candidateBudgetSeconds) {
          // Do NOT advance `at`: this instrument is still a candidate if a
          // later pass has room, and skipping past it would drop it silently.
          sawUnaffordable = true;
          break;
        }
        const sizeBand = queue.row.conceptSize?.band ?? 'fine';
        const seconds = Math.round(
          durations.secondsFor(record.instrumentType) * CONCEPT_SIZE_SECONDS_MULTIPLIER[sizeBand],
        );
        queue.at += 1;
        chosenInstrumentIds.add(record.instrumentId);
        candidatePlannedSeconds += seconds;
        // Row 3.9's chooser ([SUPP-2]): computed only when a caller supplied
        // history to compute it from, and only for a tier the ladder scores
        // at all — see `supportLadderTierFor` and `SupportLevelHistoryLookup`.
        const supportTier = supportLadderTierFor(record.instrumentType);
        const supportLevel: SupportLevelPresentation | undefined =
          supportTier === null || input.supportHistory === undefined
            ? undefined
            : chooseSupportLevel(
                input.supportHistory.outcomesFor(queue.row.conceptKey, supportTier),
                input.supportSelfAssessment ?? null,
              );
        // SESS-2 (F6.7, `ol-y237`): threaded through verbatim, never
        // re-derived — see `StudySessionItem.obligationClass`'s doc.
        const obligationClass = input.obligationClasses?.get(queue.row.conceptKey);
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
          ...(supportLevel !== undefined ? { supportLevel } : {}),
          ...(obligationClass !== undefined ? { obligationClass } : {}),
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
    plannedSeconds: candidatePlannedSeconds + explainBackSeconds,
    items,
    explainBackItems,
    leftOut,
    leftOutInstrumentCount,
    consideredRowCount: ordered.length,
    formatPreference,
    nextAssessment,
    durationBasis: combinedDurationBasis(durations.basis, durations, explainBackItems),
    focusConcept: input.focusConceptName ?? null,
  };
}

/**
 * Folds the accepted explain-back's own source into the candidate basis
 * (see {@link StudySessionModel.durationBasis}'s doc). Returns
 * `candidateBasis` untouched when no explain-back was accepted this session
 * — its estimate source is not a fact about "the times above" when nothing
 * priced by it appears there.
 */
function combinedDurationBasis(
  candidateBasis: DurationModelBasis,
  durations: DurationModel,
  explainBackItems: readonly ComposedExplainBackItem[],
): DurationModelBasis {
  if (explainBackItems.length === 0) return candidateBasis;
  const explainBackSource = durations.sourceFor('explain-back');
  if (candidateBasis === 'mixed') return 'mixed';
  return candidateBasis === explainBackSource ? candidateBasis : 'mixed';
}
