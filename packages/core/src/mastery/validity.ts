/**
 * The instrument validity projection (`ol-egov.141.89.9.4`; the attainment
 * chain spec's sections 2.1 and 8 in `olea-service`) — **one answer to "does
 * this instrument's evidence still stand?", now and as of any instant, read by
 * every attainment reading.**
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
 * ## The three standings an instrument can have, and why they stay apart
 *
 * 1. **Proven invalid** — something in the log shows the instrument or its
 *    grading was defective. Today exactly two facts prove that, the same two
 *    the readers already treat as proof (`8a017c4`, `f61cd18`): its LATEST
 *    verdict is `rejected` (`../review-log/verdicts.ts` calls that "a real
 *    refusal"), or a grade contest about it resolved `corrected`
 *    (`../review-log/contest.ts#correctedGradeInstrumentIds`). `[D-338]`
 *    item 3: current readings always exclude it; item 2: the displayed stage
 *    is corrected on it, with a note; item 1: the historical award keeps what
 *    stood before it.
 * 2. **Withheld, not proven invalid** — her suspension or withdrawal (F2.6,
 *    F8.5), or a successor that replaced it (`[D-133]`). **A suspension has no
 *    reason field** (`olea-contracts`' suspend record: the citation-revision
 *    tick, her withdrawal and her pause all write the same event), so every
 *    suspension reads as her choice and never proves a defect. `[D-338]`
 *    items 2 and 4: the stage and the award keep this evidence; what current
 *    readings do with it is `[D-347]`'s, open (built behind an option in
 *    `./attainment.ts`, defaulting to today's "count it"). Once `[D-345]`
 *    gives the event that takes an instrument out of standing a reason
 *    (defect, revision, her choice), this module reads it here and nowhere
 *    else: a `defect` suspension moves to standing 1, a `revision` one lets
 *    readiness and need drop it until revalidated (`[D-338]` item 4).
 * 3. **Contested and unresolved** (`[D-095]`) — thin, never absent: counted
 *    everywhere, marked as thin.
 *
 * ## As of an instant
 *
 * `provenInvalidAsOf(instant)` judges standing 1 on only the events logged at
 * or before that instant — what `./attainment.ts`'s award fold needs to ask
 * "what stood when she earned it?" (`[D-338]` item 1). Replay order is the
 * log's own total order, `(instant, eventId)`, so a merge of two devices'
 * files in any order gives the same answer.
 *
 * **Pure, and stores nothing.** Eligibility is a projection, never a stored
 * flag (R10); a different log is a different projection.
 */

import type {
  DisputeLogRecord,
  ReviewLogEntry,
  SuccessionLogRecordV5,
  SuspendLogRecord,
  VerdictLogRecord,
} from 'olea-contracts';
import { quarantinedGradeInstrumentIds, reviewLogDisputes } from '../review-log/contest.js';

/** Why an instrument is proven invalid. Only facts the log can already state unambiguously. */
export type ProvenInvalidReason = 'rejected' | 'corrected-on-contest';

/** Why an instrument is withheld without being proven invalid. `her-choice` is every suspension, since none records a reason. */
export type WithheldReason = 'her-choice' | 'succeeded';

/** The event that proves an instrument invalid. */
export interface ProvenInvalidFact {
  readonly instrumentId: string;
  readonly reason: ProvenInvalidReason;
  /** The proving event's own id — a verdict or a dispute resolution. */
  readonly eventId: string;
  /** The proving event's timestamp, as written. */
  readonly at: string;
}

/** Why an instrument is withheld now. */
export interface WithheldFact {
  readonly instrumentId: string;
  /** Every reason that applies, in a fixed order (`her-choice` before `succeeded`). */
  readonly reasons: readonly WithheldReason[];
}

export interface InstrumentValidityProjection {
  /** Instruments proven invalid over the whole log, each with the fact that proves it. */
  readonly provenInvalid: ReadonlyMap<string, ProvenInvalidFact>;
  /** Instruments withheld now but not proven invalid. */
  readonly withheld: ReadonlyMap<string, WithheldFact>;
  /** Instruments with an open grade contest: thin evidence, never absent. */
  readonly contested: ReadonlySet<string>;
  /** Standing 1 judged on events at or before `instant` (epoch ms) only. */
  provenInvalidAsOf(instant: number): ReadonlyMap<string, ProvenInvalidFact>;
  /** Every instant (epoch ms) at which some instrument's proven-invalid standing can change, ascending and distinct. */
  readonly changeInstants: readonly number[];
  /** Validity events left out because their timestamp could not be read — counted, never guessed at. */
  readonly unreadableEventCount: number;
}

interface TimedVerdict {
  readonly instant: number;
  readonly record: VerdictLogRecord;
}

interface TimedResolution {
  readonly instant: number;
  readonly record: DisputeLogRecord;
}

