/**
 * [D-491] (`ol-egov.141.89.1.90`) — the evidence-loop invariant: no Olea-generated instrument and
 * no home-note scaffolding ever supplies course evidence, while her own lines around them still do.
 *
 * The planted instruments are real parsed ones (a `::` card and an `olea-mcq` block, as
 * `parseCards`/`parseMcqBlocks` read them), built in memory here — never added to the fixture vault,
 * whose course and concept counts other suites pin.
 */

import { describe, expect, it } from 'vitest';
import { gatherPassages } from '../concept/read.js';
import { parseCards } from '../instrument/card-format.js';
import { parseMcqBlocks } from '../instrument/mcq-format.js';
import { chunksFromIndex } from '../retrieval/chunks.js';
import { EmbeddingCacheEngine } from '../retrieval/embeddingCache.js';
import { retrieve } from '../retrieval/engine.js';
import type {
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
  PersistedEmbeddingCache,
} from '../retrieval/types.js';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import { buildFullIndex } from './build.js';
import { indexDocument } from './document.js';
import { KeywordIndexEngine } from './engine.js';
import { generatedSpansOfSource } from './evidence-scope.js';
import { searchKeywordIndex } from './query.js';
import type { KeywordIndexStore, PersistedKeywordIndex } from './types.js';

class MemoryVault implements VaultSource {
  constructor(readonly files: Map<string, string>) {}
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    let paths = [...this.files.keys()];
    if (options.extensions !== undefined) {
      const exts = options.extensions;
      paths = paths.filter((p) => exts.includes(p.slice(p.lastIndexOf('.') + 1)));
    }
    if (options.under !== undefined) {
      const under = options.under;
      paths = paths.filter((p) => p === under || p.startsWith(`${under}/`));
    }
    return paths.sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }
  async readBinary(): Promise<Uint8Array> {
    throw new Error('not used');
  }
  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }
  watch(): Unsubscribe {
    return () => {};
  }
}

// Distinctive words, so a hit on one is unambiguous. None is real vault content.
const CARD_QUESTION = 'What is the tidegate quorum for a skerry berth?';
const CARD_ANSWER = 'zorblax';
const MCQ_STEM = 'Which pennant flags a quillon harbour?';
const MCQ_ANSWER = 'plinthwort';
const HER_LINE_BEFORE = 'My own note: tidegate rules confused me in week two.';
const HER_LINE_AFTER = 'Afterwards I wrote that the pennant colours matter for quillon harbours.';
const SCAFFOLD_WORD = 'renameable';

const HER_NOTE = [
  '---',
  'topic:',
  '  - Tidegates',
  '---',
  '',
  HER_LINE_BEFORE,
  '',
  `${CARD_QUESTION} :: ${CARD_ANSWER}`,
  '',
  '```olea-mcq',
  `stem: ${MCQ_STEM}`,
  `answer: ${MCQ_ANSWER}`,
  'distractor: gantryroot',
  'distractor: voltmarsh',
  '```',
  '',
  HER_LINE_AFTER,
  '',
].join('\n');

const HOME_NOTE = [
  '---',
  'topic:',
  '  - Tidegates',
  'olea-home-note: true',
  '---',
  '',
  '*Olea created this note beside `Slides.pdf`, to keep generated practice out of it directly.',
  "Generated quiz items land here on acceptance. This note is Olea's own layer (INV-6) —",
  'renameable and prunable like anything else Olea writes without asking.*',
  '',
  'I added this line myself: tidegate quorums were the hard part of the slides.',
  '',
  '```olea-mcq',
  `stem: ${MCQ_STEM}`,
  `answer: ${MCQ_ANSWER}`,
  'distractor: gantryroot',
  'distractor: voltmarsh',
  '```',
  '',
  'My own follow-up: the quorum seems to depend on the berth mark.',
  '',
].join('\n');

