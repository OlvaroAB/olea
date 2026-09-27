/**
 * F2.23's same-day, same-claim mismatch trigger (`[D-265]` ruling 3), joined
 * to a real review session — the reachability gap `ol-egov.141.53`
 * ([INTERV-4]) named as its own follow-on (`ol-egov.141.53.1`, [INTERV-11]).
 *
 * `evaluateItemValidationTrigger`/`checkItemValidation`
 * (`packages/core/src/concept/revision/item-validation.ts`) are the pure
 * precondition and orchestration; that module's own doc names its missing
 * caller as "the review pipeline that already knows same-day/same-claim
 * comparability" — which, as of this bead, it did not: no existing reader in
 * either package links two instruments as testing the same claim, or folds
 * an instrument's day-of rating into F2.23's `SameDayInstrumentOutcome`.
 * Both are built here, from data the review pipeline already reads or can
 * cheaply read (the review log already in hand, and the citation sidecar a
 * caller already has `vault` access to) — nothing new is persisted by this
 * module itself.
 *
 * ## THE CLASSIFICATION — two Class B calls, flagged for retroactive review
 *
 * Mirroring `./prerequisite-evidence-wiring.ts`'s own "THE CLASSIFICATION"
 * section and posture exactly: `[D-265]` ruling 3 fixes the mismatch shape
 * and the confirm-don't-decide posture, and leaves HOW a caller establishes
 * "same claim" and a day's outcome per instrument completely open.
 *
 * 1. **Harder / easier is R7's own depth order, narrowed to its two
 *    FSRS-scheduled tiers.** R7: recognition (MCQ) < recall (Q&A, cloze) <
 *    explanation (explain-back). Explain-back is never FSRS-rated
 *    (`../instrument/rating.js`'s `SchedulableInstrumentType`), so this
 *    module reads no explain-back outcome at all — the explanation-tier
 *    half of R7's ordering is a real, named gap, left for whichever caller
 *    first has a cross-type outcome reading for it (see "What this module
 *    does NOT do" below). Within the two tiers it does read: `qa`/`cloze`
 *    is harder, `mcq` is easier.
 * 2. **A day's outcome, `strong` vs `failed`, is F2.16's own `rating`: a
 *    rating of `'again'` is `failed`, anything else (`hard`/`good`/`easy`)
 *    is `strong`.** This reuses the ratified FSRS mapping (`rating.ts`'s own
 *    module doc: "a wrong answer gives Again") rather than inventing a
 *    second scale. An unrated review (`rating: null` — always true for
 *    explain-back, per F2.16) never enters this fold.
 * 3. **Same claim is read off `citation-store.ts`'s existing sidecar, never
 *    a new field.** Two instruments concern the same claim when both carry
 *    an `InstrumentCitation` and either (a) their `passageDigest`s are equal
 *    and non-empty — the precise signal, `[D-292]`'s digest of the exact
 *    cited passage — or (b), when either citation predates `[D-292]` and
 *    carries no digest, their `sourcePath`, `page` and `section` are all
 *    equal. An instrument with no citation record at all (the common case
 *    for a hand-authored card) can never be found `sameClaim` by this
 *    module — never fabricated, an honest `false`.
 *
 * ## What this module does NOT do
 *
 * **It never calls a judge with real content.** `checkItemValidation`'s
 * `ItemValidationJudgeInput` needs the suspected instrument's own text and
 * its cited source's text; nothing in this package resolves an arbitrary
 * instrument id back to its note text outside the instrument currently on
 * screen (searched — no such reader exists), and there is, as of this bead,
 * no Worker task for F2.23's judge either (searched `olea-service/src`:
 * none — `[CORP-3]`'s `WorkerMaterialityJudge`/`materiality.judge.v1` has no
 * sibling here). So {@link createItemValidationProposalReader} always calls
 * `checkItemValidation` with `judge: null` today, which reports
 * `judge-unavailable` for every warranted check — the same "AI features
 * un-grey" posture every other optional Worker-backed port in this package
 * already has. `NO_JUDGE_INPUT` below is never read on that path
 * (`checkItemValidation`'s own short-circuit), so this module never
 * fabricates instrument or source text to fill it. Wiring a real
 * `WorkerItemValidationJudge` and an instrument-id → text resolver is
 * follow-up work, not solved here (see this bead's evidence).
 *
 * It never decides sameClaim/sameDay itself beyond the two Class B rules
 * above, never reads the vault for anything but a citation record, and
 * never writes eligibility, weight or a growth-stage change — same
 * discipline `item-validation.ts`'s own module doc states for the core
 * layer, carried through to this wiring.
 *
 * **INV-1.** No `obsidian` import.
 */

