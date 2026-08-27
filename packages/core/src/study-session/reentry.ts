/**
 * Compose a re-entry session (component register 3.8; F6.6; `[D-113]` item
 * 5; `BKLG-1`).
 *
 * ## What is genuinely new here, and what deliberately is not
 *
 * `[D-113]` item 5 already ratifies "re-entry needs no special case": F6.6's
 * rule — the ordinary selection rule, run at fewer slots, never a second
 * selection mechanism — holds by construction, because `composeSessionRows`
 * (`./compose.js`) has no absence-aware branch to diverge from
 * `buildComposedStudySession` in the first place. `compose.spec.ts` already
 * carries the test that proves this for one hand-built case (module doc,
 * "Re-entry needs no special case"). **That layer is not this module's job
 * and this module does not re-implement or wrap it with new selection
 * logic** — it calls `buildComposedStudySession` verbatim, with a different
 * `budgetMinutes` and nothing else different.
 *
 * What component 3.8 actually adds, per the register row, is the one new
 * fact the rest of the system has no notion of at all — **days since her
 * last review** — plus exactly two constants the row names: an absence
 * threshold (is this a re-entry at all?) and a size floor (how small may the
 * resulting budget go?). "Deliberately none for selection" — neither
 * constant touches `composeSessionRows`/`buildComposedStudySession`; both
 * only decide which `budgetMinutes` number gets passed to the SAME call an
 * ordinary session makes.
 *
 * ## Where the "how much smaller" number comes from
 *
 * SESS-1's modelling (`findings/SESS-1-session-composition-model.md` §3.3,
 * olea-service) swept the re-entry budget from 0.25x to 1.0x of an ordinary
 * budget and found the widest plateau in the whole document: baseline share
 * and recall probability barely move across the entire tested range, so
 * "the re-entry budget is a product judgement about how a return should
 * feel, not a load-bearing constant, and can be chosen on feel." This module
 * therefore does not invent a shrink ratio — inventing one would be exactly
 * the "guess wearing a declared label" the register's row 3.1 amendment
 * warns against, for a number the modelling explicitly says is not
 * load-bearing. The caller (a future product/UI layer — no caller exists
 * yet, see the module's reachability note below) picks the candidate
 * smaller budget; this module's only numeric contribution is refusing to
 * let that candidate collapse below a session that could not admit even one
 * instrument.
 *
 * ## No count of what accumulated (F6.6)
 *
 * F6.6 bans any count of what piled up during the absence, "not as a
 * headline, not as a subordinate figure, not as a badge." The joins-list
 * ("The joins that do not join", entry 5, component register) names the
 * defect this creates structurally: `StudySessionModel` carries
 * `leftOutInstrumentCount` and `consideredRowCount`, both of which are
 * exactly the forbidden count when the session in view is a re-entry one.
 * Rather than leaving a caller to remember which fields not to render (one
 * model serving both paths, per the joins-list entry's own framing), this
 * module gives the re-entry path a narrower type,
 * {@link ReentryStudySessionView}, that omits them structurally — see
 * {@link composeReentrySession}'s `view` field. The full,
 * unstripped composition is still returned (`full`) for the health check
 * and any accounting that is not a rendering surface.
 *
 * ## Reachability (`[D-072]`, clause 5 of the plan's §2.7 Definition of
 * Done)
 *
 * **No production caller exists yet.** The one place an ordinary session is
 * composed today is `packages/plugin/src/session-builder/provider.ts:215`,
 * which calls `buildComposedStudySession` directly with
 * `request.budgetMinutes` and has no notion of "days since her last
 * review" to decide whether to call this module instead. Wiring that in —
 * computing the absence fact from the review log's own timestamps, and
 * choosing the candidate re-entry budget on the caller's own judgement, per
 * the plateau above — is future work for whichever bead builds the F6.6
 * surface; this module is the engine seam for it, deliberately with no
 * student-visible affordance of its own.
 */

import type { StudySessionModel } from './build.js';
import type { BuildComposedStudySessionInput, ComposedStudySession } from './compose.js';
import { buildComposedStudySession } from './compose.js';

/**
 * DECLARED (never fitted). SESS-1's modelling tested absence lengths of 7,
 * 14 and 21 days and found the ordinary selection rule survivable at every
 * one of them (returning-session baseline share 25-35% against an ordinary
 * 19%, and *harder* than usual, never easier — never a pile). Seven days is
 * the shortest of those tested lengths, and it is also the plain-English
 * reading of "time away" F6.6 itself uses: the ordinary gap between two
 * sessions in the same week is scheduling noise, not an absence, and
 * treating it as one would trigger the small, low-guilt treatment on
 * students who are studying normally. Below this many days since her last
 * review, `daysSinceLastReview` reads as ordinary, not as re-entry.
 */
export const REENTRY_ABSENCE_THRESHOLD_DAYS = 7;

