/**
 * The fixture-vault oracle — walkthrough mode ONLY (D-041 `ol-st9i`, its
 * consumer `ol-c48c`). Runs the real `mastery -> rank -> plan -> gap` chain
 * over the actual fixture vault's own material (`packages/core/fixtures/
 * vault/`) rather than `packages/synthetic`'s coined curriculum — the
 * deliberate, decision-backed exception `oracle-scenarios.ts`'s module doc
 * calls out ("never the fixture vault") and `main.ts`'s sidebar note for the
 * flat oracle surface still states correctly: THAT surface is unchanged.
 *
 * ## Why this does not need a cassette
 *
 * `composeOracleRanking`, `extractConcepts`, `buildMaterialPresence` and
 * `buildGapView` (all `olea-core`) are pure, model-free, network-free
 * projections over a `VaultSource` — the exact chain
 * `packages/plugin/src/plan/provider.ts`'s `createLocalStudyPlanProvider`
 * already calls in production, just handed `loadFixtureVault()`'s
 * `MemoryVaultSource` instead of an `ObsidianSource`. No embedding, no
 * generative call, no `.embedding-cassette/` or `.generation-cassette/` — the
 * ranking numbers are real arithmetic over her real (invented) notes and her
 * real (invented) assignments Base, every time this runs.
 *
 * ## The review history is real now, too (`ol-0v9n`)
 *
 * This used to build the review history the same way `persona/history.ts`'s
 * `entriesFor` does for the review/today surfaces: a positional ring-join
 * from a borrowed synthetic persona stream onto the vault's REAL instruments.
 * That works for those surfaces because they only need a plausible SHAPE of
 * history. It did not work here: steps 7 and 8 compute a real ranking over
 * real fixture-vault concepts, then look up mastery for those concepts — and
 * the borrowed history landed on whichever instrument the ring happened to
 * reach, never the concepts actually ranked. Every row read `seed` ("new"),
 * and the caption had to say so.
 *
 * `FIXTURE_ORACLE_HISTORY` (`./fixture-oracle-history.ts`) replaces the
 * ring-join: a small, deterministic, GENERATED-AND-COMMITTED set of review
 * events whose `conceptIds` are the fixture vault's own real concept keys —
 * see that file's own module doc and its generator
 * (`scripts/generate-fixture-oracle-history.mjs`) for the full argument,
 * including why a hand-written story rather than a call into
 * `packages/synthetic` (its generator has no way to target an external
 * concept id — it mints its own `syn:concept:…` curriculum internally).
 * The result is real fixture mastery: a spread across all four C5.4 states,
 * chosen per `ol-0v9n`'s "what to watch" so the screen shows a high-yield
 * concept she is solid on and a low-yield one she has over-studied without
 * it sticking — not uniform bad news, and not a flattered best case either.
 * "High-/low-yield" is each concept's raw course-material importance
 * (`factors.preMasteryScore`), not the final DISPLAYED rank — `rankOracle`
 * multiplies that by a mastery-need weight, so the concept she is now solid
 * on correctly drops in the rank a viewer sees, and the low-yield one stays
 * near the bottom regardless of how much she has studied it. See the
 * generator's own module doc for the concept-by-concept argument.
 *
 * `asOf` is `2026-09-14` — the Monday of the fixture vault's "week six"
 * (the daily note at `00 Daily notes/2026-08-10.md` is week one's Monday) —
 * chosen so her real assignments' `due` dates are still ahead of it
 * (`computeExamProximity` in `olea-core`'s `oracle/rank.ts` scores a PAST due
 * date 0, which would flatten every ranking to zero and defeat the whole
 * point of showing scores). `FIXTURE_ORACLE_HISTORY`'s own events all fall
 * well before it, for the same reason.
 *
 * ## The illustrative label, not repeated here
 *
 * This module computes numbers; it does not decide how they are captioned.
 * `main.ts` renders D-041's illustrative label inside the host pane next to
 * whatever this module returns — see that file for the exact wording and
 * placement rule.
 *
 * ## All three gap classes, genuinely (`ol-m3ty`)
 *
 * `buildFixtureOracle` reads through `withGapClassExtension`
 * (`./fixture-oracle-vault.js`), a small, read-only overlay adding exactly
 * enough to the vault it is given that a real `mastery-gap` and a real
 * `material-gap` row are reachable, alongside the coverage-gap rows the
 * unmodified fixture vault already produces — see that file's own module doc
 * for the mechanism and why the extension lives here rather than in
 * `packages/core/fixtures/vault/` itself.
 */

