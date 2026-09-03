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
 * never written into her vault (INV-6).
 *
 * **`../retrieval/aliasExpansion.ts`'s `expandQueryWithAliases` (`ol-l5og.11`) now reads this
 * override's alias history to keep F8.4's "her old wording still resolves" promise for keyword
 * search**, via `./overrides.ts`'s `aliasEquivalenceGroups` — grouping a concept's current
 * `displayName` with every demoted alias, both directions, from THIS run's `RegistryOverrides`
 * alone. It deliberately never waits on C7.11's key becoming real: every lookup equates NAMES a
 * live override already says are the same concept's history, not a `key`, which is the strictly
 * narrower and honestly deliverable claim while `../concept/types.ts`'s key stays provisional.
 * `../retrieval/engine.ts`'s `retrieve()` applies it to the keyword half of a call only, and only
 * when a caller supplies the new optional `RetrieveDeps.registryOverrides` — see
 * `./rename.spec.ts` for the end-to-end proof. Neither current production caller of `retrieve()`
 * assembles that field yet (`ol-l5og.11`'s report names the two, and the one-line addition each
 * needs), so a real generative call does not exercise this today.
 *
 * ## Rank-gated rename PROPOSALS (`[D-183]`, knowledge model §3, `ol-2zfj.58`)
 *
 * `RenameProposalCandidate`/`RenameProposal` below are the second half of the naming rule: a
 * later-arriving source whose provenance tier outranks the tier that set a concept's current
 * display name never overwrites it silently — it surfaces as a proposal, through the same
 * accept/decline shape `noteOffer` already established one field up. See `./rename-proposal.ts`'s
 * module doc for the whole mechanism, what it reuses from `./overrides.ts`'s existing
 * `renameConcept` (accept needs no new persisted shape at all).
 *
 * **`[D-206]` (`ol-2zfj.59`) closed the one Class C question `ol-2zfj.58`'s tripwire stopped on
 * rather than answering unilaterally**: making the "declined proposals don't re-fire" promise and
 * the "which tier set the current name" memory survive a restart, not just a session.
 * `RegistryRenameOverride.sourceTier` and `RegistryOverrides.declinedRenameSignatures` above are
 * those two additive fields — see their own doc comments, and `./rename-proposal.ts`'s module doc
 * for how the rank gate reads them.
 */

/**
 * `[D-183]`'s rename-proposal evidence — which source proposed new wording, at what tier
 * (knowledge model §3's ordering: 1, her concept note, outranks 2, her `topic` property, outranks
 * 3, extracted-only — lower number is higher rank). Carries a `RegistrySourceLocation` so a
 * proposal can cite "which source, which passage" in the ruling's own words, reusing the same
 * citation shape `RegistryConceptEntry.sourceLocations` already carries rather than inventing a
 * second one. `sourceLocation` is optional and absent exactly when the concept the candidate names
 * has no known location yet — never guessed, matching this module's own honesty convention for
 * every other optional location field.
 */
export interface RenameProposalCandidate {
  readonly tier: ConceptTier;
  readonly wording: string;
  readonly sourceLocation?: RegistrySourceLocation;
}

/**
 * `[D-183]`'s rank-gated rename proposal, pending her accept/decline. `currentDisplayName`/
 * `currentTier` describe the wording still being shown — frozen there, per the ruling, until she
 * acts — so accepting can hand `currentDisplayName` straight to `./overrides.ts`'s existing
 * `renameConcept` as the wording to demote to an alias, and nothing here needs a second field for
 * "what was it called before". See `./rename-proposal.ts` for the pure decision function that
 * builds one of these and for `acceptRenameProposal`'s exact reuse of `renameConcept`.
 */
export interface RenameProposal {
  readonly key: string;
  readonly currentDisplayName: string;
  readonly currentTier: ConceptTier;
  readonly candidate: RenameProposalCandidate;
}

