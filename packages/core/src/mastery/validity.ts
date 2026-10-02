/**
 * The instrument validity projection (`ol-egov.141.89.9.4`; the attainment
 * chain spec's sections 2.1 and 8 in `olea-service`) — **one answer to "does
 * this evidence still stand?", now and as of any instant, read by every
 * attainment reading.**
 *
 * ## Why one projection
 *
 * Before this module, each reader built its own set: the registry, the Today
 * panel and the grove each re-derived "proven invalid" from the log
 * (`registry/build.ts`, and two mirrors in the plugin), while the ranking,
 * the gap view, the strong-recall proposal, the retrospective and the review
 * stamp passed none — so the readers could disagree about one concept's stage
 * (the chain spec's item 3). This module is the one fold they can all read;
 * wiring each reader through it is `ol-egov.141.89.9.5`'s.
 *
 * ## The scope of invalidity (rulings of 2026-09-28, `ol-egov.141.89.9.66`)
 *
 * **Only proven-invalid evidence is excluded, and only at the scope the proof
 * reaches.** A personal withdrawal never invalidates sound earlier evidence
 * (`[D-347]`'s clarification: availability is not validity); a contest
 * resolved `corrected` proves ONE review's grade wrong, never the instrument's
 * other reviews. So there are two scopes:
 *
 * - **the instrument** — its evidence as a whole is proven invalid (standing
 *   1 below): a standing rejection, or a suspension whose recorded reason is
 *   `defect`;
 * - **one review** — its grade is proven wrong (standing 4 below): the review
 *   a contest resolved `corrected` was about. Every other review of the same
 *   instrument keeps counting.
 *
 * **The cause decides which scope a correction reaches (row 14, David,
 * 2026-09-29, `ol-egov.141.89.9.71`).** A grading error alone does not mark
 * the instrument defective: the review and the evidence built on it are
 * corrected (standing 4), and the instrument's own standing does not move. An
 * instrument-level concern is kept only when the correction reveals a problem
 * with the question, the answer key, the source or the grading
 * specification, and that is standing 1 (a rejection or a defect suspension,
 * each a recorded fact about the instrument), never something a corrected
 * contest implies by itself. **A contest resolution carries no cause today**
 * (`olea-contracts`' `disputeLogRecordV6` has `outcome` only), so a corrected
 * contest is read as a grading error alone; recording a cause on the
 * resolution would be a persisted-schema change, noted as an open question on
 * `ol-egov.141.89.9.71`. Nothing here reads a cause, and nothing here spreads
 * a correction over the instrument.
 *
 * ## The standings, and why they stay apart
 *
 * 1. **Proven invalid (the instrument)** — something in the log shows the
 *    instrument itself was defective:
 *    - a `rejected` verdict (`../review-log/verdicts.ts` calls that "a real
 *      refusal") that no deliberate restore has lifted;
 *    - a suspension recording the reason `defect` (`[D-345]`: "proven
 *      invalid: rejected after use, found defective with her confirmation
 *      (F2.23), withdrawn as defective") that no later unsuspend has lifted.
 *
 *    `[D-338]` item 3: current readings always exclude it; item 2: the
 *    displayed stage is corrected on it, with a note; item 1: the historical
 *    award keeps what stood before it.
 *
 *    **What lifts a rejection (`[D-396]`, `ol-v7r5.101`).** Only her explicit
 *    restore: an `accepted` verdict for the same instrument whose `restores`
 *    names one of its rejections. It lifts that rejection and every earlier
 *    one of the same instrument, never a rejection logged after it and never
 *    another instrument's. A later accepted or edited verdict without it, a
 *    review, an edit to the block, a passing re-parse or an id repair lifts
 *    nothing: a repair keeps the rejected id, and so keeps its rejection
 *    (condition 3). A rejection with no `artifactProvenance` stands exactly
 *    as one with it; this fold never reads provenance.
 * 2. **Withheld, not proven invalid** — her suspension or withdrawal (F2.6,
 *    F8.5), a revision's suspension, or a successor that replaced it
 *    (`[D-133]`). Each suspension carries the reason it recorded
 *    (`own-choice`, `source-revision`), or `reason-unknown` when it recorded
 *    none — every suspension written before v6, and any whose writer did not
 *    know. **An unknown reason is never read as her choice and never as a
 *    defect** (`[D-345]`'s clarification). `[D-338]` items 2 and 4: the stage
 *    and the award keep this evidence; what current readings do with it is
 *    `[D-347]`'s (built behind an option in `./attainment.ts`, defaulting to
 *    "count it": a withdrawal never invalidates sound earlier evidence).
 * 3. **Contested and unresolved** (`[D-095]`) — thin, never absent: counted
 *    everywhere, marked as thin.
 * 4. **Corrected evidence (one review)** — a `grade` contest resolved
 *    `corrected` ("the tool was wrong") proves the grade of the review it was
 *    about wrong. That review stays what it was — a genuine attempt, so it
 *    still counts as practice — but its grade earns nothing: the corrected
 *    verdict, where one was recorded (a corrective re-grade naming the review
 *    in `explainBackGrade.revisionOf`, which the stage fold already reads in
 *    its place), is what counts, and where none was recorded nothing does.
 *    The instrument's other reviews are never touched.
 *
 *    **Which review a contest was about.** A new grade contest names its review
 *    directly (`reviewId` on `olea-contracts`' `disputeLogRecordV6`, row 48,
 *    `ol-egov.141.89.9.72`), and that name is read as written: the review of
 *    THIS instrument whose event id it is, whatever the times say. **A name
 *    the log cannot confirm** (no such review, or a review of another
 *    instrument) **leaves the correction unattributed, never inferred** — the
 *    rule below is never used to guess at a name that failed to resolve. The
 *    opening dispute's `reviewId` is read first, the resolution's own copy
 *    when the opening is not in the log.
 *
 *    A contest written before the field, or by a writer that could not name a
 *    review (an answered quiz item is contested before its review is
 *    written), names none. A dispute then names only its instrument and an
 *    opaque evidence fingerprint (`disputeLogRecordV5`), so the review is read
 *    off the log by one fixed rule, never guessed per case:
 *    - a re-grade that names a review of the instrument in `revisionOf`
 *      names it exactly;
 *    - otherwise, for an explanation, the grade standing when she contested
 *      — the latest review of the instrument carrying a verdict at or before
 *      the opening dispute, the same review the regrade job captures at
 *      dispute time (`[D-360]`; the plugin's `originalGradeEventIdFor`);
 *    - otherwise the review of the instrument nearest the opening dispute in
 *      time, either side, the earlier on a tie: a quiz answer is contested
 *      while its result is on screen, before its review is written
 *      (`packages/plugin/src/review/session.ts`'s `contestGrade`), so the
 *      review nearest the contest is the answer it was about.
 *
 *    A corrected contest the log cannot tie to any review excludes nothing
 *    and is counted (`unattributedCorrectionCount`), never spread over the
 *    instrument.
 *
 * ## As of an instant
 *
 * `provenInvalidAsOf(instant)` and `correctedEvidenceAsOf(instant)` judge
 * standings 1 and 4 on only the events logged at or before that instant —
 * what `./attainment.ts`'s award fold needs to ask "what stood when she
 * earned it?" (`[D-338]` item 1). Replay order is the log's own total order,
 * `(instant, eventId)`, so a merge of two devices' files in any order gives
 * the same answer.
 *
 * **Pure, and stores nothing.** Eligibility is a projection, never a stored
 * flag (R10); a different log is a different projection.
 */

