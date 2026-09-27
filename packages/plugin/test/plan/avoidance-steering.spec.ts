/**
 * `createLocalStudyPlanProvider` — D-361's course-avoidance steering wiring
 * (`ol-egov.141.93`, follow-up to `ol-egov.141.64` [INTERV-15] and the
 * decision bead `ol-egov.141.92`).
 *
 * Exercises `provider.ts`'s new read of `ObsidianHomeAvoidanceStore` (the
 * SAME `settingsHost`/`data.json` blob `home/provider.ts` already writes
 * this store through — no new dependency was threaded in) and D-361's own
 * expiry rule (`AVOIDANCE_ANSWER_EXPIRY_DAYS`, `provider.ts`). This suite
 * never re-tests `resolvePlanPolicyCourseInputs`'s own pure `steeringWeight`
 * fold (`resolve-inputs.spec.ts`, `olea-core`, already covers that) — only
 * that this caller reads her stored answer, applies the expiry, and hands
 * the right thing across the boundary.
 *
 * Every fixture string here is INVENTED per INV-3 — same synthetic course
 * code and concept name `provider.spec.ts`/`sittings-since-floor-met.spec.ts`
 * already use.
 */

import { describe, expect, it } from 'vitest';
import { ObsidianHomeAvoidanceStore } from '../../src/home/avoidance.js';
import { createLocalStudyPlanProvider } from '../../src/plan/provider.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
/** `sittings-since-floor-met.spec.ts`'s own `NOW` — reused so the expiry-boundary math in this file's comments stays checkable against a fixed date. */
const NOW = () => new Date('2026-08-10T09:00:00-04:00');

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

/** Identical to `sittings-since-floor-met.spec.ts`'s own `studyVault()` — TESTC101 with real material and one upcoming assessment, so it is "running" and reaches `resolvePlanPolicyCourseInputs`'s output regardless of the avoidance answer under test. */
function studyVault() {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '01 Courses/TESTC101/Lecture notes.md': '---\ntopic: Widget theory\n---\n\n# Lecture notes\n',
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

/**
 * `ol-egov.141.89.10.16`: an attempted-and-actually-called `readPlanPolicy`
 * resolving `undefined` now makes `fetchPlan` throw (see
 * `sittings-since-floor-met.spec.ts` for the full argument) — but the
 * request it was asked with is still captured synchronously before that
 * happens, which is this suite's only concern.
 */
async function fetchAndCaptureCourses(
  host: FakeDataHost,
): Promise<readonly { readonly courseId: string; readonly steeringWeight?: number }[]> {
  let requestedCourses: readonly {
    readonly courseId: string;
    readonly steeringWeight?: number;
  }[] = [];
  await expect(
    createLocalStudyPlanProvider({
      vault: studyVault(),
      deviceId: DEVICE,
      settingsHost: host,
      now: NOW,
      readPlanPolicy: async (request) => {
        requestedCourses = request.courses;
        return undefined;
      },
    }).fetchPlan(),
  ).rejects.toThrow(/allocation policy/i);
  return requestedCourses;
}

describe('createLocalStudyPlanProvider — course-avoidance steering (D-361, ol-egov.141.93)', () => {
  it("a 'leave-for-now' answer applies the ruled 0.25 steering weight to that course", async () => {
    const host = hostWithBasePath(BASE_PATH);
    const avoidanceStore = new ObsidianHomeAvoidanceStore(host);
    await avoidanceStore.markAsked('TESTC101', '2026-08-01T09:00:00-04:00');
    await avoidanceStore.recordAnswer('TESTC101', {
      value: 'leave-for-now',
      text: 'Leave the course for now',
      recordedAt: '2026-08-05T09:00:00-04:00', // 5 days before NOW — well inside the 14-day expiry
    });

    const courses = await fetchAndCaptureCourses(host);
    expect(courses.find((c) => c.courseId === 'TESTC101')?.steeringWeight).toBe(0.25);
  });

  it("a 'practise-differently' answer changes nothing — no steeringWeight results from it", async () => {
    const host = hostWithBasePath(BASE_PATH);
    const avoidanceStore = new ObsidianHomeAvoidanceStore(host);
    await avoidanceStore.markAsked('TESTC101', '2026-08-01T09:00:00-04:00');
    await avoidanceStore.recordAnswer('TESTC101', {
      value: 'practise-differently',
      text: 'Practise it differently',
      recordedAt: '2026-08-05T09:00:00-04:00', // also well inside the expiry — the field, not the age, is what matters here
    });

    const courses = await fetchAndCaptureCourses(host);
    expect(courses.find((c) => c.courseId === 'TESTC101')?.steeringWeight).toBeUndefined();
  });

  it('a leave-for-now answer older than the 14-day expiry no longer applies', async () => {
    const host = hostWithBasePath(BASE_PATH);
    const avoidanceStore = new ObsidianHomeAvoidanceStore(host);
    await avoidanceStore.markAsked('TESTC101', '2026-07-01T09:00:00-04:00');
    await avoidanceStore.recordAnswer('TESTC101', {
      value: 'leave-for-now',
      text: 'Leave the course for now',
      // NOW (2026-08-10T09:00) minus this is exactly 15 days — one day past
      // the 14-day expiry, so this must NOT apply.
      recordedAt: '2026-07-26T09:00:00-04:00',
    });

    const courses = await fetchAndCaptureCourses(host);
    expect(courses.find((c) => c.courseId === 'TESTC101')?.steeringWeight).toBeUndefined();
  });

  it('a newer answer supersedes an older one for the same course', async () => {
    const host = hostWithBasePath(BASE_PATH);
    const avoidanceStore = new ObsidianHomeAvoidanceStore(host);
    await avoidanceStore.markAsked('TESTC101', '2026-07-01T09:00:00-04:00');
    // First answer: practise-differently, and old enough it would also be
    // expired were it leave-for-now — neither property is why it stops
    // applying below; being overwritten is.
    await avoidanceStore.recordAnswer('TESTC101', {
      value: 'practise-differently',
      text: 'Practise it differently',
      recordedAt: '2026-07-02T09:00:00-04:00',
    });
    // She changes her mind: a fresh leave-for-now answer replaces it —
    // `ObsidianHomeAvoidanceStore.recordAnswer` REPLACES the stored answer
    // rather than accumulating one, so `load()` can only ever return this
    // newest record.
    await avoidanceStore.recordAnswer('TESTC101', {
      value: 'leave-for-now',
      text: 'Leave the course for now',
      recordedAt: '2026-08-05T09:00:00-04:00',
    });

    const courses = await fetchAndCaptureCourses(host);
    expect(courses.find((c) => c.courseId === 'TESTC101')?.steeringWeight).toBe(0.25);
  });

  it('no avoidance answer on file — steeringWeight stays absent, same as before this bead', async () => {
    const host = hostWithBasePath(BASE_PATH);

    const courses = await fetchAndCaptureCourses(host);
    expect(courses.find((c) => c.courseId === 'TESTC101')?.steeringWeight).toBeUndefined();
  });
});
