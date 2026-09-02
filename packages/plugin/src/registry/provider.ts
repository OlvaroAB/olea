/**
 * `createLocalRegistryProvider` — the production `RegistryViewDeps` (F8.4,
 * `[REG-1]`, `ol-4v2l`, amended acceptance `[D-135]`).
 *
 * Composes, entirely on-device, no Worker call — the registry's twin of
 * `gap/provider.ts` and `session-builder/provider.ts`:
 *
 *   1. **The vault walk** — `enumerateVaultInstruments`, giving both the
 *      concept spine and the instrument records in one pass (same reuse
 *      those two providers already document for their own calls).
 *   2. **The whole review-log history** — `readReviewLogHistory`, WHOLE not
 *      windowed, matching `session/history.ts`'s own doc: mastery, vitality
 *      and the withdrawn-instrument set are all high-water-mark or
 *      current-state readings over the ENTIRE log, and a windowed read would
 *      silently un-withdraw an instrument suspended last term (exactly the
 *      bug that module's doc warns against for scheduling).
 *   3. **The local overrides** — `ObsidianRegistryOverridesStore`, read
 *      fresh on every `load()`, matching every other provider's "a change
 *      she makes between two opens must not need a reload to take" rule.
 *
 * Neither the vault walk nor the log read depends on the other's result, so
 * they run concurrently (`Promise.all`), the same concurrency
 * `gap/provider.ts` uses for the same reason.
 *
 * **No cache**, for the same reason `gap/provider.ts` states for its own
 * `GapViewModel`: a persisted registry blob would be a new cache with
 * nothing in the contract naming it (C6, D-002/D-004/D-005/D-008). `load()`
 * recomputes from scratch every time the view opens or refreshes.
 *
 * **`deps.onOverridesChanged` (`ol-r5j4`) is the one exception to "no
 * cache," and it is not this provider's own cache.** `retrieve()`'s two
 * production callers need a `RegistryOverrides` snapshot assembled
 * synchronously (`ol-l5og.11`'s alias expansion), while this store's own
 * `load()` is async — so `main.ts` keeps a cached copy for THAT purpose,
 * refreshed by this optional hook every time `rename`/`withdrawConcept`/
 * `restoreConcept` below write a new blob. This provider's own `load()`
 * above is untouched by it and still reads fresh every time, exactly as
 * before.
 *
 * **`deps.conceptRecords` (`ol-2zfj.49` second half) threads `main.ts`'s
 * `this.conceptRecords` in — the most recent corpus-relation tick's
 * `ConceptRecord[]`, already folded with that tick's completed read's
 * passage anchors (`extractConceptsWithAnchors`, `[D-082]`). A thunk, same
 * shape as `grove/provider.ts`'s `relations`, so a later tick's fresher fold
 * reaches a view built before that tick ran, not just the one at hand when
 * the view was first opened. `load()` still does its own full vault walk via
 * `enumerateVaultInstruments` for concept existence, instrument binding and
 * every other field — this only OVERLAYS `anchor`/`alsoIn` onto matching
 * concept keys, so a concept the walk just found that the (possibly stale,
 * possibly `null` before any read has completed) fold does not yet know
 * about still appears, note-grain-only, exactly as it does today. Nothing
 * changes when `deps.conceptRecords` is omitted or returns `null`, or before
 * the first corpus-relation tick completes: `enumeration.concepts` passes
 * through unchanged, so the no-read-yet fallback is identical to before this
 * field existed.
 *
 * **`[D-176]`/F8.4a's note-offer gate (`ol-r1by`) needs one more thing this
 * provider did not read before: F4.2's per-course high-yield ranking.**
 * `plan/provider.ts` and `gap/provider.ts` are the plugin's two existing
 * `composeOracleRanking` callers — this is a third, reusing exactly that
 * function (never a second ranking algorithm) the same way `gap/provider.ts`
 * reuses it alongside its own vault walk. Composing a ranking needs the
 * assignments Base path from `plan/settings-store.ts`'s
 * `ObsidianStudyPlanSettingsStore`, a plan-specific setting this provider had
 * no reason to read before; `courseRankingsForNoteOffer` below isolates that
 * read and the compose call in their own try/catch, separate from this
 * provider's main `load()` try/catch, so a vault with no assignments Base
 * configured (or a ranking compose that throws) degrades to "no course
 * rankings this load" — every concept's `noteOffer.eligible` reads `false` —
 * rather than taking the whole registry down with it. F7.8's degrade-not-
 * half-work posture, same as `readRankWeights`/`readPlanPolicy` elsewhere in
 * this package.
 *
 * ## `[D-183]`'s rank-gated rename proposal — the overlay `load()` applies AFTER `buildRegistryModel`
 *
 * `withPassageAnchors` above overlays fresher data onto the vault walk's
 * concepts on the way IN to `buildRegistryModel`; `gateRenameProposals`
 * below is the mirror on the way OUT — it maps over `RegistryModel.concepts`
 * once `buildRegistryModel` has returned, because that function's own file
 * (`../../core/registry/build.ts`) sits outside `ol-2zfj.58`'s `owns` and
 * cannot be edited by this bead to compute `RegistryConceptEntry.renameProposal`
 * itself. See `../../core/registry/rename-proposal.ts`'s module doc for the
 * full rule this implements (knowledge model §3, `[D-183]`): a later source
 * whose provenance tier outranks the tier that set a concept's current
 * display name never overwrites it silently — it freezes the old wording
 * and raises a proposal instead, until she accepts or declines it.
 *
 * **This provider's memory of "what tier/wording is currently frozen" and
 * "which (tier, wording) pairs she has declined" is SESSION-SCOPED
 * (`renameProposalMemory`/`declinedRenameSignatures` below) — it lives only
 * as long as this provider instance does, i.e. until the plugin reloads or
 * Obsidian restarts.** Making either durable needs a genuinely new
 * persisted field on `RegistryOverrides`/`RegistryRenameOverride` — a
 * persisted-schema change, Class C by the run charter's ladder — and
 * `ol-2zfj.58`'s own brief says to stop and report that rather than add it;
 * `../../core/registry/rename-proposal.ts`'s module doc names the exact
 * field. Within one session this is fully correct: a proposal keeps
 * re-deriving identically on every `load()` until she acts, and a decline
 * genuinely does not fire again for the same source and wording, for as
 * long as the plugin stays loaded.
 *
 * **`gateRenameProposal`/`renameProposalOutranks`/`renameProposalDeclineSignature`/
 * `RenameProposalMemory` below mirror `../../core/registry/rename-proposal.ts`'s
 * `gateRenameCandidate`/`outranksCurrent`/`declineSignature`/
 * `RenameProposalMemory` function-for-function, rather than importing them.**
 * `packages/core/src/index.ts` — `olea-core`'s only public surface — sits
 * outside this bead's `owns` (a shared file another lane may be live on;
 * see this repo's own concurrent-lanes rule), so the new core module cannot
 * be exported there by this bead and cannot be imported cross-package
 * today. `./copy.ts`'s own doc already documents the identical situation
 * for a TYPE it could not import for the same reason
 * (`RegistryExplainBackHistoryRow`) — this is that same gap on the function
 * side. Collapse this duplication into a real import the moment whoever
 * next touches `index.ts` adds the two-line export; `rename-proposal.ts` is
 * the tested, canonical version meanwhile (`rename-proposal.spec.ts`).
 *
 * **Accept needs no session memory of its own** — `acceptRenameProposal`
 * below writes through the exact same `renameConceptOverride`/
 * `overridesStore.save()` path `rename()` already uses, with the proposal's
 * frozen `currentDisplayName` as the wording to demote to an alias. That
 * write IS durable (it is `RegistryOverrides.renames`, unchanged shape), so
 * accepting a proposal survives a restart even though detecting one, and
 * remembering a decline, do not yet.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  buildRegistryModel,
  type ConceptRecord,
  type ConceptTier,
  type CourseOracleRanking,
  calendarDaysEndingOn,
  composeOracleRanking,
  createFsrsScheduler,
  type DisputeLogRecord,
  enumerateVaultInstruments,
  pruneConcept as pruneConceptOverride,
  type RegistryConceptEntry,
  type RegistryInstrumentSummary,
  type RegistryModel,
  type RegistryOverrides,
  type RegistrySourceLocation,
  readReviewLogFile,
  readReviewLogHistory,
  renameConcept as renameConceptOverride,
  reviewLogPath,
  suspendedInstrumentIds,
  unpruneConcept as unpruneConceptOverride,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { isStudyPlanConfigured, ObsidianStudyPlanSettingsStore } from '../plan/settings-store.js';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import type { ObsidianDataHost } from './overrides-store.js';
import { ObsidianRegistryOverridesStore } from './overrides-store.js';
import { createVaultPruneInstrumentPort, type PruneInstrumentPort } from './ports.js';
import type { RegistryViewDeps, RegistryViewState } from './view.js';

/**
 * Vitality's own module doc (`../../core/mastery/rollup.ts`) names the
 * mastery surface that would show a stage beside its vitality as still
 * unbuilt when it was written. This provider, and `retrospective/
 * provider.ts` before it, are both that surface now — two independent Class
 * B declarations of the same unmeasured constant rather than one shared
 * module, matching this codebase's existing convention (no shared
 * `holdingCut` constant exists anywhere else in `packages/plugin`).
 * Ratifying it needs a real semester of her review log (see that module's
 * own doc); until then this is a plain-English default, not a derivation.
 */
