/**
 * `readConcepts` — the material-first reading stage (F1.4, C7.3, `[D-068]`,
 * `[D-082]`, `[D-085]`).
 *
 * **What these tests deliberately do NOT assert.** They never assert that a
 * particular set of concepts comes back from a particular fixture vault.
 * That was the old oracle — an expected-set comparison against a vault built
 * to mirror one student's filing — and `[D-068]` invalidated the assumption
 * it rested on, not just the code under it. The reader is a model call, so
 * *what* it finds is an evaluation question with a corpus behind it, not a
 * unit-test question. What is asserted here is everything around the
 * judgement: that her conventions outrank it, that her wording survives
 * verbatim, that a vault we cannot read says so out loud, that the budget
 * bounds the run, and that no model is ever asked to read nothing.
 *
 * INV-3: every string in this file is coined. No course code, note title or
 * wording here comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { Provenance } from '../extract/types.js';
import { FolderSource } from '../vault/folder-source.js';
import type {
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from '../vault/types.js';
import {
  type ConceptPassage,
  type ConceptReaderPort,
  ConceptReaderUnavailableError,
  type ConceptReadRequest,
  type ConceptReadResponse,
  gatherPassages,
  type ProposedConcept,
  readConcepts,
} from './read.js';
import type { ProposedRelation } from './relation.js';

// ---------------------------------------------------------------------------
// Fixtures — an in-memory vault and a scriptable reader.
// ---------------------------------------------------------------------------

class MemoryVault implements VaultSource {
  constructor(private readonly files: Record<string, string>) {}

  list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const { under, extensions } = options;
    return Promise.resolve(
      Object.keys(this.files)
        .filter((p) => under === undefined || p === under || p.startsWith(`${under}/`))
        .filter((p) => extensions === undefined || extensions.includes(p.split('.').pop() ?? ''))
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

/**
 * `MemoryVault` for markdown, plus real binary content for a handful of paths
 * — what the non-markdown gathering tests below need and `MemoryVault` alone
 * cannot give them, since its `readBinary` just UTF-8-encodes a text file
 * and would corrupt any byte above 0x7F.
 */
class BinaryVault implements VaultSource {
  constructor(
    private readonly files: Record<string, string>,
    private readonly binaries: Record<string, Uint8Array>,
  ) {}

  list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const { under, extensions } = options;
    return Promise.resolve(
      [...Object.keys(this.files), ...Object.keys(this.binaries)]
        .filter((p) => under === undefined || p === under || p.startsWith(`${under}/`))
        .filter((p) => extensions === undefined || extensions.includes(p.split('.').pop() ?? ''))
        .sort(),
    );
  }
  read(path: VaultPath): Promise<string> {
    const content = this.files[path];
    if (content === undefined) return Promise.reject(new Error(`no such text file ${path}`));
    return Promise.resolve(content);
  }
  readBinary(path: VaultPath): Promise<Uint8Array> {
    const bytes = this.binaries[path];
    if (bytes !== undefined) return Promise.resolve(bytes);
    return this.read(path).then((t) => new TextEncoder().encode(t));
  }
  write(): Promise<void> {
    return Promise.reject(new Error('read-only'));
  }
  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(path in this.files || path in this.binaries);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }
}

// ---- a tiny hand-built one-page PDF, mirroring `extract/pdf.spec.ts`'s own
// "hand-built objects/xref" style so the duplicate-filing and honest-degrade
// tests below exercise the real extractor, not a mock of it.

