/**
 * `gatherCorpusRelationVaultContext` tests (`[EXT-11]`, `ol-kw4a`; passage-text
 * widening `ol-2zfj.64` [REL-5]).
 *
 * A minimal `VaultSource` fake — no `obsidian` import.
 */
import {
  type CorpusConcept,
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
  hashText,
  type ListOptions,
  type MisconceptionRecord,
  type PersistedEmbeddingCache,
  type RetrievalChunk,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  gatherCorpusRelationVaultContext,
  notePassageText,
  RELATIONS_ENDPOINT_CHAR_BUDGET,
  sectionPassageText,
} from '../../src/concept/corpusRelationSignals.js';

class MemoryVault implements VaultSource {
  constructor(private readonly files: Record<string, string>) {}
  list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const { under } = options;
    return Promise.resolve(
      Object.keys(this.files)
        .filter((p) => under === undefined || p.startsWith(under))
        .sort(),
    );
  }
  read(path: VaultPath): Promise<string> {
    const content = this.files[path];
    if (content === undefined) return Promise.reject(new Error(`no such file ${path}`));
    return Promise.resolve(content);
  }
  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.read(path).then((t) => new TextEncoder().encode(t));
  }
  write(): Promise<void> {
    return Promise.reject(new Error('read-only'));
  }
  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(path in this.files);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }
}

function concept(name: string, sourcePath: VaultPath, range: [number, number]): CorpusConcept {
  return {
    name,
    aliases: [],
    anchor: { sourcePath, location: { page: 1, charRange: { start: range[0], end: range[1] } } },
  };
}

describe('gatherCorpusRelationVaultContext — passage text (`ol-2zfj.64` [REL-5])', () => {
  it('the whole note passes through unchanged when it is under budget, no heading structure to key on', async () => {
    const note = '0123456789Type I error is a false positive.';
    const vault = new MemoryVault({ 'Note.md': note });
    const c = concept('Type I error', 'Note.md', [10, 43]);

    const { passageTextByName } = await gatherCorpusRelationVaultContext(vault, [c]);

    expect(passageTextByName.get('Type I error')).toBe(note);
  });

  it('the whole note passes through unchanged when under budget, INCLUDING a sibling heading a section-widener would exclude', async () => {
    const note = [
      '# Errors',
      '',
      '## Type I',
      '',
      'A Type I error is a false positive.',
      '',
      '## Type II',
      '',
      'A Type II error is a false negative.',
      '',
    ].join('\n');
    const anchorStart = note.indexOf('A Type I error');
    const anchorEnd = anchorStart + 'A Type I error is a false positive.'.length;
    const vault = new MemoryVault({ 'Note.md': note });
    const c = concept('Type I error', 'Note.md', [anchorStart, anchorEnd]);

    const { passageTextByName } = await gatherCorpusRelationVaultContext(vault, [c]);

    // Whole-note behaviour: unlike `sectionPassageText`'s own widening (see that describe
    // block below), the WHOLE note comes back, sibling "Type II" section included.
    expect(passageTextByName.get('Type I error')).toBe(note);
  });

  it(
    'a concept with no note of its own — its anchor is a heading inside a note shared with ' +
      'other concepts — gets that WHOLE source note, never a bare heading stub',
    async () => {
      const note = [
        '# Course notes',
        '',
        '## Type I error',
        '',
        'A Type I error is a false positive.',
        '',
        '## Type II error',
        '',
        'A Type II error is a false negative.',
        '',
      ].join('\n');
      const vault = new MemoryVault({ 'Course notes.md': note });
      const type1Start = note.indexOf('A Type I error');
      const type1End = type1Start + 'A Type I error is a false positive.'.length;
      const type2Start = note.indexOf('A Type II error');
      const type2End = type2Start + 'A Type II error is a false negative.'.length;
      // Neither concept has a dedicated note of its own — both are anchored to a heading
      // inside the SAME shared course note. The source note is the note each was extracted
      // from, per `notePassageText`'s own doc — never each concept's own heading in isolation.
      const concepts = [
        concept('Type I error', 'Course notes.md', [type1Start, type1End]),
        concept('Type II error', 'Course notes.md', [type2Start, type2End]),
      ];

      const { passageTextByName } = await gatherCorpusRelationVaultContext(vault, concepts);

      expect(passageTextByName.get('Type I error')).toBe(note);
      expect(passageTextByName.get('Type II error')).toBe(note);
    },
  );

  it(
    'over-budget: truncates around the anchor to `RELATIONS_ENDPOINT_CHAR_BUDGET` characters, ' +
      "always keeping the anchor's own text intact",
    async () => {
      const filler = 'x'.repeat(RELATIONS_ENDPOINT_CHAR_BUDGET * 2);
      const anchorText = 'A Type I error is a false positive.';
      const note = ['# Errors', '', filler, '', anchorText, '', filler, ''].join('\n');
      const anchorStart = note.indexOf(anchorText);
      const anchorEnd = anchorStart + anchorText.length;
      const vault = new MemoryVault({ 'Note.md': note });
      const c = concept('Type I error', 'Note.md', [anchorStart, anchorEnd]);

      const { passageTextByName } = await gatherCorpusRelationVaultContext(vault, [c]);

      const passage = passageTextByName.get('Type I error');
      expect(passage).toBeDefined();
      expect((passage ?? '').length).toBeLessThanOrEqual(RELATIONS_ENDPOINT_CHAR_BUDGET);
      expect(passage).toContain(anchorText);
    },
  );

  it('reads each unique file only once, even when several concepts share an anchor path', async () => {
    let reads = 0;
    const vault = new MemoryVault({ 'Note.md': 'AAAA BBBB' });
    class CountingVault implements VaultSource {
      list = vault.list.bind(vault);
      readBinary = vault.readBinary.bind(vault);
      write = vault.write.bind(vault);
      exists = vault.exists.bind(vault);
      watch = vault.watch.bind(vault);
      read(path: VaultPath): Promise<string> {
        reads++;
        return vault.read(path);
      }
    }
    const concepts = [concept('A', 'Note.md', [0, 4]), concept('B', 'Note.md', [5, 9])];

    await gatherCorpusRelationVaultContext(new CountingVault(), concepts);

    expect(reads).toBe(1);
  });

  it('degrades to empty passage text (not a thrown error) when the anchor file cannot be read', async () => {
    const vault = new MemoryVault({});
    const c = concept('Ghost concept', 'Missing.md', [0, 5]);

    const { passageTextByName } = await gatherCorpusRelationVaultContext(vault, [c]);

    expect(passageTextByName.get('Ghost concept')).toBe('');
  });
});

