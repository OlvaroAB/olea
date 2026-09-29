/**
 * What one instrument declares now (`[D-437]`, design section 3.2): the ONE reading every consumer
 * uses of an instrument's target record against the instrument's current block.
 *
 * ```
 *   declared    a record, current with the block — the instrument was authored to ask this
 *   stale       a record whose question binding no longer matches the block (a hand edit)
 *   unspecified no record — every instrument that predates the build, and every one authored
 *               without an acknowledged demand; permanent, never assigned, never backfilled
 *   unreadable  a file is there and is not a valid record for this id
 * ```
 *
 * **`declared` reads as "the instrument was authored to ask this", and no more** (`[D-277]` (h),
 * `[D-262]`'s contract: "the declaration plus the slot's intent is the contract"). Nothing built on
 * this reading may say she has shown a demand on the strength of a declaration alone; a demand is
 * met only through `[D-349]`'s qualifying review (`../gap/demand.ts`).
 *
 * **What consumers do with each kind** (the design's table; only the fold's row is built here):
 * the attainment fold's demand rule declares that demand for `declared` and none for every other
 * kind (`projectInstrumentDemands`); the ordinary ladder, mastery and scheduling do not read this
 * at all; the explain-back bundle may be sent only for `declared`, inside a validated eligible
 * specification; instrumentation counts all four. "A missing specification is not missing
 * evidence" holds for the demand too: an unspecified instrument's reviews count for the ordinary
 * ladder exactly as before, and only never support a demand-shaped claim.
 *
 * **Free recall versus recognition is read from the block, never stored** (2026-09-29 ruling on
 * the sweep's demand, row 38: "distinguish free recall from recognition through answer options").
 * A `declared` reading carries `responseForm`: `recognition` when the instrument is a multiple-
 * choice block (it offers answer options), `free-recall` when it is a card. A recognition item
 * whose intent is `recall-a-fact` therefore never reads as free recall, whatever the record says,
 * and the fold's own rule (a multiple-choice review never meets `recall-a-fact`) has a reading it
 * can be checked against rather than the instrument type alone. The record itself stays intent.
 *
 * **No upgrade across a revision.** The reading is by the exact `instrumentId` asked for. A
 * successor instrument has its own id, so a predecessor's record is never read as the successor's
 * and the reverse; the fold never walks a succession chain to find a demand (`[D-437]` condition
 * 3: no historical evidence is upgraded).
 *
 * **Never throws.** A reader that could throw would let one corrupt sidecar take the gap view
 * down. Every failure is a reading (`unreadable`), which consumers count and treat as declaring
 * none.
 */

import type { PaperDemand } from '../oracle/paper-types.js';
import type { VaultSource } from '../vault/types.js';
import {
  type InstrumentTargetOrigin,
  type InstrumentTargetRead,
  type QuestionBindingBlock,
  questionBindingOf,
  readInstrumentTarget,
} from './target-store.js';

/** Free recall (a card: the answer is produced) or recognition (a multiple-choice block: the answer is chosen from options). */
export type InstrumentResponseForm = 'free-recall' | 'recognition';

export type InstrumentDemandReading =
  | {
      readonly kind: 'declared';
      readonly demand: PaperDemand;
      readonly origin: InstrumentTargetOrigin;
      readonly responseForm: InstrumentResponseForm;
    }
  | { readonly kind: 'stale'; readonly demand: PaperDemand }
  | { readonly kind: 'unspecified' }
  | { readonly kind: 'unreadable' };

/** Where the answer options are: a multiple-choice block offers them, a card does not. */
export function responseFormOf(block: Pick<QuestionBindingBlock, 'type'>): InstrumentResponseForm {
  return block.type === 'mcq' ? 'recognition' : 'free-recall';
}

/**
 * The pure half: classifies a store read against the block's CURRENT binding. `currentBinding` is
 * `undefined` when the binding could not be computed; a record whose binding cannot be compared is
 * `unreadable`, never `declared` on trust.
 */
export function classifyInstrumentDemand(
  read: InstrumentTargetRead,
  currentBinding: string | undefined,
  responseForm: InstrumentResponseForm,
): InstrumentDemandReading {
  if (read.kind === 'absent') return { kind: 'unspecified' };
  if (read.kind === 'unreadable') return { kind: 'unreadable' };
  if (currentBinding === undefined) return { kind: 'unreadable' };
  const { record } = read;
  if (record.questionBinding !== currentBinding) {
    return { kind: 'stale', demand: record.declaredDemand };
  }
  return {
    kind: 'declared',
    demand: record.declaredDemand,
    origin: record.origin,
    responseForm,
  };
}

/**
 * Reads one instrument's demand: the store's record for `instrumentId` compared with the
 * instrument's current block. Never throws, and writes nothing: a stale record is left exactly as
 * it is (it is immutable), and the reading is what changes.
 */
export async function readInstrumentDemand(
  vault: VaultSource,
  instrumentId: string,
  block: QuestionBindingBlock,
): Promise<InstrumentDemandReading> {
  try {
    const read = await readInstrumentTarget(vault, instrumentId);
    if (read.kind !== 'record')
      return classifyInstrumentDemand(read, undefined, responseFormOf(block));
    let currentBinding: string | undefined;
    try {
      currentBinding = await questionBindingOf(block);
    } catch {
      currentBinding = undefined;
    }
    return classifyInstrumentDemand(read, currentBinding, responseFormOf(block));
  } catch {
    return { kind: 'unreadable' };
  }
}

/**
 * The attainment fold's `instrumentDemands` input (`../gap/demand.ts`'s `DemandsMetInput`), built
 * from readings: `declared` instruments only, one demand each. A stale, unspecified or unreadable
 * instrument is absent from the map, which the fold already reads as "declares none". The map is
 * keyed by the exact instrument id the reading was made for.
 *
 * This projection is faithful to the declaration and does not apply the fold's own rules: a
 * recognition item declaring `recall-a-fact` is present here as declared intent, and the fold
 * (`demandsMetNow`) is what keeps a multiple-choice review from meeting a recall requirement.
 */
export function projectInstrumentDemands(
  readings: ReadonlyMap<string, InstrumentDemandReading>,
): ReadonlyMap<string, readonly PaperDemand[]> {
  const out = new Map<string, readonly PaperDemand[]>();
  for (const [instrumentId, reading] of readings) {
    if (reading.kind === 'declared') out.set(instrumentId, [reading.demand]);
  }
  return out;
}
