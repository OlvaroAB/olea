/**
 * The oracle driver — world plus the workbench's fixed instant, through the
 * whole `mastery → rank → plan → gap` chain, plus a queue composed and
 * executed against the plan it just built (`ol-opmb.1` [TB-1]'s most
 * load-bearing file).
 *
 * ## Closing the loop
 *
 * Every function this file calls is pure and already exists
 * (`computeAllConceptMastery`, `rankOracle`, `buildStudyPlan`, `buildGapView`,
 * `composeQueue`, `executeStudyPlan` — `../oracle-bridge.js`). What did not
 * exist before this file is a caller that runs all of them **in order, over
 * one world, with the queue at the end fed the plan the earlier stages just
 * produced** — which is the first time in this codebase
 * `selectionContext.planVersion` is set to anything but `null` from a
 * genuinely computed plan (C7.6). See `deriveClosedLoop`.
 *
 * ## Trap 1 — self-consistency
 *
 * Nothing here reads a fixture-vault string. Mastery is computed straight off
 * `world.stream.entries` (`SyntheticStream.entries`, whose `conceptIds` are
 * `olea-synthetic`'s own `syn:concept:…` ids), the ranking's evidence is
 * `world.curriculum` (same ids), the gap view's material is `world.corpus`
 * (same ids again), and — the one piece nothing before this bead needed —
 * `deriveClosedLoop`'s queue candidates are built directly from
 * `./vocabulary.js`'s `INSTRUMENTS`, never from the fixture vault's own
 * instrument records. The whole chain agrees on concept identity because it
 * was never asked to agree across two vocabularies in the first place.
 *
 * ## Trap 2 — the loop must not flatter itself
 *
 * `strugglingCourseReadsWorse` (below) is the defence: it reads
 * `world.stream.groundTruth` — claims the generator declares independently of
 * anything this driver computes — and checks they are still visible in the
 * derived mastery. Called from `oracle/derive.spec.ts`, not from the driver
 * itself (an assertion is a test's job, not a pipeline stage's).
 */

import type { StudyPlanEnvelope } from 'olea-contracts';
import type { Scheduler, SchedulerState } from 'olea-core';
import { createFsrsScheduler } from 'olea-core';
import {
  buildGapView,
  buildStudyPlan,
  type ComposedQueue,
  type ConceptMasteryResult,
  composeQueue,
  computeAllConceptMastery,
  type ExecutedQueue,
  executeStudyPlan,
  type GapViewModel,
  type QueueCandidate,
  type RankOracleResult,
  rankOracle,
} from '../oracle-bridge.js';
import { sessionInstant } from '../queue/derive.js';
import type { SyntheticWorld } from '../synthetic-bridge.js';
import { CONCEPTS, courseOfConcept, INSTRUMENTS } from '../synthetic-bridge.js';
import { type PipelineTrace, recordStage, recordStageAsync, type StageRecord } from './trace.js';

export interface OracleDeriveInput {
  readonly world: SyntheticWorld;
  /** `YYYY-MM-DD` — the day exam proximity and the plan are measured from. */
  readonly asOf: string;
  /** ISO-8601 with offset — when the plan was computed. */
  readonly computedAt: string;
  /**
   * Overrides the composed-queue instant (`../queue/derive.js`'s
   * `sessionInstant`), ISO-8601 with offset. Undefined (the default) keeps
   * `deriveClosedLoop`'s original behaviour: `sessionInstant(candidates)`,
   * i.e. `WORKBENCH_NOW` or the persona's latest FSRS due date, whichever is
   * later — right for a single fixed-instant surface (`oracle-scenarios.ts`,
   * unaffected by this field) but wrong for a REPLAYED earlier day
   * (`oracle/timeline.ts`, [TB-4] `ol-opmb.5`): composing every day's queue at
   * one fixed far-future "now" would make every earlier day look uniformly
   * overdue, which is not what that day's queue actually offered. The
   * timeline driver sets this to the day being replayed instead.
   */
  readonly queueNow?: string;
}

export interface OracleDeriveResult {
  readonly mastery: ReadonlyMap<string, ConceptMasteryResult>;
  readonly ranking: RankOracleResult;
  readonly plan: StudyPlanEnvelope;
  readonly gap: GapViewModel;
  readonly queue: {
    readonly composed: ComposedQueue;
    readonly executed: ExecutedQueue;
  };
  readonly trace: PipelineTrace;
}

