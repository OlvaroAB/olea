/**
 * Every string the session builder shows her (F4.6, F4.7, F4.8, F4.9;
 * `ol-p5t06b` [P5-T06b]). Also F6.7's by-source signal on this screen
 * (`ol-0r92.9`) — F6.4 names this the reachable surface for it: "where the
 * session includes material Olea has built since she last studied, it says
 * where it came from ... and never how much of it there is." And F6.6's
 * re-entry-after-absence surface (`ol-v7r5.18`, discovered from `ol-blwb` /
 * `[BKLG-1]`) — see `reentryScreenCopy` below, which is what
 * `SessionBuilderView` renders when `provider.ts` reports a re-entry
 * (`SessionBuilderState`'s `'reentry'` branch, `../session-builder/view.js`).
 *
 * **Why a copy module and not strings in the view.** The same reason
 * `gap/copy.ts` exists (`ol-09kf`): product copy assembled in a DOM builder is
 * copy nothing can assert on. On this surface the exposure is sharper than on
 * the gap view, because a session builder makes two claims the gap view does
 * not — *how long this will take you* and *what your next assessment is* — and
 * both are the kind of sentence that reads as knowledge whether or not it is.
 *
 * **F4.9, clause by clause, and where each is discharged here.**
 *
 *  - *Likelihood not prophecy.* {@link SESSION_ATTRIBUTION} puts the asking in
 *    the past tense and attributes it to her prior papers, exactly as
 *    `gap/copy.ts`'s `rankingAttribution` does. Nothing here says an assessment
 *    *will* ask anything. {@link countdownLine} states a date and a number of
 *    days — both facts from her own assignments table — and nothing about what
 *    the paper will contain.
 *  - *Always advises covering the full syllabus.* {@link sessionFraming} emits
 *    `gap/copy.ts`'s own {@link FULL_SYLLABUS_ADVICE}, imported rather than
 *    re-worded. Two wordings of one promise drift; one string cannot. And it is
 *    emitted from the session state, so a ranking cannot be drawn without it.
 *  - *Never implies knowledge of a real paper.* The format line says her next
 *    assessment is a quiz — a fact from the `type` column of her own
 *    assignments Base — and never that the questions will look like the ones
 *    Olea picked.
 *
 * **Principle 12: information and consequence, never verdict.** A session
 * builder is the easiest surface in this product on which to scold: it knows
 * how far behind a plan she is and how much it had to leave out. So
 * {@link leftOutLines} reports counts and reasons and stops there. Nothing here
 * evaluates her effort, her position or her pace — {@link durationBasisLine}
 * talks about the *estimate's* provenance, never about how fast she is.
 *
 * **The honesty the duration model forces onto this layer.** `olea-core`'s
 * `study-session/duration.ts` reports whether each number was measured from her
 * review log or assumed by Olea, and {@link durationBasisLine} is the reason
 * that field exists rather than a comment. A timing claim built on three
 * guessed constants must not read like a measurement of her.
 *
 * **INV-1.** No `obsidian` import here — this module is unit-tested, which is
 * the entire point of it being separate from `view.ts`.
 */

import type {
  DurationModelBasis,
  ReentryStudySessionView,
  SessionAssessmentCountdown,
  SittingStalenessReason,
  StudySessionItem,
  StudySessionModel,
  StudySessionOmission,
} from 'olea-core';
import { FULL_SYLLABUS_ADVICE } from '../gap/copy.js';
import { newMaterialSourceLines } from '../today/copy.js';

// ---------------------------------------------------------------------------
// Titles, budgets and the unavailable state
// ---------------------------------------------------------------------------

export const SESSION_VIEW_TITLE = 'Build a session';

/**
 * The budgets the view offers as one tap.
 *
 * Three, spanning "before a lecture", "an evening block" and "a real sitting".
 * F4.6 names twenty minutes outright ("Build a 20-minute session") and says
 * nothing about the others, so 45 and 90 are a Class B default — reversible,
 * and reversible from the outside: `SessionBuilderViewDeps.budgetOptions`
 * overrides the list without a code change.
 */
