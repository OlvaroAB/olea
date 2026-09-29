/**
 * `[D-446]` option (a), the authoring half at DRAFT time (`ol-egov.141.89.2.5`; the reader and the
 * accept-time seal are `ol-egov.141.89.5.32`'s, client commit 5c5ef02).
 *
 * `runGenerationSweep` records `sourceCitation.passageDigest` for a drafted item only where the
 * passage the item rests on can be NAMED without guessing. What the client holds at that moment is
 * the list of chunks the drafting request carried, and the response cites none of them (no field
 * in `quiz.generate.v1`'s or `cards.generate.v1`'s response refers back into `sourceChunks`), so
 * exactly one case is knowable: the request supplied ONE chunk, which is then the only thing the
 * item could rest on. Every other draft (several chunks, the usual case) stays whole-note grain
 * until a response can cite its chunk (a wire change, filed as a bead, not built here).
 *
 * The falsifiers pinned below: the digest is never taken from the top-ranked chunk of several, a
 * chunk that stands twice in the note or not at all yields none, and a source that is not a
 * separate markdown note (a PDF, the destination note itself) is left exactly as before.
 */
import type { ConceptRecord, ExtractedUnit } from 'olea-core';
import { digestPassage, locatePassageByDigest, readInstrumentCitation } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import {
  soleGroundingChunk,
  withGroundingPassage,
} from '../../src/generation/grounding-passage.js';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import type { DraftQuizCardsResult } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const SOURCE = '01 Courses/COGS214/Week 2.md';
const PARAGRAPH_A =
  'Working memory holds a few items at once.\nIt is limited by attention, not by storage.';
const PARAGRAPH_B = 'Long-term memory is far larger and decays more slowly.';
const PARAGRAPH_C = 'Rehearsal moves items toward long-term storage.';
const MULTI_PASSAGE_NOTE = `# Week 2\n\n${PARAGRAPH_A}\n\n${PARAGRAPH_B}\n\n${PARAGRAPH_C}\n`;

const concept: ConceptRecord = {
  key: 'key-working-memory',
  name: 'Working memory',
  tier: 2,
  courses: ['COGS214'],
  sourcePaths: [SOURCE],
};

/** An authored note (no `embeddedIn`, `[D-214]`): a bare drop whose home note is the destination. */
function authoredUnit(sourcePath: string): ExtractedUnit {
  return {
    text: 'the pipeline never reads unit text',
    provenance: {
      sourcePath,
      location: { page: 1, charRange: { start: 0, end: 1 } },
    },
  };
}

function drafted(sourceChunks: readonly string[], questionCount = 1): DraftQuizCardsResult {
  return {
    status: 'drafted',
    request: { courseCode: 'COGS214', conceptName: 'Working memory', sourceChunks },
    response: {
      ok: true,
      stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
      result: {
        questions: Array.from({ length: questionCount }, (_, i) => ({
          stem: `Which limits working memory? (${i})`,
          correctAnswer: 'Attention',
          distractors: ['Storage', 'Sleep', 'Hunger'],
          feedback: 'See the note.',
        })),
      },
    },
  };
}

async function sweep(
  files: Record<string, string>,
  units: readonly ExtractedUnit[],
  result: DraftQuizCardsResult,
) {
  const vault = new MemoryVaultSource(files);
  const cache = createVaultDraftCacheStore(vault);
  await runGenerationSweep(units, {
    vault,
    cache,
    draftDeps: {} as never,
    listConceptsForCourse: async () => [concept],
    draftForConcept: async () => result,
  });
  return { vault, pending: await cache.listPending() };
}

describe('soleGroundingChunk names a chunk only when exactly one was supplied', () => {
  it('one chunk is the grounding chunk; none or several name nothing', () => {
    expect(soleGroundingChunk(['only'])).toBe('only');
    expect(soleGroundingChunk([])).toBeUndefined();
    expect(soleGroundingChunk(['first', 'second'])).toBeUndefined();
    // Never the top-ranked of several, even when the first is the one that would resolve.
    expect(soleGroundingChunk([PARAGRAPH_A, PARAGRAPH_B, PARAGRAPH_C])).toBeUndefined();
  });
});