import type {
  DisputeLogRecord,
  ReviewLogEntry,
  ReviewLogRecord,
  SuccessionLogRecord,
  SuspendLogRecord,
  VerdictLogRecord,
} from 'olea-contracts';
import { readExplainBackCorrectness } from 'olea-contracts';
import { quarantinedGradeInstrumentIds, reviewLogDisputes } from '../review-log/contest.js';

/** Why an instrument's evidence as a whole is proven invalid. Only facts the log states unambiguously. */
export type ProvenInvalidReason = 'rejected' | 'defect';

/**
 * Why an instrument is withheld without being proven invalid: the reason its
 * standing suspension recorded (`[D-345]`), `reason-unknown` when it recorded
 * none — never presented as her choice — or `succeeded` for a replaced
 * predecessor.
 */
export type WithheldReason = 'own-choice' | 'source-revision' | 'reason-unknown' | 'succeeded';

/** The event that proves an instrument invalid. */
export interface ProvenInvalidFact {
  readonly instrumentId: string;
  readonly reason: ProvenInvalidReason;
  /**
   * The proving event's own id — a verdict or a suspension. For a rejection
   * it is the standing one, the id a restore names in `restores`.
   */
  readonly eventId: string;
  /** The proving event's timestamp, as written. */
  readonly at: string;
}

