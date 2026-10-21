/**
 * Scenarios: features/F3-learn-from-anything.md, the `[D-550]` / `[D-551]` block —
 * @auto:plugin/generation/wiring.first-kind.ol-egov.141.89.105.7.spec
 *
 * The sweep's seam carries the first-kind inputs and the card supplier (`ol-egov.141.89.105.7`):
 * `buildGenerationWiring().sweep(..., firstKind)` with the producer from
 * `GenerationWiring.buildKindInputs`, driven end to end through real retrieval and the real
 * drafters against a transport that answers in process. The card drafter is handed the SAME
 * drafting deps value the quiz path uses. Omitted, every request is the quiz request it was. The
 * per-course record (`ol-egov.141.89.105.9`) fills with real reasons. Every fixture string is
 * invented; nothing touches the network.
 */
import {
  type AssessmentRecord,
  appendReviewLogRecord,
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
  type ExtractedUnit,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  type SchedulableInstrumentType,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildGenerationWiring } from '../../src/generation/wiring.js';
import { MemoryVaultSource } from './fakes.js';

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
  private readonly vectors = new Map<string, readonly number[]>();
  register(text: string, vector: readonly number[]): void {
    this.vectors.set(text, vector);
  }
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return {
      vectors: request.texts.map((text) => {
        const vector = this.vectors.get(text);
        if (vector === undefined) throw new Error(`no vector for ${JSON.stringify(text)}`);
        return vector;
      }),
    };
  }
}

// The orthogonal fixture `draft-cards.spec.ts` argues for: 100 fillers keep the margin's 99th
// percentile off the target, so a cosine-1.0 target clears the band and reaches the judge.
const FILLER_COUNT = 100;
const DIM = 2 + FILLER_COUNT;
const CONCEPT = 'zorbite';
const PASSAGE = 'Zorbite is the soft blue mineral that forms in cooling vents.';
const NOW = new Date('2026-01-10T09:00:00');

function unitVector(i: number): number[] {
  const v = new Array(DIM).fill(0);
  v[i] = 1;
  return v;
}

function assessment(course: string, type: string, due: string): AssessmentRecord {
  return {
    path: `02 Assignments/${course} ${type}.md`,
    course,
    type,
    weight: 10,
    weightRaw: '10',
    due,
    status: 'upcoming',
  };
}

async function world(course: string) {
  const note = `01 Courses/${course}/Week 1.md`;
  const vault = new MemoryVaultSource({
    [note]: `---\ntopic: [${CONCEPT}]\ncourse: ${course}\n---\n\n# Week 1\n\n${PASSAGE}\n`,
  });
  const provider = new LookupEmbeddingProvider();
  provider.register(PASSAGE, unitVector(0));
  provider.register(CONCEPT, unitVector(0));
  const documents: PersistedKeywordIndex['documents'][number][] = [
    {
      path: note,
      courses: [course],
      contentHash: 'unused',
      blocks: [{ blockIndex: 0, kind: 'paragraph', text: PASSAGE }],
    },
  ];
  for (let i = 0; i < FILLER_COUNT; i++) {
    const text = `unrelated filler passage number ${i} about an unrelated topic`;
    provider.register(text, unitVector(2 + i));
    documents.push({
      path: `01 Courses/${course}/filler/${i}.md`,
      courses: [course],
      contentHash: 'unused',
      blocks: [{ blockIndex: 0, kind: 'paragraph', text }],
    });
  }
  const keywordIndex: PersistedKeywordIndex = {
    version: 1,
    documents: documents.sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider,
    model: 'fake-model-v1',
  });
  const calls: WorkerTaskRequest[] = [];
  const stamp = { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' };
  const transport = {
    send: async (request: WorkerTaskRequest): Promise<unknown> => {
      calls.push(request);
      if (request.taskId === 'grounding.judge.v1') {
        return { ok: true, stamp, result: { supported: true, reason: 'the passage answers it' } };
      }
      if (request.taskId === 'cards.generate.v1') {
        return {
          ok: true,
          stamp,
          result: { cards: [{ front: 'What is zorbite?', back: 'A mineral.', subject: CONCEPT }] },
        };
      }
      if (request.taskId === 'quiz.generate.v1') {
        return {
          ok: true,
          stamp,
          result: {
            questions: [
              {
                stem: 'Where does zorbite form?',
                correctAnswer: 'Cooling vents',
                distractors: ['Deserts', 'Glaciers', 'Riverbeds'],
                feedback: 'See the week 1 passage.',
              },
            ],
          },
        };
      }
      throw new Error(`unexpected task ${request.taskId}`);
    },
  };
  const draftDeps = {
    retrieve: { keywordIndex, embeddingCache, embeddingProvider: provider },
    transport,
  };
  const wiring = buildGenerationWiring({ vault, deviceId: 'device-a', now: () => NOW });
  const unit: ExtractedUnit = {
    text: 'unused',
    provenance: { sourcePath: note, location: { page: 1, charRange: { start: 0, end: 1 } } },
  };
  return { vault, wiring, draftDeps, calls, unit };
}

