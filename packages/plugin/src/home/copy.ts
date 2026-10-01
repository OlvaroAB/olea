/**
 * Every user-facing string `HomeView` can render (F6.10, `[D-223]`,
 * `ol-l5og.21` [HOME-2]).
 *
 * One vocabulary site, same convention `today/copy.ts`/`grove/copy.ts` hold
 * for their own screens — `test/home/copy.spec.ts` asserts over
 * `allHomeStrings()`.
 *
 * **F6.10 supersedes this module's own pre-`[D-223]` scope.** The prior
 * version of this file (`ol-0r92.17`) carried only the standing retrospective
 * offer's two button labels plus two status lines, because `HomeView` hosted
 * nothing else — its own module doc explains why at length, and `[D-223]`
 * is the ruling that closes the question it deferred. What follows is the
 * landing dashboard's copy: the composed-session headline is rendered
 * through `../session-builder/copy.ts`'s own functions (imported, never
 * duplicated — see `../home/view.ts`'s module doc), so this module supplies
 * only the copy that is NEW to Home: the panel chrome, the per-course scope
 * line and the three quiet-line kinds this bead's own computation can
 * honestly produce.
 *
 * **F8.3's ban applies here too**: no percentage, ratio or single completion
 * figure. `homeScopeGrewLine` names a document and a count, never their
 * quotient — the same "two facts, never their quotient" shape
 * `../grove/copy.ts#groveScopeCorrectionReceiptLine` already holds to, since
 * this module's growth receipt is that function's mirror image (see
 * `./scope-growth-store.ts`'s own doc).
 *
 * **What F6.10 names that this module does NOT attempt, and why.** The
 * clause lists five quiet-line kinds: scope grew, a course set up and
 * waiting, an archive proposal for a quiet course (C7.8), offline
 * degradation (F7.8), and the standing retrospective offer (F8.8). Only the
 * first, second and last have a real computation to read from as of this
 * bead — no archive capability exists anywhere in this codebase yet (a grep
 * across `packages/plugin/src` and `packages/core/src` for anything
 * archive-shaped returns nothing but an unrelated ingestion-sink comment),
 * and no LIVE Worker-reachability signal is reachable from this view (only a
 * static settings-pane statement exists, `../settings/degradation-
 * statement.ts`, which is not "is the connection up right now"). Building
 * either honestly means new computation outside `home/`'s owned paths, which
 * is exactly the trap this view's own predecessor module doc named and
 * refused — so both are left out here and named on this bead's close
 * evidence as follow-up work, rather than approximated with a guess.
 *
 * **`[D-382]`/`[D-331]` (`ol-egov.141.89.10.64`, F2.22).** While a session is active in the
 * shared holder, `HOME_OFFER_EYEBROW` moves onto a new active-session block above the ordinary
 * offer card (`./view.ts`'s `renderActiveSession`) — see that eyebrow's own doc for why, and
 * `HOME_NEXT_SESSION_EYEBROW`'s doc for what replaces it on the ordinary card. Both blocks render
 * their sentence through the SAME `sessionCompositionSentence` below; this bead adds no second
 * wording rule, only a second caller of the one function F2.22 already governs.
 */

import type { EmptyRankingReason } from 'olea-contracts';
import type { VaultPath } from 'olea-core';

export const HOME_VIEW_TITLE = 'Home';

export const HOME_UNAVAILABLE = 'Olea could not read your vault just now.';

export const OPEN_RETROSPECTIVE_ACTION = 'Open';

export const DISMISS_OFFER_ACTION = 'Not now';

/**
 * The composed-session card's own eyebrow (kit: `docs/design/pass7-home-
 * and-history`, `Pass7Kit.jsx#Offer`'s `HostEyebrow`, "Today's session"
 * verbatim) — a label over F6.4's headline, not a new claim, the same
 * "label an existing pair, invent nothing" convention
 * `../session-builder/copy.ts#SESSION_WHY_THESE_LABEL` already documents for
 * its own eyebrow.
 */
export const HOME_OFFER_EYEBROW = "Today's session";

