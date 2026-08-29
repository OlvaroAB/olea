/**
 * Accepted explain-back's presence inside a composed session (F2.14/F2.14a,
 * F2.21; `[D-126]`; `ol-2jod.16`).
 *
 * ## Why this is a separate shape, not a fourth `StudySessionItem`
 *
 * `StudySessionItem` (`./build.js`) is what `buildStudySession`'s greedy fill
 * chooses: a prefix of `GapRow`-ranked candidates, ordered by `gapScore` (or
 * SESS-2's obligation order), each carrying a `gapRank`/`gapScore`/`gapClass`
 * that answers "why is this here" against the gap view she came from. An
 * accepted explain-back has no honest answer to that question — F2.21 rules
 * explicitly that it "must never render as a due item" and "never enters
 * queue composition as a rankable candidate", and F2.14 keeps it off
 * `SchedulableInstrumentType` entirely (it produces no FSRS rating,
 * `instrument/rating.ts`). Bolting a fake `gapScore` onto it to reuse
 * `StudySessionItem`'s shape would manufacture exactly the ranking claim
 * these clauses forbid.
 *
 * So an {@link AcceptedExplainBack} is not selected — it is a **given fact**
 * a caller hands in: an explanation she already accepted and produced during
 * this session (via F2.12's confusion routing or F2.21's own depth-gate
 * proposal, both delivered through the on-demand channel per F2.21), which
 * happened, and whose minutes must be honestly reflected in the session's
 * time accounting per F2.14a. `buildStudySession` never ranks these against
 * `rows`, never trims them for budget, and never lets them influence which
 * `GapRow`s are chosen — only how much of the declared budget is left once
 * they are accounted for. See `./build.js`'s `BuildStudySessionInput.
 * acceptedExplainBacks` and `StudySessionModel.explainBackItems`.
 *
 * ## Reachability
 *
 * This module prices what a caller already knows happened. **Recognising
 * that an explain-back was accepted and durably attributing it to "this
 * session"** — wiring a live review session's F2.12/F2.21 acceptance into an
 * `AcceptedExplainBack` value — is separate, unstarted work
 * (`docs/direction/papers/seam2-explainback-cost/PROPOSAL.md` §4's own
 * reachability note; `[D-072]`). Nothing here presumes which shape that
 * wiring takes.
 *
 * **INV-1 / §7.1.** Pure. No `obsidian`, no vault I/O, no clock, nothing
 * stored.
 */

import type { VaultPath } from '../vault/types.js';
import type { DurationEstimateSource, DurationModel } from './duration.js';
import type { SupportLevelPresentation } from './support-level-chooser.js';

/**
 * One explain-back she accepted and produced during a session — a fact the
 * caller supplies, never a candidate this module or `build.ts` selects.
 * Deliberately carries no `gapScore`/`gapRank`/`gapClass` — see this
 * module's doc for why manufacturing one would misstate F2.21.
 */
export interface AcceptedExplainBack {
  /** Persisted identity (R3) — the explain-back instrument's own id, distinct from any card/MCQ id space. */
  readonly instrumentId: string;
  readonly conceptName: string;
  readonly course: string;
  readonly notePath: VaultPath;
  /** The note's filename without its extension. Never read from real-vault content (INV-3). */
  readonly noteTitle: string;
  /**
   * Row 3.9's chooser decision this explain-back was actually shown at
   * ([SUPP-2], `ol-95vv.4`) — a given fact, like every other field here: this
   * module never computes it, the same way it never computes `conceptName`
   * or `notePath`.
   *
   * `AcceptedExplainBack` carries no `conceptKey` (only `conceptName`, a
   * display string — `../study-session/build.ts`'s own `ol-63e1` comment is
   * explicit that the two are NOT interchangeable identifiers), so
   * `priceAcceptedExplainBacks` below has nothing safe to fold a
   * `SupportLevelHistoryLookup` over even if one were threaded in here — the
   * production caller that recognises an accepted explain-back and durably
   * attributes it to "this session" does not exist yet (this module's own
   * "Reachability" doc section), so there is no real identifier space to
   * name today. A future caller that DOES compute the decision (via
   * `chooseSupportLevel` at the `'explanation'` tier, the same as
   * `build.ts`'s fill) attaches it here directly, the same way it already
   * supplies every other given fact on this type. `undefined` until then.
   */
  readonly supportLevel?: SupportLevelPresentation;
}

/**
 * An accepted explain-back, priced for a composed session's time accounting
 * (F2.14a). `instrumentType` is the literal `'explain-back'` — never a member
 * of `SchedulableInstrumentType` — so a caller can tell this apart from a
 * `StudySessionItem` by its type alone, never by an absent field.
 */
export interface ComposedExplainBackItem extends AcceptedExplainBack {
  // `supportLevel` (row 3.9, [SUPP-2]) is inherited from `AcceptedExplainBack`
  // above, not redeclared here — `priceAcceptedExplainBacks` spreads `...event`
  // before adding the fields below, so whatever the caller attached rides
  // straight through unchanged.
  readonly instrumentType: 'explain-back';
  /** `durations.secondsFor('explain-back')` at the time the session was built — see `./duration.js`'s `EXPLAIN_BACK_ASSUMED_SECONDS`. */
  readonly estimatedSeconds: number;
  /** Whether {@link estimatedSeconds} came from her own review history or from `[D-126]`'s declared assumption. */
  readonly durationSource: DurationEstimateSource;
}

/**
 * Price every accepted explain-back a caller reports for this session.
 *
 * Pure lookup, order-preserving, no ranking, no filtering, no interaction
 * with `GapRow`s or the greedy fill — the whole point of keeping this a
 * separate function from `buildStudySession`'s candidate selection (see the
 * module doc).
 */
export function priceAcceptedExplainBacks(
  events: readonly AcceptedExplainBack[],
  durations: DurationModel,
): readonly ComposedExplainBackItem[] {
  return events.map((event) => ({
    ...event,
    instrumentType: 'explain-back',
    estimatedSeconds: durations.secondsFor('explain-back'),
    durationSource: durations.sourceFor('explain-back'),
  }));
}

/** Sum of {@link ComposedExplainBackItem.estimatedSeconds} — what F2.14a says must come out of the session's declared budget. */
export function totalExplainBackSeconds(items: readonly ComposedExplainBackItem[]): number {
  return items.reduce((total, item) => total + item.estimatedSeconds, 0);
}