const DECLARED_FALLBACK_HOLDING_CUT = 0.8;

/** `RegistryConceptEntry['renameProposal']`'s non-null shape, derived by indexed access rather than a direct import — `RenameProposal`/`RenameProposalCandidate` (`../../core/registry/types.ts`) are not exported from `olea-core`'s index (out of `ol-2zfj.58`'s `owns`; see `./copy.ts`'s doc for the same technique used for the identical reason). */
type RenameProposal = NonNullable<RegistryConceptEntry['renameProposal']>;
type RenameProposalCandidate = RenameProposal['candidate'];

/** See this file's module doc, "[D-183]'s rank-gated rename proposal" — this session's memory of what is currently frozen for a concept with no manual override yet. */
interface RenameProposalMemory {
  readonly tier: ConceptTier;
  readonly displayName: string;
}

/** Mirrors `../../core/registry/rename-proposal.ts`'s `outranksCurrent` — see this file's module doc for why this is a copy rather than an import. */
function renameProposalOutranks(candidateTier: ConceptTier, currentTier: ConceptTier): boolean {
  return candidateTier < currentTier;
}

/** Mirrors `../../core/registry/rename-proposal.ts`'s `declineSignature`. */
function renameProposalDeclineSignature(
  candidate: Pick<RenameProposalCandidate, 'tier' | 'wording'>,
): string {
  return `${candidate.tier}:${candidate.wording}`;
}

