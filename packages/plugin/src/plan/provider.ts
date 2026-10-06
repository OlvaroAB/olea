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
  CourseAvoidanceSteeringAnswer,
  DisputeLogRecord,
  RankOracleOptions,
  Scheduler,
  StudyPlanProvider,
  StudyPlanStore,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  buildStudyPlan,
  calendarDaysEndingOn,
  composeOracleRanking,
  createFsrsScheduler,
  enumerateVaultInstruments,
  loadCachedStudyPlan,
  pastSessionsFromReviewLog,
  projectRegisteredFiles,
  readReviewLogFile,
  readReviewLogHistory,
  resolveAssessments,
  resolvePlanPolicyCourseInputs,
  reviewLogPath,
} from 'olea-core';
// Read-only import — `home/` is a concurrent lane's `owns`, not this bead's
// (`ol-egov.141.93`). `ObsidianHomeAvoidanceStore` is the durable F4.6
// record this bead wires into `resolvePlanPolicyCourseInputs` below; nothing
// in `home/avoidance.ts` is edited by this bead.
import type { CourseAvoidanceRecord } from '../home/avoidance.js';
import { ObsidianHomeAvoidanceStore } from '../home/avoidance.js';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import type { PlanPolicyRequest, PlanPolicyResult } from './plan-policy-provider.js';
import { type ObsidianDataHost, ObsidianStudyPlanSettingsStore } from './settings-store.js';