import {
  buildMaterialPresence,
  composeOracleRanking,
  enumerateVaultInstruments,
  extractConcepts,
  type VaultSource,
} from 'olea-core';
import { buildGapView, buildStudyPlan, type GapViewModel } from '../oracle-bridge.js';
import { FIXTURE_ORACLE_HISTORY } from './fixture-oracle-history.js';
import { withGapClassExtension } from './fixture-oracle-vault.js';
import { type PipelineTrace, recordStage, recordStageAsync, type StageRecord } from './trace.js';

/** The Bases assignments table `readAssessments` scans — real, checked-in fixture content. */
const BASE_PATH = '02 Assignments/Assignments.base';
/** Not a note of hers — excluded from every walk the same way `queue/derive.ts`'s `NOT_A_FIXTURE_NOTE` already excludes it from instrument enumeration. */
const EXCLUDE_PATHS = ['README.md'];

/** See this file's module doc for why `2026-09-14`. */
export const FIXTURE_ORACLE_ASOF = '2026-09-14';

export interface FixtureOracleResult {
  readonly gap: GapViewModel;
  readonly plan: Awaited<ReturnType<typeof buildStudyPlan>>;
  readonly trace: PipelineTrace;
  readonly asOf: string;
  readonly conceptCount: number;
  readonly instrumentCount: number;
}

/**
 * Builds one fixture-vault oracle result: real ranking, real gap view, real
 * plan, all over `vault` — extended by `withGapClassExtension`
 * (`./fixture-oracle-vault.js`, `ol-m3ty`) so all three of `classifyGap`'s
 * gap classes are genuinely reachable, not just `coverage-gap`. Cheap enough
 * to call once per walkthrough render — no caching here, matching
 * `oracle-scenarios.ts`'s own discipline for its (much smaller) synthetic
 * world.
 */
export async function buildFixtureOracle(vault: VaultSource): Promise<FixtureOracleResult> {
  const stages: StageRecord[] = [];
  const extendedVault = withGapClassExtension(vault);

  const composeStage = await recordStageAsync(
    'compose',
    async () => {
      const [{ records }, concepts] = await Promise.all([
        enumerateVaultInstruments(extendedVault, { excludePaths: EXCLUDE_PATHS }),
        extractConcepts(extendedVault, { includeTier3: true }),
      ]);
      const ranking = await composeOracleRanking({
        vault: extendedVault,
        basePath: BASE_PATH,
        reviewLog: FIXTURE_ORACLE_HISTORY,
        asOf: FIXTURE_ORACLE_ASOF,
        concepts,
      });
      return { records, ranking, concepts };
    },
    ({ records, ranking, concepts }) => ({
      status: ranking.ranking.courses.length === 0 ? 'empty' : 'ok',
      inputSummary: { instruments: records.length, concepts: concepts.length },
      outputSummary: {
        edges: ranking.edges.edges.length,
        ranked: ranking.ranking.courses.filter((c) => c.status === 'ranked').length,
        abstained: ranking.ranking.courses.filter((c) => c.status === 'abstained').length,
      },
    }),
  );
  stages.push(composeStage.record);
  const { records, ranking, concepts } = composeStage.result;

  const instrumentCountsByNotePath = new Map<string, number>();
  for (const record of records) {
    instrumentCountsByNotePath.set(
      record.notePath,
      (instrumentCountsByNotePath.get(record.notePath) ?? 0) + 1,
    );
  }
  const materialPresence = buildMaterialPresence(concepts, instrumentCountsByNotePath);

  const gapStage = recordStage(
    'gap',
    () =>
      buildGapView({
        ranking: ranking.ranking,
        assessments: ranking.edges.assessmentsRead.records,
        materialPresence,
        sourceCoverage: ranking.edges.tier3.sourceCoverage,
      }),
    (gap) => {
      const rows = gap.courses.flatMap((c) => (c.status === 'ranked' ? c.rows : []));
      return {
        status: gap.courses.length === 0 ? 'empty' : rows.length === 0 ? 'abstained' : 'ok',
        inputSummary: { materialConcepts: materialPresence.size },
        outputSummary: {
          rows: rows.length,
          canStateExhaustiveness: gap.scope.canStateExhaustiveness,
        },
      };
    },
  );
  stages.push(gapStage.record);

  const planStage = await recordStageAsync(
    'plan',
    () =>
      buildStudyPlan({
        ranking: ranking.ranking,
        computedAt: `${FIXTURE_ORACLE_ASOF}T09:00:00.000Z`,
      }),
    (plan) => ({
      status: plan.body.courses.length === 0 ? 'empty' : 'ok',
      inputSummary: { rankedCourses: ranking.ranking.courses.length },
      outputSummary: { planVersion: plan.policyVersion, courses: plan.body.courses.length },
    }),
  );
  stages.push(planStage.record);

  return {
    gap: gapStage.result,
    plan: planStage.result,
    trace: { stages },
    asOf: FIXTURE_ORACLE_ASOF,
    conceptCount: concepts.length,
    instrumentCount: records.length,
  };
}
