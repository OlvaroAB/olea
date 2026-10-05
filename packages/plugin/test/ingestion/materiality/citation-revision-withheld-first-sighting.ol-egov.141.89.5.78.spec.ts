/**
 * `ol-egov.141.89.5.78` ([D-514] item a, [D-508]): an anchor withheld at first sighting (empty text,
 * the citation's digest, a pending fact with a passage reason) is re-tried by its stored digest on
 * every later pass. A digest match is identical text: a code exit, no judge call. Synthetic text only.
 *
 * (Fixtures copied from citation-revision-passage-grain.spec.ts, whose header follows.)
 * Passage-grain citation revision (`[D-446]` option (a), `ol-egov.141.89.5.32`).
 *
 * The bug: the citation batch pass compared the WHOLE source note, so an edit anywhere in the
 * note put every instrument citing it in front of the judge, and a cited passage that merely moved
 * asked the judge about a pair the targets do not name. The fix: an instrument whose citation
 * carries a passage digest is baselined AT that passage, and each pass finds the passage again by
 * the shared segmentation rule (`olea-core`'s `source/passage-identity.ts`).
 *
 * Row 42 (2026-09-29) asks for moved passages, duplicate passages and segmentation-rule changes to
 * be demonstrated, an ambiguous case to stay unresolved and never be guessed. Row 45 asks that an
 * unresolved or unavailable result withhold protectively while keeping its actual reason, never
 * reading as a claim that a material change was established. Each block below is one of those.
 *
 * Real `ObsidianCitationHashStore` over a fake data host, real `enumerateVaultInstruments`, a
 * scripted judge: the same seams the plugin composes, no `obsidian` import.
 */
import {
  citationStorePath,
  digestPassage,
  type EnqueueInput,
  type ListOptions,
  PASSAGE_RULE_V1,
  type PassageRule,
  type RevisionJudgePort,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  type CitationAnchorRecord,
  ObsidianCitationHashStore,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../../src/ingestion/materiality/citation-revision-wiring.js';

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
const THIRD_PATH = 'Zettel/Soils.md';
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

async function fixture(
  options: {
    sourceText?: string;
    passage?: string | undefined;
    digest?: string | undefined;
    extra?: Record<string, string>;
  } = {},
) {
  const passage = 'passage' in options ? options.passage : PASSAGE;
  const digest = 'digest' in options ? options.digest : passage && (await digestPassage(passage));
  const vault = new MemoryVaultSource({
    [HOME_PATH]: homeNote(),
    [SOURCE_PATH]: options.sourceText ?? SOURCE_TEXT,
    [citationStorePath(MCQ_ID)]: sidecar(digest),
    ...options.extra,
  });
  const store = new ObsidianCitationHashStore(new FakeDataHost());
  return { vault, store };
}

function actions() {
  return {
    enqueue: vi.fn(async (_input: EnqueueInput) => undefined),
    suspend: vi.fn(async () => undefined),
    onRelocationProposed: vi.fn(),
  };
}

function judgeSaying(material: boolean): RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } {
  return { judge: vi.fn(async () => ({ material, reason: 'scripted' })) };
}

function trigger(
  store: ObsidianCitationHashStore,
  judge: RevisionJudgePort | null,
  extra: { passageRules?: readonly PassageRule[]; isOnline?: () => boolean } = {},
) {
  return new CitationRevisionTrigger({ store, judge, clock: { now: () => 1_000 }, ...extra });
}

async function anchorOf(store: ObsidianCitationHashStore): Promise<CitationAnchorRecord> {
  const record = (await store.loadAll()).get(MCQ_ID);
  if (record === undefined) throw new Error('no anchor recorded');
  return record;
}

const MISSING_NOTE = sourceNote(BASALT, LIMESTONE);

/** Withheld at first sighting: the cited passage is not in its note. */
async function withheldAtFirstSighting(extra: Record<string, string> = {}) {
  const { vault, store } = await fixture({ sourceText: MISSING_NOTE, extra });
  const judge = judgeSaying(true);
  const t = trigger(store, judge);
  await t.tick(vault, actions());
  const anchor = await anchorOf(store);
  expect(anchor.text).toBe('');
  expect(anchor.pendingRevalidation?.reason).toBe('passage-missing');
  return { vault, store, judge, t };
}

