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
import { studyPlanArtifact } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { createLocalStudyPlanProvider } from '../../src/plan/provider.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

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

describe('createLocalStudyPlanProvider — configured', () => {
  it('composes a valid StudyPlanArtifact entirely on-device, reflecting her real review log', async () => {
    const vault = studyVault();
    // A device-named log the plugin's own probe finds — same file naming
    // `reviewLogPath` produces, same folder `readReviewLogHistory` reads.
    await vault.write(
      '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
      `${JSON.stringify({
        schemaVersion: 4,
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
    const plan = studyPlanArtifact.parse(raw);

    expect(plan.asOf).toBe('2026-08-10');
    expect(plan.computedAt).toBe(new Date('2026-08-10T09:00:00-04:00').toISOString());
    const course = plan.courses.find((c) => c.course === 'TESTC101');
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
    const plan = studyPlanArtifact.parse(raw);
    const course = plan.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    // No log at all — a fresh install's honest state — still produces a
    // usable, schema-valid plan rather than throwing or abstaining.
    expect(course.concepts).toHaveLength(1);
  });
});