/** Why an instrument is withheld now. */
export interface WithheldFact {
  readonly instrumentId: string;
  /** Every reason that applies, in a fixed order (the suspension's reason before `succeeded`). */
  readonly reasons: readonly WithheldReason[];
}

/** One review whose grade a contest resolved `corrected` proved wrong (standing 4). */
export interface CorrectedEvidenceFact {
  /** The review the contest was about. It stays practice; its grade earns nothing. */
  readonly reviewEventId: string;
  readonly instrumentId: string;
  /** The resolution that proved it. */
  readonly resolutionEventId: string;
  /** The resolution's timestamp, as written. */
  readonly at: string;
}

export interface InstrumentValidityProjection {
  /** Instruments whose evidence as a whole is proven invalid, each with the fact that proves it. */
  readonly provenInvalid: ReadonlyMap<string, ProvenInvalidFact>;
  /** Instruments withheld now but not proven invalid. */
  readonly withheld: ReadonlyMap<string, WithheldFact>;
  /** Instruments with an open grade contest: thin evidence, never absent. */
  readonly contested: ReadonlySet<string>;
  /**
   * Per contested instrument, the reviews its open grade contests name
   * (`reviewId`, rows 14 and 48), and whether any open contest names none and
   * so keeps its historical ambiguity. Optional: a projection built without it
   * reads every contested instrument as wholly thin.
   */
  readonly openGradeContests?: ReadonlyMap<
    string,
    { readonly unnamed: boolean; readonly reviewIds: ReadonlySet<string> }
  >;
  /** Reviews whose grade a corrected contest proved wrong, keyed by the review's event id. */
  readonly correctedEvidence: ReadonlyMap<string, CorrectedEvidenceFact>;
  /** Standing 1 judged on events at or before `instant` (epoch ms) only. */
  provenInvalidAsOf(instant: number): ReadonlyMap<string, ProvenInvalidFact>;
  /** Standing 4 judged on resolutions at or before `instant` (epoch ms) only. */
  correctedEvidenceAsOf(instant: number): ReadonlyMap<string, CorrectedEvidenceFact>;
  /** Every instant (epoch ms) at which some standing 1 or 4 can change, ascending and distinct. */
  readonly changeInstants: readonly number[];
  /** Validity events left out because their timestamp could not be read — counted, never guessed at. */
  readonly unreadableEventCount: number;
  /** Corrected contests the log cannot tie to any review: they exclude nothing, and are counted here. */
  readonly unattributedCorrectionCount: number;
}

interface TimedVerdict {
  readonly instant: number;
  readonly record: VerdictLogRecord;
}

interface TimedSuspension {
  readonly instant: number;
  readonly record: SuspendLogRecord;
}

interface TimedReview {
  readonly instant: number;
  readonly record: ReviewLogRecord;
}

interface TimedCorrection {
  readonly instant: number;
  readonly fact: CorrectedEvidenceFact;
}

