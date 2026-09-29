/**
 * The instrument target record (`[D-437]`, design section 1.2, R1 — ratified 2026-09-29, row 36):
 * the ONE per-instrument record in Olea's own layer that holds what a newly authored instrument
 * was authored to ask, in the existing demand vocabulary (`PaperDemand`, `[D-262]`).
 *
 * **Reuse, not a parallel field.** `[D-277]` (h) already says what an instrument's demand is:
 * `declaredDemand` "records authoring intent in the existing demand vocabulary and nothing
 * downstream may read it as checked delivery", with one canonical home. This record IS that home:
 * the field is named `declaredDemand` and typed `PaperDemand`, exactly as in the learning-target
 * bundle (`olea-contracts`' `explainBackJudgeLearningTarget`). TARGET-3's specification, when its
 * evidence gate is met, lands in this record's optional `specification` member, and its own
 * `declaredDemand` must equal the record's — checked on write AND on read, the record's being
 * canonical because it exists whether or not a specification does.
 *
 * ===========================================================================
 * INTENT IS NOT EVIDENCE OF DELIVERY
 * ===========================================================================
 * `demandBasis` is the literal `'authoring-intent'`. **No code path writes another value**: the
 * writer takes no `demandBasis` at all and stamps the literal itself, and the reader refuses a
 * file that carries anything else. A future reading of delivery, if one is ever ruled, is a
 * different record kind, never a second value of this field. Nothing here says an item was
 * checked (that is `[D-277]` (c)'s separate validation receipt) and no consumer may read a
 * `declaredDemand` as "she has shown this demand".
 *
 * ===========================================================================
 * SHAPE: MIRRORS `distractor-provenance-store.ts`, RIGHT DOWN TO THE FAILURE POSTURE
 * ===========================================================================
 * Same dot-prefixed `.olea/` folder, whole-file JSON, hand-rolled runtime guard (no schema
 * library in this package), `VaultSource`-parameterised, no `obsidian` import (INV-1), write-once,
 * and no listing function: an instrument id is addressed exactly, never discovered by scanning.
 * One difference is deliberate. The sibling sidecars fold "no file" and "unreadable file" into one
 * `undefined`; the demand reading must tell them apart (`unspecified` versus `unreadable`, design
 * section 3.2, and the attainment fold counts the second), so `readInstrumentTarget` returns a
 * three-way result instead. It still never throws.
 *
 * ===========================================================================
 * WHO MAY WRITE, AND WHEN
 * ===========================================================================
 * Written once, at materialisation, for a newly authored instrument whose request carried a
 * demand the author acknowledged (B4), and by paper hand-off when the slot's demand was read
 * rather than defaulted (B7). Never written on answering, opening, rescheduling, reviewing or
 * revising, never backfilled, never assigned to a legacy instrument: **absence of a record is the
 * unspecified state and it is permanent** (`[D-277]` (f)). `target-store-callers.spec.ts` pins the
 * caller list, so a backfill path cannot appear without that test failing.
 *
 * The record deliberately carries no user wording: the demand is one of five words, the binding a
 * one-way digest, the generator stamp a task id and a prompt version (D7.3). The heading a
 * request came from is NOT stored here (row 35's "the source heading survives downstream" is met
 * by the transient need and the authoring outcome; storing it would be a further persisted field,
 * which is Class C and unruled).
 */

import { hashText } from '../ingestion/hash.js';
import { PAPER_DEMANDS, type PaperDemand } from '../oracle/paper-types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { ClozeCardInstrument, McqInstrument, QaCardInstrument } from './types.js';

/** The vault folder this module owns. Dot-prefixed, sibling to `.olea/citations/` and `.olea/distractor-provenance/`. */
export const INSTRUMENT_TARGET_STORE_FOLDER: VaultPath = '.olea/instrument-targets';

/** The record's own schema version — a breaking change to the shape gets a new literal, never an edit to this one. */
export const INSTRUMENT_TARGET_SCHEMA_VERSION = 'instrument-target.v1' as const;

/** The one value `demandBasis` ever takes. See the module doc. */
export const INSTRUMENT_TARGET_DEMAND_BASIS = 'authoring-intent' as const;

/**
 * Which origin asked for the demand (design section 4.1). Closed: a sixth origin is a persisted
 * vocabulary change and so Class C.
 */
export const INSTRUMENT_TARGET_ORIGINS = Object.freeze([
  'heading-cue',
  'sweep',
  'planner-need',
  'revision',
  'paper-handoff',
] as const);
export type InstrumentTargetOrigin = (typeof INSTRUMENT_TARGET_ORIGINS)[number];

/** Which generator and prompt version authored the item (D7.3 stamping). */
export interface InstrumentTargetGenerator {
  readonly taskId: string;
  readonly promptVersion: string;
}

