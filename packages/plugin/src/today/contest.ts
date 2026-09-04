/**
 * The Today panel's half of the contest mechanism (`ol-fgba` [DISP-1];
 * `[D-046]` clause 4, mechanised by `[D-095]`, drawn in DSN-1 and approved by
 * `[D-136]`; open-routed disputes ruled by `[D-215]`, `ol-egov.103`).
 *
 * **Record now, route later (`[D-215]`).** A claim on one of the five
 * renderings DSN-1 leaves open no longer withholds the gesture or refuses the
 * tap. The sheet shows the same evidence it always has, then — after it,
 * never instead of it — the disclosure that no ending is ruled for this kind
 * yet and that the disagreement is kept and counted (`copy.ts`'s
 * `CONTEST_OPEN_ROUTING_KEPT`). `olea-core`'s `contestClaim` records it with
 * `claimKind: 'unsorted'` and `routingStatus: 'open'`; nothing here decides
 * that, it only renders what `contestClaim` already decided.
 *
 * Obsidian-free by construction (INV-1) — `view.ts` is the only file under
 * `today/` that touches the host. Everything here is a pure builder plus one
 * vault-backed port, so the whole mechanism is testable without a running
 * Obsidian.
 *
 * **The dispute sheet is built entirely from what is already on the device.**
 * Its reasoning, its named factors and its evidence link all come from the
 * panel's own view model and her local review log; `buildDisputeSheet` issues
 * no request and takes no transport. Nothing about disputing a claim may wait
 * on a round trip (`docs/dev/artifact-envelope.md` §3, cited by path per
 * INV-3), and the service never learns what an evidence selector selects
 * because it never sees one. The only thing the network gates is the async
 * re-derivation a contested GRADE queues — which is the review session's half
 * (`../review/contest.ts`), not this one.
 *
 * **The gesture goes on every claim, or the clause is not implemented.**
 * `claimsFor` delegates to `olea-core`'s `enumerateTodayClaims` rather than
 * letting the renderer decide section by section, because a per-section
 * decision is exactly how *every claim contestable* narrows to *every claim on
 * the surfaces we remembered*.
 */

import {
  appendDisputeRecord,
  type ClaimRouting,
  CONTEST_GESTURE_LABEL,
  type ContestEffect,
  contestClaim,
  contestedClaimFor,
  contestStateForClaim,
  type DisputeLogRecord,
  enumerateTodayClaims,
  heldReadingBasis,
  routeClaimRendering,
  type TodayClaim,
  type TodayViewModel,
  type VaultSource,
} from 'olea-core';
import {
  CONTEST_DISSENT_MARK,
  CONTEST_OPEN_ROUTING_KEPT,
  CONTEST_SHEET_LABEL,
  CONTEST_SHEET_OFFLINE_NOTE,
  CONTEST_UPHELD_ACKNOWLEDGEMENT,
  contestHeldLine,
} from './copy.js';

/** One line of the sheet's evidence list — a place to look, never a copy of what is there. */
export interface DisputeSheetEvidenceLine {
  readonly eventId: string;
  /** Local date, `YYYY-MM-DD`. The sheet shows when, never what. */
  readonly date: string;
}

/**
 * Everything the sheet renders. A view model, not a screen: `view.ts` turns it
 * into DOM and adds nothing of its own.
 */
