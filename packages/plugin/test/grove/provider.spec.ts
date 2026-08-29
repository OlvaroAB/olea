/**
 * `createLocalGroveProvider` wiring tests (F8.1, `[D-134]` Q1, `ol-0r92.17`;
 * real six-state computation `ol-o8eo`).
 *
 * Every fixture string below is INVENTED — course codes, concept names —
 * per INV-3; nothing here is drawn from a real vault. This suite tests the
 * WIRING this bead adds (assembling `buildGroveModel`'s inputs per course,
 * filtering the standing offer per course, respecting withdrawal) — not
 * `buildGroveModel`'s own acceptance criteria, which is `packages/core/
 * src/scope/grove.spec.ts` and `coverage.spec.ts`'s job.
 */
import type { GroveCourseModel } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createLocalGroveProvider } from '../../src/grove/provider.js';
import type { GroveCourseSection, GroveViewState } from '../../src/grove/view.js';
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

/**
 * A course with a registered objectives document naming "Concept A", material
 * present for it, and NO instrument built — the `ground` cell F4.5's stall
 * flag needs (F8.2's "material present, nothing generated yet" narrowing;
 * `../../src/scope/coverage.ts` — no `::` card syntax anywhere below, so
 * `instrumentCount` stays 0).
 */
function fixtureVaultGroundOnly() {
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
    '03 Research/Objectives.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept A in depth.',
      '',
    ].join('\n'),
    'Notes/one.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Some prose about Concept A, with no instrument built for it yet.',
      '',
    ].join('\n'),
  });
}

/** A course with a registered objectives document naming "Concept A" — the `'declared'` case. */
function fixtureVaultWithRegisteredSource() {
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
    '03 Research/Objectives.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept A in depth.',
      '',
    ].join('\n'),
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

function modelOf(section: GroveCourseSection | undefined): GroveCourseModel {
  if (section === undefined) throw new Error('expected a course section');
  return section.model;
}

async function sectionsFrom(state: GroveViewState): Promise<readonly GroveCourseSection[]> {
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  return state.courses;
}