/**
 * `[D-382]` (ruled 2026-09-25; `ol-egov.141.89.10.64`, `F2.22`). While a session is active in
 * the shared holder, `HOME_OFFER_EYEBROW` moves to the new active-session block above (`./
 * view.ts`'s `renderActiveSession`) — that block states the frozen session's own explanation,
 * read from the persisted composition snapshot (`[D-331]`), never Home's own live recompute.
 * This eyebrow then labels the ordinary offer card instead, since what it still shows (Home's
 * own live preview, driven by the steering inputs) is no longer today's already-frozen session —
 * it is a preview of what pressing Start now would compose next, and D-382's own ruling is that
 * it "may differ" from the active session's frozen explanation. Plain language throughout
 * (vocabulary registry §8: `session` is the ratified word, `next` is ordinary English); no olive
 * noun is coined, matching this module's own restraint elsewhere.
 */
export const HOME_NEXT_SESSION_EYEBROW = 'Next session';

/**
 * The composed-session card's one action. **Amended by `[D-243]`
 * (`ol-egov.132.7` [SESS-8.7]):** this used to open the session-builder
 * screen for the full F4.9 reasoning, the countdown and the left-out lines;
 * F4.6/F6.10 as amended rule "there is no builder screen to pass through" —
 * Start now sits the composed session directly, and everything that used to
 * live only on the builder screen (the reasoning, the countdown, the
 * left-out lines) renders right here on Home instead, via the same
 * `../session-builder/copy.ts` functions this module already imports for the
 * headline.
 */
export const HOME_START_ACTION = 'Start';

/**
 * F4.6's third steering input ("a stated interest — the thing she feels like
 * doing today"), shown beside the sentence naming it
 * (`../session-builder/copy.ts#focusLine`, never re-worded here) whenever
 * the gap view's `build-session` affordance has pre-filled one. The one new
 * control that pre-fill needs on Home that it never needed on the
 * session-builder screen: a way to drop it without leaving Home, now that
 * Home is where she steers rather than a second screen (`[D-243]`).
 */
export const HOME_CLEAR_FOCUS_ACTION = 'Clear';

/** `HomePanel`'s own title (kit verbatim, `Pass7Home.jsx`'s `"Where each course stands"`). */
export const HOME_COURSES_PANEL_TITLE = 'Where each course stands';

/** `HomePanel`'s own note under the ordinary-morning state (kit verbatim). */
export const HOME_COURSES_PANEL_NOTE = 'one mark per concept, in the state it is in';

/**
 * The panel's own link onto the multi-course grove browse (kit verbatim,
 * `Pass7Home.jsx`'s `right="Open the term"`) — F8.1's already-registered
 * `GroveView` renders every running course's own grove in one tab, which is
 * exactly what "the term" names; no new surface, only a navigation link onto
 * one that already exists.
 */
export const HOME_OPEN_TERM_ACTION = 'Open the term';

/** A course row with no examiner-declared denominator (kit verbatim, `Pass7Kit.jsx#CourseRow`'s fallback span). */
export const HOME_SCOPE_NOT_DECLARED = 'scope not declared';

/**
 * F6.10's "a course whose scope no document has yet declared draws no map
 * and says so" — the sentence that fills the map area instead, for a course
 * `GroveCourseModel` reports as `'inferred'` or `'no-registered-source'`.
 */
export const HOME_NO_MAP_DRAWN =
  'No objectives document or past paper registered yet — nothing to draw.';

/**
 * F6.10's "a course set up and waiting for material" quiet line — shown
 * only for a `'no-registered-source'` course (F8.1's own designed empty
 * state, `../grove/copy.ts#GROVE_NO_SOURCE_*`), never phrased as a fault.
 */
export const HOME_SET_UP_WAITING = 'Set up, waiting for material to arrive.';

/**
 * `[D-408]` (`ol-egov.141.89.10.85`, F6.10) — the quiet line for a course whose cached study
 * plan carries `status: 'ranked'` with an empty `concepts` array and
 * `emptyReason: 'every-assessment-passed'` (`packages/contracts/src/study-plan.ts`): every one of
 * the course's concepts was vetoed on date grounds alone — it has run out of future assessments
 * to be tested on, not stuck or broken. Registered wording
 * (`docs/Olea_vocabulary_registry.md` §26; David's 2026-09-27 sign-off,
 * `docs/design/copy-pass-2026-09/home-start-nothing-to-practise.md` candidate A) — never
 * paraphrased at the call site. **Start has no separate screen to carry its own wording**:
 * `[D-243]` folded Start into sitting the composed session directly on Home, so this same line,
 * on this same row, is what "Start" in this bead's own title resolves to as well.
 */
