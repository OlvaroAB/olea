/**
 * Instrument formats as they exist **in her vault** (F2.1, F2.15, C5.3, C1.4).
 *
 * Two formats, two owners, and the difference is the whole reason this file
 * has two halves:
 *
 *   - **Q&A and cloze are somebody else's format.** C5.3 requires them to stay
 *     readable and editable in an Obsidian spaced-repetition plugin, so their
 *     shape is not ours to design — see `card-format.ts` for what the target
 *     format is and where that was established from.
 *   - **MCQ is Olea's own** (F2.15 — no SR plugin defines an MCQ format, so
 *     there is nothing for ours to interoperate with). See `mcq-format.ts`
 *     for the block and why it looks the way it does.
 *
 * Every parsed shape carries `raw` and `span`. That is not diagnostics — it is
 * how INV-2 survives contact with this module. A caller that wants to change
 * one instrument in a note edits its span through `block/edit.ts`; a caller
 * that merely read a note has nothing to write back, because reading produced
 * no re-rendered text to write.
 *
 * A third section lives at the bottom of this file, below the vault-format
 * types: **probe metadata** (`[D-263]`), which is not a vault format at all —
 * it declares a probe's `purpose` and, conditionally, its `applicationBoundary`
 * and exposure provenance, none of which are written into a note's bytes.
 * See that section's own module-level comment for why it lives here anyway.
 */

import type { InstrumentCitation } from './citation-store.js';

/** A byte range in the note's source, in UTF-16 code units. */
export interface SourceSpan {
  readonly start: number;
  /** Exclusive, such that `source.slice(start, end) === raw`. */
  readonly end: number;
}

/**
 * The four Q&A shapes the target SR plugin defines. Named for what they are in
 * that plugin's own settings (`singleLineCardSeparator`,
 * `singleLineReversedCardSeparator`, `multilineCardSeparator`,
 * `multilineReversedCardSeparator`) so the mapping is checkable rather than
 * remembered.
 */
export type QaCardStyle =
  | 'single-line'
  | 'single-line-reversed'
  | 'multi-line'
  | 'multi-line-reversed';

/** The cloze delimiters this module recognises. See `card-format.ts` for why bold is not one. */
export type ClozeDelimiter = '==' | '{{';

interface VaultInstrumentCommon {
  /** The exact source slice this instrument was parsed from. */
  readonly raw: string;
  readonly span: SourceSpan;
  /**
   * A `^blockid` found on the instrument's own line, if any (C1.4). Read here,
   * written only where `card-format.ts` documents that it writes one.
   */
  readonly blockId: string | null;
  /**
   * Another plugin's scheduling comment attached to this card, verbatim and
   * including its delimiters, or `null`.
   *
   * **Read-only, always.** C5.3's single-owner rule for scheduling state cuts
   * both ways: we do not read this as authority and we never write, edit or
   * delete it. It is surfaced so that
   * a card she has already been reviewing elsewhere can be *recognised* as
   * such, and so that its bytes are excluded from the card's answer text
   * rather than being shown to her as part of the answer.
   */
  readonly foreignScheduling: string | null;
}

export interface QaCardInstrument extends VaultInstrumentCommon {
  readonly type: 'qa';
  readonly style: QaCardStyle;
  readonly front: string;
  readonly back: string;
  /** True for the two reversed styles, which the plugin also reviews back-to-front. */
  readonly reversed: boolean;
}

export interface ClozeCardInstrument extends VaultInstrumentCommon {
  readonly type: 'cloze';
  readonly delimiter: ClozeDelimiter;
  /** Text on the line before the deletion. */
  readonly before: string;
  /** The blanked span, without its delimiters. */
  readonly clozeText: string;
  /** Text on the line after the deletion. */
  readonly after: string;
}

export type CardInstrument = QaCardInstrument | ClozeCardInstrument;

/** Why a block that carried a Q&A separator did not become a card. */
export type CardInvalidReason = 'missing-front' | 'missing-back';