function plantedVault(): MemoryVault {
  return new MemoryVault(
    new Map([
      ['01 Courses/TIDE101/Her note.md', HER_NOTE],
      ['01 Courses/TIDE101/Slides.md', HOME_NOTE],
    ]),
  );
}

describe('the planted fixture is real instrument syntax (guards the test itself)', () => {
  it('parses the card and the quiz in her note, and the quiz in the home note', () => {
    expect(parseCards(HER_NOTE).filter((c) => c.type === 'qa')).toHaveLength(1);
    expect(parseMcqBlocks(HER_NOTE).instruments).toHaveLength(1);
    expect(parseMcqBlocks(HOME_NOTE).instruments).toHaveLength(1);
    expect(generatedSpansOfSource(HER_NOTE).map((s) => s.kind)).toEqual([
      'instrument',
      'instrument',
    ]);
    expect(generatedSpansOfSource(HOME_NOTE).map((s) => s.kind)).toEqual([
      'scaffold',
      'scaffold',
      'instrument',
    ]);
  });
});

function indexTextOf(index: PersistedKeywordIndex): string {
  return index.documents.flatMap((d) => d.blocks.map((b) => b.text)).join('\n');
}

describe("indexDocument excludes Olea's own layer at span level ([D-491])", () => {
  it('keeps her lines around an item in her note, and drops the item', async () => {
    const doc = await indexDocument(plantedVault(), '01 Courses/TIDE101/Her note.md');
    const text = doc.blocks.map((b) => b.text).join('\n');
    expect(text).toContain(HER_LINE_BEFORE);
    expect(text).toContain(HER_LINE_AFTER);
    for (const planted of [CARD_QUESTION, CARD_ANSWER, MCQ_STEM, MCQ_ANSWER]) {
      expect(text).not.toContain(planted);
    }
    expect(doc.evidenceScope).toBe(1);
  });

  it('keeps her text in a home note, and drops its scaffolding paragraph and its quiz', async () => {
    const doc = await indexDocument(plantedVault(), '01 Courses/TIDE101/Slides.md');
    const text = doc.blocks.map((b) => b.text).join('\n');
    expect(text).toContain('I added this line myself');
    expect(text).toContain('My own follow-up');
    expect(text).not.toContain(SCAFFOLD_WORD);
    expect(text).not.toContain(MCQ_STEM);
    expect(text).not.toContain('olea-home-note');
    expect(doc.blocks.length).toBe(2);
  });

  it('cuts only the item out of a block that mixes her prose with an item', async () => {
    const mixed = new MemoryVault(
      new Map([['mixed.md', `Her sentence stays here.\n${CARD_QUESTION} :: ${CARD_ANSWER}\n`]]),
    );
    const doc = await indexDocument(mixed, 'mixed.md');
    const text = doc.blocks.map((b) => b.text).join('\n');
    expect(text).toContain('Her sentence stays here.');
    expect(text).not.toContain(CARD_ANSWER);
  });

  it('indexes a note with no Olea layer exactly as before (no span, no change)', async () => {
    const plain = new MemoryVault(new Map([['p.md', '# H\n\nProse here.\n\n- a\n- b\n']]));
    const doc = await indexDocument(plain, 'p.md');
    expect(doc.blocks.map((b) => b.text)).toEqual(['H', 'Prose here.', 'a\nb']);
  });
});