function byInstantThenEventId(
  a: { readonly instant: number; readonly record: { readonly eventId: string } },
  b: { readonly instant: number; readonly record: { readonly eventId: string } },
): number {
  if (a.instant !== b.instant) return a.instant - b.instant;
  return a.record.eventId < b.record.eventId ? -1 : a.record.eventId > b.record.eventId ? 1 : 0;
}

/**
 * One instrument's standing rejection as of `asOf`: its latest `rejected`
 * verdict that no restore at or before `asOf` has lifted (module doc, "What
 * lifts a rejection"). `verdicts` are that instrument's own, in log order.
 */
function standingRejection(
  verdicts: readonly TimedVerdict[],
  asOf: number,
): TimedVerdict | undefined {
  const known: TimedVerdict[] = [];
  for (const timed of verdicts) {
    if (timed.instant > asOf) break;
    known.push(timed);
  }
  const rejectionPosition = new Map<string, number>();
  known.forEach((timed, position) => {
    if (timed.record.verdict === 'rejected') rejectionPosition.set(timed.record.eventId, position);
  });
  let liftedThrough = -1;
  for (const timed of known) {
    const named = timed.record.restores;
    if (named === undefined || timed.record.verdict !== 'accepted') continue;
    const position = rejectionPosition.get(named);
    if (position !== undefined && position > liftedThrough) liftedThrough = position;
  }
  for (let position = known.length - 1; position > liftedThrough; position -= 1) {
    const timed = known[position];
    if (timed !== undefined && timed.record.verdict === 'rejected') return timed;
  }
  return undefined;
}

/** One instrument's latest suspend or unsuspend at or before `asOf`, in log order. */
function latestSuspension(
  suspensions: readonly TimedSuspension[],
  asOf: number,
): TimedSuspension | undefined {
  let latest: TimedSuspension | undefined;
  for (const timed of suspensions) {
    if (timed.instant > asOf) break;
    latest = timed;
  }
  return latest;
}

/** Whether a review carries a grade a contest could be about: an explanation with no verdict was never graded. */
function carriesGrade(record: ReviewLogRecord): boolean {
  if (record.instrumentType !== 'explain-back') return record.rating !== null;
  return record.explainBackGrade !== undefined || readExplainBackCorrectness(record) !== undefined;
}

/**
 * The review a corrected contest was about (module doc, standing 4, "Which
 * review a contest was about"). `reviews` are the instrument's own, in log
 * order; `regradedEventIds` are the reviews a re-grade on this instrument
 * names in `revisionOf`, logged after the opening dispute.
 */