/**
 * Mirrors `../../core/registry/rename-proposal.ts`'s `gateRenameCandidate` —
 * see that file's own doc for the full rule and its own spec for the tested
 * behaviour this copy must keep matching. Takes a whole `RegistryConceptEntry`
 * (rather than that function's narrower input shape) since this is the one
 * production call site and has the entry on hand already.
 */
function gateRenameProposal(
  entry: RegistryConceptEntry,
  priorMemory: RenameProposalMemory | undefined,
  declinedSignatures: ReadonlySet<string>,
): {
  readonly displayName: string;
  readonly renameProposal: RenameProposal | null;
  readonly memory: RenameProposalMemory;
} {
  const hasManualOverride = entry.displayName !== entry.originalName;
  if (hasManualOverride) {
    return {
      displayName: entry.displayName,
      renameProposal: null,
      memory: { tier: entry.tier, displayName: entry.originalName },
    };
  }

  const noImprovement =
    priorMemory === undefined ||
    !renameProposalOutranks(entry.tier, priorMemory.tier) ||
    entry.originalName === priorMemory.displayName;
  if (noImprovement) {
    return {
      displayName: entry.originalName,
      renameProposal: null,
      memory: { tier: entry.tier, displayName: entry.originalName },
    };
  }

  const candidate: RenameProposalCandidate = {
    tier: entry.tier,
    wording: entry.originalName,
    ...(entry.sourceLocations[0] !== undefined ? { sourceLocation: entry.sourceLocations[0] } : {}),
  };

  if (declinedSignatures.has(renameProposalDeclineSignature(candidate))) {
    return { displayName: priorMemory.displayName, renameProposal: null, memory: priorMemory };
  }

  const proposal: RenameProposal = {
    key: entry.key,
    currentDisplayName: priorMemory.displayName,
    currentTier: priorMemory.tier,
    candidate,
  };
  return { displayName: priorMemory.displayName, renameProposal: proposal, memory: priorMemory };
}