/**
 * A block that carried a Q&A separator (`::`, `:::`, `?`, `??`) and did not
 * parse into a card because its front or back came out blank.
 *
 * Reported, never dropped — the same pattern as `InvalidMcqBlock` below,
 * named separately because a Q&A card's declaration (a reserved separator
 * appearing in her text) and an MCQ's (the fenced fence) are different
 * signals with different failure vocabularies. A card that vanishes silently
 * because a separator landed with nothing on one side is worse than one that
 * was never attempted: she wrote it, she expects to see it, and nothing
 * tells her why she does not.
 *
 * Cloze failures are **not** covered by this type: the parser only
 * recognises a *complete* `==…==`/`{{…}}` pair, so an unterminated cloze
 * attempt never declares itself the way a Q&A separator does — deciding what
 * counts as a declared-but-broken cloze is `M4` in brief 82's still-open
 * ruling (`ol-v7r5.67`), and is not invented here.
 */
export interface InvalidCardBlock {
  readonly reason: CardInvalidReason;
  /** Human-readable specifics — which separator, which side came out blank. */
  readonly detail: string;
  readonly raw: string;
  readonly span: SourceSpan;
}

/**
 * **F2.15's floor, enforced at the parse/serialize boundary.**
 *
 * The pool is distractors only; the correct answer is not one of them.
 *
 * **Lowered from 4 to 2 by `[D-195]` / `ol-2zfj.57`.** Before this ruling the
 * number here and `quiz.generate.v1`'s own `MIN_DISTRACTOR_POOL`
 * (`olea-service/src/tasks/quizGenerate.ts`) meant the same thing: a floor of
 * four *grounded* distractors, required on both the way in and the way out.
 * `[D-195]` found that coupling was itself the padding pressure it exists to
 * prevent — a model held to four grounded misconceptions manufactures a
 * fourth belief when only two or three genuinely exist for a concept — and
 * split the two numbers on purpose. The service's floor is now a
 * GENERATION-TIME minimum (2, unchanged by this bead); this one is the
 * PERSISTED/PRESENTATION floor, below which a block fails to parse and
 * `presentMcq` refuses outright — lowered to match, so the client can accept
 * and present exactly what a short-but-honest grounded pool actually
 * contains rather than reject or pad it. `scripts/check-instrument-floor.mjs`
 * (`olea-service`) documents the split and no longer asserts the two numbers
 * equal.
 *
 * **What this floor no longer guarantees on its own: rotation.**
 * `PRESENTED_DISTRACTORS` (below) draws up to that many from the pool, and at
 * the old floor of 4 that meant a genuine sample (`C(4,3) = 4` distinct
 * option sets). At this floor, a pool of exactly 2 or 3 cannot be sampled
 * down to 3 — `mcq-present.ts`'s `presentMcq` presents `min(
 * PRESENTED_DISTRACTORS, pool.length)` of them instead, shuffled, and never
 * pads with an invented option. F2.15's amendment names this "shuffle-only"
 * path as the ratified degrade: a short pool presents everything it has,
 * rather than being padded to hit a count or withheld outright. A block
 * below THIS floor (2) is still not a slightly-worse MCQ; it is a different
 * instrument wearing the same name, and it still fails to parse rather than
 * being accepted and quietly under-rotating.
 *
 * The generation schema enforces its own floor on the way in (amendment §5.2,
 * `ol-fyc`; renumbered to 2 by `[D-195]`). Two boundaries, two numbers now,
 * deliberately: generation is not the only way an MCQ can reach the vault —
 * she can type one — and the parse boundary is the one every MCQ crosses,
 * regardless of how honest the pool that reaches it is.
 */
export const MIN_DISTRACTOR_POOL = 2;

/**
 * How many distractors a single presentation samples from the pool (F2.15),
 * **when the pool is at least this large.** Below it — a pool of exactly
 * `MIN_DISTRACTOR_POOL` or anywhere between the two — `presentMcq` shows
 * `min(PRESENTED_DISTRACTORS, pool.length)` instead; see `mcq-present.ts`.
 */