function contestedReview(
  reviews: readonly TimedReview[],
  disputeInstant: number,
  regradedEventIds: readonly string[],
): TimedReview | undefined {
  for (const eventId of regradedEventIds) {
    const named = reviews.find((timed) => timed.record.eventId === eventId);
    if (named !== undefined) return named;
  }
  let standingExplanation: TimedReview | undefined;
  for (const timed of reviews) {
    if (timed.instant > disputeInstant) break;
    if (timed.record.instrumentType === 'explain-back' && carriesGrade(timed.record)) {
      standingExplanation = timed;
    }
  }
  if (standingExplanation !== undefined) return standingExplanation;
  let nearest: TimedReview | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const timed of reviews) {
    if (!carriesGrade(timed.record)) continue;
    const distance = Math.abs(timed.instant - disputeInstant);
    // Strictly nearer only: `reviews` is ascending, so a tie keeps the earlier.
    if (distance < nearestDistance) {
      nearest = timed;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Per instrument, the reviews its open grade contests name, and whether any open contest names none. */
function openGradeContestsByInstrument(
  disputes: readonly DisputeLogRecord[],
): ReadonlyMap<string, { readonly unnamed: boolean; readonly reviewIds: ReadonlySet<string> }> {
  const resolved = new Set(
    disputes.map((record) => record.resolves).filter((id): id is string => id !== undefined),
  );
  const out = new Map<string, { unnamed: boolean; reviewIds: Set<string> }>();
  for (const record of disputes) {
    if (record.claimKind !== 'grade' || record.resolves !== undefined) continue;
    if (resolved.has(record.eventId) || record.instrumentId === undefined) continue;
    let entry = out.get(record.instrumentId);
    if (entry === undefined) {
      entry = { unnamed: false, reviewIds: new Set() };
      out.set(record.instrumentId, entry);
    }
    if (record.reviewId === undefined) entry.unnamed = true;
    else entry.reviewIds.add(record.reviewId);
  }
  return out;
}

/**
 * Folds the log (and, where the caller reads them apart, its dispute
 * records) into every instrument's standing.
 *
 * `disputes` may also arrive inside `entries` (the contract's entry union
 * carries them); an event read from both places, or from two device files,
 * counts once by `eventId`.
 */
export function projectInstrumentValidity(
  entries: readonly ReviewLogEntry[],
  disputes: readonly DisputeLogRecord[] = [],
): InstrumentValidityProjection {
  let unreadableEventCount = 0;
  const seen = new Set<string>();

  const verdictsByInstrument = new Map<string, TimedVerdict[]>();
  const suspensionsByInstrument = new Map<string, TimedSuspension[]>();
  const successionFacts = new Map<string, SuccessionLogRecord>();

  for (const entry of entries) {
    if (entry.kind !== 'verdict' && entry.kind !== 'suspend' && entry.kind !== 'unsuspend') {
      if (entry.kind === 'succession') {
        const record = entry as SuccessionLogRecord;
        if (!successionFacts.has(record.predecessorInstrumentId)) {
          successionFacts.set(record.predecessorInstrumentId, record);
        }
      }
      continue;
    }
    if (seen.has(entry.eventId)) continue;
    seen.add(entry.eventId);
    const instant = Date.parse(entry.timestamp);
    if (!Number.isFinite(instant)) {
      unreadableEventCount += 1;
      continue;
    }
    if (entry.kind === 'verdict') {
      const list = verdictsByInstrument.get(entry.instrumentId);
      const timed = { instant, record: entry };
      if (list === undefined) verdictsByInstrument.set(entry.instrumentId, [timed]);
      else list.push(timed);
      continue;
    }
    const record = entry as SuspendLogRecord;
    const list = suspensionsByInstrument.get(record.instrumentId);
    const timed = { instant, record };
    if (list === undefined) suspensionsByInstrument.set(record.instrumentId, [timed]);
    else list.push(timed);
  }
  for (const list of verdictsByInstrument.values()) list.sort(byInstantThenEventId);
  for (const list of suspensionsByInstrument.values()) list.sort(byInstantThenEventId);

  // Dispute records, from either place, once each.
  const disputeRecords: DisputeLogRecord[] = [];
  const seenDisputes = new Set<string>();
  for (const record of reviewLogDisputes([...entries, ...disputes])) {
    if (seenDisputes.has(record.eventId)) continue;
    seenDisputes.add(record.eventId);
    disputeRecords.push(record);
  }
  const openingById = new Map<string, DisputeLogRecord>();
  for (const record of disputeRecords) {
    if (record.resolves === undefined) openingById.set(record.eventId, record);
  }

  // Every grade contest resolved `corrected`, in log order, with the instant
  // she opened it (the resolution's own when the opening is missing).
  const corrections: {
    instant: number;
    openedAt: number;
    /** The review the contest names directly (row 48), the opening's first; `undefined` when it names none. */
    reviewId: string | undefined;
    record: DisputeLogRecord;
  }[] = [];
  for (const record of disputeRecords) {
    if (record.claimKind !== 'grade') continue;
    if (record.resolves === undefined || record.outcome !== 'corrected') continue;
    if (record.instrumentId === undefined) continue;
    const instant = Date.parse(record.timestamp);
    if (!Number.isFinite(instant)) {
      unreadableEventCount += 1;
      continue;
    }
    const opening = openingById.get(record.resolves);
    const openedAt = opening === undefined ? Number.NaN : Date.parse(opening.timestamp);
    corrections.push({
      instant,
      openedAt: Number.isFinite(openedAt) ? openedAt : instant,
      reviewId: opening?.reviewId ?? record.reviewId,
      record,
    });
  }
  corrections.sort(byInstantThenEventId);

  // The reviews of each corrected instrument, gathered only when a correction exists.
  const reviewsByInstrument = new Map<string, TimedReview[]>();
  if (corrections.length > 0) {
    const correctedInstruments = new Set(
      corrections.map((correction) => correction.record.instrumentId as string),
    );
    const seenReviews = new Set<string>();
    for (const entry of entries) {
      if (entry.kind !== 'review' || !correctedInstruments.has(entry.instrumentId)) continue;
      if (seenReviews.has(entry.eventId)) continue;
      seenReviews.add(entry.eventId);
      const instant = Date.parse(entry.timestamp);
      if (!Number.isFinite(instant)) continue;
      const list = reviewsByInstrument.get(entry.instrumentId);
      const timed = { instant, record: entry };
      if (list === undefined) reviewsByInstrument.set(entry.instrumentId, [timed]);
      else list.push(timed);
    }
    for (const list of reviewsByInstrument.values()) list.sort(byInstantThenEventId);
  }

  // Standing 4: each correction ties to one review; the earliest resolution per review wins.
  let unattributedCorrectionCount = 0;
  const correctionByReview = new Map<string, TimedCorrection>();
  for (const correction of corrections) {
    const instrumentId = correction.record.instrumentId as string;
    const reviews = reviewsByInstrument.get(instrumentId) ?? [];
    const namedReviewId = correction.reviewId;
    // Row 48: a contest that names its review is tied to exactly that review of
    // this instrument, or to none. A name that does not resolve is never handed
    // to the inference rule below: the rule exists for records that carry no
    // name, and using it here would guess at one that failed.
    let review: TimedReview | undefined;
    if (namedReviewId !== undefined) {
      review = reviews.find((timed) => timed.record.eventId === namedReviewId);
    } else {
      const regradedEventIds = reviews
        .filter((timed) => timed.instant >= correction.openedAt)
        .map((timed) => timed.record.explainBackGrade?.revisionOf)
        .filter((id): id is string => typeof id === 'string');
      review = contestedReview(reviews, correction.openedAt, regradedEventIds);
    }
    if (review === undefined) {
      unattributedCorrectionCount += 1;
      continue;
    }
    if (correctionByReview.has(review.record.eventId)) continue;
    correctionByReview.set(review.record.eventId, {
      instant: correction.instant,
      fact: {
        reviewEventId: review.record.eventId,
        instrumentId,
        resolutionEventId: correction.record.eventId,
        at: correction.record.timestamp,
      },
    });
  }

  const instrumentIds = new Set([
    ...verdictsByInstrument.keys(),
    ...suspensionsByInstrument.keys(),
  ]);

  function provenInvalidAsOf(asOf: number): ReadonlyMap<string, ProvenInvalidFact> {
    const result = new Map<string, ProvenInvalidFact>();
    for (const instrumentId of [...instrumentIds].sort()) {
      const rejection = standingRejection(verdictsByInstrument.get(instrumentId) ?? [], asOf);
      if (rejection !== undefined) {
        result.set(instrumentId, {
          instrumentId,
          reason: 'rejected',
          eventId: rejection.record.eventId,
          at: rejection.record.timestamp,
        });
        continue;
      }
      const suspension = latestSuspension(suspensionsByInstrument.get(instrumentId) ?? [], asOf);
      if (suspension?.record.kind === 'suspend' && suspension.record.reason === 'defect') {
        result.set(instrumentId, {
          instrumentId,
          reason: 'defect',
          eventId: suspension.record.eventId,
          at: suspension.record.timestamp,
        });
      }
    }
    return result;
  }

  function correctedEvidenceAsOf(asOf: number): ReadonlyMap<string, CorrectedEvidenceFact> {
    const result = new Map<string, CorrectedEvidenceFact>();
    for (const [reviewEventId, timed] of correctionByReview) {
      if (timed.instant <= asOf) result.set(reviewEventId, timed.fact);
    }
    return result;
  }

  const changeInstantSet = new Set<number>();
  for (const verdicts of verdictsByInstrument.values()) {
    for (const timed of verdicts) changeInstantSet.add(timed.instant);
  }
  for (const suspensions of suspensionsByInstrument.values()) {
    // Only an instrument that has ever been suspended as defective can change standing 1 here.
    if (!suspensions.some((timed) => timed.record.reason === 'defect')) continue;
    for (const timed of suspensions) changeInstantSet.add(timed.instant);
  }
  for (const timed of correctionByReview.values()) changeInstantSet.add(timed.instant);
  const changeInstants = [...changeInstantSet].sort((a, b) => a - b);

  const provenInvalid = provenInvalidAsOf(Number.POSITIVE_INFINITY);
  const withheld = new Map<string, WithheldFact>();
  const withheldIds = new Set<string>(successionFacts.keys());
  const suspensionReason = new Map<string, WithheldReason>();
  for (const [instrumentId, suspensions] of suspensionsByInstrument) {
    const latest = suspensions[suspensions.length - 1];
    if (latest === undefined || latest.record.kind !== 'suspend') continue;
    // A defect suspension is proven invalid (standing 1), never merely withheld.
    if (latest.record.reason === 'defect') continue;
    suspensionReason.set(instrumentId, latest.record.reason ?? 'reason-unknown');
    withheldIds.add(instrumentId);
  }
  for (const instrumentId of [...withheldIds].sort()) {
    const reasons: WithheldReason[] = [];
    const reason = suspensionReason.get(instrumentId);
    if (reason !== undefined) reasons.push(reason);
    if (successionFacts.has(instrumentId)) reasons.push('succeeded');
    withheld.set(instrumentId, { instrumentId, reasons });
  }

  return {
    provenInvalid,
    withheld,
    contested: new Set(quarantinedGradeInstrumentIds(disputeRecords)),
    openGradeContests: openGradeContestsByInstrument(disputeRecords),
    correctedEvidence: correctedEvidenceAsOf(Number.POSITIVE_INFINITY),
    provenInvalidAsOf,
    correctedEvidenceAsOf,
    changeInstants,
    unreadableEventCount,
    unattributedCorrectionCount,
  };
}

/**
 * `entries` less every review whose grade a corrected contest proved wrong
 * (standing 4) — what a reading of her recall replays, since a proven-wrong
 * rating says nothing about her recall. The same array, untouched, when there
 * is nothing to remove.
 */
export function withoutCorrectedEvidence(
  entries: readonly ReviewLogEntry[],
  correctedEvidence: ReadonlyMap<string, CorrectedEvidenceFact>,
): readonly ReviewLogEntry[] {
  if (correctedEvidence.size === 0) return entries;
  return entries.filter(
    (entry) => entry.kind !== 'review' || !correctedEvidence.has(entry.eventId),
  );
}

/**
 * The instruments standing rejected now: a `rejected` verdict no deliberate
 * restore has lifted (module doc, "What lifts a rejection"). The same answer
 * `projectInstrumentValidity` gives for its `rejected` reason, for a reader
 * that asks only about rejection (`../routing/instrument-eligibility.ts`), so
 * a restore reads the same everywhere.
 */
export function rejectedInstrumentIds(entries: readonly ReviewLogEntry[]): ReadonlySet<string> {
  const rejected = new Set<string>();
  for (const [instrumentId, fact] of projectInstrumentValidity(entries).provenInvalid) {
    if (fact.reason === 'rejected') rejected.add(instrumentId);
  }
  return rejected;
}