/** Mirrors `../../core/registry/rename-proposal.ts`'s `recordDeclinedRenameProposal`. */
function recordDeclinedRenameProposal(
  declined: ReadonlySet<string>,
  proposal: RenameProposal,
): ReadonlySet<string> {
  const signature = renameProposalDeclineSignature(proposal.candidate);
  if (declined.has(signature)) return declined;
  return new Set([...declined, signature]);
}

export interface EditInstrumentPort {
  edit(instrument: RegistryInstrumentSummary): Promise<void>;
}

/** `[D-171]`'s click-through half: open a concept's or instrument's source location. */
export interface OpenSourceLocationPort {
  open(location: RegistrySourceLocation): Promise<void>;
}

/**
 * F8.4a's `[D-176]` accept half: given an eligible concept, create the new
 * Zettelkasten note the offer promised — see `./obsidian-ports.ts`'s
 * `createObsidianAcceptNoteOfferPort` for the one production implementation
 * and its own doc for what it does and does not yet do about binding the
 * concept's existing key onto the new note.
 */
export interface AcceptNoteOfferPort {
  accept(entry: RegistryConceptEntry): Promise<void>;
}

export interface CreateLocalRegistryProviderDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /** The one Obsidian-backed port (INV-1) — see `./obsidian-ports.ts`'s `createObsidianEditInstrumentPort`. */
  readonly editPort: EditInstrumentPort;
  /**
   * The one Obsidian-backed port for `[D-171]`'s click-through — see
   * `./obsidian-ports.ts`'s `createObsidianOpenSourceLocationPort`.
   *
   * **Optional, deliberately, and only until `main.ts` is updated.** This
   * bead owns `packages/plugin/src/registry/` only; `main.ts`'s existing
   * `createLocalRegistryProvider({...})` call (the production caller, at the
   * call site this same file's `editPort` line sits in) is one line outside
   * that ownership. Omitting this field falls back to a port that logs and
   * does nothing, so a build that has not yet added the line still compiles
   * and fails LOUDLY rather than silently — never a default that pretends to
   * work. See this bead's close notes for the exact one-line addition.
   */
  readonly openSourceLocationPort?: OpenSourceLocationPort;
  /**
   * F8.4a's `[D-176]` accept half — see `./obsidian-ports.ts`'s
   * `createObsidianAcceptNoteOfferPort`.
   *
   * **Optional, same reason `openSourceLocationPort` above is**: omitting it
   * falls back to a port that logs and does nothing, so a caller that has
   * not wired it yet still compiles and fails loudly rather than silently.
   */
  readonly acceptNoteOfferPort?: AcceptNoteOfferPort;
  /** Overridable for tests; defaults to the window every other provider probes by. */
  readonly probeDays?: number;
  readonly holdingCut?: number;
  /**
   * `ol-r5j4`: best-effort notification of a freshly-saved `RegistryOverrides`
   * blob, fired after every `overridesStore.save()` below (rename, withdraw,
   * restore). Exists so `main.ts` can keep a cached copy current for
   * `retrieve()`'s two production callers (`draftQuizCardsDeps`,
   * `composeExplainWhySourceChunks`) without either of them awaiting this
   * store's own async `load()` — see those call sites' own doc for why a
   * cache, not an async deps refactor, is the mechanism. Optional and
   * fire-and-forget, same shape `onUnitsLanded`/`onVerdict` already use one
   * directory over (`ingestion/wiring.ts`, `ingestion/materiality/wiring.ts`)
   * for the identical reason: a downstream cache-refresh failure must never
   * make a rename/prune/restore itself look like it failed.
   */
  readonly onOverridesChanged?: (overrides: RegistryOverrides) => void;
  /**
   * `ol-2zfj.49` (second half): the most recent corpus-relation tick's
   * folded `ConceptRecord[]` (`main.ts`'s `this.conceptRecords`) — a thunk,
   * read fresh on every `load()` so a later tick's fold reaches a view built
   * earlier, matching `grove/provider.ts`'s `relations` thunk. **Optional,
   * and `null` is a first-class value**, not just "field omitted": before
   * the first corpus-relation-batch tick completes this returns `null`
   * (`main.ts`'s field starts `null`), and `load()` below falls back to the
   * plain vault walk's concepts, unchanged from before this field existed.
   * See this file's own module doc for what it overlays and what it never
   * touches.
   */
  readonly conceptRecords?: () => readonly ConceptRecord[] | null;
}

