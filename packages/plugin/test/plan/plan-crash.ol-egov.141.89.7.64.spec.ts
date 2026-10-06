/**
 * `ol-egov.141.89.7.64`, `[D-529]`: the shipped plan provider used to throw a ZodError (`too_small`
 * at `body.courses[0].concepts[n].citations`) when a ranked concept's only evidence was a declared
 * scope (brief), an objectives document, or nothing at all (the marked unknown-relevance entry).
 * Each plan citation now carries the basis it was ranked on, so such a course refreshes the plan.
 * Pinned first as `it.fails` on the unfixed build; plain `it` now. All names below are invented.
 */
import { type StudyPlanEnvelope, studyPlanEnvelope } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { createLocalStudyPlanProvider } from '../../src/plan/provider.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

const COURSE = 'TESTC101';
const BASE_PATH = '02 Assignments/Assignments.base';

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: BASE_PATH },
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

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

describe('plan crash: a concept whose only evidence is a declared scope', () => {
  it('fetchPlan resolves with a plan whose concept cites the assessment note as a brief', async () => {
    const vault = memoryVault({
      '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
      'Notes/widget.md': `---\ntopic: [Widget theory]\ncourse: ${COURSE}\n---\n\nWidget front::Back\n`,
      [BASE_PATH]: BASE_FILE,
      // No past paper, no objectives document: the declared scope is the only evidence.
      '02 Assignments/Quiz 1.md': `---\nclass: ${COURSE}\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\nscope: Widget theory\n---\n\n# Quiz 1\n`,
    });

    const provider = createLocalStudyPlanProvider({
      vault,
      deviceId: 'olea-testdevice1',
      settingsHost: new FakeDataHost(),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const plan = await provider.fetchPlan();
    expect(citationsByConcept(studyPlanEnvelope.parse(plan))).toEqual({
      'Widget theory': [{ basis: 'assessment-brief', sourcePath: '02 Assignments/Quiz 1.md' }],
    });
  });
});

type Plan = StudyPlanEnvelope;

/** Concept name (read from the reasoning's lead words is not stable, so the key is the id) to its citations. */
function citationsByConcept(plan: Plan): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const course of plan.body.courses) {
    if (course.status !== 'ranked') continue;
    for (const concept of course.concepts) out[nameOf(concept.reasoning)] = concept.citations;
  }
  return out;
}

/** The reasoning string leads with the display name: "<name> (<course>) ...". */
function nameOf(reasoning: string): string {
  return reasoning.slice(0, reasoning.indexOf(' ('));
}

describe('plan refresh: a mixed-basis course (D-529)', () => {
  it('builds one plan in which every concept cites its own basis, across past paper, objectives and brief', async () => {
    const vault = memoryVault({
      '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
      '05 Zettelkasten/Gizmo law.md': '# Gizmo law\n',
      '05 Zettelkasten/Sprocket method.md': '# Sprocket method\n',
      '05 Zettelkasten/Flange rule.md': '# Flange rule\n',
      '05 Zettelkasten/Cog principle.md': '# Cog principle\n',
      'Notes/one.md': `---\ntopic: [Widget theory, Gizmo law, Sprocket method, Flange rule, Cog principle]\ncourse: ${COURSE}\n---\n\nFront::Back\n`,
      '03 Research/TESTC101 Past Paper 2024.md': [
        '---',
        'role: past-paper',
        `course: ${COURSE}`,
        '---',
        '',
        '# Past Paper 2024',
        '',
        '## Question 1 (10 marks)',
        '',
        'Explain the core mechanism behind Widget theory and why it matters.',
        '',
      ].join('\n'),
      '03 Research/TESTC101 Course Objectives.md': [
        '---',
        'role: objectives',
        `course: ${COURSE}`,
        '---',
        '',
        '# Course Objectives',
        '',
        '- Apply the Sprocket method to a gear train.',
        '',
      ].join('\n'),
      [BASE_PATH]: BASE_FILE,
      '02 Assignments/Quiz 1.md': `---\nclass: ${COURSE}\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\nscope: Covers Flange rule in depth.\n---\n\n# Quiz 1\n`,
    });

    const provider = createLocalStudyPlanProvider({
      vault,
      deviceId: 'olea-testdevice1',
      settingsHost: new FakeDataHost(),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const cited = citationsByConcept(studyPlanEnvelope.parse(await provider.fetchPlan()));
    expect(cited['Widget theory']).toEqual([
      {
        basis: 'past-paper',
        sourcePath: '03 Research/TESTC101 Past Paper 2024.md',
        questionLabel: expect.any(String),
      },
    ]);
    expect(cited['Sprocket method']).toEqual([
      { basis: 'objectives', sourcePath: '03 Research/TESTC101 Course Objectives.md' },
    ]);
    expect(cited['Flange rule']).toEqual([
      { basis: 'assessment-brief', sourcePath: '02 Assignments/Quiz 1.md' },
    ]);
    // A concept nothing names is not ranked by this provider (the need-only door is not opened
    // here, see provider.ts), so it is absent; the unknown-relevance citation is covered at the
    // build (core plan/build.spec).
    expect(Object.keys(cited).sort()).toEqual(['Flange rule', 'Sprocket method', 'Widget theory']);
  });
});
