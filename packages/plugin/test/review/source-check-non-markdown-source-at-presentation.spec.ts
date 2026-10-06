/**
 * `ol-egov.141.89.5.73` ([D-515]): presentation withholds a question built on a non-markdown source
 * (PDF, slides, document) unless the file's current bytes hash to the `sourceRevision` its citation
 * sidecar recorded. Synthetic bytes only; real sidecar parse, real record enumeration.
 */
import {
  citationStorePath,
  enumerateVaultInstruments,
  hashContent,
  type ListOptions,
  type Unsubscribe,
  type VaultEvent,
  type VaultInstrumentRecord,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import type { DraftRecord } from '../../src/generation/types.js';
import { ObsidianCitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import {
  draftSourceCheckAtPresentation,
  sourceCheckAtPresentation,
} from '../../src/review/open-session.js';

class MemoryVault implements VaultSource {
  readonly files = new Map<string, string>();
  readonly binaries = new Map<string, Uint8Array>();
  unreadable = new Set<string>();
  readBinaryCalls = 0;
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const ext = options.extensions?.map((e) => e.toLowerCase());
    return [...this.files.keys()]
      .filter((p) => ext === undefined || ext.includes(p.slice(p.lastIndexOf('.') + 1)))
      .sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    this.readBinaryCalls += 1;
    if (this.unreadable.has(path)) throw new Error('read failed');
    const bytes = this.binaries.get(path);
    if (bytes === undefined) throw new Error(`not found: ${path}`);
    return bytes;
  }
  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path) || this.binaries.has(path);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

const HOME = 'Zettel/Weathering rates (Olea).md';
const PDF = 'Sources/lecture-3.pdf';
const MCQ_ID = 'q1';
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);
const CHANGED = new Uint8Array([1, 2, 3, 4, 6]);

function homeNote(): string {
  return [
    '---',
    'topic: [Weathering rates]',
    'course: GEO101',
    '---',
    '',
    '```olea-mcq',
    `id: ${MCQ_ID}`,
    'stem: Which mineral is most weathering-resistant?',
    'answer: Quartz',
    'distractor: Olivine',
    'distractor: Feldspar',
    'distractor: Biotite',
    'distractor: Calcite',
    '```',
    '',
  ].join('\n');
}

function sidecar(sourcePath: string, sourceRevision: string | undefined): string {
  return JSON.stringify({
    instrumentId: MCQ_ID,
    sourcePath,
    page: 2,
    ...(sourceRevision !== undefined ? { sourceRevision } : {}),
    schemaVersion: 2,
  });
}

async function setup(
  options: {
    sourcePath?: string;
    revision?: string | undefined | 'good';
    withStore?: boolean;
  } = {},
) {
  const sourcePath = options.sourcePath ?? PDF;
  const revision =
    options.revision === 'good' || !('revision' in options)
      ? await hashContent(BYTES)
      : options.revision;
  const vault = new MemoryVault();
  vault.files.set(HOME, homeNote());
  vault.files.set(citationStorePath(MCQ_ID), sidecar(sourcePath, revision));
  if (sourcePath.endsWith('.md')) vault.files.set(sourcePath, '# Source\n\nText.\n');
  else vault.binaries.set(sourcePath, BYTES);
  const records = (await enumerateVaultInstruments(vault, { concepts: { stampConceptKeys: true } }))
    .records;
  const reader = {
    vault,
    recordOf: (id: string): VaultInstrumentRecord | undefined =>
      records.find((record) => record.instrumentId === id),
  };
  const store =
    (options.withStore ?? true)
      ? new ObsidianCitationHashStore({
          loadData: async () => ({}),
          saveData: async () => undefined,
        })
      : undefined;
  return { vault, check: sourceCheckAtPresentation(store, undefined, reader) };
}