export const PRESENTED_DISTRACTORS = 3;

/**
 * Options shown per presentation **at or above `PRESENTED_DISTRACTORS`'s own
 * pool size**: the sampled distractors plus the answer. A short pool (`[D-195]`)
 * presents `min(PRESENTED_DISTRACTORS, pool.length) + 1` instead — this
 * constant is the ceiling, not a guarantee, once `MIN_DISTRACTOR_POOL` no
 * longer equals `PRESENTED_DISTRACTORS + 1`'s own precondition.
 */
export const PRESENTED_OPTIONS = PRESENTED_DISTRACTORS + 1;

export interface McqInstrument {
  readonly type: 'mcq';
  /**
   * The `id:` field, or `null` for a block that has none.
   *
   * Hand-authored MCQs will not have one and are still valid instruments —
   * the format can *express* identity, which is all this bead owes; deriving
   * and stamping a stable instrument id for an un-`id`'d block belongs to
   * queue composition, and is filed rather than smuggled in here.
   */
  readonly id: string | null;
  /**
   * The `predecessor:` field — `[D-133]`'s revision-chain link, or `null` for
   * a block with none (every hand-authored MCQ, and any generated one that
   * is not a successor). Written once, by whatever materializes a successor
   * instrument (`packages/plugin/src/generation/materialize-mcq.ts`), never
   * recomputed thereafter — the same read-then-mint discipline `id` follows.
   * Names the PREDECESSOR instrument's id; this block's own id (above) is
   * the successor. The metadata-position field is the single source of
   * truth for the chain (see `packages/plugin/src/instrument-blocks/
   * predecessor.ts`'s module doc) — the review log's `succession` kind
   * records only the fact that succession happened, never a copy of it.
   */
  readonly predecessor: string | null;
  readonly stem: string;
  readonly answer: string;
  /** At least `MIN_DISTRACTOR_POOL` of them, guaranteed by the parser. */
  readonly distractors: readonly string[];
  /** Shown after she answers, regardless of correctness (F3.4's explanation). `null` when absent. */
  readonly feedback: string | null;
  /** The whole fenced block including both fence lines, byte-exact. */
  readonly raw: string;
  readonly span: SourceSpan;
  /**
   * The fence characters this block was actually written with, and the line
   * terminator it actually uses.
   *
   * These are *format* facts, not content, and they are carried for the same
   * reason `CodeBlock.fence` is: serializing a parsed instrument back has to be
   * a round-trip, not a reformat. Without them, writing an MCQ back would
   * normalise a `~~~~` fence to ``` ``` ``` and a CRLF note to LF — a diff she
   * never asked for, in the one place INV-2 is defined.
   */
  readonly fence: string;
  readonly terminator: '\n' | '\r\n';
}

/** Why a block that announced itself as an MCQ is not one. */
export type McqInvalidReason =
  | 'missing-stem'
  | 'missing-answer'
  | 'repeated-field'
  | 'insufficient-distractors'
  | 'duplicate-option'
  | 'empty-value'
  | 'unknown-field';

/**
 * A block that opened with the MCQ fence and did not parse.
 *
 * Reported, never dropped. A quiz item that vanishes silently because of a
 * typo is worse than one that never existed: she wrote it, she expects to see
 * it, and nothing tells her why she does not.
 */
export interface InvalidMcqBlock {
  readonly reason: McqInvalidReason;
  /** Human-readable specifics — which field, how many distractors were found. */
  readonly detail: string;
  readonly raw: string;
  readonly span: SourceSpan;
}