describe('sectionPassageText — the standalone widener (`ol-2zfj.64` [REL-5])', () => {
  // Production no longer calls this helper (see `notePassageText` and the describe block
  // below), but it stays exported for any future caller that wants a section rather than a
  // whole note, so its own behaviour stays covered directly rather than through the gatherer.

  it(
    "widens to the anchor's own SECTION (nearest enclosing heading), excluding a sibling " +
      'section — the behaviour `gatherCorpusRelationVaultContext` used before this bead moved ' +
      'production to `notePassageText`',
    () => {
      const note = [
        '# Errors',
        '',
        '## Type I',
        '',
        'A Type I error is a false positive.',
        '',
        '## Type II',
        '',
        'A Type II error is a false negative.',
        '',
      ].join('\n');
      const anchorStart = note.indexOf('A Type I error');
      const anchorEnd = anchorStart + 'A Type I error is a false positive.'.length;

      const result = sectionPassageText(note, { start: anchorStart, end: anchorEnd });

      expect(result).toContain('## Type I');
      expect(result).toContain('A Type I error is a false positive.');
      expect(result).not.toContain('Type II');
    },
  );

  it('widens to the whole note when the anchor sits before any heading, or the note has none at all', () => {
    const note = '0123456789Type I error is a false positive.';

    const result = sectionPassageText(note, { start: 10, end: 43 });

    expect(result).toBe(note);
  });

  it('degrades to the bare charRange slice when nothing in the note contains it exactly', () => {
    // A hand-built charRange that straddles two blocks — not the "one anchor is one block"
    // shape `../read.js` guarantees in production — so there is no section to widen to.
    const note = '# Heading\n\nFirst paragraph.\n\nSecond paragraph.\n';
    const start = note.indexOf('paragraph.') - 20;
    const end = note.indexOf('Second') + 6;

    const result = sectionPassageText(note, { start, end });

    expect(result).toBe(note.slice(start, end));
  });

  it('accepts a caller-supplied budget rather than always using the module default', () => {
    const anchorText = 'A Type I error is a false positive.';
    const note = ['# Errors', '', 'x'.repeat(500), '', anchorText, '', 'y'.repeat(500), ''].join(
      '\n',
    );
    const start = note.indexOf(anchorText);
    const end = start + anchorText.length;

    const result = sectionPassageText(note, { start, end }, 100);

    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain(anchorText);
  });
});

