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
 *    counts; F6.3 is the next-*exam* countdown, not the next
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
 * ## One kit decision this panel does take
 *
 * - One primary action, and it starts the review.
 *
 * The kit's streak strip — a missed day marked exactly as a day that had not
 * arrived yet, and a second pane state differing from the first only in the
 * streak number — is not one of them: `[D-061]` removed the streak from F6.1
 * entirely, so there is no streak decision left for this panel to take or
 * decline.
 *
 * ## The rule these strings are tested against
 *
 * `test/today/copy.spec.ts` asserts over `allTodayStrings()`: no future
 * scheduling, no completeness claim, no instruction
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
import {
  type CalendarDay,
  CONTEST_GESTURE_LABEL,
  type CourseEffort,
  type CourseFreshnessBasis,
  type CourseFreshnessReading,
  MASTERY_DISPLAY,
  MASTERY_ORDER,
  type StudySessionItem,
  type Vitality,
} from 'olea-core';
import type { TermDatesAskState } from './term-window-store.js';

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
 *   sit in each of F2.11's four named growth stages and never sums, averages, ranks
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
 *   any explicit form of it ("you should give this course more time") is
 *   either a verdict about her or an unmeasured claim about her results.
 *   **Flagged for David's review** — if he wants an explicit consequence
 *   clause, this is the sentence it attaches to.
 * - **Re-specified against window accounting, not raw grade weight
 *   (`ol-v7r5.33`, `[D-081]`/`[D-092]`).** The second share used to be a
 *   course's raw assessment-weight share; it is now the plan's own windowed
 *   floor share for that course — see `olea-core`'s `effort.ts` module doc
 *   for the full argument and `docs/Olea_semester_narrative.md` §9 (seam S1)
 *   for why: a course sitting above its floor while another dominates is
 *   correct concentration, and only a course actually below its floor is the
 *   pattern worth naming.
 * - **Nothing here fires in the negative direction.** There is no sentence for
 *   "you are over-studying X", because `detectEffortImbalance` cannot report
 *   one; see its module doc.
 * - **The effort line's truth depends on where its course sits in its term
 *   (`ol-7j54` / ARC-1), so it is never emitted unscoped.** "Below its 25%
 *   floor at 14% of the time" reads as ordinary early in a course and as a
 *   real problem late in one — same sentence, opposite reading — and two of
 *   her courses can be in different phases of the term at once. No phase is
 *   computed here; the course is named instead, so she can judge it against a
 *   term she already knows. `effortInsightLine` below is the enforced shape:
 *   it cannot be built without the `CourseEffort` the sentence is about.
 * ------------------------------------------------------------------------ */

/** The mastery overview's eyebrow (F6.2). */
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

// ---------------------------------------------------------------------------
// F2.11's vitality axis, on the ladder D-116's co-presence clause requires
// (`[D-087]`; `[VIT-2]`, `ol-a3hv`). `olea-core`'s `CourseMastery.vitality`
// is `null` whenever no scheduler/clock/cut was wired upstream — see that
// field's own doc for the current gap — and `view.ts` renders NOTHING for a
// course in that state, per D-116's own fallback ("where a surface genuinely
// cannot carry both, it shows neither"). Everything below exists for the
// case `vitality` is NOT null.
// ---------------------------------------------------------------------------

/**
 * F2.11 axis 2's three words, verbatim. **Duplicated from `../registry/
 * copy.ts`'s own `vitalityLabel`**, not imported — the two copy modules are
 * owned by different beads' `owns` sets, the same reasoning `scopeSummaryLine`
 * above states for its own duplication one layer down. One vocabulary
 * (`docs/Olea_vocabulary_registry.md` §1 axis 2), two call sites that agree
 * on it verbatim.
 */
export function vitalityLabel(vitality: Vitality): string {
  switch (vitality) {
    case 'holding':
      return 'holding';
    case 'tending':
      return 'needs tending';
    case 'early':
      return 'too early to say';
  }
}