import type { InstrumentType, Rating, ReviewLogEntry } from 'olea-contracts';
import type {
  Clock,
  ItemValidationJudgeInput,
  ItemValidationJudgePort,
  ItemValidationOutcome,
  SameClaimMismatchInput,
  SameDayInstrumentOutcome,
  VaultSource,
} from 'olea-core';
import {
  calendarDayFromLocalDate,
  calendarDayOfTimestamp,
  checkItemValidation,
  readInstrumentCitation,
} from 'olea-core';
import { proposeItemValidationConfirmations } from './duplication-confirmation-store.js';

/** The two `[D-265]` ruling-3 tiers this module reads (see the module doc's classification 1). */
export type FsrsRatedInstrumentType = 'mcq' | 'qa' | 'cloze';

const DEPTH_RANK: Readonly<Record<FsrsRatedInstrumentType, number>> = {
  mcq: 0,
  qa: 1,
  cloze: 1,
};

function isFsrsRatedType(type: InstrumentType): type is FsrsRatedInstrumentType {
  return type === 'mcq' || type === 'qa' || type === 'cloze';
}

/** F2.16's own mapping (classification 2): `'again'` is `failed`, every other rating is `strong`. `null` (explain-back, or an unrated review) never enters the fold. */
function outcomeOfRating(rating: Rating | null): SameDayInstrumentOutcome | undefined {
  if (rating === null) return undefined;
  return rating === 'again' ? 'failed' : 'strong';
}

/** One FSRS-scheduled instrument's outcome on one calendar day, for one concept. */
export interface DayOutcome {
  readonly instrumentId: string;
  readonly instrumentType: FsrsRatedInstrumentType;
  readonly outcome: SameDayInstrumentOutcome;
}

/**
 * Every FSRS-scheduled instrument's outcome on `day`, for `conceptId`, from
 * `entries` — the review log the session was already composed from, never
 * re-read. When an instrument was rated more than once on `day` (a restudy
 * within the same sitting), the LATEST rating that day wins, matching
 * "a day's outcome" being one fact, not a history.
 */
export function dayOutcomesForConcept(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
  day: string,
): ReadonlyMap<string, DayOutcome> {
  const latestByInstrument = new Map<
    string,
    { readonly outcome: DayOutcome; readonly timestamp: string }
  >();
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    if (!isFsrsRatedType(entry.instrumentType)) continue;
    if (!entry.conceptIds.includes(conceptId)) continue;
    if (calendarDayOfTimestamp(entry.timestamp) !== day) continue;
    const outcome = outcomeOfRating(entry.rating);
    if (outcome === undefined) continue;

    const existing = latestByInstrument.get(entry.instrumentId);
    if (existing !== undefined && existing.timestamp >= entry.timestamp) continue;
    latestByInstrument.set(entry.instrumentId, {
      outcome: { instrumentId: entry.instrumentId, instrumentType: entry.instrumentType, outcome },
      timestamp: entry.timestamp,
    });
  }

  const result = new Map<string, DayOutcome>();
  for (const [instrumentId, { outcome }] of latestByInstrument) result.set(instrumentId, outcome);
  return result;
}

