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
import type { Provenance } from '../extract/types.js';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import type {
  ClozeCardInstrument,
  InvalidCardBlock,
  InvalidClozeBlock,
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
  /**
   * The passage this instrument was generated FROM — as distinct from
   * `notePath`/`heading`/`blockId` above, which say where it now *lives* —
   * `[D-082]`/`[D-171]`'s passage-grain provenance, reusing
   * `../extract/types.js`'s `Provenance` rather than a second scheme
   * (`[D-085]`).
   *
   * **Optional and `undefined` for every record `enumerate.ts` produces
   * today.** This walk is read-only over instruments she has already
   * written INTO a note (this module's own doc: "the only place a note's
   * bytes become an instrument record") — it has a hand-authored
   * `^blockid`/heading pair to report, never a generation-time citation to
   * the PDF/PPTX page or slide the material came from, because nothing in
   * this pipeline generates instruments from extracted passages yet. The
   * field is threaded here so `../registry/build.ts`'s
   * `RegistrySourceLocation` has somewhere honest to read page/section grain
   * from once a generation-time caller populates it; until then it stays
   * absent, never guessed from `notePath`/`heading` alone.
   */
  readonly sourceProvenance?: Provenance;
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
  /**
   * `[D-323]`'s standing check (`ol-egov.141.89.6.4`) needs to name *which*
   * instrument an M5 defect (`block.reason === 'unresolved-asset'`) belongs
   * to, for one that already reached grading before its embed stopped
   * resolving. Present only when this walk actually has the identity fields
   * `instrument-id.ts`'s rule needs to derive one — today that is exactly the
   * M5 case: the block had already parsed into a real MCQ (blockId/
   * explicitId known) before the vault-wide asset check withheld it. Absent
   * for every other `McqInvalidReason` (M1-M4): those are refused inside
   * `mcq-format.ts`, which has no vault access and reports no blockId/
   * explicitId for a block that failed to parse — this walk has nothing to
   * derive an id from, so it reports nothing rather than guessing one from
   * `raw`/`span` alone. Deriving this never changes which block is valid,
   * never makes an invalid block servable, and yields the exact id the same
   * block would get were its asset to resolve (`enumerate.spec.ts`'s "valid
   * vs M5-invalid" pair pins this).
   */
  readonly instrumentId?: string;
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

/**
 * A block that carried a Q&A separator and did not parse into a card, with
 * the note it is in.
 *
 * `ol-v7r5.72`: mirrors `InvalidMcqReport` for the same reason `InvalidCardBlock`
 * mirrors `InvalidMcqBlock` (`../instrument/types.js`) — a Q&A card that
 * declared itself and failed must be as visible as a broken MCQ block already
 * is, instead of vanishing from `records` with nothing shown to her.
 */
export interface InvalidCardReport {
  readonly notePath: VaultPath;
  readonly block: InvalidCardBlock;
  /**
   * The Q&A counterpart of `InvalidMcqReport.instrumentId` — same reason,
   * same M5-only scope (mirrors that field; see its doc for the M1-M4
   * underivable case, which applies here identically).
   */
  readonly instrumentId?: string;
}

/**
 * A line that opened a cloze delimiter and did not become a cloze card, with
 * the note it is in.
 *
 * `[D-334]` (`ol-v7r5.90`): mirrors `InvalidMcqReport`/`InvalidCardReport` for
 * the same reason those two mirror each other — a cloze she started typing
 * and mistyped must be as visible as a broken MCQ or Q&A card, not silently
 * absent from every list `enumerateVaultInstruments` returns.
 */
export interface InvalidClozeReport {
  readonly notePath: VaultPath;
  readonly block: InvalidClozeBlock;
}

/** Everything one walk of the vault found. */
export interface VaultInstrumentEnumeration {
  /** Every schedulable, concept-bound instrument, in vault order then source order. */
  readonly records: readonly VaultInstrumentRecord[];
  readonly invalidMcqBlocks: readonly InvalidMcqReport[];
  /** `ol-v7r5.72`: the Q&A-card counterpart of `invalidMcqBlocks`, added so a consumer can read both. */
  readonly invalidCardBlocks: readonly InvalidCardReport[];
  /** `[D-334]` (`ol-v7r5.90`): the cloze counterpart of the two lists above. */
  readonly invalidClozeBlocks: readonly InvalidClozeReport[];
  readonly unbound: readonly UnboundInstrumentReport[];
  /**
   * `extractConcepts`'s own result for this walk, passed through — the walk
   * already calls it internally to bind instruments to concepts, and a
   * caller that also needs the concept records (e.g. `gap/build.ts`'s
   * `buildMaterialPresence`) would otherwise have to re-walk the vault a
   * second time to get them. Additive: existing callers that only read
   * `records`/`invalidMcqBlocks`/`invalidCardBlocks`/`unbound` are unaffected.
   */
  readonly concepts: readonly ConceptRecord[];
}