/**
 * Every concept id the world's vocabulary declares — ALL of it, not only the
 * ones `curriculum.ts`'s edges cite.
 *
 * `rankOracle` only ever reads a mastery entry for a concept it ranks (a
 * cited one), so computing mastery for the rest is harmless — but it is not
 * unused: `strugglingCourseReadsWorse` (Trap 2's defence) compares a
 * struggling course's mastery against another course's, and `COURSE_QUORBIN`
 * has zero cited concepts (it abstains — see `curriculum.ts`'s module doc).
 * Restricting this to cited concepts silently starves that comparison of an
 * "other course" to compare against, so it returns `true` on the
 * nothing-to-compare branch regardless of whether mastery actually reads
 * worse — a vacuous pass, not a real one. Found by N-013 mutation testing
 * (flipping `strugglingCourseReadsWorse`'s comparison operator did not turn
 * the test red until this was fixed — see the task report for the exact
 * mutation).
 */
function allWorldConceptIds(): readonly string[] {
  return CONCEPTS.map((concept) => concept.conceptId)
    .slice()
    .sort();
}

/**
 * Replays `world.stream.entries` through a fresh FSRS scheduler and builds
 * one `QueueCandidate` per synthetic instrument — the self-consistent
 * alternative to walking the fixture vault (see this file's module doc, Trap
 * 1). Mirrors `persona/history.ts`'s `replay()`: nothing is taken on trust
 * from the generator's internals, the state is re-derived from the emitted
 * bytes.
 */
function buildWorldCandidates(world: SyntheticWorld): readonly QueueCandidate[] {
  const scheduler: Scheduler = createFsrsScheduler();
  const states = new Map<string, SchedulerState>();

  for (const entry of world.stream.entries) {
    if (entry.kind !== 'review') continue;
    if (entry.instrumentType === 'explain-back' || entry.rating === null) continue;
    const output = scheduler.schedule({
      instrumentId: entry.instrumentId,
      state: states.get(entry.instrumentId) ?? null,
      rating: entry.rating,
      now: new Date(Date.parse(entry.timestamp)),
    });
    states.set(entry.instrumentId, output.state);
  }

  return INSTRUMENTS.map((instrument) => {
    const course = courseOfConcept(instrument.conceptId);
    return {
      instrumentId: instrument.instrumentId,
      instrumentType: instrument.instrumentType,
      conceptIds: [instrument.conceptId],
      courses: course === undefined ? [] : [course],
      state: states.get(instrument.instrumentId) ?? null,
    };
  });
}

/** Concept ids belonging to a course `rankOracle` abstained for — the one input `deriveClosedLoop` needs to attribute a queue shortfall to `rank` rather than to itself. */
function conceptsInAbstainedCourses(ranking: RankOracleResult): ReadonlySet<string> {
  const abstainedCourses = new Set(
    ranking.courses.filter((c) => c.status === 'abstained').map((c) => c.course),
  );
  const concepts = new Set<string>();
  for (const concept of CONCEPTS) {
    if (abstainedCourses.has(concept.courseId)) concepts.add(concept.conceptId);
  }
  return concepts;
}

/**
 * Trap 2's defence (see the module doc): the generator's own
 * `DeclaredGroundTruth.strugglingCourseIds` is a claim about the fiction,
 * stated independently of anything this driver computes. If mastery derived
 * from the SAME stream does not read worse for a struggling course's concepts
 * than a comfortably-passing one, the loop has flattened — a degenerate
 * pipeline that stopped distinguishing its own inputs would still "run" and
 * still "look done," which is exactly the failure mode this checks for.
 * Called from `oracle/derive.spec.ts`, not from production code — an
 * assertion is a test's job.
 */
export function strugglingCourseReadsWorse(
  world: SyntheticWorld,
  mastery: ReadonlyMap<string, ConceptMasteryResult>,
): boolean {
  const strugglingCourses = new Set(world.stream.groundTruth.strugglingCourseIds);
  if (strugglingCourses.size === 0) return true; // nothing declared to check
  const ADVANCED: ReadonlySet<string> = new Set(['sapling', 'tree']);

  let strugglingAdvanced = 0;
  let strugglingTotal = 0;
  let otherAdvanced = 0;
  let otherTotal = 0;
  for (const concept of CONCEPTS) {
    const result = mastery.get(concept.conceptId);
    if (result === undefined) continue;
    const advanced = ADVANCED.has(result.state) ? 1 : 0;
    if (strugglingCourses.has(concept.courseId)) {
      strugglingTotal += 1;
      strugglingAdvanced += advanced;
    } else {
      otherTotal += 1;
      otherAdvanced += advanced;
    }
  }
  if (strugglingTotal === 0 || otherTotal === 0) return true; // nothing to compare
  return strugglingAdvanced / strugglingTotal < otherAdvanced / otherTotal;
}

/**
 * `mastery → rank → plan → gap`, one call each, over `world`. Does not
 * compose a queue — see `deriveClosedLoop` for the surface that also closes
 * the loop back into `selectionContext.planVersion`.
 */
