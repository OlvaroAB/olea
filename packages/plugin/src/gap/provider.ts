/**
 * `createLocalGapProvider` — the production `GapViewDeps` (`ol-2tyj`, F4.3,
 * F4.5, F4.9, F4.10).
 *
 * `GapView` (`./view.ts`) has been complete and tested since P5-T06a; nothing
 * in either package ever constructed it against a real vault. `plan/
 * provider.ts`'s `createLocalStudyPlanProvider` composed `composeOracleRanking`
 * for the study plan and, per that module's own doc, discarded `edges` —
 * `compose.ts`'s `ComposeOracleRankingResult.edges` doc says outright it is
 * carried "`ol-2tyj`'s gap and coverage views need `tier3.sourcesReport`…and
 * re-running the tier-3 walk a second time to get it would defeat the point of
 * composing it once here." Nothing read it. This module is that reader.
 *
 * ## The two walks, and why there are two
 *
 * `buildGapView` needs five things: `ranking`, `assessments`, `mastery`,
 * `sourceCoverage` (all four now returned by one `composeOracleRanking` call —
 * `mastery` only as of this same bead, see `oracle/compose.ts`'s module doc)
 * and `materialPresence`, which `buildMaterialPresence` builds from
 * `ConceptRecord[]` plus a per-note instrument count. Nothing upstream of this
 * file has ever needed *both* "the tier-3 evidence join" and "every instrument
 * in the vault, per note" in the same call, so this is the first caller that
 * pays for both walks — `composeOracleRanking` (which re-walks for tier-3
 * evidence) and `enumerateVaultInstruments` (which walks for instruments and,
 * as of this bead, also returns the `extractConcepts` pass it already runs
 * internally — see `session/types.ts`'s `VaultInstrumentEnumeration.concepts`).
 * Run concurrently (`Promise.all`) since neither depends on the other's
 * result, both read the same read-only `VaultSource`, and this pays the cost
 * once per open rather than serially.
 *
 * ## No cache, deliberately
 *
 * `ol-2tyj` suggested caching the resulting `GapViewModel` the way `plan/
 * cache.ts` caches a `StudyPlanArtifact`. That would be a new persisted blob
 * with nothing in the contract naming it — a Class C stop (C6, D-002/D-004/
 * D-005/D-008 already decide every case where convenience like this tempts).
 * So `load()` recomputes from scratch on every call: `GapView.refresh()`
 * calls it, and `main.ts` calls `refresh()` alongside `refreshCachedStudyPlan`
 * — see that module's wiring. `compose.ts`'s own doc already warns the
 * tier-3 walk is real vault I/O "not a cache read"; this view re-pays it on
 * every open, visibly, rather than hiding the cost behind a cache this
 * project has no persisted home for.
 *
 * ## The demand rule's composition root (`ol-egov.141.89.2.27`, `[D-437]` B5, `[D-349]`)

`buildGapView`'s `unmetDemands` input is supplied here and nowhere else. The chain is:

1. `deps.readDeclaredDemands` returns the assessment's declared demands per concept KEY, present
   only for a concept whose demands were read (see its doc). **Production passes no such reader
   yet**: the examiner-scope stores (`[D-429]`) exist, but nothing turns them into per-concept
   declared demands, so today every concept is unread.
2. For the instruments that scored a concept with declared demands, `readInstrumentDemand`
   (`[D-437]`'s reading, never throws) compares the instrument's target record with its CURRENT
   block, and `projectInstrumentDemands` keeps the `declared` readings: `instrumentDemands`.
   Instruments are read only when there is a declared demand for them to meet; with nothing
   declared, the vault is not asked for a single target record.
3. `unmetDemandsByConcept` (`olea-core`'s `gap/demand.ts`) runs the ruled `qualifying-review` rule
   and answers **only for concepts whose declared demands were read**; the map goes to
   `buildGapView` as `unmetDemands`, and a concept not in it carries no field on its row.
   **Absent is not empty.**

Nothing here writes: the reads assign no demand to any instrument (no backfill, `[D-277]` (f)),
and the provider never names the target record's writer. Nothing here is worded: the view's copy
reads no `unmetDemands`, and this bead adds no surface. A reader that throws is the same as one
that read nothing, so a failing optional reader never takes the whole view down.

## Unavailable, for two different reasons, one state
 *
 * `GapViewState` (`./view.ts`) is `{kind:'model', model} | {kind:'unavailable'}`
 * — two states, not three, and this module is not the place to widen that
 * (`GapView`'s public interface is out of this bead's scope; a workbench lane
 * mounts it). "No assignments Base path configured yet" (the same gate
 * `createLocalStudyPlanProvider` throws on) and "the vault walk itself threw"
 * both resolve to `'unavailable'` here, exactly as `plan/provider.ts`'s two
 * distinct failure causes both resolve to `refreshStudyPlan`'s one `reason`
 * field. `GAP_UNAVAILABLE_BODY`'s wording ("could not read your sources just
 * now") reads slightly off for the not-yet-configured case specifically; a
 * copy-level distinction between the two is a `./copy.ts` change this bead
 * does not make (`GapViewState` has no field to carry which case it was).
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type {
  ConceptMaterialPresence,
  DisputeLogRecord,
  GapRow,
  InstrumentDemandReading,
  PaperDemand,
  RankOracleOptions,
  Scheduler,
  VaultInstrumentRecord,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  buildGapView,
  buildMaterialPresence,
  calendarDaysEndingOn,
  composeOracleRanking,
  createFsrsScheduler,
  enumerateVaultInstruments,
  projectInstrumentDemands,
  projectInstrumentValidity,
  projectRegisteredFiles,
  readInstrumentDemand,
  readReviewLogFile,
  readReviewLogHistory,
  reviewLogPath,
  scoredConceptId,
  unmetDemandsByConcept,
} from 'olea-core';
import {
  isStudyPlanConfigured,
  type ObsidianDataHost,
  ObsidianStudyPlanSettingsStore,
} from '../plan/settings-store.js';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import { gapRowEvidenceBases } from './copy.js';
import type { GapViewDeps, GapViewState } from './view.js';

export interface CreateLocalGapProviderDeps {
  readonly vault: VaultSource;
  /** Names this device's own review-log files for the probe — same discipline as `plan/provider.ts` (C5.2). */
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /** Overridable for tests. Defaults to the window `open-session.ts` and the Today panel both probe. */
  readonly probeDays?: number;
  /**
   * What the `'build-session'` affordance does (`ol-p5t06b`, F4.6) — passed
   * straight through to `GapViewDeps.buildSession`.
   *
   * **It lives here rather than being spread onto the deps at the call site**
   * because this factory's whole job is "the production `GapViewDeps`", and a
   * caller that has to remember to add a second field to what a factory
   * returned is a caller that can forget. Optional: a host with no session
   * builder (the workbench) leaves it out and the label renders inert, exactly
   * as it did before this bead.
   */
  readonly buildSession?: (row: GapRow) => void;
  /**
   * `[D-110]` (`ol-v7r5.3`): reads the delivered `rank-weights` artifact —
   * see `rank/wiring.ts`'s `RankWeightsWiring.readRankWeights`. Mirrors
   * `plan/provider.ts`'s field of the same name exactly: absent, or
   * resolving `undefined` (unconfigured, offline, an expired or unreadable
   * envelope), means `composeOracleRanking` below runs with no `options` at
   * all and `rank.ts`'s own `DECLARED_FALLBACK_*` constants apply — F7.8's
   * degrade-not-half-work posture, nothing surfaced to her as an error.
   * `ol-v7r5.55` [IL-D7]: filing-time verification found this view fell
   * back to the declared defaults even when `main.ts` already held a
   * delivered artifact, because nothing here read it — this field, and the
   * `main.ts` wiring that passes it, close that gap.
   */
  readonly readRankWeights?: () => Promise<RankOracleOptions | undefined>;
  /**
   * C5.6/`[D-264]` (`ol-egov.141.89.10.22`): the port `composeOracleRanking`'s
   * `retrievability` input needs — same field, same reasoning as
   * `plan/provider.ts`'s own `scheduler` dep, which this mirrors exactly.
   * Omitting it left this view's ranking reading every concept's
   * retrievability as neutral while `plan/provider.ts` and
   * `session-builder/provider.ts` already read her real recall state — a gap
   * view and a plan that disagreed on the same underlying ordering.
   * **Overridable for tests** (a fake `Scheduler` makes retrievability
   * deterministic); production gets a fresh `createFsrsScheduler()` when
   * this is omitted — the same stateless, weights-fixed construction
   * `plan/provider.ts`'s own comment explains is safe to build a second time
   * without risking drift from another call site's instance.
   */
  readonly scheduler?: Scheduler;
  /**
   * `[D-437]` B5 (`ol-egov.141.89.2.27`), the assessment's declared demands, per concept KEY
   * (`GapRow.conceptKey`), **present only for a concept whose demands were read** from the
   * examiner-scope reading (`[D-429]`). The map is the gap view's question: for each concept in
   * it, which of these demands does no qualifying review show now.
   *
   * **Absent is not empty.** Omitted, resolving `undefined`, or throwing all mean nothing was
   * read, and every row then omits `unmetDemands`; a concept with no entry is not read as "asks
   * nothing". An entry of `[]` means the concept was read and states no demand. Only a decided
   * demand belongs here: an operation no word covers, a part whose demand could not be read, and
   * material too thin for a known operation are three different things, none of them a
   * `PaperDemand`, and none of them is ever supplied as one.
   *
   * **No production reader exists yet.** `main.ts` passes none, so this view shows no demand
   * today; the per-concept reader over the `[D-429]` stores is the follow-up that fills it.
   */
  readonly readDeclaredDemands?: () => Promise<
    ReadonlyMap<string, readonly PaperDemand[]> | undefined
  >;
}

