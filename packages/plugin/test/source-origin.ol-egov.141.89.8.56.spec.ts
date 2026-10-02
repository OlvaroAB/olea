/**
 * `ol-egov.141.89.8.56` (D-465): every client request builder that sends `sourceChunks` to a
 * source-reading task sets `sourceChunkOrigins`, aligned by index, through its production entry
 * point. Synthetic fixtures only (INV-3). Per builder: a transcript passage yields its origin, and a
 * request with no transcript passage is exactly what it was before the field existed.
 */
import { SOURCE_CHUNK_ORIGIN_TASK_IDS, sourceChunkOriginsField } from 'olea-contracts';
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
import { WorkerConceptReader } from '../src/concept/workerConceptReader.js';
import { WorkerCorpusRelationVerdict } from '../src/concept/workerCorpusRelationVerdict.js';
import { WorkerKnowledgeKindClassifier } from '../src/concept/workerKnowledgeKindClassifier.js';
import { draftCardsForConcept } from '../src/generation/draft-cards.js';
import { draftQuizCardsForConcept } from '../src/retrieval/draft-quiz-cards.js';
import { sourceChunkOriginsOf } from '../src/source-origin.js';

const TRANSCRIPT = { kind: 'transcript', speakerRole: 'unknown' } as const;
const LOC = { page: 1, charRange: { start: 0, end: 10 } };

class RecordingTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

function payloadOf(transport: RecordingTransport): Record<string, unknown> {
  return (transport.sent[0]?.payload ?? {}) as Record<string, unknown>;
}

const mdHost = { frontmatterFor: () => ({ role: 'lecture-transcript' }) };

describe('the contract fragment this lane fills', () => {
  it('names the seven tasks and accepts the entries the helper builds', () => {
    expect(SOURCE_CHUNK_ORIGIN_TASK_IDS).toHaveLength(7);
    const built = sourceChunkOriginsOf([
      { path: 'a/lecture.txt', text: 'x' },
      { path: 'a/note.md', text: 'y' },
    ]);
    expect(sourceChunkOriginsField.safeParse(built).success).toBe(true);
    expect(built).toEqual([TRANSCRIPT, null]);
  });

  it('carries a role only: no name, label or path in the entry', () => {
    const built = sourceChunkOriginsOf([
      { path: 'Jane Doe interview/lecture.txt', text: 'Jane: x' },
    ]);
    expect(JSON.stringify(built)).toBe('[{"kind":"transcript","speakerRole":"unknown"}]');
  });

  it('a .md transcript needs the host to declare its role; without one it is not a transcript', () => {
    const passages = [{ path: 'a/talk.md', text: 'x' }];
    expect(sourceChunkOriginsOf(passages)).toBeUndefined();
    expect(sourceChunkOriginsOf(passages, mdHost)).toEqual([TRANSCRIPT]);
  });
});

describe('concepts.extract (WorkerConceptReader.read)', () => {
  const passage = (path: string, text: string) => ({
    text,
    anchor: { sourcePath: path, location: LOC },
    course: 'COURSE-A',
  });
  const reply = () => ({ ok: true, stamp: {}, result: { concepts: [] } });

  it('a transcript passage yields its origin, aligned by index', async () => {
    const transport = new RecordingTransport(reply);
    await new WorkerConceptReader({ transport }).read({
      passages: [passage('Notes/a.md', 'Written note.'), passage('Talks/t.txt', 'Spoken words.')],
    });
    expect(transport.sent[0]?.payload).toEqual({
      sourceChunks: ['Written note.', 'Spoken words.'],
      sourceChunkOrigins: [null, TRANSCRIPT],
    });
  });

  it('a request with no transcript passage is byte-identical to before', async () => {
    const transport = new RecordingTransport(reply);
    await new WorkerConceptReader({
      transport,
      frontmatterHost: { frontmatterFor: () => undefined },
    }).read({
      passages: [passage('Notes/a.md', 'One.'), passage('Notes/b.md', 'Two.')],
    });
    expect(JSON.stringify(transport.sent[0]?.payload)).toBe(
      JSON.stringify({ sourceChunks: ['One.', 'Two.'] }),
    );
  });
});

describe('concepts.classify (WorkerKnowledgeKindClassifier.classify)', () => {
  const reply = () => ({ ok: true, stamp: {}, result: { kind: 'fact', confidence: 0.9 } });
  const material = (path: string, text: string) => ({
    text,
    anchor: { sourcePath: path, location: LOC },
  });

  it('a transcript passage yields its origin', async () => {
    const transport = new RecordingTransport(reply);
    await new WorkerKnowledgeKindClassifier({ transport, frontmatterHost: mdHost }).classify({
      conceptName: 'Concept X',
      sourceMaterial: [material('Talks/t.md', 'Spoken.'), material('Talks/n.txt', 'Subtitled.')],
    } as never);
    expect(payloadOf(transport).sourceChunkOrigins).toEqual([TRANSCRIPT, TRANSCRIPT]);
  });

  it('a request with no transcript passage is byte-identical to before', async () => {
    const transport = new RecordingTransport(reply);
    await new WorkerKnowledgeKindClassifier({ transport }).classify({
      conceptName: 'Concept X',
      sourceMaterial: [material('Notes/a.md', 'Written.')],
    } as never);
    expect(JSON.stringify(transport.sent[0]?.payload)).toBe(
      JSON.stringify({ conceptName: 'Concept X', sourceChunks: ['Written.'] }),
    );
  });
});