/**
 * `[D-203]`'s duplicate-title state — present exactly when
 * `ConceptRecord.ambiguousNotePaths` is set: this concept's title is carried
 * by more than one of her Zettelkasten notes, so `../concept/extract.js`'s
 * binder refuses to resolve which one it binds to and `boundNotePath` stays
 * absent (that refusal predates this bead — held, not ruled, by `[D-196]`,
 * and ruled here by `[D-203]`). `notePaths` is `ConceptRecord.ambiguousNotePaths`
 * unchanged: the several notes whose filenames all match, sorted.
 *
 * **It is her material and a lever, unlike the unreadable-file case `[D-196]`
 * rules elsewhere, so it is shown** rather than the row silently reading as
 * an ordinary tier-2 concept with no binding. **No chooser is offered**:
 * choosing between the two notes by any rule of ours would assert an
 * identity nothing in her vault states (the same argument
 * `ConceptRecord.ambiguousNotePaths`'s own doc already makes) — this field
 * carries only the fact and the evidence, never a pick-one affordance.
 * Clears on the next build once she renames one of the notes so the titles
 * differ — nothing here persists between builds, matching `./build.ts`'s own
 * "pure function of its input" doc.
 */
export interface RegistryDuplicateTitleState {
  readonly notePaths: readonly VaultPath[];
}

