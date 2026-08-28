/**
 * The concept and instrument registry's data shape (`[REG-1]`, `ol-4v2l`,
 * F8.4/F8.4a/F8.5, `[D-135]`).
 *
 * ## What this module is, and what it deliberately is not
 *
 * `RegistryModel` is the one browsable inventory F8.4 asks for: her concepts,
 * their course associations (C7.2, M:N), their instrument mix, and their
 * two-axis mastery (F2.11). Nothing here computes a NEW fact — every field is
 * assembled from projections this codebase already has (`../concept/extract.js`
 * / `../session/enumerate.js` for the vault walk, `../mastery/rollup.js` for
 * stage and vitality, `../review-log/suspension.js` for the withdrawn set)
 * plus two things genuinely new to this bead: a local display-name override
 * (rename, F8.4's own words: "cache state no Obsidian affordance can reach")
 * and a local withdrawn-concept flag (prune, F8.5).
 *
 * **Split/merge are out of scope by `[D-135]`.** F8.6 defers both post-v0.9,
 * and `ol-4v2l`'s acceptance was amended to match — this model carries no
 * `parent`/`offshoot` field and no merge-candidate field. A concept's lineage
 * is real (C7.10 is a separate relation set, F8.6 a separate one again) but
 * neither has a reader here; adding one is the post-v0.9 bead's job, against
 * the DSN-3 drawing, not an improvisation riding on this type.
 *
 * ## Rename: display-only, and honestly scoped
 *
 * F8.4's contract text says a rename "mutates the name field on the stable
 * key (C7.11)". `../concept/types.ts`'s own doc records that C7.11's key is
 * still **provisional** — minted fresh per extraction, not yet stable across
 * a note rename or a `topic:` edit. This module cannot honestly promise the
 * contract's stronger claim (a persisted mutation on a stable identity) until
 * that key work lands. What it delivers instead, as a named Class B default:
 * a local, per-install override — `{ displayName, aliases }` keyed by
 * whatever key this run's extraction minted — that this browse surface
 * overlays on top of the raw `ConceptRecord.name` every time it loads. It is
 * never written into her vault (INV-6) and it does not yet feed retrieval or
 * the keyword index — "her old wording still resolves" (F8.4) is a promise
 * this override does not keep on its own; a follow-up bead wires the alias
 * into whatever reads concept names for matching, once C7.11's key is real.
 */

