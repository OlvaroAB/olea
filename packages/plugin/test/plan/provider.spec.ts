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
  addManualAssessmentEntry,
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

  /**
   * `ol-egov.141.8.10`: the regression this test used to pin as REGRESSION-PENDING. Both the
   * core-side read (`evidence-edge/build.ts` → `resolveAssessments`) and this provider's own gate
   * (above, now reading `resolveAssessments`'s report instead of the raw configured-path boolean)
   * were switched together — a manual-only setup (no Base configured) now composes a real plan,
   * ranking off the one manual entry, the same as `paper/provider.ts`/`grove/provider.ts`/
   * `retrospective/provider.ts` already do for their own screens.
   */
  it('a manual entry alone, with no Base configured, lets fetchPlan compose a real plan', async () => {
    const vault = studyVault();
    await addManualAssessmentEntry(vault, {
      course: 'TESTC101',
      type: 'Quiz',
      due: '2026-09-01',
    });
    const provider = createLocalStudyPlanProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });
    const raw = await provider.fetchPlan();
    const plan = studyPlanEnvelope.parse(raw);
    const course = plan.body.courses.find((c) => c.course === 'TESTC101');
    expect(course?.status).toBe('ranked');
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

  it('readPlanPolicy is ABSENT (unconfigured / F7.8 AI off) — same absent-allocation plan, no throw', async () => {
    const raw = await createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
      // No `readPlanPolicy` dep at all — the legitimate "this device never
      // asks" state, distinct from "asked and failed" below.
    }).fetchPlan();

    const plan = studyPlanEnvelope.parse(raw);
    expect(Object.hasOwn(plan.body, 'allocation')).toBe(false);
  });

  describe('ol-egov.141.89.10.16 — a failed allocation fetch must never produce a silent allocation-less plan', () => {
    it('REGRESSION: readPlanPolicy is PRESENT but resolves undefined (an attempted, failed fetch — offline/non-2xx/unparseable/malformed) — fetchPlan throws rather than building a schema-valid plan with no allocation', async () => {
      // This is the exact mechanism ol-egov.141.89.10.16 reports:
      // `fetchPlanPolicy` (plan-policy-provider.ts) collapses every
      // transport/parse/validation failure to `undefined`; before this fix,
      // `provider.ts` read that `undefined` identically to "not configured"
      // and silently built a fully schema-valid `StudyPlanEnvelope` missing
      // only `allocation`. `refresh.ts` (olea-core) reads that as a genuine
      // success (`read.status === 'ok'`) and calls `saveCachedStudyPlan`,
      // overwriting whatever plan — possibly with a real allocation — was
      // cached before, even though `refresh.ts`'s own module doc promises
      // "a bad answer never costs her the plan she already had."
      //
      // The fix: when the allocation fetch is actually ATTEMPTED (there are
      // running courses AND a `readPlanPolicy` dep is configured) and it
      // resolves `undefined`, that is a failure, not a "no policy" design
      // state — so `fetchPlan` now throws. `provider.ts`'s own module doc
      // already documents this convention for the ordinary "not configured
      // yet" and "vault walk failed" cases: "a throw here is caught there
      // and reported through `reason`, never surfaced past it... refresh
      // already has the degradation path built and tested" — so a throw
      // here means `refreshStudyPlan` (olea-core, out of this bead's owns)
      // hands back the CACHED plan unchanged, allocation included, exactly
      // the "cached plan, failing fetch, cached plan unchanged" scenario
      // this bead's acceptance criteria names.
      const provider = createLocalStudyPlanProvider({
        vault: studyVault(),
        deviceId: DEVICE,
        settingsHost: hostWithBasePath(BASE_PATH),
        now: () => new Date('2026-08-10T09:00:00-04:00'),
        // Simulates `fetchPlanPolicy` returning `undefined` after a real
        // attempt: offline, a non-2xx response, an unparseable body, or a
        // body that failed `isPlanPolicyResult`'s shape check — every case
        // `plan-policy-provider.ts`'s own doc lists as collapsing here.
        readPlanPolicy: async () => undefined,
      });

      await expect(provider.fetchPlan()).rejects.toThrow(/allocation policy/i);
    });

    it('a plan.body still has no allocation field when there genuinely are no running courses — courses.length === 0 never attempts the fetch, so it is not a failure and does not throw', async () => {
      let called = false;
      const raw = await createLocalStudyPlanProvider({
        vault: memoryVault({
          '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
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
        }),
        deviceId: DEVICE,
        settingsHost: hostWithBasePath(BASE_PATH),
        now: () => new Date('2026-08-10T09:00:00-04:00'),
        readPlanPolicy: async () => {
          called = true;
          return undefined;
        },
      }).fetchPlan();

      expect(called).toBe(false);
      const plan = studyPlanEnvelope.parse(raw);
      expect(Object.hasOwn(plan.body, 'allocation')).toBe(false);
    });
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
    // `ol-egov.141.89.10.51`: `policy.floorsFundable` (mocked `true` above)
    // is threaded onto `body.floorsFundable` verbatim, the same as
    // `allocation` just above.
    expect(plan.body.floorsFundable).toBe(true);
  });

  it('a delivered floorsFundable: false is threaded onto body.floorsFundable, not dropped as falsy', async () => {
    const raw = await createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
      readPlanPolicy: async (request) => ({
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
        floorsFundable: false,
      }),
    }).fetchPlan();

    const plan = studyPlanEnvelope.parse(raw);
    expect(plan.body.floorsFundable).toBe(false);
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
        // D-264 ruling 1: the ranking's retrievability now reads readiness
        // (mastery/attainment.ts's instrumentsWithIndependentSuccess), which
        // requires a completed review with rating !== 'again' AND
        // supportLevelShown === 'independent'. Without this field the
        // fixture's own 'good' rating no longer suffices — the instrument
        // falls out of the readiness fold and this whole suite's premise
        // (a review history that makes retrievability nonzero) goes false.
        // This pins: only an independent-support success feeds retrievability.
        supportLevelShown: 'independent',
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