/**
 * Overlays `anchor`/`alsoIn` (`[D-082]` passage-grain provenance) from a
 * fresher, already-folded `ConceptRecord[]` onto the vault walk's own
 * concepts, matched by `key`. Everything else about each concept — its
 * `sourcePaths`, `courses`, `tier`, whatever the walk just found — comes
 * from `enumeration.concepts`, never from the (possibly stale) fold: a
 * concept the walk just minted that the fold has not caught up to yet still
 * appears, note-grain-only, rather than being dropped or duplicated.
 */
function withPassageAnchors(
  concepts: readonly ConceptRecord[],
  folded: readonly ConceptRecord[] | null,
): readonly ConceptRecord[] {
  if (folded === null || folded.length === 0) return concepts;
  const byKey = new Map(folded.map((concept) => [concept.key, concept]));
  return concepts.map((concept) => {
    const match = byKey.get(concept.key);
    if (match === undefined) return concept;
    return {
      ...concept,
      ...(match.anchor !== undefined ? { anchor: match.anchor } : {}),
      ...(match.alsoIn !== undefined ? { alsoIn: match.alsoIn } : {}),
    };
  });
}

async function additionalReviewLogPaths(
  today: ReturnType<typeof localToday>,
  probeDays: number,
  deviceId: string,
): Promise<readonly VaultPath[]> {
  return calendarDaysEndingOn(today, probeDays).map((day) => reviewLogPath(day, deviceId));
}

/**
 * F8.4b's `[D-095]` contested marker needs dispute records, and
 * `readReviewLogHistory` (`../../core/session/history.ts`) deliberately
 * does not surface them — `../../core/review-log/parse.ts`'s own doc says
 * why: a dispute is a different question from "every review event," so no
 * consumer switching exhaustively over `ReviewLogEntry['kind']` has to grow
 * an arm it has nothing to say about. `session/history.ts` sits outside
 * this bead's `owns`, so rather than widen it, this re-reads exactly the
 * `files` `readReviewLogHistory` already reported as read — no new
 * discovery, no new merge policy, just the one field that walk drops.
 *
 * **No dedup, and none is needed.** `quarantinedGradeInstrumentIds`
 * (`../../core/review-log/contest.ts`) only ever turns its input into a
 * SET of instrument ids; feeding it the same dispute record twice (a
 * genuine possibility if a record were ever duplicated across files, which
 * `ol-egov.20`'s per-device-per-day file convention does not produce in
 * practice) changes nothing about the resulting set. A second I/O pass per
 * `load()` is the accepted cost — this provider's own module doc already
 * states "no cache... recomputes from scratch every time."
 */
async function disputesFromFiles(
  vault: VaultSource,
  files: readonly VaultPath[],
): Promise<readonly DisputeLogRecord[]> {
  const reads = await Promise.all(files.map((path) => readReviewLogFile(vault, path)));
  return reads.flatMap((read) => read.disputes);
}