export interface DisputeSheet {
  readonly heading: string;
  /** Olea's account of the claim, carried verbatim from what the panel computed. */
  readonly reasoning: string;
  readonly evidence: readonly DisputeSheetEvidenceLine[];
  /** The offline note — this sheet works with the network down, and says so. */
  readonly offlineNote: string;
  /**
   * The gesture, identical on every claim-bearing surface — `[D-215]`
   * (`ol-egov.103`): a rendering DSN-1 left open no longer withholds it.
   * `null` for a rendering that is not a contest at all (`declared-fact`,
   * which never reaches the Today panel today), and `null` again once a
   * dispute already stands against the claim's current evidence
   * (`ol-l5og.18.12` [STY-3]) — `dissentMark`/`openRoutingNote` below are
   * what she sees instead of a "Record this" she has already pressed.
   */
  readonly gestureLabel: string | null;
  /**
   * The disclosure shown when DSN-1 leaves this rendering's routing open —
   * after the evidence, never instead of it, and never in place of the
   * gesture (`[D-215]`). `null` for a ruled rendering.
   */
  readonly openRoutingNote: string | null;
  /** The mark riding beside a claim she has already disputed. */
  readonly dissentMark: string | null;
  /** The once-only acknowledgment, when a re-derivation has upheld the claim. */
  readonly acknowledgement: string | null;
}

/** What contesting a claim on this panel did. */
export interface TodayContestResult {
  readonly effect: ContestEffect;
  readonly record: DisputeLogRecord;
}

/** The panel's contest capability, injected into `TodayView`. */
export interface TodayContestSupport {
  /** Every claim the panel asserts, so the renderer can put one gesture on each. */
  claimsFor(viewModel: TodayViewModel): readonly TodayClaim[];
  /** The sheet for one claim, built with no network. */
  sheetFor(claim: TodayClaim): Promise<DisputeSheet>;
  /**
   * One gesture, one event. Records the dispute and returns what it did —
   * the recording is not optional, which is what makes this more than a
   * dismiss button.
   */
  contest(claim: TodayClaim): Promise<TodayContestResult>;
  /** Marks an upheld dispute's acknowledgment as seen, so it shows exactly once. */
  acknowledge(disputeEventId: string): void;
  /**
   * Re-reads the concept-to-course map. Called by the renderer BEFORE each
   * render, so `claimsFor` can stay synchronous: the view builds DOM in one
   * pass and an async call inside that pass would have the gesture appear a
   * frame after the claim it belongs to.
   */
  prime(): Promise<void>;
}

export interface TodayContestDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  /** Concept ids per course, from the same source the panel's mastery reading used. */
  readonly conceptIdsByCourse: () => Promise<Readonly<Record<string, readonly string[]>>>;
  /** Local `YYYY-MM-DD`. Injected rather than read here so this module stays pure-ish. */
  readonly today: () => string;
  /** Local ISO-8601 with offset, for the moment she contests. */
  readonly now: () => string;
  /**
   * Her review history over the panel's own window — the entries the reading
   * was folded from, and every dispute already recorded against it. Injected
   * as one call because the sheet needs both and must build from neither more
   * nor less than what the panel itself read.
   */
  readonly readHistory: () => Promise<{
    readonly entries: readonly {
      readonly eventId: string;
      readonly timestamp: string;
      readonly kind: string;
      readonly conceptIds?: readonly string[];
    }[];
    readonly disputes: readonly DisputeLogRecord[];
  }>;
  /**
   * Acknowledgment memory — which upheld disputes she has already been told
   * about. Per-device and deliberately NOT in the log: "has she seen this
   * sentence" is a rendering fact about one device, not an event in her
   * history, and writing it to the log would put a UI detail in the record
   * that mastery is rebuilt from.
   */
  readonly acknowledgedDisputeIds?: Set<string>;
}

/**
 * The reasoning line for a claim — Olea's own account of what it rests on,
 * built from the same numbers the panel showed.
 *
 * No confidence figure, no probability, no verdict on her. A mastery reading's
 * account is which reviews it was folded from and when the most recent was;
 * that is the whole answer, and she can go check it herself.
 */
export function reasoningFor(reviewCount: number, latest: string | null): string {
  // Every rendering on this panel gets the same account, including the rows
  // DSN-1 left open: what evidence stands behind the line, and when the most
  // recent of it was. [D-215] records the tap on these rows too now, but the
  // reasoning owed her never depended on that — an open row still needed its
  // evidence shown, or the open rows would have felt like refusals.
  return contestHeldLine(reviewCount, latest);
}

