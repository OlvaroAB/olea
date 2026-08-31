/**
 * Pure-composition tests for `../../src/explain-back/request.ts` (`ol-12gs`).
 * No `obsidian` import anywhere in this file (INV-1) — mirrors
 * `review/explainWhy.spec.ts`'s shape for the same reason.
 */

import {
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedResult,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildExplainBackPromptContextFromInstrument,
  buildExplainBackPromptContextFromTopic,
  buildGradeExplainBackInputFromTypedAnswer,
  retrieveExplainBackSourceBlocks,
} from '../../src/explain-back/request.js';
import { clozeFixture, mcqFixture, qaFixture } from '../review/fixtures.js';

class RejectingEmbeddingProvider implements EmbeddingProvider {
  embed(): Promise<EmbedResult> {
    return Promise.reject(new Error('RejectingEmbeddingProvider: no embedding provider wired'));
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

function indexWithBlocks(path: string, blocks: readonly string[]): PersistedKeywordIndex {
  return {
    version: 1,
    documents: [
      {
        path,
        courses: [],
        contentHash: 'unused',
        blocks: blocks.map((text, blockIndex) => ({ blockIndex, kind: 'paragraph' as const, text })),
      },
    ],
  };
}

async function fakeRetrieveDeps(keywordIndex: PersistedKeywordIndex) {
  const embeddingProvider = new RejectingEmbeddingProvider();
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider: embeddingProvider,
    model: 'fake-model-v1',
  });
  return { keywordIndex, embeddingCache, embeddingProvider };
}

describe('retrieveExplainBackSourceBlocks', () => {
  it('returns real chunk text, each carrying a stable blockId and its {path, blockIndex}', async () => {
    const keywordIndex = indexWithBlocks('course/note.md', ['a real passage about the topic']);

    const blocks = await retrieveExplainBackSourceBlocks(
      { retrieve: await fakeRetrieveDeps(keywordIndex) },
      'a real passage about the topic',
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.block.text).toBe('a real passage about the topic');
    expect(blocks[0]?.path).toBe('course/note.md');
    expect(blocks[0]?.blockIndex).toBe(0);
    expect(blocks[0]?.block.blockId.length).toBeGreaterThan(0);
  });

  it('an empty index refuses honestly: [], never a thrown error', async () => {
    const keywordIndex = indexWithBlocks('course/empty.md', []);

    const blocks = await retrieveExplainBackSourceBlocks(
      { retrieve: await fakeRetrieveDeps(keywordIndex) },
      'anything',
    );

    expect(blocks).toEqual([]);
  });

  it('two blocks mint two distinct blockIds', async () => {
    const keywordIndex = indexWithBlocks('course/note.md', [
      'first passage about the shared topic',
      'second passage about the shared topic',
    ]);

    const blocks = await retrieveExplainBackSourceBlocks(
      { retrieve: await fakeRetrieveDeps(keywordIndex) },
      'shared topic',
    );

    const ids = blocks.map((entry) => entry.block.blockId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildExplainBackPromptContextFromInstrument', () => {
  it('a Q&A card carries its question and answer as referenceAnswer', () => {
    const context = buildExplainBackPromptContextFromInstrument(qaFixture(), []);
    expect(context.question).toBe(qaFixture().question);
    expect(context.referenceAnswer).toBe(qaFixture().answer);
    expect(context.sourceBlocks).toEqual([]);
    expect(context.misconceptionDigest).toEqual([]);
  });

  it('a cloze card renders the blank inline and the cloze text is the referenceAnswer', () => {
    const fixture = clozeFixture();
    const context = buildExplainBackPromptContextFromInstrument(fixture, []);
    expect(context.question).toBe(`${fixture.before}____${fixture.after}`);
    expect(context.referenceAnswer).toBe(fixture.clozeText);
  });

  it('an MCQ carries the stem and the correct option label as referenceAnswer', () => {
    const fixture = mcqFixture();
    const context = buildExplainBackPromptContextFromInstrument(fixture, []);
    expect(context.question).toBe(fixture.stem);
    expect(context.referenceAnswer).toBe(fixture.options[0]?.label);
  });

  it('carries retrieved source blocks through as GradeExplainBackInput.sourceBlocks', () => {
    const entry = { block: { blockId: 'b1', text: 'passage' }, path: 'p.md', blockIndex: 0 };
    const context = buildExplainBackPromptContextFromInstrument(qaFixture(), [entry]);
    expect(context.sourceBlocks).toEqual([{ blockId: 'b1', text: 'passage' }]);
  });
});

describe('buildExplainBackPromptContextFromTopic', () => {
  it('wraps the topic into a question, honestly with no separate synthesized reference answer', () => {
    const entry = { block: { blockId: 'b1', text: 'a passage about photosynthesis' }, path: 'p.md', blockIndex: 0 };
    const context = buildExplainBackPromptContextFromTopic('photosynthesis', [entry]);
    expect(context.question).toBe('In your own words: explain photosynthesis.');
    expect(context.referenceAnswer).toBe('a passage about photosynthesis');
  });

  it('joins multiple retrieved blocks for the referenceAnswer', () => {
    const entries = [
      { block: { blockId: 'b1', text: 'first' }, path: 'p.md', blockIndex: 0 },
      { block: { blockId: 'b2', text: 'second' }, path: 'p.md', blockIndex: 1 },
    ];
    const context = buildExplainBackPromptContextFromTopic('a topic', entries);
    expect(context.referenceAnswer).toBe('first\n\nsecond');
  });

  it('an empty retrieval yields an empty referenceAnswer — the caller decides whether that is gradeable', () => {
    const context = buildExplainBackPromptContextFromTopic('a topic', []);
    expect(context.referenceAnswer).toBe('');
  });
});

describe('buildGradeExplainBackInputFromTypedAnswer', () => {
  it('mirrors buildGradeExplainBackInputFromTranscript field for field, with a typed studentAnswer', () => {
    const context = buildExplainBackPromptContextFromTopic('a topic', []);
    const input = buildGradeExplainBackInputFromTypedAnswer('her typed answer', context);
    expect(input).toEqual({
      question: context.question,
      studentAnswer: 'her typed answer',
      referenceAnswer: context.referenceAnswer,
      sourceBlocks: context.sourceBlocks,
      misconceptionDigest: context.misconceptionDigest,
    });
  });
});
