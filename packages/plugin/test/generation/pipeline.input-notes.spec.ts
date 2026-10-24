/**
 * `ol-egov.141.89.2.39` ([D-626], [D-628]): a drafted item records every note its request was drawn
 * from, with a fingerprint of the material supplied, and cites the note it was drawn from.
 *
 * Scenarios (service repo, `features/F3-learn-from-anything.md`, "Feature: F3.3 / C5.3 — a drafted
 * item records every note it was drawn from, and each protects it"), written before this code:
 *  - "a draft records one entry per note its request's chunks came from";
 *  - "a note whose indexed text is not its current text supplies nothing";
 *  - "a draft drawn from one note cites that note";
 *  - "only a genuinely single-passage request keeps passage grain".
 *
 * Everything runs through the production pieces: `runGenerationSweep` with its default drafting
 * call (`draftQuizCardsForConcept`), a keyword index built by `olea-core`'s own indexers over a
 * synthetic vault, and the vault handed to the drafting deps as `main.ts` hands it. Only retrieval's
 * ranking is replaced (`retrieve`, so each test chooses which chunks ground the request) and the
 * Worker transport is a double that answers the drafting task and counts its sends. The first test
 * is the check the brief asks for before anything is built on the index: a freshly indexed note and
 * binary carry the hash of their current content. Every note, file and sentence is invented.
 */
import type { ConceptRecord, ExtractedUnit, PersistedKeywordIndex } from 'olea-core';
import {
  DEFAULT_COURSES_FOLDER,
  digestPassage,
  hashContent,
  hashText,
  indexDocument,
  readInstrumentCitationRecord,
} from 'olea-core';
import { indexBinaryBytes } from 'olea-core/src/keyword-index/build.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import {
  draftInputNotesHold,
  inputNoteFingerprint,
  inputNotesOfSuppliedChunks,
} from '../../src/generation/input-notes.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import { computeMaterialityHashes } from '../../src/ingestion/materiality/hashes.js';
import type { DraftQuizCardsDeps } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVault } from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

/** The chunks the next `retrieve()` grounds the request in — set per test. */
const grounding = vi.hoisted(() => ({
  chunks: [] as { path: string; blockIndex: number; text: string }[],
}));

vi.mock('olea-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('olea-core')>();
  return {
    ...actual,
    retrieve: async () => ({ status: 'grounded' as const, chunks: grounding.chunks }),
  };
});

const COURSE = 'COURSEA';
const FOLDER = `${DEFAULT_COURSES_FOLDER}/${COURSE}`;
const CONCEPT_NOTE = `${FOLDER}/Week 1.md`;
const NOTE_A = `${FOLDER}/Week 2.md`;
const NOTE_B = `${FOLDER}/Week 3.md`;
const NOTE_C = `${FOLDER}/Week 4.md`;
const SLIDES = `${FOLDER}/Slides 5.pdf`;

const A1 = 'Invented layers settle in order of their grain size.';
const A2 = 'Invented currents slow down where the channel widens.';
const B1 = 'Invented ripples form under a steady shallow flow.';
const B2 = 'Invented dunes migrate when the flow strengthens.';
const C1 = 'Invented mud drapes mark the pauses between floods.';

const noteOf = (title: string, ...paragraphs: string[]): string =>
  `---\ncourse: ${COURSE}\n---\n\n# ${title}\n\n${paragraphs.join('\n\n')}\n`;