export const HOME_EVERY_ASSESSMENT_PASSED_LINE =
  "Every assessment for this course has passed — there's nothing to practise here right now.";

/**
 * `[D-408]`'s sibling line, for `emptyReason: 'nothing-to-practise'`: at least one vetoed concept
 * carries `[D-404]`'s eligibility veto instead (every remaining practice instrument on that
 * concept suspended, withdrawn, missing its note, or pending revalidation) — the more specific,
 * more actionable fact, so `../core/src/plan/build.ts#emptyRankingReasonFor` prefers it over
 * `'every-assessment-passed'` whenever both could apply. Points at the registry (F8.4, §23's
 * "Withheld" vocabulary) rather than re-deriving the specific per-instrument cause here, so the
 * two surfaces cannot drift apart. Registered wording (`docs/Olea_vocabulary_registry.md` §26;
 * David's 2026-09-27 sign-off, same source file, candidate A).
 */
export const HOME_NOTHING_TO_PRACTISE_LINE =
  'Nothing in this course is eligible to practise right now — check the registry to see why.';

/**
 * Maps `[D-408]`'s contract enum onto the one registered sentence for each reason — the single
 * place that translation happens, so a caller building a `HomeQuietLine` (`./view.ts`) never
 * paraphrases or re-derives which reason gets which words.
 */
export function emptyRankingQuietLine(reason: EmptyRankingReason): string {
  return reason === 'every-assessment-passed'
    ? HOME_EVERY_ASSESSMENT_PASSED_LINE
    : HOME_NOTHING_TO_PRACTISE_LINE;
}

/**
 * F6.10's "scope grew and by which document" quiet line — the mirror image
 * of `../grove/copy.ts#groveScopeCorrectionReceiptLine`, which states a
 * FALL. States two facts and stops: the document that was registered, and
 * the count it added — never a percentage, never a judgement ("this grew"
 * is a fact, not praise; F1.5(c) already treats a growing denominator as
 * unremarkable, so this sentence only names what changed).
 *
 * The caller is responsible for calling this ONLY when a growth actually
 * happened (`./scope-growth-store.ts#homeScopeGrowthReceiptFor` already
 * gates that) — this function states whatever numbers it is given rather
 * than re-deciding direction, matching `groveScopeCorrectionReceiptLine`'s
 * own "never re-derive, only render" posture.
 */
export function homeScopeGrewLine(addedDocumentPath: VaultPath, addedCount: number): string {
  const conceptNoun = addedCount === 1 ? 'concept' : 'concepts';
  return `Scope grew: ${addedDocumentPath} added ${addedCount} ${conceptNoun}.`;
}

/**
 * F2.22 / F6.4 (`ol-egov.141.89.10.19`) — the ONE composition sentence: which
 * course, and why. BOTH surfaces F2.22 binds — Home (`./view.ts`) and the
 * review session (`../review/view.ts`) — call this exact function so the two
 * can never independently paraphrase the same reason (F2.22's "same
 * statement... never two independently computed accounts").
 *
 * **It names the course (`[D-417]`, ruled 2026-09-28, `ol-egov.141.89.10.92`).**
 * `focusReason` is `ComposedStudySession.focusReason` — for the preview, and
 * for the active session through `../session/composition-recorder.ts`'s
 * `explainActiveSession`, which passes the frozen composition's own through —
 * i.e. `olea-core`'s `study-session/compose.ts#focusReasonFor(branch, course)`,
 * the branch's sentence with the course's own name in it (the name Home's
 * course rows show). The record's `recordedFocusReason` reads the same two
 * facts to the same string. The wording is `FOCUS_BRANCH_TEMPLATE`'s, PROPOSED through the
 * copy pass (`docs/design/copy-pass-2026-09/planning-sentences.md`, service
 * repo) and never re-worded here. This function only punctuates: the course
 * name leads the sentence and is never re-cased, since a course id is shown
 * exactly as it is everywhere else. The earlier "this course" rendering is
 * superseded: on a screen that shows several courses it left her to infer
 * which.
 *
 * **Transitional.** A course-less fragment (the deprecated
 * `FOCUS_BRANCH_SENTENCE`, which no production path produces any more but
 * test fixtures still pass) is rendered the old way rather than as a bare
 * "because ..." clause. Remove this branch with that map.
 */
