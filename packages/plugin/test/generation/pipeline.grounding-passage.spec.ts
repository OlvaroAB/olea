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
 *
 * `ol-egov.141.89.2.29` adds the second knowable case: the response CITES the chunk each question
 * rests on (`groundedIn`, positions in the request's `sourceChunks`). A citation naming exactly
 * one distinct chunk names that chunk's passage; two or more, none, or a position the request did
 * not carry names nothing. That path is held off (`CITED_CHUNK_DIGEST_ENABLED`) until the
 * wrong-citation rate is measured, so its tests switch it on explicitly (`citedChunkDigest`), and
 * one test pins that the shipped default mints nothing from a citation. An older Worker's response
 * (no `groundedIn`) gives records byte-identical to before, pinned by a hash captured from the code
 * before the change.
 */
import type { ConceptRecord, ExtractedUnit } from 'olea-core';
import { digestPassage, locatePassageByDigest, readInstrumentCitation } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import {
  CITED_CHUNK_DIGEST_ENABLED,
  citedGroundingChunk,
  soleGroundingChunk,
  withGroundingPassage,
} from '../../src/generation/grounding-passage.js';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import { extractDraftedGroundedIn } from '../../src/generation/response.js';
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

function drafted(
  sourceChunks: readonly string[],
  questionCount = 1,
  groundedIn: readonly (unknown | undefined)[] = [],
): DraftQuizCardsResult {
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
          ...(groundedIn[i] === undefined ? {} : { groundedIn: groundedIn[i] }),
        })),
      },
    },
  };
}