/**
 * TARGET-3's member, absent until its evidence gate is met. Its shape is `[D-277]` (g)'s ruled
 * bundle, not re-decided here, so `bundle` is opaque to this module except for the one field
 * this record must agree with: `bundle.declaredDemand`.
 */
export interface InstrumentTargetSpecification {
  readonly bundle: unknown;
  readonly digest: string;
}

/** One record under `.olea/instrument-targets/`. */
export interface InstrumentTargetRecord {
  readonly schemaVersion: typeof INSTRUMENT_TARGET_SCHEMA_VERSION;
  /** The `[D-177]`-frozen instrument id. */
  readonly instrumentId: string;
  /** Condition 2, in the stored file: this is intent. See the module doc. */
  readonly demandBasis: typeof INSTRUMENT_TARGET_DEMAND_BASIS;
  /** The canonical home of the instrument's demand (`[D-277]` (h)). */
  readonly declaredDemand: PaperDemand;
  readonly origin: InstrumentTargetOrigin;
  /**
   * Digest of the question and keyed answer as materialised (`questionBindingOf`). A mismatch with
   * the current block reads stale (`demand-reading.ts`).
   */
  readonly questionBinding: string;
  /** ISO-8601, when the record was written. */
  readonly authoredAt: string;
  readonly generator: InstrumentTargetGenerator;
  readonly specification?: InstrumentTargetSpecification;
}

/**
 * What a caller supplies to write one. `schemaVersion` and `demandBasis` are absent on purpose:
 * the writer stamps both literals, so there is no argument through which another basis could be
 * written.
 */
export type NewInstrumentTarget = Omit<InstrumentTargetRecord, 'schemaVersion' | 'demandBasis'>;

/** What `readInstrumentTarget` found. Never an exception. */
export type InstrumentTargetRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'record'; readonly record: InstrumentTargetRecord };

// ---------------------------------------------------------------------------
// The question binding: one function, one meaning
// ---------------------------------------------------------------------------

/** Names the digest's encoding, so a future change to what is bound gets a new scheme rather than an edit. */
export const QUESTION_BINDING_SCHEME = 'olea-question-binding/1';

/**
 * The parts of a current block the binding reads: the question and the keyed answer, and nothing
 * else. A distractor, the feedback or a scheduling comment changing does not change what the item
 * asks or keys, so it does not stale the demand; a change to the stem, the front, the back, the
 * blanked span or the key does.
 */
export type QuestionBindingBlock =
  | Pick<QaCardInstrument, 'type' | 'front' | 'back'>
  | Pick<ClozeCardInstrument, 'type' | 'before' | 'clozeText' | 'after'>
  | Pick<McqInstrument, 'type' | 'stem' | 'answer'>;

/**
 * The digest of one block's question and keyed answer: SHA-256 (`hashText`) of an unambiguous JSON
 * encoding of the scheme tag, the instrument type and its question and key fields, as lowercase
 * hex. Deterministic and one-way; it carries none of her wording.
 *
 * **One function.** The materialiser computes it to write the record and the reader computes it
 * again to compare, so a hand edit to the block makes the record stale in exactly one place.
 * `[D-277]` (e) requires the learning-target specification to bind to the question text the same
 * way; TARGET-3's eligibility projection must call this function, not derive a second one.
 * (Open point recorded on the bead: the bundle contract types `questionBinding` as a free
 * non-empty string, and the acceptance harness draft describes it as a sentence. Until TARGET-3
 * reconciles the two, this digest is the record's binding and the bundle's is its own.)
 */
export async function questionBindingOf(block: QuestionBindingBlock): Promise<string> {
  switch (block.type) {
    case 'qa':
      return hashText(JSON.stringify([QUESTION_BINDING_SCHEME, 'qa', block.front, block.back]));
    case 'cloze':
      return hashText(
        JSON.stringify([
          QUESTION_BINDING_SCHEME,
          'cloze',
          block.before,
          block.clozeText,
          block.after,
        ]),
      );
    case 'mcq':
      return hashText(JSON.stringify([QUESTION_BINDING_SCHEME, 'mcq', block.stem, block.answer]));
  }
}

// ---------------------------------------------------------------------------
// Runtime guard
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPaperDemand(value: unknown): value is PaperDemand {
  return typeof value === 'string' && (PAPER_DEMANDS as readonly string[]).includes(value);
}

function isOrigin(value: unknown): value is InstrumentTargetOrigin {
  return (
    typeof value === 'string' && (INSTRUMENT_TARGET_ORIGINS as readonly string[]).includes(value)
  );
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_8601.test(value) && !Number.isNaN(Date.parse(value));
}

function isGenerator(value: unknown): value is InstrumentTargetGenerator {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isNonEmptyString(v.taskId) && isNonEmptyString(v.promptVersion);
}

