/**
 * Presentation checks a question's own cited passage against its current text
 * (`ol-egov.141.89.5.72`, `[D-514]` item c): an edit made after the last batch pass and before
 * the next must withhold the question at its next presentation, with nothing written. Real
 * citation store over an in-memory host, real baseline pass, synthetic text only.
 */
import {
  citationStorePath,
  digestPassage,
  type EnqueueInput,
  enumerateVaultInstruments,
  type ListOptions,
  type Unsubscribe,
  type VaultEvent,
  type VaultInstrumentRecord,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianCitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../src/ingestion/materiality/citation-revision-wiring.js';
import { sourceCheckAtPresentation } from '../../src/review/open-session.js';

class MemoryVaultSource implements VaultSource {
  readonly files = new Map<string, string>();
  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, content);
  }
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const extensions = options.extensions?.map((e) => e.toLowerCase());
    return [...this.files.keys()]
      .filter((p) => {
        if (extensions === undefined) return true;
        return extensions.includes(p.slice(p.lastIndexOf('.') + 1).toLowerCase());
      })
      .sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`MemoryVaultSource.read: not found: ${path}`);
    return content;
  }
  async readBinary(): Promise<Uint8Array> {
    throw new Error('not needed');
  }
  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

const HOME_PATH = 'Zettel/Weathering rates (Olea).md';
const SOURCE_PATH = 'Zettel/Weathering rates.md';
const OTHER_PATH = 'Zettel/Erosion.md';
const MCQ_ID = 'q1';

const BASALT = 'Basalt weathers quickly in humid climates.';
const GRANITE = 'Granite resists weathering far better than basalt does.';
const QUARTZ = 'It is dominated by quartz and feldspar.';
const LIMESTONE = 'Limestone dissolves in weak acid.';
/** The cited passage: a two-line block. */
const PASSAGE = `${GRANITE}\n${QUARTZ}`;

function sourceNote(...blocks: string[]): string {
  return ['# Weathering rates', '', ...blocks.flatMap((block) => [block, '']), ''].join('\n');
}

const SOURCE_TEXT = sourceNote(BASALT, PASSAGE, LIMESTONE);

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

function sidecar(passageDigest: string | undefined): string {
  return `${JSON.stringify(
    {
      instrumentId: MCQ_ID,
      sourcePath: SOURCE_PATH,
      page: 1,
      ...(passageDigest !== undefined ? { passageDigest } : {}),
      schemaVersion: 2,
    },
    null,
    2,
  )}\n`;
}

function actions() {
  return {
    enqueue: vi.fn(async (_input: EnqueueInput) => undefined),
    suspend: vi.fn(async () => undefined),
    onRelocationProposed: vi.fn(),
  };
}

async function setup(options: { digest?: boolean; sourceText?: string } = {}) {
  const useDigest = options.digest ?? true;
  const vault = new MemoryVaultSource({
    [HOME_PATH]: homeNote(),
    [SOURCE_PATH]: options.sourceText ?? SOURCE_TEXT,
    [citationStorePath(MCQ_ID)]: sidecar(useDigest ? await digestPassage(PASSAGE) : undefined),
  });
  const store = new ObsidianCitationHashStore(new FakeDataHost());
  // The batch pass baselines the anchor; the session opens (records frozen) after it.
  await new CitationRevisionTrigger({ store, judge: null, clock: { now: () => 1 } }).tick(
    vault,
    actions(),
  );
  const records = (await enumerateVaultInstruments(vault, { concepts: { stampConceptKeys: true } }))
    .records;
  const check = sourceCheckAtPresentation(store, undefined, {
    vault,
    recordOf: (id: string): VaultInstrumentRecord | undefined =>
      records.find((record) => record.instrumentId === id),
  });
  return { vault, store, check };
}

describe('presentation checks the cited passage against its current text', () => {
  it('an unedited passage reads clear', async () => {
    const { check } = await setup();
    expect(await check(MCQ_ID)).toBe('clear');
  });

  it('an edit to the cited passage after the last pass withholds the question, writing nothing', async () => {
    const { vault, store, check } = await setup();
    const saved = vi.spyOn(store, 'save');
    const pending = vi.spyOn(store, 'setPendingRevalidation');
    const removed = vi.spyOn(store, 'remove');
    const before = JSON.stringify([...(await store.loadAll())]);
    await vault.write(
      SOURCE_PATH,
      sourceNote(BASALT, `${GRANITE}\nIt is dominated by olivine and pyroxene.`, LIMESTONE),
    );
    expect(await check(MCQ_ID)).toBe('check-failed');
    expect(saved).not.toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
    expect(JSON.stringify([...(await store.loadAll())])).toBe(before);
  });

  it('the same holds at whole-note grain (a citation with no passage digest)', async () => {
    const { vault, check } = await setup({ digest: false });
    expect(await check(MCQ_ID)).toBe('clear');
    await vault.write(SOURCE_PATH, sourceNote(BASALT, PASSAGE, 'Limestone is a sedimentary rock.'));
    expect(await check(MCQ_ID)).toBe('check-failed');
  });

  it('a formatting-only edit (whitespace, paired emphasis) still shows the question', async () => {
    const { vault, check } = await setup();
    await vault.write(
      SOURCE_PATH,
      sourceNote(BASALT, `${GRANITE.replace('Granite', '**Granite**')}  \n${QUARTZ}`, LIMESTONE),
    );
    expect(await check(MCQ_ID)).toBe('clear');
  });

  it('an edit elsewhere in the source note still shows the question', async () => {
    const { vault, check } = await setup();
    await vault.write(
      SOURCE_PATH,
      sourceNote('Basalt weathers slowly when dry.', PASSAGE, LIMESTONE),
    );
    expect(await check(MCQ_ID)).toBe('clear');
  });

  it('a passage moved within its note, or to another note, still shows the question', async () => {
    const { vault, check } = await setup();
    await vault.write(SOURCE_PATH, sourceNote(PASSAGE, BASALT, LIMESTONE));
    expect(await check(MCQ_ID)).toBe('clear');
    await vault.write(SOURCE_PATH, sourceNote(BASALT, LIMESTONE));
    await vault.write(OTHER_PATH, sourceNote(PASSAGE));
    expect(await check(MCQ_ID)).toBe('clear');
  });

  it('an unreadable source withholds', async () => {
    const { vault, check } = await setup({ digest: false });
    vault.files.delete(SOURCE_PATH);
    expect(await check(MCQ_ID)).toBe('check-failed');
  });

  it('a read that throws withholds (fail closed)', async () => {
    const { vault, check } = await setup();
    vi.spyOn(vault, 'read').mockRejectedValue(new Error('io'));
    expect(await check(MCQ_ID)).toBe('check-failed');
  });

  it('a passage that is gone or stands twice withholds', async () => {
    const { vault, check } = await setup();
    await vault.write(SOURCE_PATH, sourceNote(BASALT, LIMESTONE));
    expect(await check(MCQ_ID)).toBe('check-failed');
    await vault.write(SOURCE_PATH, sourceNote(PASSAGE, LIMESTONE, PASSAGE));
    expect(await check(MCQ_ID)).toBe('check-failed');
  });

  it('an instrument with no anchor record reads clear (never baselined: nothing to compare)', async () => {
    const { check } = await setup();
    expect(await check('not-tracked')).toBe('clear');
  });
});
