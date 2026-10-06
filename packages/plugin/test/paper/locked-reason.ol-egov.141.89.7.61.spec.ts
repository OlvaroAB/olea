/**
 * Why a locked practice paper is locked, in the ruled sentences ([D-532], ol-egov.141.89.7.61).
 * Scenarios: olea-service features/F4-oracle.md, F4.11 "Why a locked paper is locked", tagged
 * `@auto:plugin/paper/locked-reason.ol-egov.141.89.7.61.spec`. Course A, synthetic.
 *
 * Driven through the real `PaperView` with a fake DOM: `obsidian` has no runtime under Vitest, but
 * `view.ts` needs only `ItemView` from it, so a stand-in class is enough to mount the view.
 */
import { resolveOutcome } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { memoryVault } from '../review/memory-vault.js';

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl: unknown;
    constructor(_leaf: unknown) {
      this.contentEl = (globalThis as { __rootFactory?: () => unknown }).__rootFactory?.();
    }
  },
}));

import { buildLockedCopy, buildUndatedAssessmentCopy } from '../../src/paper/copy.js';
import {
  createLocalPracticePaperProvider,
  topicsNeededToUnlock,
} from '../../src/paper/provider.js';
import { PaperView } from '../../src/paper/view.js';
import { FakeEl } from './fake-dom.helper.js';

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

function note(course: string, type: string, due: string): string {
  return `---\nclass: ${course}\ntype: ${type}\nweight: 1\ndue: ${due}\nstatus: pending\n---\n`;
}

function deps(files: Record<string, string>) {
  return {
    vault: memoryVault({ [BASE_PATH]: BASE_FILE, ...files }),
    settingsStore: {
      load: async () => ({ version: 1 as const, assignmentsBasePath: BASE_PATH }),
    },
    generationPort: async () => null,
    now: () => new Date('2026-09-19T00:00:00Z'),
  };
}

async function readView(
  files: Record<string, string>,
  setup?: (vault: ReturnType<typeof memoryVault>) => Promise<void>,
) {
  const d = deps(files);
  if (setup) await setup(d.vault as ReturnType<typeof memoryVault>);
  const provider = createLocalPracticePaperProvider(d);
  const root = new FakeEl('root');
  (globalThis as { __rootFactory?: () => unknown }).__rootFactory = () => root;
  const view = new PaperView({} as never, provider, 'COURSEA');
  await view.refresh();
  return root.allText();
}

const CONCEPT_NOTE = '05 Zettelkasten/Widget theory.md';
const FAR = { '02 Assignments/exam.md': note('COURSEA', 'exam', '2026-10-29') }; // 40 days from 2026-09-19

describe('the threshold count is derived from the gate', () => {
  it('is the smallest whole number of topics the gate accepts', () => {
    expect(topicsNeededToUnlock(10, 0.3)).toBe(3);
    expect(topicsNeededToUnlock(7, 0.3)).toBe(3);
    expect(topicsNeededToUnlock(12, 0.3)).toBe(4);
    expect(topicsNeededToUnlock(1, 0.3)).toBe(1);
    expect(topicsNeededToUnlock(10, 0.5)).toBe(5);
  });
});

describe('the locked sentence with a declared scope', () => {
  const input = {
    course: 'COURSEA',
    daysUntilNearest: 40,
    nearestAssessmentDue: '2026-10-29',
    coverage: { outcomeCount: 10, attachedOutcomeCount: 2, outcomeCoverageKnown: true },
    topicsNeeded: 3,
    windowDays: 7,
  };

  it('is the ruled sentence with its counts and both thresholds', () => {
    expect(buildLockedCopy(input)).toBe(
      'The practice paper for COURSEA is not available yet. Its declared scope lists 10 topics, and 2 of them have your material behind them. ' +
        'It unlocks when your nearest assessment, on 2026-10-29 (40 days away), is within 7 days, or when at least 3 of those 10 topics have your material behind them.',
    );
  });

  it('takes both numbers from its input, never from the copy', () => {
    const copy = buildLockedCopy({ ...input, topicsNeeded: 5, windowDays: 14 });
    expect(copy).toContain('within 14 days');
    expect(copy).toContain('at least 5 of those');
  });

  it('singularises day and shows no percentage, ratio or the word outcomes', () => {
    const copy = buildLockedCopy({ ...input, daysUntilNearest: 1, windowDays: 1 });
    expect(copy).toContain('(1 day away)');
    expect(copy).toContain('within 1 day,');
    expect(copy).not.toMatch(/%|percent|outcome/i);
  });

  it('with no declared scope, says there is nothing to count and shows no count', () => {
    const copy = buildLockedCopy({
      ...input,
      coverage: { outcomeCount: 0, attachedOutcomeCount: 0, outcomeCoverageKnown: false },
    });
    expect(copy).toBe(
      "The practice paper for COURSEA is not available yet. Olea hasn't read a scope for this course from its past papers or objectives, so there is nothing to count. " +
        'It unlocks when your nearest assessment, on 2026-10-29 (40 days away), is close enough.',
    );
    expect(copy).not.toMatch(/\b0\b|topics/);
  });
});

describe('the undated sentence', () => {
  it('is the ruled sentence', () => {
    expect(buildUndatedAssessmentCopy('COURSEA')).toBe(
      "The practice paper for COURSEA is not available yet. Olea doesn't know the date of any upcoming assessment for this course, and the paper unlocks only once there is one ahead.",
    );
  });
});

describe('through the paper view', () => {
  it('a locked course with a declared scope reads the counts and thresholds', async () => {
    const text = await readView({ ...FAR, [CONCEPT_NOTE]: '# Widget theory\n' }, async (vault) => {
      // ten declared topics, none attached: M = 0, T = 3
      for (let i = 0; i < 10; i += 1) {
        await resolveOutcome(vault, {
          courses: ['COURSEA'],
          source: { path: CONCEPT_NOTE, blockIndex: i },
          label: `Topic ${i}`,
          provenance: { promptVersion: 'v1', modelVersion: 'model-a' },
        });
      }
    });
    expect(text).toContain(
      'Its declared scope lists 10 topics, and 0 of them have your material behind them.',
    );
    expect(text).toContain('is within 7 days, or when at least 3 of those 10 topics');
  });

  it('a locked course with no declared scope reads the no-scope sentence', async () => {
    const text = await readView(FAR);
    expect(text).toContain("Olea hasn't read a scope for this course");
    expect(text).toContain('is close enough.');
  });

  it('an assessment with no date reads the undated sentence', async () => {
    const text = await readView({ '02 Assignments/exam.md': note('COURSEA', 'exam', '') });
    expect(text).toContain("Olea doesn't know the date of any upcoming assessment");
  });

  it('a course with no assessment record keeps today line', async () => {
    const text = await readView({
      '02 Assignments/other.md': note('COURSEB', 'exam', '2026-10-29'),
    });
    expect(text).toContain('has no upcoming assessment');
  });

  it('only passed assessments keep today line', async () => {
    const text = await readView({
      '02 Assignments/exam.md': note('COURSEA', 'exam', '2026-01-01'),
    });
    expect(text).toContain('has no upcoming assessment');
  });

  it('a dated assessment ahead wins over an undated one', async () => {
    const text = await readView({
      ...FAR,
      '02 Assignments/other.md': note('COURSEA', 'quiz', ''),
    });
    expect(text).not.toContain("doesn't know the date");
    expect(text).toContain('is not available yet');
  });
});