async function rate(vault: MemoryVaultSource, kind: SchedulableInstrumentType, n: number) {
  await appendReviewLogRecord(
    vault,
    {
      timestamp: `2026-01-0${n}T09:00:00+00:00`,
      instrumentId: `instrument-${kind}-${n}`,
      instrumentType: kind,
      conceptIds: ['concept-key-elsewhere'],
      rating: 'good',
      wasUnsure: false,
      durationMs: null,
      selectionContext: {
        dueState: 'new',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: [kind],
        planVersion: null,
      },
    },
    { deviceId: 'device-a', generateEventId: () => `event-${kind}-${n}` },
  );
}

const taskIds = (calls: readonly WorkerTaskRequest[]) => calls.map((call) => call.taskId);

describe('the sweep seam carries the first-kind inputs and the card supplier (ol-egov.141.89.105.7)', () => {
  it('course A (written nearest): drafted through the card generator with the same drafting deps, cached as a qa draft', async () => {
    const A = 'TESTA101';
    const { wiring, draftDeps, calls, unit } = await world(A);
    const kinds = await wiring.buildKindInputs([assessment(A, 'Essay', '2026-02-01')]);

    const report = await wiring.sweep([unit], draftDeps, undefined, undefined, undefined, {
      kindInputsFor: kinds.kindInputsFor,
      draftCards: true,
    });

    expect(report).toMatchObject({ attempted: 1, drafted: 1, refused: 0 });
    expect(report?.courseKinds).toEqual([
      { courseCode: A, kind: 'qa', asked: 'qa', reason: 'format-class' },
    ]);
    // One transport, one retrieval: the quiz path's own deps value served the card drafter.
    expect(taskIds(calls)).toEqual(['grounding.judge.v1', 'cards.generate.v1']);
    const [record] = await wiring.cache.listPending();
    expect(record).toMatchObject({
      instrumentType: 'qa',
      courseCode: A,
      conceptName: CONCEPT,
      provenance: { taskId: 'cards.generate.v1' },
    });
    expect(record?.card).toEqual({ front: 'What is zorbite?', back: 'A mineral.' });
  });

  it('course C (recall-style nearest): drafted through the quiz generator, as before', async () => {
    const C = 'TESTC303';
    const { wiring, draftDeps, calls, unit } = await world(C);
    const kinds = await wiring.buildKindInputs([assessment(C, 'Quiz', '2026-02-01')]);

    const report = await wiring.sweep([unit], draftDeps, undefined, undefined, undefined, {
      kindInputsFor: kinds.kindInputsFor,
      draftCards: true,
    });

    expect(report?.courseKinds).toEqual([
      { courseCode: C, kind: 'mcq', asked: 'mcq', reason: 'format-class' },
    ]);
    expect(taskIds(calls)).toEqual(['grounding.judge.v1', 'quiz.generate.v1']);
    const [record] = await wiring.cache.listPending();
    expect(record?.instrumentType).toBeUndefined();
    expect(record?.question?.stem).toBe('Where does zorbite form?');
  });

  it('without the opt-in, the written course is the quiz request it was, and the record says no kind was asked', async () => {
    const A = 'TESTA101';
    const optedIn = await world(A);
    const plain = await world(A);
    const report = await plain.wiring.sweep([plain.unit], plain.draftDeps);
    expect(taskIds(plain.calls)).toEqual(['grounding.judge.v1', 'quiz.generate.v1']);
    expect(report?.courseKinds).toEqual([
      { courseCode: A, kind: 'mcq', asked: null, reason: 'card-supplier-absent' },
    ]);
    // The quiz request without the opt-in is the one a recall-style course sends with it.
    const kinds = await optedIn.wiring.buildKindInputs([assessment(A, 'Exam', '2026-02-01')]);
    await optedIn.wiring.sweep([optedIn.unit], optedIn.draftDeps, undefined, undefined, undefined, {
      kindInputsFor: kinds.kindInputsFor,
      draftCards: true,
    });
    expect(optedIn.calls.map((c) => c.payload)).toEqual(plain.calls.map((c) => c.payload));
  });

  it('kind inputs without the card opt-in: a card is asked, multiple choice drafted, and the absent supplier named', async () => {
    const A = 'TESTA101';
    const { wiring, draftDeps, calls, unit } = await world(A);
    const kinds = await wiring.buildKindInputs([assessment(A, 'Lab', '2026-02-01')]);
    const report = await wiring.sweep([unit], draftDeps, undefined, undefined, undefined, {
      kindInputsFor: kinds.kindInputsFor,
      draftCards: false,
    });
    expect(report?.courseKinds).toEqual([
      { courseCode: A, kind: 'mcq', asked: 'qa', reason: 'card-supplier-absent' },
    ]);
    expect(taskIds(calls)).toEqual(['grounding.judge.v1', 'quiz.generate.v1']);
  });

  it.each([
    [
      'her recorded preference, with no format known',
      ['qa', 'qa', 'mcq'],
      'qa',
      'qa',
      'recorded-preference',
    ],
    ['the floor, with nothing known and nothing rated', [], 'mcq', 'mcq', 'floor'],
    [
      'a cloze preference, with no cloze generator',
      ['cloze', 'cloze'],
      'mcq',
      'cloze',
      'cloze-asked-multiple-choice-drafted',
    ],
  ] as const)(
    'the record fills with a real reason: %s',
    async (_label, rated, kind, asked, reason) => {
      const D = 'TESTD404';
      const { vault, wiring, draftDeps, unit } = await world(D);
      for (const [index, ratedKind] of rated.entries()) await rate(vault, ratedKind, index + 1);
      // Course D's only assessment has passed: no format is known.
      const kinds = await wiring.buildKindInputs([assessment(D, 'Exam', '2026-01-01')]);
      const report = await wiring.sweep([unit], draftDeps, undefined, undefined, undefined, {
        kindInputsFor: kinds.kindInputsFor,
        draftCards: true,
      });
      expect(report?.courseKinds).toEqual([{ courseCode: D, kind, asked, reason }]);
    },
  );

  it('buildKindInputs hands the format-ask trigger the same mapping', async () => {
    const { wiring } = await world('TESTA101');
    const kinds = await wiring.buildKindInputs([
      assessment('TESTA101', 'Essay', '2026-02-01'),
      assessment('TESTC303', 'Quiz', '2026-02-01'),
      assessment('TESTD404', 'Exam', '2026-01-01'),
    ]);
    expect(kinds.formatMatchFor('TESTA101')).toBe('qa');
    expect(kinds.formatMatchFor('TESTC303')).toBe('mcq');
    expect(kinds.formatMatchFor('TESTD404')).toBeUndefined();
  });
});
