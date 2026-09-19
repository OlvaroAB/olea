/**
 * `createLocalStudyPlanProvider` tests (P5-T07).
 *
 * Every fixture string here is INVENTED — course codes, concept names,
 * question text — per INV-3; nothing below is drawn from a real vault. The
 * vault fixture is the plugin-side twin of `oracle/compose.spec.ts`'s: one
 * course, one cited concept, so this suite is testing the WIRING (settings →
 * vault walk → review-log read → `composeOracleRanking` → `buildStudyPlan`),
 * not re-testing `composeOracleRanking`'s own acceptance criteria a second
 * time.
 */
import { studyPlanEnvelope } from 'olea-contracts';
import type { Scheduler } from 'olea-core';
import {
  createFsrsScheduler,
  type RetrievabilityInput,
  type RetrievabilityOutput,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createLocalStudyPlanProvider } from '../../src/plan/provider.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

/**
 * A `Scheduler` whose `retrievability` always answers the same fixed
 * probability, regardless of the instrument or state it is asked about.
 * `schedule` delegates to a real FSRS scheduler unchanged — the vitality
 * fold this suite is exercising (`readAllConceptVitality`) replays the
 * review log through `schedule` first to rebuild each instrument's
 * `SchedulerState` before ever calling `retrievability`, so only the one
 * method under test is faked.
 */
function fixedRetrievabilityScheduler(recallProbability: number): Scheduler {
  const real = createFsrsScheduler();
  return {
    schedule: (input) => real.schedule(input),
    retrievability(input: RetrievabilityInput): RetrievabilityOutput {
      return { instrumentId: input.instrumentId, recallProbability };
    },
  };
}

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function hostWithBasePath(basePath: string): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: basePath },
  };
  return host;
}

function studyVault() {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '03 Research/TESTC101 Past Paper 2023.md': [
      '---',
      'role: past-paper',
      'course: TESTC101',
      '---',
      '',
      '# TESTC101 Past Paper — 2023',
      '',
      '## Question 1 (10 marks)',
      '',
      'Explain the core mechanism behind Widget theory and why it matters.',
      '',
    ].join('\n'),
    [BASE_PATH]: [
      'filters:',
      '  and:',
      '    - file.inFolder("02 Assignments")',
      '    - file.ext == "md"',
      'properties:',
      '  class:',
      '  type:',
      '  weight:',
      '  due:',
      '  status:',
    ].join('\n'),
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
  });
}

describe('createLocalStudyPlanProvider — not configured', () => {
  it('throws rather than returning a fabricated or empty plan when no Base path is set', async () => {
    const provider = createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });
    await expect(provider.fetchPlan()).rejects.toThrow(/assignments Base path/);
  });
});

describe('createLocalStudyPlanProvider — delivered ranking weights ([D-110], ol-v7r5.3)', () => {
  it('no readRankWeights dep at all — composes normally on the declared fallback (F7.8, no error surfaced)', async () => {
    const provider = createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });
    const raw = await provider.fetchPlan();
    const plan = studyPlanEnvelope.parse(raw);
    const course = plan.body.courses.find((c) => c.course === 'TESTC101');
    expect(course?.status).toBe('ranked');
  });

  it('readRankWeights resolving undefined (offline/unconfigured/expired) — same declared-fallback plan, no throw', async () => {
    const baseline = await createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    }).fetchPlan();

    const degraded = await createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
      readRankWeights: async () => undefined,
    }).fetchPlan();

    const baselinePlan = studyPlanEnvelope.parse(baseline);
    const degradedPlan = studyPlanEnvelope.parse(degraded);
    const baselineCourse = baselinePlan.body.courses.find((c) => c.course === 'TESTC101');
    const degradedCourse = degradedPlan.body.courses.find((c) => c.course === 'TESTC101');
    if (baselineCourse?.status !== 'ranked' || degradedCourse?.status !== 'ranked') {
      throw new Error('expected TESTC101 to rank in both plans');
    }
    expect(degradedCourse.concepts[0]?.weight).toBe(baselineCourse.concepts[0]?.weight);
  });

  it('a delivered rank-weights artifact is actually threaded into composeOracleRanking, not silently ignored', async () => {
    let calls = 0;
    const baseline = await createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    }).fetchPlan();

    const delivered = await createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
      readRankWeights: async () => {
        calls++;
        // Sharply different from rank.ts's DECLARED_FALLBACK_MASTERY_NEED_WEIGHT
        // (seed: 1, sprout: 0.7, sapling: 0.35, tree: 0.15, unknown: 1) — if this
        // is threaded through, the concept's `weight` (priorityScore) changes.
        return {
          proximityHalfLifeDays: 14,
          assessmentWeightDivisor: 100,
          masteryNeedWeight: { seed: 5, sprout: 5, sapling: 5, tree: 5, unknown: 5 },
        };
      },
    }).fetchPlan();

    expect(calls).toBe(1);
    const baselinePlan = studyPlanEnvelope.parse(baseline);
    const deliveredPlan = studyPlanEnvelope.parse(delivered);
    const baselineCourse = baselinePlan.body.courses.find((c) => c.course === 'TESTC101');
    const deliveredCourse = deliveredPlan.body.courses.find((c) => c.course === 'TESTC101');
    if (baselineCourse?.status !== 'ranked' || deliveredCourse?.status !== 'ranked') {
      throw new Error('expected TESTC101 to rank in both plans');
    }
    expect(deliveredCourse.concepts[0]?.weight).not.toBe(baselineCourse.concepts[0]?.weight);
  });
});

