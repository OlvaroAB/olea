/**
 * What a walk of her vault produces (F2.5, F2.14, F2.17, C5.3, P2-T07).
 *
 * One record per instrument, carrying **both** halves of what the rest of the
 * system needs and deliberately keeping them separable:
 *
 *   - the queue's half — `instrumentId`, `instrumentType`, `conceptIds`,
 *     `courses` — which is exactly `QueueCandidate` minus the scheduling state
 *     that only a review-log replay can supply;
 *   - the renderer's half — the parsed instrument itself, plus the note title
 *     and path and block id a review view needs to show it and to jump back to
 *     it.
 *
 * They travel together because the alternative is walking the vault twice: once
 * to decide what to offer and once to render it, with two enumerations that can
 * disagree about what exists. `queue/types.ts` is explicit that a
 * `QueueCandidate` has no card text in it *on purpose* — composition must not
 * be able to branch on content — and that separation survives here, because the
 * composer is still handed `QueueCandidate`s and never sees this type.
 *
 * The parsed instrument is carried whole (`card` / `mcq`) rather than flattened
 * into a presentation shape. Flattening here would mean this module deciding
 * what an MCQ's options are, which is `mcq-present.ts`'s job and is per
 * *showing*, not per instrument (F2.15).
 */

import type { ConceptRecord } from '../concept/types.js';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import type {
  ClozeCardInstrument,
  InvalidMcqBlock,
  McqInstrument,
  QaCardInstrument,
} from '../instrument/types.js';
import type { VaultPath } from '../vault/types.js';

interface VaultInstrumentCommon {
  /** Persisted identity (R3). Minted by the one `InstrumentIdSource` seam — see `instrument-id.ts`. */
  readonly instrumentId: string;
  /**
   * Every concept this instrument practises, in her authored `topic:` order —
   * F2.17's dedupe key (a set) and the `conceptIds` written to the review log
   * (`ol-t3sd`).
   *
   * **All of them, not one chosen from several.** A note may name more than one
   * `topic:`, every one of them is a real concept the note contributes to
   * (`concept/extract.ts` records the note under all of them), and the
   * instrument is evidence for all of them. The predecessor field was a single
   * `conceptId` holding her *first* value — a narrowing D-031 was forced into
   * by a review-log record that could persist only one id, and removed by the
   * ruling on `ol-t3sd` once it could persist a list.
   *
   * Non-empty: an instrument whose note resolves to no concept appears in
   * `unbound`, never here with an invented entry.
   */
  readonly conceptIds: readonly string[];
  /** Course codes of every one of `conceptIds`' concepts, verbatim (R1/R2), M:N — see `QueueCandidate.courses`. */
  readonly courses: readonly string[];
  readonly notePath: VaultPath;
  /** The note's filename without its extension. Never read from real-vault content (INV-3). */
  readonly noteTitle: string;
  /** The note's `olea-uid`, or `null`. Read only — nothing in this pipeline stamps one (D-030). */
  readonly noteUid: string | null;
  /** The instrument's `^blockid` (C1.4), or `null`. */
  readonly blockId: string | null;
  /** Text of the nearest heading above the instrument, or `null`. */
  readonly heading: string | null;
  /** 1-based position within this instrument's anchor — the id's ordinal component. */
  readonly ordinal: number;
}

export interface QaInstrumentRecord extends VaultInstrumentCommon {
  readonly instrumentType: 'qa';
  readonly card: QaCardInstrument;
}

export interface ClozeInstrumentRecord extends VaultInstrumentCommon {
  readonly instrumentType: 'cloze';
  readonly card: ClozeCardInstrument;
}

export interface McqInstrumentRecord extends VaultInstrumentCommon {
  readonly instrumentType: 'mcq';
  readonly mcq: McqInstrument;
}

export type VaultInstrumentRecord =
  | QaInstrumentRecord
  | ClozeInstrumentRecord
  | McqInstrumentRecord;

/**
 * A block that claimed to be an MCQ and is not, with the note it is in.
 *
 * Reported, never dropped — `mcq-format.ts` already refuses to return it as an
 * instrument, and this carries that refusal up to a caller that can tell her
 * *which note*. An instrument that vanishes because of a typo is worse than one
 * that never existed.
 */
export interface InvalidMcqReport {
  readonly notePath: VaultPath;
  readonly block: InvalidMcqBlock;
}

/**
 * An instrument in a note that names no concept.
 *
 * Also reported rather than dropped, and for the same reason: it is a real
 * instrument she wrote, and it is invisible to the queue (nothing can dedupe
 * it, count it or log it without a concept). The fixture-vault suite
 * asserts the corpus has none of these; a live vault will, and she should be
 * able to be told.
 */
export interface UnboundInstrumentReport {
  readonly notePath: VaultPath;
  readonly instrumentType: SchedulableInstrumentType;
  /** Where in the note, so a caller can point at it. */
  readonly span: { readonly start: number; readonly end: number };
}

/** Everything one walk of the vault found. */
export interface VaultInstrumentEnumeration {
  /** Every schedulable, concept-bound instrument, in vault order then source order. */
  readonly records: readonly VaultInstrumentRecord[];
  readonly invalidMcqBlocks: readonly InvalidMcqReport[];
  readonly unbound: readonly UnboundInstrumentReport[];
  /**
   * `extractConcepts`'s own result for this walk, passed through — the walk
   * already calls it internally to bind instruments to concepts, and a
   * caller that also needs the concept records (e.g. `gap/build.ts`'s
   * `buildMaterialPresence`) would otherwise have to re-walk the vault a
   * second time to get them. Additive: existing callers that only read
   * `records`/`invalidMcqBlocks`/`unbound` are unaffected.
   */
  readonly concepts: readonly ConceptRecord[];
}
