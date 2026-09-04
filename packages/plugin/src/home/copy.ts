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
 */

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
 * The composed-session card's one action (F4.6's own destination): opens the
 * session builder, where the full F4.9 reasoning, the countdown and the
 * left-out lines already live — Home renders the headline and the two F4.9
 * framing sentences (via `../session-builder/copy.ts#sessionFraming`) and
 * points here for the rest, rather than re-rendering that whole screen a
 * second time on the landing surface.
 */
export const HOME_START_ACTION = 'Start';

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

/** Every string this module can render, for `test/home/copy.spec.ts`'s honesty checks. */
export function allHomeStrings(): readonly string[] {
  return [
    HOME_VIEW_TITLE,
    HOME_UNAVAILABLE,
    OPEN_RETROSPECTIVE_ACTION,
    DISMISS_OFFER_ACTION,
    HOME_OFFER_EYEBROW,
    HOME_START_ACTION,
    HOME_COURSES_PANEL_TITLE,
    HOME_COURSES_PANEL_NOTE,
    HOME_OPEN_TERM_ACTION,
    HOME_SCOPE_NOT_DECLARED,
    HOME_NO_MAP_DRAWN,
    HOME_SET_UP_WAITING,
    homeScopeGrewLine('03 Research/Objectives.md', 3),
  ];
}