export const SESSION_BUDGET_OPTIONS: readonly number[] = [20, 45, 90];

export const DEFAULT_SESSION_BUDGET_MINUTES = 20;

export function budgetOptionLabel(minutes: number): string {
  return `${minutes} min`;
}

/**
 * What the screen says when it could not build a session at all — a vault it
 * could not walk, an extraction pass that threw.
 *
 * Same statement, same voice as `gap/copy.ts`'s `GAP_UNAVAILABLE_*` and
 * `today/copy.ts`'s `DUE_UNAVAILABLE`: it does not read as a crash, it does not
 * blame her, and it does not say a feature is missing. It says what happened.
 */
export const SESSION_UNAVAILABLE_TITLE = 'Olea could not read your sources just now.';
export const SESSION_UNAVAILABLE_BODY =
  'So there is no session to build here. This is not a claim about what you have left to study — try again in a moment.';

// ---------------------------------------------------------------------------
// F4.6 / STEER-2 (`ol-ijms`) — the "course or topic" steering control
//
// `[D-076]` round 2 names three first-class steering inputs on this one
// assembly path: the time she has (the budgets above), a course or topic to
// work on (this section), and a stated interest (`focusLine` below, from the
// gap view's lift). `courses`/`conceptIds` have carried end to end since
// STEER-1 (`olea-core`'s `study-session/compose.ts`); this is the vocabulary
// and the one honesty line the control needs.
//
// "Topic" is F2.5's own word for a concept-level filter
// (`QueueFilter.conceptIds`'s doc: "F2.5's 'topic'"), so it is used here
// verbatim rather than reintroduced as `concept` and forcing her to learn
// that the two words mean the same thing on two screens.
// ---------------------------------------------------------------------------

/**
 * One thing the control can narrow the session to. `label` is exactly what
 * is already shown elsewhere on this screen — a course code
 * (`StudySessionItem.course`) or a concept's display name
 * (`StudySessionItem.conceptName`) — never the opaque `conceptKey`
 * (`ConceptRecord.key`'s own doc: "never displayed to her", C7.11).
 * `./view.ts` only round-trips this value; `./provider.ts` is what resolves
 * a chosen `label` back into an exact `courses`/`conceptIds` entry, because
 * it is the one place holding the vault's own concept/course enumeration to
 * resolve against.
 */
export interface CourseOrTopicOption {
  readonly kind: 'course' | 'topic';
  readonly label: string;
}

/** Accessible label for the control itself — never printed as a heading (the select's own default option already says what "unset" means). */
export const COURSE_OR_TOPIC_LABEL = 'Course or topic';

/** The default option — no restriction, the same "undefined means no restriction" `SessionSteeringRequest.courses`/`conceptIds` document. */
export const COURSE_OR_TOPIC_ALL_LABEL = 'Everything';

export const COURSE_OR_TOPIC_COURSE_GROUP_LABEL = 'Courses';
export const COURSE_OR_TOPIC_TOPIC_GROUP_LABEL = 'Topics';

/**
 * The one honesty line this control needs, and the only reason it needs one
 * at all: the control is a visible `<select>`, so a choice that IS among
 * `options` already shows itself — the same reason the budget buttons never
 * get a confirming sentence. A choice that is NOT among `options` (the vault
 * changed under her — a concept was renamed, a course dropped) has nothing
 * to visually land on, so the select silently reverts to "Everything" unless
 * this says why. Mirrors {@link focusLine}'s own rule: "a request silently
 * dropped is worse than one that says it was not honoured." `null` whenever
 * nothing was asked, or the ask is still honoured.
 */
