/**
 * `createLocalStudyPlanProvider` — the production `StudyPlanProvider`
 * (P5-T07).
 *
 * `plan/types.ts`'s own doc calls this seam "A2.5's Worker half" and says a
 * production implementation "speaks the Worker envelope" — written before
 * `rankOracle` existed. Its own module doc is explicit that the ranking is
 * "computed with no model call and no network," and `oracle/compose.ts`'s
 * `composeOracleRanking` is the whole of that computation, vault and review
 * log in, `RankOracleResult` out. There is nothing for a Worker call to do
 * *for the ranking itself*: the policy the plan carries is derived entirely
 * from her own assessments Base and her own review log, both already on the
 * device. `StudyPlanProvider.fetchPlan` does not require HTTP anywhere in
 * its contract, only "compute a fresh plan" — this computes one locally.
 *
 * **`deps.readRankWeights` is the one optional exception, added by
 * `ol-v7r5.3` for `[D-110]`.** Component 3.3's ranking-weight *factors*
 * (proximity half-life, assessment weight divisor, mastery-need ladder) are
 * DERIVED and now delivered from the service (`rank/wiring.ts`,
 * `rank/rank-weights-provider.ts`) rather than baked into this package —
 * but the *ranking computation* stays exactly as local and network-free as
 * the paragraph above says. When `readRankWeights` is absent, or it
 * resolves `undefined` (unconfigured, offline, an expired or unreadable
 * envelope — every case `fetchRankWeightsOptions` collapses to one
 * outcome), `composeOracleRanking` is called with no `options` at all and
 * `rank.ts`'s own `DECLARED_FALLBACK_*` constants apply — F7.8's posture,
 * degrade rather than half-work, with nothing surfaced to her as an error.
 *
 * ## Never throws past `fetchPlan`'s own caller… except by design
 *
 * `refreshStudyPlan` (`olea-core`) is what actually calls `fetchPlan`, and its
 * whole design is "a bad or missing plan never costs her the one she already
 * has" (see that module's doc) — a throw here is caught there and reported
 * through `reason`, never surfaced past it. So this function throws freely
 * for the ordinary "not configured yet" and "vault walk failed" cases rather
 * than inventing its own degraded return value; `refreshStudyPlan` already
 * has the degradation path built and tested.
 *
 * ## The review-log read, and the same probe this file did not invent
 *
 * Obsidian's `vault.getFiles()` does not return dot-prefixed trees (see
 * `open-session.ts`'s identical comment), so `readReviewLogHistory`'s
 * listing-based discovery finds nothing under `.olea/reviews/` on this host
 * unless told the file names to look for. This reuses the exact
 * `calendarDaysEndingOn` + `reviewLogPath` probe `open-session.ts` and
 * `today/data-source.ts` already use, over the same window
 * (`SCHEDULING_HISTORY_PROBE_DAYS`) — one number, not a second one invented
 * for mastery specifically. It only names *this device's* files, same
 * limitation, same reason it is not fixed here (see `session/history.ts`'s
 * module doc).
 */

import type {
  RankOracleOptions,
  Scheduler,
  StudyPlanProvider,
  StudyPlanStore,
  VaultSource,
} from 'olea-core';
import {
  buildStudyPlan,
  calendarDaysEndingOn,
  composeOracleRanking,
  createFsrsScheduler,
  loadCachedStudyPlan,
  pastSessionsFromReviewLog,
  readReviewLogHistory,
  resolveAssessments,
  resolvePlanPolicyCourseInputs,
  reviewLogPath,
} from 'olea-core';
import { extractConceptsFromVault } from '../concept/wiring.js';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import type { PlanPolicyRequest, PlanPolicyResult } from './plan-policy-provider.js';
import {
  isStudyPlanConfigured,
  type ObsidianDataHost,
  ObsidianStudyPlanSettingsStore,
} from './settings-store.js';