describe('createLocalStudyPlanProvider — allocation policy ([D-167], ol-v7r5.25)', () => {
  it('no readPlanPolicy dep at all — plan is byte-identical to today (no allocation field)', async () => {
    const raw = await createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    }).fetchPlan();

    const plan = studyPlanEnvelope.parse(raw);
    expect(Object.hasOwn(plan.body, 'allocation')).toBe(false);
  });

  it('readPlanPolicy resolving undefined (offline/unconfigured/failed) — same absent-allocation plan, no throw', async () => {
    const raw = await createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
      readPlanPolicy: async () => undefined,
    }).fetchPlan();

    const plan = studyPlanEnvelope.parse(raw);
    expect(Object.hasOwn(plan.body, 'allocation')).toBe(false);
  });

  it('a delivered allocation policy is threaded onto body.allocation, with the resolved per-course inputs it was asked for', async () => {
    let requestedCourses: readonly { readonly courseId: string }[] = [];
    const raw = await createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
      readPlanPolicy: async (request) => {
        requestedCourses = request.courses;
        return {
          asOf: request.asOf,
          rankWeights: {
            proximityHalfLifeDays: 14,
            assessmentWeightDivisor: 40,
            masteryNeedWeight: { seed: 1, sprout: 1, sapling: 1, tree: 1, unknown: 1 },
          },
          allocation: [
            {
              courseId: 'TESTC101',
              share: 1,
              minBlockSeconds: 180,
              contributions: [{ name: 'risk', value: 1 }],
              reason: 'the only running course receives the whole session.',
            },
          ],
          floorsFundable: true,
        };
      },
    }).fetchPlan();

    const plan = studyPlanEnvelope.parse(raw);
    expect(plan.body.allocation).toEqual([
      {
        courseId: 'TESTC101',
        share: 1,
        minBlockSeconds: 180,
        contributions: [{ name: 'risk', value: 1 }],
        reason: 'the only running course receives the whole session.',
      },
    ]);
    expect(requestedCourses.map((c) => c.courseId)).toEqual(['TESTC101']);
  });
});

describe('createLocalStudyPlanProvider — configured', () => {
  it('composes a valid StudyPlanArtifact entirely on-device, reflecting her real review log', async () => {
    const vault = studyVault();
    // A device-named log the plugin's own probe finds — same file naming
    // `reviewLogPath` produces, same folder `readReviewLogHistory` reads.
    await vault.write(
      '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
      `${JSON.stringify({
        schemaVersion: 5,
        kind: 'review',
        eventId: 'r1',
        timestamp: '2026-08-09T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:1',
        instrumentType: 'qa',
        conceptIds: ['Widget theory'],
        rating: 'again',
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      })}\n`,
    );

    const provider = createLocalStudyPlanProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const raw = await provider.fetchPlan();
    const plan = studyPlanEnvelope.parse(raw);

    expect(plan.body.asOf).toBe('2026-08-10');
    expect(plan.computedAt).toBe(new Date('2026-08-10T09:00:00-04:00').toISOString());
    const course = plan.body.courses.find((c) => c.course === 'TESTC101');
    expect(course?.status).toBe('ranked');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    expect(course.concepts.map((c) => c.conceptId)).toEqual(['Widget theory']);
  });

  it('a fresh install with no review log yet still composes a plan — every concept reads new, not unknown', async () => {
    const vault = studyVault();
    const provider = createLocalStudyPlanProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const raw = await provider.fetchPlan();
    const plan = studyPlanEnvelope.parse(raw);
    const course = plan.body.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    // No log at all — a fresh install's honest state — still produces a
    // usable, schema-valid plan rather than throwing or abstaining.
    expect(course.concepts).toHaveLength(1);
  });
});