export function courseOrTopicNotFoundLine(
  selected: CourseOrTopicOption | undefined,
  options: readonly CourseOrTopicOption[],
): string | null {
  if (selected === undefined) return null;
  const stillOffered = options.some(
    (option) => option.kind === selected.kind && option.label === selected.label,
  );
  if (stillOffered) return null;
  return `Olea could not find "${selected.label}" any more, so this session is built from everything.`;
}

// ---------------------------------------------------------------------------
// F4.9 — the framing that governs every ranked surface
// ---------------------------------------------------------------------------

/**
 * Where this order came from — F4.9's first clause on this surface.
 *
 * Past tense, and the subject is her prior papers, never the assessment ahead.
 * The second half names the other input honestly: the countdown is a fact about
 * her assignments table, and it does move the order (that is F4.7), which is
 * worth saying rather than leaving her to infer.
 */
export const SESSION_ATTRIBUTION =
  'Ordered by what your past papers have asked, and by how soon each assessment falls.';

/**
 * The framing shown above any built session, in order.
 *
 * `FULL_SYLLABUS_ADVICE` is `gap/copy.ts`'s string, imported. One promise, one
 * wording, in one place — the alternative is two sentences that agree today.
 */
export function sessionFraming(): readonly string[] {
  return [SESSION_ATTRIBUTION, FULL_SYLLABUS_ADVICE];
}

// ---------------------------------------------------------------------------
// F4.7 — the countdown
// ---------------------------------------------------------------------------

/** The assessment's own file name, without folder or extension. Her words, unchanged (R1/R2) — nothing here retitles a note of hers. */
export function assessmentName(countdown: SessionAssessmentCountdown): string {
  const last = countdown.assessmentPath.split('/').pop() ?? countdown.assessmentPath;
  return last.endsWith('.md') ? last.slice(0, -3) : last;
}

/**
 * The countdown sentence (F4.7), or `null` when there is no assessment to
 * count to.
 *
 * **An unreadable date says so instead of counting.** `SessionAssessmentCountdown.
 * daysUntil` is `null` — not `0` — when the `due` field is absent or is not a
 * calendar day, and this function renders that as a sentence about the missing
 * date rather than as an urgent "today". A false deadline is the most
 * expensive small lie this surface could tell.
 */
export function countdownLine(model: Pick<StudySessionModel, 'nextAssessment'>): string | null {
  const next = model.nextAssessment;
  if (next === null) return null;
  const name = assessmentName(next);
  if (next.daysUntil === null) {
    return `Next up: ${name}. Olea could not read a date on it, so there is no countdown here.`;
  }
  if (next.daysUntil === 0) return `${name} is dated today.`;
  if (next.daysUntil === 1) return `${name} is dated tomorrow.`;
  return `${name} is dated ${next.daysUntil} days from now.`;
}

// ---------------------------------------------------------------------------
// F4.8 — format matching
// ---------------------------------------------------------------------------

/**
 * Why multiple-choice came first, or `null` when no format preference applied.
 *
 * `null` far more often than not, and that is correct rather than a gap:
 * `assessmentFormatOf` maps one assessment type (`quiz -> mcq`) and widening it
 * is a decision-bead matter, so most sessions express no preference and say
 * nothing about format at all. A sentence offered for a preference that did not
 * fire would be a reason for something that did not happen.
 */
export function formatPreferenceLine(
  model: Pick<StudySessionModel, 'formatPreference' | 'items'>,
): string | null {
  if (model.formatPreference !== 'mcq') return null;
  if (!model.items.some((item) => item.formatMatch === 'preferred-format')) return null;
  return 'Multiple-choice questions come first here, because your next assessment is a quiz.';
}

// ---------------------------------------------------------------------------
// The times, and whose estimate they are
// ---------------------------------------------------------------------------

const DURATION_BASIS_LINES: Readonly<Record<DurationModelBasis, string>> = {
  measured: 'Times are estimated from how long your own reviews have taken.',
  mixed:
    'Times are part estimated from your own reviews, part Olea’s assumption for the kinds it has not seen you do yet.',
  assumed: 'Times are Olea’s assumption — it has not seen enough of your reviews to estimate yet.',
};