/**
 * Tallies `VaultInstrumentRecord.notePath` — `buildMaterialPresence`'s second
 * argument. A note the enumeration never mentions contributes zero, which is
 * the honest reading `build.ts`'s own doc names: the caller found no
 * instruments there.
 */
function instrumentCountsByNotePath(
  records: readonly { readonly notePath: VaultPath }[],
): ReadonlyMap<VaultPath, number> {
  const counts = new Map<VaultPath, number>();
  for (const record of records) {
    counts.set(record.notePath, (counts.get(record.notePath) ?? 0) + 1);
  }
  return counts;
}

/**
 * `[D-095]`/`[D-338]`'s corrected-contest validity fold (`ol-egov.141.89.9.69`) needs dispute
 * records to reach `composeOracleRanking`'s own `disputes` input — `readReviewLogHistory`
 * (`../../core/session/history.ts`) deliberately does not surface them (`../../core/review-
 * log/parse.ts`'s own doc says why). `session/history.ts` sits outside this bead's `owns`, so
 * rather than widen it, this re-reads exactly the `files` that walk already reported as read —
 * matching `../registry/provider.ts`'s and `../grove/provider.ts`'s own `disputesFromFiles`
 * (duplicated rather than shared: different bead's `owns`, and this is six lines).
 */