/**
 * Builds the sheet from the artifact already on the device. Pure: takes the
 * parsed log rather than reading one, so the offline property is structural
 * (there is nowhere for a request to go) rather than a promise in a comment.
 */
export function buildDisputeSheet(input: {
  readonly claim: TodayClaim;
  readonly entries: readonly {
    readonly eventId: string;
    readonly timestamp: string;
    readonly kind: string;
    readonly conceptIds?: readonly string[];
  }[];
  readonly disputes: readonly DisputeLogRecord[];
  readonly acknowledgedDisputeIds?: readonly string[];
}): DisputeSheet {
  const basis = heldReadingBasis({ entries: input.entries, claim: input.claim });
  const latest = basis.reviews[0]?.timestamp.slice(0, 10) ?? null;
  const routing: ClaimRouting = routeClaimRendering(input.claim.rendering);

  const state = contestStateForClaim({
    records: input.disputes,
    claim: input.claim,
    ...(input.acknowledgedDisputeIds === undefined
      ? {}
      : { acknowledgedDisputeIds: input.acknowledgedDisputeIds }),
  });

  return {
    heading: CONTEST_SHEET_LABEL,
    reasoning: reasoningFor(basis.reviewCount, latest),
    evidence: basis.reviews.map((review) => ({
      eventId: review.eventId,
      date: review.timestamp.slice(0, 10),
    })),
    offlineNote: CONTEST_SHEET_OFFLINE_NOTE,
    // [D-215]: the gesture is identical everywhere. It is withheld for a
    // rendering that is `not-a-contest` at all — `declared-fact` never
    // appears among the Today panel's claims, so that arm is defensive, not
    // a path this panel exercises — and it is withheld once a dispute
    // already stands against this claim's current evidence
    // (`ol-l5og.18.12` [STY-3]): a standing `state.disputed` is the sheet's
    // post-record state, `dissentMark` below is what she sees instead, and
    // repeating "Record this" underneath an already-recorded mark would
    // read as the tap having done nothing. DSN-1's own open question 2 (does
    // a second contest on an already-dissented claim need its own copy?) is
    // untouched: this withholds the affordance rather than answering it.
    gestureLabel:
      routing.status === 'not-a-contest' || state.disputed ? null : CONTEST_GESTURE_LABEL,
    openRoutingNote: routing.status === 'open' ? CONTEST_OPEN_ROUTING_KEPT : null,
    dissentMark: state.disputed && state.effect === 'held' ? CONTEST_DISSENT_MARK : null,
    acknowledgement:
      state.acknowledgementDue && state.resolution === 'upheld'
        ? CONTEST_UPHELD_ACKNOWLEDGEMENT
        : null,
  };
}

/**
 * The production contest support for the Today panel. Reads her log, builds
 * the sheet from it, and appends the dispute to the same log — nothing leaves
 * the device at any point.
 */
export function createTodayContestSupport(deps: TodayContestDeps): TodayContestSupport {
  const acknowledged = deps.acknowledgedDisputeIds ?? new Set<string>();
  let cachedCourses: Readonly<Record<string, readonly string[]>> = {};

  return {
    claimsFor(viewModel) {
      return enumerateTodayClaims({
        viewModel,
        conceptIdsByCourse: cachedCourses,
        today: deps.today(),
      });
    },

    async sheetFor(claim) {
      const history = await deps.readHistory();
      return buildDisputeSheet({
        claim,
        entries: history.entries,
        disputes: history.disputes,
        acknowledgedDisputeIds: [...acknowledged],
      });
    },

    async contest(claim) {
      const outcome = contestClaim({
        claim: contestedClaimFor(claim),
        timestamp: deps.now(),
      });
      const written = await appendDisputeRecord(deps.vault, outcome.record, {
        deviceId: deps.deviceId,
      });
      return { effect: outcome.effect, record: written.record };
    },

    acknowledge(disputeEventId) {
      acknowledged.add(disputeEventId);
    },

    async prime() {
      cachedCourses = await deps.conceptIdsByCourse();
    },
  };
}