/**
 * One vitality segment of a ladder row's breakdown: `1 needs tending`. Same
 * shape `masteryCountLabel` gives the growth-stage axis — the co-presence
 * clause's textual half, so a screen reader gets the vitality word beside
 * every stage's count, never the dot marks alone.
 */
export function vitalityCountLabel(vitality: Vitality, count: number): string {
  return `${count} ${vitalityLabel(vitality)}`;
}

/**
 * One concept currently reading `needs tending`, as the tending line needs to
 * see it (F2.11, D-116, `[D-087]`).
 *
 * **Concept naming closed, instrument naming still raw (`ol-95vv.6`).**
 * `displayName` is optional and, when present, is her vault's own wording —
 * `data-source.ts`'s `loadTodayPanel` resolves it from
 * `ConceptRecord.name`/the registry's rename override and attaches it to the
 * `TendingConcept` this interface mirrors (see `olea-core`'s
 * `mastery/sprig.ts#TendingConcept` for why the resolution has to happen
 * there rather than inside the fold itself). `weakestInstrumentId` still has
 * no human label reaching this surface: a label needs the instrument's
 * `notePath`/`heading`/`instrumentType`, which live only in a full vault walk
 * (`VaultInstrumentRecord`) that no production caller inside this bead's
 * `owns` exposes here — see that same `sprig.ts` doc for the full reasoning.
 * `tendingLine` below therefore still names the instrument by its raw id.
 */
export interface TendingLineConcept {
  readonly conceptId: string;
  readonly weakestInstrumentId: string;
  /** Her vault's own wording for this concept, when the caller resolved one. Absent falls back to `conceptId`. */
  readonly displayName?: string;
}

/**
 * The ladder's tending line (vocabulary registry §1: "a tending line naming
 * the concepts explicitly"). Names every concept currently reading `needs
 * tending`, and, for each, the single instrument whose retrievability set
 * that reading — min was chosen over a blend precisely so this sentence can
 * name ONE instrument rather than blur several across a concept's
 * instruments (`[D-087]`, R3; F6.2's own scenario, "the tending line names
 * the instrument the reading came from").
 *
 * `null` when nothing needs tending — the same "absent rather than a
 * rendered zero" rule `newCountSentence` already holds on this panel.
 *
 * **No retrievability number appears here, or anywhere else this module can
 * produce** (F6.2's own scenario, "no retrievability number reaches the
 * panel"): the three vitality words are the position a copy layer may state,
 * and a number beside them is the score principle 12's second part forbids —
 * this function's signature cannot even accept one.
 */
