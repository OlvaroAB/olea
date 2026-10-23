/**
 * `ol-egov.141.89.2.39`: a drafted item's citation names the note its one named chunk came from.
 *
 * F3.3's clearing row names "which reading or lecture the draft was drawn from", and C5.3 protects only
 * "the recorded source note" (`[D-543]`); protection keyed to a note the item was not drafted from
 * "would leave its real source unchecked" (`[D-567]`). Today the citation names the concept's note even
 * when retrieval drew every chunk from another note (LOOP's D1: 0 of 102 single cited chunks were a
 * passage of the cited note). The scenarios are `features/F3-learn-from-anything.md` (the service
 * repo), "a drafted item's citation names the note its one named chunk came from", written first.
 *
 * Pinned below: the re-pointing reads the kept citation whatever the cited-chunk switch says, while a
 * digest still follows the usual rule (the sole chunk always, a cited chunk only with the switch on);
 * several chunks or paths, none, a position not sent, a chunk of the note already cited, a non-markdown
 * source, a supplied transcript passage, and a result with no chunk paths all leave the citation as
 * it is today; the top-ranked chunk never chooses a note.
 */
import type { ConceptRecord, ExtractedUnit } from 'olea-core';
import { digestPassage } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { citationForNamedChunk } from '../../src/generation/grounding-passage.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import type { DraftQuizCardsResult } from '../../src/retrieval/draft-quiz-cards.js';
import { MemoryVaultSource } from './fakes.js';

const SOURCE = '01 Courses/COGS214/Week 2.md';
const OTHER_A = '01 Courses/COGS214/Week 3.md';
const OTHER_B = '01 Courses/COGS214/Reading 4.md';
const PDF = '01 Courses/COGS214/Slides 4.pdf';

const OWN = 'The concept note says little that the drafts use.';
const A1 = 'Working memory holds a few items at once.\nIt is limited by attention, not by storage.';
const A2 = 'Chunking groups items so more fit at once.';
const B1 = 'Long-term memory is far larger and decays more slowly.';
const B2 = 'Rehearsal moves items toward long-term storage.';
const FILES: Record<string, string> = {
  [SOURCE]: `# Week 2\n\n${OWN}\n`,
  [OTHER_A]: `# Week 3\n\n${A1}\n\n${A2}\n`,
  [OTHER_B]: `# Reading 4\n\n${B1}\n\n${B2}\n`,
};
const TODAY = { sourcePath: SOURCE, page: 1 };

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
    provenance: { sourcePath, location: { page: 1, charRange: { start: 0, end: 1 } } },
  };
}

function drafted(
  sourceChunks: readonly string[],
  chunkPaths: readonly string[] | undefined,
  groundedIn: readonly (unknown | undefined)[] = [],
  extra: { readonly sourceChunkOrigins?: readonly (object | null)[] } = {},
): DraftQuizCardsResult {
  const questionCount = Math.max(1, groundedIn.length);
  return {
    status: 'drafted',
    request: {
      courseCode: 'COGS214',
      conceptName: 'Working memory',
      sourceChunks,
      ...(extra.sourceChunkOrigins === undefined
        ? {}
        : { sourceChunkOrigins: extra.sourceChunkOrigins as never }),
    },
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
    ...(chunkPaths === undefined ? {} : { chunkPaths }),
  };
}

async function sweep(
  result: DraftQuizCardsResult,
  options: { readonly citedChunkDigest?: boolean } = {},
) {
  const vault = new MemoryVaultSource({ ...FILES });
  const cache = createVaultDraftCacheStore(vault);
  await runGenerationSweep([authoredUnit(SOURCE)], {
    vault,
    cache,
    draftDeps: {} as never,
    listConceptsForCourse: async () => [concept],
    draftForConcept: async () => result,
    now: () => new Date('2026-10-23T00:00:00.000Z'),
    ...options,
  });
  return [...(await cache.listPending())].sort((a, b) =>
    (a.question?.stem ?? '').localeCompare(b.question?.stem ?? ''),
  );
}

const MULTI = [A1, A2, B1];
const MULTI_PATHS = [OTHER_A, OTHER_A, OTHER_B];