/**
 * F8.4a's `[D-176]` note-offer gate needs F4.2's per-course ranking —
 * see this module's own doc for why this is a third `composeOracleRanking`
 * caller rather than a second ranking algorithm. Own try/catch, deliberately
 * separate from `load()`'s: "no assignments Base configured" is the
 * ordinary, unconfigured state every other `composeOracleRanking` caller in
 * this package already treats as unremarkable (`plan/provider.ts`,
 * `gap/provider.ts`), and a compose failure here must never take the whole
 * registry down with it — `[]` (no course rankings this load) degrades every
 * concept's `noteOffer.eligible` to `false`, exactly the same "absent is a
 * real, non-error state" `BuildRegistryModelInput.courseRankings` documents.
 */
async function courseRankingsForNoteOffer(
  vault: VaultSource,
  settingsHost: ObsidianDataHost,
  entries: readonly ReviewLogEntry[],
  concepts: readonly ConceptRecord[],
  asOf: string,
): Promise<readonly CourseOracleRanking[]> {
  try {
    const config = await new ObsidianStudyPlanSettingsStore(settingsHost).load();
    if (!isStudyPlanConfigured(config)) return [];
    const { ranking } = await composeOracleRanking({
      vault,
      basePath: config.assignmentsBasePath,
      reviewLog: entries,
      asOf,
      concepts,
    });
    return ranking.courses;
  } catch (error) {
    console.error(
      'Olea: could not compose F4.2 rankings for the note-offer gate ([D-176]) — the offer will not appear this load',
      error,
    );
    return [];
  }
}