/**
 * DECLARED (never fitted). The floor below which a candidate re-entry
 * budget is not allowed to shrink further. Five minutes is the shortest
 * budget this codebase already composes and tests against without
 * degenerating (`study-session/compose.spec.ts`'s own equality-of-rule case
 * uses `budgetMinutes: 5`) — enough, at the cold-start per-instrument
 * estimates `duration.ts` declares (30-45s), to admit at least a handful of
 * instruments rather than a session that cannot seat even one. It is a
 * floor, not a target: SESS-1's plateau finding means the caller's own
 * candidate is otherwise left alone.
 */
export const REENTRY_SIZE_FLOOR_MINUTES = 5;

/**
 * Whether `daysSinceLastReview` is far enough gone to treat the next
 * session as a re-entry rather than an ordinary one (component register
 * 3.8). Throws on a negative or non-finite input — "days since her last
 * review" has no meaning otherwise, and a caller passing one has a bug
 * upstream this function should not paper over.
 */
export function isReentryDue(daysSinceLastReview: number): boolean {
  if (!Number.isFinite(daysSinceLastReview) || daysSinceLastReview < 0) {
    throw new Error(
      `isReentryDue: daysSinceLastReview must be a finite number >= 0, got ${daysSinceLastReview}`,
    );
  }
  return daysSinceLastReview >= REENTRY_ABSENCE_THRESHOLD_DAYS;
}

/**
 * Clamps a candidate re-entry budget to {@link REENTRY_SIZE_FLOOR_MINUTES}.
 * Never widens a candidate that is already at or above the floor — this is
 * a floor, not a target (see the constant's own doc).
 */
export function clampReentryBudgetMinutes(candidateBudgetMinutes: number): number {
  if (!Number.isFinite(candidateBudgetMinutes) || candidateBudgetMinutes <= 0) {
    throw new Error(
      `clampReentryBudgetMinutes: candidateBudgetMinutes must be a finite number > 0, got ${candidateBudgetMinutes}`,
    );
  }
  return Math.max(candidateBudgetMinutes, REENTRY_SIZE_FLOOR_MINUTES);
}

/**
 * What a re-entry rendering surface may show (F6.6). Identical to
 * {@link StudySessionModel} minus the two fields that carry a count of what
 * did not make the cut — `leftOutInstrumentCount` and `consideredRowCount`
 * — because on a re-entry screen specifically, either one IS the
 * backlog-shock count F6.6 forbids "in any position." An ordinary session's
 * own surface is unaffected: this type exists only for the re-entry path.
 * Resolves the component register's joins-list entry 5.
 */
export type ReentryStudySessionView = Omit<
  StudySessionModel,
  'leftOutInstrumentCount' | 'consideredRowCount'
>;

function toReentryView(model: StudySessionModel): ReentryStudySessionView {
  const {
    leftOutInstrumentCount: _leftOutInstrumentCount,
    consideredRowCount: _consideredRowCount,
    ...view
  } = model;
  return view;
}

export interface ComposeReentrySessionInput
  extends Omit<BuildComposedStudySessionInput, 'budgetMinutes'> {
  /**
   * The one new fact 3.8 introduces (component register 3.8): "no such
   * notion exists anywhere; the only lateness in the system is per-card."
   * A plain day count, not a `CalendarDay` pair, so this module stays a
   * pure function of a number a caller has already derived (e.g. via
   * `../dates.js`'s `daysBetween` over the review log's own latest
   * timestamp and `asOf`) rather than this module reading the log itself.
   */
  readonly daysSinceLastReview: number;
  /**
   * What the caller wants to offer if this turns out to be a re-entry —
   * SESS-1's "chosen on feel" number (see module doc). Clamped to
   * {@link REENTRY_SIZE_FLOOR_MINUTES}, never widened.
   */
  readonly candidateBudgetMinutes: number;
  /** Used verbatim, unmodified, when `daysSinceLastReview` does not clear the absence threshold — the ordinary path, the ordinary budget. */
  readonly ordinaryBudgetMinutes: number;
}

export interface ComposedReentrySession {
  readonly isReentry: boolean;
  /**
   * The unstripped composition — same shape `buildComposedStudySession`
   * always returns. For the equality-of-rule health check
   * (`../checks/reentry-equality.js`) and any accounting that is not itself
   * a rendering surface. **A renderer must use `view`, never this field.**
   */
  readonly full: ComposedStudySession;
  /** What a re-entry rendering surface may show — see {@link ReentryStudySessionView}. Always present, even when `isReentry` is `false`, so a caller does not have to branch on the flag to get a displayable model. */
  readonly view: ReentryStudySessionView;
}

/**
 * The whole component: decide whether this is a re-entry, pick the budget
 * that decision implies, and hand it to the SAME `buildComposedStudySession`
 * an ordinary session calls — see the module doc for why this module
 * contains no second selection mechanism of its own.
 */
export function composeReentrySession(input: ComposeReentrySessionInput): ComposedReentrySession {
  const { daysSinceLastReview, candidateBudgetMinutes, ordinaryBudgetMinutes, ...rest } = input;

  const isReentry = isReentryDue(daysSinceLastReview);
  const budgetMinutes = isReentry
    ? clampReentryBudgetMinutes(candidateBudgetMinutes)
    : ordinaryBudgetMinutes;

  const full = buildComposedStudySession({ ...rest, budgetMinutes });

  return { isReentry, full, view: toReentryView(full.model) };
}