export interface CreateLocalStudyPlanProviderDeps {
  readonly vault: VaultSource;
  /** Names this device's own review-log files for the probe — same discipline as `open-session.ts` (C5.2). */
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /** Overridable for tests. Defaults to the window `open-session.ts` and the Today panel both probe. */
  readonly probeDays?: number;
  /**
   * `[D-110]` (`ol-v7r5.3`): reads the delivered `rank-weights` artifact —
   * see `rank/wiring.ts`'s `RankWeightsWiring.readRankWeights`. Absent, or
   * resolving `undefined`, means `composeOracleRanking` runs with no
   * `options`, which is `rank.ts`'s declared-fallback path — see the module
   * doc above.
   */
  readonly readRankWeights?: () => Promise<RankOracleOptions | undefined>;
  /**
   * `[D-167]` / `ol-v7r5.25`: reads component 3.5's allocation policy from
   * `POST /v1/plan-policy`, behind `plan-policy-wiring.ts`'s fingerprint
   * gate — an unchanged fingerprint reuses the cached result rather than
   * calling out. **Two different meanings, not one** (`ol-egov.141.89.10.16`
   * fixed the conflation): this dep being ABSENT (unconfigured, F7.8 AI
   * off) means this refresh's plan carries no `allocation` field at all,
   * exactly the "no policy travelled" reading `StudyPlanBody.allocation`'s
   * own doc states — never a caller-invented zero. This dep being PRESENT
   * and resolving `undefined` means it was actually called and failed
   * (offline, a non-2xx response, an unparseable or malformed body — every
   * case `plan-policy-provider.ts`'s `fetchPlanPolicy` collapses to
   * `undefined` on purpose at that layer); `fetchPlan` throws in that case
   * rather than silently building an allocation-less plan — see the throw
   * site below for why.
   */
  readonly readPlanPolicy?: (request: PlanPolicyRequest) => Promise<PlanPolicyResult | undefined>;
  /**
   * C5.6/`[D-264]` items 3-4 (`ol-v7r5.53`): the port `composeOracleRanking`'s
   * `retrievability` input needs to read real per-concept recall probability
   * (`oracle/compose.ts`'s `ComposeRetrievabilityInput.scheduler`) rather than
   * the neutral default every production caller left it at until now.
   * **Overridable for tests** (a fake `Scheduler` makes retrievability
   * deterministic); production gets a fresh `createFsrsScheduler()` when this
   * is omitted — the same stateless, weights-fixed construction `main.ts`
   * already builds once for the Today panel/queue (see that file's own
   * comment on why one instance there "makes that literally the same
   * computation rather than two that match"). That reasoning is about two
   * call sites at risk of drifting apart on the SAME replay; it does not
   * apply here — `createFsrsScheduler()` takes no configuration and no
   * mutable state carries between calls (`fsrs-scheduler.ts`'s module doc),
   * so a second instance computes byte-identically to the first and this
   * provider does not need `main.ts`'s to reach the same answer.
   */
  readonly scheduler?: Scheduler;
  /**
   * `[DOS-C4-a]` / `ol-feza`, follow-up to `ol-v7r5.63`'s pure
   * `sittingsSinceFloorMet` producer (`resolvePlanPolicyCourseInputs`,
   * `olea-core`): the previous cached plan is this device's one honest
   * source of a real per-course floor share (component 3.5 is `boundary:
   * service`, boundary document §1 — this file does not recompute one), read
   * the same way `today/data-source.ts`'s `createVaultTrendsSource
   * #listCourseFloorShares` already reads it: `loadCachedStudyPlan`, then
   * each allocation entry's `'floor'`-named contribution. Paired below with
   * a fresh `pastSessionsFromReviewLog` read over the SAME `entries`/
   * `concepts` this function already walked, so `sittingsSinceFloorMet`
   * finally reaches a production caller.
   *
   * **Optional, and every existing caller/test keeps compiling and
   * behaving unchanged when it is absent** — `readFloorSharesByCourse`
   * below returns `new Map()` for `undefined`, which is exactly
   * `resolvePlanPolicyCourseInputs`'s own default, so `sittingsSinceFloorMet`
   * stays absent from the wire shape precisely as it did before this bead.
   */
  readonly studyPlanStore?: StudyPlanStore;
}

/**
 * The previous cached plan's per-course floor shares — `[DOS-C4-a]`'s other
 * half of `sittingsSinceFloorMet`'s two new inputs. `undefined` `store`,
 * "never cached", "unreadable blob", "expired envelope" and "cached before
 * `ol-v7r5.17` [ALLOC-2] added `allocation`" all collapse to the same empty
 * map — the same four-way collapse `today/data-source.ts`'s
 * `listCourseFloorShares` already documents for this identical read, and the
 * same "absence, not a fabricated number" convention
 * `CourseFloorShare.floorShare` and `sittingsSinceFloorMet` itself use.
 */
async function readFloorSharesByCourse(
  store: StudyPlanStore | undefined,
  now: Date,
): Promise<ReadonlyMap<string, number>> {
  if (store === undefined) return new Map();
  const { plan } = await loadCachedStudyPlan(store, now);
  const allocation = plan?.body.allocation;
  if (!allocation) return new Map();
  const floorShares = new Map<string, number>();
  for (const entry of allocation) {
    const floorShare = entry.contributions.find(
      (contribution) => contribution.name === 'floor',
    )?.value;
    if (floorShare !== undefined) floorShares.set(entry.courseId, floorShare);
  }
  return floorShares;
}

