/**
 * `ol-egov.141.89.10.15` (bug, F2.18/C5.6, C5.8 as amended — `[D-193]`):
 * `extendDefaultStudySession` (`main.ts`) used to re-compose an outrun
 * extension with no `courseOrTopic` steering at all, so the dominant-course
 * selection (`selectDominantCourse`, `study-session/compose.ts`) reran its
 * own filter/urgency/deficit hierarchy fresh at extend time and was free to
 * land on a DIFFERENT course than the frozen composition it was extending —
 * contradicting F2.18's "a session is one course" and C5.8's own words:
 * "where she outruns it, C5.8's outrun extends this course's own material
 * under the same plan's shares."
 *
 * `main.ts` imports `obsidian` and cannot be loaded under Vitest at all (see
 * `test/main-wiring.spec.ts`'s own module doc), so the fix extracted the one
 * piece of real decision logic — which course an extension must pin to —
 * into its own obsidian-free module, `src/extend-outrun-course-filter.ts`.
 * This suite tests that module directly (unit tests below), plus proves the
 * fix's real effect end to end by driving `composeStudySessionForRequest`
 * (`session-builder/provider.ts`) exactly the way `extendDefaultStudySession`
 * now does — the acceptance criterion's "urgency inputs changed between open
 * and extend, and the course is unchanged."
 *
 * The two-course vault fixture and `allocationEntry`'s urgency-crossing
 * `risk` are `test/session-builder/provider.spec.ts`'s own pattern
 * ("the same plan with the crossing urgency swapped swaps which course is
 * included"), restated here rather than imported (that file is a live
 * concurrent lane's this round). Course codes and concept names are
 * invented (INV-3).
 */
import {
  GOVERNING_FRESH_FOR_SECONDS,
  GOVERNING_GOVERNS_FOR_SECONDS,
  type StudyPlanAllocationEntry,
  type StudyPlanEnvelope,
} from 'olea-contracts';
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { frozenCourseOrTopicFilter } from '../src/extend-outrun-course-filter.js';
import type { ObsidianDataHost } from '../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../src/plan/settings-store.js';
import type { CourseOrTopicOption } from '../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../src/session-builder/provider.js';
import { memoryVault } from './review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T09:00:00-04:00');
const BASE_PATH = '02 Assignments/Assignments.base';
const BASE_FILE = [
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
].join('\n');

const QUIZ_TESTC101 =
  '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n';
const QUIZ_TESTC202 =
  '---\nclass: TESTC202\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 2\n';