/**
 * Whose estimate the minutes on this screen are.
 *
 * Three sentences for the model's three states, and the distinction is
 * load-bearing rather than pedantic: two of the three durations behind a
 * cold-start session are constants nobody measured (`duration.ts`'s own
 * doc says so outright), and presenting those as "about eighteen minutes"
 * without qualification is a measurement claim Olea has not earned.
 */
export function durationBasisLine(model: Pick<StudySessionModel, 'durationBasis'>): string {
  return DURATION_BASIS_LINES[model.durationBasis];
}

/** Whole minutes, rounded up, of a duration in seconds — never "0 minutes" for work that exists. */
export function minutesLabel(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? '1 min' : `${minutes} min`;
}

// ---------------------------------------------------------------------------
// The session itself
// ---------------------------------------------------------------------------

const INSTRUMENT_TYPE_LABELS: Readonly<Record<StudySessionItem['instrumentType'], string>> = {
  qa: 'question and answer',
  cloze: 'fill in the blank',
  mcq: 'multiple choice',
};

export function instrumentTypeLabel(instrumentType: StudySessionItem['instrumentType']): string {
  return INSTRUMENT_TYPE_LABELS[instrumentType];
}

/** One item's line: what it practises, in what shape, and roughly how long. */
export function sessionItemLine(item: StudySessionItem): string {
  return `${instrumentTypeLabel(item.instrumentType)} · about ${minutesLabel(item.estimatedSeconds)}`;
}

/**
 * The one-line summary of what was built.
 *
 * Reports the count and the time and stops. It does not congratulate her on
 * the session and it does not say the session is enough — the first is noise
 * and the second is a claim F4.9's full-syllabus clause forbids.
 */
export function sessionSummaryLine(
  model: Pick<StudySessionModel, 'items' | 'plannedSeconds' | 'budgetMinutes'>,
): string {
  const n = model.items.length;
  const instruments = n === 1 ? '1 instrument' : `${n} instruments`;
  return `${instruments}, about ${minutesLabel(model.plannedSeconds)} of the ${model.budgetMinutes} you asked for.`;
}

/**
 * What she asked to start from, when the gap view's `build-session` affordance
 * sent her here. `null` when the session was built from the whole ranking, and
 * a distinct sentence when the concept could not be found — a request silently
 * dropped is worse than one that says it was not honoured.
 */
export function focusLine(
  model: Pick<StudySessionModel, 'focusConcept' | 'items' | 'leftOut'>,
): string | null {
  const focus = model.focusConcept;
  if (focus === null) return null;
  const honoured =
    model.items.some((item) => item.conceptName === focus) ||
    model.leftOut.some((omission) => omission.conceptName === focus);
  return honoured
    ? `Started from ${focus}.`
    : `Olea could not find ${focus} in the current ranking, so this session is built from the whole of it.`;
}

// ---------------------------------------------------------------------------
// F6.7 — new (unmet) material named by source, never by count (`[D-060]`;
// `ol-0r92.9`)
// ---------------------------------------------------------------------------

/**
 * Every source worth mentioning for material this session includes that she
 * has not yet met — F6.4's own clause on this exact screen: "where the
 * session includes material Olea has built since she last studied, it says
 * where it came from ... and never how much of it there is."
 * `newMaterialSourceLines` (`../today/copy.js`) is the shared primitive; this
 * is only the `StudySessionModel` -> `StudySessionItem[]` plumbing so the
 * caller never has to know the field is `model.items`.
 */
export function newMaterialLines(model: Pick<StudySessionModel, 'items'>): readonly string[] {
  return newMaterialSourceLines(model.items);
}

// ---------------------------------------------------------------------------
// What was left out — information, not a verdict
// ---------------------------------------------------------------------------

