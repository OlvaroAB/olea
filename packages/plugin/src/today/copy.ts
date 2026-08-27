/**
 * Every user-facing string the Today panel can render (F6.1, P2-T09).
 *
 * Kept in one module, away from the DOM, for the reason `docs`'s §8.2 record
 * keeps proving: **a design mock is not a spec, and its body copy is where
 * inventions hide.** The Pass 1 kit (`docs/design/pass1/ui_kits/olea-plugin/
 * TodayPane.jsx`) is the design intent for this surface and is followed
 * closely in *shape*; three of its body-copy decisions are not followed at
 * all, and the reasons are recorded here beside the strings that replaced
 * them, so a later copy edit has to argue with the reason rather than just not
 * see it.
 *
 * ## Three kit decisions this panel does not take
 *
 * 1. **The kit's subhead names a weekday by which nothing further falls due;
 *    no such line ships.** It is a forward-looking scheduling claim, and there
 *    is no F-number behind one. F6.1 is a *due-today* summary plus per-course
 *    counts plus a streak; F6.3 is the next-*exam* countdown, not the next
 *    review. Worse, a claim of that shape cannot be kept true: every rating
 *    she gives moves FSRS due dates, and a card created tomorrow is due
 *    tomorrow, so any named day is falsified by ordinary use of the product.
 *    This is the same class the run-4 §8.2 record already rejected on
 *    `ol-2x4`, where a completion screen announced when items would next be
 *    shown — a decision belonging to the scheduler, not to a screen. Filed
 *    rather than built; see the P2-T09 report.
 *
 * 2. **That subhead is also a completeness claim**, ranging over her whole
 *    deck rather than over what the panel actually read. `ol-1n1v`'s ruling
 *    applies unchanged: a claim whose truth depends on having successfully
 *    read everything is a bet, not a claim. Nothing here makes one.
 *
 * 3. **The kit's course rows carry a course code and title lifted from the
 *    reference vault** (flagged on `ol-p2t08`); neither is copied here. No
 *    course string is hardcoded anywhere in this module; every code and name
 *    on screen comes from the vault at runtime.
 *
 * ## Three kit decisions this panel does take
 *
 * - **The streak strip marks a missed day exactly as it marks a day that has
 *   not arrived yet** — one neutral state covering both, with no mark that
 *   means *you missed this*. That is F6.1's non-punitive clause, and core
 *   enforces it rather than trusting the renderer (`today/streak.ts`:
 *   `StreakDay` carries no `missed` flag for a view to read).
 * - **The kit's second state — the pane after a run of missed days — differs
 *   from the first only in the streak number.** Nothing else on the surface
 *   reacts. That is also P2-T09's acceptance criterion.
 * - One primary action, and it starts the review.
 *
 * ## The rule these strings are tested against
 *
 * `test/today/copy.spec.ts` asserts over `allTodayStrings()`: no future
 * scheduling, no completeness claim, no streak-loss language, no instruction
 * to keep anything up. Adding a string without adding it to that function is
 * the one way past the test, which is why `view.ts` renders nothing it did not
 * get from here.
 *
 * ## `showsStartReviewAction` — not a string, but the same kind of decision
 *
 * `ol-h3wy`: the "Start review" button used to render only when the due total
 * was above zero, which made the panel's one entry point disappear exactly
 * when nothing was due. Now that David's ruling (`ol-f77commands`) makes this
 * panel Olea's front door — "the review view is reached through it, not
 * around it" — a front door with no door at zero is the worse defect. The
 * decision of *when the action shows* is kept here, beside the strings,
 * rather than left as an inline condition in `view.ts`'s DOM code, for the
 * same reason every other decision on this panel is: it is what a test can
 * hold onto.
 */

import type { MasteryState } from 'olea-contracts';
import { type CourseEffort, MASTERY_DISPLAY, MASTERY_ORDER } from 'olea-core';

/** The pane's title, as Obsidian shows it on the tab and in the sidebar. F6's own words: "Today". */
export const TODAY_VIEW_TITLE = 'Today';

/** Sits beside the sprig mark in the pane header. */
export const TODAY_HEADER_LABEL = 'Olea';

/** The label beside the due count. Reads correctly at any number, including one. */
export const DUE_TODAY_LABEL = 'due today';