interface HarderEasierPair {
  readonly harderInstrumentId: string;
  readonly harderOutcome: SameDayInstrumentOutcome;
  readonly easierInstrumentId: string;
  readonly easierOutcome: SameDayInstrumentOutcome;
}

/**
 * Orders `a` and `b` by R7 depth (classification 1) and checks
 * `evaluateItemValidationTrigger`'s own outcome direction (harder strong,
 * easier failed) before either citation or the trigger itself is asked
 * anything. Same depth tier (`qa` beside `cloze`, or either beside itself)
 * is never a harder/easier pair — `undefined`. The reverse direction
 * (harder failed, easier strong — ordinary forgetting of the easier item
 * with no corroborating strong evidence) is also `undefined`: this is NOT
 * `evaluateItemValidationTrigger`'s precondition, so it is never treated as
 * one here either.
 */
function pairAsHarderEasier(
  a: {
    readonly instrumentId: string;
    readonly instrumentType: FsrsRatedInstrumentType;
    readonly outcome: SameDayInstrumentOutcome;
  },
  b: {
    readonly instrumentId: string;
    readonly instrumentType: FsrsRatedInstrumentType;
    readonly outcome: SameDayInstrumentOutcome;
  },
): HarderEasierPair | undefined {
  const rankA = DEPTH_RANK[a.instrumentType];
  const rankB = DEPTH_RANK[b.instrumentType];
  if (rankA === rankB) return undefined;
  const harder = rankA > rankB ? a : b;
  const easier = rankA > rankB ? b : a;
  if (harder.outcome !== 'strong' || easier.outcome !== 'failed') return undefined;
  return {
    harderInstrumentId: harder.instrumentId,
    harderOutcome: harder.outcome,
    easierInstrumentId: easier.instrumentId,
    easierOutcome: easier.outcome,
  };
}

/** Classification 3: same claim iff both instruments carry a citation and their passage identity matches. Never fabricated `true` when either has no citation record. */
async function citationsShareClaim(
  vault: VaultSource,
  aInstrumentId: string,
  bInstrumentId: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([
    readInstrumentCitation(vault, aInstrumentId),
    readInstrumentCitation(vault, bInstrumentId),
  ]);
  if (a === undefined || b === undefined) return false;
  if (
    a.passageDigest !== undefined &&
    a.passageDigest.length > 0 &&
    b.passageDigest !== undefined &&
    b.passageDigest.length > 0
  ) {
    return a.passageDigest === b.passageDigest;
  }
  return a.sourcePath === b.sourcePath && a.page === b.page && a.section === b.section;
}

/** The just-graded instrument, as `session.ts`'s `logAndAdvance` already holds it. */
export interface JustGradedInstrument {
  readonly instrumentId: string;
  readonly instrumentType: InstrumentType;
  readonly conceptIds: readonly string[];
  readonly rating: Rating | null;
  /** The instant this review was rated — `deps.clock.now()`, never read from `Date.now()` here. */
  readonly now: Date;
}

export interface ResolveSameClaimMismatchDeps {
  /** The review log the session was composed from — passed, never re-read. */
  readonly entries: readonly ReviewLogEntry[];
  readonly vault: VaultSource;
}

/**
 * `evaluateItemValidationTrigger`'s own precondition, resolved against real
 * data: is there a same-day, same-concept, same-claim instrument at the
 * OTHER R7 depth tier from `justGraded`, whose own outcome today completes
 * the harder-strong/easier-failed shape? `undefined` on any ordinary lapse
 * (no candidate, wrong direction, wrong tier, or no shared claim) — see the
 * module doc's "THE CLASSIFICATION".
 *
 * Never throws: a malformed log entry or an unreadable citation is an
 * honest "found nothing", never a reason to break a review she is mid-way
 * through — same posture every optional port in `session.ts` already takes.
 */