function countOf(
  omissions: readonly StudySessionOmission[],
  test: (o: StudySessionOmission) => boolean,
): number {
  return omissions.filter(test).length;
}

/**
 * What the session does not contain, and why — one line per reason, counts
 * only.
 *
 * This is `ol-cvsc`'s rule applied one screen over: a shortened list she cannot
 * see the edge of is a claim about her material that nothing established. The
 * three reasons stay three sentences because their consequences differ — a
 * longer session fixes the first, drafting instruments fixes the second, and
 * the third is already handled.
 */
export function leftOutLines(model: StudySessionModel): readonly string[] {
  if (model.leftOut.length === 0) return [];
  const lines: string[] = [];

  const didNotFit = countOf(model.leftOut, (o) => o.reason === 'did-not-fit');
  if (didNotFit > 0) {
    lines.push(
      didNotFit === 1
        ? `1 more ranked concept did not fit in ${model.budgetMinutes} minutes.`
        : `${didNotFit} more ranked concepts did not fit in ${model.budgetMinutes} minutes.`,
    );
  }

  const noInstruments = countOf(
    model.leftOut,
    (o) => o.reason === 'no-instruments' && o.gapClass === 'coverage-gap',
  );
  if (noInstruments > 0) {
    lines.push(
      noInstruments === 1
        ? '1 has notes but no instruments yet, so there was nothing to practise.'
        : `${noInstruments} have notes but no instruments yet, so there was nothing to practise.`,
    );
  }

  const noMaterial = countOf(
    model.leftOut,
    (o) => o.reason === 'no-instruments' && o.gapClass === 'material-gap',
  );
  if (noMaterial > 0) {
    lines.push(
      noMaterial === 1
        ? '1 is named by your past papers and is not in your materials.'
        : `${noMaterial} are named by your past papers and are not in your materials.`,
    );
  }

  const otherNoInstruments = countOf(
    model.leftOut,
    (o) => o.reason === 'no-instruments' && o.gapClass === 'mastery-gap',
  );
  if (otherNoInstruments > 0) {
    lines.push(
      otherNoInstruments === 1
        ? '1 has instruments Olea could not reach on this pass.'
        : `${otherNoInstruments} have instruments Olea could not reach on this pass.`,
    );
  }

  const already = countOf(model.leftOut, (o) => o.reason === 'already-in-session');
  if (already > 0) {
    lines.push(
      already === 1
        ? '1 is already covered by an instrument in this session.'
        : `${already} are already covered by instruments in this session.`,
    );
  }

  return lines;
}

// ---------------------------------------------------------------------------
// The two emptinesses, which are not the same sentence
// ---------------------------------------------------------------------------

/**
 * What the screen says when the session has no items.
 *
 * **Two states, deliberately not one.** "Olea has nothing ranked" is a
 * statement about what the pipeline read; "nothing fits in twenty minutes" is
 * a statement about the budget. `StudySessionModel.consideredRowCount` is the
 * field that tells them apart, and it exists for exactly this branch — the
 * same distinction `gap/copy.ts` draws between "we read and found nothing" and
 * "we read nothing". Returning a bare "no session" for both is unreachable
 * through this function.
 */
export function emptySessionLines(model: StudySessionModel): readonly string[] {
  if (model.items.length > 0) return [];
  if (model.consideredRowCount === 0) {
    return [
      'Olea has nothing ranked to build a session from yet.',
      'That is a statement about what it has read of your past papers, not about what you have left to study.',
    ];
  }
  return [
    `Nothing that Olea has instruments for fits in ${model.budgetMinutes} minutes.`,
    'A longer session, or instruments for the concepts below, would give it something to work with.',
  ];
}

/**
 * The whole screen's non-item copy, in render order.
 *
 * The view renders items itself (it needs per-item elements), and everything
 * else comes from here — so "the framing is present wherever a session is
 * shown" is a property of this function rather than of a caller's diligence.
 */
