/**
 * The review session's half of the contest mechanism — the GRADE case
 * (`ol-fgba` [DISP-1]; `[D-046]` clause 4, mechanised by `[D-095]`, drawn in
 * DSN-1 and approved by `[D-136]`).
 *
 * Obsidian-free (INV-1); `view.ts` and `obsidian-ports.ts` are the only files
 * under `review/` allowed to import the host.
 *
 * **Why the grade case is where the state actually moves.** A contested
 * reading holds; a contested structural claim is a withdrawn confirmation; a
 * contested grade is the one that gets RE-JUDGED, and it is the only kind
 * whose second ending arrives later, on evidence, rather than at the moment of
 * the gesture. Both endings of `[D-046]` clause 4 are reachable here:
 *
 * - the state MOVES — `resolveContestedGrade(..., 'corrected')` appends the
 *   compensating event, naming her contest as its catalyst by event id, and
 *   the instrument leaves quarantine carrying that correction;
 * - the state HOLDS — `resolveContestedGrade(..., 'upheld')` records that the
 *   re-derivation checked the grading and it stands, and the surface
 *   acknowledges that exactly once (`quarantineBadgeFor` returns `null`
 *   thereafter) and then genuinely lets it rest.
 *
 * **Quarantine is thin evidence, never absent evidence.** While a contested
 * grade waits for its re-derivation, consumers discount it; they do not drop
 * it, and the surface dims it with a badge saying why rather than hiding it.
 * `quarantinedGradeInstrumentIds` in `olea-core` is the single reader of that
 * state, folded from the log — there is no stored quarantine table.
 *
 * **The re-derivation is the only part that needs the network.** Contesting
 * itself does not: the gesture, the sheet and the recording are all local, so
 * a grade can be disputed with the network down and the re-derivation queued
 * for whenever it comes back.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  appendDisputeRecord,
  contestClaim,
  type DisputeLogRecord,
  latestExplainBackGradeByInstrument,
  quarantinedGradeInstrumentIds,
  resolveDispute,
  type VaultSource,
} from 'olea-core';
import { CONTEST_CORRECTED_PREFIX, CONTEST_QUARANTINE_BADGE } from './copy.js';

/** What a contested grade's re-derivation concluded. */
export type GradeContestOutcome = 'upheld' | 'corrected';

/**
 * The review session's contest capability. One gesture on the grade claim, one
 * event, and a resolution that is itself an event.
 */
export interface GradeContestPort {
  /**
   * Contests the grade on one instrument. Returns the written record, because
   * the caller needs its `eventId` — that id is what the compensating event
   * names as its catalyst.
   */
  contestGrade(input: {
    readonly instrumentId: string;
    readonly conceptIds: readonly string[];
    readonly evidenceBasis: string;
  }): Promise<DisputeLogRecord>;

  /** Records how the async re-derivation landed. Both outcomes are recorded. */
  resolveContestedGrade(input: {
    readonly dispute: DisputeLogRecord;
    readonly outcome: GradeContestOutcome;
  }): Promise<DisputeLogRecord>;
}

/**
 * The real `GradeContestPort`: `olea-core`'s `appendDisputeRecord` over a
 * `VaultSource`, the same shape `createVaultSuspendPort` and
 * `createVaultReviewLogPort` take, and for the same reasons — a `VaultSource`
 * and a device id, no Obsidian, loadable under Vitest.
 *
 * `conceptIds` is copied rather than passed by reference, matching its two
 * siblings: the record's type is a mutable array and callers hand this a
 * `readonly` one.
 */
export function createVaultGradeContestPort(
  vault: VaultSource,
  deviceId: string,
  now: () => string,
): GradeContestPort {
  return {
    async contestGrade(input) {
      const outcome = contestClaim({
        claim: {
          rendering: 'explain-back-grade',
          conceptIds: [...input.conceptIds],
          instrumentId: input.instrumentId,
          evidenceBasis: input.evidenceBasis,
        },
        timestamp: now(),
      });
      const written = await appendDisputeRecord(vault, outcome.record, { deviceId });
      return written.record;
    },

    async resolveContestedGrade(input) {
      const written = await appendDisputeRecord(
        vault,
        resolveDispute({
          dispute: input.dispute,
          outcome: input.outcome,
          timestamp: now(),
        }),
        { deviceId },
      );
      return written.record;
    },
  };
}

/**
 * The badge a quarantined grade wears while its re-derivation is outstanding,
 * or `null` once it has landed either way.
 *
 * It dims with a reason rather than disappearing — `[D-095]` §3's
 * dim-plus-badge, and the difference between "we are re-checking this" and
 * "this never happened".
 */
export function quarantineBadgeFor(
  instrumentId: string,
  disputes: readonly DisputeLogRecord[],
): string | null {
  return quarantinedGradeInstrumentIds(disputes).includes(instrumentId)
    ? CONTEST_QUARANTINE_BADGE
    : null;
}

/**
 * The compensating line for a corrected grade, naming the date she flagged it.
 *
 * This is the proof the channel works, and it is deliberately written where
 * she can see it rather than only into the log. `null` for an upheld grade:
 * that ending gets one acknowledgment on the Today panel and then silence, not
 * a second sentence here.
 */
export function correctionLineFor(
  resolution: DisputeLogRecord,
  opening: DisputeLogRecord,
): string | null {
  if (resolution.outcome !== 'corrected') return null;
  return `${CONTEST_CORRECTED_PREFIX} ${opening.timestamp.slice(0, 10)}.`;
}