// ===========================================================================
// PROBE METADATA — `[D-263 / PROBE-1]`, knowledge model's Instrument row,
// vocabulary registry §14 ("Transfer probe vocabulary")
// ===========================================================================
//
// `ol-egov.141.47` ratified two purposes a generated instrument can declare —
// `wording-robustness` (same claim, new words) and `application` (a taught
// principle applied to material her notes did not describe — the only shape
// the registry allows calling a "transfer probe") — plus a first-recorded-
// exposure check every probe carries regardless of purpose. The registry's
// own words: "Class C: names the `purpose` and `applicationBoundary` fields
// on the instrument record" — the two field names below are not a design
// choice, they are already ratified vocabulary.
//
// **Metadata, never a fourth depth axis, never a number** (ruling 1's own
// insistence, repeated three times in the decision text so it cannot be
// missed): depth stays exactly R7's three response-form tiers
// (recognition/recall/explanation). Nothing here is folded into a score,
// averaged, or read by the mastery layer as evidence strength — a reader
// checks `purpose` to know WHAT KIND of evidence a success is, the same way
// `instrumentType` already says what FORM it took, and depth is unchanged
// either way.
//
// **Schema-version decision, settled ON THIS BEAD per its own brief, mirroring
// the review-log v5 precedent (`[D-117]`, `bd show ol-egov.41`):** this is a
// wholly NEW, additive bundle — nothing existing (`McqInstrument`,
// `CardInstrument`, `VaultInstrumentRecord` in `../session/types.js`) has its
// shape touched by this bead, and no field on any of those types changes
// meaning. `[D-117]`'s own reasoning for `ol-548w`'s `verdictLogRecordV4`
// applies verbatim: a genuinely new, previously-absent kind of information is
// added as its OWN schema-versioned unit rather than by bumping an unrelated
// existing version — "nothing about an *existing* kind's shape changed, so no
// bump was needed." `PROBE_METADATA_SCHEMA_VERSION` below is that unit's own
// version, starting at 1, exactly like `CITATION_RECORD_SCHEMA_VERSION` and
// `DISTRACTOR_PROVENANCE_RECORD_SCHEMA_VERSION` in this same directory did on
// their first day — never a bump to those, nor to any existing kind.
// Full argument and the migration story: `docs/dev/verdict-seam-design.md`
// §9 (this repo's sibling copy) — the design record for both the v5 bump
// this schema-version decision took as precedent AND this bundle's own
// versioning call.
//
// **Where this bundle lives is deliberately NOT decided here.** `types.ts`
// owns the shape; a persisted home (a `.olea/`-folder sidecar, mirroring
// `citation-store.ts`/`distractor-provenance-store.ts` in this same
// directory, keyed by the frozen instrument id) is `[PROBE-3]`'s
// (`ol-0r92.79`) job, alongside the generator that actually produces probes
// and the production caller that writes them — see that bead for the
// reachability half of `[D-072]`'s Definition of Done. This bead is the
// schema only.
//
// **D-005, applied at field-design time, not just at log time.** Every field
// below is a fixed enum label, a concept id, a citation-shaped structural
// pointer (`sourcePath`/`page`/`section` — the same non-content grain
// `citation-store.ts` already established), or an opaque reference — never a
// free-text description. This is a deliberate departure from the shape a
// first draft reaches for: `[D-263]`'s own application-boundary wording
// ("what changes from tasks she has already met, what stays constant, what
// reasoning she must supply, what would exceed the taught scope") reads like
// four prose fields, and prose is exactly the shape a scenario's specifics —
// drawn from her held material — could leak through. So none of those four
// live here as inline text: `ApplicationBoundary.boundarySpecRef` is an
// opaque pointer at an Olea-authored artifact holding that description,
// mirroring `explainBackGrade.contentRef`'s own reasoning in
// `contracts/review-log.ts` (the verdict is replayable because the content it
// graded is referenced, never inlined). The referent itself — a boundary-spec
// store — is `[PROBE-3]`'s to build, for the same reason the persisted home
// above is: nothing in THIS bead's owned files writes prose anywhere, so
// there is nothing here that could carry her wording even by accident.