import type { MasteryState, ReviewLogEntry } from 'olea-contracts';
import type { ConceptRecord, ConceptTier } from '../concept/types.js';
import type {
  ConceptMasteryEvidence,
  ConceptMasteryResult,
  EvidenceTier,
} from '../mastery/rollup.js';
import type { VitalityReading } from '../mastery/vitality.js';
import type { Scheduler } from '../scheduler/types.js';
import type { VaultInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';

export type {
  ConceptMasteryEvidence,
  ConceptMasteryResult,
  EvidenceTier,
  MasteryState,
  ReviewLogEntry,
};

/**
 * One instrument in a concept's mix, as the registry shows it. A thin
 * projection of `VaultInstrumentRecord` — carries only what the browse row
 * and the edit/prune affordances need, never the parsed card/MCQ body (F8.4
 * hands editing to Obsidian; this surface never renders instrument content).
 */
export interface RegistryInstrumentSummary {
  readonly instrumentId: string;
  readonly instrumentType: 'qa' | 'cloze' | 'mcq';
  /** Every concept this instrument is evidence for (D-031, M:N) — carried so a prune/edit call has the whole set the frozen suspend record requires, without a second vault walk. */
  readonly conceptIds: readonly string[];
  readonly notePath: VaultPath;
  readonly noteTitle: string;
  readonly blockId: string | null;
  readonly heading: string | null;
  /**
   * F8.5's withdrawal state, at the INSTRUMENT grain. Backed by the existing
   * suspend/unsuspend projection (`../review-log/suspension.js`) — the
   * registry's prune affordance is a second caller of that already-frozen,
   * already-reversible mechanism (`ol-xvmx`'s port gap is orthogonal: this
   * module writes through `appendSuspendRecord` directly, carrying the
   * `conceptIds` the schema requires from `VaultInstrumentRecord` itself).
   * **Never deletion** — `pruned: true` means excluded from the review
   * queue, nothing else; the instrument's note, history and evidence are
   * untouched and unpruning is a second, symmetric append.
   */
  readonly pruned: boolean;
}

/** Whether explain-back has ever been attempted for a concept — informational only (F8.4's "instrument mix... plus explain-back"). There is no persisted explain-back instrument to browse, edit or prune: F2.16 records the attempt in the review log, never a vault block. */
export interface RegistryExplainBackSummary {
  readonly attempted: boolean;
  readonly attemptCount: number;
}

/** One row of the registry — one concept, everything F8.4 says the browse surface must show about it. */
export interface RegistryConceptEntry {
  /** Opaque join key (C7.11) — see this module's doc for why it is not yet stable across a rename. */
  readonly key: string;
  /** Hers, always (C7.4) — the override's `displayName` when a rename override exists, `ConceptRecord.name` otherwise. */
  readonly displayName: string;
  /**
   * The raw, never-overridden name this run's extraction produced
   * (`ConceptRecord.name`), carried alongside `displayName` so a caller
   * applying a FURTHER rename (`./overrides.ts`'s `renameConcept`) never has
   * to reconstruct it from `aliases` — display history, not identity.
   */
  readonly originalName: string;
  /** Prior display names this concept has been renamed FROM, most recent first. Empty until the first rename. Display-only — see this module's doc on what "resolves" does not yet mean. */
  readonly aliases: readonly string[];
  /** Course codes, verbatim, M:N (C7.2) — never nested under one course. */
  readonly courses: readonly string[];
  readonly tier: ConceptTier;
  /**
   * F8.5's withdrawal state at the CONCEPT grain. `true` means withdrawn from
   * browsing's default view — never from the underlying record: `key`,
   * `courses`, `instruments`, `mastery` and `vitality` are computed
   * identically whether or not this is set, and unpruning clears it with no
   * loss. No delete path exists anywhere this flag is read.
   */
  readonly pruned: boolean;
  /** Every schedulable instrument this concept is evidence for, in vault-then-source order — the browsable "instrument mix" (F8.4). */
  readonly instruments: readonly RegistryInstrumentSummary[];
  readonly explainBack: RegistryExplainBackSummary;
  /** F2.11 axis 1 (growth stage) plus the evidence it was read from (`../mastery/rollup.js`, C5.4). */
  readonly mastery: ConceptMasteryResult;
  /** F2.11 axis 2 (vitality) — `[D-087]`'s fold, first surfaced live here (see `../mastery/rollup.js`'s own module doc on `readAllConceptVitality` having "no consumer outside core yet"). */
  readonly vitality: VitalityReading;
}

/** The whole browsable inventory (F8.4). Concepts in no course are included (F1.3: a statement, not a failure) — filtering by course is a view concern, not a model concern. */
export interface RegistryModel {
  /** Ordered by display name, then by key as a tiebreak — deterministic regardless of extraction order, and stable across a rename that does not change the sort bucket. */
  readonly concepts: readonly RegistryConceptEntry[];
}

/** Everything `buildRegistryModel` needs, gathered by the caller (the plugin's provider) from one vault walk plus one whole-log read — see `./build.ts`'s module doc for why this module does neither itself. */
export interface BuildRegistryModelInput {
  readonly concepts: readonly ConceptRecord[];
  readonly instrumentRecords: readonly VaultInstrumentRecord[];
  readonly entries: readonly ReviewLogEntry[];
  readonly scheduler: Scheduler;
  readonly now: Date;
  readonly holdingCut: number;
  readonly overrides: RegistryOverrides;
  /** `../review-log/suspension.js`'s `suspendedInstrumentIds(entries)` — passed in rather than recomputed, since a caller building several views from one log should not re-fold it per view. */
  readonly suspendedInstrumentIds: ReadonlySet<string>;
}

/** One concept's rename history and current override. */
export interface RegistryRenameOverride {
  readonly displayName: string;
  /** Every previous `displayName` this concept has carried under this override, most recent first, deduplicated. */
  readonly aliases: readonly string[];
}

/**
 * The registry's own local, per-install state (F8.4's rename, F8.5's prune) —
 * never her authored content (INV-6), never a vault write. Persisted by the
 * plugin's `ObsidianRegistryOverridesStore`, the same `data.json`
 * read-modify-write pattern `plan/settings-store.ts` and
 * `retrospective/offer-store.ts` already use for local state this project has
 * no event-sourced home for yet. `version` follows those stores' own
 * convention (a literal, bumped only alongside a migration).
 */
export interface RegistryOverrides {
  readonly version: 1;
  readonly renames: Readonly<Record<string, RegistryRenameOverride>>;
  /** Concept keys currently withdrawn (F8.5) — a set, represented as a sorted array for a deterministic persisted shape. */
  readonly prunedConceptKeys: readonly string[];
}