export async function deriveOracle(input: OracleDeriveInput): Promise<{
  readonly result: Omit<OracleDeriveResult, 'queue' | 'trace'>;
  readonly stages: StageRecord[];
}> {
  const { world, asOf, computedAt } = input;
  const stages: StageRecord[] = [];

  const conceptIds = allWorldConceptIds();
  const masteryStage = recordStage(
    'mastery',
    () => computeAllConceptMastery(world.stream.entries, conceptIds),
    (mastery) => ({
      status: world.stream.entries.length === 0 ? 'empty' : 'ok',
      inputSummary: { entries: world.stream.entries.length, concepts: conceptIds.length },
      outputSummary: { conceptsWithMastery: mastery.size },
    }),
  );
  stages.push(masteryStage.record);
  const mastery = masteryStage.result;

  const rankStage = recordStage(
    'rank',
    () =>
      rankOracle({
        evidence: {
          edges: world.curriculum.edges,
          assessmentsRead: world.curriculum.assessmentsRead,
          assessmentsWithNoEvidence: world.curriculum.assessmentsWithNoEvidence,
        },
        mastery,
        asOf,
      }),
    (ranking) => {
      const ranked = ranking.courses.filter((c) => c.status === 'ranked').length;
      const abstained = ranking.courses.filter((c) => c.status === 'abstained').length;
      return {
        status: ranking.courses.length === 0 ? 'empty' : ranked === 0 ? 'abstained' : 'ok',
        inputSummary: { edges: world.curriculum.edges.length, courses: ranking.courses.length },
        outputSummary: { ranked, abstained },
      };
    },
  );
  stages.push(rankStage.record);
  const ranking = rankStage.result;

  const planStage = await recordStageAsync(
    'plan',
    () => buildStudyPlan({ ranking, computedAt }),
    (plan) => ({
      status: plan.body.courses.length === 0 ? 'empty' : 'ok',
      inputSummary: { rankedCourses: ranking.courses.length },
      outputSummary: { planVersion: plan.policyVersion, courses: plan.body.courses.length },
    }),
  );
  stages.push(planStage.record);
  const plan = planStage.result;

  const gapStage = recordStage(
    'gap',
    () =>
      buildGapView({
        ranking,
        assessments: world.curriculum.assessments,
        mastery,
        materialPresence: world.corpus.materialPresence,
        sourceCoverage: world.corpus.sourceCoverage,
      }),
    (gap) => {
      const rows = gap.courses.flatMap((c) => (c.status === 'ranked' ? c.rows : []));
      return {
        status: gap.courses.length === 0 ? 'empty' : rows.length === 0 ? 'abstained' : 'ok',
        inputSummary: { materialConcepts: world.corpus.materialPresence.size },
        outputSummary: {
          rows: rows.length,
          canStateExhaustiveness: gap.scope.canStateExhaustiveness,
        },
      };
    },
  );
  stages.push(gapStage.record);
  const gap = gapStage.result;

  return { result: { mastery, ranking, plan, gap }, stages };
}

/**
 * `deriveOracle`, plus a queue composed purely from the world's own
 * instruments and executed against the plan `deriveOracle` just built — the
 * "review event now carries a real `planVersion`" demonstration. See the
 * module doc.
 */
export async function deriveClosedLoop(input: OracleDeriveInput): Promise<OracleDeriveResult> {
  const { result, stages } = await deriveOracle(input);
  const { world, queueNow } = input;

  const candidates = buildWorldCandidates(world);
  // `sessionInstant` — the workbench's own composed-queue instant, borrowed
  // from `../queue/derive.js` rather than a fixed `asOf`. A ninety-day
  // stream's own scheduling pushes most instruments' due dates past `asOf`;
  // composing there the way the fixture-vault queue already does is what
  // makes this offer anything, exactly as `queue/derive.ts`'s own module doc
  // explains for the identical reason. `queueNow` (see `OracleDeriveInput`)
  // overrides this for a replayed day.
  const composeStage = recordStage(
    'queue',
    () => {
      const composed = composeQueue({
        candidates,
        now: queueNow === undefined ? sessionInstant(candidates) : new Date(queueNow),
        formatPreference: [],
      });
      const executed = executeStudyPlan({ queue: composed, plan: result.plan });
      return { composed, executed };
    },
    ({ composed, executed }) => {
      const structurallyUnrankable = conceptsInAbstainedCourses(result.ranking);
      const blocked = executed.items.filter(
        (item) =>
          item.planWeight === null && item.conceptIds.some((id) => structurallyUnrankable.has(id)),
      );
      return {
        status: composed.items.length === 0 ? 'empty' : 'ok',
        inputSummary: { candidates: candidates.length },
        outputSummary: {
          offered: composed.items.length,
          planVersion: executed.planVersion,
          rankedByPlan: executed.items.filter((item) => item.planWeight !== null).length,
        },
        couldHaveSucceeded: blocked.length === 0,
        attributedTo: blocked.length === 0 ? null : 'rank',
      };
    },
  );
  stages.push(composeStage.record);

  return {
    ...result,
    queue: composeStage.result,
    trace: { stages },
  };
}