describe('notePassageText — the whole-note bounder (`ol-2zfj.64` [REL-5])', () => {
  it('returns the whole note unchanged when it is under budget, heading structure and all', () => {
    const note = [
      '# Errors',
      '',
      '## Type I',
      '',
      'A Type I error is a false positive.',
      '',
      '## Type II',
      '',
      'A Type II error is a false negative.',
      '',
    ].join('\n');
    const anchorStart = note.indexOf('A Type I error');
    const anchorEnd = anchorStart + 'A Type I error is a false positive.'.length;

    const result = notePassageText(note, { start: anchorStart, end: anchorEnd });

    expect(result).toBe(note);
  });

  it("truncates an over-budget note, centred on the anchor, always keeping the anchor's own text intact", () => {
    const filler = 'x'.repeat(RELATIONS_ENDPOINT_CHAR_BUDGET * 2);
    const anchorText = 'A Type I error is a false positive.';
    const note = ['# Errors', '', filler, '', anchorText, '', filler, ''].join('\n');
    const start = note.indexOf(anchorText);
    const end = start + anchorText.length;

    const result = notePassageText(note, { start, end });

    expect(result.length).toBeLessThanOrEqual(RELATIONS_ENDPOINT_CHAR_BUDGET);
    expect(result).toContain(anchorText);
  });

  it("truncates to the anchor's own text when the anchor alone exceeds the budget", () => {
    const anchorText = 'y'.repeat(200);
    const note = `${'x'.repeat(50)}${anchorText}${'x'.repeat(50)}`;
    const start = note.indexOf(anchorText);
    const end = start + anchorText.length;

    const result = notePassageText(note, { start, end }, 100);

    expect(result.length).toBe(100);
    expect(result).toBe(note.slice(start, start + 100));
  });

  it('accepts a caller-supplied budget rather than always using the module default', () => {
    const anchorText = 'A Type I error is a false positive.';
    const note = ['x'.repeat(500), anchorText, 'y'.repeat(500)].join('\n');
    const start = note.indexOf(anchorText);
    const end = start + anchorText.length;

    const result = notePassageText(note, { start, end }, 100);

    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain(anchorText);
  });
});