/**
 * The two purposes a probe declares (`[D-263]` ruling 1; vocabulary registry
 * §14). `wording-robustness` asks the same claim under new words or framing;
 * `application` asks a taught principle applied to material her notes did not
 * describe, inside a declared `ApplicationBoundary` — the only one of the two
 * the registry permits calling a transfer probe. An ordinary, non-probe
 * instrument (everything written or generated before this decision, and
 * every hand-authored card or MCQ after it) declares no purpose at all —
 * there is no third enum member for "not a probe"; absence of
 * `ProbeMetadata` on a record is that state. See this file's module-level
 * "PROBE METADATA" comment for the schema-version and D-005 reasoning.
 */
export type InstrumentPurpose = 'wording-robustness' | 'application';

/**
 * The four dimensions `[D-263]` ruling 3 checks at generation to establish
 * **first recorded exposure** — never "unseen" (vocabulary registry §14's own
 * forbidden-framing rule): the exact item, the scenario with names or numbers
 * changed, the decisive solution pattern, and the assistance already shown.
 * Fixed at four, matching the ruling's own enumeration exactly — this is
 * ratified vocabulary, not an open set a future probe kind extends casually.
 */
export type ExposureDimension =
  | 'exact-item'
  | 'scenario'
  | 'decisive-solution-pattern'
  | 'assistance-shown';

/** Every `ExposureDimension`, in the order `[D-263]` ruling 3 lists them. */
export const EXPOSURE_DIMENSIONS: readonly ExposureDimension[] = [
  'exact-item',
  'scenario',
  'decisive-solution-pattern',
  'assistance-shown',
];

/**
 * What the exposure check found, one verdict per dimension, always all four —
 * a `Record` rather than a list of matches so "did we check this dimension"
 * can never drift from "how many matches came back": every key in
 * `EXPOSURE_DIMENSIONS` is always present, checked or not.
 *
 * `null` on a dimension means first recorded exposure on that dimension for
 * this probe. A string names the existing instrument (this concept's own
 * item, by its frozen id — never a copy of its scenario or wording) whose
 * prior exposure supplied that dimension — structural cross-reference only,
 * per this file's D-005 reasoning above.
 */
export type ExposureDimensionResult = Readonly<Record<ExposureDimension, string | null>>;

/**
 * A probe's first-recorded-exposure provenance (`[D-263]` ruling 3),
 * recorded at generation. Present on every probe regardless of `purpose` —
 * the check is not scoped to `application` alone, ruling 3's own text
 * describes it for "an additional item under the same concept, carrying its
 * purpose" without narrowing to one purpose.
 *
 * "Nothing resets" (ruling 3's own words): once a dimension has a match, nothing
 * here is ever recomputed to erase it. A later, separate generation call
 * produces its own new `ExposureProvenance` rather than mutating this one.
 */
export interface ExposureProvenance {
  readonly perDimension: ExposureDimensionResult;
}

/**
 * The target principle and its held source, at citation grain — reusing
 * `citation-store.ts`'s `InstrumentCitation` shape verbatim (`sourcePath`
 * plus optional `page`/`section`) rather than a new scheme, for the same
 * reason `[D-181]` gives there: this is a POINTER at held material, never the
 * material's own text.
 */
export interface ApplicationBoundary {
  /** The taught principle this boundary is drawn against — a concept id, never the principle's text. */
  readonly targetConceptId: string;
  /** Where in her held material that principle lives — citation grain, never quoted text. */
  readonly heldSource: InstrumentCitation;
  /**
   * Opaque pointer at the Olea-authored boundary description — what changes
   * from tasks she has already met, what stays constant, what reasoning she
   * must supply, what would exceed the taught scope (`[D-263]`'s own four
   * clauses). The prose itself is never inline here; see this file's
   * module-level "PROBE METADATA" comment for why, and `[PROBE-3]` for where
   * the referent is minted and stored.
   */
  readonly boundarySpecRef: string;
}

