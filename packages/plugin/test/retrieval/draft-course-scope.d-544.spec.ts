/**
 * `[D-544]` (ruled by David 2026-10-17, `ol-egov.141.89.3.52`) at both drafting call sites: every
 * draft is grounded in its own course's reading set only, so another course's notes never satisfy
 * a course's grounding, a course whose own material is thin keeps its stated refusal, and a
 * confirmed same-as link between the two courses' identities does not widen the scope ("identity
 * equivalence, assessment relevance and permission to reuse another course's material are separate
 * decisions").
 *
 * The embedding space is orthogonal and exact, as `draft-quiz-cards.spec.ts` builds it. Every
 * fixture string is invented: course codes, the wording, the passages.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  confirmSameAsLink,
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
  FolderSource,
  type IndexedDocument,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  proposeSameAsLink,
  type WorkerTaskRequest,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { draftCardsForConcept } from '../../src/generation/draft-cards.js';
import { draftQuizCardsForConcept } from '../../src/retrieval/draft-quiz-cards.js';

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

const FILLER = 30;
const DIM = 4 + FILLER;

function axis(index: number): number[] {
  const v = new Array(DIM).fill(0);
  v[index] = 1;
  return v;
}

class LookupEmbeddingProvider implements EmbeddingProvider {
  private readonly vectors = new Map<string, readonly number[]>();
  register(text: string, vector: readonly number[]): void {
    this.vectors.set(text, vector);
  }
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return {
      vectors: request.texts.map((text) => {
        const vector = this.vectors.get(text);
        if (vector === undefined)
          throw new Error(`no vector registered for ${JSON.stringify(text)}`);
        return vector;
      }),
    };
  }
}

const C = 'CEE101';
const D = 'DEE202';
const WORDING = 'tessellite';
const D_PASSAGE = 'Tessellite is the interlocking crystal habit course D explains at length.';
const C_PASSAGE = 'Tessellite, as course C notes put it, is an interlocking crystal habit.';
const ZETTEL_PASSAGE = 'Tessellite: an interlocking crystal habit, in her own concept note.';

function doc(path: string, text: string): IndexedDocument {
  return {
    path,
    courses: [],
    contentHash: 'unused',
    blocks: [{ blockIndex: 0, kind: 'paragraph', text }],
  };
}

/** Course C's folder holds filler (and, optionally, its own note); course D's holds the explanation. */
function fixture(options: {
  readonly cOwnNote?: boolean;
  readonly cLinksZettel?: 'body' | 'frontmatter';
}) {
  const provider = new LookupEmbeddingProvider();
  provider.register(WORDING, axis(0));
  provider.register(D_PASSAGE, axis(0));
  provider.register(C_PASSAGE, axis(0));
  provider.register(ZETTEL_PASSAGE, axis(0));
  const documents: IndexedDocument[] = [];
  for (let i = 0; i < FILLER; i++) {
    const text = `unrelated filler passage ${i}`;
    provider.register(text, axis(4 + i));
    documents.push(doc(`01 Courses/${i % 2 === 0 ? C : D}/filler ${i}.md`, text));
  }
  documents.push(doc(`01 Courses/${D}/Week 3.md`, D_PASSAGE));
  if (options.cOwnNote === true) documents.push(doc(`01 Courses/${C}/Week 1.md`, C_PASSAGE));
  documents.push(doc('Zettelkasten/Tessellite.md', ZETTEL_PASSAGE));
  if (options.cLinksZettel === 'body') {
    const linking = 'See [[Tessellite]] for the definition.';
    provider.register(linking, axis(3));
    documents.push(doc(`01 Courses/${C}/Week 2.md`, linking));
  } else if (options.cLinksZettel === 'frontmatter') {
    const plain = 'Week two notes.';
    provider.register(plain, axis(3));
    documents.push(doc(`01 Courses/${C}/Week 2.md`, plain));
  }
  const keywordIndex: PersistedKeywordIndex = {
    version: 1,
    documents: documents.sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
  return { keywordIndex, provider };
}

async function retrieveDeps(
  keywordIndex: PersistedKeywordIndex,
  provider: LookupEmbeddingProvider,
) {
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider,
    model: 'fake-model-v1',
  });
  return { keywordIndex, embeddingCache, embeddingProvider: provider };
}

