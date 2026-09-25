import { describe, expect, it } from 'vitest';
import type { SearchHit } from '../keyword-index/query.js';
import { hybridRetrieve } from './hybrid.js';
import type { EmbeddingVector, RerankProvider, RetrievalChunk } from './types.js';

function chunk(
  path: string,
  blockIndex: number,
  text: string,
  contentHash = `${path}#${blockIndex}`,
): RetrievalChunk {
  return { path, blockIndex, kind: 'paragraph', text, contentHash };
}

function keywordHit(path: string, blockIndex: number, text: string, score: number): SearchHit {
  return { path, blockIndex, text, score };
}

describe('hybridRetrieve (C2.5: hybrid keyword + cosine)', () => {
  it('surfaces a chunk found only by keyword search', async () => {
    const chunks = [chunk('a.md', 0, 'mitochondria is the powerhouse')];
    const hits = await hybridRetrieve({
      query: 'mitochondria',
      chunks,
      keywordHits: [keywordHit('a.md', 0, 'mitochondria is the powerhouse', 1)],
      queryVector: null,
      embeddings: new Map(),
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: 'a.md', blockIndex: 0, matchedBy: ['keyword'] });
    expect(hits[0]?.cosineScore).toBeNull();
  });

  it('surfaces a chunk found only by cosine similarity (no keyword overlap)', async () => {
    const chunks = [chunk('a.md', 0, 'the energy-producing organelle', 'h1')];
    const query: EmbeddingVector = [1, 0];
    const hits = await hybridRetrieve({
      query: 'mitochondria',
      chunks,
      keywordHits: [],
      queryVector: query,
      embeddings: new Map([['h1', [1, 0]]]),
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: 'a.md', blockIndex: 0, matchedBy: ['semantic'] });
    expect(hits[0]?.keywordScore).toBeNull();
    expect(hits[0]?.cosineScore).toBeCloseTo(1, 10);
  });

  it('ranks a chunk matched by both keyword and cosine above one matched by only one signal', async () => {
    const chunks = [
      chunk('both.md', 0, 'mitochondria energy', 'both'),
      chunk('keyword-only.md', 0, 'mitochondria unrelated', 'kw-only'),
      chunk('semantic-only.md', 0, 'the energy factory', 'sem-only'),
    ];
    const hits = await hybridRetrieve({
      query: 'mitochondria energy',
      chunks,
      keywordHits: [
        keywordHit('both.md', 0, 'mitochondria energy', 2),
        keywordHit('keyword-only.md', 0, 'mitochondria unrelated', 1),
      ],
      queryVector: [1, 0],
      embeddings: new Map([
        ['both', [1, 0]],
        ['sem-only', [0.9, 0.1]],
      ]),
    });

    expect(hits[0]?.path).toBe('both.md');
    expect(hits[0]?.matchedBy).toEqual(['keyword', 'semantic']);
  });

  it('deduplicates a chunk that appears as both a keyword and a semantic hit into one result', async () => {
    const chunks = [chunk('a.md', 0, 'text', 'h1')];
    const hits = await hybridRetrieve({
      query: 'text',
      chunks,
      keywordHits: [keywordHit('a.md', 0, 'text', 1)],
      queryVector: [1, 0],
      embeddings: new Map([['h1', [1, 0]]]),
    });
    expect(hits).toHaveLength(1);
  });

  it('respects the limit option after fusion', async () => {
    const chunks = [chunk('a.md', 0, 'x'), chunk('b.md', 0, 'x'), chunk('c.md', 0, 'x')];
    const hits = await hybridRetrieve({
      query: 'x',
      chunks,
      keywordHits: [
        keywordHit('a.md', 0, 'x', 3),
        keywordHit('b.md', 0, 'x', 2),
        keywordHit('c.md', 0, 'x', 1),
      ],
      queryVector: null,
      embeddings: new Map(),
      options: { limit: 2 },
    });
    expect(hits).toHaveLength(2);
  });

  it('applies an optional rerank stage, overriding the fused order', async () => {
    const chunks = [
      chunk('low-fused.md', 0, 'text', 'low'),
      chunk('high-fused.md', 0, 'text', 'high'),
    ];
    const rerank: RerankProvider = {
      async rerank(request) {
        // Deliberately inverts whatever order the candidates arrived in:
        // the first (pre-rerank top) candidate gets the lowest score.
        return {
          scores: request.candidates.map((c, i) => ({ id: c.id, score: i })),
        };
      },
    };

    const hits = await hybridRetrieve({
      query: 'text',
      chunks,
      keywordHits: [
        keywordHit('high-fused.md', 0, 'text', 2),
        keywordHit('low-fused.md', 0, 'text', 1),
      ],
      queryVector: null,
      embeddings: new Map(),
      options: { rerank },
    });

    // Pre-rerank fusion would rank high-fused.md first (better keyword rank);
    // the (deliberately inverting) rerank stage must be what actually decided the order.
    expect(hits[0]?.path).toBe('low-fused.md');
    expect(hits[0]?.matchedBy).toContain('rerank');
  });

  it('passes the query text through to the rerank stage', async () => {
    const chunks = [chunk('a.md', 0, 'text')];
    let seenQuery: string | undefined;
    const rerank: RerankProvider = {
      async rerank(request) {
        seenQuery = request.query;
        return { scores: request.candidates.map((c) => ({ id: c.id, score: 1 })) };
      },
    };

    await hybridRetrieve({
      query: 'the actual query text',
      chunks,
      keywordHits: [keywordHit('a.md', 0, 'text', 1)],
      queryVector: null,
      embeddings: new Map(),
      options: { rerank },
    });

    expect(seenQuery).toBe('the actual query text');
  });

  it('never calls rerank when there are no fused candidates', async () => {
    let called = false;
    const rerank: RerankProvider = {
      async rerank(_request) {
        called = true;
        return { scores: [] };
      },
    };

    const hits = await hybridRetrieve({
      query: 'nothing matches',
      chunks: [chunk('a.md', 0, 'unrelated text', 'h1')],
      keywordHits: [],
      queryVector: null,
      embeddings: new Map(),
      options: { rerank },
    });

    expect(hits).toEqual([]);
    expect(called).toBe(false);
  });

  it('returns no hits and no errors for a completely empty index', async () => {
    const hits = await hybridRetrieve({
      query: 'anything',
      chunks: [],
      keywordHits: [],
      queryVector: null,
      embeddings: new Map(),
    });
    expect(hits).toEqual([]);
  });
});