describe('presentation checks a non-markdown source by its file bytes ([D-515])', () => {
  for (const withStore of [true, false]) {
    const mode = withStore ? 'with a citation store' : 'with no citation store';
    it(`${mode}: an unchanged file shows the question`, async () => {
      const { check } = await setup({ withStore });
      expect(await check(MCQ_ID)).toBe('clear');
    });
    it(`${mode}: changed bytes withhold it`, async () => {
      const { vault, check } = await setup({ withStore });
      vault.binaries.set(PDF, CHANGED);
      expect(await check(MCQ_ID)).toBe('check-failed');
    });
    it(`${mode}: a missing sourceRevision withholds it`, async () => {
      const { check } = await setup({ withStore, revision: undefined });
      expect(await check(MCQ_ID)).toBe('check-failed');
    });
    it(`${mode}: a missing file withholds it`, async () => {
      const { vault, check } = await setup({ withStore });
      vault.binaries.delete(PDF);
      expect(await check(MCQ_ID)).toBe('check-failed');
    });
    it(`${mode}: an unreadable file withholds it`, async () => {
      const { vault, check } = await setup({ withStore });
      vault.unreadable.add(PDF);
      expect(await check(MCQ_ID)).toBe('check-failed');
    });
  }

  it('an unreadable sidecar withholds it', async () => {
    const { vault, check } = await setup();
    vault.files.set(citationStorePath(MCQ_ID), '{not json');
    expect(await check(MCQ_ID)).toBe('check-failed');
  });

  it('a markdown source is unaffected: no byte read, no sourceRevision needed', async () => {
    const { vault, check } = await setup({ sourcePath: 'Zettel/Source.md', revision: undefined });
    expect(await check(MCQ_ID)).toBe('clear');
    expect(vault.readBinaryCalls).toBe(0);
  });

  it('each presentation reads the file afresh (no cache): one read per call', async () => {
    const { vault, check } = await setup();
    await check(MCQ_ID);
    await check(MCQ_ID);
    expect(vault.readBinaryCalls).toBe(2);
    vault.binaries.set(PDF, CHANGED);
    expect(await check(MCQ_ID)).toBe('check-failed');
  });

  it('writes nothing', async () => {
    const { vault, check } = await setup();
    const write = vi.spyOn(vault, 'write');
    vault.binaries.set(PDF, CHANGED);
    await check(MCQ_ID);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('a pending draft on a non-markdown source is checked against its own citation ([D-515])', () => {
  async function draftSetup(citation: DraftRecord['sourceCitation'], sourcePath = 'Zettel/N.md') {
    const vault = new MemoryVault();
    vault.binaries.set(PDF, BYTES);
    const record = { draftId: 'd1', sourcePath, sourceCitation: citation } as DraftRecord;
    return { vault, check: draftSourceCheckAtPresentation(vault, [record]) };
  }
  const cite = (sourceRevision?: string) => ({
    sourcePath: PDF,
    page: 1,
    ...(sourceRevision !== undefined ? { sourceRevision } : {}),
  });

  it('unchanged shows; changed, absent revision, missing and unreadable do not', async () => {
    const good = await hashContent(BYTES);
    const a = await draftSetup(cite(good));
    expect(await a.check('d1')).toBe('clear');
    a.vault.binaries.set(PDF, CHANGED);
    expect(await a.check('d1')).toBe('check-failed');
    expect(await (await draftSetup(cite())).check('d1')).toBe('check-failed');
    const m = await draftSetup(cite(good));
    m.vault.binaries.delete(PDF);
    expect(await m.check('d1')).toBe('check-failed');
    const u = await draftSetup(cite(good));
    u.vault.unreadable.add(PDF);
    expect(await u.check('d1')).toBe('check-failed');
  });

  it("a markdown source, no citation, or an unknown draft id is not this check's to withhold", async () => {
    expect(await (await draftSetup({ sourcePath: 'Zettel/Other.md', page: 1 })).check('d1')).toBe(
      'clear',
    );
    expect(await (await draftSetup(undefined)).check('d1')).toBe('clear');
    expect(await (await draftSetup(cite())).check('other')).toBe('clear');
  });
});