/**
 * The `revisionOf` a corrective re-grade must carry to satisfy `[D-281]`'s
 * correction rule (`ol-egov.141.89.9.25`) — the `eventId` of the grade
 * CURRENTLY STANDING for this instrument, i.e. the one a contest resolved
 * `corrected` is correcting.
 *
 * Reads `latestExplainBackGradeByInstrument`'s own answer to "most recent"
 * (`olea-core`, GLOSSARY SOLO rule 3) rather than re-deriving it: a grade
 * contest names only `instrumentId` and an evidence fingerprint, never an
 * event id of its own, so the standing grade is the one thing on the log
 * that can be named — the same reading `explain-back-grade-write.ts`'s
 * `superseded` field already treats as authoritative. `null` — never a
 * guess — when the instrument carries no graded explain-back event at all,
 * which a caller should treat as "nothing to revise" rather than an error:
 * a grade could in principle be contested and resolved corrected between
 * two reads of a log this function is never shown the later half of.
 */
export function originalGradeEventIdFor(
  instrumentId: string,
  records: readonly (ReviewLogEntry | DisputeLogRecord)[],
): string | null {
  return latestExplainBackGradeByInstrument(records).get(instrumentId)?.eventId ?? null;
}

/** What one contest resolution and its corrective re-grade (if any) produced. */
export interface ResolveContestedGradeAndRegradeResult {
  /** The resolution record `resolveContestedGrade` appended. */
  readonly resolution: DisputeLogRecord;
  /**
   * The `eventId` a corrective re-grade named, when one was appended.
   * `null` for an upheld outcome, and `null` for a corrected outcome that
   * found no standing grade to revise (see `originalGradeEventIdFor`).
   */
  readonly revisionOf: string | null;
}

/**
 * The production path this module names but, until now, nothing called
 * (`ol-egov.141.89.9.25`): resolves a contested grade and, when the
 * re-derivation found the tool wrong, appends the compensating re-grade
 * naming the corrected grade's own event as `revisionOf` — the one ruled
 * exception to the growth-stage high-water mark (`[D-281]`, `ol-95vv.10`)
 * and the correction path `[D-338]` item 2 reads as proven-invalid evidence.
 *
 * **What this function does NOT do, deliberately.** It does not run the
 * re-derivation itself. `outcome` is the re-derivation's own verdict,
 * arrived at however that heavier judgement is produced — this module's own
 * header already names that as "the only part that needs the network", and
 * `ol-egov.141.89.9.25`'s own bead text calls it "likely Worker-driven and
 * larger than plumbing": deciding what re-derives a grade (a fresh,
 * heavier Worker judge call; when it runs relative to going back online;
 * whether it is the SAME `explain-back.solo.v1` judge already wired for a
 * fresh attempt, per `docs/dev/wiring-register.md`'s `GradeContestPort`
 * entry, or a distinct heavier one) is a design question this bead's `owns`
 * does not extend to, and no contract clause or ruling settles it today —
 * see this bead's report for the proposed decision. Likewise it does not
 * itself write the corrective re-grade's review-log event: `contest.ts` has
 * no access to a `GradingWiring`/Worker judge or to the `[D-077]` content
 * store `recordSoloGradeAndReview` (`../explain-back/solo-review.js`) needs
 * to mint one, so `appendCorrectiveRegrade` is injected — the same
 * dependency-injection discipline `createVaultGradeContestPort` above
 * already uses for the vault, applied to the one write this module cannot
 * itself perform. A real caller supplies it as
 * `(revisionOf) => recordSoloGradeAndReview(deps, { ...answer, revisionOf })`
 * — a FRESH `attemptId`, per that function's own doc, never the corrected
 * attempt's own id.
 *
 * **Reachability (`[D-072]`).** This function is real, tested and callable,
 * not a stub — but it has no production caller yet: wiring it needs
 * `packages/plugin/src/review/session.ts` (or `main.ts`) to decide when the
 * re-derivation runs and to supply a real `appendCorrectiveRegrade`, both
 * outside this bead's `owns`. Named, not hidden, per this bead's own
 * instruction not to invent that surface.
 */
export async function resolveContestedGradeAndRegrade(input: {
  readonly port: GradeContestPort;
  readonly dispute: DisputeLogRecord;
  readonly outcome: GradeContestOutcome;
  /** Every record her review log carries — read only to find the standing grade, never written here. */
  readonly records: readonly (ReviewLogEntry | DisputeLogRecord)[];
  /**
   * Appends the corrective re-grade. Called exactly once, and only when
   * `outcome` is `'corrected'` and a standing grade event was found to
   * revise — never for `'upheld'`, and never with a guessed `revisionOf`.
   */
  readonly appendCorrectiveRegrade: (revisionOf: string) => Promise<void>;
}): Promise<ResolveContestedGradeAndRegradeResult> {
  const resolution = await input.port.resolveContestedGrade({
    dispute: input.dispute,
    outcome: input.outcome,
  });

  if (input.outcome !== 'corrected' || input.dispute.instrumentId === undefined) {
    return { resolution, revisionOf: null };
  }

  const revisionOf = originalGradeEventIdFor(input.dispute.instrumentId, input.records);
  if (revisionOf !== null) {
    await input.appendCorrectiveRegrade(revisionOf);
  }
  return { resolution, revisionOf };
}
