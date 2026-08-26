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

/** A reader that returns a fixed set and records every request it was handed. */
class ScriptedReader implements ConceptReaderPort {
  readonly requests: ConceptReadRequest[] = [];
  constructor(
    private readonly concepts: readonly ProposedConcept[],
    private readonly relations?: readonly ProposedRelation[],
  ) {}
  read(request: ConceptReadRequest): Promise<ConceptReadResponse> {
    this.requests.push(request);
    return Promise.resolve(
      this.relations !== undefined
        ? { concepts: this.concepts, relations: this.relations }
        : { concepts: this.concepts },
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

  const NOTED_VAULT = new MemoryVault({
    '01 Courses/ABCD101/Lecture One.md':
      '---\ntopic: Ormathel settling\ncourse: ABCD101\n---\n\n# Opening\n\nThe settling of the layer.\n',
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

describe('gatherPassages — passage-grain provenance (`[D-082]`, `[D-085]`)', () => {
  it('every passage anchors to a character range, not merely to a file', async () => {
    const passages = await gatherPassages(BARE_VAULT);

    expect(passages.length).toBeGreaterThan(0);
    for (const passage of passages) {
      expect(passage.anchor.location.charRange.end).toBeGreaterThan(
        passage.anchor.location.charRange.start,
      );
    }
  });

  it('an anchor resolves back to the exact text it was taken from', async () => {
    const passages = await gatherPassages(BARE_VAULT);
    const passage = passages[0] as ConceptPassage;

    const content = await BARE_VAULT.read(passage.anchor.sourcePath);
    const { start, end } = passage.anchor.location.charRange;

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
    const reader = new ScriptedReader(
      [
        proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
        proposal('Quintaris', anchorIn('01 Courses/ABCD101/Lecture Two.md')),
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
    const reader = new ScriptedReader(
      [
        proposal('Ormathel', anchorIn('01 Courses/ABCD101/Lecture One.md')),
        proposal('Quintaris', anchorIn('01 Courses/ABCD101/Lecture Two.md')),
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
    expect(deck?.anchor.location.charRange.end).toBeGreaterThan(0);
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
    expect(sourcesRepresented).toHaveLength(6);
    const decksRepresented = sourcesRepresented.filter((c) => c.sourcePath.endsWith('.pdf'));
    expect(decksRepresented).toHaveLength(2);
  });
});