describe('concepts.relations (WorkerCorpusRelationVerdict.verdict), per endpoint', () => {
  const endpoint = (name: string, path: string, text: string) => ({
    name,
    aliases: [],
    anchor: { sourcePath: path, location: LOC },
    passageText: text,
  });
  const reply = () => ({ ok: true, stamp: {}, result: { verdicts: [] } });

  it('an endpoint drawn from a transcript carries its origin; the other carries none', async () => {
    const transport = new RecordingTransport(reply);
    await new WorkerCorpusRelationVerdict({ transport }).verdict({
      candidates: [
        { a: endpoint('A', 'Talks/t.txt', 'Spoken.'), b: endpoint('B', 'Notes/b.md', 'Written.') },
      ],
    } as never);
    const payload = transport.sent[0]?.payload as {
      endpoints: Record<string, Record<string, unknown>>;
    };
    expect(payload.endpoints.A?.sourceChunkOrigins).toEqual([TRANSCRIPT]);
    expect('sourceChunkOrigins' in (payload.endpoints.B ?? {})).toBe(false);
  });

  it('a request with no transcript endpoint is byte-identical to before', async () => {
    const transport = new RecordingTransport(reply);
    await new WorkerCorpusRelationVerdict({ transport }).verdict({
      candidates: [
        { a: endpoint('A', 'Notes/a.md', 'One.'), b: endpoint('B', 'Notes/b.md', 'Two.') },
      ],
    } as never);
    expect(JSON.stringify(transport.sent[0]?.payload)).toBe(
      JSON.stringify({
        endpoints: {
          A: { name: 'A', aliases: [], sourceChunks: ['One.'] },
          B: { name: 'B', aliases: [], sourceChunks: ['Two.'] },
        },
        candidates: [{ a: 'A', b: 'B' }],
      }),
    );
  });
});

// ---- quiz.generate and cards.generate, through the grounding retrieval ----

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
const QUERY = 'mitochondria';
const TARGET = 'Mitochondria is the powerhouse of the cell and drives cellular respiration.';
const unit = (i: number) => Array.from({ length: DIM }, (_, k) => (k === i ? 1 : 0));

async function retrieveDepsFor(targetPath: string) {
  const provider = new LookupEmbeddingProvider();
  provider.vectors.set(TARGET, unit(0));
  provider.vectors.set(QUERY, unit(0));
  const docs: PersistedKeywordIndex['documents'][number][] = [
    {
      path: targetPath,
      courses: [],
      contentHash: 'unused',
      blocks: [{ blockIndex: 0, kind: 'paragraph', text: TARGET }],
    },
  ];
  for (let i = 0; i < FILLERS; i++) {
    const text = `unrelated filler passage number ${i} about an unrelated topic`;
    provider.vectors.set(text, unit(2 + i));
    docs.push({
      path: `filler/${i}.md`,
      courses: [],
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

  it('a transcript passage yields its origin, aligned with sourceChunks', async () => {
    const transport = generatorTransport();
    const result = await draft(
      { retrieve: await retrieveDepsFor('course/talk.txt'), transport },
      REQUEST,
    );
    expect(result.status).toBe('drafted');
    const sent = transport.sent.find((r) => r.taskId === taskId)?.payload as Record<
      string,
      unknown
    >;
    expect(sent.sourceChunks).toEqual([TARGET]);
    expect(sent.sourceChunkOrigins).toEqual([TRANSCRIPT]);
  });

  it('a .md transcript is recognised through the frontmatter host', async () => {
    const transport = generatorTransport();
    await draft(
      {
        retrieve: await retrieveDepsFor('course/talk.md'),
        transport,
        frontmatterHost: mdHost,
      },
      REQUEST,
    );
    const sent = transport.sent.find((r) => r.taskId === taskId)?.payload as Record<
      string,
      unknown
    >;
    expect(sent.sourceChunkOrigins).toEqual([TRANSCRIPT]);
  });

  it('a request with no transcript passage has no sourceChunkOrigins key at all', async () => {
    const transport = generatorTransport();
    const result = await draft(
      { retrieve: await retrieveDepsFor('course/note.md'), transport },
      REQUEST,
    );
    expect(result.status).toBe('drafted');
    const sent = transport.sent.find((r) => r.taskId === taskId)?.payload as Record<
      string,
      unknown
    >;
    expect(Object.keys(sent)).not.toContain('sourceChunkOrigins');
    expect(Object.keys(sent).sort()).toEqual([
      'conceptName',
      'courseCode',
      'personalization',
      'sourceChunks',
    ]);
  });
});