describe('createLocalGroveProvider — load', () => {
  it('reads a real declared scope for a course with a registered objectives source (F8.1)', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithRegisteredSource(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const courses = await sectionsFrom(await provider.load());
    const codes = courses.map((c) => c.course).sort();
    expect(codes).toEqual(['TESTC101', 'TESTC202']);

    const c101 = modelOf(courses.find((c) => c.course === 'TESTC101'));
    if (c101.status !== 'declared') throw new Error(`expected declared, got ${c101.status}`);
    expect(c101.cells.map((cell) => cell.conceptName)).toEqual(['Concept A']);
    expect(c101.summary.denominatorSourcePaths).toEqual(['03 Research/Objectives.md']);

    // TESTC202 has a concept of her own ("Concept B") but no registered
    // objectives/past-paper source at all — F8.1 scenario 3's inference case.
    const c202 = modelOf(courses.find((c) => c.course === 'TESTC202'));
    expect(c202.status).toBe('inferred');
  });

  it('a course with no registered source and nothing extracted gets the designed empty state (F8.1 scenario 2)', async () => {
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
    const courses = await sectionsFrom(await provider.load());
    expect(courses).toHaveLength(1);
    expect(courses[0]?.course).toBe('TESTC303');
    expect(modelOf(courses[0])).toEqual({ status: 'no-registered-source', course: 'TESTC303' });
  });

  it('filters the standing offer to each course, never pooling it either (D-134 Q1)', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithRegisteredSource(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const courses = await sectionsFrom(await provider.load());
    const c101 = courses.find((c) => c.course === 'TESTC101');
    const c202 = courses.find((c) => c.course === 'TESTC202');
    expect(c101?.offerCards).toHaveLength(1);
    expect(c101?.offerCards[0]?.course).toBe('TESTC101');
    expect(c202?.offerCards).toHaveLength(0);
  });

  it('is still readable (never unavailable) when no assignments Base is configured', async () => {
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithRegisteredSource(),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
    });
    const courses = await sectionsFrom(await provider.load());
    expect(courses.map((c) => c.course).sort()).toEqual(['TESTC101', 'TESTC202']);
    for (const course of courses) expect(course.offerCards).toEqual([]);
  });

  it('returns unavailable, never throws, when the vault cannot be read', async () => {
    const provider = createLocalGroveProvider({
      vault: unreadableVault() as ReturnType<typeof fixtureVaultWithRegisteredSource>,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const state = await provider.load();
    expect(state.kind).toBe('unavailable');
  });

  it("persists a concept's ground-streak across two separate provider instances sharing the same data.json, so the stall flag can fire (F4.5, ol-0r92.20)", async () => {
    const host = hostWithBasePath(BASE_PATH);
    const vault = fixtureVaultGroundOnly();

    // First "session": a fresh provider, nothing persisted yet.
    const provider1 = createLocalGroveProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    const first = await sectionsFrom(await provider1.load());
    const firstModel = modelOf(first.find((c) => c.course === 'TESTC101'));
    if (firstModel.status !== 'declared')
      throw new Error(`expected declared, got ${firstModel.status}`);
    expect(firstModel.cells).toEqual([
      { conceptKey: expect.any(String), conceptName: 'Concept A', state: 'ground', stall: false },
    ]);

    // Second "session": a BRAND NEW provider instance (as if the plugin were
    // closed and reopened) reading the SAME host/data.json — never the same
    // provider object, so nothing but the persisted store could carry the
    // streak forward.
    const provider2 = createLocalGroveProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    const second = await sectionsFrom(await provider2.load());
    const secondModel = modelOf(second.find((c) => c.course === 'TESTC101'));
    if (secondModel.status !== 'declared')
      throw new Error(`expected declared, got ${secondModel.status}`);
    expect(secondModel.cells).toEqual([
      { conceptKey: expect.any(String), conceptName: 'Concept A', state: 'ground', stall: true },
    ]);
  });

  it('a concept that stops reading ground has its streak reset, not left stale, in the persisted store', async () => {
    const host = hostWithBasePath(BASE_PATH);

    const provider1 = createLocalGroveProvider({
      vault: fixtureVaultGroundOnly(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    await provider1.load();
    await provider1.load(); // streak now 2, stall true, per the test above

    // A later session where the concept now has material AND an instrument —
    // no longer `ground` at all.
    const vaultNowSeeded = memoryVault({
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
      '03 Research/Objectives.md': [
        '---',
        'role: objectives',
        'course: TESTC101',
        '---',
        '',
        'The course covers Concept A in depth.',
        '',
      ].join('\n'),
      'Notes/one.md': [
        '---',
        'topic: [Concept A]',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
    });
    const provider2 = createLocalGroveProvider({
      vault: vaultNowSeeded,
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    await provider2.load();

    // A hypothetical regression back to no material this session should read
    // as a first-sight `ground` again, not a continued stall — proving the
    // store actually dropped the resolved concept rather than leaving it at
    // its old streak.
    const provider3 = createLocalGroveProvider({
      vault: fixtureVaultGroundOnly(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });
    const third = await sectionsFrom(await provider3.load());
    const thirdModel = modelOf(third.find((c) => c.course === 'TESTC101'));
    if (thirdModel.status !== 'declared')
      throw new Error(`expected declared, got ${thirdModel.status}`);
    expect(thirdModel.cells).toEqual([
      { conceptKey: expect.any(String), conceptName: 'Concept A', state: 'ground', stall: false },
    ]);
  });
});

describe('createLocalGroveProvider — dismiss', () => {
  it('ends the standing offer for that course — it never reappears there', async () => {
    const host = hostWithBasePath(BASE_PATH);
    const provider = createLocalGroveProvider({
      vault: fixtureVaultWithRegisteredSource(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
    });

    const before = await sectionsFrom(await provider.load());
    const card = before.find((c) => c.course === 'TESTC101')?.offerCards[0];
    if (card === undefined) throw new Error('expected a standing offer card');

    await provider.dismiss(card.assessmentPath);

    const after = await sectionsFrom(await provider.load());
    expect(after.find((c) => c.course === 'TESTC101')?.offerCards).toEqual([]);
  });
});