describe('gatherCorpusRelationVaultContext — her-link nomination signal', () => {
  it("nominates a pair when one concept's introducing passage wikilinks the other", async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error occurs when... see also [[Type II error]] for the converse.',
      'B.md': 'A Type II error is a false negative.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 76]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([{ kind: 'her-link', a: 'Type I error', b: 'Type II error' }]);
  });

  it('strips a heading or alias suffix before matching the target', async () => {
    const vault = new MemoryVault({
      'A.md': 'See [[Type II error#Definition|the converse]] for contrast.',
      'B.md': 'A Type II error is a false negative.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 61]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([{ kind: 'her-link', a: 'Type I error', b: 'Type II error' }]);
  });

  it('never nominates a self-link', async () => {
    const vault = new MemoryVault({ 'A.md': 'A Type I error, see also [[Type I error]].' });
    const concepts = [concept('Type I error', 'A.md', [0, 43])];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([]);
  });

  it('a wikilink to something outside the concept set nominates nothing', async () => {
    const vault = new MemoryVault({ 'A.md': 'See [[Some Unrelated Note]] for background.' });
    const concepts = [concept('Type I error', 'A.md', [0, 44])];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([]);
  });

  it('deduplicates a pair nominated from both directions into one signal', async () => {
    const vault = new MemoryVault({
      'A.md': 'See also [[Type II error]].',
      'B.md': 'See also [[Type I error]].',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 28]),
      concept('Type II error', 'B.md', [0, 28]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toHaveLength(1);
  });

  it('matches against an alias, not only the canonical name', async () => {
    const vault = new MemoryVault({ 'A.md': 'See also [[Beta error]].' });
    const concepts: CorpusConcept[] = [
      { ...concept('Type I error', 'A.md', [0, 25]) },
      {
        name: 'Type II error',
        aliases: ['Beta error'],
        anchor: { sourcePath: 'B.md', location: { page: 1, charRange: { start: 0, end: 1 } } },
      },
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([{ kind: 'her-link', a: 'Type I error', b: 'Type II error' }]);
  });
});

describe('gatherCorpusRelationVaultContext — assessment-cooccurrence nomination signal', () => {
  it('nominates a pair when both concepts are mentioned in the same classified past-paper document', async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error is a false positive.',
      'B.md': 'A Type II error is a false negative.',
      '03 Research/Midterm.md':
        '---\nrole: past-paper\n---\nQuestion 1: contrast a Type I error with a Type II error.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 36]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([
      { kind: 'assessment-cooccurrence', a: 'Type I error', b: 'Type II error' },
    ]);
  });

  it('nominates nothing when no source classifies as a past paper or objectives document (signal off)', async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error is a false positive.',
      'B.md': 'A Type II error is a false negative.',
      '03 Research/Reading.md':
        '---\nrole: course-material\n---\nBoth a Type I error and a Type II error are discussed here.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 36]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals.filter((s) => s.kind === 'assessment-cooccurrence')).toEqual([]);
  });

  it('matches against an alias, not only the canonical name', async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error is a false positive.',
      'B.md': 'A Type II error is a false negative.',
      '03 Research/Objectives.md':
        '---\nrole: objectives\n---\nExplain a Type I error and a Beta error.',
    });
    const concepts: CorpusConcept[] = [
      concept('Type I error', 'A.md', [0, 36]),
      {
        name: 'Type II error',
        aliases: ['Beta error'],
        anchor: { sourcePath: 'B.md', location: { page: 1, charRange: { start: 0, end: 37 } } },
      },
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toEqual([
      { kind: 'assessment-cooccurrence', a: 'Type I error', b: 'Type II error' },
    ]);
  });

  it('honours a custom sourcesFolder rather than the registerSources default', async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error is a false positive.',
      'B.md': 'A Type II error is a false negative.',
      'Assessments/Midterm.md':
        '---\nrole: past-paper\n---\nContrast a Type I error with a Type II error.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 36]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const withoutFolder = await gatherCorpusRelationVaultContext(vault, concepts);
    expect(withoutFolder.signals.filter((s) => s.kind === 'assessment-cooccurrence')).toEqual([]);

    const withFolder = await gatherCorpusRelationVaultContext(vault, concepts, {
      sourcesFolder: 'Assessments',
    });
    expect(withFolder.signals).toEqual([
      { kind: 'assessment-cooccurrence', a: 'Type I error', b: 'Type II error' },
    ]);
  });

  it('deduplicates a pair co-occurring in more than one assessment document into one signal', async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error is a false positive.',
      'B.md': 'A Type II error is a false negative.',
      '03 Research/Midterm.md':
        '---\nrole: past-paper\n---\nContrast a Type I error with a Type II error.',
      '03 Research/Final.md':
        '---\nrole: past-paper\n---\nAgain, contrast a Type I error with a Type II error.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 36]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals).toHaveLength(1);
  });
});

// ---- embedding-proximity nomination signal ---------------------------------
//
// Builds a REAL `EmbeddingCacheEngine` (never a duck-typed fake — its
// constructor is private, so the only way to hand `gatherCorpusRelationVaultContext`
// a value typed as one is a genuine instance) over a fake store and a fake
// provider whose vectors are supplied by the test, then seeds it via the same
// `ensureEmbeddings` a real retrieval drain would call. This module never
// calls `ensureEmbeddings` itself — see the source file's module doc — so
// seeding the cache here is exactly what stands in for "retrieval already
// indexed this passage" in production.

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly vectorByText: ReadonlyMap<string, readonly number[]>) {}
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return {
      vectors: request.texts.map((text) => [...(this.vectorByText.get(text) ?? [0, 0, 0])]),
    };
  }
}

/** Builds a real, already-populated `EmbeddingCacheEngine` — one entry per `vectorByText` key, keyed by the SAME `hashText` this module's own `embedding-proximity` pass looks up by. */
async function buildEmbeddingCache(
  vectorByText: ReadonlyMap<string, readonly number[]>,
): Promise<EmbeddingCacheEngine> {
  const engine = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider: new FakeEmbeddingProvider(vectorByText),
    model: 'test-model',
  });
  const chunks: RetrievalChunk[] = await Promise.all(
    [...vectorByText.keys()].map(async (text, index) => ({
      path: `chunk-${index}.md` as VaultPath,
      blockIndex: 0,
      kind: 'paragraph' as const,
      text,
      contentHash: await hashText(text),
    })),
  );
  await engine.ensureEmbeddings(chunks);
  return engine;
}