describe('runGenerationSweep records the passage digest where the grounding chunk is known', () => {
  it('multi-passage source, one chunk supplied: the digest names that passage (the seal alone would leave none)', async () => {
    const { pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted([PARAGRAPH_B]),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sourceCitation).toEqual({
      sourcePath: SOURCE,
      page: 1,
      passageDigest: await digestPassage(PARAGRAPH_B),
    });
  });

  it('cites a block passage by its normalised text: a re-wrapped chunk still names the same passage', async () => {
    const rewrapped =
      '  Working memory holds a few items at once. It is limited by attention,\n  not by storage. ';
    const { pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted([rewrapped]),
    );
    expect(pending[0]?.sourceCitation?.passageDigest).toBe(await digestPassage(PARAGRAPH_A));
  });

  it('every item drafted from that one chunk carries the same digest', async () => {
    const { pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted([PARAGRAPH_C], 3),
    );
    expect(pending).toHaveLength(3);
    const digest = await digestPassage(PARAGRAPH_C);
    for (const record of pending) expect(record.sourceCitation?.passageDigest).toBe(digest);
  });

  it('several chunks and no citation: no digest, whichever chunk ranks first (left unresolved)', async () => {
    const { pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted([PARAGRAPH_A, PARAGRAPH_B, PARAGRAPH_C]),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
  });

  it('a chunk that stands twice in the note is ambiguous: no digest', async () => {
    const twice = `# Week 2\n\n${PARAGRAPH_B}\n\nOther material.\n\n${PARAGRAPH_B}\n`;
    const { pending } = await sweep(
      { [SOURCE]: twice },
      [authoredUnit(SOURCE)],
      drafted([PARAGRAPH_B]),
    );
    expect(pending[0]?.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
  });

  it('a chunk that is not a passage of the cited note (it came from elsewhere) gets no digest', async () => {
    const { pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted(['A passage from a different note entirely.']),
    );
    expect(pending[0]?.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
  });

  it('a source that is not a separate markdown note is left exactly as before', async () => {
    const pdf: ExtractedUnit = {
      text: 'x',
      provenance: {
        sourcePath: '01 Courses/COGS214/Lecture 4.pdf',
        location: { page: 3, charRange: { start: 0, end: 1 } },
      },
    };
    const fromPdf = await sweep({}, [pdf], drafted([PARAGRAPH_B]));
    expect(fromPdf.pending[0]?.sourceCitation).toEqual({
      sourcePath: '01 Courses/COGS214/Lecture 4.pdf',
      page: 3,
    });

    // The destination note itself is the "source": its text carries the instrument block, so no
    // passage is sealed for it (the accept-time seal skips it too, and would keep a digest unchecked).
    const embeddedSelf: ExtractedUnit = {
      text: 'x',
      provenance: {
        sourcePath: SOURCE,
        location: { page: 1, charRange: { start: 0, end: 1 } },
        embeddedIn: { notePath: SOURCE, blockStart: 0, blockEnd: 1 },
      },
    };
    const self = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [embeddedSelf],
      drafted([PARAGRAPH_B]),
    );
    expect(self.pending[0]?.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
  });

  it('an unreadable or missing source never throws and leaves the citation as it was', async () => {
    const { pending } = await sweep({}, [authoredUnit(SOURCE)], drafted([PARAGRAPH_B]));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
  });

  it('a citation that already names a passage is not overwritten', async () => {
    const vault = new MemoryVaultSource({ [SOURCE]: MULTI_PASSAGE_NOTE });
    const named = { sourcePath: SOURCE, page: 1, passageDigest: await digestPassage(PARAGRAPH_A) };
    expect(await withGroundingPassage(vault, named, 'dest.md', [PARAGRAPH_B])).toBe(named);
  });
});

describe('the digest the sweep records survives accept, and the single-passage mint is unchanged', () => {
  async function accept(
    vault: MemoryVaultSource,
    record: NonNullable<Awaited<ReturnType<typeof sweep>>['pending'][number]>,
  ) {
    if (record.question === undefined) throw new Error('an MCQ draft was expected');
    const { instrumentId } = await materializeAcceptedDraft(vault, {
      sourcePath: record.sourcePath,
      question: record.question,
      draftId: record.draftId,
      ...(record.sourceCitation !== undefined ? { sourceCitation: record.sourceCitation } : {}),
    });
    return readInstrumentCitation(vault, instrumentId);
  }

  it('a multi-passage source ends with the sidecar naming the grounding passage, and the reader can find it again', async () => {
    const { vault, pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted([PARAGRAPH_B]),
    );
    const record = pending[0];
    if (record === undefined) throw new Error('a draft was expected');
    const citation = await accept(vault, record);
    expect(citation?.passageDigest).toBe(await digestPassage(PARAGRAPH_B));
    const located = await locatePassageByDigest(MULTI_PASSAGE_NOTE, citation?.passageDigest ?? '');
    expect(located.status).toBe('unique');
  });

  it('the same multi-passage source with several chunks ends with whole-note grain (nothing guessed)', async () => {
    const { vault, pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted([PARAGRAPH_A, PARAGRAPH_B]),
    );
    const record = pending[0];
    if (record === undefined) throw new Error('a draft was expected');
    expect(record.sourceCitation?.passageDigest).toBeUndefined();
    expect((await accept(vault, record))?.passageDigest).toBeUndefined();
  });

  it('a source with one body passage is minted at accept exactly as before, whatever the chunk list', async () => {
    const oneBody = `# Week 2\n\n${PARAGRAPH_A}\n`;
    for (const chunks of [[PARAGRAPH_A], [PARAGRAPH_A, 'another chunk'], ['not in the note']]) {
      const { vault, pending } = await sweep(
        { [SOURCE]: oneBody },
        [authoredUnit(SOURCE)],
        drafted(chunks),
      );
      const record = pending[0];
      if (record === undefined) throw new Error('a draft was expected');
      expect((await accept(vault, record))?.passageDigest).toBe(await digestPassage(PARAGRAPH_A));
    }
  });

  it('a passage that was edited between draft and accept is dropped by the seal, not written', async () => {
    const { vault, pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted([PARAGRAPH_B]),
    );
    const record = pending[0];
    if (record === undefined) throw new Error('a draft was expected');
    expect(record.sourceCitation?.passageDigest).toBeDefined();
    await vault.write(SOURCE, MULTI_PASSAGE_NOTE.replace(PARAGRAPH_B, 'Long-term memory is vast.'));
    const citation = await accept(vault, record);
    expect(citation?.sourcePath).toBe(SOURCE);
    expect(citation?.passageDigest).toBeUndefined();
  });
});