const STAMP = { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' };

function fakeTransport() {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest): Promise<unknown> => {
      calls.push(request);
      if (request.taskId === 'grounding.judge.v1') {
        return { ok: true, stamp: STAMP, result: { supported: true, reason: 'supported' } };
      }
      if (request.taskId === 'cards.generate.v1') {
        return {
          ok: true,
          stamp: STAMP,
          result: { cards: [{ front: 'f', back: 'b', subject: 's' }] },
        };
      }
      return {
        ok: true,
        stamp: STAMP,
        result: {
          questions: [
            {
              stem: 'stem',
              correctAnswer: 'a',
              distractors: ['b', 'c', 'd', 'e'],
              feedback: 'why',
            },
          ],
        },
      };
    },
  };
}

/** The `sourceChunks` the generative call carried. */
function sentChunks(calls: readonly WorkerTaskRequest[]): readonly string[] {
  const call = calls.find(
    (c) => c.taskId === 'quiz.generate.v1' || c.taskId === 'cards.generate.v1',
  );
  return (call?.payload as { sourceChunks?: readonly string[] } | undefined)?.sourceChunks ?? [];
}

const DRAFTERS = [
  ['quiz', draftQuizCardsForConcept],
  ['cards', draftCardsForConcept],
] as const;

describe('[D-544] every drafting call is grounded in its own course reading set', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-draft-scope-d544-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  for (const [kind, draft] of DRAFTERS) {
    it(`${kind}: refuses for course C when only course D's notes cover the concept, sends nothing, and a confirmed same-as link changes nothing`, async () => {
      const { keywordIndex, provider } = fixture({});
      const transport = fakeTransport();
      const deps = { retrieve: await retrieveDeps(keywordIndex, provider), transport };
      const request = { courseCode: C, conceptName: WORDING };

      const before = await draft(deps, request);
      expect(before.status).toBe('refused');
      expect(transport.calls).toHaveLength(0);

      // She confirms that C's identity of the wording and D's are one concept.
      await proposeSameAsLink(vault, 'concept-key1:cee-tessellite', 'concept-key1:dee-tessellite');
      await confirmSameAsLink(vault, 'concept-key1:cee-tessellite', 'concept-key1:dee-tessellite');

      const after = await draft(deps, request);
      expect(after).toEqual(before);
      expect(transport.calls).toHaveLength(0);

      // The contrast that makes the refusal mean something: course D drafting the same concept grounds.
      const forD = await draft(deps, { courseCode: D, conceptName: WORDING });
      expect(forD.status).toBe('drafted');
      expect(sentChunks(transport.calls)).toContain(D_PASSAGE);
    });

    it(`${kind}: where course C's own note covers the concept, drafts from C's reading set alone`, async () => {
      const { keywordIndex, provider } = fixture({ cOwnNote: true });
      const transport = fakeTransport();
      const result = await draft(
        { retrieve: await retrieveDeps(keywordIndex, provider), transport },
        { courseCode: C, conceptName: WORDING },
      );
      expect(result.status).toBe('drafted');
      const chunks = sentChunks(transport.calls);
      expect(chunks).toContain(C_PASSAGE);
      expect(chunks).not.toContain(D_PASSAGE);
      expect(chunks).not.toContain(ZETTEL_PASSAGE);
    });

    it(`${kind}: a note course C links once is C's material, by a body link or, through the host, a frontmatter link`, async () => {
      for (const link of ['body', 'frontmatter'] as const) {
        const { keywordIndex, provider } = fixture({ cLinksZettel: link });
        const transport = fakeTransport();
        const frontmatterHost = {
          frontmatterFor: (path: string) =>
            link === 'frontmatter' && path === `01 Courses/${C}/Week 2.md`
              ? { topic: [['Tessellite']] }
              : undefined,
        };
        const result = await draft(
          { retrieve: await retrieveDeps(keywordIndex, provider), transport, frontmatterHost },
          { courseCode: C, conceptName: WORDING },
        );
        expect(result.status).toBe('drafted');
        const chunks = sentChunks(transport.calls);
        expect(chunks).toContain(ZETTEL_PASSAGE);
        expect(chunks).not.toContain(D_PASSAGE);
      }
    });
  }
});
