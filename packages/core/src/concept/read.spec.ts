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
  gatherPassages,
  type ProposedConcept,
  readConcepts,
} from './read.js';

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

/** A reader that returns a fixed set and records every request it was handed. */
class ScriptedReader implements ConceptReaderPort {
  readonly requests: ConceptReadRequest[] = [];
  constructor(private readonly concepts: readonly ProposedConcept[]) {}
  read(request: ConceptReadRequest): Promise<{ concepts: readonly ProposedConcept[] }> {
    this.requests.push(request);
    return Promise.resolve({ concepts: this.concepts });
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