/** Two never-reviewed concepts, one per course — restated from `provider.spec.ts`'s own `twoCourseBaseFiles`. */
function twoCourseBaseFiles(): Readonly<Record<string, string>> {
  return {
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '05 Zettelkasten/Gadget theory.md': '# Gadget theory\n',
    'Notes/one.md': [
      '---',
      'topic: [Widget theory]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/two.md': [
      '---',
      'topic: [Gadget theory]',
      'course: TESTC202',
      '---',
      '',
      'Front2::Back2',
      '',
    ].join('\n'),
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
    '03 Research/TESTC202 Past Paper 2023.md': [
      '---',
      'role: past-paper',
      'course: TESTC202',
      '---',
      '',
      '# TESTC202 Past Paper — 2023',
      '',
      '## Question 1 (10 marks)',
      '',
      'Explain the core mechanism behind Gadget theory and why it matters.',
      '',
    ].join('\n'),
    [BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md': QUIZ_TESTC101,
    '02 Assignments/Quiz 2.md': QUIZ_TESTC202,
  };
}

class FakeSettingsHost implements ObsidianDataHost {
  private blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: BASE_PATH },
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function allocationEntry(courseId: string, share: number, risk: number): StudyPlanAllocationEntry {
  return {
    courseId,
    share,
    minBlockSeconds: 1,
    contributions: [{ name: 'risk', value: risk }],
    reason: `${courseId} gets its share.`,
  };
}

function planWithRisk(urgentCourse: string, calmCourse: string): StudyPlanEnvelope {
  return {
    envelopeVersion: 1,
    kind: 'study-plan',
    bodyVersion: 1,
    policyVersion: 'sp1-aaaaaaaaaaaaaaaa',
    computedAt: NOW.toISOString(),
    freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
    governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
    body: {
      asOf: '2026-08-10',
      courses: [],
      // `risk` above `URGENCY_OVERRIDE_THRESHOLD` (1/14 ≈ 0.071,
      // `session-builder/provider.ts`) forces `selectDominantCourse`'s
      // urgency branch; below it, the course never wins on urgency.
      allocation: [allocationEntry(urgentCourse, 0.5, 0.5), allocationEntry(calmCourse, 0.5, 0.01)],
    },
  };
}

async function compose(plan: StudyPlanEnvelope, courseOrTopic?: CourseOrTopicOption) {
  const result = await composeStudySessionForRequest(
    {
      vault: memoryVault(twoCourseBaseFiles()),
      deviceId: DEVICE,
      settingsHost: new FakeSettingsHost(),
      now: () => NOW,
      scheduler: createFsrsScheduler(),
      plan: () => plan,
    },
    { budgetMinutes: 1, ...(courseOrTopic !== undefined ? { courseOrTopic } : {}) },
    NOW,
  );
  if (result === null)
    throw new Error('expected a composed result, got null (plan not configured)');
  return result.composed.full;
}

describe('frozenCourseOrTopicFilter (pure)', () => {
  it("reads the frozen composition's chosen course (ComposedStudySession.dominantCourse, study-session/compose.ts) into a course-kind CourseOrTopicOption", () => {
    expect(frozenCourseOrTopicFilter('TESTC101')).toEqual({ kind: 'course', label: 'TESTC101' });
  });

  it('undefined (defensive only — the degenerate "no eligible course at all" case) asks for no restriction rather than throwing', () => {
    expect(frozenCourseOrTopicFilter(undefined)).toBeUndefined();
  });
});

describe('extendDefaultStudySession’s real fix: a course pinned from the frozen composition survives an urgency swap between open and extend', () => {
  it('baseline ("open"): TESTC101 is urgent, TESTC202 is calm — the composed session’s dominantCourse is TESTC101, courseShares carries its positive share and TESTC202’s zero one (never just one key — see frozenCourseOrTopicFilter’s own doc for why this reads dominantCourse, not courseShares.keys())', async () => {
    const previous = await compose(planWithRisk('TESTC101', 'TESTC202'));
    expect(previous.dominantCourse).toBe('TESTC101');
    expect(previous.courseShares.get('TESTC101')).toBeGreaterThan(0);
    expect(previous.courseShares.get('TESTC202')).toBe(0);
    expect(previous.model.items.every((item) => item.conceptName === 'Widget theory')).toBe(true);
  });

  it('WITHOUT the fix (no courseOrTopic): swapping which course is urgent between open and extend swaps which course the "extension" would compose — the vulnerability this bead closes', async () => {
    const previous = await compose(planWithRisk('TESTC101', 'TESTC202'));
    // Urgency inputs changed between open and extend: TESTC202 is now the
    // urgent course.
    const unpinnedExtend = await compose(planWithRisk('TESTC202', 'TESTC101'));
    expect(unpinnedExtend.dominantCourse).toBe('TESTC202');
    expect(unpinnedExtend.dominantCourse).not.toBe(previous.dominantCourse);
  });

  it('WITH the fix (courseOrTopic derived by frozenCourseOrTopicFilter from the frozen composition’s dominantCourse): the same urgency swap no longer moves the course', async () => {
    const previous = await compose(planWithRisk('TESTC101', 'TESTC202'));
    const courseOrTopic = frozenCourseOrTopicFilter(previous.dominantCourse);
    expect(courseOrTopic).toEqual({ kind: 'course', label: 'TESTC101' });

    // Same urgency swap as the "without the fix" case above — TESTC202 is
    // now the urgent course — but this call pins courseOrTopic the way
    // `extendDefaultStudySession` now does.
    const pinnedExtend = await compose(planWithRisk('TESTC202', 'TESTC101'), courseOrTopic);
    expect(pinnedExtend.dominantCourse).toBe('TESTC101');
    expect(pinnedExtend.model.items.every((item) => item.conceptName === 'Widget theory')).toBe(
      true,
    );
  });
});