const AVOIDANCE_DAY_MS = 24 * 60 * 60 * 1000;

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
 * D-361's own clarification (`ol-egov.141.92`, carried on this bead's
 * acceptance): the ruling accepts `0.25` as `leave-for-now`'s steering
 * weight only WITH a stated, checkable expiry — "there is no expiry
 * condition in the code today" is the exact gap the ruling names. This is
 * that stated condition, half of it: a `leave-for-now` answer stops applying
 * once it is this many days old (the other half — a newer answer supersedes
 * an older one — falls out of `ObsidianHomeAvoidanceStore.recordAnswer`
 * itself, which REPLACES a course's stored answer rather than accumulating
 * one, so `load()` can only ever return the latest).
 *
 * **Declared, Class B, provisional (`docs/dev/engineering-conventions.md`'s
 * declared/derived line; run charter's decision ladder) — a plain-English
 * guess, not fitted to any data, flagged for David's retroactive review, and
 * explicitly named in D-361's own ruling as something to revisit "once real
 * answers exist."** Two weeks: long enough that a single ordinary lull
 * between sittings on an otherwise-fine course does not silently reactivate
 * steering mid-cycle, short enough that a soft deprioritisation she gave
 * once does not quietly outlive the situation that prompted it.
 */
export const AVOIDANCE_ANSWER_EXPIRY_DAYS = 14;

/**
 * D-361's expiry, applied at read time (never at write time — the store
 * itself stays a plain durable record, per this bead's brief not to touch
 * its persisted shape). Only `'leave-for-now'` answers are considered:
 * `'practise-differently'` stays recorded and inert per the ruling's other
 * half — `resolvePlanPolicyCourseInputs` already resolves it to no
 * `steeringWeight` (`steeringWeightForAvoidanceAnswer`, `olea-core`), but
 * this function does not even hand it across the boundary, so no future
 * change to that core fold can accidentally start steering on it from this
 * caller.
 *
 * An answer with no readable `recordedAt` timestamp cannot happen through
 * this store today — `ObsidianHomeAvoidanceStore.load()`'s own
 * `isCourseAvoidanceAnswerRecord` guard rejects any persisted blob whose
 * `answer.recordedAt` is not a `string` before this function ever sees it —
 * but a string that fails to PARSE as a date (corrupted `data.json`, a
 * future format change) is still possible. That case is read as expired,
 * never as "no expiry" and never thrown: a plan fetch degrading to "no
 * steering for this course" is the same "absence, not a fabricated
 * confident answer" posture this file already applies throughout (see
 * `readFloorSharesByCourse`), and it is strictly SAFER than the alternative
 * (an unparseable date silently reading as fresh forever).
 */
function avoidanceSteeringAnswersByCourse(
  records: ReadonlyMap<string, CourseAvoidanceRecord>,
  nowMs: number,
  expiryDays: number = AVOIDANCE_ANSWER_EXPIRY_DAYS,
): ReadonlyMap<string, CourseAvoidanceSteeringAnswer> {
  const expiryMs = expiryDays * AVOIDANCE_DAY_MS;
  const answers = new Map<string, CourseAvoidanceSteeringAnswer>();
  for (const [course, record] of records) {
    if (record.answer === undefined || record.answer.value !== 'leave-for-now') continue;
    const recordedAtMs = Date.parse(record.answer.recordedAt);
    if (Number.isNaN(recordedAtMs)) continue; // unparseable — read as expired, never thrown
    if (nowMs - recordedAtMs >= expiryMs) continue; // expired
    answers.set(course, 'leave-for-now');
  }
  return answers;
}

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

      const now = deps.now();
      const today = localToday(now);
      const probeDays = deps.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
      const additionalPaths = calendarDaysEndingOn(today, probeDays).map((day) =>
        reviewLogPath(day, deps.deviceId),
      );

      // Neither walk depends on the other's result — both read the same
      // read-only vault — so they run concurrently, same discipline as
      // `gap/provider.ts`/`session-builder/provider.ts`. The concept list
      // inside the instrument walk is the name→opaque-key source for
      // `ConceptAssessmentEdge.conceptKey` (`ol-63e1`).
      // The vault/log walk and the rank-weights fetch share nothing —
      // one reads her material, the other is a network call to the Worker
      // (or a same-tick `undefined` when `readRankWeights` is absent) — so
      // all three run concurrently, same discipline as the two walks below.
      // `resolveAssessments` here (`ol-egov.141.8.10`, F1.2's Base-or-manual
      // fallback) is a SECOND read of the same Base path `composeOracleRanking`
      // reads internally via `buildConceptAssessmentEdges`
      // (`olea-core/evidence-edge/build.ts`) — accepted duplication rather
      // than widening that function's already-external result shape
      // (`ComposeOracleRankingResult` is `oracle/compose.ts`, outside this
      // bead's granted `owns`): both reads target the same read-only vault
      // with the same `basePath`, so they resolve the identical source
      // (`'base'` or `'manual'`) and the identical records — this is the
      // only raw source component 3.5's `assessmentWorth`/`daysToNextAssessment`
      // inputs can be resolved from without duplicating 3.3's own
      // half-life/divisor (see `resolvePlanPolicyCourseInputs`'s module doc,
      // `olea-core`).
      // **This one call site's manual fallback IS now load-bearing for the
      // ranking itself** — `evidence-edge/build.ts` switched its own
      // assessment read to `resolveAssessments` too (`ol-egov.141.8.10`,
      // core-side), so a manual-only setup (no Base configured) now ranks
      // off the same manual entries this call reads, rather than zero
      // assessment edges.
      // `[D-404]` (`ol-egov.141.89.10.5`): the instrument walk replaces the
      // bare concept extraction it contains — `enumerateVaultInstruments`
      // runs `extractConcepts` with the same `stampConceptKeys: true` that
      // `extractConceptsFromVault(vault, {})` passes, so `concepts` is the
      // identical list, and its `records` are the instrument inventory
      // `composeOracleRanking` needs to veto a concept none of whose
      // instruments she can still be served (the plan's served set,
      // `[D-404]` condition 2). One walk, the same one
      // `session-builder/provider.ts` makes.
      const [{ entries, files }, enumeration, options, assessmentReport] = await Promise.all([
        readReviewLogHistory(deps.vault, { additionalPaths }),
        enumerateVaultInstruments(deps.vault, { concepts: { stampConceptKeys: true } }),
        deps.readRankWeights?.() ?? Promise.resolve(undefined),
        resolveAssessments(deps.vault, config.assignmentsBasePath),
      ]);
      const concepts = enumeration.concepts;
      // `disputesFromFiles` re-reads the same `files` the walk above already reported (see its
      // own doc) — a second, unavoidable pass, since `readReviewLogHistory` does not surface disputes.
      const disputes = await disputesFromFiles(deps.vault, files);

      // F1.2 (`ol-egov.141.8.10`): "not configured" now means neither a real
      // Base NOR any manual entry produced anything to work from —
      // `resolveAssessments`'s own `source: 'manual'` with zero records is
      // exactly that state (a blank OR unreadable Base, and she has typed
      // nothing by hand either) — the same reading `paper/provider.ts`'s
      // `loadCourseState` already applies. This replaces the old
      // `isStudyPlanConfigured(config)` gate, which fired on a blank
      // `basePath` alone and never let a manual-only setup through.
      if (assessmentReport.source === 'manual' && assessmentReport.records.length === 0) {
        throw new Error(
          'Olea: no assignments Base path configured (Settings → Olea) — cannot compose a study plan.',
        );
      }

      const { ranking } = await composeOracleRanking({
        vault: deps.vault,
        basePath: config.assignmentsBasePath,
        reviewLog: entries,
        disputes,
        asOf: today,
        concepts,
        // F1.5 / F4.2 (`ol-egov.141.89.7.35`): the documents she has registered — the "source
        // registered" events already in `entries` — folded into the `RegisteredFileSpec[]` the
        // evidence-edge builder reads, exactly as `grove/provider.ts` folds them for its own
        // tier-3 read. Without this a past-paper PDF she registers (a file that cannot carry a
        // `role` property) never became a ranking edge: it reached the grove and stopped there.
        registeredFiles: projectRegisteredFiles(entries),
        // C5.6/`[D-264]` items 3-4 (`ol-v7r5.53`): this was the one production
        // caller `oracle/compose.ts`'s own module doc named as still omitting
        // `retrievability` — every ranked concept's `retrievabilityWeight`
        // read as neutral (1, no adjustment) regardless of her real recall
        // state. Wiring it here is what makes `readReadinessRecall`'s
        // undefined-vs-defined distinction reach `resolvePlanPolicyCourseInputs`
        // below, not just `rankOracle`'s own blend.
        retrievability: { scheduler, now },
        ...(options !== undefined ? { options } : {}),
        // `[D-404]`: the suspension fold over `entries` happens inside
        // `composeOracleRanking`. No citation-freshness or
        // pending-revalidation reading reaches this provider yet, so
        // `otherIneligibleInstrumentIds` is omitted: nothing is withheld
        // here on those grounds (the session's own fill still withholds
        // them, `study-session/compose.ts`).
        instrumentInventory: enumeration.records,
        // `[D-447]` option (b) (ruled 2026-09-29; core half `ol-egov.141.89.10.96`, plan half
        // `ol-egov.141.89.10.99`): a concept she has practised that no assessment reaches is
        // ranked at need-only, as the session composition already does
        // (`session-builder/provider.ts`), so Home's plan and Start's session agree. It carries
        // no assessment contribution and `buildStudyPlan` marks its single citation
        // `unknown-relevance` (`[D-529]`, `[D-329]`), the shape the plan contract already has.
        // This is the production caller of the admission for the cached plan
        // (`main.ts` `refreshCachedStudyPlan`). `[D-373]`'s door (a course with no assessment
        // record) stays closed here: `serveCoursesWithoutAssessmentsOnNeed` is not set.
        // `gap/provider.ts` and `registry/provider.ts` stay out for the reason
        // `oracle/compose.ts` gives: they read scope and coverage, not practice to serve.
        admitPractisedUnlinkedConcepts: true,
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

      // `ol-egov.141.93` (D-361): the same durable, per-course F4.6 answer
      // `home/provider.ts` writes through `ObsidianHomeAvoidanceStore` —
      // same `deps.settingsHost`, same single `data.json` blob, keyed
      // separately (`HOME_AVOIDANCE_STORAGE_KEY`), so no new dependency is
      // threaded in to read it. `avoidanceSteeringAnswersByCourse` (above)
      // applies D-361's expiry and drops `'practise-differently'` entirely
      // before this ever reaches `resolvePlanPolicyCourseInputs`.
      const avoidanceAnswersByCourse = avoidanceSteeringAnswersByCourse(
        await new ObsidianHomeAvoidanceStore(deps.settingsHost).load(),
        now.getTime(),
      );

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
        avoidanceAnswersByCourse,
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