import type { MasteryState, ReviewLogEntry, SoloLevel } from 'olea-contracts';
import type { ConceptRecord, ConceptTier } from '../concept/types.js';
import type {
  ConceptMasteryEvidence,
  ConceptMasteryResult,
  EvidenceTier,
} from '../mastery/rollup.js';
import type { VitalityReading } from '../mastery/vitality.js';
import type { CourseOracleRanking } from '../oracle/types.js';
import type { DisputeLogRecord } from '../review-log/contest.js';
import type { Scheduler } from '../scheduler/types.js';
import type { VaultInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';

export type {
  ConceptMasteryEvidence,
  ConceptMasteryResult,
  EvidenceTier,
  MasteryState,
  ReviewLogEntry,
  SoloLevel,
};

/**
 * One vault location a concept or instrument's registry entry can open at
 * (F8.4's amended text, `[D-171]`). Reuses nothing from `../extract/types.js`'s
 * `SourceLocation` beyond the shape's own honesty rule — this module's inputs
 * (`ConceptRecord`, `VaultInstrumentRecord`) do not carry `SourceLocation`
 * itself (no `page`, no `charRange`), only a vault path plus, for an
 * instrument, the heading/block already recorded for it. `heading` and
 * `blockId` are `null`/absent exactly when the underlying record has none —
 * never guessed, matching `SourceLocation.section`'s own "undefined means no
 * structure exists, not that the lookup failed" convention.
 */
export interface RegistrySourceLocation {
  readonly sourcePath: VaultPath;
  readonly heading?: string | null;
  readonly blockId?: string | null;
  /**
   * Passage grain, mirroring `../extract/types.js`'s `SourceLocation.page`
   * and `.section` fields (`ol-2zfj.48`) rather than defining a second
   * scheme (`[D-085]`). `page` is 1-based and, per that type's own
   * documented convention, IS the slide number for a PPTX-sourced passage —
   * there is no separate "slide" field because the contract type has none
   * either. `section` is the heading/title-placeholder text, exactly when
   * the source format carries one.
   *
   * **Present only when `./build.ts` had a `Provenance` to read it from** —
   * `ConceptRecord.anchor`/`.alsoIn` or `VaultInstrumentRecord`'s
   * `sourceProvenance`. Absent means "no passage-grain source for this
   * location yet", never "the passage has no page" — the same
   * honesty-over-silent-default convention `SourceLocation.section` itself
   * documents. Never populated from PDF document metadata (Author, Title,
   * etc.) — this pipeline does not extract or surface that metadata at all.
   */
  readonly page?: number;
  readonly section?: string;
}

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
   * `[D-171]`'s per-instrument provenance — where this instrument itself
   * lives (`notePath`/`heading`/`blockId`, restated as one openable
   * location), so the registry has something honest to open even before the
   * generation-time material citation (which PDF/PPTX page an instrument was
   * DRAWN from, as distinct from the vault note it lives in) is threaded
   * through `VaultInstrumentRecord` — see `./build.ts`'s module doc for the
   * exact gap and the follow-up. Always exactly one entry today; never
   * fabricated beyond what `VaultInstrumentRecord` already carries.
   */
  readonly sourceLocations: readonly RegistrySourceLocation[];
  /**
   * F8.4b's explain-back history for THIS instrument, oldest first — empty
   * when explain-back has never been attempted against it. Only an
   * INSTRUMENT-SEEDED explain-back attempt (F5's on-demand-from-a-card,
   * confusion routing, session assembly, Today's suggestion entry points)
   * ever appears here: a freeform/topic-seeded attempt
   * (`ExplainBackModal`'s `generateInstrumentId` case) carries a synthetic
   * id with no vault-persisted instrument to attach to, so it has no row
   * here — it still counts toward `RegistryConceptEntry.explainBack`'s
   * concept-grain summary, which matches by concept id rather than
   * instrument id for exactly this reason.
   */
  readonly explainBackHistory: readonly RegistryExplainBackHistoryRow[];
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

/**
 * One graded explain-back attempt on an instrument's registry entry
 * (F8.4b, `[D-175]`) — oldest first, exactly
 * `../review-log/explain-back-history.ts`'s `explainBackGradeHistoryByInstrument`
 * order. Deliberately thin: never the student's answer text or the
 * grader's feedback — those stay behind `[D-077]`'s content store
 * (`contentRef`), resolved only for an entry a caller chooses to expand,
 * which this registry surface does not do. Never a raw scalar or
 * percentage either (F8.3, F2.11's two-axis discipline) — `soloLevel` is
 * the SOLO enum value itself, for `./build.ts`'s doc's own reasons the
 * PLUGIN copy layer renders in the reporting voice (GLOSSARY SOLO rule 5:
 * the raw name is never exposed to her), never rendered by this module.
 */
export interface RegistryExplainBackHistoryRow {
  readonly eventId: string;
  readonly timestamp: string;
  readonly soloLevel: SoloLevel;
  /**
   * True only for the instrument's CURRENT (non-superseded) graded attempt,
   * and only while that grade is presently quarantined under `[D-095]`.
   * An older, already-superseded attempt never carries this even if it was
   * disputed once — `[D-095]`'s evidence-relative aging means a dispute
   * retires with the reading it rode once a fresher grade lands, and this
   * field never re-derives that itself; see `./build.ts`'s doc.
   */
  readonly contested: boolean;
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
  /**
   * `[D-171]`'s per-concept provenance — the vault location(s) this concept
   * was derived from: `sourcePaths` (every note whose `topic:` or wikilink
   * named it) plus `boundNotePath` when one exists, deduplicated, each
   * carrying page/section grain too when `ConceptRecord.anchor`/`.alsoIn`
   * (`ol-2zfj.48`) supplies it for that path. That field is itself optional
   * and `undefined` on every mint site `./extract.js` owns today — passage
   * grain is `../concept/read.js`'s `ReadConcept.anchor`/`alsoIn`, a
   * different stage's output, and nothing yet folds it back onto the
   * `ConceptRecord` for the same concept. So a real vault read still shows
   * note-grain-only locations until that fold lands. See `./build.ts`'s
   * module doc.
   */
  readonly sourceLocations: readonly RegistrySourceLocation[];
  /** F2.11 axis 1 (growth stage) plus the evidence it was read from (`../mastery/rollup.js`, C5.4). */
  readonly mastery: ConceptMasteryResult;
  /** F2.11 axis 2 (vitality) — `[D-087]`'s fold, first surfaced live here (see `../mastery/rollup.js`'s own module doc on `readAllConceptVitality` having "no consumer outside core yet"). */
  readonly vitality: VitalityReading;
  /**
   * F8.4a's `[D-176]` note-offer gate (`../concept/note-offer.js`'s
   * `noteOfferEligible`, unmodified) — whether the registry may show the
   * "create a note for this" standing affordance on this row. Always
   * `false` for a tier-1 concept (it already has an authored note; see
   * `note-offer.ts`'s own doc on why the gate is never reached for one) and
   * whenever `BuildRegistryModelInput.courseRankings` carries no ranking for
   * any course this concept names (nothing to sit in a top band of). See
   * `./build.ts`'s `noteOfferFor` for the multi-course rule.
   */
  readonly noteOffer: { readonly eligible: boolean };
  /**
   * `[D-183]`'s rank-gated rename proposal — present exactly when a
   * higher-ranked source's wording is pending her accept/decline, `null`/
   * absent otherwise (matching `disputes`/`courseRankings`'s own "absent is
   * a real, non-error state" convention on `BuildRegistryModelInput`).
   *
   * **Optional, and deliberately not populated by `./build.ts` today.**
   * That file sits outside `ol-2zfj.58`'s `owns`, so this bead cannot wire
   * the detection `./rename-proposal.ts` provides into the pure model build
   * itself. `packages/plugin/src/registry/provider.ts`'s `load()` overlays
   * it instead, the same "post-process what `buildRegistryModel` returned"
   * shape that file's own `withPassageAnchors` already uses on the way IN —
   * this is the mirror on the way OUT. See that file's module doc for the
   * session-scoped memory this needs and the one Class C gap it names
   * rather than closes (surviving an Obsidian restart needs a genuinely new
   * persisted field this bead's tripwire stopped it from adding).
   */
  readonly renameProposal?: RenameProposal | null;
  /**
   * `[D-203]`'s duplicate-title state — see `RegistryDuplicateTitleState`'s
   * own doc. Absent means this concept's title is not currently duplicated
   * (the ordinary case); present means the binder's refusal stands and no
   * note is bound. Populated directly by `./build.ts` from
   * `ConceptRecord.ambiguousNotePaths` — unlike `renameProposal` above, this
   * needs no session-scoped overlay, since the fact is fully determined by
   * this run's own vault walk.
   */
  readonly duplicateTitle?: RegistryDuplicateTitleState;
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
  /**
   * `[D-095]` dispute records, folded into F8.4b's per-instrument contested
   * marker via `../review-log/contest.js`'s `quarantinedGradeInstrumentIds`.
   * **Optional, and absent is a real, non-error state**: `../session/history.js`'s
   * `readReviewLogHistory` (this codebase's one whole-log reader) keeps
   * dispute records out of the `entries` it returns — `./build.ts`'s own
   * doc on `parse.ts`'s separate `disputes` field states why — so a caller
   * that has not been updated to also gather them (or genuinely has none)
   * simply produces no contested markers, never a crash and never a
   * fabricated "not contested" read where the truth is unknown.
   */
  readonly disputes?: readonly DisputeLogRecord[];
  /**
   * F4.2's per-course high-yield ranking (`rankOracle`/`composeOracleRanking`'s
   * `RankOracleResult.courses`), unmodified — this module's `noteOfferFor`
   * (`./build.ts`) reads it to feed `../concept/note-offer.js`'s
   * `noteOfferEligible` and never re-derives a ranking of its own.
   *
   * **Optional, and absent/empty is a real, non-error state**, matching
   * `disputes` above: a vault with no assignments Base configured yet
   * (F1.1) has no ranking to compose, and every concept's
   * `RegistryConceptEntry.noteOffer.eligible` simply reads `false` rather
   * than the caller inventing one or the whole registry failing to build.
   */
  readonly courseRankings?: readonly CourseOracleRanking[];
}

/** One concept's rename history and current override. */
export interface RegistryRenameOverride {
  readonly displayName: string;
  /** Every previous `displayName` this concept has carried under this override, most recent first, deduplicated. */
  readonly aliases: readonly string[];
  /**
   * `[D-206]` (`ol-2zfj.59`): the provenance tier that set the CURRENT
   * `displayName`, present only when this override came from ACCEPTING a
   * `[D-183]` rename proposal (`./rename-proposal.ts`'s
   * `acceptRenameProposal`, which passes `proposal.candidate.tier`) —
   * absent when she typed the name directly, which carries no tier at all
   * (her own word, tier-less, INV-6; `renameConcept`'s plain call leaves
   * this unset). Read by `./rename-proposal.ts`'s `renameProposalMemoryFrom`
   * to reconstruct the rank gate's comparison baseline across an Obsidian
   * restart instead of losing it to the provider's session-scoped memory
   * (see that file's module doc, "the Class C gap this bead's tripwire
   * stopped on," which this field closes). **Absent on every override
   * written before `[D-206]` — additive field, no migration.**
   */
  readonly sourceTier?: ConceptTier;
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
  /**
   * `[D-206]` (`ol-2zfj.59`): every `[D-183]` `(tier, wording)` decline
   * signature (`./rename-proposal.ts`'s `declineSignature`) she has ever
   * declined — global across every concept, mirroring the shape the
   * session-scoped `Set` it replaces already used (a proposal is identified
   * by source tier plus wording, never by concept key). Read via
   * `./rename-proposal.ts`'s `declinedRenameSignaturesFrom` so a decline
   * survives an Obsidian restart instead of lasting only the session.
   * **Absent/empty on every overrides file written before `[D-206]` —
   * additive field, no migration.**
   */
  readonly declinedRenameSignatures?: readonly string[];
}
