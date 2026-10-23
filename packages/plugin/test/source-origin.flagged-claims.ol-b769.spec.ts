// Flagged claims in the request field (ol-b769; D-624). Synthetic astronomy text only, course A.

import { refineSourceChunkOriginAlignment, sourceChunkOriginsField } from 'olea-contracts';
import {
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { draftCardsForConcept } from '../src/generation/draft-cards.js';
import { draftQuizCardsForConcept } from '../src/retrieval/draft-quiz-cards.js';
import {
  sourceChunkOriginOf,
  sourceChunkOriginsFragment,
  sourceChunkOriginsOf,
} from '../src/source-origin.js';

const host = { frontmatterFor: () => undefined };
const termHost = {
  frontmatterFor: () => undefined,
  lectureTermsFor: () => ['neighbour threshold'],
};

const CLEAR_1 = 'A nebula is a cloud of gas and dust.';
const INAUDIBLE = 'Its mass is about [inaudible] solar masses.';
const CLEAR_2 = 'Gravity can pull a nebula into a star.';
const VISUAL = 'As you can see on this graph, the nebula cools.';

/** The contract's entry schema plus its alignment refinement, with a ctx stub (no zod dependency here). */
const requestShape = {
  safeParse(value: { sourceChunks: string[]; sourceChunkOrigins?: unknown }) {
    const parsed = sourceChunkOriginsField.safeParse(value.sourceChunkOrigins);
    const issues: unknown[] = [];
    refineSourceChunkOriginAlignment(
      value as never,
      {
        addIssue: (issue: unknown) => issues.push(issue),
      } as never,
    );
    return { success: parsed.success && issues.length === 0 };
  },
};

function request(passages: { path: string; text: string }[], h = host) {
  const frag = sourceChunkOriginsFragment(passages, h);
  return { sourceChunks: passages.map((p) => p.text), ...frag };
}

function sliceOf(text: string, c: { start: number; end: number }): string {
  return text.slice(c.start, c.end);
}

describe('flaggedClaims on a flagged transcript part', () => {
  it('declares exactly the inaudible sentence between two clear ones, text unchanged', () => {
    const text = `${CLEAR_1} ${INAUDIBLE} ${CLEAR_2}`;
    const req = request([{ path: 'lec/week1.txt', text }]);
    expect(req.sourceChunks).toEqual([text]);
    const origin = req.sourceChunkOrigins?.[0];
    expect(origin?.flaggedClaims).toHaveLength(1);
    const claim = origin?.flaggedClaims?.[0];
    expect(claim && sliceOf(text, claim)).toBe(INAUDIBLE);
    expect(claim?.flags).toEqual(['inaudible']);
    expect(origin?.flags).toEqual(['inaudible']);
    expect(requestShape.safeParse(req).success).toBe(true);
  });

  it('declares a visual-reference sentence', () => {
    const text = `${CLEAR_1} ${VISUAL} ${CLEAR_2}`;
    const req = request([{ path: 'lec/week1.txt', text }]);
    const claims = req.sourceChunkOrigins?.[0]?.flaggedClaims ?? [];
    expect(claims.map((c) => sliceOf(text, c))).toEqual([VISUAL]);
    expect(claims[0]?.flags).toEqual(['visual-reference']);
    expect(requestShape.safeParse(req).success).toBe(true);
  });

  it('declares every sentence using the spoken variant of a bundle term', () => {
    const s1 = 'The neighbor threshold sets when a cloud collapses.';
    const s2 = 'Gravity wins once the neighbor threshold is passed.';
    const text = `${s1} ${CLEAR_1} ${s2}`;
    const req = request([{ path: 'lec/week1.txt', text }], termHost);
    const origin = req.sourceChunkOrigins?.[0];
    expect(origin?.flags).toContain('term-discrepancy');
    const claims = origin?.flaggedClaims ?? [];
    expect(claims.map((c) => sliceOf(text, c))).toEqual([s1, s2]);
    for (const c of claims) expect(c.flags).toContain('term-discrepancy');
    expect(requestShape.safeParse(req).success).toBe(true);
  });

  it('keeps claims ascending and every claim kind among the entry flags', () => {
    const text = `${VISUAL} ${CLEAR_1} ${INAUDIBLE}`;
    const origin = sourceChunkOriginOf('lec/week1.txt', text, host);
    const claims = origin?.flaggedClaims ?? [];
    expect(claims.map((c) => sliceOf(text, c))).toEqual([VISUAL, INAUDIBLE]);
    for (const c of claims) {
      for (const f of c.flags) expect(origin?.flags).toContain(f);
    }
    expect(claims[0] && claims[1] && claims[0].end <= claims[1].start).toBe(true);
  });
});

describe('no flaggedClaims key', () => {
  it('an unflagged transcript part has no flags and no flaggedClaims key', () => {
    const origin = sourceChunkOriginOf('lec/week1.txt', `${CLEAR_1} ${CLEAR_2}`, host);
    expect(origin).toEqual({ kind: 'transcript', speakerRole: 'unknown' });
    expect(Object.keys(origin ?? {})).not.toContain('flaggedClaims');
  });

  it('a non-transcript passage is null, and the field is omitted when none is a transcript', () => {
    expect(sourceChunkOriginOf('notes/a.pdf', INAUDIBLE, host)).toBeNull();
    expect(sourceChunkOriginsOf([{ path: 'notes/a.pdf', text: INAUDIBLE }], host)).toBeUndefined();
    const req = request([
      { path: 'lec/week1.txt', text: INAUDIBLE },
      { path: 'notes/a.pdf', text: INAUDIBLE },
    ]);
    expect(req.sourceChunkOrigins?.[1]).toBeNull();
    expect(requestShape.safeParse(req).success).toBe(true);
  });
});

// ---- through the drafting entry points ----

class RecordingTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

class LookupEmbeddingProvider implements EmbeddingProvider {
  readonly vectors = new Map<string, readonly number[]>();
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return { vectors: request.texts.map((t) => this.vectors.get(t) ?? []) };
  }
}

