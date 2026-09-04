/**
 * `createLocalHomeProvider` wiring tests (F6.10, `[D-223]`, `ol-l5og.21`
 * [HOME-2]).
 *
 * Every fixture string below is INVENTED — course codes, assessment titles —
 * per INV-3; nothing here is drawn from a real vault. This suite tests the
 * COMPOSITION this bead adds (session-builder + grove reads → one
 * `HomeViewState`, and the per-course offer selection), not
 * `resolveOfferCards`'s/`buildGroveModel`'s own acceptance criteria, which
 * are `test/retrospective/offer-card.spec.ts`'s and `packages/core`'s own
 * job.
 */
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createLocalHomeProvider } from '../../src/home/provider.js';
import type { HomeViewState } from '../../src/home/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = new Date('2026-09-01T09:00:00Z');

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

const BASE_CONTENT = [
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

function fixtureVault(files: Record<string, string> = {}) {
  return memoryVault({ [BASE_PATH]: BASE_CONTENT, ...files });
}

function provider(vault: ReturnType<typeof fixtureVault>, host: ObsidianDataHost) {
  return createLocalHomeProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: host,
    now: () => NOW,
    scheduler: createFsrsScheduler(),
  });
}

function dashboard(state: HomeViewState) {
  if (state.kind !== 'dashboard') throw new Error(`expected dashboard, got ${state.kind}`);
  return state;
}

describe('createLocalHomeProvider — load, no assignments Base configured', () => {
  it('is a dashboard with no courses and an unavailable session, rather than an error', async () => {
    const state = await provider(fixtureVault(), new FakeDataHost()).load();
    const { session, courses } = dashboard(state);
    expect(session).toEqual({ kind: 'unavailable' });
    expect(courses).toEqual([]);
  });
});

describe('createLocalHomeProvider — F6.10 per-course quiet-line selection', () => {
  it('selects at most one retrospective offer per course, even when several of its assessments have passed (the de-duplication fix)', async () => {
    const vault = fixtureVault({
      '02 Assignments/Quiz 1.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-10\nstatus: done\n---\n\n# Quiz 1\n',
      '02 Assignments/Quiz 2.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 2\n',
      '02 Assignments/Quiz 3.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-25\nstatus: done\n---\n\n# Quiz 3\n',
    });
    const { courses } = dashboard(await provider(vault, hostWithBasePath(BASE_PATH)).load());

    const testc101Rows = courses.filter((row) => row.course === 'TESTC101');
    // F6.10 never renders more than one line per course, so this course
    // never produces more than one row either.
    expect(testc101Rows).toHaveLength(1);
    expect(testc101Rows[0]?.quiet?.kind).toBe('retrospective-offer');
  });

  it('picks the assessment with the earliest path — a stable, deterministic tie-break', async () => {
    const vault = fixtureVault({
      '02 Assignments/Quiz 2.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 2\n',
      '02 Assignments/Quiz 1.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-10\nstatus: done\n---\n\n# Quiz 1\n',
    });
    const { courses } = dashboard(await provider(vault, hostWithBasePath(BASE_PATH)).load());
    const row = courses.find((r) => r.course === 'TESTC101');
    expect(row?.quiet?.kind).toBe('retrospective-offer');
    if (row?.quiet?.kind === 'retrospective-offer') {
      expect(row.quiet.assessmentPath).toBe('02 Assignments/Quiz 1.md');
    }
  });

  it('a course with no registered document and no standing offer reads "set up, waiting"', async () => {
    const vault = fixtureVault({
      '02 Assignments/Quiz 1.md':
        '---\nclass: TESTC202\ntype: Quiz\nweight: 10\ndue: 2026-09-20\nstatus: pending\n---\n\n# Quiz 1\n',
    });
    const { courses } = dashboard(await provider(vault, hostWithBasePath(BASE_PATH)).load());
    const row = courses.find((r) => r.course === 'TESTC202');
    expect(row?.marks).toBeUndefined();
    expect(row?.quiet?.kind).toBe('set-up-waiting');
  });
});

describe('createLocalHomeProvider — dismiss', () => {
  it('ends the standing offer for that assessment — the course row stops carrying it', async () => {
    const vault = fixtureVault({
      '02 Assignments/Quiz 1.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 1\n',
    });
    const home = provider(vault, hostWithBasePath(BASE_PATH));

    const before = dashboard(await home.load()).courses.find((r) => r.course === 'TESTC101');
    expect(before?.quiet?.kind).toBe('retrospective-offer');
    if (before?.quiet?.kind !== 'retrospective-offer') throw new Error('expected an offer');

    await home.dismiss(before.quiet.assessmentPath);

    const after = dashboard(await home.load()).courses.find((r) => r.course === 'TESTC101');
    expect(after?.quiet?.kind).not.toBe('retrospective-offer');
  });
});