/** Shown in place of the count when the count is a real, computed zero. */
export const NOTHING_DUE = 'Nothing due today.';

/**
 * Shown when the due set could not be enumerated at all — which is not the
 * same statement as zero, and must not be rendered as one (`today/panel.ts`).
 *
 * **It used to say the review queue wasn't built, and that stopped being true.**
 * When this string was written the queue genuinely did not exist and
 * `commands/placeholders.ts`'s "honest that a piece is missing" was the right
 * precedent. The queue exists now, so the only way to reach this line is a walk
 * or a log read that failed — and telling her a shipped feature is unbuilt
 * sends her to look for a setup step that isn't there. `review/copy.ts`'s
 * `REVIEW_UNAVAILABLE_*` names itself this string's sibling and states the rule
 * outright: *it does not say a feature is missing — it is not missing, the read
 * failed.* This is now the same statement in the same voice, which is what that
 * doc always claimed it was.
 */
export const DUE_UNAVAILABLE =
  "Olea can't count what's due — it couldn't read your vault just now.";

/** The one primary action. */
export const START_REVIEW = 'Start review';

/**
 * Whether the panel's one action renders, given the due state.
 *
 * True whenever the due count is a real, known number — zero included
 * (`ol-h3wy`). Pressing "Start review" with nothing due reaches review's own
 * honest empty screen (`session.ts`'s `empty` phase, "You're caught up.") —
 * this does not put a new claim on screen, it just stops taking the one
 * button away.
 *
 * Deliberately **not** extended to `due === null` ("cannot count what's
 * due"). That is a different, harder claim than "zero due", and whether
 * offering a session against a vault Today itself could not read is honest
 * is a separate question this bead did not decide — so the button stays
 * absent there, unchanged from before.
 */
export function showsStartReviewAction(due: { readonly total: number } | null): boolean {
  return due !== null;
}

/** The streak section's eyebrow. */
export const STREAK_LABEL = 'Streak';

/** Weekday initials for the trailing strip, indexed by `Date.getUTCDay()` (0 = Sunday). */
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** `{n} due today`'s number half is rendered separately; this is the whole line for a screen reader. */
export function dueTodaySentence(total: number): string {
  return `${total} ${DUE_TODAY_LABEL}`;
}

/**
 * How many of the due count she has never seen before, or `null` when none of
 * them are.
 *
 * **"of them", not a second number beside the first.** `DueSummary.newCount` is
 * a subset of `total` and the phrasing has to say so, or the panel reads as
 * "40 due *and* 12 new" — fifty-two items, which is not what is waiting. This
 * is the only sentence on the panel that relates two of its numbers, so it is
 * the only place that arithmetic can be misread.
 *
 * `null` at zero rather than "0 new": a line that appears every day saying
 * nothing is new is noise, and F6.1's panel is four things and no more. The
 * phrasing states a count and stops — no "to get through", no "backlog", no
 * "still", nothing that turns a count into a target (the rule
 * `test/today/copy.spec.ts` enforces over every string this module can
 * produce).
 */
export function newCountSentence(newCount: number): string | null {
  if (newCount <= 0) return null;
  return newCount === 1 ? '1 of them is new' : `${newCount} of them are new`;
}

/** `12` for a course row. Separate function so the row markup holds no formatting logic. */
export function courseCountLabel(count: number): string {
  return String(count);
}

/**
 * `9 days` · `1 day` · `0 days` · `90+ days`.
 *
 * The `+` form is the honest rendering of `StreakSummary.atWindowEdge`: the
 * run reached the oldest day the panel actually read, so the exact number is
 * not known and is not claimed. Zero renders as `0 days` — a count, flat and
 * without comment, because F6.1 makes the streak a tally and forbids it from
 * pushing her, and the alternatives ("no streak yet", "start one today") are
 * both instructions.
 */
export function streakValue(days: number, atWindowEdge: boolean): string {
  const noun = days === 1 && !atWindowEdge ? 'day' : 'days';
  return `${days}${atWindowEdge ? '+' : ''} ${noun}`;
}

/** The single letter under a cell of the week strip. */
export function weekdayInitial(day: string): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed)) return '';
  return WEEKDAY_INITIALS[new Date(parsed).getUTCDay()] ?? '';
}

