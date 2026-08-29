/**
 * `createLocalGroveProvider` wiring tests (F8.1, `[D-134]` Q1, `ol-0r92.17`).
 *
 * Every fixture string below is INVENTED — course codes, concept names —
 * per INV-3; nothing here is drawn from a real vault. This suite tests the
 * WIRING this bead adds (grouping `buildRegistryModel`'s output by course,
 * filtering the standing offer per course, respecting withdrawal) — not
 * `buildRegistryModel`'s own acceptance criteria, which is `packages/core/
 * src/registry/build.spec.ts`'s job.
 */
import { describe, expect, it } from 'vitest';
import { createLocalGroveProvider } from '../../src/grove/provider.js';
import type { GroveViewState } from '../../src/grove/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault, unreadableVault } from '../review/memory-vault.js';

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

function fixtureVault() {
  return memoryVault({
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
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 1\n',
    'Notes/one.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/two.md': [
      '---',
      'topic: [Concept B]',
      'course: TESTC202',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
  });
}

async function modelFrom(state: GroveViewState) {
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  return state.courses;
}

describe('createLocalGroveProvider — load', () => {
  it('groups concepts per course, never pooling them across courses', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const courses = await modelFrom(await provider.load());
    const codes = courses.map((c) => c.course).sort();
    expect(codes).toEqual(['TESTC101', 'TESTC202']);

    const c101 = courses.find((c) => c.course === 'TESTC101');
    expect(c101?.concepts.map((c) => c.name)).toEqual(['Concept A']);
    const c202 = courses.find((c) => c.course === 'TESTC202');
    expect(c202?.concepts.map((c) => c.name)).toEqual(['Concept B']);
  });

  it('includes a course with an assessment but no concepts yet — an honest empty section', async () => {
    const vault = memoryVault({
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
        '---\nclass: TESTC303\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 1\n',
    });
    const provider = createLocalGroveProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const courses = await modelFrom(await provider.load());
    expect(courses).toHaveLength(1);
    expect(courses[0]?.course).toBe('TESTC303');
    expect(courses[0]?.concepts).toEqual([]);
  });

  it('filters the standing offer to each course, never pooling it either (D-134 Q1)', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const courses = await modelFrom(await provider.load());
    const c101 = courses.find((c) => c.course === 'TESTC101');
    const c202 = courses.find((c) => c.course === 'TESTC202');
    expect(c101?.offerCards).toHaveLength(1);
    expect(c101?.offerCards[0]?.course).toBe('TESTC101');
    expect(c202?.offerCards).toHaveLength(0);
  });

  it('is empty (never unavailable) when no assignments Base is configured', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
    });
    const courses = await modelFrom(await provider.load());
    expect(courses.map((c) => c.course).sort()).toEqual(['TESTC101', 'TESTC202']);
    for (const course of courses) expect(course.offerCards).toEqual([]);
  });

  it('returns unavailable, never throws, when the vault cannot be read', async () => {
    const provider = createLocalGroveProvider({
      vault: unreadableVault() as ReturnType<typeof fixtureVault>,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const state = await provider.load();
    expect(state.kind).toBe('unavailable');
  });
});

describe('createLocalGroveProvider — dismiss', () => {
  it('ends the standing offer for that course — it never reappears there', async () => {
    const host = hostWithBasePath(BASE_PATH);
    const provider = createLocalGroveProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });

    const before = await modelFrom(await provider.load());
    const card = before.find((c) => c.course === 'TESTC101')?.offerCards[0];
    if (card === undefined) throw new Error('expected a standing offer card');

    await provider.dismiss(card.assessmentPath);

    const after = await modelFrom(await provider.load());
    expect(after.find((c) => c.course === 'TESTC101')?.offerCards).toEqual([]);
  });
});
