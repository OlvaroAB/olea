/**
 * Every string the review view *assembles* — as opposed to the fixed labels
 * it stamps onto controls it builds — plus the keycap glyphs it shows
 * (`ol-09kf`, Q6.5, F2.16).
 *
 * **Why this file exists.** All of it used to live in `view.ts`, which is
 * the one file in the review path with no test and, by its own module doc,
 * none expected: "thin, mechanical glue". That was true of the DOM building
 * and false of the copy. A session-complete paragraph that pluralises a
 * count, conditionally names the courses, and then *tells her when her items
 * come back* is not glue — the last clause is a claim about scheduler state,
 * and it was being assembled in a DOM builder where nothing could assert on
 * it. This project already has a footgun written down for exactly that shape
 * (CLAUDE.md, on design-mock body copy: "that is where *the system does X*
 * gets decided by nobody"). Pure functions here; assertions in
 * `copy.spec.ts`; `view.ts` renders what it is handed.
 *
 * **The line this file draws with `view.ts`.** A string belongs here when it
 * is *derived* — from a count, a set of course codes, a scheduler interval,
 * a key binding. A string stays in `view.ts` when it is a fixed label on a
 * control that file is building ("Edit note", "Close", "Correct answer"):
 * unconditional, asserting nothing, and meaningless away from the element it
 * names.
 *
 * **Keycaps are derived from the resolver, not from a second literal.**
 * `keymap.ts`'s module doc explains that hint rows are generated from its own
 * bindings "so the two cannot drift apart" — but the rating buttons' digits,
 * the MCQ option letters and the header's E/S were hand-typed a second time
 * in `view.ts`, which is the one place that discipline was not applied. The
 * functions below ask `resolveReviewKey` itself which key produces a given
 * action, so a keycap can only ever show a key the resolver actually accepts.
 * That is deliberately stronger than reading `keymap.ts`'s tables: it is the
 * *behaviour* that is queried, so a binding change cannot leave a stale glyph
 * behind, and no table has to be exported to make it work.
 */

import type { Rating } from 'olea-contracts';
import type { AcceptedExplainBackGrading } from 'olea-core';
import { type ReviewAction, type ReviewScreen, resolveReviewKey } from './keymap.js';
import type { SessionCompleteSummary } from './session.js';
import type { ClozeCard, QaCard } from './types.js';

// ---------------------------------------------------------------------------
// Keycaps, derived from the key resolver
// ---------------------------------------------------------------------------

const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const LETTER_KEYS = 'abcdefghijklmnopqrstuvwxyz'.split('');

/**
 * The first key in `candidates` that this screen resolves to a matching
 * action, or `null` if the resolver accepts none of them — in which case the
 * caller must show no keycap at all rather than promise a key that does
 * nothing (Q6.5: "every hint shown on screen must be a real binding").
 */
function keycapFor(
  screen: ReviewScreen,
  candidates: readonly string[],
  matches: (action: ReviewAction) => boolean,
): string | null {
  for (const key of candidates) {
    const action = resolveReviewKey({ key }, screen);
    if (action !== null && matches(action)) return key;
  }
  return null;
}

/** The digit shown on a rating button — whichever digit `resolveReviewKey` maps to that rating on the reveal screen. */
export function ratingKeycap(rating: Rating): string | null {
  return keycapFor(
    { kind: 'card-reveal' },
    DIGIT_KEYS,
    (action) => action.kind === 'rate' && action.rating === rating,
  );
}

/** The letter shown on an MCQ option row, uppercased for display. `optionCount` is passed through because the resolver bounds option keys on it. */
export function mcqOptionKeycap(index: number, optionCount: number): string | null {
  const key = keycapFor(
    { kind: 'mcq-unanswered', optionCount },
    LETTER_KEYS,
    (action) => action.kind === 'mcq-answer' && action.optionIndex === index,
  );
  return key === null ? null : key.toUpperCase();
}

/**
 * The letter shown on a button whose binding is a single letter — the
 * header's "Edit note"/"Suspend" and the MCQ footer's "Wasn't sure ·
 * guessed" — uppercased for display.
 *
 * `screen` is required rather than assumed, and that is the point: the same
 * header renders above several screens, and `resolveReviewKey` deliberately
 * does *not* accept E or S on `note-missing` (there is nothing to edit or
 * suspend when the note is gone). Querying the screen the button is actually
 * on returns `null` there, so no keycap is drawn — instead of the header
 * advertising a shortcut that does nothing, which is what a hand-typed 'E'
 * did.
 */
export function actionKeycap(
  kind: 'edit' | 'suspend' | 'mcq-toggle-guessed',
  screen: ReviewScreen,
): string | null {
  const key = keycapFor(screen, LETTER_KEYS, (action) => action.kind === kind);
  return key === null ? null : key.toUpperCase();
}