/**
 * The accessible name of one cell. States the fact and stops: a day with no
 * reviews says so without saying whether that is because she missed it or
 * because it has not happened yet, exactly as the mark itself does.
 */
export function weekCellLabel(day: string, studied: boolean): string {
  return studied ? `${day} — reviewed` : day;
}

/* ------------------------------------------------------------------------ *
 * The trends half: F6.2's mastery overview and F6.5's insights.
 *
 * `ol-p6t04`'s acceptance criteria put the phrasing of these in front of David
 * before ship. That is only a reviewable requirement if the sentences can be
 * *listed*, which is why every one of them is here — reachable from
 * `allTodayStrings()` — and why nothing in `olea-core`'s detectors assembles a
 * sentence. A detector returns numbers; this module decides what they are
 * allowed to say.
 *
 * ## Principle 12, applied to each of them
 *
 * - **The mastery strip states counts and stops.** It says how many concepts
 *   sit in each of F2.11's five named states and never sums, averages, ranks
 *   or grades them. `MASTERY_DISPLAY.meaning` is deliberately NOT rendered
 *   here: those lines describe the state to somebody meeting the vocabulary,
 *   and repeating them beside every course would turn a compact strip into a
 *   commentary on it.
 * - **The spacing lines are two numbers and one definitional consequence.**
 *   "41.8 a day before an assessment, 2.9 otherwise" is information; "pulled
 *   forward before their due date, a shorter gap than the schedule had set" is
 *   the consequence *of what the log says happened*, not an inference about
 *   what it did to her memory. The tempting version — "the spaced material
 *   held up better" — is a retention claim, and nothing in a review log
 *   measures a retest. It is not made.
 * - **The effort line puts two shares side by side and stops there.** The
 *   consequence is the juxtaposition. A stronger clause was drafted and cut:
 *   any explicit form of it ("more of your grade rests on what you have
 *   practised least") is either a verdict about her or an unmeasured claim
 *   about her results. **Flagged for David's review** — if he wants an explicit
 *   consequence clause, this is the sentence it attaches to.
 * - **Nothing here fires in the negative direction.** There is no sentence for
 *   "you are over-studying X", because `detectEffortImbalance` cannot report
 *   one; see its module doc.
 * - **The effort line's truth depends on where its course sits in its term
 *   (`ol-7j54` / ARC-1), so it is never emitted unscoped.** "Carries 57% of the
 *   grade and 14% of the time" reads as ordinary early in a course and as a
 *   real problem late in one — same sentence, opposite reading — and two of
 *   her courses can be in different phases of the term at once. No phase is
 *   computed here; the course is named instead, so she can judge it against a
 *   term she already knows. `effortInsightLine` below is the enforced shape:
 *   it cannot be built without the `CourseEffort` the sentence is about.
 * ------------------------------------------------------------------------ */

/** The mastery overview's eyebrow (F6.2). Sits where `STREAK_LABEL` sits. */
export const MASTERY_LABEL = 'Mastery';

/**
 * One segment of a course's distribution strip: `3 sapling`.
 *
 * The word comes from `MASTERY_DISPLAY` and could not have come from anywhere
 * else — F2.11's single-vocabulary rule is enforced by there being exactly one
 * module holding these four words, and this function is a reader of it, never
 * a second copy.
 */
export function masteryCountLabel(state: MasteryState, count: number): string {
  return `${count} ${MASTERY_DISPLAY[state].label}`;
}

/** `8 concepts` · `1 concept`. A count, flat, with nothing said about it. */
export function conceptCountLabel(count: number): string {
  return count === 1 ? '1 concept' : `${count} concepts`;
}

/**
 * The insights section's eyebrow (F6.5).
 *
 * "What the log shows" rather than "Insights" or "Your patterns": the subject
 * of the heading is the record, not her. That is the whole of principle 12 in
 * four words, and it is the reason this heading is a string rather than a
 * label somebody types into the view.
 */
export const INSIGHTS_LABEL = 'What the log shows';

/**
 * The rhythm section's eyebrow (F6.9). A separate section from
 * `INSIGHTS_LABEL`'s, deliberately: this reading's evidence is a per-course
 * material-arrival timestamp, not a window of review-log entries, so it
 * carries no `insightsScopeSentence` footer and must not be folded under a
 * label that promises one.
 */