function pdfLatin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** A minimal, valid, one-page PDF whose page shows `text` via a single `Tj` operator. */
function buildOnePagePdfBytes(text: string): Uint8Array {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = `BT /F1 12 Tf 20 150 Td (${escaped}) Tj ET`;
  const objects =
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R ' +
    '/Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n' +
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
  return pdfLatin1ToBytes(
    `%PDF-1.4\n${objects}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
  );
}

/** Bytes that are not a PDF at all — no `%PDF` header, no objects to find. `pdfExtractor` reports this honestly as `outcome: 'unreadable'` rather than throwing (`extract/pdf.ts`: "no objects at all -> 'unreadable'"). */
function buildUnreadableBytes(): Uint8Array {
  return pdfLatin1ToBytes('this is not a PDF, a PPTX or a DOCX — just bytes with nothing in them');
}

/**
 * A reader that returns a fixed set and records every request it was handed.
 *
 * **Scoped to the request it received, like a real per-document call
 * (`[D-210]`).** `concepts` is filtered to only the ones anchored in a
 * passage this particular request actually sent — a real reader has no
 * business proposing a concept anchored to a document it was never shown,
 * and since batching is now unconditionally per document, a fixture vault
 * with more than one document means this reader IS called once per
 * document. `relations` is attached only to a call that actually proposed at
 * least one concept — a call proposing nothing has nothing to relate — and
 * otherwise returned exactly as scripted, unfiltered. Tests that want a
 * relation to survive reconciliation exactly once anchor both its endpoints'
 * concepts to the SAME document, so only one call ever attaches it — the
 * same constraint C7.10 places on per-document relations for real.
 */
class ScriptedReader implements ConceptReaderPort {
  readonly requests: ConceptReadRequest[] = [];
  constructor(
    private readonly concepts: readonly ProposedConcept[],
    private readonly relations?: readonly ProposedRelation[],
  ) {}
  read(request: ConceptReadRequest): Promise<ConceptReadResponse> {
    this.requests.push(request);
    const sent = new Set(request.passages.map((p) => p.anchor.sourcePath));
    const concepts = this.concepts.filter((c) => sent.has(c.anchor.sourcePath));
    const includeRelations = this.relations !== undefined && concepts.length > 0;
    return Promise.resolve(
      includeRelations ? { concepts, relations: this.relations } : { concepts },
    );
  }
}

const BUDGET = { maxPassages: 100 };

function anchorIn(path: VaultPath, start = 0, end = 10): Provenance {
  return { sourcePath: path, location: { page: 1, charRange: { start, end } } };
}

function proposal(
  name: string,
  anchor: Provenance,
  aliases: readonly string[] = [],
  alsoIn: readonly Provenance[] = [],
): ProposedConcept {
  return { name, aliases, anchor, alsoIn };
}

// A vault with NO frontmatter, NO topic property and NO concept notes — the
// shape `[D-068]` says must still yield a populated list.
const BARE_VAULT = new MemoryVault({
  '01 Courses/ABCD101/Lecture One.md': '# Opening\n\nOrmathel is the settling of the layer.\n',
  '01 Courses/ABCD101/Lecture Two.md': '# Follow-up\n\nQuintaris follows from it.\n',
});

// ---------------------------------------------------------------------------

describe('readConcepts — the read is the floor, not the last resort (F1.4)', () => {
  it('a vault with no tags and no concept notes still yields a populated concept list', async () => {
    const reader = new ScriptedReader([
      proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
      proposal('Quintaris', anchorIn('01 Courses/ABCD101/Lecture Two.md')),
    ]);

    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    expect(result.concepts.map((c) => c.name)).toEqual(['Ormathel', 'Quintaris']);
  });

  it('a concept found only in the material carries no provisional marker for that reason alone', async () => {
    const reader = new ScriptedReader([
      proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
    ]);

    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const [concept] = result.concepts;
    expect(concept?.provenanceTier).toBe(3);
    // Tier 3 is not a fallback awaiting her confirmation: it is returned with
    // its courses and its anchor like any other concept.
    expect(concept?.courses).toEqual(['ABCD101']);
    expect(concept?.anchor).toBeDefined();
  });

  it('the reader runs over the material regardless of what she has filed', async () => {
    const reader = new ScriptedReader([]);
    await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    // Both lecture notes reached the reader even though neither carries a
    // single convention for the old extractor to key on.
    const paths = new Set(
      reader.requests.flatMap((r) => r.passages.map((p) => p.anchor.sourcePath)),
    );
    expect(paths).toEqual(
      new Set(['01 Courses/ABCD101/Lecture One.md', '01 Courses/ABCD101/Lecture Two.md']),
    );
  });
});

describe('readConcepts — her conventions corroborate and outrank (scope principle 13)', () => {
  const TAGGED_VAULT = new MemoryVault({
    '01 Courses/ABCD101/Lecture One.md':
      '---\ntopic: Ormathel settling\ncourse: ABCD101\n---\n\n# Opening\n\nThe settling of the layer.\n',
  });

  // `[D-248]`: her lecture *links* the concept note, which is what puts the
  // note in this course's reading set and lets it bind. Before that ruling the
  // note bound because of the folder it sat in; the folder is now incidental.
  const NOTED_VAULT = new MemoryVault({
    '01 Courses/ABCD101/Lecture One.md':
      '---\ntopic: [[Ormathel settling]]\ncourse: ABCD101\n---\n\n# Opening\n\nThe settling of the layer.\n',
    '05 Zettelkasten/Ormathel settling.md': '# Ormathel settling\n\nHer own definition.\n',
  });

  it("her `topic` property outranks the reader's wording, which is kept as an alias", async () => {
    // The reader read the passage and called it something else.
    const reader = new ScriptedReader([
      proposal('ormathel deposition', anchorIn('01 Courses/ABCD101/Lecture One.md'), [
        'Ormathel settling',
      ]),
    ]);

    const result = await readConcepts(TAGGED_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const [concept] = result.concepts;
    expect(concept?.name).toBe('Ormathel settling');
    expect(concept?.provenanceTier).toBe(2);
    // Nothing is discarded — the reader's own wording survives as an alias.
    expect(concept?.aliases).toContain('ormathel deposition');
  });

  it('her concept note wins on conflict with the material, and binds', async () => {
    const reader = new ScriptedReader([
      proposal('ormathel deposition', anchorIn('01 Courses/ABCD101/Lecture One.md'), [
        'Ormathel settling',
      ]),
    ]);

    const result = await readConcepts(NOTED_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    // ONE concept, not two. Her note and the reader's wording are the same
    // concept; emitting both separately would be the failure this asserts
    // against, and it is the failure that looks most like success.
    expect(result.concepts).toHaveLength(1);
    const [concept] = result.concepts;
    expect(concept?.name).toBe('Ormathel settling');
    expect(concept?.provenanceTier).toBe(1);
    expect(concept?.boundNotePath).toBe('05 Zettelkasten/Ormathel settling.md');
    // The merge actually happened: the reader's own wording survived onto it.
    expect(concept?.aliases).toContain('ormathel deposition');
    // And it kept the passage anchor, which the un-merged record would lack.
    expect(concept?.anchor).toBeDefined();
  });

  it('a concept she named that the read did not surface is still returned, and is honestly un-anchored', async () => {
    // `[D-082]`: file-grain provenance would let the corpus stage fall back to
    // inferring from names. No passage means no anchor, stated rather than faked.
    const reader = new ScriptedReader([]);

    const result = await readConcepts(TAGGED_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const concept = result.concepts.find((c) => c.name === 'Ormathel settling');
    expect(concept).toBeDefined();
    expect(concept?.provenanceTier).toBe(2);
    expect(concept?.anchor).toBeUndefined();
  });

  it('nothing breaks where she keeps no convention at all', async () => {
    const reader = new ScriptedReader([
      proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
    ]);
    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });
    expect(result.outcome).toBe('read');
  });
});

describe('readConcepts — her words survive verbatim (R1/R2, F1.4)', () => {
  it('her display name matches her own text exactly, character for character', async () => {
    const vault = new MemoryVault({
      '01 Courses/ABCD101/Note.md':
        '---\ntopic: "  Ormathel  settling "\ncourse: ABCD101\n---\n\n# H\n\nBody.\n',
    });
    const reader = new ScriptedReader([
      proposal('Ormathel settling', anchorIn('01 Courses/ABCD101/Note.md'), [
        '  Ormathel  settling ',
      ]),
    ]);

    const result = await readConcepts(vault, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    // Doubled inner space and both outer spaces intact — no trim, no collapse.
    expect(result.concepts.some((c) => c.name === '  Ormathel  settling ')).toBe(true);
  });

  it('two wordings differing only by case are not folded together', async () => {
    const reader = new ScriptedReader([
      proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
      proposal('ormathel', anchorIn('01 Courses/ABCD101/Lecture Two.md')),
    ]);

    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    expect(result.concepts.map((c) => c.name).sort()).toEqual(['Ormathel', 'ormathel']);
  });

  it('two passages naming a concept differently keep both wordings, one as name and one as alias', async () => {
    const reader = new ScriptedReader([
      proposal(
        'Ormathel settling',
        anchorIn('01 Courses/ABCD101/Lecture One.md'),
        ['the settling layer'],
        [anchorIn('01 Courses/ABCD101/Lecture Two.md')],
      ),
    ]);

    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const [concept] = result.concepts;
    expect(concept?.name).toBe('Ormathel settling');
    expect(concept?.aliases).toEqual(['the settling layer']);
    expect(concept?.alsoIn).toHaveLength(1);
  });
});

describe('readConcepts — an unreadable vault is reported, never a silent empty list (F1.4)', () => {
  it('LOUD FAILURE: a vault yielding no readable passage reports why, and is not an empty concept list', async () => {
    const empty = new MemoryVault({ '01 Courses/ABCD101/Empty.md': '' });
    const reader = new ScriptedReader([proposal('Invented', anchorIn('x.md'))]);

    const result = await readConcepts(empty, reader, { budget: BUDGET });

    expect(result.outcome).toBe('unrecognised');
    if (result.outcome !== 'unrecognised') return;
    expect(result.reason).toBe('no-readable-material');
    expect(result.detail.length).toBeGreaterThan(0);
    expect(result.concepts).toEqual([]);
  });

  it('a vault that WAS read and genuinely holds nothing is distinguishable from one that could not be read', async () => {
    const reader = new ScriptedReader([]);

    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    // Same empty concept list, entirely different statement about the world.
    expect(result.outcome).toBe('read');
    expect(result.concepts).toEqual([]);
  });

  it('a reader that cannot run at all reports the reason rather than returning nothing', async () => {
    const offline: ConceptReaderPort = {
      read: () => Promise.reject(new ConceptReaderUnavailableError('offline')),
    };

    const result = await readConcepts(BARE_VAULT, offline, { budget: BUDGET });

    expect(result.outcome).toBe('unrecognised');
    if (result.outcome !== 'unrecognised') return;
    expect(result.reason).toBe('reader-unavailable');
    expect(result.unavailableBecause).toBe('offline');
  });

  it.each(['budget-exhausted', 'not-on-this-device', 'not-configured'] as const)(
    'the accepted cost of `[D-068]` arrives as a stated reason: %s',
    async (reason) => {
      const port: ConceptReaderPort = {
        read: () => Promise.reject(new ConceptReaderUnavailableError(reason)),
      };
      const result = await readConcepts(BARE_VAULT, port, { budget: BUDGET });
      expect(result.outcome).toBe('unrecognised');
      if (result.outcome !== 'unrecognised') return;
      expect(result.unavailableBecause).toBe(reason);
    },
  );

  it('a reader that was reached and failed is reported as failed, not as unavailable', async () => {
    const broken: ConceptReaderPort = {
      read: () => Promise.reject(new Error('upstream-error')),
    };

    const result = await readConcepts(BARE_VAULT, broken, { budget: BUDGET });

    expect(result.outcome).toBe('unrecognised');
    if (result.outcome !== 'unrecognised') return;
    expect(result.reason).toBe('reader-failed');
    expect(result.detail).toContain('upstream-error');
  });

  it('every document looked at gets a coverage row, including one that yielded nothing', async () => {
    const reader = new ScriptedReader([
      proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
    ]);

    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.coverage.map((r) => r.sourcePath)).toEqual([
      '01 Courses/ABCD101/Lecture One.md',
      '01 Courses/ABCD101/Lecture Two.md',
    ]);
    // The zero-yield document is present with a measurement, not absent.
    expect(result.coverage[1]?.conceptsFound).toBe(0);
    expect(result.coverage[1]?.passagesRead).toBeGreaterThan(0);
  });
});

describe('readConcepts — INV-5, the adversarial empty context', () => {
  it('INV-5: a model is never asked to read nothing, so a fabricating reader cannot contribute', async () => {
    // The adversary: a reader that invents concepts no matter what it is given,
    // including when it is given nothing at all. If the stage ever calls it with
    // an empty passage list, these fabrications appear in the result.
    let calls = 0;
    const fabricator: ConceptReaderPort = {
      read: () => {
        calls += 1;
        return Promise.resolve({
          concepts: [proposal('Fabricated from nothing', anchorIn('nowhere.md'))],
        });
      },
    };
    const empty = new MemoryVault({ '01 Courses/ABCD101/Empty.md': '   \n\n' });

    const result = await readConcepts(empty, fabricator, { budget: BUDGET });

    expect(calls).toBe(0);
    expect(result.outcome).toBe('unrecognised');
    expect(result.concepts).toEqual([]);
  });

  it('INV-5: a zero budget refuses the call rather than sending an empty context', async () => {
    let calls = 0;
    const counting: ConceptReaderPort = {
      read: () => {
        calls += 1;
        return Promise.resolve({ concepts: [] });
      },
    };

    const result = await readConcepts(BARE_VAULT, counting, { budget: { maxPassages: 0 } });

    expect(calls).toBe(0);
    expect(result.outcome).toBe('unrecognised');
    if (result.outcome !== 'unrecognised') return;
    expect(result.reason).toBe('no-readable-material');
  });

  it('INV-5: every request the reader does receive carries at least one passage', async () => {
    const reader = new ScriptedReader([]);
    await readConcepts(BARE_VAULT, reader, { budget: { maxPassages: 100, passagesPerCall: 1 } });

    expect(reader.requests.length).toBeGreaterThan(0);
    for (const request of reader.requests) {
      expect(request.passages.length).toBeGreaterThan(0);
    }
  });
});

describe('readConcepts — budget-bounded (`[D-068]`, `[D-082]`)', () => {
  it('the budget truncates the run and says so rather than reading everything', async () => {
    const reader = new ScriptedReader([]);

    const result = await readConcepts(BARE_VAULT, reader, { budget: { maxPassages: 1 } });

    expect(result.truncatedByBudget).toBe(true);
    expect(result.passagesRead).toBe(1);
    expect(result.passagesOffered).toBeGreaterThan(1);
    expect(reader.requests).toHaveLength(1);
  });

  it('a budget that covers the material reports no truncation', async () => {
    const reader = new ScriptedReader([]);
    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });
    expect(result.truncatedByBudget).toBe(false);
    expect(result.passagesRead).toBe(result.passagesOffered);
  });

  it('several calls are permitted inside one stage (`[D-082]` option C)', async () => {
    const reader = new ScriptedReader([]);

    await readConcepts(BARE_VAULT, reader, { budget: { maxPassages: 100, passagesPerCall: 1 } });

    // One stage, several calls — the ruling's reading of "the same pass".
    expect(reader.requests.length).toBeGreaterThan(1);
  });
});

describe('readConcepts — per-document batching (`[D-210]`, `ol-2zfj.62`)', () => {
  // Three documents of different sizes relative to a ceiling of 2: `One.md`
  // (below it), `Two.md` (exactly at it) and `Five.md` (well past it) — no
  // headings, so passage counts equal paragraph counts exactly.
  const PER_DOCUMENT_VAULT = new MemoryVault({
    '01 Courses/ABCD101/One.md': 'Alpha paragraph.\n',
    '01 Courses/ABCD101/Two.md': 'Beta paragraph.\n\nGamma paragraph.\n',
    '01 Courses/ABCD101/Five.md':
      'Delta one.\n\nDelta two.\n\nDelta three.\n\nDelta four.\n\nDelta five.\n',
  });

  function requestsFor(reader: ScriptedReader, path: VaultPath): readonly ConceptReadRequest[] {
    return reader.requests.filter((r) => r.passages[0]?.anchor.sourcePath === path);
  }

  it('a document never shares a call with another document', async () => {
    const reader = new ScriptedReader([]);
    await readConcepts(PER_DOCUMENT_VAULT, reader, {
      budget: { maxPassages: 100, passagesPerCall: 2 },
    });

    expect(reader.requests.length).toBeGreaterThan(0);
    for (const request of reader.requests) {
      const sources = new Set(request.passages.map((p) => p.anchor.sourcePath));
      expect(sources.size).toBe(1);
    }
  });

  it('an oversized document splits at the ceiling, in reading order, into ceil(n / ceiling) calls', async () => {
    const reader = new ScriptedReader([]);
    await readConcepts(PER_DOCUMENT_VAULT, reader, {
      budget: { maxPassages: 100, passagesPerCall: 2 },
    });

    const fiveRequests = requestsFor(reader, '01 Courses/ABCD101/Five.md');
    expect(fiveRequests).toHaveLength(3); // ceil(5 / 2)
    expect(fiveRequests.map((r) => r.passages.map((p) => p.text.trim()))).toEqual([
      ['Delta one.', 'Delta two.'],
      ['Delta three.', 'Delta four.'],
      ['Delta five.'],
    ]);
  });

  it('a small document stands alone, one call, never split just because a bigger document is also in scope', async () => {
    const reader = new ScriptedReader([]);
    await readConcepts(PER_DOCUMENT_VAULT, reader, {
      budget: { maxPassages: 100, passagesPerCall: 2 },
    });

    const oneRequests = requestsFor(reader, '01 Courses/ABCD101/One.md');
    expect(oneRequests).toHaveLength(1);
    expect(oneRequests[0]?.passages).toHaveLength(1);

    const twoRequests = requestsFor(reader, '01 Courses/ABCD101/Two.md');
    expect(twoRequests).toHaveLength(1);
    expect(twoRequests[0]?.passages).toHaveLength(2);
  });

  it('the call count is recorded per document on the read result, never below one', async () => {
    const reader = new ScriptedReader([]);
    const result = await readConcepts(PER_DOCUMENT_VAULT, reader, {
      budget: { maxPassages: 100, passagesPerCall: 2 },
    });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const callsFor = (path: string) => result.coverage.find((c) => c.sourcePath === path)?.calls;
    expect(callsFor('01 Courses/ABCD101/One.md')).toBe(1); // ceil(1 / 2)
    expect(callsFor('01 Courses/ABCD101/Two.md')).toBe(1); // ceil(2 / 2)
    expect(callsFor('01 Courses/ABCD101/Five.md')).toBe(3); // ceil(5 / 2)
  });

  it('no ceiling supplied means exactly one call per document, however large', async () => {
    const reader = new ScriptedReader([]);
    const result = await readConcepts(PER_DOCUMENT_VAULT, reader, {
      budget: { maxPassages: 100 },
    });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    expect(result.coverage.find((c) => c.sourcePath === '01 Courses/ABCD101/Five.md')?.calls).toBe(
      1,
    );
    const fiveRequests = requestsFor(reader, '01 Courses/ABCD101/Five.md');
    expect(fiveRequests).toHaveLength(1);
    expect(fiveRequests[0]?.passages).toHaveLength(5);
  });
});

describe('readConcepts — split-document boundary reconciliation (`ol-2zfj.144` [IL-D5])', () => {
  // Two paragraphs, no headings, so exactly two passages — a document that
  // splits into exactly two calls at `passagesPerCall: 1`.
  const SPLIT_VAULT = new MemoryVault({
    '01 Courses/ABCD101/Long.md': 'First half about Torvane.\n\nSecond half about Torvane.\n',
  });

  /** A reader that proposes a concept anchored to whichever passage it was actually sent, so two calls over one document each propose "the same" concept independently — exactly what a real per-batch model call does, with no view of the other batch. */
  function perCallReader(
    responsesByCall: readonly ((request: ConceptReadRequest) => ConceptReadResponse)[],
  ): ConceptReaderPort {
    let n = 0;
    return {
      read(request) {
        // biome-ignore lint/style/noNonNullAssertion: test fixture provides one responder per expected call.
        const respond = responsesByCall[n]!;
        n += 1;
        return Promise.resolve(respond(request));
      },
    };
  }

  it('the same concept, proposed independently by both batches, folds into one — aliases unioned, both anchors kept', async () => {
    const reader = perCallReader([
      (request) => ({
        concepts: [
          {
            name: 'Torvane',
            // biome-ignore lint/style/noNonNullAssertion: fixture always sends one passage.
            anchor: request.passages[0]!.anchor,
            aliases: ['Torv.'],
            alsoIn: [],
          },
        ],
      }),
      (request) => ({
        concepts: [
          {
            name: 'Torvane',
            // biome-ignore lint/style/noNonNullAssertion: fixture always sends one passage.
            anchor: request.passages[0]!.anchor,
            aliases: ['The Torvane effect'],
            alsoIn: [],
          },
        ],
      }),
    ]);

    const result = await readConcepts(SPLIT_VAULT, reader, {
      budget: { maxPassages: 100, passagesPerCall: 1 },
    });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const matches = result.concepts.filter((c) => c.name === 'Torvane');
    expect(matches).toHaveLength(1);
    const merged = matches[0];
    expect([...(merged?.aliases ?? [])].sort()).toEqual(['The Torvane effect', 'Torv.']);
    // The second batch's own anchor survived as corroborating evidence
    // rather than being dropped when the proposal merged.
    expect(merged?.alsoIn).toHaveLength(1);
    expect(merged?.alsoIn[0]?.location.charRange).not.toEqual(merged?.anchor?.location.charRange);
  });

  it('a relation from the SECOND batch naming the merged concept still resolves, not dropped as unknown', async () => {
    const reader = perCallReader([
      (request) => ({
        concepts: [
          {
            name: 'Torvane',
            // biome-ignore lint/style/noNonNullAssertion: fixture always sends one passage.
            anchor: request.passages[0]!.anchor,
            aliases: [],
            alsoIn: [],
          },
        ],
      }),
      (request) => ({
        concepts: [
          {
            name: 'Torvane',
            // biome-ignore lint/style/noNonNullAssertion: fixture always sends one passage.
            anchor: request.passages[0]!.anchor,
            aliases: [],
            alsoIn: [],
          },
          {
            name: 'Second-batch concept',
            // biome-ignore lint/style/noNonNullAssertion: fixture always sends one passage.
            anchor: request.passages[0]!.anchor,
            aliases: [],
            alsoIn: [],
          },
        ],
        relations: [
          { type: 'part-of', from: 'Second-batch concept', to: 'Torvane', confidence: 0.8 },
        ],
      }),
    ]);

    const result = await readConcepts(SPLIT_VAULT, reader, {
      budget: { maxPassages: 100, passagesPerCall: 1 },
    });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    expect(result.concepts.filter((c) => c.name === 'Torvane')).toHaveLength(1);
    expect(result.relationsDropped).toBe(0);
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({ from: 'Second-batch concept', to: 'Torvane' });
  });

  it('gap 3 (`ol-egov.141.89.3.8` [ILB-CPT-B1]): a case-only repeat across batches of ONE document collapses to one identity, both wordings kept', async () => {
    const reader = perCallReader([
      (request) => ({
        concepts: [
          {
            name: 'Torvane',
            // biome-ignore lint/style/noNonNullAssertion: fixture always sends one passage.
            anchor: request.passages[0]!.anchor,
            aliases: [],
            alsoIn: [],
          },
        ],
      }),
      (request) => ({
        concepts: [
          {
            name: 'torvane',
            // biome-ignore lint/style/noNonNullAssertion: fixture always sends one passage.
            anchor: request.passages[0]!.anchor,
            aliases: [],
            alsoIn: [],
          },
        ],
      }),
    ]);

    const result = await readConcepts(SPLIT_VAULT, reader, {
      budget: { maxPassages: 100, passagesPerCall: 1 },
    });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    // One identity, not two: the first batch's casing wins the name (`[D-210]`'s
    // own "first proposal wins" rule), and the second batch's own casing
    // survives as an alias rather than being discarded.
    expect(result.concepts.map((c) => c.name)).toEqual(['Torvane']);
    expect(result.concepts[0]?.aliases).toEqual(['torvane']);
    // Both batches' anchors are kept as corroborating evidence.
    expect(result.concepts[0]?.alsoIn).toHaveLength(1);
  });

  it('merging is scoped to one document — the same name proposed in two different documents is never folded', async () => {
    const reader = new ScriptedReader([
      proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
      proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture Two.md')),
    ]);
    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    expect(result.concepts.filter((c) => c.name === 'Ormathel')).toHaveLength(2);
  });

  it('merging is scoped to one document even for a case-only repeat — two different documents proposing case variants of the same name are never folded', async () => {
    const reader = new ScriptedReader([
      proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
      proposal('ormathel', anchorIn('01 Courses/ABCD101/Lecture Two.md')),
    ]);
    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    expect(result.concepts.map((c) => c.name).sort()).toEqual(['Ormathel', 'ormathel']);
  });
});

describe('readConcepts — coverage surfaces truncation and a section inventory per document (`ol-2zfj.144` [IL-D5])', () => {
  const HEADED_VAULT = new MemoryVault({
    '01 Courses/ABCD101/Notes.md':
      '# Intro\n\nIntro body about Foo.\n\n# Background\n\nBackground body about Bar.\n',
  });

  it('a document the budget cuts short reports its OWN truncation on its coverage row', async () => {
    const reader = new ScriptedReader([]);
    const result = await readConcepts(HEADED_VAULT, reader, {
      budget: { maxPassages: 2 },
    });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const row = result.coverage.find((c) => c.sourcePath === '01 Courses/ABCD101/Notes.md');
    expect(row?.passagesOffered).toBe(4);
    expect(row?.passagesRead).toBe(2);
    expect(row?.truncatedByBudget).toBe(true);
  });

  it('a document the budget fully covers reports no truncation on its coverage row', async () => {
    const reader = new ScriptedReader([]);
    const result = await readConcepts(HEADED_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const row = result.coverage.find((c) => c.sourcePath === '01 Courses/ABCD101/Notes.md');
    expect(row?.passagesOffered).toBe(row?.passagesRead);
    expect(row?.truncatedByBudget).toBe(false);
  });

  it("the section inventory names the source's own headings, even for sections the budget never let through", async () => {
    const reader = new ScriptedReader([]);
    const result = await readConcepts(HEADED_VAULT, reader, {
      budget: { maxPassages: 2 },
    });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const row = result.coverage.find((c) => c.sourcePath === '01 Courses/ABCD101/Notes.md');
    // Only "Intro"'s passages were actually read (passagesRead: 2), but
    // "Background" still appears — the inventory describes the SOURCE, not
    // what got through the budget.
    expect(row?.sections).toEqual(['Intro', 'Background']);
  });

  it('a document with no headings reports an empty section inventory, never a fabricated one', async () => {
    const reader = new ScriptedReader([]);
    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    for (const row of result.coverage) {
      // BARE_VAULT's notes each carry one top-level heading and one body
      // paragraph under it (see its own fixture comment) — the heading
      // itself names the section.
      expect(row.sections.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('readConcepts — rejected anchors are extraction loss, folded onto the document row, never absence (`ol-egov.141.89.3.12`)', () => {
  const ONE_DOC_VAULT = new MemoryVault({
    '01 Courses/ABCD101/Notes.md': '# Intro\n\nIntro body about Foo.\n',
  });

  it('the reader gave a count: it lands on that document coverage row, not on concepts.length', async () => {
    const reader: ConceptReaderPort = {
      read(request) {
        return Promise.resolve({
          concepts: [proposal('Foo', anchorIn(request.passages[0]?.anchor.sourcePath ?? ''))],
          anchorsRejected: 2,
        });
      },
    };
    const result = await readConcepts(ONE_DOC_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const row = result.coverage.find((c) => c.sourcePath === '01 Courses/ABCD101/Notes.md');
    expect(row?.anchorsRejected).toBe(2);
    // A rejection is never inferred as the concept's absence, and never
    // folds into what the reader actually returned.
    expect(result.concepts).toHaveLength(1);
  });

  it('a reader that names no anchorsRejected count folds as 0, never as a gap (an older port)', async () => {
    const reader = new ScriptedReader([proposal('Foo', anchorIn('01 Courses/ABCD101/Notes.md'))]);
    const result = await readConcepts(ONE_DOC_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const row = result.coverage.find((c) => c.sourcePath === '01 Courses/ABCD101/Notes.md');
    expect(row?.anchorsRejected).toBe(0);
  });

  it('two batches of one split document (`[D-210]`) fold their own rejections onto the SAME row, summed', async () => {
    const SPLIT_VAULT = new MemoryVault({
      '01 Courses/ABCD101/Long.md': 'First half about Torvane.\n\nSecond half about Torvane.\n',
    });
    let call = 0;
    const reader: ConceptReaderPort = {
      read() {
        call += 1;
        return Promise.resolve({ concepts: [], anchorsRejected: call === 1 ? 3 : 1 });
      },
    };

    const result = await readConcepts(SPLIT_VAULT, reader, {
      budget: { maxPassages: 100, passagesPerCall: 1 },
    });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const row = result.coverage.find((c) => c.sourcePath === '01 Courses/ABCD101/Long.md');
    // Two calls belonging to the same document (`calls` would read 2 here)
    // fold their rejection counts onto that one row, exactly the way
    // `calls` itself folds — 3 + 1, never only the last call's count.
    expect(row?.calls).toBe(2);
    expect(row?.anchorsRejected).toBe(4);
  });

  it("a document the run never sends a call for reports 0, never undefined — buildCoverage's own default", async () => {
    const reader = new ScriptedReader([]);
    // Budget of 0 passages: nothing is ever sent to the reader, so the
    // early `no-readable-material` path returns before any call is made.
    const result = await readConcepts(ONE_DOC_VAULT, reader, { budget: { maxPassages: 0 } });

    expect(result.outcome).toBe('unrecognised');
    const row = result.coverage.find((c) => c.sourcePath === '01 Courses/ABCD101/Notes.md');
    expect(row?.anchorsRejected).toBe(0);
  });
});

describe('gatherPassages — passage-grain provenance (`[D-082]`, `[D-085]`)', () => {
  it('every passage anchors to a character range, not merely to a file', async () => {
    const passages = await gatherPassages(BARE_VAULT);

    expect(passages.length).toBeGreaterThan(0);
    for (const passage of passages) {
      // biome-ignore lint/style/noNonNullAssertion: gatherPassages always sets charRange.
      expect(passage.anchor.location.charRange!.end).toBeGreaterThan(
        // biome-ignore lint/style/noNonNullAssertion: gatherPassages always sets charRange.
        passage.anchor.location.charRange!.start,
      );
    }
  });

  it('an anchor resolves back to the exact text it was taken from', async () => {
    const passages = await gatherPassages(BARE_VAULT);
    const passage = passages[0] as ConceptPassage;

    const content = await BARE_VAULT.read(passage.anchor.sourcePath);
    // biome-ignore lint/style/noNonNullAssertion: `gatherPassages` always sets `charRange`.
    const { start, end } = passage.anchor.location.charRange!;

    expect(content.slice(start, end)).toBe(passage.text);
  });

  it('the anchor is the SAME provenance shape instrument citations use — not a second scheme', async () => {
    // `[D-085]`: one passage-identity scheme, not two. This assignment is the
    // check — it stops compiling the day someone introduces a rival shape.
    const passages = await gatherPassages(BARE_VAULT);
    const asProvenance: Provenance | undefined = passages[0]?.anchor;

    expect(asProvenance?.sourcePath).toBeDefined();
    expect(asProvenance?.location.page).toBe(1);
  });

  it('her filing is not read as material — frontmatter is skipped', async () => {
    const vault = new MemoryVault({
      '01 Courses/ABCD101/Note.md': '---\ntopic: Ormathel\n---\n\n# Heading\n\nBody text.\n',
    });

    const passages = await gatherPassages(vault);

    expect(passages.every((p) => !p.text.includes('topic:'))).toBe(true);
    expect(passages.length).toBeGreaterThan(0);
  });

  it('a passage carries its course where one is knowable, and never guesses one', async () => {
    const vault = new MemoryVault({
      '01 Courses/ABCD101/In course.md': '# H\n\nBody.\n',
      'Loose/Note.md': '# H\n\nBody.\n',
    });

    const passages = await gatherPassages(vault);

    const inCourse = passages.filter((p) => p.anchor.sourcePath.startsWith('01 Courses/'));
    const loose = passages.filter((p) => p.anchor.sourcePath.startsWith('Loose/'));
    expect(inCourse.every((p) => p.course === 'ABCD101')).toBe(true);
    expect(loose.every((p) => p.course === undefined)).toBe(true);
  });
});

describe('gatherPassages — section-grain citations for markdown (C3.2, DF-22, ol-2zfj.26)', () => {
  it('a passage under a heading carries that heading text as its section', async () => {
    const vault = new MemoryVault({
      '01 Courses/ABCD101/Note.md': '# Background\n\nOrmathel is the settling of the layer.\n',
    });

    const passages = await gatherPassages(vault);
    const body = passages.find((p) => p.text.includes('Ormathel'));

    expect(body?.anchor.location.section).toBe('Background');
  });

  it('a passage between the top of the note and the first heading carries no section', async () => {
    const vault = new MemoryVault({
      '01 Courses/ABCD101/Note.md': 'Unheaded opening line.\n\n# Background\n\nBody.\n',
    });

    const passages = await gatherPassages(vault);
    const opening = passages.find((p) => p.text.includes('Unheaded'));

    expect(opening?.anchor.location.section).toBeUndefined();
  });

  it('a note with no headings at all carries no section on any passage', async () => {
    const passages = await gatherPassages(BARE_VAULT);
    // BARE_VAULT's own notes DO carry a single top-level heading each; use a
    // heading-free note here instead, same honest-absence rule the docx/pptx
    // extractors already document for section.
    const vault = new MemoryVault({
      '01 Courses/ABCD101/Flat.md': 'Just a paragraph, no heading anywhere.\n',
    });
    const flatPassages = await gatherPassages(vault);

    expect(passages.length).toBeGreaterThan(0); // sanity: BARE_VAULT still yields passages
    expect(flatPassages.every((p) => p.anchor.location.section === undefined)).toBe(true);
  });

  it("a heading's own passage carries its PARENT section, not itself — same rule docx.ts uses", async () => {
    const vault = new MemoryVault({
      '01 Courses/ABCD101/Note.md': '# Background\n\nIntro text.\n\n## Methods\n\nMethods text.\n',
    });

    const passages = await gatherPassages(vault);
    const methodsHeading = passages.find((p) => p.text.trim() === '## Methods');
    const methodsBody = passages.find((p) => p.text.includes('Methods text'));
    const backgroundHeading = passages.find((p) => p.text.trim() === '# Background');

    expect(methodsHeading?.anchor.location.section).toBe('Background');
    expect(methodsBody?.anchor.location.section).toBe('Methods');
    expect(backgroundHeading?.anchor.location.section).toBeUndefined();
  });

  it('a section deep in the tree resolves to its own nearest heading, not the root', async () => {
    const vault = new MemoryVault({
      '01 Courses/ABCD101/Note.md':
        '# Unit One\n\n## Background\n\n### Prior work\n\nCited findings.\n',
    });

    const passages = await gatherPassages(vault);
    const nested = passages.find((p) => p.text.includes('Cited findings'));

    expect(nested?.anchor.location.section).toBe('Prior work');
  });
});

// ---------------------------------------------------------------------------
// [REL-1] / [EXT-6] — relations recovered as part of extraction itself,
// reconciled against the concepts the same read returned.
// ---------------------------------------------------------------------------

describe('readConcepts — relations (C7.10, [REL-1], [EXT-6])', () => {
  it('a port that supplies no relations field reads exactly as before it existed', async () => {
    const reader = new ScriptedReader([
      proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
    ]);
    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    expect(result.relations).toEqual([]);
    expect(result.relationsDropped).toBe(0);
  });

  it('an is-a / part-of relation between two concepts the same read returned is emitted', async () => {
    // Both endpoints anchored to the SAME document (`[D-210]`, `ol-2zfj.62`):
    // a per-document relation can only be proposed by a call that saw both
    // concepts, and calls are now per document unconditionally.
    const reader = new ScriptedReader(
      [
        proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
        proposal('Quintaris', anchorIn('01 Courses/ABCD101/Lecture One.md')),
      ],
      [{ type: 'part-of', from: 'Ormathel', to: 'Quintaris', confidence: 0.9 }],
    );
    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({
      type: 'part-of',
      from: 'Ormathel',
      to: 'Quintaris',
    });
    expect(result.relationsDropped).toBe(0);
  });

  it('a relation naming a concept the concept call never returned is dropped and counted, never minted', async () => {
    const reader = new ScriptedReader(
      [proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md'))],
      [{ type: 'part-of', from: 'Ormathel', to: 'A name nothing proposed', confidence: 0.9 }],
    );
    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    expect(result.relations).toEqual([]);
    expect(result.relationsDropped).toBe(1);
    // The concept set is authoritative: no second concept appeared.
    expect(result.concepts.map((c) => c.name)).toEqual(['Ormathel']);
  });

  it('contrasts-with and prerequisite never reach the emitted set from the per-document stage, even if proposed', async () => {
    // Same-document anchors as above — a real per-document call can only
    // propose a relation between two concepts it saw together.
    const reader = new ScriptedReader(
      [
        proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
        proposal('Quintaris', anchorIn('01 Courses/ABCD101/Lecture One.md')),
      ],
      [
        { type: 'contrasts-with', from: 'Ormathel', to: 'Quintaris', confidence: 0.9 },
        { type: 'prerequisite', from: 'Ormathel', to: 'Quintaris', confidence: 0.9 },
      ],
    );
    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    expect(result.relations).toEqual([]);
    expect(result.relationsDropped).toBe(2);
  });

  it("part-of's named reader: the container concept's size is refined toward coarse", async () => {
    const reader = new ScriptedReader(
      [
        // A single anchor each — on measured extent alone, both are 'fine'.
        proposal('Part', anchorIn('01 Courses/ABCD101/Lecture One.md')),
        proposal('Whole', anchorIn('01 Courses/ABCD101/Lecture Two.md')),
      ],
      [{ type: 'part-of', from: 'Part', to: 'Whole', confidence: 0.9 }],
    );
    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const whole = result.concepts.find((c) => c.name === 'Whole');
    const part = result.concepts.find((c) => c.name === 'Part');
    expect(whole?.size.band).toBe('coarse');
    expect(whole?.size.extent.containmentEvidence).toBe(true);
    // The contained concept itself is not touched by this edge.
    expect(part?.size.band).toBe('fine');
  });

  it("is-a's canonical endpoint reading: `to` is the supertype, and it is the one whose size is refined (ol-2zfj.17)", async () => {
    // Same containment fold as part-of above, pinning the OTHER directed
    // type `../relation.js`'s `ProposedRelation` doc names: "X is-a Y" means
    // `from: X` (the subtype), `to: Y` (the supertype/kind-of it names) —
    // never the reverse. `applyContainmentEvidence` folds onto whichever
    // concept is named by `to`, so a swapped edge would mark the SUBTYPE
    // coarse instead of the supertype.
    const reader = new ScriptedReader(
      [
        proposal('Sparrow', anchorIn('01 Courses/ABCD101/Lecture One.md')),
        proposal('Bird', anchorIn('01 Courses/ABCD101/Lecture Two.md')),
      ],
      [{ type: 'is-a', from: 'Sparrow', to: 'Bird', confidence: 0.9 }],
    );
    const result = await readConcepts(BARE_VAULT, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const supertype = result.concepts.find((c) => c.name === 'Bird');
    const subtype = result.concepts.find((c) => c.name === 'Sparrow');
    // The supertype (`to`) is the one containment evidence lands on.
    expect(supertype?.size.band).toBe('coarse');
    expect(supertype?.size.extent.containmentEvidence).toBe(true);
    // The subtype (`from`) is untouched by this edge.
    expect(subtype?.size.band).toBe('fine');
  });

  it('a relation whose endpoint is filing-only (no passage anchor) is dropped for missing passage-grain provenance', async () => {
    const vault = new MemoryVault({
      '01 Courses/ABCD101/Lecture One.md':
        '---\ntopic: Ormathel\ncourse: ABCD101\n---\n\n# Opening\n\nUnrelated body text.\n',
    });
    // The reader never surfaces Ormathel from a passage — it is returned
    // un-anchored purely from her `topic` convention (see the "her
    // conventions never lose a concept" describe block above).
    const reader = new ScriptedReader(
      [proposal('Quintaris', anchorIn('01 Courses/ABCD101/Lecture One.md'))],
      [{ type: 'part-of', from: 'Ormathel', to: 'Quintaris', confidence: 0.9 }],
    );
    const result = await readConcepts(vault, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
    if (result.outcome !== 'read') return;
    const ormathel = result.concepts.find((c) => c.name === 'Ormathel');
    expect(ormathel?.anchor).toBeUndefined();
    expect(result.relations).toEqual([]);
    expect(result.relationsDropped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ol-fkya / [EXT-9] — non-markdown material (F1.6, F3.1) reaches the reading
// stage, with page-grain provenance, fair budget allocation across documents,
// duplicate-filing collapsed by content hash, and no metadata surfaced.
// ---------------------------------------------------------------------------

describe('gatherPassages — non-markdown material (F1.6, F3.1, ol-fkya)', () => {
  const vaultRoot = new URL('../../fixtures/vault', import.meta.url).pathname;
  const vault = new FolderSource(vaultRoot);

  it("an embedded PDF (F1.6) reaches the reading stage with page-grain provenance and the embedding note's course", async () => {
    const passages = await gatherPassages(vault, { under: '01 Courses/GEOL204/WEEK 2' });

    const deck = passages.find((p) => p.anchor.sourcePath.endsWith('Geol204-Week2-Slides.pdf'));
    expect(deck).toBeDefined();
    expect(deck?.text).toBe('GEOL204 Week 2 - Stratigraphic succession');
    expect(deck?.anchor.location.page).toBe(1);
    expect(deck?.anchor.location.charRange?.end).toBeGreaterThan(0);
    expect(deck?.anchor.embeddedIn?.notePath).toBe(
      '01 Courses/GEOL204/WEEK 2/Lecture - Deposition & Bedform Stratification.md',
    );
    expect(deck?.course).toBe('GEOL204');
  });

  it('markdown passages from the same scope are unaffected by the embedded PDF sharing it', async () => {
    const passages = await gatherPassages(vault, { under: '01 Courses/GEOL204/WEEK 2' });

    const markdownHeading = passages.find(
      (p) =>
        p.anchor.sourcePath.endsWith('.md') &&
        p.text.includes('Deposition & Bedform Stratification'),
    );
    expect(markdownHeading).toBeDefined();
    // The embed line itself is still offered as an ordinary markdown block —
    // gathering the deck's own content is additive, never a replacement.
    expect(passages.some((p) => p.text.includes('![[Geol204-Week2-Slides.pdf]]'))).toBe(true);
  });

  it('a PDF dropped directly into the vault with no embedding note (F3.1) also reaches the reading stage', async () => {
    const passages = await gatherPassages(vault, { under: '01 Courses/GEOL204/WEEK 3' });

    const hybrid = passages.filter((p) => p.anchor.sourcePath.endsWith('hybrid-pages-node.pdf'));
    const xref = passages.filter((p) => p.anchor.sourcePath.endsWith('xref-stream-only.pdf'));
    expect(hybrid).toHaveLength(3);
    expect(xref).toHaveLength(3);
    // Standalone material carries no embedding note — there isn't one.
    expect(hybrid.every((p) => p.anchor.embeddedIn === undefined)).toBe(true);
    expect(hybrid.map((p) => p.anchor.location.page).sort()).toEqual([1, 2, 3]);
    expect(hybrid.every((p) => p.course === 'GEOL204')).toBe(true);
    expect(
      hybrid.some(
        (p) =>
          p.text ===
          'Hybrid page tree fixture, page one. Only the branch pages node is compressed.',
      ),
    ).toBe(true);
  });

  it('no PDF/PPTX/DOCX metadata field exists on a passage to surface (ol-pdfmeta)', async () => {
    const passages = await gatherPassages(vault, { under: '01 Courses/GEOL204/WEEK 3' });
    const deck = passages.find((p) => p.anchor.sourcePath.endsWith('.pdf'));
    expect(deck).toBeDefined();
    // `ConceptPassage` has exactly these three fields — there is no fourth
    // place a document's Author/Title/Producer could ride along on.
    expect(deck && Object.keys(deck).sort()).toEqual(['anchor', 'course', 'text']);
  });
});

describe('gatherPassages — duplicate filing collapses by content hash (ol-n0yc)', () => {
  it('the same bytes filed at two vault paths are extracted once, not twice', async () => {
    const bytes = buildOnePagePdfBytes('Duplicate-filed deck content');
    const vault = new BinaryVault(
      {
        '01 Courses/DUPX101/Lecture.md': '# Lecture\n\n![[deck.pdf]]\n',
      },
      {
        // Embedded copy — resolves via `![[deck.pdf]]` above.
        '01 Courses/DUPX101/deck.pdf': bytes,
        // A second, standalone copy of the identical bytes at another path
        // — the "filed twice" shape `ol-n0yc` names, discovered via the F3.1
        // sweep rather than any embed.
        '01 Courses/DUPX101/Archive/deck-copy.pdf': bytes,
      },
    );

    const passages = await gatherPassages(vault);
    const deckPassages = passages.filter((p) => p.text === 'Duplicate-filed deck content');

    expect(deckPassages).toHaveLength(1);
    // The lexicographically-first path is canonical.
    expect(deckPassages[0]?.anchor.sourcePath).toBe('01 Courses/DUPX101/Archive/deck-copy.pdf');
    expect(deckPassages[0]?.course).toBe('DUPX101');
  });
});

describe('gatherPassages — unextractable material degrades cleanly (no invented text)', () => {
  it('a file this stage cannot read contributes zero passages and does not throw, and other material is unaffected', async () => {
    const vault = new BinaryVault(
      {
        '01 Courses/BADX101/Lecture.md': '# Lecture\n\n![[garbage.pdf]]\n\nOrdinary body text.\n',
      },
      { '01 Courses/BADX101/garbage.pdf': buildUnreadableBytes() },
    );

    const passages = await gatherPassages(vault);

    expect(passages.some((p) => p.anchor.sourcePath.endsWith('garbage.pdf'))).toBe(false);
    // Nothing invented for it, and the rest of the vault still reads fine.
    expect(passages.some((p) => p.text.includes('Ordinary body text.'))).toBe(true);
  });

  it('readConcepts still runs to completion over a vault containing unreadable material', async () => {
    const vault = new BinaryVault(
      {
        '01 Courses/BADX101/Lecture.md': '# Lecture\n\n![[garbage.pdf]]\n\nOrdinary body text.\n',
      },
      { '01 Courses/BADX101/garbage.pdf': buildUnreadableBytes() },
    );
    const reader = new ScriptedReader([]);

    const result = await readConcepts(vault, reader, { budget: BUDGET });

    expect(result.outcome).toBe('read');
  });
});

describe('readConcepts — budget allocation does not let one document starve the rest (DF-22, ol-fkya)', () => {
  const vaultRoot = new URL('../../fixtures/vault', import.meta.url).pathname;
  const vault = new FolderSource(vaultRoot);

  it('a tight budget still reaches every document in scope, decks included', async () => {
    const reader = new ScriptedReader([]);
    // WEEK 3 holds four markdown notes and two standalone PDFs — six
    // distinct documents. Positional truncation from the largest markdown
    // note alone would exhaust a budget of 10 before either PDF, or three of
    // the four notes, ever appeared in a request.
    const result = await readConcepts(vault, reader, {
      budget: { maxPassages: 10 },
      under: '01 Courses/GEOL204/WEEK 3',
    });

    expect(result.truncatedByBudget).toBe(true);
    expect(result.passagesRead).toBe(10);
    const sourcesRepresented = result.coverage.filter((c) => c.passagesRead > 0);
    // Nine, not six: `[D-248]` puts the three notes WEEK 3's own notes link
    // out to into the reading set as well, each as its own document.
    expect(sourcesRepresented).toHaveLength(9);
    const decksRepresented = sourcesRepresented.filter((c) => c.sourcePath.endsWith('.pdf'));
    expect(decksRepresented).toHaveLength(2);
  });
});

// `[D-248]` (`ol-3ux7.5.61`), implemented by `ol-3ux7.5.62`. The reading set a
// scoped gather offers is the course folder PLUS one outward hop — and each
// reachable note is offered as its own document with its own anchors, never
// spliced into the note that linked it (`[D-210]`).
describe('gatherPassages — one-hop outward link closure (`[D-248]`)', () => {
  const vaultRoot = new URL('../../fixtures/vault', import.meta.url).pathname;
  const vault = new FolderSource(vaultRoot);

  it('a scope-restricted gather still offers the notes those notes link out to', async () => {
    const passages = await gatherPassages(vault, { under: '01 Courses/GEOL204/WEEK 1' });
    const sources = new Set(passages.map((p) => p.anchor.sourcePath));

    // Linked from WEEK 1's own lectures, and outside the scope it was given.
    expect(sources).toContain('05 Zettelkasten/Imbrication.md');
    expect(sources).toContain('05 Zettelkasten/Paraconformity.md');
    // Nothing the scope's notes link to reaches a second hop: Imbrication's
    // own links are not followed.
    expect(sources).not.toContain('05 Zettelkasten/Tierce picarde.md');
    // Not spliced: the linked note's text arrives under the linked note's own
    // path, never inside a passage anchored at the note that linked it.
    const imbrication = passages.filter(
      (p) => p.anchor.sourcePath === '05 Zettelkasten/Imbrication.md',
    );
    expect(imbrication.length).toBeGreaterThan(0);
    // Its course is whatever the note says about ITSELF (this fixture note
    // carries `course: [GEOL204]` in its own frontmatter) or nothing at all —
    // never a course inherited from whatever linked it. That is what keeps
    // item 2 true here: reachability adds material, never course membership.
    expect(imbrication.every((p) => p.course === 'GEOL204')).toBe(true);
  });

  it('the cap bounds the closure, silently', async () => {
    const withCap = await gatherPassages(vault, {
      under: '01 Courses/GEOL204/WEEK 1',
      closureDocumentCap: 1,
    });
    const closureSources = new Set(
      withCap.map((p) => p.anchor.sourcePath).filter((path) => path.startsWith('05 Zettelkasten/')),
    );
    expect(closureSources.size).toBe(1);
  });
});