/**
 * Purpose and, when applicable, the application boundary and exposure
 * provenance `[D-263]` ruling 1 and 3 require every probe to carry —
 * metadata on the instrument record, never a fourth depth axis (this file's
 * module-level comment; `InstrumentPurpose`'s own doc).
 *
 * A discriminated union on `purpose` rather than an optional
 * `applicationBoundary` on one flat shape: `applicationBoundary` is
 * meaningful, and required, precisely when `purpose` is `'application'`, and
 * a TS discriminated union makes "a wording-robustness probe carrying a
 * boundary" and "an application probe carrying none" both unrepresentable
 * rather than merely undocumented. `isProbeMetadata` below enforces the same
 * invariant at the runtime/JSON boundary, matching this directory's existing
 * hand-rolled-guard style (`citation-store.ts`, `distractor-provenance-store.ts`).
 */
export type ProbeMetadata =
  | {
      readonly purpose: 'wording-robustness';
      readonly exposureProvenance: ExposureProvenance;
    }
  | {
      readonly purpose: 'application';
      readonly applicationBoundary: ApplicationBoundary;
      readonly exposureProvenance: ExposureProvenance;
    };

/**
 * `ProbeMetadata`'s own schema version, settled on `[PROBE-2]` (`ol-0r92.78`)
 * per this file's module-level "PROBE METADATA" comment. Starts at 1 because
 * nothing before this bead ever produced a `ProbeMetadata` value — there is
 * no prior version to be compatible with, and no migration function is
 * written for the same reason `[D-109]` gives review-log v5 none: nothing
 * real exists to migrate FROM. Bump this, never `CITATION_RECORD_SCHEMA_VERSION`
 * or `DISTRACTOR_PROVENANCE_RECORD_SCHEMA_VERSION`, if this bundle's own
 * shape later changes — the three are independent per the decision above.
 */
export const PROBE_METADATA_SCHEMA_VERSION = 1;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime validation, matching this directory's hand-rolled-guard style (no schema library in this package). */
export function isExposureDimensionResult(value: unknown): value is ExposureDimensionResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  for (const dimension of EXPOSURE_DIMENSIONS) {
    const entry = v[dimension];
    if (entry !== null && !isNonEmptyString(entry)) return false;
  }
  return true;
}

export function isExposureProvenance(value: unknown): value is ExposureProvenance {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isExposureDimensionResult(v.perDimension);
}

/**
 * Validates the bare `ApplicationBoundary` shape — the embedded pointer, not
 * a standalone file record, so unlike `citation-store.ts`'s `isCitationRecord`
 * this checks no `instrumentId`/`schemaVersion` of its own.
 */
export function isApplicationBoundary(value: unknown): value is ApplicationBoundary {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.targetConceptId)) return false;
  if (!isNonEmptyString(v.boundarySpecRef)) return false;
  if (typeof v.heldSource !== 'object' || v.heldSource === null) return false;
  const source = v.heldSource as Record<string, unknown>;
  if (!isNonEmptyString(source.sourcePath)) return false;
  if (source.page !== undefined && typeof source.page !== 'number') return false;
  if (source.section !== undefined && !isNonEmptyString(source.section)) return false;
  return true;
}

/**
 * Validates `ProbeMetadata` at the runtime/JSON boundary, enforcing the same
 * purpose/boundary pairing the type already enforces at compile time — a
 * malformed record (an `application` purpose with no boundary, or a
 * `wording-robustness` purpose carrying one) is rejected rather than
 * silently accepted with an absent field. `undefined`/absence is NOT this
 * function's job: a caller holding an optional `probeMetadata?: ProbeMetadata`
 * field checks presence itself (this bundle is metadata on a record, never
 * the record itself — see the module-level comment) — this function only
 * validates a value that IS present.
 */
export function isProbeMetadata(value: unknown): value is ProbeMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isExposureProvenance(v.exposureProvenance)) return false;
  if (v.purpose === 'wording-robustness') {
    return v.applicationBoundary === undefined;
  }
  if (v.purpose === 'application') {
    return isApplicationBoundary(v.applicationBoundary);
  }
  return false;
}