async function disputesFromFiles(
  vault: VaultSource,
  files: readonly VaultPath[],
): Promise<readonly DisputeLogRecord[]> {
  const reads = await Promise.all(files.map((path) => readReviewLogFile(vault, path)));
  return reads.flatMap((read) => read.disputes);
}

/**
 * The declared demands, or `undefined` (nothing read) when there is no reader or it failed. A
 * failing optional reader must not take the whole view down, and must never read as "no demands".
 */
async function readDeclared(
  deps: CreateLocalGapProviderDeps,
): Promise<ReadonlyMap<string, readonly PaperDemand[]> | undefined> {
  if (deps.readDeclaredDemands === undefined) return undefined;
  try {
    return await deps.readDeclaredDemands();
  } catch (error) {
    console.error('Olea: could not read the declared demands; the gap view shows none', error);
    return undefined;
  }
}

/**
 * `instrumentDemands` (`[D-437]`): every instrument that scored a concept with declared demands,
 * read against its CURRENT block and projected to `declared` readings only. An instrument the
 * vault no longer holds has no block to compare and declares none.
 */
async function readInstrumentDemands(
  vault: VaultSource,
  records: readonly VaultInstrumentRecord[],
  entries: readonly ReviewLogEntry[],
  askedConcepts: ReadonlySet<string>,
): Promise<ReadonlyMap<string, readonly PaperDemand[]>> {
  const wanted = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    const scored = scoredConceptId(entry.conceptIds);
    if (scored !== undefined && askedConcepts.has(scored)) wanted.add(entry.instrumentId);
  }
  const blocks = new Map(
    records
      .filter((record) => wanted.has(record.instrumentId))
      .map((record) => [
        record.instrumentId,
        record.instrumentType === 'mcq' ? record.mcq : record.card,
      ]),
  );
  const readings = new Map<string, InstrumentDemandReading>(
    await Promise.all(
      [...blocks].map(
        async ([instrumentId, block]) =>
          [instrumentId, await readInstrumentDemand(vault, instrumentId, block)] as const,
      ),
    ),
  );
  return projectInstrumentDemands(readings);
}