describe('gatherCorpusRelationVaultContext — embedding-proximity nomination signal', () => {
  const TEXT_A = 'A Type I error is a false positive.';
  const TEXT_B = 'A near-identical false-positive description, worded differently.';
  const TEXT_C = 'An entirely unrelated passage about sediment transport.';

  it('nominates a pair whose cached embeddings meet the threshold', async () => {
    const vault = new MemoryVault({ 'A.md': TEXT_A, 'B.md': TEXT_B });
    const concepts = [
      concept('Type I error', 'A.md', [0, TEXT_A.length]),
      concept('Near duplicate', 'B.md', [0, TEXT_B.length]),
    ];
    const cache = await buildEmbeddingCache(
      new Map([
        [TEXT_A, [1, 0, 0]],
        [TEXT_B, [1, 0.01, 0]],
      ]),
    );

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts, {
      embeddingProximity: { cache, threshold: 0.9 },
    });

    expect(signals).toEqual([
      { kind: 'embedding-proximity', a: 'Type I error', b: 'Near duplicate' },
    ]);
  });

  it('does not nominate a pair below the threshold', async () => {
    const vault = new MemoryVault({ 'A.md': TEXT_A, 'C.md': TEXT_C });
    const concepts = [
      concept('Type I error', 'A.md', [0, TEXT_A.length]),
      concept('Sediment transport', 'C.md', [0, TEXT_C.length]),
    ];
    const cache = await buildEmbeddingCache(
      new Map([
        [TEXT_A, [1, 0, 0]],
        [TEXT_C, [0, 1, 0]],
      ]),
    );

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts, {
      embeddingProximity: { cache, threshold: 0.9 },
    });

    expect(signals.filter((s) => s.kind === 'embedding-proximity')).toEqual([]);
  });

  it('is off by default — omitting embeddingProximity computes no such signal even with a close pair available', async () => {
    const vault = new MemoryVault({ 'A.md': TEXT_A, 'B.md': TEXT_B });
    const concepts = [
      concept('Type I error', 'A.md', [0, TEXT_A.length]),
      concept('Near duplicate', 'B.md', [0, TEXT_B.length]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals.filter((s) => s.kind === 'embedding-proximity')).toEqual([]);
  });

  it('nominates nothing for a concept whose introducing passage was never retrieval-indexed (absent from the local cache)', async () => {
    const vault = new MemoryVault({ 'A.md': TEXT_A, 'B.md': TEXT_B });
    const concepts = [
      concept('Type I error', 'A.md', [0, TEXT_A.length]),
      concept('Near duplicate', 'B.md', [0, TEXT_B.length]),
    ];
    // Only TEXT_A was ever embedded — TEXT_B's passage is absent from the cache.
    const cache = await buildEmbeddingCache(new Map([[TEXT_A, [1, 0, 0]]]));

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts, {
      embeddingProximity: { cache, threshold: 0.5 },
    });

    expect(signals.filter((s) => s.kind === 'embedding-proximity')).toEqual([]);
  });
});

// ---- assessment-error-adjacency nomination signal (`ol-2zfj.19`) -----------

const CITATION = { path: 'Courses/Sample/notes.md' as VaultPath, blockIndex: 1 };

function misconceptionRecord(overrides: Partial<MisconceptionRecord> = {}): MisconceptionRecord {
  return {
    id: 'm-1',
    conceptId: 'Type I error',
    confusedWithConceptId: 'Type II error',
    statement: 'Believes a false positive and a false negative are the same thing.',
    correction: 'A Type I error rejects a true null; a Type II error fails to reject a false one.',
    citation: CITATION,
    firstSeen: '2026-08-16T09:00:00-04:00',
    lastSeen: '2026-08-16T09:00:00-04:00',
    occurrenceCount: 1,
    status: 'active',
    originInstrumentId: 'explain-back:Type I error:1',
    ...overrides,
  };
}