// `[ILB-EVD-4]`: making an embedding failure visible to a caller reading
// `HybridHit[]` directly, without changing ranking or any existing field.
describe('hybridRetrieve — semantic availability is visible on every hit (`[ILB-EVD-4]`)', () => {
  it('marks every hit "unavailable" when no query vector was supplied at all', async () => {
    const chunks = [chunk('a.md', 0, 'mitochondria is the powerhouse')];
    const hits = await hybridRetrieve({
      query: 'mitochondria',
      chunks,
      keywordHits: [keywordHit('a.md', 0, 'mitochondria is the powerhouse', 1)],
      queryVector: null,
      embeddings: new Map(),
    });

    expect(hits[0]?.semantic).toBe('unavailable');
  });

  it('marks every hit "used" once a query vector is supplied, even for a hit only found by keyword', async () => {
    const chunks = [
      chunk('a.md', 0, 'mitochondria is the powerhouse', 'h1'),
      chunk('b.md', 0, 'unrelated block', 'h2'),
    ];
    const hits = await hybridRetrieve({
      query: 'mitochondria',
      chunks,
      keywordHits: [keywordHit('a.md', 0, 'mitochondria is the powerhouse', 1)],
      queryVector: [1, 0],
      embeddings: new Map([['h2', [0, 1]]]),
    });

    // The keyword-only hit ('a.md') carries no cosine score of its own, but
    // `semantic` is a per-call fact, not a per-hit one — it still reads
    // 'used' because a query vector genuinely was available to fuse with.
    const keywordOnlyHit = hits.find((h) => h.path === 'a.md');
    expect(keywordOnlyHit?.cosineScore).toBeNull();
    expect(keywordOnlyHit?.semantic).toBe('used');
    expect(hits.every((h) => h.semantic === 'used')).toBe(true);
  });

  it('preserves semantic across a rerank pass, alongside every other pre-existing field', async () => {
    const chunks = [chunk('a.md', 0, 'text', 'h1')];
    const rerank: RerankProvider = {
      async rerank(request) {
        return { scores: request.candidates.map((c) => ({ id: c.id, score: 1 })) };
      },
    };

    const hits = await hybridRetrieve({
      query: 'text',
      chunks,
      keywordHits: [keywordHit('a.md', 0, 'text', 1)],
      queryVector: null,
      embeddings: new Map(),
      options: { rerank },
    });

    expect(hits[0]?.semantic).toBe('unavailable');
    expect(hits[0]?.matchedBy).toContain('rerank');
  });
});

