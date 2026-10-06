/**
 * `ol-egov.141.89.7.64`: the shipped plan provider throws a ZodError (`too_small` at
 * `body.courses[0].concepts[n].citations`) when a ranked concept's only evidence is a declared scope
 * (brief); an objectives-only concept takes the same path. Pinned with `it.fails` until the citation
 * shape decision (`ol-egov.141.89.7.65`) lands and the fix makes this pass: then drop `.fails`.
 * All names below are invented.
 */
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
  it.fails('fetchPlan resolves with a plan (throws a citations too_small ZodError until the fix)', async () => {
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

    await expect(provider.fetchPlan()).resolves.toBeDefined();
  });
});
