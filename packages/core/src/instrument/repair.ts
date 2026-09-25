/**
 * C5.3 as amended by `[D-090]`: when an item's id is deleted from its file, restoring it must
 * cost her a question — unless the evidence is strong enough that asking would just be noise.
 * `[D-090]`'s ruling (`ol-egov.14`, approved 2026-08-23) states the near-certainty test as
 * exactly three conditions, all of which must hold: **byte-identical item text, same file, and
 * the candidate id currently unclaimed** (a claimed id is a duplication case, not repair). Short
 * of that, the repair is surfaced to the confirmation queue — "the same two-dial shape as F8.6's
 * matcher, with the silent dial closed except at certainty"
 * (`features/F3-learn-from-anything.md`'s own words for the scenario).
 *
 * `[D-090]` names no fourth dial and no fuzzy threshold anywhere in this test — every condition
 * is a hard boolean (identical or not, same file or not, claimed or not), so nothing here invents
 * a similarity cutoff the ruling never gave a number for (`[D-194]`: a threshold named without a
 * number is stopped on, never guessed). If a future ruling widens this test with a genuinely
 * fuzzy dial, that is a new decision, not an extension of this module.
 *
 * This module is the decision's PURE half, the repair sibling of `./duplication.ts`'s
 * `resolveInstrumentDuplications` (`ol-v7r5.84`) — same shape, same discipline: a caller (a
 * session build, a harness, a test) hands it the deleted id's last known record and the
 * candidate found at read time; it hands back a decision and nothing else. It never walks the
 * vault, never matches a deleted id to a candidate location (that pairing is a *matching*
 * problem, F8.6-shaped and unbuilt — this module is only reached once some caller already
 * proposes ONE candidate for ONE deleted id), never persists a queue entry, and never mints or
 * writes an id.
 *
 * **Why `candidateIdClaimedElsewhere` is an input, not something this module resolves.** Whether
 * `deletedId.instrumentId` is currently carried by a live item elsewhere in the vault requires
 * scanning every other record — exactly the kind of full-enumeration read `resolveInstrumentDuplications`
 * needs `records`/`duplicateInstrumentIds` for. Taking it as a boolean keeps this function a
 * single-candidate decision, testable without a `ReviewSession`, and leaves the scan to whichever
 * caller already has the enumeration (the same `recordsById` `resolveInstrumentDuplications`
 * builds is one honest source for it).
 *
 * The non-silent outcomes are shaped like `./duplication.ts`'s `DuplicationConfirmationQueueEntry`
 * (status/reason/proposedAt, `DuplicationConfirmationStatus`'s own `'proposed'`/`'confirmed'`/
 * `'declined'` vocabulary, reused rather than reinvented) so a future plugin-side store can hold
 * both this module's and `duplication.ts`'s entries without two incompatible shapes.
 */

import type { VaultPath } from '../vault/types.js';
import type { DuplicationConfirmationStatus } from './duplication.js';

/**
 * The deleted id's last known state — from before the id disappeared from its file. `raw` and
 * `notePath` are the same fields `VaultInstrumentRecord`'s `card`/`mcq` and `notePath` already
 * carry (`../session/types.js`), so a caller can build this directly from the last enumeration
 * that still saw the id.
 */
export interface DeletedInstrumentRecord {
  readonly instrumentId: string;
  /** The item's raw source text, last observed — the byte-identical dial's left-hand side. */
  readonly raw: string;
  /** The file the id was last observed in — the same-file dial's left-hand side. */
  readonly notePath: VaultPath;
}

/**
 * What a caller proposes as the deleted id's possible replacement, at vault-read time. Carries no
 * id of its own — an item with no id is exactly why a repair path was reached.
 */
export interface RepairCandidate {
  /** The candidate item's raw source text, now — the byte-identical dial's right-hand side. */
  readonly raw: string;
  /** The file the candidate is now found in — the same-file dial's right-hand side. */
  readonly notePath: VaultPath;
  /**
   * True when `deletedId.instrumentId` is currently carried by a live item ELSEWHERE in the
   * vault — the claimed dial. Never set true for the candidate itself; the candidate carries no
   * id (see above), so it cannot be the live item that claims it.
   */
  readonly candidateIdClaimedElsewhere: boolean;
}

/** Why a repair was not silent. A closed union: `[D-090]` names exactly these two non-silent routes. */
export type RepairConfirmationReason =
  /** Byte-identical text, same file, but the id is already claimed by a live item elsewhere — a duplication case, not a repair. */
  | 'candidate-id-claimed'
  /** The text changed, or the item moved to another file — short of near-certainty, surfaced rather than guessed. */
  | 'repair-uncertain';

/**
 * One confirmation-queue entry for a non-silent repair, shaped like `./duplication.ts`'s
 * `DuplicationConfirmationQueueEntry` (see module doc) so both can share a store later.
 */
export interface RepairConfirmationQueueEntry {
  readonly instrumentId: string;
  /** Where the candidate was found — the location she would need to look at to answer. */
  readonly notePath: VaultPath;
  readonly status: DuplicationConfirmationStatus;
  readonly reason: RepairConfirmationReason;
  /** Epoch ms — the caller's clock (`input.now`), never read directly here. */
  readonly proposedAt: number;
}

export interface ResolveInstrumentRepairInput {
  readonly deletedId: DeletedInstrumentRecord;
  readonly candidate: RepairCandidate;
  /** Epoch ms for a non-silent outcome's `proposedAt` — the caller's `Clock.now()`, never `Date.now()` read here. */
  readonly now: number;
}

/** A silent repair: the deleted id is restored at the candidate's current location. */
export interface RepairedOutcome {
  readonly kind: 'repaired';
  readonly instrumentId: string;
  readonly notePath: VaultPath;
}

/** Reached at near-certainty with the id already claimed elsewhere — routed as a duplication, not a repair. */
export interface RepairDuplicationOutcome {
  readonly kind: 'duplication';
  readonly entry: RepairConfirmationQueueEntry;
}

/** Anything short of near-certainty — surfaced to the confirmation queue rather than guessed. */
export interface RepairSurfacedOutcome {
  readonly kind: 'surfaced';
  readonly entry: RepairConfirmationQueueEntry;
}

export type RepairOutcome = RepairedOutcome | RepairDuplicationOutcome | RepairSurfacedOutcome;

/**
 * C5.3 / `[D-090]`'s repair decision — see module doc. Deterministic: the same input always
 * produces the same outcome.
 */
export function resolveInstrumentRepair(input: ResolveInstrumentRepairInput): RepairOutcome {
  const { deletedId, candidate, now } = input;

  const byteIdentical = deletedId.raw === candidate.raw;
  const sameFile = deletedId.notePath === candidate.notePath;

  if (byteIdentical && sameFile && !candidate.candidateIdClaimedElsewhere) {
    return {
      kind: 'repaired',
      instrumentId: deletedId.instrumentId,
      notePath: candidate.notePath,
    };
  }

  if (byteIdentical && sameFile && candidate.candidateIdClaimedElsewhere) {
    return {
      kind: 'duplication',
      entry: {
        instrumentId: deletedId.instrumentId,
        notePath: candidate.notePath,
        status: 'proposed',
        reason: 'candidate-id-claimed',
        proposedAt: now,
      },
    };
  }

  return {
    kind: 'surfaced',
    entry: {
      instrumentId: deletedId.instrumentId,
      notePath: candidate.notePath,
      status: 'proposed',
      reason: 'repair-uncertain',
      proposedAt: now,
    },
  };
}