/**
 * A keycap for a *named* key (Space, Escape, Enter, Delete), where the glyph
 * she reads is a display choice rather than the key's own name.
 *
 * The glyph cannot be derived, but the *binding* can be checked, and that is
 * the half that goes wrong: this returns `null` — no keycap — unless the
 * resolver really does produce `kind` from `key` on that screen. So a button
 * can never advertise a shortcut that has been renamed, rebound or dropped,
 * which is Q6.5's "every hint shown on screen must be a real binding" applied
 * to the buttons as well as to the hint rows.
 */
export function verifiedKeycap(
  screen: ReviewScreen,
  key: string,
  glyph: string,
  kind: ReviewAction['kind'],
): string | null {
  const action = resolveReviewKey({ key }, screen);
  return action !== null && action.kind === kind ? glyph : null;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Display names for the four Q&A/cloze ratings (F2.16). The `Rating` union is exhaustive here, so a new rating is a type error rather than a silently unlabelled button. */
const RATING_LABELS: Readonly<Record<Rating, string>> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

export function ratingLabel(rating: Rating): string {
  return RATING_LABELS[rating];
}

/**
 * The two sentences the review view shows when it could not compose a session
 * at all — a vault it could not walk, a log it could not read.
 *
 * **Not the empty screen's copy, and the difference is the point.** *"You're
 * caught up."* is a claim about her deck, and a failed read supports no claim
 * about her deck. `today/panel.ts` draws exactly this line between a `null` due
 * summary and a computed zero, and `today/copy.ts`'s `DUE_UNAVAILABLE` is its
 * rendering — this is the same statement in the same voice on the other
 * surface.
 *
 * Three things this copy deliberately does not do, all of them mistakes
 * `commands/placeholders.ts` already names: it does not read as a crash, it
 * does not blame her, and it does not say a feature is missing — it is not
 * missing, the read failed. It says what happened and what to do, in that
 * order.
 */
export const REVIEW_UNAVAILABLE_TITLE = 'Olea could not read your vault just now.';
export const REVIEW_UNAVAILABLE_BODY =
  'So there is no queue to show. This is not a claim that nothing is due — try again in a moment.';

/**
 * F2.7's honest "cannot ground" refusal (`ol-sn1q`), shown by both the
 * on-demand explain-why panel and F2.12's "explain it back" offer — the two
 * share one on-demand channel (`grading/wiring.ts`'s module doc), so they
 * share this sentence rather than each inventing its own. A claim about
 * whether her notes support an explanation belongs here, not as a `view.ts`
 * literal — the same line `REVIEW_UNAVAILABLE_BODY` draws for the vault-read
 * failure above.
 */
export const EXPLAIN_WHY_REFUSAL =
  "Olea can't ground an explanation for this from your notes right now.";

/**
 * F7.8's grey-out, worded for this one on-demand channel: shown when she
 * taps "Explain it back" (F2.12) but no AI Worker is configured, so there is
 * nothing to route the accepted offer into.
 */
export const EXPLAIN_WHY_UNAVAILABLE =
  "Explain it back isn't available yet — no AI Worker is configured.";

// ---------------------------------------------------------------------------
// F5 Feynman-mode explain-back: the folded grounding refusal (C4.7, `[D-089]`)
// ---------------------------------------------------------------------------
//
// Foundation item 32, "What Olea is allowed to say" (`docs/foundation/plan.html`
// in olea-service): "the refusal path for explanations has no shipped text at
// all — it exists in the development harness only, so the branch would
// render nothing." `EXPLAIN_WHY_REFUSAL` above closes that gap for F2.7's
// on-demand channel (`ol-sn1q`). These two close it for the DIFFERENT
// refusal `[D-089]`'s folded path requires of F5's own graded explain-back
// (`explain-back.judge.v1`, the Feynman-mode instrument, not F2.7's "why was
// I wrong"): a two-reason posture, and the two reasons must be
// distinguishable in both directions — "an error-refusal states the true,
// transient reason, never the insufficient-notes message" (C4.7).
//
// **No production caller renders either string yet.** `gradeExplainBack`
// (`olea-core`'s grading pipeline) has no wire-level refusal signal at all —
// every `JudgeCaller` response it models is a graded verdict — and the
// review UI has no Feynman-mode destination to grade: `ol-tka5` (open,
// Class C) has not decided where an explain-back verdict is persisted, so
// `session.ts`'s own `acceptConfusionRoutingOffer` doc explicitly declines
// to build one ahead of that. Item 32's Done-when is scoped to
// `packages/plugin/src/**/copy.ts` — the copy itself, not the wiring — so
// these ship as real, vocabulary-checked text now rather than being invented
// under time pressure later, the way `EXPLAIN_WHY_REFUSAL` had to be.

/**
 * The transient half of `[D-089]`'s two-reason refusal: the folded grounding
 * check errored or timed out, so nothing was graded. States the mechanical
 * fact and the next step (V3/V4) — never the insufficient-notes wording
 * below, because a check that failed to run is not evidence her notes are
 * thin (C4.7: "a false claim about her notes wearing a refusal's clothes").
 */
export const EXPLAIN_BACK_CHECK_FAILED_REFUSAL =
  "Olea couldn't check this explanation against your notes just now, so nothing was graded. Try again in a moment.";

/**
 * The insufficient-notes half: retrieval genuinely returned too little to
 * grade against. A **diagnostic** refusal (C4.7) — it may state only what
 * retrieval actually returned, never a summary claim about the vault beyond
 * that, so this is parametrised on the block count rather than hard-coded.
 *
 * **Leads with her material, not with Olea (V1).** The fact here is about
 * her notes, not about Olea's own action — V1's own failing example is
 * exactly this shape written the other way round ("Olea noticed Anatomy is
 * behind" instead of "Anatomy has received below its minimum share…"), so
 * this states what her notes have (or don't) rather than what Olea found.
 */
export function explainBackInsufficientNotesRefusal(sourceBlockCount: number): string {
  const evidence =
    sourceBlockCount <= 0
      ? "Your notes don't have anything on this yet"
      : `Your notes have ${sourceBlockCount === 1 ? '1 passage' : `${sourceBlockCount} passages`} on this — not enough`;
  return `${evidence} to grade the explanation against. Add more to your notes, then try again.`;
}

/**
 * F6.8 / V5's "first-ever full-depth explanation" moment — the one
 * encouragement string this cluster can honestly write, because it is the
 * only affect-bearing moment on the charter's closed list that an
 * `AcceptedExplainBackGrading` can evidence at all (the other two, a
 * growth-stage transition and the first session after an absence, are read
 * from mastery/scheduling state this pipeline never touches).
 *
 * **Evidence-gated, not scheduled.** F6.8 bars a compliment "Olea has not
 * measured" — praise that could have been written before she did anything
 * is exactly what item 32 names as noise. This returns `null` unless the
 * grading is a clean pass: `verdict === 'correct'` AND nothing was missed,
 * cited or flagged as a misconception. Every field read here is one
 * `AcceptedExplainBackGrading` actually carries (`gradingPipeline.ts`) —
 * nothing is invented, and depth itself is never scored by this pipeline
 * (F5.4's Socratic follow-ups are shed for S3), so "full depth" is read as
 * this honest proxy: correct, with nothing the grader found to flag.
 *
 * **What names the specific evidence** is `grading.feedback` — the grader's
 * own per-answer text, not a second, separately-invented sentence — appended
 * after the milestone fact, the same composition `mcqFeedbackSentence` above
 * already uses for "model text plus one derived clause."
 *
 * **`first`, not "first this session":** the caller decides whether this is
 * actually the first full-depth explanation ever (mastery/stage state this
 * module does not hold) and only calls this function once that is true —
 * same "copy derives, callers decide state" split the module doc draws
 * throughout this file. No caller does so yet; see the section header above.
 *
 * The milestone sentence deliberately matches the vocabulary registry's own
 * V5 worked example verbatim (`docs/Olea_vocabulary_registry.md` §9) rather
 * than paraphrasing it — the registry's pass case for this exact moment
 * needs no rewording, and drifting from it would just be a second, unproven
 * way of saying the one thing V5 already ratified.
 */
export function explainBackFullDepthEncouragement(
  grading: Pick<
    AcceptedExplainBackGrading,
    'verdict' | 'missedPoints' | 'citedIssues' | 'misconceptionCandidates' | 'feedback'
  >,
): string | null {
  if (
    grading.verdict !== 'correct' ||
    grading.missedPoints.length > 0 ||
    grading.citedIssues.length > 0 ||
    grading.misconceptionCandidates.length > 0
  ) {
    return null;
  }
  const milestone = "That's the first time this concept has been explained at full depth.";
  const feedback = grading.feedback.trim();
  return feedback === '' ? milestone : `${milestone} ${feedback}`;
}

/**
 * What a cloze front shows where the deleted text will appear.
 *
 * Naming the call `ol-09kf` left open: this is **copy, not layout.** The
 * blank is a run of characters she reads inside the sentence, chosen for
 * length rather than styled by a rule, so it belongs with the other strings
 * and is asserted rather than being a literal inside a DOM builder. If it
 * ever becomes a styled element (a bordered gap, say), that is the point at
 * which it becomes `view.ts`'s again.
 */
export const CLOZE_BLANK = '_____';

/** The question line, for either instrument type a card screen can show. */
export function questionText(instrument: QaCard | ClozeCard): string {
  return instrument.type === 'qa'
    ? instrument.question
    : `${instrument.before}${CLOZE_BLANK}${instrument.after}`;
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/** "A", "A and B", "A, B and C" — no Oxford comma, matching the phrasing the complete screen already used. */
export function formatCourseList(codes: readonly string[]): string {
  if (codes.length === 0) return '';
  if (codes.length === 1) return codes[0] ?? '';
  if (codes.length === 2) return `${codes[0]} and ${codes[1]}`;
  return `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`;
}

/**
 * The clause that tells her when the items she just reviewed come back.
 *
 * **This is the schedule-asserting half of the sentence, and it was wrong.**
 * The version in `view.ts` had two branches: none due soon → "All of them
 * are further out than tomorrow", otherwise "N of them come back today or
 * tomorrow; the rest are further out". The second branch is false whenever
 * *every* reviewed item is due soon — it asserts a remainder that does not
 * exist — which is reachable with a single item rated Again, i.e. one of the
 * likeliest sessions there is. `dueSoonCount` is derived from real
 * `Scheduler.schedule` output for the rating she actually gave
 * (`ReviewSession.logAndAdvance`), so the sentence is a claim about
 * scheduler state and has to survive its own edge cases. The all/none/some
 * split below makes the "the rest" clause unreachable unless a remainder
 * really exists.
 */
function dueSoonClause(reviewedCount: number, dueSoonCount: number): string {
  const soon = Math.max(0, Math.min(dueSoonCount, reviewedCount));
  if (reviewedCount === 1) {
    return soon === 1 ? 'It comes back today or tomorrow.' : 'It comes back later than tomorrow.';
  }
  if (soon === 0) return 'All of them are further out than tomorrow.';
  if (soon === reviewedCount) return 'All of them come back today or tomorrow.';
  return `${soon} of them come back today or tomorrow; the rest are further out.`;
}

/** The session-complete paragraph under "That's the queue for today." */
export function sessionCompleteSentence(summary: SessionCompleteSummary): string {
  const { reviewedCount, courseCodes, dueSoonCount } = summary;
  if (reviewedCount <= 0) return 'Nothing was reviewed this session.';

  const courses = formatCourseList(courseCodes);
  const across = courses === '' ? '' : ` across ${courses}`;
  const items = `${reviewedCount} item${reviewedCount === 1 ? '' : 's'}${across}.`;
  return `${items} ${dueSoonClause(reviewedCount, dueSoonCount)}`;
}

/**
 * The MCQ feedback paragraph: the instrument's own feedback (model-generated
 * in the product, F2.15) followed by when the item comes back.
 *
 * The schedule sentence is omitted entirely when there is no interval to
 * report, rather than rendered with a gap where the interval should be. Same
 * principle as the clause above: a sentence that names a due date is a claim
 * about scheduler state, so it is only ever produced when that state is
 * actually in hand.
 */
export function mcqFeedbackSentence(feedback: string, intervalLabel: string): string {
  const body = feedback.trim();
  const interval = intervalLabel.trim();
  if (interval === '') return body;
  const schedule = `This one comes back ${interval}.`;
  return body === '' ? schedule : `${body} ${schedule}`;
}

// ---------------------------------------------------------------------------------------------
// The contest gesture on a grade (`[D-046]` clause 4, `[D-095]`, `ol-fgba` [DISP-1]).
//
// The gesture's own label is NOT redefined here — it is `olea-core`'s
// `CONTEST_GESTURE_LABEL`, the single string that appears on every
// claim-bearing surface in the product. A second copy of it on this surface is
// exactly how "the same gesture everywhere" quietly stops being true.
//
// Nothing in this block characterises her disagreement, defends the grading, or
// carries a number standing in for confidence; `FORBIDDEN_CONTEST_STRINGS` in
// `olea-core` is the mechanical half of that rule.
// ---------------------------------------------------------------------------------------------

/**
 * What a quarantined grade says while its re-derivation is outstanding. It
 * dims with a reason — never disappears, and never reads as though the review
 * did not happen.
 */
export const CONTEST_QUARANTINE_BADGE = 'Counting as thin evidence while this is re-checked.';

/**
 * The gesture's own label, re-exported from `olea-core` so this surface reads
 * every string it renders from `copy.ts` like every other string here — while
 * the string itself stays defined once, for the whole product.
 */
export { CONTEST_GESTURE_LABEL } from 'olea-core';

/**
 * The opening of the compensating line for a corrected grade. Names her
 * contest as the catalyst, which is the proof the channel works.
 */
export const CONTEST_CORRECTED_PREFIX = 'Re-checked after you flagged this on';

/** Shown once when the re-derivation upholds the original grading, then not again. */
export const CONTEST_GRADE_UPHELD = 'Checked again — the original grading holds.';