export async function resolveSameClaimMismatch(
  deps: ResolveSameClaimMismatchDeps,
  justGraded: JustGradedInstrument,
): Promise<SameClaimMismatchInput | undefined> {
  if (!isFsrsRatedType(justGraded.instrumentType)) return undefined;
  const outcome = outcomeOfRating(justGraded.rating);
  if (outcome === undefined) return undefined;

  const day = calendarDayFromLocalDate(justGraded.now);
  const justGradedSide = {
    instrumentId: justGraded.instrumentId,
    instrumentType: justGraded.instrumentType,
    outcome,
  };

  for (const conceptId of justGraded.conceptIds) {
    const todaysOutcomes = dayOutcomesForConcept(deps.entries, conceptId, day);
    for (const candidate of todaysOutcomes.values()) {
      if (candidate.instrumentId === justGraded.instrumentId) continue;
      const pair = pairAsHarderEasier(justGradedSide, candidate);
      if (pair === undefined) continue;
      const sameClaim = await citationsShareClaim(
        deps.vault,
        pair.harderInstrumentId,
        pair.easierInstrumentId,
      );
      if (!sameClaim) continue;
      return { ...pair, sameDay: true, sameClaim: true };
    }
  }
  return undefined;
}

export interface ItemValidationProposalReaderDeps extends ResolveSameClaimMismatchDeps {
  readonly clock: Clock;
  /**
   * `null` until a real Worker judge exists for F2.23 — see the module
   * doc's "What this module does NOT do". When `null`, every
   * `'check-warranted'` trigger reports `judge-unavailable`, honestly.
   */
  readonly judge: ItemValidationJudgePort | null;
}

/** Never read by `checkItemValidation` when `judge` is `null` — see the module doc. */
const NO_JUDGE_INPUT: ItemValidationJudgeInput = { instrumentText: '', citedSourceText: '' };

/**
 * Builds the resolver a real `ReviewSession` threads onto
 * `ReviewSessionDeps.checkItemValidationMismatch`.
 *
 * Resolves the mismatch (above), runs `checkItemValidation`, and — on a
 * `'proposed'` outcome — persists it to the shared confirmation-queue
 * folder (`./duplication-confirmation-store.ts`'s
 * `proposeItemValidationConfirmations`) under F2.23's own reason value, the
 * same "share the existing folder under a reason of their own" pattern
 * `[D-392]`'s repair-choice records already established. That persisted
 * proposal is what "she confirms or dismisses it" (this bead's own notes)
 * resolves to today: a durable, `'proposed'`-status record, ready for
 * whichever surface first reads it (none does yet — same honest-gap
 * posture `PendingItemRepairReferral`'s own doc states for the OTHER,
 * independent path into item validation, `[D-323]`'s repeated-failure
 * standing check).
 *
 * Never throws: see {@link resolveSameClaimMismatch}'s own doc. A judge
 * call that fails, or a store write that fails, is logged and reported as
 * `'no-trigger'` rather than breaking the review she is in.
 */
export function createItemValidationProposalReader(
  deps: ItemValidationProposalReaderDeps,
): (justGraded: JustGradedInstrument) => Promise<ItemValidationOutcome> {
  return async (justGraded) => {
    try {
      const mismatch = await resolveSameClaimMismatch(deps, justGraded);
      if (mismatch === undefined) return { kind: 'no-trigger' };

      const outcome = await checkItemValidation(mismatch, NO_JUDGE_INPUT, deps.judge, deps.clock);
      if (outcome.kind === 'proposed') {
        await proposeItemValidationConfirmations(deps.vault, [
          {
            instrumentId: outcome.proposal.instrumentId,
            kind: outcome.proposal.kind,
            proposedAt: outcome.proposal.at,
            ...(outcome.proposal.reason !== undefined ? { reason: outcome.proposal.reason } : {}),
          },
        ]);
      }
      return outcome;
    } catch (error) {
      console.error(
        'Olea: could not resolve the item-validation mismatch (F2.23, [D-265] ruling 3)',
        error,
      );
      return { kind: 'no-trigger' };
    }
  };
}
