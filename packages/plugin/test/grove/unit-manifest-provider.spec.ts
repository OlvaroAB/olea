/**
 * The grove census over the durable unit manifest (`[D-445]`, `ol-egov.141.89.8.43`; the reader half
 * `ol-egov.141.89.8.42` built): `createLocalGroveProvider`'s `unitManifests` supplier is the real
 * store, and moment A's honest-refusal bar holds through it — a source with pages nobody has read is
 * never listed as read, never as broken and never as absent, whether the store has never run, has
 * just been deleted, or is part-way through a rebuild.
 *
 * Every string below is invented (INV-3). The extractor the store enumerates with is injected; the
 * census's own extraction of a file (the fallback) is the real one over the fixture's bytes.
 */
import { stableUnitId, type UnitReadingState, type VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { unitManifestLogPath } from '../../../core/src/ingestion/unit-manifest/log.js';
import { createLocalGroveProvider } from '../../src/grove/provider.js';
import { createVaultUnitManifestStore } from '../../src/grove/unit-manifest-store.js';
import type { GroveCourseSection, GroveViewState } from '../../src/grove/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { isoWithLocalOffset } from '../../src/review/ports.js';
import { type EventedTestVault, eventedTestVault } from './unit-manifest-test-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-09-01T09:00:00Z');
const BASE_PATH = '02 Assignments/Assignments.base';
const SLIDES = '03 Research/TESTC101 Field Trip Slides.pptx' as VaultPath;
const HANDOUT = '03 Research/TESTC101 Handout.pdf' as VaultPath;

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

function fixtureVault(): EventedTestVault {
  return eventedTestVault({
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
      '![[TESTC101 Field Trip Slides.pptx]]',
      '',
      '![[TESTC101 Handout.pdf]]',
      '',
    ].join('\n'),
    // Neither parses as its format: the census's own fallback reads both as "no text found".
    [SLIDES]: 'not a real pptx, garbage bytes',
    [HANDOUT]: 'not a real pdf, garbage bytes',
  });
}

type Layout = readonly ('text' | 'vision')[];

function storeOver(
  vault: EventedTestVault,
  layouts: Map<VaultPath, Layout | 'broken'>,
  deviceId = DEVICE,
) {
  return createVaultUnitManifestStore({
    vault,
    deviceId,
    now: () => NOW,
    extractSource: async ({ path }) => {
      const layout = layouts.get(path) ?? 'broken';
      if (layout === 'broken') {
        return { sourcePath: path, format: 'pdf', outcome: 'unreadable', pages: [] };
      }
      return {
        sourcePath: path,
        format: 'pdf',
        outcome: 'extracted',
        pages: layout.map((route, index) => ({
          page: index + 1,
          charCount: route === 'text' ? 900 : 0,
          textLayer: route === 'text' ? ('readable' as const) : ('absent' as const),
          route: route === 'text' ? ('text-layer' as const) : ('vision' as const),
          units: [],
          furniture: false,
        })),
      };
    },
  });
}

async function census(
  vault: EventedTestVault,
  store: ReturnType<typeof storeOver> | null,
): Promise<GroveCourseSection> {
  const provider = createLocalGroveProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeDataHost(),
    now: () => NOW,
    ...(store !== null ? { unitManifests: (paths) => store.manifestsFor(paths) } : {}),
  });
  const state: GroveViewState = await provider.load();
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  const section = state.courses.find((c) => c.course === 'TESTC101');
  if (section === undefined) throw new Error('expected TESTC101');
  return section;
}

function imageReading(path: VaultPath, page: number, readingState: UnitReadingState) {
  return {
    unitId: stableUnitId(path, page),
    sourcePath: path,
    page,
    readingState,
    conceptExtractionState: 'not-started' as const,
  };
}

const READ_BY_IMAGE: UnitReadingState = {
  kind: 'read',
  method: 'image',
  provenance: {
    task: 'vision.extract',
    promptVersion: 'v2-test',
    modelIdentity: 'synthetic-model',
    imageDigest: 'sha256-synthetic',
  },
};

const unreadableOf = (section: GroveCourseSection, path: VaultPath) =>
  section.unreadableFiles.find((f) => f.path === path)?.reason;