/** A text-layer PDF, one content stream per page, in the shape `olea-core`'s PDF extractor reads. */
function pdfBytes(pages: readonly string[]): Uint8Array {
  const escapePdf = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  pages.forEach((text, i) => {
    const raw = `BT /F1 12 Tf 20 150 Td (${escapePdf(text)}) Tj ET`;
    objects.push(
      `${4 + i * 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
      `${5 + i * 2} 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
    );
  });
  const text = `%PDF-1.4\n${objects.join('')}trailer\n<< /Size ${4 + pages.length * 2} /Root 1 0 R >>\nstartxref\n0\n%%EOF`;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

const concept: ConceptRecord = {
  key: 'key-invented-layers',
  name: 'Invented layering',
  tier: 2,
  courses: [COURSE],
  sourcePaths: [CONCEPT_NOTE],
};

/** Her note landing (an authored note, `[D-214]`): the concept's own note, with no embedding note. */
const landed: ExtractedUnit = {
  text: 'the sweep never reads unit text',
  provenance: { sourcePath: CONCEPT_NOTE, location: { page: 1, charRange: { start: 0, end: 1 } } },
};

function world(): MemoryVault {
  const vault = new MemoryVault();
  vault.files.set(CONCEPT_NOTE, noteOf('Week 1', 'The concept note says little the drafts use.'));
  vault.files.set(NOTE_A, noteOf('Week 2', A1, A2));
  vault.files.set(NOTE_B, noteOf('Week 3', B1, B2));
  vault.files.set(NOTE_C, noteOf('Week 4', C1));
  vault.binaries.set(SLIDES, pdfBytes([B1, B2]));
  return vault;
}

/** The index as the engine builds it: each note by `indexDocument`, the slides by `indexBinaryBytes`. */
async function indexOf(vault: MemoryVault): Promise<PersistedKeywordIndex> {
  const documents = [];
  for (const path of [CONCEPT_NOTE, NOTE_A, NOTE_B, NOTE_C]) {
    documents.push(await indexDocument(vault, path));
  }
  documents.push(
    await indexBinaryBytes(
      { path: SLIDES, format: 'pdf', courses: [COURSE] },
      await vault.readBinary(SLIDES),
    ),
  );
  return { version: 1, documents: documents.sort((a, b) => a.path.localeCompare(b.path)) };
}

/** A chunk of `path` whose text is `text`, at the block the index holds it in. */
function chunkOf(index: PersistedKeywordIndex, path: string, text: string) {
  const block = index.documents
    .find((document) => document.path === path)
    ?.blocks.find((candidate) => candidate.text === text);
  if (block === undefined) throw new Error(`no indexed block for ${path}`);
  return { path, blockIndex: block.blockIndex, text };
}

interface Drafting {
  readonly deps: DraftQuizCardsDeps;
  readonly generationSends: () => number;
}

/** Drafting deps as `main.ts` composes them (index snapshot, transport, vault), with a Worker double. */
function draftingOver(
  vault: MemoryVault,
  index: PersistedKeywordIndex,
  groundedIn: readonly (readonly number[] | undefined)[] = [undefined],
): Drafting {
  let sends = 0;
  return {
    deps: {
      retrieve: {
        keywordIndex: index,
        embeddingCache: {} as never,
        embeddingProvider: {} as never,
      },
      transport: {
        send: async (request: { taskId: string }) => {
          if (request.taskId !== 'quiz.generate.v1') throw new Error('unexpected task');
          sends += 1;
          return {
            ok: true,
            stamp: { contractVersion: 1, promptVersion: '2.5.0', modelId: 'test-model' },
            result: {
              questions: groundedIn.map((cited, i) => ({
                stem: `Which invented statement holds? (${i})`,
                correctAnswer: 'Alpha',
                distractors: ['Beta', 'Gamma', 'Delta'],
                feedback: 'See the invented notes.',
                ...(cited === undefined ? {} : { groundedIn: cited }),
              })),
            },
          };
        },
      } as never,
      vault,
    },
    generationSends: () => sends,
  };
}

async function sweep(
  vault: MemoryVault,
  drafting: Drafting,
  options: { readonly citedChunkDigest?: boolean } = {},
) {
  const cache = createVaultDraftCacheStore(vault);
  const report = await runGenerationSweep([landed], {
    vault,
    cache,
    draftDeps: drafting.deps,
    listConceptsForCourse: async () => [concept],
    now: () => new Date('2026-10-24T09:00:00.000Z'),
    ...options,
  });
  const pending = [...(await cache.listPending())].sort((a, b) =>
    (a.question?.stem ?? '').localeCompare(b.question?.stem ?? ''),
  );
  return { cache, report, pending };
}

const markdownFingerprint = async (vault: MemoryVault, path: string) =>
  (await computeMaterialityHashes(await vault.read(path))).canonicalHash;

beforeEach(() => {
  grounding.chunks = [];
});

describe('the index the fingerprint is checked against (verified before building on it)', () => {
  it('a freshly indexed note and binary carry the hash of their current content, and the check reads them as current', async () => {
    const vault = world();
    const index = await indexOf(vault);
    const note = index.documents.find((document) => document.path === NOTE_A);
    const slides = index.documents.find((document) => document.path === SLIDES);
    expect(note?.contentHash).toBe(await hashText(await vault.read(NOTE_A)));
    expect(slides?.contentHash).toBe(await hashContent(await vault.readBinary(SLIDES)));
    expect(slides?.blocks.length).toBeGreaterThan(0);

    expect(await inputNotesOfSuppliedChunks(vault, index, [NOTE_A, SLIDES, NOTE_A])).toEqual({
      kind: 'current',
      inputNotes: [
        { path: NOTE_A, contentHash: await markdownFingerprint(vault, NOTE_A) },
        { path: SLIDES, contentHash: await hashContent(await vault.readBinary(SLIDES)) },
      ],
    });
  });

  it('a note or binary changed since it was indexed, or one the index does not hold, reads as changed', async () => {
    const vault = world();
    const index = await indexOf(vault);
    vault.files.set(NOTE_A, noteOf('Week 2', A1, 'An invented sentence added since indexing.'));
    expect(await inputNotesOfSuppliedChunks(vault, index, [NOTE_A])).toEqual({ kind: 'changed' });
    vault.binaries.set(SLIDES, pdfBytes([B1, 'An invented second slide.']));
    expect(await inputNotesOfSuppliedChunks(vault, index, [SLIDES])).toEqual({ kind: 'changed' });
    expect(await inputNotesOfSuppliedChunks(vault, index, [`${FOLDER}/Never indexed.md`])).toEqual({
      kind: 'changed',
    });
  });
});

describe('a draft records one entry per note its request’s chunks came from', () => {
  it('three notes, two chunks from one: every draft lists the three, once each, with each note’s fingerprint', async () => {
    const vault = world();
    const index = await indexOf(vault);
    grounding.chunks = [
      chunkOf(index, NOTE_A, A1),
      chunkOf(index, NOTE_B, B1),
      chunkOf(index, NOTE_A, A2),
      chunkOf(index, NOTE_C, C1),
    ];
    const { pending } = await sweep(vault, draftingOver(vault, index, [undefined, undefined]));

    expect(pending).toHaveLength(2);
    const expected = [
      { path: NOTE_A, contentHash: await markdownFingerprint(vault, NOTE_A) },
      { path: NOTE_B, contentHash: await markdownFingerprint(vault, NOTE_B) },
      { path: NOTE_C, contentHash: await markdownFingerprint(vault, NOTE_C) },
    ];
    for (const record of pending) expect(record.inputNotes).toEqual(expected);
  });

  it('the fingerprint is the whole-note check’s material: frontmatter counts, question blocks and formatting do not', async () => {
    const vault = world();
    const before = await inputNoteFingerprint(vault, NOTE_A);
    expect(before).toBe(await markdownFingerprint(vault, NOTE_A));

    vault.files.set(
      NOTE_A,
      `${await vault.read(NOTE_A)}\nQ: An invented question?::An invented answer.\n`,
    );
    expect(await inputNoteFingerprint(vault, NOTE_A)).toBe(before);

    vault.files.set(NOTE_A, noteOf('Week 2', `**${A1}**`, `   ${A2}`));
    expect(await inputNoteFingerprint(vault, NOTE_A)).toBe(before);

    vault.files.set(
      NOTE_A,
      `---\ncourse: ${COURSE}\nstatus: revised\n---\n\n# Week 2\n\n${A1}\n\n${A2}\n`,
    );
    expect(await inputNoteFingerprint(vault, NOTE_A)).not.toBe(before);
  });
});

describe('a note whose indexed text is not its current text supplies nothing', () => {
  it('no drafting request is sent and nothing is cached; once the index holds the note’s current text it is drafted as usual', async () => {
    const vault = world();
    const staleIndex = await indexOf(vault);
    grounding.chunks = [chunkOf(staleIndex, NOTE_A, A1), chunkOf(staleIndex, NOTE_B, B1)];
    vault.files.set(
      NOTE_B,
      noteOf('Week 3', B1, B2, 'An invented paragraph added since indexing.'),
    );

    const stale = draftingOver(vault, staleIndex);
    const first = await sweep(vault, stale);
    expect(stale.generationSends()).toBe(0);
    expect(first.pending).toEqual([]);
    expect(first.report).toMatchObject({ attempted: 1, drafted: 0, refused: 0 });
    expect(first.report.refusals).toEqual([]);

    const freshIndex = await indexOf(vault);
    grounding.chunks = [chunkOf(freshIndex, NOTE_A, A1), chunkOf(freshIndex, NOTE_B, B1)];
    const fresh = draftingOver(vault, freshIndex);
    const second = await sweep(vault, fresh);
    expect(fresh.generationSends()).toBe(1);
    expect(second.report).toMatchObject({ attempted: 1, drafted: 1 });
    expect(second.pending[0]?.inputNotes?.map((note) => note.path)).toEqual([NOTE_A, NOTE_B]);
  });
});

describe('a draft drawn from one note cites that note', () => {
  it('chunks all from a note that is not the concept’s: the citation names that note as a note is cited', async () => {
    const vault = world();
    const index = await indexOf(vault);
    grounding.chunks = [chunkOf(index, NOTE_B, B1), chunkOf(index, NOTE_B, B2)];
    const { pending } = await sweep(vault, draftingOver(vault, index, [undefined, undefined]));

    expect(pending).toHaveLength(2);
    for (const record of pending) {
      expect(record.sourceCitation).toEqual({ sourcePath: NOTE_B, page: 1 });
      expect(record.inputNotes?.map((note) => note.path)).toEqual([NOTE_B]);
      expect(JSON.stringify(record.sourceCitation)).not.toContain(CONCEPT_NOTE);
    }
  });

  it('chunks all from a slide deck: the citation names the deck, its page and the bytes revision drawn from', async () => {
    const vault = world();
    const index = await indexOf(vault);
    const slides = index.documents.find((document) => document.path === SLIDES);
    grounding.chunks = (slides?.blocks ?? []).map((block) => ({
      path: SLIDES,
      blockIndex: block.blockIndex,
      text: block.text,
    }));
    const { pending } = await sweep(vault, draftingOver(vault, index));

    const revision = await hashContent(await vault.readBinary(SLIDES));
    expect(pending[0]?.sourceCitation).toEqual({
      sourcePath: SLIDES,
      page: 1,
      sourceRevision: revision,
    });
    expect(pending[0]?.inputNotes).toEqual([{ path: SLIDES, contentHash: revision }]);
  });

  it('the concept’s note is named only when it supplied the chunks', async () => {
    const vault = world();
    const index = await indexOf(vault);
    const own = index.documents.find((document) => document.path === CONCEPT_NOTE)?.blocks.at(-1);
    if (own === undefined) throw new Error('the concept note has no block');
    grounding.chunks = [{ path: CONCEPT_NOTE, blockIndex: own.blockIndex, text: own.text }];
    const { pending } = await sweep(vault, draftingOver(vault, index));
    expect(pending[0]?.sourceCitation?.sourcePath).toBe(CONCEPT_NOTE);
  });
});

// `ol-egov.141.89.2.39` (finding J; [D-628]'s citation rule): a draft drawn from several notes still
// cites one it was drawn from — internally only, since the clearing list shows the "Sources" list.
describe('a draft drawn from several notes cites one of them, never a note it was not drawn from', () => {
  const conceptChunk = (index: PersistedKeywordIndex) => {
    const own = index.documents.find((document) => document.path === CONCEPT_NOTE)?.blocks.at(-1);
    if (own === undefined) throw new Error('the concept note has no block');
    return { path: CONCEPT_NOTE, blockIndex: own.blockIndex, text: own.text };
  };

  it('the concept’s note supplied nothing: the note that supplied the most chunks', async () => {
    const vault = world();
    const index = await indexOf(vault);
    grounding.chunks = [
      chunkOf(index, NOTE_A, A1),
      chunkOf(index, NOTE_B, B1),
      chunkOf(index, NOTE_B, B2),
    ];
    const { pending } = await sweep(vault, draftingOver(vault, index));
    expect(pending[0]?.inputNotes?.map((note) => note.path)).toEqual([NOTE_A, NOTE_B]);
    expect(pending[0]?.sourceCitation).toEqual({ sourcePath: NOTE_B, page: 1 });
  });

  it('a tie on chunks: the note retrieval ranked first', async () => {
    const vault = world();
    const index = await indexOf(vault);
    grounding.chunks = [chunkOf(index, NOTE_C, C1), chunkOf(index, NOTE_A, A1)];
    const { pending } = await sweep(vault, draftingOver(vault, index));
    expect(pending[0]?.sourceCitation).toEqual({ sourcePath: NOTE_C, page: 1 });
  });

  it('the concept’s note is one of them: it is the one cited, whatever the others supplied', async () => {
    const vault = world();
    const index = await indexOf(vault);
    grounding.chunks = [
      chunkOf(index, NOTE_B, B1),
      chunkOf(index, NOTE_B, B2),
      conceptChunk(index),
    ];
    const { pending } = await sweep(vault, draftingOver(vault, index));
    expect(pending[0]?.inputNotes?.map((note) => note.path)).toEqual([NOTE_B, CONCEPT_NOTE]);
    expect(pending[0]?.sourceCitation?.sourcePath).toBe(CONCEPT_NOTE);
    expect(pending[0]?.sourceCitation?.passageDigest).toBeUndefined();
  });
});

describe('only a genuinely single-passage request keeps passage grain', () => {
  it('one chunk that is exactly one passage of its note: that passage’s digest, protected at passage grain', async () => {
    const vault = world();
    const index = await indexOf(vault);
    grounding.chunks = [chunkOf(index, NOTE_B, B2)];
    const { pending, cache } = await sweep(vault, draftingOver(vault, index));

    const record = pending[0];
    expect(record?.sourceCitation).toEqual({
      sourcePath: NOTE_B,
      page: 1,
      passageDigest: await digestPassage(B2),
    });
    // Passage grain for its note: an edit elsewhere in the note withholds nothing, an edit to the
    // passage does.
    vault.files.set(NOTE_B, noteOf('Week 3', 'An invented first paragraph, rewritten.', B2));
    expect(await draftInputNotesHold(vault, record?.sourceCitation, record?.inputNotes)).toBe(true);
    vault.files.set(NOTE_B, noteOf('Week 3', B1, 'Invented dunes stall when the flow weakens.'));
    expect(await draftInputNotesHold(vault, record?.sourceCitation, record?.inputNotes)).toBe(
      false,
    );

    // Kept, the digest is the one written, with the one input note.
    vault.files.set(NOTE_B, noteOf('Week 3', B1, B2));
    if (record === undefined) throw new Error('no draft');
    const { instrumentId } = await createDraftAcceptPort({
      vault,
      cache,
      deviceId: 'device-a',
    }).accept(record.draftId, 'accepted');
    const citation = await readInstrumentCitationRecord(vault, instrumentId);
    expect(citation?.passageDigest).toBe(await digestPassage(B2));
    expect(citation?.inputNotes?.map((note) => note.path)).toEqual([NOTE_B]);
  });

  it('several chunks: no digest, whatever the response cites and whatever the cited-chunk switch says', async () => {
    for (const citedChunkDigest of [false, true]) {
      const vault = world();
      const index = await indexOf(vault);
      grounding.chunks = [chunkOf(index, NOTE_B, B1), chunkOf(index, NOTE_B, B2)];
      const { pending, cache } = await sweep(vault, draftingOver(vault, index, [[1], [0]]), {
        citedChunkDigest,
      });
      expect(pending).toHaveLength(2);
      for (const record of pending) {
        expect(record.sourceCitation).toEqual({ sourcePath: NOTE_B, page: 1 });
      }
      // And the keep path mints none either: the accept-time seal never mints for such a draft.
      const [first] = pending;
      if (first === undefined) throw new Error('no draft');
      const { instrumentId } = await createDraftAcceptPort({
        vault,
        cache,
        deviceId: 'device-a',
      }).accept(first.draftId, 'accepted');
      expect((await readInstrumentCitationRecord(vault, instrumentId))?.passageDigest).toBe(
        undefined,
      );
    }
  });
});
