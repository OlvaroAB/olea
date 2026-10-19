/**
 * Scenarios: features/F8-concepts-scope.md, the `ol-egov.141.89.3.51` ([D-068]) block —
 * @auto:plugin/generation/wiring.read-minted.d-068.spec
 *
 * The sweep's candidates for a course are her records plus the tier-3 keys the course holds that
 * extraction does not read: a concept the material read minted for it, and each course-scoped
 * identity (`[D-544]`). Trying them is what lets a thin course state a refusal for a ranked wording
 * rather than say nothing. Every fixture string is invented.
 */
import {
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
  type ExtractedUnit,
  type IndexedDocument,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  resolveConceptKey,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildGenerationWiring } from '../../src/generation/wiring.js';
import { MemoryVaultSource } from './fakes.js';

const C = 'CEE101';
const D = 'DEE202';
const WORDING = 'tessellite';
const C_PAPER = `01 Courses/${C}/Past paper 2024.md`;
const D_NOTE = `01 Courses/${D}/Week 3.md`;
const C_NOTE = `01 Courses/${C}/Week 1.md`;
const D_PASSAGE = 'Tessellite is the interlocking crystal habit course D explains at length.';

function topic(course: string, name: string, paths: readonly string[]) {
  return { kind: 'topic' as const, course, name, aliases: [], introducingPaths: paths };
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

const DIM = 8;
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
        if (vector === undefined) throw new Error(`no vector for ${JSON.stringify(text)}`);
        return vector;
      }),
    };
  }
}

function doc(path: string, text: string): IndexedDocument {
  return {
    path,
    courses: [],
    contentHash: 'unused',
    blocks: [{ blockIndex: 0, kind: 'paragraph', text }],
  };
}

function unitIn(notePath: string): ExtractedUnit {
  return {
    text: 'unused',
    provenance: {
      sourcePath: 'some-lecture.pdf',
      location: { page: 1, charRange: { start: 0, end: 1 } },
      embeddedIn: { notePath, blockStart: 0, blockEnd: 10 },
    },
  };
}

async function world() {
  const vault = new MemoryVaultSource({
    [C_NOTE]: '# Week 1\n\nNothing about the wording here.\n',
    [C_PAPER]: '# Past paper\n\nQuestion 1: name the interlocking crystal habit.\n',
    [D_NOTE]: `# Week 3\n\n${D_PASSAGE}\n`,
  });
  const provider = new LookupEmbeddingProvider();
  provider.register(WORDING, axis(0));
  provider.register(D_PASSAGE, axis(0));
  provider.register('course C filler', axis(1));
  const keywordIndex: PersistedKeywordIndex = {
    version: 1,
    documents: [doc(C_NOTE, 'course C filler'), doc(D_NOTE, D_PASSAGE)].sort((a, b) =>
      a.path < b.path ? -1 : 1,
    ),
  };
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider,
    model: 'fake-model-v1',
  });
  const calls: WorkerTaskRequest[] = [];
  const draftDeps = {
    retrieve: { keywordIndex, embeddingCache, embeddingProvider: provider },
    transport: {
      send: async (request: WorkerTaskRequest): Promise<unknown> => {
        calls.push(request);
        throw new Error('no generative request may be sent for a thin course');
      },
    },
  };
  return { vault, draftDeps, calls };
}

describe('[D-068] the sweep tries a course’s read-minted and course-scoped identities', () => {
  it('lists a concept the read minted for the course, under its minted key, for that course alone', async () => {
    const { vault } = await world();
    const key = await resolveConceptKey(vault, 3, topic(C, 'Kyanite', [C_NOTE]));
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });

    const forC = await wiring.listConceptsForCourse(C);
    const forD = await wiring.listConceptsForCourse(D);

    const listed = forC.find((c) => c.name === 'Kyanite');
    expect(listed?.key).toBe(key);
    expect(listed?.courses).toEqual([C]);
    expect(forD.map((c) => c.name)).not.toContain('Kyanite');
  });

  it('a course-scoped identity is offered to its own course only, and a wording split by course stays two', async () => {
    const { vault } = await world();
    const keyC = await resolveConceptKey(vault, 3, topic(C, WORDING, [C_PAPER]));
    const keyD = await resolveConceptKey(vault, 3, topic(D, WORDING, [D_NOTE]));
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });

    const forC = (await wiring.listConceptsForCourse(C)).filter((c) => c.name === WORDING);
    const forD = (await wiring.listConceptsForCourse(D)).filter((c) => c.name === WORDING);

    expect(forC.map((c) => c.key)).toEqual([keyC]);
    expect(forD.map((c) => c.key)).toEqual([keyD]);
  });

  it('a key whose introducing material is gone is not tried', async () => {
    const { vault } = await world();
    await resolveConceptKey(vault, 3, topic(C, 'Vanished', ['01 Courses/CEE101/Deleted.md']));
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });

    expect((await wiring.listConceptsForCourse(C)).map((c) => c.name)).not.toContain('Vanished');
  });

  it('a thin course states a refusal for its course-scoped identity: tried, nothing sent, never a draft from D’s notes', async () => {
    const { vault, draftDeps, calls } = await world();
    await resolveConceptKey(vault, 3, topic(C, WORDING, [C_PAPER]));
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });

    const report = await wiring.sweep([unitIn(C_NOTE)], draftDeps);

    expect(report?.attempted).toBe(1);
    expect(report?.drafted).toBe(0);
    expect(report?.refused).toBe(1);
    expect(report?.refusals.map((r) => r.conceptName)).toEqual([WORDING]);
    expect(calls).toHaveLength(0);
  });
});
