/**
 * `[D-438]` condition 4 / T16 (design `demand-carriage.md` section 5.3): yield reported against the
 * ORIGINAL structure, by demand. A projection, never stored, over a paper's items and empty slots
 * plus the two blueprint fields P1 added (`structureSlotCount`, `intendedDemandBasis`).
 *
 * - The headline is `filled / structureSlots`. One filled slot of eight reads one eighth whatever
 *   happened to the other seven; unreached template slots stay in the denominator.
 * - `yieldOverAttempted` (filled over slots that reached generation) exists only to be printed
 *   BESIDE the headline.
 * - `rank-excluded` slots are extent, set aside by the paper's size: they are not template slots,
 *   so they are in neither `byDemand` nor `unreachedSlots`.
 * - A demand's `structureShare` is `null` when the basis is a default: a default is not a reading.
 * - Reasons stay apart in `emptyByReason`; this module words nothing she reads.
 */

import { paperYieldAgainstStructure } from './paper-structure.js';
import {
  PAPER_DEMANDS,
  type PaperBlueprintDemandBasis,
  type PaperDemand,
  type PaperEmptySlot,
  type PaperEmptySlotReasonCode,
} from './paper-types.js';

export interface PaperDemandCoverageInput {
  readonly structureSlotCount: number;
  /** The composition-wide demand: what a slot with no demand of its own (a record from before P2) intended. */
  readonly compositionDemand: PaperDemand;
  readonly intendedDemandBasis: PaperBlueprintDemandBasis;
  /** Each demand's share of the read structure's marks, when known. Ignored under a default basis. */
  readonly demandShares?: ReadonlyMap<PaperDemand, number> | null;
  readonly items: readonly { readonly intendedDemand: PaperDemand }[];
  readonly emptySlots: readonly Pick<PaperEmptySlot, 'reasonCode' | 'intendedDemand'>[];
}

export interface PaperDemandCoverageRow {
  readonly demand: PaperDemand;
  readonly structureShare: number | null;
  readonly intendedSlots: number;
  readonly filled: number;
  readonly emptyByReason: Readonly<Partial<Record<PaperEmptySlotReasonCode, number>>>;
}

export interface PaperDemandCoverage {
  readonly structureSlots: number;
  readonly filled: number;
  /** `null` when the structure named no slots: no figure beats an invented one. */
  readonly yieldAgainstStructure: number | null;
  /** Filled over slots that reached generation. Print only beside `yieldAgainstStructure`; `null` when none reached it. */
  readonly yieldOverAttempted: number | null;
  readonly byDemand: readonly PaperDemandCoverageRow[];
  /** Template slots no eligible concept reached (never negative). */
  readonly unreachedSlots: number;
}

/** Slots that reached a generator: it was asked, so it filled or refused. */
const REACHED_GENERATION: ReadonlySet<PaperEmptySlotReasonCode> = new Set(['generator-refused']);

export function projectPaperDemandCoverage(input: PaperDemandCoverageInput): PaperDemandCoverage {
  const filled = input.items.length;
  const templateEmpties = input.emptySlots.filter((e) => e.reasonCode !== 'rank-excluded');
  const attempted =
    filled + templateEmpties.filter((e) => REACHED_GENERATION.has(e.reasonCode)).length;
  const headline = paperYieldAgainstStructure(input.structureSlotCount, filled);

  const rows = new Map<
    PaperDemand,
    { filled: number; intended: number; by: Map<PaperEmptySlotReasonCode, number> }
  >();
  const row = (demand: PaperDemand) => {
    let r = rows.get(demand);
    if (r === undefined) {
      r = { filled: 0, intended: 0, by: new Map() };
      rows.set(demand, r);
    }
    return r;
  };
  for (const item of input.items) {
    const r = row(item.intendedDemand);
    r.filled += 1;
    r.intended += 1;
  }
  for (const empty of templateEmpties) {
    const r = row(empty.intendedDemand ?? input.compositionDemand);
    r.intended += 1;
    r.by.set(empty.reasonCode, (r.by.get(empty.reasonCode) ?? 0) + 1);
  }
  const shares = input.intendedDemandBasis === 'read' ? (input.demandShares ?? null) : null;
  // A minority demand read from the structure shows its share with zero filled, stated.
  for (const [demand, share] of shares ?? []) if (share > 0) row(demand);

  const byDemand = PAPER_DEMANDS.filter((d) => rows.has(d)).map(
    (demand): PaperDemandCoverageRow => {
      const r = rows.get(demand) as NonNullable<ReturnType<typeof rows.get>>;
      return {
        demand,
        structureShare: shares?.get(demand) ?? null,
        intendedSlots: r.intended,
        filled: r.filled,
        emptyByReason: Object.fromEntries(r.by),
      };
    },
  );

  return {
    structureSlots: headline.structureSlots,
    filled,
    yieldAgainstStructure: headline.yield,
    yieldOverAttempted: attempted > 0 ? filled / attempted : null,
    byDemand,
    unreachedSlots: Math.max(0, input.structureSlotCount - filled - templateEmpties.length),
  };
}