describe('the grove census through the durable unit manifest', () => {
  it('without a store the census is unchanged: both files read as "no text found" from their empty text layer', async () => {
    const section = await census(fixtureVault(), null);
    expect(unreadableOf(section, SLIDES)).toBe('image-only-no-text');
    expect(unreadableOf(section, HANDOUT)).toBe('image-only-no-text');
    expect(section.notYetReadFiles ?? []).toEqual([]);
  });

  it('a source whose image pages nobody has read is recorded as not read yet: not broken, not absent, not read', async () => {
    const vault = fixtureVault();
    const layouts = new Map<VaultPath, Layout | 'broken'>([
      [SLIDES, ['text', 'vision', 'vision']],
      [HANDOUT, ['text', 'text']],
    ]);
    const store = storeOver(vault, layouts);
    await store.load();

    const section = await census(vault, store);
    expect(unreadableOf(section, SLIDES)).toBeUndefined();
    expect(section.notYetReadFiles).toEqual([SLIDES]);
    // The handout's every page was served by its text layer: nothing about it is unknown.
    expect(unreadableOf(section, HANDOUT)).toBeUndefined();
    expect(section.notYetReadFiles).not.toContain(HANDOUT);
  });

  it('once the vision pass has read the image pages the source leaves the not-read-yet record', async () => {
    const vault = fixtureVault();
    const layouts = new Map<VaultPath, Layout | 'broken'>([
      [SLIDES, ['text', 'vision', 'vision']],
      [HANDOUT, ['text']],
    ]);
    const store = storeOver(vault, layouts);
    await store.load();
    await census(vault, store);

    store.recordReading(imageReading(SLIDES, 2, READ_BY_IMAGE));
    await store.idle();
    expect((await census(vault, store)).notYetReadFiles).toEqual([SLIDES]);

    store.recordReading(imageReading(SLIDES, 3, READ_BY_IMAGE));
    await store.idle();
    const settled = await census(vault, store);
    expect(settled.notYetReadFiles).toEqual([]);
    expect(unreadableOf(settled, SLIDES)).toBeUndefined();
  });

  it('a page the vision pass found not legible lists the source as unreadable once nothing is pending', async () => {
    const vault = fixtureVault();
    const layouts = new Map<VaultPath, Layout | 'broken'>([
      [SLIDES, ['vision']],
      [HANDOUT, ['text']],
    ]);
    const store = storeOver(vault, layouts);
    await store.load();
    await census(vault, store);
    store.recordReading(imageReading(SLIDES, 1, { kind: 'unreadable', reason: 'not-legible' }));
    await store.idle();

    const section = await census(vault, store);
    expect(unreadableOf(section, SLIDES)).toBe('image-only-no-text');
    expect(section.notYetReadFiles).toEqual([]);
  });

  it('a source no extractor can open keeps the census own verdict: nothing is recorded for it', async () => {
    const vault = fixtureVault();
    const layouts = new Map<VaultPath, Layout | 'broken'>([[HANDOUT, ['text']]]);
    const store = storeOver(vault, layouts);
    await store.load();

    const section = await census(vault, store);
    expect(unreadableOf(section, SLIDES)).toBe('image-only-no-text');
    expect(section.notYetReadFiles).not.toContain(SLIDES);
  });

  it('a file the census does not link is decided as before, and never asked of the store', async () => {
    const vault = fixtureVault();
    vault.put('03 Research/TESTC101 Scanned Handout.png', new Uint8Array([0xff, 0xd8]));
    const asked: VaultPath[] = [];
    const layouts = new Map<VaultPath, Layout | 'broken'>([[SLIDES, ['vision']]]);
    const store = storeOver(vault, layouts);
    await store.load();
    const provider = createLocalGroveProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      unitManifests: (paths) => {
        asked.push(...paths);
        return store.manifestsFor(paths);
      },
    });
    const state = await provider.load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const section = state.courses.find((c) => c.course === 'TESTC101');
    expect(
      section?.unreadableFiles.find((f) => f.path.endsWith('Scanned Handout.png'))?.reason,
    ).toBe('not-linked');
    expect(section?.notYetReadFiles ?? []).not.toContain(
      '03 Research/TESTC101 Scanned Handout.png',
    );
    expect(asked).not.toContain('03 Research/TESTC101 Scanned Handout.png');
    expect(asked).not.toContain('03 Research/Objectives.md');
    expect(asked.sort()).toEqual([HANDOUT, SLIDES].sort());
  });

  describe('deletion and rebuild, through the census', () => {
    async function readInFull(): Promise<{
      vault: EventedTestVault;
      layouts: Map<VaultPath, Layout | 'broken'>;
    }> {
      const vault = fixtureVault();
      const layouts = new Map<VaultPath, Layout | 'broken'>([
        [SLIDES, ['text', 'vision']],
        [HANDOUT, ['text', 'text']],
      ]);
      const store = storeOver(vault, layouts);
      await store.load();
      await census(vault, store);
      store.recordReading(imageReading(SLIDES, 2, READ_BY_IMAGE));
      await store.idle();
      const settled = await census(vault, store);
      expect(settled.notYetReadFiles).toEqual([]);
      expect(unreadableOf(settled, SLIDES)).toBeUndefined();
      return { vault, layouts };
    }

    function deleteTheFolder(vault: EventedTestVault): void {
      const day = isoWithLocalOffset(NOW).slice(0, 10);
      void vault.delete?.(unitManifestLogPath(day, DEVICE));
      expect(vault.paths().some((p) => p.startsWith('.olea/unit-manifests/'))).toBe(false);
    }

    it('right after the deletion no source is shown read: the store that has not rebuilt yet reports both as not read yet', async () => {
      const { vault, layouts } = await readInFull();
      deleteTheFolder(vault);

      const fresh = storeOver(vault, layouts);
      const beforeLoad = await census(vault, fresh);
      expect(beforeLoad.notYetReadFiles?.slice().sort()).toEqual([HANDOUT, SLIDES].sort());
      expect(unreadableOf(beforeLoad, SLIDES)).toBeUndefined();
      expect(unreadableOf(beforeLoad, HANDOUT)).toBeUndefined();
    });

    it('once rebuilt, the source whose image page was read is not-read-yet again and the text-only source is read', async () => {
      const { vault, layouts } = await readInFull();
      deleteTheFolder(vault);

      const fresh = storeOver(vault, layouts);
      await fresh.load();
      const rebuilt = await census(vault, fresh);
      expect(rebuilt.notYetReadFiles).toEqual([SLIDES]);
      expect(rebuilt.notYetReadFiles).not.toContain(HANDOUT);
    });
  });
});