describe('gatherCorpusRelationVaultContext — assessment-error-adjacency nomination signal', () => {
  it("nominates a pair from a misconception record's confusedWithConceptId", async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error is a false positive.',
      'B.md': 'A Type II error is a false negative.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 36]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts, {
      assessmentErrorAdjacency: { records: [misconceptionRecord()] },
    });

    expect(signals).toEqual([
      { kind: 'assessment-error-adjacency', a: 'Type I error', b: 'Type II error' },
    ]);
  });

  it('is off by default — omitting assessmentErrorAdjacency computes no such signal', async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error is a false positive.',
      'B.md': 'A Type II error is a false negative.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 36]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts);

    expect(signals.filter((s) => s.kind === 'assessment-error-adjacency')).toEqual([]);
  });

  it('nominates nothing for a record with no confusedWithConceptId', async () => {
    const vault = new MemoryVault({ 'A.md': 'A Type I error is a false positive.' });
    const concepts = [concept('Type I error', 'A.md', [0, 36])];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts, {
      assessmentErrorAdjacency: {
        records: [misconceptionRecord({ confusedWithConceptId: null })],
      },
    });

    expect(signals).toEqual([]);
  });

  it('nominates nothing when either id does not resolve to a known concept', async () => {
    const vault = new MemoryVault({ 'A.md': 'A Type I error is a false positive.' });
    const concepts = [concept('Type I error', 'A.md', [0, 36])];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts, {
      assessmentErrorAdjacency: {
        records: [misconceptionRecord({ confusedWithConceptId: 'Some unknown concept' })],
      },
    });

    expect(signals).toEqual([]);
  });

  it('never nominates a self-pair when a record names the same concept on both sides', async () => {
    const vault = new MemoryVault({ 'A.md': 'A Type I error is a false positive.' });
    const concepts = [concept('Type I error', 'A.md', [0, 36])];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts, {
      assessmentErrorAdjacency: {
        records: [
          misconceptionRecord({ conceptId: 'Type I error', confusedWithConceptId: 'Type I error' }),
        ],
      },
    });

    expect(signals).toEqual([]);
  });

  it('deduplicates the same pair nominated by more than one record', async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error is a false positive.',
      'B.md': 'A Type II error is a false negative.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 36]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts, {
      assessmentErrorAdjacency: {
        records: [
          misconceptionRecord({ id: 'm-1' }),
          misconceptionRecord({
            id: 'm-2',
            conceptId: 'Type II error',
            confusedWithConceptId: 'Type I error',
          }),
        ],
      },
    });

    expect(signals).toHaveLength(1);
  });

  it('matches against an alias, not only the canonical name', async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error is a false positive.',
      'B.md': 'A Type II error is a false negative.',
    });
    const concepts: CorpusConcept[] = [
      concept('Type I error', 'A.md', [0, 36]),
      {
        name: 'Type II error',
        aliases: ['Beta error'],
        anchor: { sourcePath: 'B.md', location: { page: 1, charRange: { start: 0, end: 37 } } },
      },
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts, {
      assessmentErrorAdjacency: {
        records: [misconceptionRecord({ confusedWithConceptId: 'Beta error' })],
      },
    });

    expect(signals).toEqual([
      { kind: 'assessment-error-adjacency', a: 'Type I error', b: 'Type II error' },
    ]);
  });

  it('composes with the other three signal kinds when several are wired at once', async () => {
    const vault = new MemoryVault({
      'A.md': 'A Type I error occurs when... see also [[Type II error]] for the converse.',
      'B.md': 'A Type II error is a false negative.',
    });
    const concepts = [
      concept('Type I error', 'A.md', [0, 76]),
      concept('Type II error', 'B.md', [0, 37]),
    ];

    const { signals } = await gatherCorpusRelationVaultContext(vault, concepts, {
      assessmentErrorAdjacency: { records: [misconceptionRecord()] },
    });

    // her-link and assessment-error-adjacency both nominate the same pair here — two
    // signal occurrences over the same pair, kept distinct by kind (dedup is
    // per-signal-kind, `nominate.js`'s own job to merge across kinds).
    expect(signals).toEqual(
      expect.arrayContaining([
        { kind: 'her-link', a: 'Type I error', b: 'Type II error' },
        { kind: 'assessment-error-adjacency', a: 'Type I error', b: 'Type II error' },
      ]),
    );
    expect(signals).toHaveLength(2);
  });
});
