/**
 * `ol-egov.141.89.8.59` (D-448): a Markdown file that declares role transcript reaches the grove
 * census with its part states; an undeclared note is unchanged. Through the real provider and the
 * real unit manifest store. Every string is invented (INV-3).
 */
import type { VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { findUnreadableFiles } from '../../../core/src/source/unreadable.js';
import { createLocalGroveProvider } from '../../src/grove/provider.js';
import { createVaultUnitManifestStore } from '../../src/grove/unit-manifest-store.js';
import type { GroveViewState } from '../../src/grove/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { eventedTestVault } from './unit-manifest-test-vault.js';

const NOW = new Date('2026-10-02T09:00:00Z');
const BASE_PATH = '02 Assignments/Assignments.base';
const DECLARED = '03 Research/TESTC101 Lecture 4 transcript.md' as VaultPath;
const NOTE = '03 Research/TESTC101 My note.md' as VaultPath;
const body = (n: number) =>
  Array.from({ length: n }, (_, i) => `Topic ${i + 1} ${'word '.repeat(179)}`.trim()).join('\n\n');

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

const files = {
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
  '03 Research/Objectives.md': '---\nrole: objectives\ncourse: TESTC101\n---\n\nConcept A.\n',
  [DECLARED]: `---\nrole: transcript\ncourse: TESTC101\n---\n${body(3)}`,
  [NOTE]: `---\nrole: note\ncourse: TESTC101\n---\n${body(2)}`,
};

async function census(withStore: boolean) {
  const vault = eventedTestVault(files);
  const store = createVaultUnitManifestStore({
    vault,
    deviceId: 'olea-testdevice1',
    now: () => NOW,
  });
  await store.load();
  const provider = createLocalGroveProvider({
    vault,
    deviceId: 'olea-testdevice1',
    settingsHost: new FakeDataHost(),
    now: () => NOW,
    ...(withStore ? { unitManifests: (paths) => store.manifestsFor(paths) } : {}),
  });
  const state: GroveViewState = await provider.load();
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  const section = state.courses.find((c) => c.course === 'TESTC101');
  if (section === undefined) throw new Error('expected TESTC101');
  return { section, store };
}

describe('a declared Markdown transcript in the grove census (ol-egov.141.89.8.59)', () => {
  it('is enumerated with every part waiting, so the census lists it as not fully read yet', async () => {
    const { section, store } = await census(true);
    expect(section.notYetReadFiles).toEqual([DECLARED]);
    const manifest = (await store.manifestsFor([DECLARED])).get(DECLARED);
    expect(manifest?.entries.map((e) => e.readingState.kind)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('an undeclared note is left out of the census, exactly as without the store', async () => {
    const withStore = (await census(true)).section;
    const without = (await census(false)).section;
    expect(withStore.notYetReadFiles ?? []).not.toContain(NOTE);
    expect(withStore.unreadableFiles.map((f) => f.path)).not.toContain(NOTE);
    expect(without.unreadableFiles).toEqual(withStore.unreadableFiles);
    expect(without.notYetReadFiles ?? []).toEqual([]);
  });
});

describe('findUnreadableFiles skips Markdown unless it declares a transcript with a manifest', () => {
  it('an undeclared note with the same files and options gives the result it always gave', async () => {
    const vault = eventedTestVault(files);
    const base = { files: [NOTE], linkedPaths: new Set<VaultPath>([NOTE]) };
    expect(await findUnreadableFiles(vault, base)).toEqual([]);
    expect(await findUnreadableFiles(vault, { ...base, manifests: new Map() })).toEqual([]);
  });
});