async function sweep(
  files: Record<string, string>,
  units: readonly ExtractedUnit[],
  result: DraftQuizCardsResult,
  options: { readonly citedChunkDigest?: boolean } = {},
) {
  const vault = new MemoryVaultSource(files);
  const cache = createVaultDraftCacheStore(vault);
  await runGenerationSweep(units, {
    vault,
    cache,
    draftDeps: {} as never,
    listConceptsForCourse: async () => [concept],
    draftForConcept: async () => result,
    now: () => new Date('2026-10-02T00:00:00.000Z'),
    ...options,
  });
  // Ordered by the question each record drafted (its stem ends with the question's position).
  const pending = [...(await cache.listPending())].sort((a, b) =>
    (a.question?.stem ?? '').localeCompare(b.question?.stem ?? ''),
  );
  return { vault, pending };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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

describe('the response cites its chunk (ol-egov.141.89.2.29): the reader', () => {
  const envelope = (questions: readonly Record<string, unknown>[]) => ({
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '2.5.0', modelId: 'test-model' },
    result: { questions },
  });

  it("reads each question's citation parallel to the question list", () => {
    expect(
      extractDraftedGroundedIn(
        envelope([{ groundedIn: [1] }, {}, { groundedIn: [0, 2] }]),
        'questions',
        3,
      ),
    ).toEqual([[1], undefined, [0, 2]]);
    expect(
      extractDraftedGroundedIn({ ok: true, result: { cards: [{ groundedIn: [0] }] } }, 'cards', 1),
    ).toEqual([[0]]);
  });

  it("reads an older Worker's response (no groundedIn) as no citation for every question", () => {
    expect(extractDraftedGroundedIn(envelope([{}, {}]), 'questions', 3)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('voids a citation naming a position the request did not carry, or a malformed one', () => {
    for (const bad of [[3], [0, 3], [], [-1], [1.5], ['1'], '1', null, {}]) {
      expect(
        extractDraftedGroundedIn(envelope([{ groundedIn: bad }]), 'questions', 3),
        JSON.stringify(bad),
      ).toEqual([undefined]);
    }
  });

  it('gives nothing for a response that is not an ok envelope with an item list', () => {
    for (const response of [null, 'x', { ok: false }, { ok: true }, { ok: true, result: {} }]) {
      expect(extractDraftedGroundedIn(response, 'questions', 3)).toEqual([]);
    }
  });
});

describe('citedGroundingChunk names a chunk only when the citation names exactly one', () => {
  const chunks = [PARAGRAPH_A, PARAGRAPH_B, PARAGRAPH_C];
  it('one position names that chunk; the same text twice is still one chunk', () => {
    expect(citedGroundingChunk(chunks, [1])).toBe(PARAGRAPH_B);
    expect(citedGroundingChunk(chunks, [1, 1])).toBe(PARAGRAPH_B);
    expect(citedGroundingChunk([PARAGRAPH_B, PARAGRAPH_A, PARAGRAPH_B], [0, 2])).toBe(PARAGRAPH_B);
  });
  it('two distinct chunks, none, or a position not sent names nothing; never the first of several', () => {
    expect(citedGroundingChunk(chunks, [0, 1])).toBeUndefined();
    expect(citedGroundingChunk(chunks, undefined)).toBeUndefined();
    expect(citedGroundingChunk(chunks, [])).toBeUndefined();
    expect(citedGroundingChunk(chunks, [3])).toBeUndefined();
  });
});

describe('runGenerationSweep mints the digest of the cited chunk, when citations are trusted', () => {
  const MULTI = [PARAGRAPH_A, PARAGRAPH_B, PARAGRAPH_C];
  const trusted = { citedChunkDigest: true } as const;

  it('the shipped default trusts no citation: the switch is off until the wrong-citation rate is measured', async () => {
    expect(CITED_CHUNK_DIGEST_ENABLED).toBe(false);
    const { pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted(MULTI, 1, [[1]]),
    );
    expect(pending[0]?.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
  });

  it('one distinct cited chunk in a multi-passage note gives that passage, resolved per question', async () => {
    const { pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted(MULTI, 3, [[1], [2], [0]]),
      trusted,
    );
    expect(pending.map((record) => record.sourceCitation?.passageDigest)).toEqual([
      await digestPassage(PARAGRAPH_B),
      await digestPassage(PARAGRAPH_C),
      await digestPassage(PARAGRAPH_A),
    ]);
    expect(pending[0]?.sourceCitation).toEqual({
      sourcePath: SOURCE,
      page: 1,
      passageDigest: await digestPassage(PARAGRAPH_B),
    });
  });

  it('two distinct cited chunks give no digest (ambiguous, left unresolved)', async () => {
    const { pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted(MULTI, 1, [[0, 1]]),
      trusted,
    );
    expect(pending[0]?.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
  });

  it('no citation, or one naming a position the request did not carry, gives no digest and never the top-ranked chunk', async () => {
    const { pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted(MULTI, 3, [undefined, [3], 'first']),
      trusted,
    );
    expect(pending).toHaveLength(3);
    for (const record of pending) {
      expect(record.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
    }
  });

  it('a cited chunk that stands twice in the note gives no digest', async () => {
    const twice = `# Week 2\n\n${PARAGRAPH_B}\n\nOther material.\n\n${PARAGRAPH_B}\n`;
    const { pending } = await sweep(
      { [SOURCE]: twice },
      [authoredUnit(SOURCE)],
      drafted([PARAGRAPH_A, PARAGRAPH_B], 1, [[1]]),
      trusted,
    );
    expect(pending[0]?.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
  });

  it('a cited chunk that is not a passage of the cited note gives no digest', async () => {
    const { pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted([PARAGRAPH_A, 'A passage from a different note entirely.'], 1, [[1]]),
      trusted,
    );
    expect(pending[0]?.sourceCitation).toEqual({ sourcePath: SOURCE, page: 1 });
  });

  it('the sole-chunk rule is unchanged: one chunk names its passage whatever the citation says', async () => {
    for (const citation of [undefined, [0], [5], 'x']) {
      const { pending } = await sweep(
        { [SOURCE]: MULTI_PASSAGE_NOTE },
        [authoredUnit(SOURCE)],
        drafted([PARAGRAPH_B], 1, [citation]),
        trusted,
      );
      expect(pending[0]?.sourceCitation?.passageDigest, JSON.stringify(citation)).toBe(
        await digestPassage(PARAGRAPH_B),
      );
    }
  });

  it('the digest a citation names survives accept, and the reader finds the passage again', async () => {
    const { vault, pending } = await sweep(
      { [SOURCE]: MULTI_PASSAGE_NOTE },
      [authoredUnit(SOURCE)],
      drafted(MULTI, 1, [[2]]),
      trusted,
    );
    const record = pending[0];
    if (record?.question === undefined) throw new Error('an MCQ draft was expected');
    const { instrumentId } = await materializeAcceptedDraft(vault, {
      sourcePath: record.sourcePath,
      question: record.question,
      draftId: record.draftId,
      ...(record.sourceCitation !== undefined ? { sourceCitation: record.sourceCitation } : {}),
    });
    const citation = await readInstrumentCitation(vault, instrumentId);
    expect(citation?.passageDigest).toBe(await digestPassage(PARAGRAPH_C));
    expect(
      (await locatePassageByDigest(MULTI_PASSAGE_NOTE, citation?.passageDigest ?? '')).status,
    ).toBe('unique');
  });
});

describe("an older Worker's response (no citation) gives the records it always did", () => {
  /**
   * SHA-256 of the sorted pending records' JSON for two questions, captured from the code BEFORE
   * `ol-egov.141.89.2.29` on 2026-10-02 (same fixture, same fixed clock). If one fails, the absent
   * path changed, which the citation must never do.
   */
  const GOLDEN = {
    multi: '974d258cfe250807dea5a7233b720b8e6a1a7f1cdc1520985be202a8ef62db5a',
    sole: 'f119e6f87d76e2eb60335eb2732d2217f2dafc88f0d996d5ae294b5f1d0f128e',
  } as const;

  for (const [label, chunks] of [
    ['multi', [PARAGRAPH_A, PARAGRAPH_B, PARAGRAPH_C]],
    ['sole', [PARAGRAPH_B]],
  ] as const) {
    for (const citedChunkDigest of [false, true]) {
      it(`${label} chunks, citation trust ${citedChunkDigest ? 'on' : 'off'}: byte-identical by hash`, async () => {
        const vault = new MemoryVaultSource({ [SOURCE]: MULTI_PASSAGE_NOTE });
        const cache = createVaultDraftCacheStore(vault);
        await runGenerationSweep([authoredUnit(SOURCE)], {
          vault,
          cache,
          draftDeps: {} as never,
          listConceptsForCourse: async () => [concept],
          draftForConcept: async () => drafted(chunks, 2),
          now: () => new Date('2026-10-02T00:00:00.000Z'),
          citedChunkDigest,
        });
        const pending = [...(await cache.listPending())].sort((a, b) =>
          a.draftId.localeCompare(b.draftId),
        );
        expect(await sha256(JSON.stringify(pending))).toBe(GOLDEN[label]);
      });
    }
  }
});