/**
 * The gap view's `unmetDemands`: per concept whose declared demands were read, the demands no
 * qualifying review shows now (`[D-349]`). A concept not read has no entry. With nothing declared
 * the map is empty and no instrument is read.
 */
async function unmetDemandsFor(input: {
  readonly vault: VaultSource;
  readonly declaredDemands: ReadonlyMap<string, readonly PaperDemand[]> | undefined;
  readonly records: readonly VaultInstrumentRecord[];
  readonly entries: readonly ReviewLogEntry[];
  readonly disputes: readonly DisputeLogRecord[];
  readonly scheduler: Scheduler;
  readonly now: Date;
}): Promise<ReadonlyMap<string, readonly PaperDemand[]>> {
  const { declaredDemands } = input;
  // Nothing read: no concept can be asked, so no fold runs and no instrument is looked up.
  if (declaredDemands === undefined || declaredDemands.size === 0) return new Map();
  const asked = new Set<string>(
    [...declaredDemands].filter(([, demands]) => demands.length > 0).map(([key]) => key),
  );
  const instrumentDemands =
    asked.size === 0
      ? new Map<string, readonly PaperDemand[]>()
      : await readInstrumentDemands(input.vault, input.records, input.entries, asked);
  return unmetDemandsByConcept({
    declaredDemands,
    instrumentDemands,
    entries: input.entries,
    // The same dispute-aware projection `composeOracleRanking` folds (it does not return it).
    validity: projectInstrumentValidity(input.entries, input.disputes),
    scheduler: input.scheduler,
    now: input.now,
  });
}

/**
 * A `GapViewDeps` whose `load` composes a fresh `GapViewModel` from the vault
 * and the review log, entirely on-device, no Worker call — the gap-view twin
 * of `createLocalStudyPlanProvider`.
 */