/**
 * A `StudyPlanProvider` whose `fetchPlan` composes a fresh `RankOracleResult`
 * from the vault and the review log, and builds it into a `StudyPlanArtifact`
 * — entirely on-device, no Worker call.
 */
export function createLocalStudyPlanProvider(
  deps: CreateLocalStudyPlanProviderDeps,
): StudyPlanProvider {
  const settingsStore = new ObsidianStudyPlanSettingsStore(deps.settingsHost);
  const scheduler = deps.scheduler ?? createFsrsScheduler();

  return {
    async fetchPlan(): Promise<unknown> {
      const config = await settingsStore.load();
      if (!isStudyPlanConfigured(config)) {
        throw new Error(
          'Olea: no assignments Base path configured (Settings → Olea) — cannot compose a study plan.',
        );
      }

      const now = deps.now();
      const today = localToday(now);
      const probeDays = deps.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
      const additionalPaths = calendarDaysEndingOn(today, probeDays).map((day) =>
        reviewLogPath(day, deps.deviceId),
      );

      // Neither walk depends on the other's result — both read the same
      // read-only vault — so they run concurrently, same discipline as
      // `gap/provider.ts`/`session-builder/provider.ts`. `extractConcepts`
      // (not the heavier `enumerateVaultInstruments`, which this provider has
      // no other use for) is the name→opaque-key source for
      // `ConceptAssessmentEdge.conceptKey` (`ol-63e1`).
      // The vault/log walk and the rank-weights fetch share nothing —
      // one reads her material, the other is a network call to the Worker
      // (or a same-tick `undefined` when `readRankWeights` is absent) — so
      // all three run concurrently, same discipline as the two walks below.
      // `resolveAssessments` here (`ol-egov.141.8.10`, F1.2's Base-or-manual
      // fallback) is a SECOND read of the same Base path `composeOracleRanking`
      // reads internally via its own (unswitched) `readAssessments` call —
      // accepted duplication rather than widening that function's already-
      // external result shape (`ComposeOracleRankingResult` is
      // `oracle/compose.ts`, outside this bead's granted `owns`): both reads
      // target the same read-only vault, and this is the only raw source
      // component 3.5's `assessmentWorth`/`daysToNextAssessment` inputs can be
      // resolved from without duplicating 3.3's own half-life/divisor (see
      // `resolvePlanPolicyCourseInputs`'s module doc, `olea-core`).
      // **This one call site's manual fallback is NOT yet load-bearing for
      // the ranking itself** — `composeOracleRanking` → `buildConceptAssessmentEdges`
      // (`olea-core/evidence-edge/build.ts`) still calls `readAssessments`
      // directly, so a manual-only setup (no Base configured) still ranks
      // with zero assessment edges; only `resolvePlanPolicyCourseInputs`'s
      // own inputs below see a manual entry today. See this bead's report
      // for the follow-up that would close that gap (core-side, outside
      // this bead's `owns`), and why `fetchPlan`'s earlier
      // `isStudyPlanConfigured` throw (above) is deliberately left
      // untouched: relaxing it here would not let a manual-only setup
      // through anyway (that internal `readAssessments` call still throws
      // on a blank `basePath`), only replace this function's own clear
      // "no assignments Base path configured" message with an uglier one
      // surfacing from two calls deeper.
      const [{ entries }, concepts, options, assessmentReport] = await Promise.all([
        readReviewLogHistory(deps.vault, { additionalPaths }),
        extractConceptsFromVault(deps.vault, {}),
        deps.readRankWeights?.() ?? Promise.resolve(undefined),
        resolveAssessments(deps.vault, config.assignmentsBasePath),
      ]);

      const { ranking } = await composeOracleRanking({
        vault: deps.vault,
        basePath: config.assignmentsBasePath,
        reviewLog: entries,
        asOf: today,
        concepts,
        // C5.6/`[D-264]` items 3-4 (`ol-v7r5.53`): this was the one production
        // caller `oracle/compose.ts`'s own module doc named as still omitting
        // `retrievability` — every ranked concept's `retrievabilityWeight`
        // read as neutral (1, no adjustment) regardless of her real recall
        // state. Wiring it here is what makes `readReadinessRecall`'s
        // undefined-vs-defined distinction reach `resolvePlanPolicyCourseInputs`
        // below, not just `rankOracle`'s own blend.
        retrievability: { scheduler, now },
        ...(options !== undefined ? { options } : {}),
      });

      // `[DOS-C4-a]` / `ol-feza`: `sittingsSinceFloorMet`'s two inputs,
      // resolved from what this device already has. `sittingsHistory` reuses
      // the SAME `entries`/`concepts` this function already walked above —
      // the identical `pastSessionsFromReviewLog` construction
      // `main.ts`'s `windowDeficitFromReviewLog` already uses for `[SESS-14]`
      // — over the current ranking's own course set (every course
      // `rankOracle` reported on this tick). `floorSharesByCourse` reads the
      // PREVIOUS cached plan through `deps.studyPlanStore`, when supplied;
      // both default to empty when there is nothing to read yet, which is
      // `resolvePlanPolicyCourseInputs`'s own pre-this-bead behaviour.
      const sittingsHistory = pastSessionsFromReviewLog(entries, {
        coursesOfConcept: new Map(concepts.map((concept) => [concept.key, concept.courses])),
        runningCourses: ranking.courses.map((course) => course.course),
      });
      const floorSharesByCourse = await readFloorSharesByCourse(deps.studyPlanStore, now);

      // `[D-167]` / `ol-v7r5.25`: resolve component 3.5's per-course inputs
      // from what this device already has, ask for the allocation policy
      // behind the fingerprint gate, and land whatever comes back onto the
      // plan. `deps.readPlanPolicy` ABSENT (F7.8: unconfigured, offline
      // mode, AI features off) and `courses.length === 0` (nothing running
      // to allocate for) are both a designed "no policy applies" state —
      // `allocation` stays unset below, same degrade-not-half-work posture
      // as `readRankWeights` above: a plan with no allocation is
      // byte-identical to today's plan before this bead.
      //
      // **`ol-egov.141.89.10.16`: a CALL that is actually made and resolves
      // `undefined` is a different thing — a failure, not a design state.**
      // `deps.readPlanPolicy` present means this device IS configured to
      // ask; `plan-policy-provider.ts`'s `fetchPlanPolicy` (its own doc)
      // collapses every transport/parse/shape failure to `undefined`, on
      // purpose, at that layer — but a caller here reading THAT `undefined`
      // identically to "never asked" is exactly the bug: it silently built
      // a schema-valid plan missing only `allocation`, which
      // `refresh.ts`'s `read.status === 'ok'` then read as a genuine
      // success and cached over whatever plan (possibly WITH an
      // allocation) existed before, even though a bad answer is supposed
      // to never cost her the plan she already had (`refresh.ts`'s own
      // module doc). So an attempted-and-failed policy fetch throws here
      // instead — this file's own doc above already documents exactly this
      // convention for "not configured yet" and "vault walk failed": the
      // throw is caught by `refreshStudyPlan`, which keeps the cached plan,
      // allocation included, and reports the failure through `reason`
      // rather than losing anything.
      const courses = resolvePlanPolicyCourseInputs(
        today,
        ranking,
        assessmentReport.records,
        concepts,
        sittingsHistory,
        floorSharesByCourse,
      );
      const attemptingPolicyFetch = courses.length > 0 && deps.readPlanPolicy !== undefined;
      const policy = attemptingPolicyFetch
        ? await deps.readPlanPolicy?.({ asOf: today, courses })
        : undefined;
      if (attemptingPolicyFetch && policy === undefined) {
        throw new Error(
          'Olea: the allocation policy fetch failed — keeping the cached study plan rather than caching one with no allocation.',
        );
      }

      return buildStudyPlan({
        ranking,
        computedAt: now.toISOString(),
        // `ol-egov.141.89.10.23`: `options` is the exact `RankOracleOptions`
        // already handed to `composeOracleRanking` above — folded into
        // `policyVersion`'s hash so a plan ranked under different delivered
        // (or fallback) weights never shares a version with one ranked under
        // today's, even in the degenerate case where the reordering happens
        // to leave `courses` byte-identical. Absent exactly when it was
        // absent to `composeOracleRanking` (`readRankWeights` unset, or
        // resolving `undefined` — F7.8's fallback path), so a plan built
        // with no delivered weights hashes exactly as it did before this bead.
        ...(options !== undefined ? { rankWeights: options } : {}),
        ...(policy !== undefined
          ? {
              allocation: policy.allocation.map((entry) => ({
                ...entry,
                contributions: [...entry.contributions],
              })),
              // `ol-egov.141.89.10.51`: `policy.floorsFundable` was decoded
              // by `plan-policy-provider.ts` and dropped here before this
              // bead — threaded through the same way `allocation` is,
              // landed verbatim on `body.floorsFundable` and folded into
              // `policyVersion`'s hash. Nothing renders it yet.
              floorsFundable: policy.floorsFundable,
            }
          : {}),
      });
    },
  };
}