describe('one cited chunk from another note re-points the citation to that note', () => {
  it('switch off: the citation names the chunk note, with no page, section, revision or digest', async () => {
    const pending = await sweep(drafted(MULTI, MULTI_PATHS, [[2]]));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sourceCitation).toEqual({ sourcePath: OTHER_B });
  });

  it('switch on: the re-pointed citation also carries that passage digest', async () => {
    const pending = await sweep(drafted(MULTI, MULTI_PATHS, [[2]]), { citedChunkDigest: true });
    expect(pending[0]?.sourceCitation).toEqual({
      sourcePath: OTHER_B,
      passageDigest: await digestPassage(B1),
    });
  });

  it('each question is re-pointed on its own citation: two questions may name two notes', async () => {
    const pending = await sweep(drafted(MULTI, MULTI_PATHS, [[0], [2]]));
    expect(pending.map((record) => record.sourceCitation)).toEqual([
      { sourcePath: OTHER_A },
      { sourcePath: OTHER_B },
    ]);
  });
});

describe('a request that supplied one chunk names that chunk note', () => {
  it('whatever the response cites, with the sole-chunk digest the usual rule gives', async () => {
    const digest = await digestPassage(A2);
    for (const groundedIn of [[], [[0]], [[0, 0]]] as const) {
      const pending = await sweep(drafted([A2], [OTHER_A], groundedIn));
      for (const record of pending) {
        expect(record.sourceCitation).toEqual({ sourcePath: OTHER_A, passageDigest: digest });
      }
    }
  });
});

describe('everything else leaves the citation exactly as it is today', () => {
  it('two distinct cited chunks, none, or a position the request did not carry', async () => {
    for (const groundedIn of [[[0, 2]], [], [[7]], [[]]] as const) {
      const pending = await sweep(drafted(MULTI, MULTI_PATHS, groundedIn), {
        citedChunkDigest: true,
      });
      expect(pending[0]?.sourceCitation).toEqual(TODAY);
    }
  });

  it('two positions naming one text from two notes is ambiguous, and is left as it is', async () => {
    const pending = await sweep(drafted([A1, A1, B1], [OTHER_A, OTHER_B, OTHER_B], [[0, 1]]));
    expect(pending[0]?.sourceCitation).toEqual(TODAY);
  });

  it('a chunk of the note already cited', async () => {
    const pending = await sweep(drafted([OWN, B1], [SOURCE, OTHER_B], [[0]]));
    expect(pending[0]?.sourceCitation).toEqual(TODAY);
  });

  it('a chunk from a non-markdown source, or a supplied transcript passage', async () => {
    const fromPdf = await sweep(drafted([A1, B1], [PDF, OTHER_B], [[0]]));
    expect(fromPdf[0]?.sourceCitation).toEqual(TODAY);
    const fromTranscript = await sweep(
      drafted([A1, B1], [OTHER_A, OTHER_B], [[0]], {
        sourceChunkOrigins: [{ kind: 'transcript' }, null],
      }),
    );
    expect(fromTranscript[0]?.sourceCitation).toEqual(TODAY);
  });

  it('a result with no chunk paths (built before they existed) is exactly what it was', async () => {
    const pending = await sweep(drafted(MULTI, undefined, [[2]]));
    expect(pending[0]?.sourceCitation).toEqual(TODAY);
    const sole = await sweep(drafted([A2], undefined));
    expect(sole[0]?.sourceCitation).toEqual(TODAY);
  });

  it('several chunks and no citation: the top-ranked chunk never chooses a note', async () => {
    const pending = await sweep(drafted(MULTI, MULTI_PATHS));
    expect(pending[0]?.sourceCitation).toEqual(TODAY);
  });
});

describe('citationForNamedChunk, the pure rule', () => {
  const none = () => false;
  it('returns the very same citation object whenever it does not re-point', () => {
    const citation = { sourcePath: SOURCE, page: 1 };
    expect(citationForNamedChunk(citation, MULTI, MULTI_PATHS, undefined, none)).toBe(citation);
    expect(citationForNamedChunk(citation, MULTI, [OTHER_A], [2], none)).toBe(citation);
    const named = { ...citation, passageDigest: 'already' };
    expect(citationForNamedChunk(named, MULTI, MULTI_PATHS, [2], none)).toBe(named);
  });
  it('re-points to the one named markdown note; two distinct texts of one note are still two chunks', () => {
    expect(citationForNamedChunk(TODAY, MULTI, MULTI_PATHS, [0], none)).toEqual({
      sourcePath: OTHER_A,
    });
    expect(citationForNamedChunk(TODAY, MULTI, MULTI_PATHS, [1, 0], none)).toBe(TODAY);
  });
});