export function sessionScreenCopy(model: StudySessionModel): readonly string[] {
  const lines: string[] = [];
  if (model.items.length > 0) lines.push(sessionSummaryLine(model));
  lines.push(...emptySessionLines(model));
  // F6.7 — named right beside what was built, never as a count of it.
  lines.push(...newMaterialLines(model));

  const focus = focusLine(model);
  if (focus !== null) lines.push(focus);

  lines.push(...sessionFraming());

  const countdown = countdownLine(model);
  if (countdown !== null) lines.push(countdown);

  const format = formatPreferenceLine(model);
  if (format !== null) lines.push(format);

  if (model.items.length > 0) lines.push(durationBasisLine(model));
  lines.push(...leftOutLines(model));

  return lines;
}

// ---------------------------------------------------------------------------
// F6.6 — re-entry composition after an absence (`ol-v7r5.18`, discovered from
// `ol-blwb` / `[BKLG-1]`). `composeReentrySession`'s own `view` field
// (`ReentryStudySessionView`, `olea-core`) already omits
// `leftOutInstrumentCount`/`consideredRowCount` structurally, so this screen
// cannot render them by accident — but F6.6's ban is wider than those two
// fields: `leftOutLines` above is built from `model.leftOut` directly (never
// the two omitted counts) and would still render a count of what did not fit,
// which on a re-entry screen specifically IS the accumulated-backlog count
// the clause forbids "in any position." So `reentryScreenCopy` below is a
// SEPARATE composition, not `sessionScreenCopy` run over a narrower type —
// it deliberately never calls `leftOutLines` or `emptySessionLines` (the
// second also because it needs `consideredRowCount`, which the type does not
// have). Everything else `sessionScreenCopy` says is still true and still
// said: F4.9's framing, F6.7's by-source material lines, the countdown, the
// format preference and the duration basis all carry over unchanged, via the
// same functions — each narrowed above to a `Pick<StudySessionModel, ...>`
// of only the fields it actually reads, which is what lets
// `ReentryStudySessionView` (missing two fields) satisfy them without a
// second copy of each function's logic.
// ---------------------------------------------------------------------------

/**
 * F6.6's second named scenario: "what accumulated remains available and is
 * never described as lost or expired." States the fact plainly and stops —
 * no "backlog", no "catch up", no word for loss at all, because the whole
 * point is that nothing was lost. Always shown on a re-entry screen, never
 * conditionally, because it is true of every re-entry session by
 * construction (F6.6: the ordinary selection rule run at fewer slots is what
 * makes "everything else is still scheduled" a fact rather than a promise).
 */
export const REENTRY_STILL_AVAILABLE_LINE =
  'Everything else is still here, still scheduled, exactly as it was before.';

/**
 * The re-entry screen's empty state — `ReentryStudySessionView` has no
 * `consideredRowCount` to distinguish "nothing ranked" from "nothing fit the
 * budget" the way `emptySessionLines` does for an ordinary session, but
 * `REENTRY_SIZE_FLOOR_MINUTES`'s own doc means that distinction cannot arise
 * here in practice — the floor exists precisely so a re-entry budget can
 * always seat at least a handful of instruments when anything is ranked, so
 * an empty re-entry session can only mean the ranking itself had nothing.
 */
export function reentryEmptyLines(view: Pick<ReentryStudySessionView, 'items'>): readonly string[] {
  if (view.items.length > 0) return [];
  return [
    'Olea has nothing ready to build a session from right now.',
    'That is a statement about what it could read just now, not about what you have left to study.',
  ];
}

/**
 * The whole re-entry screen's non-item copy, in render order — F6.6's
 * counterpart to `sessionScreenCopy`. See the section doc above for why this
 * is a separate composition rather than a call into `sessionScreenCopy`.
 */