export function sessionCompositionSentence(focusReason: string): string {
  if (focusReason.startsWith('this course') || focusReason.startsWith('because')) {
    const withLeadIn = focusReason.startsWith('this course')
      ? focusReason
      : `this course ${focusReason}`;
    return `${withLeadIn.charAt(0).toUpperCase()}${withLeadIn.slice(1)}.`;
  }
  return `${focusReason}.`;
}

/**
 * Every course-why sentence as `sessionCompositionSentence` renders it for a fixture course, for
 * `allHomeStrings`' honesty checks: each decider, without and then with the never-practised
 * sentence (rows 28 to 34 and 49, `ol-egov.141.89.10.92`). Mirrors `olea-core`'s
 * `FOCUS_BRANCH_TEMPLATE` word for word (PROPOSED where the ruling gave no exact words); this
 * module imports nothing at runtime (a plain Node harness loads it from source), so the mirror
 * cannot be an import; `olea-core`'s `compose.spec.ts` reads this file and pins every string to
 * the template.
 */
export const COURSE_WHY_SENTENCE_EXAMPLES: readonly string[] = [
  'TESTC101, because you asked for it',
  'TESTC101, because its assessment is close and the assessed material still needs work',
  "TESTC101, because its assessment is close and Olea hasn't checked your recall of some assessed material yet",
  'TESTC101, because it has had less than its planned share of recent practice',
  'TESTC101, because it is the only course with something to practise right now',
  'TESTC101, because all courses with practice ready have reached their planned share, and this one is closest to its share',
  'TESTC101, because it is level with another course on planned share, and you have gone longer without it',
  'TESTC101, because it is level with another course on planned share, so it comes first by name',
  'TESTC101, because other courses have had less than their planned share of recent practice, but Olea has nothing ready to practise in them yet',
  'TESTC101, because you have gone longest without practising it',
  'TESTC101, because you have gone equally long without another course, so it comes first by name',
  "TESTC101 is selected next, because you asked for it. You haven't practised this course in Olea yet",
  "TESTC101 is selected next, because its assessment is close and the assessed material still needs work. You haven't practised this course in Olea yet",
  "TESTC101 is selected next, because its assessment is close and Olea hasn't checked your recall of some assessed material yet. You haven't practised this course in Olea yet",
  "TESTC101 is selected next, because it has had less than its planned share of recent practice. You haven't practised this course in Olea yet",
  "TESTC101 is selected next, because it is the only course with something to practise right now. You haven't practised this course in Olea yet",
  "TESTC101 is selected next, because all courses with practice ready have reached their planned share, and this one is closest to its share. You haven't practised this course in Olea yet",
  "TESTC101 is selected next, because it is level with another course on planned share, and you have gone longer without it. You haven't practised this course in Olea yet",
  "TESTC101 is selected next, because it is level with another course on planned share, so it comes first by name. You haven't practised this course in Olea yet",
  "TESTC101 is selected next, because other courses have had less than their planned share of recent practice, but Olea has nothing ready to practise in them yet. You haven't practised this course in Olea yet",
  "TESTC101 is selected next, because you have gone longest without practising it. You haven't practised this course in Olea yet",
  "TESTC101 is selected next, because you have gone equally long without another course, so it comes first by name. You haven't practised this course in Olea yet",
].map(sessionCompositionSentence);

/** Every string this module can render, for `test/home/copy.spec.ts`'s honesty checks. */
export function allHomeStrings(): readonly string[] {
  return [
    HOME_VIEW_TITLE,
    HOME_UNAVAILABLE,
    OPEN_RETROSPECTIVE_ACTION,
    DISMISS_OFFER_ACTION,
    HOME_OFFER_EYEBROW,
    HOME_NEXT_SESSION_EYEBROW,
    HOME_START_ACTION,
    HOME_CLEAR_FOCUS_ACTION,
    HOME_COURSES_PANEL_TITLE,
    HOME_COURSES_PANEL_NOTE,
    HOME_OPEN_TERM_ACTION,
    HOME_SCOPE_NOT_DECLARED,
    HOME_NO_MAP_DRAWN,
    HOME_SET_UP_WAITING,
    HOME_EVERY_ASSESSMENT_PASSED_LINE,
    HOME_NOTHING_TO_PRACTISE_LINE,
    emptyRankingQuietLine('every-assessment-passed'),
    emptyRankingQuietLine('nothing-to-practise'),
    homeScopeGrewLine('03 Research/Objectives.md', 3),
    ...COURSE_WHY_SENTENCE_EXAMPLES,
  ];
}