/** A `RegistryViewDeps` whose every method reads the vault and the log fresh — the production wiring `main.ts` hands to `RegistryView`. */
export function createLocalRegistryProvider(
  deps: CreateLocalRegistryProviderDeps,
): RegistryViewDeps {
  const overridesStore = new ObsidianRegistryOverridesStore(deps.settingsHost);
  const pruneInstrumentPort: PruneInstrumentPort = createVaultPruneInstrumentPort(
    deps.vault,
    deps.deviceId,
  );
  const holdingCut = deps.holdingCut ?? DECLARED_FALLBACK_HOLDING_CUT;
  const scheduler = createFsrsScheduler();
  const openSourceLocationPort: OpenSourceLocationPort = deps.openSourceLocationPort ?? {
    async open(location: RegistrySourceLocation) {
      console.error(
        'Olea: registry source-location click-through has no port wired ([D-171]) — a location was requested but not opened',
        location.sourcePath,
      );
    },
  };
  const acceptNoteOfferPort: AcceptNoteOfferPort = deps.acceptNoteOfferPort ?? {
    async accept(entry: RegistryConceptEntry) {
      console.error(
        'Olea: the note-offer accept action has no port wired ([D-176]) — no note was created',
        entry.key,
      );
    },
  };

  // `[D-183]`'s rank-gated rename proposal — session-scoped only; see this
  // file's module doc, "the overlay `load()` applies AFTER `buildRegistryModel`",
  // for exactly what would need to become a persisted field to survive a
  // restart, and why this bead stops short of adding it.
  const renameProposalMemory = new Map<string, RenameProposalMemory>();
  let declinedRenameSignatures: ReadonlySet<string> = new Set();

  return {
    async load(): Promise<RegistryViewState> {
      try {
        const now = deps.now();
        const today = localToday(now);
        const probeDays = deps.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
        const additionalPaths = await additionalReviewLogPaths(today, probeDays, deps.deviceId);

        const [{ entries, files }, enumeration, overrides] = await Promise.all([
          readReviewLogHistory(deps.vault, { additionalPaths }),
          enumerateVaultInstruments(deps.vault),
          overridesStore.load(),
        ]);
        const [disputes, courseRankings] = await Promise.all([
          disputesFromFiles(deps.vault, files),
          courseRankingsForNoteOffer(
            deps.vault,
            deps.settingsHost,
            entries,
            enumeration.concepts,
            today,
          ),
        ]);

        const model = buildRegistryModel({
          concepts: withPassageAnchors(enumeration.concepts, deps.conceptRecords?.() ?? null),
          instrumentRecords: enumeration.records,
          entries,
          scheduler,
          now,
          holdingCut,
          overrides,
          suspendedInstrumentIds: suspendedInstrumentIds(entries),
          disputes,
          courseRankings,
        });

        const gatedConcepts: RegistryConceptEntry[] = model.concepts.map((entry) => {
          const gated = gateRenameProposal(
            entry,
            renameProposalMemory.get(entry.key),
            declinedRenameSignatures,
          );
          renameProposalMemory.set(entry.key, gated.memory);
          return { ...entry, displayName: gated.displayName, renameProposal: gated.renameProposal };
        });
        const gatedModel: RegistryModel = { ...model, concepts: gatedConcepts };

        return { kind: 'model', model: gatedModel };
      } catch (error) {
        console.error('Olea: could not compose the registry', error);
        return { kind: 'unavailable' };
      }
    },

    async rename(entry: RegistryConceptEntry, newDisplayName: string): Promise<void> {
      const overrides = await overridesStore.load();
      const next = renameConceptOverride(overrides, entry.key, entry.originalName, newDisplayName);
      await overridesStore.save(next);
      deps.onOverridesChanged?.(next);
    },

    async withdrawConcept(entry: RegistryConceptEntry): Promise<void> {
      const overrides = await overridesStore.load();
      const next = pruneConceptOverride(overrides, entry.key);
      await overridesStore.save(next);
      deps.onOverridesChanged?.(next);
    },

    async restoreConcept(entry: RegistryConceptEntry): Promise<void> {
      const overrides = await overridesStore.load();
      const next = unpruneConceptOverride(overrides, entry.key);
      await overridesStore.save(next);
      deps.onOverridesChanged?.(next);
    },

    async withdrawInstrument(instrument: RegistryInstrumentSummary): Promise<void> {
      await pruneInstrumentPort.prune(instrument);
    },

    async restoreInstrument(instrument: RegistryInstrumentSummary): Promise<void> {
      await pruneInstrumentPort.restore(instrument);
    },

    async editInstrument(instrument: RegistryInstrumentSummary): Promise<void> {
      await deps.editPort.edit(instrument);
    },

    async openSourceLocation(location: RegistrySourceLocation): Promise<void> {
      await openSourceLocationPort.open(location);
    },

    async acceptNoteOffer(entry: RegistryConceptEntry): Promise<void> {
      await acceptNoteOfferPort.accept(entry);
    },

    async acceptRenameProposal(
      entry: RegistryConceptEntry,
      proposal: RenameProposal,
    ): Promise<void> {
      // Reuses `renameConcept` exactly as `rename()` above does — accepting
      // is a durable write through the SAME, unchanged `RegistryOverrides`
      // shape. `proposal.currentDisplayName` (the frozen old wording, not
      // `entry.originalName`) is what must be passed as `renameConcept`'s
      // `originalName` parameter — see `../../core/registry/rename-proposal.ts`'s
      // `acceptRenameProposal` doc for exactly why the other order silently
      // no-ops and drops the alias.
      const overrides = await overridesStore.load();
      const next = renameConceptOverride(
        overrides,
        proposal.key,
        proposal.currentDisplayName,
        proposal.candidate.wording,
      );
      await overridesStore.save(next);
      deps.onOverridesChanged?.(next);
      // The concept now has a manual override (`displayName !== originalName`
      // next load), which `gateRenameProposal` already suppresses on its own
      // — clearing the memory here is tidiness, not correctness-bearing.
      renameProposalMemory.delete(entry.key);
    },

    async declineRenameProposal(
      _entry: RegistryConceptEntry,
      proposal: RenameProposal,
    ): Promise<void> {
      // Session-scoped only — see this file's module doc. Correctly does
      // not re-fire for this exact (tier, wording) pair for as long as the
      // plugin stays loaded; does not yet survive a restart.
      declinedRenameSignatures = recordDeclinedRenameProposal(declinedRenameSignatures, proposal);
    },
  };
}