/** `true` when a specification's own `declaredDemand` agrees with the record's. */
function specificationAgrees(
  specification: InstrumentTargetSpecification,
  declaredDemand: PaperDemand,
): boolean {
  const bundle = specification.bundle;
  if (typeof bundle !== 'object' || bundle === null) return false;
  return (bundle as Record<string, unknown>).declaredDemand === declaredDemand;
}

function isSpecification(
  value: unknown,
  declaredDemand: PaperDemand,
): value is InstrumentTargetSpecification {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.digest)) return false;
  return specificationAgrees(v as unknown as InstrumentTargetSpecification, declaredDemand);
}

/**
 * Runtime validation, in the hand-rolled-guard style of the sibling stores. A file that carries a
 * `demandBasis` other than the literal, a word outside the five, or a specification that
 * disagrees with the record's own demand is not a record.
 */
export function isInstrumentTargetRecord(value: unknown): value is InstrumentTargetRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== INSTRUMENT_TARGET_SCHEMA_VERSION) return false;
  if (!isNonEmptyString(v.instrumentId)) return false;
  if (v.demandBasis !== INSTRUMENT_TARGET_DEMAND_BASIS) return false;
  if (!isPaperDemand(v.declaredDemand)) return false;
  if (!isOrigin(v.origin)) return false;
  if (!isNonEmptyString(v.questionBinding)) return false;
  if (!isIsoTimestamp(v.authoredAt)) return false;
  if (!isGenerator(v.generator)) return false;
  if (v.specification !== undefined && !isSpecification(v.specification, v.declaredDemand)) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Path, write, read
// ---------------------------------------------------------------------------

/**
 * The vault path for one instrument's target record. `encodeURIComponent` for the reason
 * `citationStorePath` gives: an instrument id is not necessarily filesystem-safe unescaped.
 */
export function instrumentTargetStorePath(instrumentId: string): VaultPath {
  return `${INSTRUMENT_TARGET_STORE_FOLDER}/${encodeURIComponent(instrumentId)}.json`;
}

function serialize(record: InstrumentTargetRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * Writes one instrument's target record, write-once. Throws, before touching the vault, when the
 * input would not read back as a record (a word outside the five, a blank id, a specification
 * whose `declaredDemand` differs from the record's), and throws when a record already exists under
 * the id, leaving the file that exists untouched. Only two production callers may exist
 * (materialisation and paper hand-off); see the module doc and `target-store-callers.spec.ts`.
 */
export async function writeInstrumentTarget(
  vault: VaultSource,
  input: NewInstrumentTarget,
): Promise<void> {
  const record: InstrumentTargetRecord = {
    schemaVersion: INSTRUMENT_TARGET_SCHEMA_VERSION,
    instrumentId: input.instrumentId,
    demandBasis: INSTRUMENT_TARGET_DEMAND_BASIS,
    declaredDemand: input.declaredDemand,
    origin: input.origin,
    questionBinding: input.questionBinding,
    authoredAt: input.authoredAt,
    generator: { taskId: input.generator.taskId, promptVersion: input.generator.promptVersion },
    ...(input.specification === undefined
      ? {}
      : {
          specification: { bundle: input.specification.bundle, digest: input.specification.digest },
        }),
  };
  if (!isInstrumentTargetRecord(record)) {
    throw new Error(
      `writeInstrumentTarget: the record for instrument id ${JSON.stringify(input.instrumentId)} is not a valid instrument-target.v1 record — refusing to write it`,
    );
  }
  const path = instrumentTargetStorePath(record.instrumentId);
  if (await vault.exists(path)) {
    throw new Error(
      `writeInstrumentTarget: instrument id ${JSON.stringify(record.instrumentId)} already has a target record — refusing to overwrite an immutable record`,
    );
  }
  await vault.write(path, serialize(record));
}

/**
 * Reads one instrument's target record by id. Never throws. `absent` is the unspecified state
 * (no file, or an empty id that no file could belong to); `unreadable` is a file that is there and
 * is not a valid record for THIS id (corrupt JSON, the wrong shape, a `demandBasis` other than the
 * literal, an id that does not match the path, a specification that disagrees). The two are kept
 * apart because the demand reading counts the second and never confuses it with the first.
 */
export async function readInstrumentTarget(
  vault: VaultSource,
  instrumentId: string,
): Promise<InstrumentTargetRead> {
  if (instrumentId.length === 0) return { kind: 'absent' };
  const path = instrumentTargetStorePath(instrumentId);
  try {
    if (!(await vault.exists(path))) return { kind: 'absent' };
    const parsed: unknown = JSON.parse(await vault.read(path));
    if (isInstrumentTargetRecord(parsed) && parsed.instrumentId === instrumentId) {
      return { kind: 'record', record: parsed };
    }
    return { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}