describe('the evidence invariant: a planted item never supplies grounding or evidence ([D-491])', () => {
  class MemStore implements KeywordIndexStore {
    saved: PersistedKeywordIndex | null = null;
    async load() {
      return this.saved;
    }
    async save(index: PersistedKeywordIndex) {
      this.saved = index;
    }
  }
  class MemEmbedStore implements EmbeddingCacheStore {
    async load(): Promise<PersistedEmbeddingCache | null> {
      return null;
    }
    async save(): Promise<void> {}
  }
  const provider: EmbeddingProvider = {
    async embed(request: EmbedRequest): Promise<EmbedResult> {
      return {
        vectors: request.texts.map((text) => {
          const v = new Array<number>(16).fill(0.1);
          for (const word of text.toLowerCase().split(/\W+/)) {
            let h = 0;
            for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % 16;
            v[h] = (v[h] ?? 0) + 1;
          }
          return v;
        }),
      };
    },
  };

  it('retrieval: keyword search, chunks and the grounded result carry her lines and no item', async () => {
    const built = await buildFullIndex({ vault: plantedVault() });
    if (built.status !== 'complete') throw new Error('build did not complete');
    const index = built.index;

    // The planted item's own words find nothing in the keyword index.
    for (const planted of [CARD_ANSWER, MCQ_ANSWER, 'gantryroot', 'voltmarsh', SCAFFOLD_WORD]) {
      expect(searchKeywordIndex(index, planted)).toEqual([]);
    }
    expect(indexTextOf(index)).not.toMatch(/zorblax|plinthwort|gantryroot|voltmarsh|renameable/);
    const chunkTexts = (await chunksFromIndex(index)).map((c) => c.text).join('\n');
    expect(chunkTexts).not.toMatch(/zorblax|plinthwort|gantryroot|voltmarsh|renameable/);

    // Her surrounding lines still ground.
    const embeddingCache = await EmbeddingCacheEngine.create({
      store: new MemEmbedStore(),
      provider,
      model: 'fake-model-v1',
    });
    const result = await retrieve(
      { keywordIndex: index, embeddingCache, embeddingProvider: provider },
      'tidegate quorum skerry berth zorblax',
    );
    expect(result.status).toBe('grounded');
    if (result.status === 'grounded') {
      const grounded = result.chunks.map((c) => c.text).join('\n');
      expect(grounded).toContain('tidegate');
      expect(grounded).not.toMatch(/zorblax|plinthwort|gantryroot|voltmarsh|renameable/);
    }
  });

  it('retrieval refuses when the only matching text is a planted item', async () => {
    const only = new MemoryVault(new Map([['x.md', `${CARD_QUESTION} :: ${CARD_ANSWER}\n`]]));
    const built = await buildFullIndex({ vault: only });
    if (built.status !== 'complete') throw new Error('build did not complete');
    expect(searchKeywordIndex(built.index, CARD_ANSWER)).toEqual([]);
    const embeddingCache = await EmbeddingCacheEngine.create({
      store: new MemEmbedStore(),
      provider,
      model: 'fake-model-v1',
    });
    const result = await retrieve(
      { keywordIndex: built.index, embeddingCache, embeddingProvider: provider },
      `${CARD_QUESTION} ${CARD_ANSWER}`,
    );
    expect(result.status).toBe('refused');
  });

  it('concept reading: gatherPassages offers her lines and never an item or the scaffolding', async () => {
    const passages = await gatherPassages(plantedVault());
    const text = passages.map((p) => p.text).join('\n');
    expect(text).toContain(HER_LINE_BEFORE);
    expect(text).toContain(HER_LINE_AFTER);
    expect(text).toContain('I added this line myself');
    expect(text).toContain('My own follow-up');
    expect(text).not.toMatch(/zorblax|plinthwort|gantryroot|voltmarsh|renameable|olea-home-note/);
  });

  it('a cache persisted before the exclusion is discarded and rebuilt, never served', async () => {
    const store = new MemStore();
    store.saved = {
      version: 1,
      documents: [
        {
          path: 'old.md',
          courses: [],
          contentHash: 'h',
          blocks: [
            { blockIndex: 0, kind: 'paragraph', text: `${CARD_QUESTION} :: ${CARD_ANSWER}` },
          ],
        },
      ],
    };
    const engine = await KeywordIndexEngine.create({ vault: plantedVault(), store });
    expect(engine.toPersisted().documents).toEqual([]);
    await engine.rebuild();
    expect(indexTextOf(engine.toPersisted())).not.toContain(CARD_ANSWER);
  });
});