const FILLERS = 100;
const DIM = 2 + FILLERS;
const QUERY = 'nebula';
const TARGET = `${CLEAR_1} ${INAUDIBLE} ${CLEAR_2}`;
const unit = (i: number) => Array.from({ length: DIM }, (_, k) => (k === i ? 1 : 0));

async function retrieveDepsFor(targetPath: string) {
  const provider = new LookupEmbeddingProvider();
  provider.vectors.set(TARGET, unit(0));
  provider.vectors.set(QUERY, unit(0));
  const docs: PersistedKeywordIndex['documents'][number][] = [
    {
      path: targetPath,
      courses: ['COURSE-A'],
      contentHash: 'unused',
      blocks: [{ blockIndex: 0, kind: 'paragraph', text: TARGET }],
    },
  ];
  for (let i = 0; i < FILLERS; i++) {
    const text = `unrelated filler passage number ${i} about an unrelated topic`;
    provider.vectors.set(text, unit(2 + i));
    docs.push({
      path: `filler/${i}.md`,
      courses: ['COURSE-A'],
      contentHash: 'unused',
      blocks: [{ blockIndex: 0, kind: 'paragraph', text }],
    });
  }
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider,
    model: 'fake-model-v1',
  });
  return {
    keywordIndex: { version: 1, documents: docs } as PersistedKeywordIndex,
    embeddingCache,
    embeddingProvider: provider,
  };
}

function generatorTransport() {
  return new RecordingTransport((request) =>
    request.taskId === 'grounding.judge.v1'
      ? { ok: true, stamp: {}, result: { supported: true, reason: 'ok' } }
      : { ok: true, stamp: {}, result: { questions: [], cards: [] } },
  );
}

describe.each([
  ['quiz.generate', draftQuizCardsForConcept, 'quiz.generate.v1'],
  ['cards.generate', draftCardsForConcept, 'cards.generate.v1'],
] as const)('%s (drafting entry point)', (_name, draft, taskId) => {
  const REQUEST = { courseCode: 'COURSE-A', conceptName: QUERY };

  it('a flagged transcript part carries its declaration; sourceChunks is unchanged', async () => {
    const transport = generatorTransport();
    const result = await draft(
      { retrieve: await retrieveDepsFor('course/talk.txt'), transport },
      REQUEST,
    );
    expect(result.status).toBe('drafted');
    const sent = transport.sent.find((r) => r.taskId === taskId)?.payload as {
      sourceChunks: string[];
      sourceChunkOrigins: { flags?: string[]; flaggedClaims?: { start: number; end: number }[] }[];
    };
    expect(sent.sourceChunks).toEqual([TARGET]);
    const claims = sent.sourceChunkOrigins[0]?.flaggedClaims ?? [];
    expect(claims).toHaveLength(1);
    expect(claims[0] && sliceOf(TARGET, claims[0])).toBe(INAUDIBLE);
    expect(sent.sourceChunkOrigins[0]?.flags).toEqual(['inaudible']);
    expect(requestShape.safeParse(sent).success).toBe(true);
  });
});
