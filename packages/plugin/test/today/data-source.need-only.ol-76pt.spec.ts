/**
 * `ol-76pt` (`[D-373]` applying `[D-329]`): Today reads a completed course and
 * a course with material but no assessment record differently. Composed
 * through the real session door (`session-builder/provider.ts`'s
 * `composeStudySessionForRequest`, the call `main.ts`'s
 * `composeDefaultStudySession` makes), then read by
 * `createVaultInstrumentSource` exactly as the Today panel reads it.
 *
 * INV-3: every course code, concept name and path below is invented.
 */

import type { ComposedStudySession } from 'olea-core';
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { sessionNotComposedSentence } from '../../src/today/copy.js';
import {
  createVaultInstrumentSource,
  type SessionCompositionOutcome,
  sessionNotComposedReason,
} from '../../src/today/data-source.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T09:00:00-04:00');
const ASSIGNMENTS_BASE_PATH = '02 Assignments/Assignments.base';
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

class FakeSettingsHost implements ObsidianDataHost {
  private blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: ASSIGNMENTS_BASE_PATH },
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

/** A course whose one assessment is already behind her — completed-course maintenance. */
const COMPLETED_COURSE: Readonly<Record<string, string>> = {
  '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
  'Notes/widget.md': [
    '---',
    'topic: [Widget theory]',
    'course: TESTC101',
    '---',
    '',
    'Front::Back',
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
  [ASSIGNMENTS_BASE_PATH]: BASE_FILE,
  '02 Assignments/Quiz 1.md':
    '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-07-01\nstatus: done\n---\n\n# Quiz 1\n',
};

/** A course she has a topic-bearing note for and has never declared an assessment for. */
function noAssessmentNote(withInstrument: boolean): Readonly<Record<string, string>> {
  return {
    'Courses/TESTN200/Invented orbit.md': [
      '---',
      'topic: [Invented orbit]',
      'course: TESTN200',
      '---',
      '',
      'Some notes on an invented orbit.',
      ...(withInstrument ? ['', 'Orbit front::Orbit back', ''] : ['']),
    ].join('\n'),
  };
}

async function todayOutcome(files: Readonly<Record<string, string>>): Promise<{
  readonly outcome: SessionCompositionOutcome | undefined;
  readonly composed: ComposedStudySession | null;
}> {
  const vault = memoryVault({ ...files });
  let composed: ComposedStudySession | null = null;
  const source = createVaultInstrumentSource({
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    now: () => NOW,
    studySessionHolder: createStudySessionHolder(),
    // The same call `main.ts`'s `composeDefaultStudySession` makes.
    composeDefaultStudySession: async () => {
      const result = await composeStudySessionForRequest(
        {
          vault,
          deviceId: DEVICE,
          settingsHost: new FakeSettingsHost(),
          now: () => NOW,
          scheduler: createFsrsScheduler(),
        },
        { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
        NOW,
      );
      composed = result?.composed.full ?? null;
      return composed;
    },
  });
  await source.listDueCandidates();
  return { outcome: source.sessionCompositionOutcome?.(), composed };
}

describe('Today tells a completed course from a course with no assessment record (`ol-76pt`, `[D-373]`, `[D-329]`)', () => {
  it('a completed course alone: nothing was selected, so "no upcoming assessment"', async () => {
    const { outcome } = await todayOutcome(COMPLETED_COURSE);
    expect(outcome).toEqual({ composed: false, reason: 'nothing-assessed-soon' });
  });

  it('plus a no-assessment course with nothing built: its concept is ranked on need and set aside, so the reason differs', async () => {
    const { outcome, composed } = await todayOutcome({
      ...COMPLETED_COURSE,
      ...noAssessmentNote(false),
    });
    expect(composed?.setAside?.concepts.some((c) => c.reason === 'no-instruments')).toBe(true);
    expect(outcome).toEqual({ composed: false, reason: 'nothing-to-practise-yet' });
  });

  it('plus a no-assessment course with an instrument: it is served on need alone, and a session is composed', async () => {
    const { outcome, composed } = await todayOutcome({
      ...COMPLETED_COURSE,
      ...noAssessmentNote(true),
    });
    expect(composed?.model.items.map((item) => item.course)).toEqual(['TESTN200']);
    expect(outcome).toEqual({ composed: true });
  });

  it('the two not-composed reasons read differently to her', () => {
    const completed = sessionNotComposedSentence('nothing-assessed-soon');
    const needOnly = sessionNotComposedSentence('nothing-to-practise-yet');
    expect(needOnly).not.toBe(completed);
    expect(needOnly).not.toContain('upcoming assessment');
  });
});

describe('sessionNotComposedReason (`ol-76pt`)', () => {
  it('reads "nothing-assessed-soon" when nothing was set aside, or the field is absent', () => {
    expect(sessionNotComposedReason({})).toBe('nothing-assessed-soon');
    expect(
      sessionNotComposedReason({ setAside: { courses: [], concepts: [], instruments: [] } }),
    ).toBe('nothing-assessed-soon');
  });

  it('reads "nothing-to-practise-yet" only for a concept set aside with nothing to practise', () => {
    expect(
      sessionNotComposedReason({
        setAside: {
          courses: [],
          concepts: [{ conceptKey: 'k', reason: 'did-not-fit' }],
          instruments: [],
        },
      }),
    ).toBe('nothing-assessed-soon');
    expect(
      sessionNotComposedReason({
        setAside: {
          courses: [],
          concepts: [{ conceptKey: 'k', reason: 'no-instruments' }],
          instruments: [],
        },
      }),
    ).toBe('nothing-to-practise-yet');
  });
});