export function createLocalGapProvider(deps: CreateLocalGapProviderDeps): GapViewDeps {
  const settingsStore = new ObsidianStudyPlanSettingsStore(deps.settingsHost);
  const scheduler = deps.scheduler ?? createFsrsScheduler();

  return {
    // `exactOptionalPropertyTypes`: omit the key entirely rather than assign
    // `undefined` to it when no session builder is wired.
    ...(deps.buildSession !== undefined ? { buildSession: deps.buildSession } : {}),
    async load(): Promise<GapViewState> {
      try {
        const config = await settingsStore.load();
        if (!isStudyPlanConfigured(config)) return { kind: 'unavailable' };

        const now = deps.now();
        const today = localToday(now);
        const probeDays = deps.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
        const additionalPaths = calendarDaysEndingOn(today, probeDays).map((day) =>
          reviewLogPath(day, deps.deviceId),
        );

        // Neither walk depends on the other's result — both read the same
        // read-only vault — and the rank-weights read is a same-tick
        // `undefined` when `deps.readRankWeights` is absent (or a network
        // call to the Worker when it is present) — so all three run
        // concurrently rather than paying their latency serially, the same
        // discipline `plan/provider.ts` uses for its own three-way
        // `Promise.all`.
        const [{ entries, files }, enumeration, options, declaredDemands] = await Promise.all([
          readReviewLogHistory(deps.vault, { additionalPaths }),
          // `[D-357]`: the permanent concept key, the one her review log carries.
          enumerateVaultInstruments(deps.vault, { concepts: { stampConceptKeys: true } }),
          deps.readRankWeights?.() ?? Promise.resolve(undefined),
          readDeclared(deps),
        ]);
        // `disputesFromFiles` re-reads the same `files` the walk above already reported (see its
        // own doc) — a second, unavoidable pass, since `readReviewLogHistory` does not surface disputes.
        const disputes = await disputesFromFiles(deps.vault, files);

        const { ranking, edges, mastery } = await composeOracleRanking({
          vault: deps.vault,
          basePath: config.assignmentsBasePath,
          reviewLog: entries,
          disputes,
          asOf: today,
          // The name→opaque-key source for `ConceptAssessmentEdge.conceptKey`
          // (`ol-63e1`) — already extracted by the instrument walk above, so
          // this pays no second walk.
          concepts: enumeration.concepts,
          // F1.5 / F4.2 (`ol-egov.141.89.7.35`): the documents she has registered, folded from
          // the "source registered" events already in `entries` — the same projection
          // `grove/provider.ts` reads. Without it a registered past-paper PDF never became a
          // ranking edge, and `edges.tier3.sourceCoverage` below never listed it as read.
          registeredFiles: projectRegisteredFiles(entries),
          // C5.6/`[D-264]` (`ol-egov.141.89.10.22`): thread the same
          // `retrievability` input `plan/provider.ts` and
          // `session-builder/provider.ts` already pass, so this view's
          // ranking reads her real recall state rather than the neutral
          // default — see `scheduler`'s own doc on `CreateLocalGapProviderDeps`.
          retrievability: { scheduler, now },
          // `[D-110]` (`ol-v7r5.55` [IL-D7]): thread the delivered
          // component 3.3 weights when `deps.readRankWeights` resolved one
          // — `exactOptionalPropertyTypes`: omit the key entirely rather
          // than assign `undefined` to it, matching `plan/provider.ts`.
          ...(options !== undefined ? { options } : {}),
        });

        const materialPresence: ReadonlyMap<string, ConceptMaterialPresence> =
          buildMaterialPresence(
            enumeration.concepts,
            instrumentCountsByNotePath(enumeration.records),
          );

        // `[D-437]` B5, `[D-349]`: the demand rule's two inputs, supplied here and nowhere else —
        // the instruments' declared demands (read through the target-record reading) and the
        // assessment's, per concept. A concept whose demands were not read has no entry (absent is
        // not empty), so today, with no declared-demands reader in production, no row carries the
        // field. See the module doc's section on the composition root.
        const unmetDemands = await unmetDemandsFor({
          vault: deps.vault,
          declaredDemands,
          records: enumeration.records,
          entries,
          disputes,
          scheduler,
          now,
        });

        const model = buildGapView({
          ranking,
          assessments: edges.assessmentsRead.records,
          mastery,
          materialPresence,
          unmetDemands,
          // `tier3.sourceCoverage`, unmodified — `ol-cvsc`'s scope statement
          // (`GapViewModel.scope`) is only as honest as this pass-through.
          // N-013 mutation test: deleting this line and passing `[]` instead
          // turns `model.scope.canStateExhaustiveness` false on a fixture
          // where it should read true (see `provider.spec.ts`) — that
          // mutation was performed and confirmed red, then reverted.
          sourceCoverage: edges.tier3.sourceCoverage,
        });

        // `[D-399]`/`ol-egov.141.89.10.74`: the same edges the ranking was
        // composed from name each row's evidence basis — past-paper,
        // objectives or assessment-brief. Threaded through so `GapView`'s
        // course framing can tell a brief-only row from an objectives-only
        // one (both carry an empty `citations` array on `GapRow`); without
        // this, `copy.ts#rankingAttribution`'s unsupplied-`bases` inference
        // reads every citation-less row as objectives-based, which a
        // brief-only row (once she declares a scope) would wrongly share.
        const bases = gapRowEvidenceBases(edges.edges);

        return { kind: 'model', model, bases };
      } catch (error) {
        console.error('Olea: could not compose the gap view', error);
        return { kind: 'unavailable' };
      }
    },
  };
}
