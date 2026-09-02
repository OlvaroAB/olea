/**
 * The standing offer card's computation (F8.8, `[D-134]` Q1: "offered from
 * Home and the grove... one standing card that stays visible until opened
 * or dismissed").
 *
 * **Mounted in both ruled hosts as of `ol-0r92.17` (round 27):** `../home/`
 * and `../grove/` each render `resolveOfferCards`'s output (the grove
 * filtered per course), so the paragraph below is the historical record of
 * why this shipped unmounted, kept for the reasoning, not the current state.
 *
 * **Not mounted anywhere as of this bead (`ol-r68l`), and here is why, honestly.**
 * D-134 names two hosts — Home and the course grove (F8.1). Neither exists
 * as a plugin view today: `packages/plugin/src` has no `home/` directory at
 * all, and F8.1's grove is core-computation-only (`packages/core/src/
 * concept/size.ts` and friends) with no `VIEW_TYPE_OLEA_*` view built over
 * it yet — confirmed by grepping every registered view in `main.ts`
 * (review, today, gap, session-builder, bulk-review; no grove, no home).
 * DSN-2's own kit named this the question that "actually gates the build"
 * (`docs/design/dsn2-retrospective/NOTES.md` §6, olea-service), and it
 * remains open after this bead: building either surface is a whole
 * component in its own right, well outside `ol-r68l`'s owned paths
 * (`packages/plugin/src/retrospective/`, `main.ts`) and outside a single
 * bead's reasonable scope. The standing rule "no user-visible affordance
 * without a clause" cuts the other way too — inventing a THIRD host (a
 * status-bar item, a `Notice`) that D-134 never named would repeat exactly
 * the mistake `check-surface-register.mjs`'s own module doc warns about
 * (the withdrawn `ol-odb0` draft-command incident).
 *
 * So this module ships the computation ready to be called — `resolveOffer
 * Cards` below — and `ol-r68l`'s close evidence names the two follow-up
 * beads a Home view and a grove view would each need to call it from. The
 * one honestly-reachable door onto the retrospective until then is the F7.7
 * command (`commands/ids.ts`'s `OLEA_COMMAND_RETROSPECTIVE_OPEN`), which
 * `main.ts` wires to a real, working view regardless of where the standing
 * card eventually lives.
 *
 * **`resolveOfferCards` stays read-only; `unrecordedOfferedAssessmentPaths`
 * below is its write-side counterpart (`ol-0r92.26`).** D7.1, as amended by
 * `[D-178]`, authorises the `retrospective-offered` review-log kind, which
 * had no production writer before this bead — a gap `ol-0r92.26` found
 * because only tests appended it. `../home/provider.ts` and
 * `../grove/provider.ts` both call this function at render time to learn
 * which currently-showing cards are still unlogged, then hand the result to
 * `./offer-events.ts`'s `recordOfferedEvents` to do the actual write —
 * keeping this module pure, the same discipline `resolveOfferCards` itself
 * already holds to.
 */

import {
  type AssessmentRecord,
  hasAssessmentPassed,
  type RetrospectiveOfferEvent,
  resolveRetrospectiveOfferStatus,
} from 'olea-core';
import { offerCardLine } from './copy.js';

export interface RetrospectiveOfferCard {
  readonly assessmentPath: AssessmentRecord['path'];
  readonly course: string;
  readonly line: string;
}

/**
 * Every standing offer card that should currently show, across every
 * assessment — a future Home view would render all of them; a future
 * grove view would filter to its own course. Never more than one card per
 * assessment, and never a card for an assessment that has not passed, is
 * already opened, or is already dismissed (`resolveRetrospectiveOfferStatus`
 * carries all three exclusions).
 */
export function resolveOfferCards(
  assessments: readonly AssessmentRecord[],
  offerEvents: readonly RetrospectiveOfferEvent[],
  now: Date,
): readonly RetrospectiveOfferCard[] {
  const cards: RetrospectiveOfferCard[] = [];
  for (const assessment of assessments) {
    const passed = hasAssessmentPassed(assessment.due, now);
    const status = resolveRetrospectiveOfferStatus(offerEvents, assessment.path, passed);
    const course = assessment.course ?? 'Unassigned';
    const line = offerCardLine(status, course);
    if (line !== null) cards.push({ assessmentPath: assessment.path, course, line });
  }
  return cards;
}

/**
 * Which of `cards` have never had a `retrospective-offered` event recorded
 * (`ol-0r92.26`; D7.1, kind authorised by `[D-178]`). `cards` already IS
 * "currently showing, status `'offered'`" — `resolveOfferCards`' own doc,
 * `offerCardLine`'s `status !== 'offered'` guard — so this needs no second
 * status computation; it only asks which of those already-showing
 * assessments' offers are still unlogged, from the same `offerEvents` array
 * `resolveOfferCards` read. Pure, like that function: a host calls this at
 * render time and hands the result to `./offer-events.ts`'s
 * `recordOfferedEvents` to do the actual write, exactly once per
 * assessment rather than once per render.
 */
export function unrecordedOfferedAssessmentPaths(
  cards: readonly RetrospectiveOfferCard[],
  offerEvents: readonly RetrospectiveOfferEvent[],
): readonly RetrospectiveOfferCard['assessmentPath'][] {
  const alreadyRecorded = new Set(
    offerEvents
      .filter((event) => event.kind === 'retrospective-offered')
      .map((event) => event.assessmentPath),
  );
  return cards.map((card) => card.assessmentPath).filter((path) => !alreadyRecorded.has(path));
}
