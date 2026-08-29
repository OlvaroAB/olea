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

import {
  appendDisputeRecord,
  contestClaim,
  type DisputeLogRecord,
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
