/**
 * The review's belief stamp at schema version 6 (`ol-95vv.13`; the contract is
 * `olea-contracts`' `masteryAtTimeV6`, MAT-7 / `ol-95vv.8`, `[D-087]`,
 * `[D-116]`, `[D-345]`): **both axes per concept, plus the arithmetic version
 * that produced them** — what the system believed about each concept a review
 * names when it offered her the item.
 *
 * ## Which readings, and why these
 *
 * The contract names the version: `attainmentArithmeticVersion`
 * (`./attainment.ts`), "the arithmetic version that produced this stamp's stage
 * and vitality". A version is only true of the readings it travels with, so
 * both axes come from the readings that carry exactly that version:
 *
 * - the stage is `readAllConceptAttainment`'s **displayed** stage — every
 *   stage over the evidence that stands now, proven-invalid instruments
 *   removed and a contest-corrected grade read as practice (`[D-338]`). The
 *   attainment chain spec names it as the stamp's target ("the displayed stage
 *   then, with the arithmetic version"); before this module the stamp folded
 *   the stage with no validity set at all;
 * - vitality is `readAllEligibleConceptVitality`'s reading — proven-invalid
 *   evidence left out, withheld evidence per `[D-347]`'s policy — at `now`;
 * - the version is the one both readings carry. They are computed with the
 *   same options and the same scheduler version, so they carry the same
 *   string by construction; {@link masteryAtTimeStamp} checks it anyway and
 *   fails loudly rather than stamp a version that describes one axis only.
 *
 * ## What the caller owes
 *
 * `entries` is the log **as it stood before** the review being written
 * (`masteryAtTimeForConceptIds`' rule, `./rollup.ts`): the caller reads the
 * log to completion before it appends, so the not-yet-written event cannot be
 * in it. `validity` is one projection over that log and its disputes — the
 * same projection a display reader builds (`projectInstrumentValidity`).
 *
 * ## What it never does
 *
 * - **Never half a stamp.** Every key of `byConcept` has its vitality and the
 *   version rides beside them (the contract's `refineBeliefStampComplete`);
 *   the stage-only form is the v5 legacy one, which only the migration writes.
 * - **Never an input.** No fold reads a stamp back (knowledge model §8 test 5,
 *   strip-invariance); this module only writes what the readings say.
 * - **Never a default.** `early` is a real reading the fold produced (the
 *   sufficiency floor), never a stand-in for a reading that was not taken.
 */

import type { MasteryAtTimeV6, MasteryState, ReviewLogEntry, VitalityValue } from 'olea-contracts';
import type { Scheduler } from '../scheduler/types.js';
import {
  type AttainmentOptions,
  readAllConceptAttainment,
  readAllEligibleConceptVitality,
} from './attainment.js';
import type { InstrumentValidityProjection } from './validity.js';

/** The per-concept arm of the v6 stamp — the only arm a writer produces. */
export type PerConceptMasteryAtTimeV6 = Extract<MasteryAtTimeV6, { attribution: 'per-concept' }>;

export interface MasteryAtTimeStampInput {
  /** The log as it stood BEFORE the review being written (see the module doc). */
  readonly entries: readonly ReviewLogEntry[];
  /** The record's `conceptIds`, her order, verbatim; duplicates collapse to one key, as the contract's set rule reads them. */
  readonly conceptIds: readonly string[];
  /** One validity projection over `entries` and its disputes (`projectInstrumentValidity`). */
  readonly validity: InstrumentValidityProjection;
  /** The scheduler vitality replays through; its configuration version is part of the stamped version. */
  readonly scheduler: Scheduler;
  /** The instant the review is written. */
  readonly now: Date;
  /** `[D-115]`'s holding cut (`HOLDING_CUT`), handed in, never defaulted here. */
  readonly holdingCut: number;
  /** The attainment options both readings run under. Every default is today's behaviour, and the version names the choice. */
  readonly options?: AttainmentOptions;
}

/**
 * Builds the v6 `masteryAtTime` value a review-log writer stamps onto a new
 * record: the displayed stage and the eligible vitality for every concept the
 * record names, and the arithmetic version that produced both. See the module
 * doc for which readings and why.
 *
 * Throws only on an invariant this module guarantees by construction (a
 * concept with no reading, or two readings that disagree on their version):
 * a stamp whose version describes one axis and not the other would be a false
 * record in her log, and a loud failure is the codebase's convention for an
 * invariant a later edit could break (`../registry/build.ts`).
 */
export function masteryAtTimeStamp(input: MasteryAtTimeStampInput): PerConceptMasteryAtTimeV6 {
  const ids = [...new Set(input.conceptIds)];
  if (ids.length === 0) {
    throw new Error('masteryAtTimeStamp: a review names at least one concept');
  }
  const schedulerVersion = input.scheduler.configuration?.version;
  const options: AttainmentOptions = {
    ...input.options,
    // The stage reads no scheduler; handing it the same version is what makes
    // the two readings name one arithmetic (`AttainmentOptions.schedulerVersion`).
    ...(schedulerVersion !== undefined ? { schedulerVersion } : {}),
  };

  const stages = readAllConceptAttainment(input.entries, ids, input.validity, options);
  const vitality = readAllEligibleConceptVitality(
    input.entries,
    ids,
    input.scheduler,
    input.now,
    input.holdingCut,
    input.validity,
    options,
  );

  const byConcept: Record<string, MasteryState> = {};
  const vitalityByConcept: Record<string, VitalityValue> = {};
  let arithmeticVersion: string | undefined;
  for (const id of ids) {
    const stage = stages.get(id);
    const reading = vitality.get(id);
    if (stage === undefined || reading === undefined) {
      throw new Error(`masteryAtTimeStamp: no reading for concept ${id}`);
    }
    if (stage.arithmeticVersion !== reading.arithmeticVersion) {
      throw new Error(
        'masteryAtTimeStamp: the stage and vitality readings name different arithmetic ' +
          `(${stage.arithmeticVersion} vs ${reading.arithmeticVersion})`,
      );
    }
    byConcept[id] = stage.displayed.state;
    vitalityByConcept[id] = reading.value;
    arithmeticVersion = reading.arithmeticVersion;
  }
  if (arithmeticVersion === undefined) {
    // Unreachable: `ids` is non-empty, so the loop assigned it.
    throw new Error('masteryAtTimeStamp: no arithmetic version was read');
  }

  // Key order is the contract's (`masteryAtTimeV6` extends the v5 arm), so the
  // line the writer lays out is the schema's own order.
  return { attribution: 'per-concept', byConcept, vitalityByConcept, arithmeticVersion };
}