// `[ILB-EVD-4]`, `docs/dev/intelligence-build/evd.md` §2: "a failed rerank call keeps the fused
// list's prior order and records the failure; it never blocks the request the way a failed judge
// call does." Before this behaviour existed, a thrown `rerank.rerank(...)` call propagated
// straight out of `hybridRetrieve` to its caller — the opposite of "never blocks the request".
describe('hybridRetrieve — a failed rerank call keeps the fused order and never throws (`[ILB-EVD-4]`)', () => {
  const throwingRerank: RerankProvider = {
    async rerank(_request) {
      throw new Error('reranker unavailable');
    },
  };

  it('never rejects when the rerank provider throws', async () => {
    const chunks = [chunk('a.md', 0, 'mitochondria is the powerhouse')];
    await expect(
      hybridRetrieve({
        query: 'mitochondria',
        chunks,
        keywordHits: [keywordHit('a.md', 0, 'mitochondria is the powerhouse', 1)],
        queryVector: null,
        embeddings: new Map(),
        options: { rerank: throwingRerank },
      }),
    ).resolves.not.toThrow();
  });

  it('keeps the fused (RRF) order — never the rerank order — on a rerank failure', async () => {
    // Same fixture as "applies an optional rerank stage": pre-rerank fusion ranks
    // high-fused.md first on keyword rank alone. A rerank failure must leave that order
    // untouched, not fall back to some other order.
    const chunks = [
      chunk('low-fused.md', 0, 'text', 'low'),
      chunk('high-fused.md', 0, 'text', 'high'),
    ];
    const hits = await hybridRetrieve({
      query: 'text',
      chunks,
      keywordHits: [
        keywordHit('high-fused.md', 0, 'text', 2),
        keywordHit('low-fused.md', 0, 'text', 1),
      ],
      queryVector: null,
      embeddings: new Map(),
      options: { rerank: throwingRerank },
    });

    expect(hits.map((h) => h.path)).toEqual(['high-fused.md', 'low-fused.md']);
    expect(hits.every((h) => h.matchedBy.includes('rerank'))).toBe(false);
  });

  it('records the failure on every hit via rerankFailed', async () => {
    const chunks = [chunk('a.md', 0, 'text', 'h1'), chunk('b.md', 0, 'text', 'h2')];
    const hits = await hybridRetrieve({
      query: 'text',
      chunks,
      keywordHits: [keywordHit('a.md', 0, 'text', 2), keywordHit('b.md', 0, 'text', 1)],
      queryVector: null,
      embeddings: new Map(),
      options: { rerank: throwingRerank },
    });

    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.rerankFailed === true)).toBe(true);
  });

  it('respects limit after a rerank failure, same as the success path', async () => {
    const chunks = [chunk('a.md', 0, 'x'), chunk('b.md', 0, 'x'), chunk('c.md', 0, 'x')];
    const hits = await hybridRetrieve({
      query: 'x',
      chunks,
      keywordHits: [
        keywordHit('a.md', 0, 'x', 3),
        keywordHit('b.md', 0, 'x', 2),
        keywordHit('c.md', 0, 'x', 1),
      ],
      queryVector: null,
      embeddings: new Map(),
      options: { limit: 2, rerank: throwingRerank },
    });
    expect(hits).toHaveLength(2);
  });

  it('rerankFailed is false whenever rerank was not attempted (no rerank option) or succeeded', async () => {
    const chunks = [chunk('a.md', 0, 'text', 'h1')];
    const noRerank = await hybridRetrieve({
      query: 'text',
      chunks,
      keywordHits: [keywordHit('a.md', 0, 'text', 1)],
      queryVector: null,
      embeddings: new Map(),
    });
    expect(noRerank[0]?.rerankFailed).toBe(false);

    const succeedingRerank: RerankProvider = {
      async rerank(request) {
        return { scores: request.candidates.map((c) => ({ id: c.id, score: 1 })) };
      },
    };
    const withRerank = await hybridRetrieve({
      query: 'text',
      chunks,
      keywordHits: [keywordHit('a.md', 0, 'text', 1)],
      queryVector: null,
      embeddings: new Map(),
      options: { rerank: succeedingRerank },
    });
    expect(withRerank[0]?.rerankFailed).toBe(false);
  });

  it('never calls through to a rerank failure when there are no fused candidates (matches the existing no-candidates short-circuit)', async () => {
    const hits = await hybridRetrieve({
      query: 'nothing matches',
      chunks: [chunk('a.md', 0, 'unrelated text', 'h1')],
      keywordHits: [],
      queryVector: null,
      embeddings: new Map(),
      options: { rerank: throwingRerank },
    });
    expect(hits).toEqual([]);
  });
});
