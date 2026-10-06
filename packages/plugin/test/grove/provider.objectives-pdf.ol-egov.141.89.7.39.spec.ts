/**
 * The grove counts the concepts a registered objectives PDF names (F8.1, F1.5; ol-egov.141.89.7.39,
 * ruled 2026-10-04): the PDF is cited as the examiner's own declaration, so its named concepts
 * become declared scope, and nothing about her readiness or learning changes because of it.
 *
 * Every string is INVENTED (INV-3). The PDF is a real one parsed by the real extractor.
 */
import { appendSourceRegisteredRecord, buildRegistryModel, type VaultSource } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createLocalGroveProvider } from '../../src/grove/provider.js';
import type { GroveViewState } from '../../src/grove/view.js';
import {
  ASSIGNMENTS_BASE_PATH,
  buildPdfBytes,
  CONCEPT,
  COURSE,
  DEVICE,
  FakeSettingsHost,
  NOW,
} from '../oracle/registered-past-paper-fixture.js';
import { memoryVault } from '../review/memory-vault.js';

vi.mock('olea-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('olea-core')>();
  return { ...actual, buildRegistryModel: vi.fn(actual.buildRegistryModel) };
});

const OBJECTIVES_PDF = 'Objectives/TESTC101 Objectives.pdf';

async function vaultWithObjectivesPdf(registered: boolean): Promise<VaultSource> {
  const base = memoryVault({
    [`05 Zettelkasten/${CONCEPT}.md`]: `# ${CONCEPT}\n`,
    'Notes/one.md': `---\ntopic: [${CONCEPT}]\ncourse: ${COURSE}\n---\n\nFront::Back\n`,
    [ASSIGNMENTS_BASE_PATH]:
      'filters:\n  and:\n    - file.inFolder("02 Assignments")\nproperties:\n  class:\n  type:\n  weight:\n  due:\n  status:',
    '02 Assignments/Quiz 1.md': `---\nclass: ${COURSE}\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n`,
  });
  const pdf = buildPdfBytes(`By the end of the course you can explain ${CONCEPT}.`);
  const vault: VaultSource = {
    list: async (options) => {
      const exts = options?.extensions?.map((ext) => ext.toLowerCase());
      const under = options?.under;
      const pdfListed =
        (exts === undefined || exts.includes('pdf')) &&
        (under === undefined || OBJECTIVES_PDF.startsWith(`${under}/`));
      return [...(await base.list(options)), ...(pdfListed ? [OBJECTIVES_PDF] : [])].sort();
    },
    read: (path) => base.read(path),
    readBinary: async (path) => (path === OBJECTIVES_PDF ? pdf : base.readBinary(path)),
    write: (path, content) => base.write(path, content),
    exists: async (path) => path === OBJECTIVES_PDF || base.exists(path),
    watch: (handler) => base.watch(handler),
  };
  if (registered) {
    await appendSourceRegisteredRecord(
      vault,
      {
        timestamp: '2026-07-01T09:00:00.000-04:00',
        path: OBJECTIVES_PDF,
        role: 'objectives',
        course: COURSE,
      },
      { deviceId: DEVICE },
    );
  }
  return vault;
}

async function loadModel(registered: boolean) {
  const provider = createLocalGroveProvider({
    vault: await vaultWithObjectivesPdf(registered),
    deviceId: DEVICE,
    settingsHost: new FakeSettingsHost(),
    now: () => NOW,
  });
  const state: GroveViewState = await provider.load();
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  const section = state.courses.find((c) => c.course === COURSE);
  if (section === undefined) throw new Error('expected the course section');
  const registry = vi.mocked(buildRegistryModel).mock.results.at(-1)?.value;
  return { model: section.model, registry };
}

describe('the grove and a registered objectives PDF (F8.1, ol-egov.141.89.7.39)', () => {
  it('declares the concept the PDF names once its registration event is in the log', async () => {
    const { model } = await loadModel(true);
    if (model.status !== 'declared') throw new Error(`expected declared, got ${model.status}`);
    expect(model.cells.map((cell) => cell.conceptName)).toEqual([CONCEPT]);
    expect(model.summary.denominatorSourcePaths).toEqual([OBJECTIVES_PDF]);
  });

  it('declares nothing from the same PDF without the registration event', async () => {
    const { model } = await loadModel(false);
    expect(model.status).toBe('inferred');
  });

  it('declaring scope changes no per-concept readiness or learning reading', async () => {
    const withEvent = await loadModel(true);
    const without = await loadModel(false);
    // A concept key is minted per load; everything else about her concepts must be identical.
    const readings = (registry: { concepts: unknown }) =>
      JSON.parse(JSON.stringify(registry.concepts).replace(/concept-key1:[0-9a-f-]+/g, 'KEY'));
    expect(readings(withEvent.registry)).toEqual(readings(without.registry));
  });
});