describe('createLocalStudyPlanProvider — retrievability reaches the ranking (C5.6/[D-264], ol-v7r5.53)', () => {
  const NOW = () => new Date('2026-08-10T09:00:00-04:00');

  async function vaultWithOneReview() {
    const vault = studyVault();
    // Same fixture shape as the "configured" suite's real-review-log test
    // above, factored out here so each test gets its own isolated vault.
    await vault.write(
      '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
      `${JSON.stringify({
        schemaVersion: 5,
        kind: 'review',
        eventId: 'r1',
        timestamp: '2026-08-09T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:1',
        instrumentType: 'qa',
        conceptIds: ['Widget theory'],
        rating: 'good',
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      })}\n`,
    );
    return vault;
  }

  function weightOf(raw: unknown): number {
    const plan = studyPlanEnvelope.parse(raw);
    const course = plan.body.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const weight = course.concepts[0]?.weight;
    if (weight === undefined) throw new Error('expected a weight on the ranked concept');
    return weight;
  }

  it('an injected Scheduler is actually consulted — a lower recall probability scales the concept weight down by exactly that factor', async () => {
    const neutral = await createLocalStudyPlanProvider({
      vault: await vaultWithOneReview(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler: fixedRetrievabilityScheduler(1),
    }).fetchPlan();

    const halved = await createLocalStudyPlanProvider({
      vault: await vaultWithOneReview(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler: fixedRetrievabilityScheduler(0.5),
    }).fetchPlan();

    const neutralWeight = weightOf(neutral);
    const halvedWeight = weightOf(halved);
    expect(neutralWeight).toBeGreaterThan(0);
    expect(halvedWeight).toBeCloseTo(neutralWeight * 0.5, 10);
  });

  it('a concept with no review history at all stays neutral even when the injected Scheduler would answer something else — absence, never a manufactured reading, reaches the ranking', async () => {
    const withNoHistory = await createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler: fixedRetrievabilityScheduler(0.5),
    }).fetchPlan();

    const baseline = await createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler: fixedRetrievabilityScheduler(1),
    }).fetchPlan();

    // Never-practised: `readAllConceptVitality` reads `weakest: null`, so
    // `oracle/compose.ts`'s `resolveRetrievabilityScores` leaves this
    // concept OUT of the retrievability map entirely, `resolveRetrievabilityWeight`
    // (`oracle/rank.ts`) reads it as `undefined`, and `rankOracle`'s own
    // blend falls back to neutral (1) — identical to the fixed-`1`
    // scheduler's result, NOT the `0.5` a Scheduler actually consulted for
    // this concept would have produced.
    expect(weightOf(withNoHistory)).toBe(weightOf(baseline));
  });

  it('with no scheduler override at all, production now defaults to a real FSRS Scheduler — retrievability is no longer always neutral', async () => {
    const withHistory = await createLocalStudyPlanProvider({
      vault: await vaultWithOneReview(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
    }).fetchPlan();

    const neutralControl = await createLocalStudyPlanProvider({
      vault: await vaultWithOneReview(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler: fixedRetrievabilityScheduler(1),
    }).fetchPlan();

    // A real FSRS read one day after a single 'good' rating is not exactly
    // 1 (some decay has already happened), so the default (no override)
    // path must differ from the neutral control — proof this call site now
    // builds and consults a real `Scheduler` by default rather than
    // silently staying at the pre-`ol-v7r5.53` always-omitted behaviour.
    expect(weightOf(withHistory)).not.toBe(weightOf(neutralControl));
  });
});