describe('a withheld first-sighting anchor is released by its stored digest (ol-egov.141.89.5.78)', () => {
  it('a: the exact passage reappears in its note: seeded, fact cleared, no judge call, presentable', async () => {
    const { vault, store, judge, t } = await withheldAtFirstSighting();
    await vault.write(SOURCE_PATH, SOURCE_TEXT);
    const a = actions();
    await t.tick(vault, a);

    const anchor = await anchorOf(store);
    expect(anchor.text).toBe(PASSAGE);
    expect(anchor.sourcePath).toBe(SOURCE_PATH);
    expect(anchor.passageDigest).toBe(await digestPassage(PASSAGE));
    // No fact: nothing holds the question back from presentation.
    expect(anchor.pendingRevalidation).toBeUndefined();
    expect(judge.judge).not.toHaveBeenCalled();
    expect(a.suspend).not.toHaveBeenCalled();
    expect(a.enqueue).not.toHaveBeenCalled();

    // The next pass treats it as an ordinary tracked anchor.
    await t.tick(vault, actions());
    expect((await anchorOf(store)).pendingRevalidation).toBeUndefined();
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('b: the passage reappears with different text: stays withheld, reason unchanged, no judge call', async () => {
    const { vault, store, judge, t } = await withheldAtFirstSighting();
    await vault.write(
      SOURCE_PATH,
      sourceNote(BASALT, `${GRANITE}\nIt is dominated by quartz and mica.`, LIMESTONE),
    );
    await t.tick(vault, actions());

    const anchor = await anchorOf(store);
    expect(anchor.text).toBe('');
    expect(anchor.pendingRevalidation?.reason).toBe('passage-missing');
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('c: the passage reappears twice in its note: stays withheld as passage-ambiguous', async () => {
    const { vault, store, judge, t } = await withheldAtFirstSighting();
    await vault.write(SOURCE_PATH, sourceNote(PASSAGE, LIMESTONE, PASSAGE));
    await t.tick(vault, actions());

    const anchor = await anchorOf(store);
    expect(anchor.text).toBe('');
    expect(anchor.pendingRevalidation?.reason).toBe('passage-ambiguous');
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('d: the passage appears exactly in another note: the relocation heal seeds it there and clears the fact', async () => {
    const { vault, store, judge, t } = await withheldAtFirstSighting({
      [OTHER_PATH]: sourceNote('Erosion carries sediment.'),
    });
    await vault.write(OTHER_PATH, sourceNote('Erosion carries sediment.', PASSAGE));
    const a = actions();
    const report = await t.tick(vault, a);

    expect(report.relocated).toBe(1);
    const anchor = await anchorOf(store);
    expect(anchor.sourcePath).toBe(OTHER_PATH);
    expect(anchor.text).toBe(PASSAGE);
    expect(anchor.passageDigest).toBe(await digestPassage(PASSAGE));
    expect(anchor.pendingRevalidation).toBeUndefined();
    expect(judge.judge).not.toHaveBeenCalled();
    expect(a.suspend).not.toHaveBeenCalled();
  });

  it('d2: the passage standing in two other notes is not relocated to either: stays withheld as ambiguous', async () => {
    const { vault, store, t } = await withheldAtFirstSighting({
      [OTHER_PATH]: sourceNote('Erosion carries sediment.'),
      [THIRD_PATH]: sourceNote('Soils hold water.'),
    });
    await vault.write(OTHER_PATH, sourceNote(PASSAGE));
    await vault.write(THIRD_PATH, sourceNote(PASSAGE));
    await t.tick(vault, actions());

    const anchor = await anchorOf(store);
    expect(anchor.text).toBe('');
    expect(anchor.pendingRevalidation?.reason).toBe('passage-ambiguous');
  });

  it('e: a tracked (non-empty) anchor behaves as before: see citation-revision-passage-grain.spec.ts "the withholding lifts the pass the passage stands again" and "a passage that moves to another note heals there silently"', async () => {
    const { vault, store } = await fixture();
    const t = trigger(store, judgeSaying(true));
    await t.tick(vault, actions());
    await vault.write(SOURCE_PATH, MISSING_NOTE);
    await t.tick(vault, actions());
    const stranded = await anchorOf(store);
    expect(stranded.text).toBe(PASSAGE);
    expect(stranded.pendingRevalidation?.reason).toBe('passage-missing');
  });
});