export const RHYTHM_LABEL = 'What has arrived';

/**
 * Shown when every detector declined for want of history — the degenerate
 * case, and the one a confident empty chart would lie about.
 *
 * Note what it does not say: not "no patterns found" (a negative result the
 * detectors did not produce) and not "keep going and check back" (an
 * instruction). It states which of the three answers was given and stops.
 */
export const INSIGHTS_TOO_EARLY = 'Not enough history yet to show a pattern here.';

/** One decimal, and no trailing `.0` — a rate, not a measurement claim. */
function rate(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * F6.5(a), the information half: her rate of work near an assessment against
 * her rate the rest of the time.
 *
 * Both numbers, always, in one sentence. A single figure ("41.8 a day before
 * an assessment") is the same number carrying an implied comparison the reader
 * has to guess at, and the guess is what turns information into a verdict.
 */
export function spacingRateSentence(
  nearPerDay: number,
  farPerDay: number,
  windowDays: number,
): string {
  return `${rate(nearPerDay)} reviews a day in the ${windowDays} days before an assessment, and ${rate(farPerDay)} a day otherwise.`;
}

/**
 * F6.5(a), the consequence half — or `null` when nothing was pulled forward,
 * because a line saying "0% were pulled forward" is noise on a panel F6.1
 * keeps deliberately short.
 *
 * "A shorter gap than the schedule had set" is true by the definition of
 * `dueState: 'early'` and asserts nothing beyond it. See this section's header
 * for the retention claim that is available, obvious, and not made.
 */
export function earlyPullSentence(earlyShare: number): string | null {
  if (earlyShare <= 0) return null;
  return `${percent(earlyShare)} of reviews were pulled forward before their due date — a shorter gap than the schedule had set.`;
}

/**
 * F6.5(b). **The course code is not in this string**, exactly as it is not in
 * `courseCountLabel`: every course string on this panel comes from her vault at
 * runtime, and a copy module that could name a course is a copy module that
 * can leak one (`ol-p2t08`, and `copy.spec.ts`'s INV-3 check over every string
 * this file can produce). The view renders the code beside this clause.
 *
 * That naming is not decorative — `ol-7j54` (ARC-1) makes it a requirement,
 * because this clause's truth depends on where its course sits in its term.
 * `effortInsightLine` below is the enforced form of the pairing; call this
 * function directly only where the caller already, separately, guarantees the
 * course is rendered alongside it.
 */
export function effortShareClause(weightShare: number, timeShare: number): string {
  return `carries ${percent(weightShare)} of the assessment weight and ${percent(timeShare)} of the time logged.`;
}

/** `effortInsightLine`'s return shape: the course a claim is about, paired with the claim. */
export interface EffortInsightLine {
  readonly course: string;
  readonly text: string;
}

/**
 * F6.5(b), bundled with the course it is true of (`ol-7j54` / ARC-1).
 *
 * `effortShareClause`'s text deliberately carries no course string — every
 * course string on this panel comes from the vault at runtime, never from this
 * module (INV-3, `ol-p2t08`). But the claim's *truth* still depends on where
 * that course sits in its term, and the three phases are per-course, not
 * per-student: the same sentence is unremarkable in a course that just started
 * and a real problem in one nearing its end, at the very same moment as a
 * different course on the same panel. Presenting it without the course would
 * be exactly the unscoped statement `ol-7j54`'s ruling rejects — true of one
 * running course, misleading about another.
 *
 * So this is the one way this module offers to reach the sentence: it takes
 * the whole `CourseEffort` the claim was measured from, not bare shares, which
 * makes it structurally impossible to call without the course attached — no
 * argument-order mistake can separate the two, because there is only one
 * argument to give.
 */
export function effortInsightLine(course: CourseEffort): EffortInsightLine {
  return { course: course.course, text: effortShareClause(course.weightShare, course.timeShare) };
}

/**
 * What the trends half actually read, stated rather than implied.
 *
 * `ol-1n1v`'s rule: a claim whose truth depends on having read everything is a
 * bet. The panel reads a trailing window of the review log, so it says so, and
 * every number above it is scoped by this line rather than by an assumption.
 */
export function insightsScopeSentence(windowDays: number): string {
  return `Counted over the last ${windowDays} days of review history.`;
}

/**
 * F6.9, the rhythm reading: is material arriving? **About her vault, never
 * about her** — the clause's own words, and the reason every sentence this
 * function can produce is a fact and a day count, nothing else.
 *
 * `rhythmQuietClause`'s text is F6.9's own worked example, almost verbatim:
 * *"nothing from this course has arrived in three weeks."* This states the
 * measured day count rather than converting it to a week count — the panel's
 * other numbers (`streakValue`, `dueTodaySentence`) are all day-granular, and
 * `olea-core`'s `rhythm.ts` explicitly declines to invent a weeks-or-tempo
 * conversion it has no ruling behind (see that module's doc); copy is not the
 * place to invent one either.
 *
 * **Forbidden outright, and F6.9 says this is most of the clause:** no
 * streak, no effort score, no hours total, no completion figure, nothing
 * that reads as compliance. This sentence names a fact about the vault and
 * stops — the same restraint `effortShareClause` and `earlyPullSentence`
 * already hold for F6.5.
 *
 * The course itself is never in this text (INV-3, `ol-p2t08`) — see
 * `rhythmQuietLine` below for the bundled form the view actually reaches for.
 */
export function rhythmQuietClause(quietDays: number): string {
  return `nothing from this course has arrived in ${quietDays} days.`;
}

/** `rhythmQuietLine`'s return shape: the course a quiet finding is about, paired with the claim. */
export interface RhythmQuietLine {
  readonly course: string;
  readonly text: string;
}

/**
 * F6.9, bundled with the course it is true of — same reasoning
 * `effortInsightLine` states for F6.5(b): a claim like "nothing has arrived"
 * is meaningless without saying *from where*, and one course going quiet says
 * nothing about another course on the same panel. This is the one way this
 * module offers to reach the sentence, and reaching it always carries which
 * course it measures — no argument-order mistake can separate the two,
 * because there is only one argument to give.
 */
export function rhythmQuietLine(course: string, quietDays: number): RhythmQuietLine {
  return { course, text: rhythmQuietClause(quietDays) };
}

/**
 * Every string this panel can put on screen, for the copy test. Functions are
 * sampled across the values that change their wording; anything rendered by
 * `view.ts` that is not reachable from here is a bug in `view.ts`.
 */
export function allTodayStrings(): readonly string[] {
  return [
    TODAY_VIEW_TITLE,
    TODAY_HEADER_LABEL,
    DUE_TODAY_LABEL,
    NOTHING_DUE,
    DUE_UNAVAILABLE,
    START_REVIEW,
    STREAK_LABEL,
    dueTodaySentence(0),
    dueTodaySentence(1),
    dueTodaySentence(23),
    // `null` at zero is not a string; the other two are every wording this
    // function has.
    newCountSentence(1) ?? '',
    newCountSentence(12) ?? '',
    courseCountLabel(0),
    courseCountLabel(12),
    streakValue(0, false),
    streakValue(1, false),
    streakValue(9, false),
    streakValue(90, true),
    weekCellLabel('2026-08-10', true),
    weekCellLabel('2026-08-10', false),
    ...WEEKDAY_INITIALS,
    // --- the trends half (F6.2, F6.5) ---
    MASTERY_LABEL,
    INSIGHTS_LABEL,
    INSIGHTS_TOO_EARLY,
    RHYTHM_LABEL,
    // Every one of F2.11's five words, at the two counts whose wording could
    // differ. Sampling the vocabulary rather than one state of it is what makes
    // the panel-wide rules apply to all five.
    ...MASTERY_ORDER.flatMap((state) => [masteryCountLabel(state, 1), masteryCountLabel(state, 7)]),
    conceptCountLabel(0),
    conceptCountLabel(1),
    conceptCountLabel(8),
    spacingRateSentence(41.8, 2.9, 7),
    spacingRateSentence(3, 3, 7),
    // `null` at zero is not a string; the non-null form is the only wording
    // this function has.
    earlyPullSentence(0.38) ?? '',
    effortShareClause(0.57, 0.14),
    insightsScopeSentence(120),
    // --- F6.9, the rhythm reading ---
    rhythmQuietClause(21),
    rhythmQuietClause(30),
  ];
}