function isLater(
  a: { readonly instant: number; readonly eventId: string },
  b: { readonly instant: number; readonly eventId: string },
): boolean {
  return a.instant > b.instant || (a.instant === b.instant && a.eventId > b.eventId);
}

function byInstantThenEventId(
  a: { readonly instant: number; readonly record: { readonly eventId: string } },
  b: { readonly instant: number; readonly record: { readonly eventId: string } },
): number {
  if (a.instant !== b.instant) return a.instant - b.instant;
  return a.record.eventId < b.record.eventId ? -1 : a.record.eventId > b.record.eventId ? 1 : 0;
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
  const suspensionLatest = new Map<
    string,
    { instant: number; eventId: string; suspended: boolean }
  >();
  const successionFacts = new Map<string, SuccessionLogRecordV5>();

  for (const entry of entries) {
    if (entry.kind !== 'verdict' && entry.kind !== 'suspend' && entry.kind !== 'unsuspend') {
      if (entry.kind === 'succession') {
        const record = entry as SuccessionLogRecordV5;
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
    const prior = suspensionLatest.get(record.instrumentId);
    const candidate = {
      instant,
      eventId: record.eventId,
      suspended: record.kind === 'suspend',
    };
    if (prior === undefined || isLater(candidate, prior)) {
      suspensionLatest.set(record.instrumentId, candidate);
    }
  }
  for (const list of verdictsByInstrument.values()) list.sort(byInstantThenEventId);

  // Dispute records, from either place, once each.
  const disputeRecords: DisputeLogRecord[] = [];
  const seenDisputes = new Set<string>();
  for (const record of reviewLogDisputes([...entries, ...disputes])) {
    if (seenDisputes.has(record.eventId)) continue;
    seenDisputes.add(record.eventId);
    disputeRecords.push(record);
  }
  // The earliest `corrected` resolution per instrument: from then on it stands proven invalid.
  const correctedByInstrument = new Map<string, TimedResolution>();
  for (const record of disputeRecords) {
    if (record.claimKind !== 'grade') continue;
    if (record.resolves === undefined || record.outcome !== 'corrected') continue;
    if (record.instrumentId === undefined) continue;
    const instant = Date.parse(record.timestamp);
    if (!Number.isFinite(instant)) {
      unreadableEventCount += 1;
      continue;
    }
    const prior = correctedByInstrument.get(record.instrumentId);
    const candidate = { instant, record };
    if (prior === undefined || byInstantThenEventId(candidate, prior) < 0) {
      correctedByInstrument.set(record.instrumentId, candidate);
    }
  }

  const instrumentIds = new Set([...verdictsByInstrument.keys(), ...correctedByInstrument.keys()]);

  function provenInvalidAsOf(asOf: number): ReadonlyMap<string, ProvenInvalidFact> {
    const result = new Map<string, ProvenInvalidFact>();
    for (const instrumentId of [...instrumentIds].sort()) {
      const verdicts = verdictsByInstrument.get(instrumentId) ?? [];
      let latest: TimedVerdict | undefined;
      for (const timed of verdicts) {
        if (timed.instant > asOf) break;
        latest = timed;
      }
      if (latest !== undefined && latest.record.verdict === 'rejected') {
        result.set(instrumentId, {
          instrumentId,
          reason: 'rejected',
          eventId: latest.record.eventId,
          at: latest.record.timestamp,
        });
        continue;
      }
      const corrected = correctedByInstrument.get(instrumentId);
      if (corrected !== undefined && corrected.instant <= asOf) {
        result.set(instrumentId, {
          instrumentId,
          reason: 'corrected-on-contest',
          eventId: corrected.record.eventId,
          at: corrected.record.timestamp,
        });
      }
    }
    return result;
  }

  const changeInstantSet = new Set<number>();
  for (const verdicts of verdictsByInstrument.values()) {
    for (const timed of verdicts) changeInstantSet.add(timed.instant);
  }
  for (const timed of correctedByInstrument.values()) changeInstantSet.add(timed.instant);
  const changeInstants = [...changeInstantSet].sort((a, b) => a - b);

  const withheld = new Map<string, WithheldFact>();
  const withheldIds = new Set<string>();
  for (const [id, state] of suspensionLatest) if (state.suspended) withheldIds.add(id);
  for (const id of successionFacts.keys()) withheldIds.add(id);
  for (const instrumentId of [...withheldIds].sort()) {
    const reasons: WithheldReason[] = [];
    if (suspensionLatest.get(instrumentId)?.suspended === true) reasons.push('her-choice');
    if (successionFacts.has(instrumentId)) reasons.push('succeeded');
    withheld.set(instrumentId, { instrumentId, reasons });
  }

  return {
    provenInvalid: provenInvalidAsOf(Number.POSITIVE_INFINITY),
    withheld,
    contested: new Set(quarantinedGradeInstrumentIds(disputeRecords)),
    provenInvalidAsOf,
    changeInstants,
    unreadableEventCount,
  };
}