export function tendingLine(concepts: readonly TendingLineConcept[]): string | null {
  if (concepts.length === 0) return null;
  const label = vitalityLabel('tending');
  const named = concepts
    .map(
      (concept) => `${concept.displayName ?? concept.conceptId} (${concept.weakestInstrumentId})`,
    )
    .join('; ');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${named}.`;
}

/**
 * F6.2's cross-course scope reading eyebrow (`[D-076]` round 2, `ol-a83u`
 * [SCP-1], `ol-4qvc`) — a separate section from `MASTERY_LABEL` above: the
 * scope reading states how much of each course's own, examiner-declared
 * material is built, never a percentage (F8.3) and never a comparison
 * across courses (C5.7). "Declares" rather than "covers"/"coverage":
 * the count is the examiner's own declared scope reported back to her,
 * never Olea's judgement of how much ground is covered.
 */
export const SCOPE_LABEL = 'What each course declares';

/**
 * A course with no registered objectives document or past paper yet
 * (F8.1 scenario 2's own wording, at this panel's compact grain — the full
 * explanation and the "register one" pointer belong to the grove screen,
 * `../grove/copy.ts#GROVE_NO_SOURCE_BODY`, not to this summary line).
 */
export const SCOPE_NOT_YET_DECLARED = 'No objectives document or past paper registered yet.';

/**
 * A course whose scope IS declared: the built count and the denominator's
 * own source count, side by side, **never their quotient** (F8.3). Same
 * shape as `../grove/copy.ts#groveSummaryLine` because it is the same fact
 * about the same course — duplicated wording rather than a shared import
 * because the two copy modules are owned by different beads' `owns` sets
 * (the same reasoning `data-source.ts`'s own `instrumentCountsByNotePath`
 * states one layer down).
 */
export function scopeSummaryLine(
  builtCount: number,
  denominatorCount: number,
  sourceCount: number,
): string {
  const sourceNoun = sourceCount === 1 ? 'source' : 'sources';
  return `${builtCount} of ${denominatorCount} built, from ${sourceCount} registered ${sourceNoun}.`;
}

// `ol-v7r5.29`: checked, per the no-surface-without-a-clause rule, and
// deliberately NOT added here. F8.1's shrink-receipt sentence ("the change
// is surfaced ONCE, where the count is shown, as a receipt naming the
// document and the count it replaces") reads as singular, and this panel's
// own F1.5(b) amendment already draws the same "the overview states the
// bare fact, the detail lives at the grove" line for the sibling ask
// affordance one clause earlier: the overview is explicitly "one step from
// the grove," never the place a document-level detail is named.
// `scopeSummaryLine` above stays a bare two-number statement, exactly like
// a growth (F1.5(c) treats a growing denominator as ordinary, needing no
// narration) — the receipt naming WHICH document was reclassified belongs
// at `../grove/copy.ts#groveScopeCorrectionReceiptLine`, the one place F8.1
// names.

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
 * F6.5(b) (`[D-209]`). **The course code is not in this string**, exactly as
 * it is not in `courseCountLabel`: every course string on this panel comes
 * from her vault at runtime, and a copy module that could name a course is a
 * copy module that can leak one (`ol-p2t08`, and `copy.spec.ts`'s INV-3 check
 * over every string this file can produce). The view renders the code beside
 * this clause.
 *
 * That naming is not decorative — `ol-7j54` (ARC-1) makes it a requirement,
 * because this clause's truth depends on where its course sits in its term.
 * `effortInsightLine` below is the enforced form of the pairing; call this
 * function directly only where the caller already, separately, guarantees the
 * course is rendered alongside it.
 *
 * **Two facts, each naming its denominator, never a gap figure (`[D-209]`,
 * `ol-egov.98`).** The prior wording — "has logged N% of the time against a
 * minimum share of M% for this window" — left the window's ownership
 * implicit and called the second fact a bare "minimum share". D-209 rules
 * that F8.3's provenance rule and principle 12's form rule both require a
 * fact's denominator to be nameable, and the plan's own window qualifies only
 * when it is named as the plan's own record rather than left as an
 * unattributed "this window" (F8.3, amended). So the sentence states **the
 * hours in the plan's window** as the first fact's denominator, and **the
 * plan's set-aside** — `floorShare`, itself a share of that same window — as
 * the second fact, juxtaposed and never subtracted from the first: two facts
 * assert only themselves, and a computed gap would assert a study model this
 * contract does not hold (D-209 point 4). The reference shape the ruling
 * gives is count-denominated ("9 of your last 30 study hours went to this
 * course; the plan had set aside about 6 of them"); this module keeps
 * percentages instead, since `CourseEffort` carries shares and no caller here
 * has an hours-denominated window total to report — D-209 makes count vs.
 * percentage a style choice, naming the denominators the part that is not.
 *
 * **`floorShare`, not a grade-weight share (`ol-v7r5.33`, `[D-081]`/
 * `[D-092]`).** The plan's own windowed floor is the guaranteed minimum this
 * course is owed over the current window — `olea-core`'s `CourseEffort
 * .floorShare`, sourced from the cached study-plan artifact, never a raw
 * assessment weight.
 */
export function effortShareClause(floorShare: number, timeShare: number): string {
  return `has logged ${percent(timeShare)} of the hours in the plan's window; the plan had set aside ${percent(floorShare)} of that window.`;
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
  return { course: course.course, text: effortShareClause(course.floorShare, course.timeShare) };
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
 * other numbers (`dueTodaySentence`) are all day-granular, and
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
 * RHY-3's calendar-schedule freshness signal (`ol-4chx` -> `ol-r6s0` ->
 * `ol-hna1` -> `ol-at1a`) — the "with yardstick" branch of the already-drawn
 * rhythm empty state (`RhythmScoped(dates=true)`,
 * `docs/design/pass5-refusal-trends-shell/ui_kits/olea-plugin/
 * Pass5Empties.jsx` in `olea-service`), now fed a real per-course session date
 * instead of sample content. This is a *stronger* claim than
 * `rhythmQuietClause`'s flat quiet-days count — a specific calendar-derived
 * date rather than a threshold crossing — and `basis` is what keeps that
 * strength honest:
 *
 * - `'observed'` — the calendar note itself records the session. Stated
 *   plainly, the strongest claim this signal can make (RHY-3 §4).
 * - `'extrapolated'` — projected from a recurring weekly slot past the synced
 *   window. Hedged ("based on its usual pattern", "expected around") rather
 *   than asserted as read — RHY-3 §4's binding rule that an extrapolated date
 *   must never be stated with an observed date's confidence.
 *
 * Same restraint `rhythmQuietClause` already holds: no streak, no effort
 * score, no hours total, nothing phrased as "behind" — a session and whether
 * material from it has landed, and nothing else. The fact is about the vault
 * (`[D-047]`), never about her.
 */
export function rhythmYardstickClause(
  expectedSessionDate: CalendarDay,
  basis: CourseFreshnessBasis,
): string {
  return basis === 'observed'
    ? `a session on ${expectedSessionDate} hasn't shown up in your vault yet.`
    : `based on its usual pattern, a session was expected around ${expectedSessionDate}, and nothing from it has shown up in your vault yet.`;
}

/** `rhythmYardstickClause`'s return shape, bundled with the course it is true of — same reasoning `rhythmQuietLine` states. */
export interface RhythmYardstickLine {
  readonly course: string;
  readonly text: string;
}

/**
 * The one way this module offers to reach `rhythmYardstickClause` — reaching
 * it always carries which course it measures, same guarantee `rhythmQuietLine`
 * gives. The course itself is never in `.text` (INV-3, `ol-p2t08`).
 */
export function rhythmYardstickLine(
  course: string,
  expectedSessionDate: CalendarDay,
  basis: CourseFreshnessBasis,
): RhythmYardstickLine {
  return { course, text: rhythmYardstickClause(expectedSessionDate, basis) };
}

/**
 * Which course's calendar-schedule reading the already-drawn rhythm empty
 * state shows, when more than one course reaches `not-arrived-with-yardstick`
 * at once. Composing every flagged course into one panel is
 * `RHY-3-multicourse-composition.md`'s job (`ol-movk` / `ol-i0zw`), explicitly
 * out of this bead's scope (`ol-at1a`) — so exactly one reading is picked, the
 * same way the flat quiet-days reading already narrows to exactly one
 * (`RhythmInsight.measured.quietestCourse`, `olea-core`'s `today/rhythm.ts`).
 *
 * **Stable, arbitrary tie-break: course code, alphabetical.** The composition
 * doc's own §4.4 names this exact fallback for courses with no assessment
 * date on record; used here as the *only* rule (not merely the fallback)
 * because ranking by "how overdue" would be the cross-course score comparison
 * Cluster C rules out (`ol-ej59.4` ruling 1) the moment it influenced what she
 * sees — and a composed, assessment-proximity ordering across every flagged
 * course is exactly the multicourse work this bead does not do.
 *
 * Returns `null` when `readings` is `null` (the signal could not be computed)
 * or when no course currently carries a with-yardstick reading — both cases
 * leave the existing no-yardstick fallback (`rhythmQuietLine`) to render, same
 * as before this signal existed.
 */
export function pickRhythmYardstickReading(
  readings: readonly CourseFreshnessReading[] | null,
): CourseFreshnessReading | null {
  if (readings === null) return null;
  const withYardstick = readings.filter((r) => r.status === 'not-arrived-with-yardstick');
  if (withYardstick.length === 0) return null;
  return [...withYardstick].sort((a, b) => a.courseCode.localeCompare(b.courseCode))[0] ?? null;
}

/**
 * F7.2's term-dates quiet pointer (`[D-147]`, `ol-0r92.6`) — drawn beside a
 * rhythm quiet finding, and only there: the clause fires it "when the
 * rhythm reading would otherwise render with no yardstick", and the rhythm
 * section currently renders nothing at all unless a course actually reached
 * the quiet threshold (`renderRhythmBody`'s own doc). See
 * `../settings/term-dates-field-copy.ts` for the settings side of the same
 * ask, and that module's doc for why this wording is a Class B default
 * rather than a ratified string (proposal §5, open question 5).
 *
 * States a fact about what the field is for, never a compliance framing —
 * the same restraint `rhythmQuietClause` holds for the reading itself.
 */
export const TERM_DATES_POINTER_TEXT =
  "When does this term run? Olea uses this to say whether material is arriving at the usual pace — not to track how you're doing.";

/** Never "Remind me later" — see `term-dates-field-copy.ts`'s doc on the skip label for the same rule applied there. */
export const TERM_DATES_POINTER_BUTTON_LABEL = 'Add term dates';

/**
 * `[D-147]`'s trigger, kept beside the strings rather than as an inline
 * condition in `view.ts`'s DOM code — same reasoning `showsStartReviewAction`
 * states above: it is what a test can hold onto without a DOM. Fires only
 * when the rhythm reading has no resolved term window AND the ask remains
 * genuinely unanswered — an `'answered'` or `'skipped'` state, or `null`
 * (no ask support wired), both mean no pointer.
 */
export function showsTermDatesPointer(
  hadTermWindow: boolean,
  askState: TermDatesAskState | null,
): boolean {
  return !hadTermWindow && askState === 'unanswered';
}

// ---------------------------------------------------------------------------------------------
// The contest gesture and its dispute sheet (`[D-046]` clause 4, `[D-095]`,
// `ol-fgba` [DISP-1]; drawn in DSN-1 and approved by `[D-136]`).
//
// **The gesture's own label is NOT defined here.** It is `olea-core`'s
// `CONTEST_GESTURE_LABEL`, because it is the one string that appears on every
// claim-bearing surface in the product and a per-surface copy of it is exactly
// how "the same gesture everywhere" stops being true. Re-exported below so
// `view.ts` and `allTodayStrings()` reach it the same way they reach every
// other string on this panel.
//
// Every sentence in this block states a fact and points at the evidence behind
// it. None defends Olea's reading, apologises for it, characterises her
// disagreement, or carries a number standing in for confidence — frame 09's
// forbidden list, asserted mechanically in the copy test against
// `FORBIDDEN_CONTEST_STRINGS`.
// ---------------------------------------------------------------------------------------------

export { CONTEST_GESTURE_LABEL };

/** The sheet's own heading. Names what it is showing, never what it thinks of her. */
export const CONTEST_SHEET_LABEL = 'What this is based on';

/**
 * The withheld-gesture line for a claim DSN-1 left unrouted (open questions
 * 6-10). She is told plainly that this kind of claim has no contest yet, rather
 * than being offered a gesture that would do something nobody has ruled.
 */
export const CONTEST_NOT_YET_ROUTED = 'There is no way to dispute this kind of line yet.';

/** Offline is a state the sheet renders in, never a reason it fails to open. */
export const CONTEST_SHEET_OFFLINE_NOTE = 'This works without a connection.';

/**
 * The held-reading answer: the reading, the evidence, and the date. Newest
 * review first, because "you explained it back three weeks ago" is the answer.
 *
 * No confidence number, no probability, no adjustment to agree. The reading
 * holds and shows its work — `[D-046]` clause 4's hard half.
 */
export function contestHeldLine(reviewCount: number, latestDate: string | null): string {
  if (reviewCount === 0 || latestDate === null) {
    return 'This reading has no reviews behind it yet, in the window shown above.';
  }
  const reviews = reviewCount === 1 ? '1 review' : `${reviewCount} reviews`;
  return `This reading stands on ${reviews}, the most recent on ${latestDate}.`;
}

/** The mark that rides beside a standing reading she disagreed with. */
export const CONTEST_DISSENT_MARK = 'You disagree with this reading.';

/**
 * The acknowledgment, shown exactly once after a re-derivation upholds the
 * claim, and then never again (`[D-095]` §2). Repeating it on every later visit
 * would teach her the channel is an argument; never showing it would teach her
 * it is a void.
 */
export const CONTEST_UPHELD_ACKNOWLEDGEMENT =
  'Checked again — the reading is unchanged. Your note is kept beside it.';

/**
 * The compensating line for a corrected grade, naming her contest as its
 * catalyst — written where she can see it, because that is the proof the
 * channel works.
 */
export function contestCorrectedLine(date: string): string {
  return `Re-checked after you flagged this on ${date}, and the earlier grading was changed.`;
}

/** What a quarantined grade says while its re-derivation is outstanding. */
export const CONTEST_QUARANTINE_BADGE = 'Counting as thin evidence while this is re-checked.';

/** A withdrawn structural claim. Never "deleted" — vocabulary registry §3. */
export const CONTEST_RETURNED_TO_CANDIDATE =
  'This match is back to a candidate and is not being used.';

// ---------------------------------------------------------------------------------------------
// F6.7 — new (unmet) material is named by its source, never by a count
// (`[D-060]`; `ol-0r92.9`, data half `ol-y237`).
//
// `ol-y237` (`olea-core`'s `study-session/compose.ts` / `build.ts`) hands a
// caller each session item's own `ObligationClass` and that same item's own
// `notePath`/`noteTitle` — the two facts F6.7's sentence needs, and a shape
// with no total, no per-class count and no list length anywhere in it, so
// nothing here could be summed back into the count the clause forbids. This
// module is the one place that turns the pair into the sentence; the
// suggested session's screen (`session-builder/copy.ts`'s `sessionScreenCopy`,
// rendered on every path by `session-builder/view.ts`) is the reachable
// caller — the same reason `effortInsightLine`/`rhythmQuietLine` above live
// here and are called from a DOM file that never assembles a sentence of its
// own.
//
// **One line per distinct source, never a count of them.** Two items drawn
// from the same note collapse to one line; a second mention of the same
// source would read as emphasis, and two different notes worth mentioning
// are two facts, not a number to be summed. `recall-due`/`baseline-due`/
// `elective` items, and any item with no classification at all
// (`obligationClass === undefined` — a caller that supplied no
// classification map), are due work or ordinary review, never material she
// has not yet met, and never produce a line here (F6.1: due counts are
// permitted elsewhere and are never the headline on this surface either).
// ---------------------------------------------------------------------------------------------

/** F6.7's own worked example, generalised: names the source and stops. */
export function newMaterialSourceLine(source: string): string {
  return `Includes new material from ${source}.`;
}

/**
 * Every distinct source worth mentioning for material she has not yet met,
 * across the items a session offers. `[]` when nothing in `items` is
 * classified `'unmet'` — silence, not a rendered "0 new sources" line, the
 * same "absent rather than zero" rule `newCountSentence` already holds.
 */
export function newMaterialSourceLines(
  items: readonly Pick<StudySessionItem, 'obligationClass' | 'noteTitle'>[],
): readonly string[] {
  const sources: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.obligationClass !== 'unmet') continue;
    if (seen.has(item.noteTitle)) continue;
    seen.add(item.noteTitle);
    sources.push(item.noteTitle);
  }
  return sources.map(newMaterialSourceLine);
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
    dueTodaySentence(0),
    dueTodaySentence(1),
    dueTodaySentence(23),
    // `null` at zero is not a string; the other two are every wording this
    // function has.
    newCountSentence(1) ?? '',
    newCountSentence(12) ?? '',
    courseCountLabel(0),
    courseCountLabel(12),
    // --- the trends half (F6.2, F6.5) ---
    MASTERY_LABEL,
    INSIGHTS_LABEL,
    INSIGHTS_TOO_EARLY,
    RHYTHM_LABEL,
    // Every one of F2.11's four words, at the two counts whose wording could
    // differ. Sampling the vocabulary rather than one state of it is what makes
    // the panel-wide rules apply to all four.
    ...MASTERY_ORDER.flatMap((state) => [masteryCountLabel(state, 1), masteryCountLabel(state, 7)]),
    conceptCountLabel(0),
    conceptCountLabel(1),
    conceptCountLabel(8),
    // --- F2.11's vitality axis, the ladder's co-presence half (`[VIT-2]`, `ol-a3hv`) ---
    vitalityLabel('holding'),
    vitalityLabel('tending'),
    vitalityLabel('early'),
    vitalityCountLabel('holding', 1),
    vitalityCountLabel('holding', 3),
    vitalityCountLabel('tending', 1),
    vitalityCountLabel('tending', 2),
    vitalityCountLabel('early', 1),
    vitalityCountLabel('early', 4),
    // `null` at zero concepts is not a string; the non-null forms are every
    // wording this function has (one concept, and more than one; with and
    // without a resolved `displayName`, `ol-95vv.6`).
    tendingLine([{ conceptId: 'concept-a', weakestInstrumentId: 'qa:concept-a:1' }]) ?? '',
    tendingLine([
      { conceptId: 'concept-a', weakestInstrumentId: 'qa:concept-a:1' },
      { conceptId: 'concept-b', weakestInstrumentId: 'cloze:concept-b:2' },
    ]) ?? '',
    tendingLine([
      {
        conceptId: 'concept-a',
        weakestInstrumentId: 'qa:concept-a:1',
        displayName: 'Coined concept A',
      },
      {
        conceptId: 'concept-b',
        weakestInstrumentId: 'cloze:concept-b:2',
        displayName: 'Coined concept B',
      },
    ]) ?? '',
    // --- F6.2's cross-course scope reading (`[D-076]` round 2, `ol-4qvc`) ---
    SCOPE_LABEL,
    SCOPE_NOT_YET_DECLARED,
    scopeSummaryLine(2, 10, 1),
    scopeSummaryLine(9, 10, 2),
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
    // --- RHY-3's calendar-schedule freshness (`ol-at1a`) ---
    rhythmYardstickClause('2026-08-11', 'observed'),
    rhythmYardstickClause('2026-08-18', 'extrapolated'),
    // --- F7.2's term-dates quiet pointer (`[D-147]`) ---
    TERM_DATES_POINTER_TEXT,
    TERM_DATES_POINTER_BUTTON_LABEL,
    // --- the contest gesture and its sheet (`[D-046]` clause 4, `[D-095]`) ---
    CONTEST_GESTURE_LABEL,
    CONTEST_SHEET_LABEL,
    CONTEST_NOT_YET_ROUTED,
    CONTEST_SHEET_OFFLINE_NOTE,
    contestHeldLine(0, null),
    contestHeldLine(1, '2026-08-18'),
    contestHeldLine(4, '2026-08-18'),
    CONTEST_DISSENT_MARK,
    CONTEST_UPHELD_ACKNOWLEDGEMENT,
    contestCorrectedLine('2026-08-21'),
    CONTEST_QUARANTINE_BADGE,
    CONTEST_RETURNED_TO_CANDIDATE,
    // --- F6.7 — new material named by source, never by count ([D-060]) ---
    newMaterialSourceLine('the lecture notes'),
  ];
}