export function reentryScreenCopy(view: ReentryStudySessionView): readonly string[] {
  const lines: string[] = [];
  if (view.items.length > 0) lines.push(sessionSummaryLine(view));
  lines.push(...reentryEmptyLines(view));
  lines.push(REENTRY_STILL_AVAILABLE_LINE);
  // F6.7 — named right beside what was built, never as a count of it.
  lines.push(...newMaterialLines(view));

  const focus = focusLine(view);
  if (focus !== null) lines.push(focus);

  lines.push(...sessionFraming());

  const countdown = countdownLine(view);
  if (countdown !== null) lines.push(countdown);

  const format = formatPreferenceLine(view);
  if (format !== null) lines.push(format);

  if (view.items.length > 0) lines.push(durationBasisLine(view));

  return lines;
}

// ---------------------------------------------------------------------------
// [D-162]: a fresh session that replaced one that just went stale
// ---------------------------------------------------------------------------

/**
 * One clause per {@link SittingStalenessReason} — always in the reporting
 * voice C5.8 tests for: the tool finishing "your list changed because...",
 * never a verdict on her and never framed as loss. No forbidden vocabulary
 * (`Olea_vocabulary_registry.md`), no "delete", no apology — the previous
 * sitting's completed reviews already kept their outcomes; this line only
 * explains why the remainder is a fresh list rather than the old one
 * continuing.
 */
const STALE_REASON_CLAUSES: Record<SittingStalenessReason, string> = {
  'items-due-in-scope': 'new items came due in one of its courses',
  'material-arrived-in-scope': 'new material arrived in its scope',
  'assessment-proximity-band-crossed-in-scope': 'an assessment it was built around moved closer',
};

/**
 * `[D-162]`'s own honesty test applied verbatim: "your list changed because
 * ...", finished with every material-change kind that actually fired,
 * joined in fixed order. Reviews she already finished keep their outcomes —
 * this sentence is only ever shown beside the fresh remainder, never framed
 * as anything of hers being lost.
 */
export function sittingStaleReasonLine(reasons: readonly SittingStalenessReason[]): string {
  const clauses = reasons.map((reason) => STALE_REASON_CLAUSES[reason]);
  return `Your list changed because ${clauses.join(', and ')}.`;
}

// ---------------------------------------------------------------------------
// The enumeration David reviews, and the F4.9 audit runs over
// ---------------------------------------------------------------------------

/**
 * Every fixed string and label this module can produce.
 *
 * Derived sentences are not enumerable in the abstract, so `copy.spec.ts`
 * exercises those against representative models and audits the results with the
 * same rules — `ol-f49h`'s point stands here as it does for the gap view: the
 * list is where strings are recorded, not where they are checked.
 */
export function allSessionBuilderStrings(): readonly string[] {
  return [
    SESSION_VIEW_TITLE,
    SESSION_UNAVAILABLE_TITLE,
    SESSION_UNAVAILABLE_BODY,
    SESSION_ATTRIBUTION,
    FULL_SYLLABUS_ADVICE,
    ...Object.values(DURATION_BASIS_LINES),
    ...Object.values(INSTRUMENT_TYPE_LABELS),
    ...SESSION_BUDGET_OPTIONS.map(budgetOptionLabel),
    // --- F6.6 — re-entry composition after an absence (`ol-v7r5.18`) ---
    REENTRY_STILL_AVAILABLE_LINE,
    ...reentryEmptyLines({ items: [] }),
    // --- STEER-2 (`ol-ijms`) — the "course or topic" control's fixed strings.
    // `courseOrTopicNotFoundLine`'s derived sentence is exercised by
    // `copy.spec.ts`'s own `everyProducibleString()`, same as `focusLine`/
    // `countdownLine` above — this inventory is fixed strings only, per this
    // module's own doc.
    COURSE_OR_TOPIC_LABEL,
    COURSE_OR_TOPIC_ALL_LABEL,
    COURSE_OR_TOPIC_COURSE_GROUP_LABEL,
    COURSE_OR_TOPIC_TOPIC_GROUP_LABEL,
  ];
}
