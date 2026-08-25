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
 * ## What is still borrowed rather than real: the review history
 *
 * The fixture vault has no review log of its own — nothing has ever "studied"
 * it. `mastery` needs one, so this module builds one the same way
 * `persona/history.ts`'s `entriesFor` already does for the review/today
 * surfaces: a positional ring-join from a synthetic persona's stream onto the
 * vault's REAL instruments. The one difference from `entriesFor`, and the
 * reason this is not just a call to it: `entriesFor` deliberately keeps
 * `conceptIds` at the persona's own `syn:concept:…` values (Trap 1's
 * self-consistency argument, `oracle/derive.ts`'s module doc) because its
 * consumer is the SYNTHETIC oracle surface. This module's consumer is the
 * fixture-vault oracle, where self-consistency instead means every id —
 * instrument AND concept — is the real vault's own, so `realReviewLog` below
 * overrides `conceptIds` too. `persona/history.ts` is not edited to do this:
 * its own module doc calls "no fixture-vault string" a rule the file is
 * "built around", and this module honours that by staying a separate file
 * rather than asking it to break its own rule for one caller.
 *
 * `asOf` is `2026-09-14` — the Monday of the fixture vault's "week six"
 * (the daily note at `00 Daily notes/2026-08-10.md` is week one's Monday) —
 * chosen so her real assignments' `due` dates are still ahead of it
 * (`computeExamProximity` in `olea-core`'s `oracle/rank.ts` scores a PAST due
 * date 0, which would flatten every ranking to zero and defeat the whole
 * point of showing scores). The borrowed review history is generated to end
 * the day before that `asOf`, for the same reason `persona/history.ts`
 * anchors its own stream to end the day before `WORKBENCH_NOW`.
 *
 * ## The illustrative label, not repeated here
 *
 * This module computes numbers; it does not decide how they are captioned.
 * `main.ts` renders D-041's illustrative label inside the host pane next to
 * whatever this module returns — see that file for the exact wording and
 * placement rule.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  buildMaterialPresence,
  composeOracleRanking,
  enumerateVaultInstruments,
  extractConcepts,
  type VaultSource,
} from 'olea-core';
import { buildGapView, buildStudyPlan, type GapViewModel } from '../oracle-bridge.js';
import { generateStream, INSTRUMENTS, streamSpec } from '../synthetic-bridge.js';
import { type PipelineTrace, recordStage, recordStageAsync, type StageRecord } from './trace.js';

/** The Bases assignments table `readAssessments` scans — real, checked-in fixture content. */
const BASE_PATH = '02 Assignments/Assignments.base';
/** Not a note of hers — excluded from every walk the same way `queue/derive.ts`'s `NOT_A_FIXTURE_NOTE` already excludes it from instrument enumeration. */
const EXCLUDE_PATHS = ['README.md'];

/** See this file's module doc for why `2026-09-14`. */
export const FIXTURE_ORACLE_ASOF = '2026-09-14';

const BORROWED_HISTORY_SEED = 'workbench-walkthrough';
const BORROWED_HISTORY_START_DATE = '2026-06-01';
/** Ends 2026-09-13 — the day before `FIXTURE_ORACLE_ASOF`. */
const BORROWED_HISTORY_DAYS = 105;

/**
 * The positional ring-join, extended one field past `persona/history.ts`'s
 * `entriesFor` — see the module doc's "still borrowed" section for why.
 */
function realReviewLog(
  instruments: readonly {
    instrumentId: string;
    instrumentType: string;
    conceptIds: readonly string[];
  }[],
  streamEntries: readonly ReviewLogEntry[],
): readonly ReviewLogEntry[] {
  const ringsByType = new Map<string, string[]>();
  for (const instrument of INSTRUMENTS) {
    const ring = ringsByType.get(instrument.instrumentType);
    if (ring) ring.push(instrument.instrumentId);
    else ringsByType.set(instrument.instrumentType, [instrument.instrumentId]);
  }

  const byPersonaInstrument = new Map<string, ReviewLogEntry[]>();
  for (const entry of streamEntries) {
    const bucket = byPersonaInstrument.get(entry.instrumentId);
    if (bucket) bucket.push(entry);
    else byPersonaInstrument.set(entry.instrumentId, [entry]);
  }

  const seenPerType = new Map<string, number>();
  const relabelled: ReviewLogEntry[] = [];
  for (const instrument of instruments) {
    const index = seenPerType.get(instrument.instrumentType) ?? 0;
    seenPerType.set(instrument.instrumentType, index + 1);

    const ring = ringsByType.get(instrument.instrumentType);
    const personaInstrumentId = ring === undefined ? undefined : ring[index % ring.length];
    if (personaInstrumentId === undefined) continue;

    for (const entry of byPersonaInstrument.get(personaInstrumentId) ?? []) {
      relabelled.push({
        ...entry,
        instrumentId: instrument.instrumentId,
        conceptIds: [...instrument.conceptIds],
        eventId: `${entry.eventId}#${String(index)}`,
      });
    }
  }
  return relabelled;
}

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
 * plan, all over `vault`. Cheap enough to call once per walkthrough render —
 * no caching here, matching `oracle-scenarios.ts`'s own discipline for its
 * (much smaller) synthetic world.
 */
export async function buildFixtureOracle(vault: VaultSource): Promise<FixtureOracleResult> {
  const stages: StageRecord[] = [];

  const composeStage = await recordStageAsync(
    'compose',
    async () => {
      const [{ records }, ranking] = await Promise.all([
        enumerateVaultInstruments(vault, { excludePaths: EXCLUDE_PATHS }),
        (async () => {
          const stream = generateStream(
            streamSpec('steady-reviewer', BORROWED_HISTORY_SEED, {
              startDate: BORROWED_HISTORY_START_DATE,
              days: BORROWED_HISTORY_DAYS,
              utcOffset: '+00:00',
            }),
          );
          // The instrument walk below is redone here rather than shared,
          // because the ring-join needs the same `records` the outer walk
          // just produced and Promise.all cannot see across its own branches.
          // enumerateVaultInstruments is a pure read over an in-memory vault,
          // so the second walk costs time, never correctness — see the
          // "self-consistency" argument in the module doc for why this is
          // not the one to cache away.
          const [{ records: instrumentRecords }, innerConcepts] = await Promise.all([
            enumerateVaultInstruments(vault, { excludePaths: EXCLUDE_PATHS }),
            extractConcepts(vault, { includeTier3: true }),
          ]);
          const reviewLog = realReviewLog(instrumentRecords, stream.entries);
          return composeOracleRanking({
            vault,
            basePath: BASE_PATH,
            reviewLog,
            asOf: FIXTURE_ORACLE_ASOF,
            // The name→opaque-key source for `ConceptAssessmentEdge.conceptKey`
            // (`ol-63e1`). Re-extracted here (rather than sharing the outer
            // `concepts` fetched below) for the same self-consistency reason
            // this branch already re-walks `enumerateVaultInstruments` — see
            // the module doc.
            concepts: innerConcepts,
          });
        })(),
      ]);
      const concepts = await extractConcepts(vault, { includeTier3: true });
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
      status: plan.courses.length === 0 ? 'empty' : 'ok',
      inputSummary: { rankedCourses: ranking.ranking.courses.length },
      outputSummary: { planVersion: plan.planVersion, courses: plan.courses.length },
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
