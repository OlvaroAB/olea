/**
 * `buildCorpusRelationWiring` / `corpusConceptsFrom` / `runCorpusRelationBatchIfDue`
 * tests (`[EXT-11]`, `ol-kw4a`, `[D-118]`) — the corpus-level relation
 * stage's production caller.
 *
 * Mirrors `test/concept/wiring.spec.ts`'s fakes and conventions — no
 * `obsidian` import anywhere in this file.
 */
import type {
  CorpusConcept,
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
  PersistedEmbeddingCache,
  ReadConcept,
  RetrievalChunk,
  VaultEvent,
  VaultPath,
  VaultSource,
  WorkerTaskRequest,
} from 'olea-core';
import { EmbeddingCacheEngine, hashText } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ObsidianCorpusRelationStateStore } from '../../src/concept/corpusRelationStateStore.js';
import {
  buildConceptWiring,
  buildCorpusRelationWiring,
  corpusConceptsFrom,
  readConceptsAndRelations,
  runCorpusRelationBatchIfDue,
} from '../../src/concept/wiring.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';

// ---- shared fakes (mirrors wiring.spec.ts) --------------------------------

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function configuredHost(config: PersistedWorkerConfig): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = { [WORKER_CONFIG_STORAGE_KEY]: config };
  return host;
}

function fakeTransport(reply: (request: WorkerTaskRequest) => unknown) {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      return reply(request);
    },
  };
}

class MemoryVault implements VaultSource {
  constructor(private readonly files: Record<string, string> = {}) {}
  list(): Promise<readonly VaultPath[]> {
    return Promise.resolve(Object.keys(this.files).sort());
  }
  read(path: VaultPath): Promise<string> {
    const content = this.files[path];
    if (content === undefined) return Promise.reject(new Error(`no such file ${path}`));
    return Promise.resolve(content);
  }
  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.read(path).then((t) => new TextEncoder().encode(t));
  }
  write(): Promise<void> {
    return Promise.reject(new Error('read-only'));
  }
  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(path in this.files);
  }
  watch(_handler: (event: VaultEvent) => void) {
    return () => undefined;
  }
}

function readConcept(
  name: string,
  sourcePath: VaultPath,
  courses: readonly string[] = [],
): ReadConcept {
  return {
    name,
    aliases: [],
    provenanceTier: 3,
    courses,
    anchor: { sourcePath, location: { page: 1, charRange: { start: 0, end: 1 } } },
    alsoIn: [],
    sourcePaths: [],
    size: { band: 'fine', extent: { noteCount: 1, structureCorroborated: false } },
  };
}

// Builds a REAL `EmbeddingCacheEngine` over a fake store and provider — same
// technique `test/concept/corpusRelationSignals.spec.ts` uses, and for the
// same reason: the class's constructor is private, so a duck-typed object
// literal cannot stand in for one.
class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly vectorByText: ReadonlyMap<string, readonly number[]>) {}
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return {
      vectors: request.texts.map((text) => [...(this.vectorByText.get(text) ?? [0, 0, 0])]),
    };
  }
}

async function buildEmbeddingCache(
  vectorByText: ReadonlyMap<string, readonly number[]>,
): Promise<EmbeddingCacheEngine> {
  const engine = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider: new FakeEmbeddingProvider(vectorByText),
    model: 'test-model',
  });
  const chunks: RetrievalChunk[] = await Promise.all(
    [...vectorByText.keys()].map(async (text, index) => ({
      path: `chunk-${index}.md` as VaultPath,
      blockIndex: 0,
      kind: 'paragraph' as const,
      text,
      contentHash: await hashText(text),
    })),
  );
  await engine.ensureEmbeddings(chunks);
  return engine;
}

const READY_CONFIG: PersistedWorkerConfig = {
  version: 1,
  baseUrl: 'https://worker.example',
  token: 'secret-token',
};

// ---- buildCorpusRelationWiring --------------------------------------------

describe('buildCorpusRelationWiring — F7.8 grey-out', () => {
  it('returns a null verdictPort when no Worker config has ever been saved', async () => {
    const wiring = await buildCorpusRelationWiring({
      dataHost: new FakeDataHost(),
      createTransport: () => fakeTransport(() => ({ ok: true, result: { verdicts: [] } })),
    });
    expect(wiring.verdictPort).toBeNull();
  });

  it('builds a real, usable port when the Worker is configured', async () => {
    const transport = fakeTransport(() => ({ ok: true, result: { verdicts: [] } }));
    const wiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    expect(wiring.verdictPort).not.toBeNull();
  });
});

// ---- corpusConceptsFrom ----------------------------------------------------

describe('corpusConceptsFrom', () => {
  it('drops a concept with no anchor — ineligible for this stage (ReadConcept.anchor doc)', () => {
    const anchored = readConcept('Anchored', 'A.md');
    const unanchored: ReadConcept = { ...readConcept('Unanchored', 'A.md'), anchor: undefined };

    const corpusConcepts = corpusConceptsFrom([anchored, unanchored]);

    expect(corpusConcepts.map((c) => c.name)).toEqual(['Anchored']);
  });

  it('carries name, aliases, anchor and courses through unchanged', () => {
    const concept: ReadConcept = {
      ...readConcept('X', 'A.md', ['CourseA']),
      aliases: ['Alias'],
    };
    const [result] = corpusConceptsFrom([concept]);
    expect(result).toEqual({
      name: 'X',
      aliases: ['Alias'],
      anchor: concept.anchor,
      courses: ['CourseA'],
    });
  });

  it('threads an empty courses array through as-is — "no course" is a statement, not an omission (`ol-2zfj.29`)', () => {
    const concept = readConcept('Uncategorised', 'A.md', []);
    const [result] = corpusConceptsFrom([concept]);
    expect(result?.courses).toEqual([]);
  });
});

// ---- runCorpusRelationBatchIfDue -------------------------------------------

describe('runCorpusRelationBatchIfDue — trigger discipline', () => {
  it('never calls the transport when the Worker is unconfigured', async () => {
    const wiring = await buildCorpusRelationWiring({
      dataHost: new FakeDataHost(),
      createTransport: () => fakeTransport(() => ({ ok: true, result: { verdicts: [] } })),
    });
    const stateStore = new ObsidianCorpusRelationStateStore(new FakeDataHost());
    const concepts: readonly CorpusConcept[] = [
      {
        name: 'A',
        aliases: [],
        anchor: { sourcePath: 'A.md', location: { page: 1, charRange: { start: 0, end: 1 } } },
      },
    ];

    const outcome = await runCorpusRelationBatchIfDue(wiring, stateStore, {
      vault: new MemoryVault({ 'A.md': 'x' }),
      ingestionSessionClosed: true,
      allConcepts: concepts,
    });

    expect(outcome).toEqual({ ran: false });
  });

  it('never fires when the ingestion session has not closed and n is omitted (the concept-count boundary stays disabled)', async () => {
    const transport = fakeTransport(() => ({ ok: true, result: { verdicts: [] } }));
    const wiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const stateStore = new ObsidianCorpusRelationStateStore(new FakeDataHost());
    const concepts: readonly CorpusConcept[] = [
      {
        name: 'A',
        aliases: [],
        anchor: { sourcePath: 'A.md', location: { page: 1, charRange: { start: 0, end: 1 } } },
      },
      {
        name: 'B',
        aliases: [],
        anchor: { sourcePath: 'B.md', location: { page: 1, charRange: { start: 0, end: 1 } } },
      },
    ];

    const outcome = await runCorpusRelationBatchIfDue(wiring, stateStore, {
      vault: new MemoryVault({ 'A.md': 'a', 'B.md': 'b' }),
      ingestionSessionClosed: false,
      allConcepts: concepts,
    });

    expect(outcome).toEqual({ ran: false });
    expect(transport.calls).toHaveLength(0);
  });

  it('runs on ingestion-session-close even with no derived n, and calls the port with real nomination signals', async () => {
    const transport = fakeTransport((request) => {
      const payload = request.payload as { candidates: unknown[] };
      expect(payload.candidates).toHaveLength(1);
      return {
        ok: true,
        result: {
          verdicts: [
            { a: 'Type I error', b: 'Type II error', type: 'contrasts-with', confidence: 0.9 },
          ],
        },
      };
    });
    const wiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const stateStore = new ObsidianCorpusRelationStateStore(new FakeDataHost());
    const vault = new MemoryVault({
      'A.md': 'A Type I error is a false positive; see also [[Type II error]].',
      'B.md': 'A Type II error is a false negative.',
    });
    const concepts: readonly CorpusConcept[] = [
      {
        name: 'Type I error',
        aliases: [],
        anchor: { sourcePath: 'A.md', location: { page: 1, charRange: { start: 0, end: 66 } } },
      },
      {
        name: 'Type II error',
        aliases: [],
        anchor: { sourcePath: 'B.md', location: { page: 1, charRange: { start: 0, end: 37 } } },
      },
    ];

    const outcome = await runCorpusRelationBatchIfDue(wiring, stateStore, {
      vault,
      ingestionSessionClosed: true,
      allConcepts: concepts,
    });

    expect(transport.calls).toHaveLength(1);
    expect(outcome.ran).toBe(true);
    expect(outcome.reason).toBe('ingestion-session-closed');
    expect(outcome.relations).toHaveLength(1);
    expect(outcome.relations?.[0]).toMatchObject({ type: 'contrasts-with' });

    // The known-concept set is persisted only on a run that actually fires.
    expect(await stateStore.load()).toEqual({
      knownConceptNames: expect.arrayContaining(['Type I error', 'Type II error']),
    });
  });

  it('a boundary crossed with nothing new to nominate against is an honest no-op, and never reaches the transport', async () => {
    const transport = fakeTransport(() => ({ ok: true, result: { verdicts: [] } }));
    const wiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const stateStore = new ObsidianCorpusRelationStateStore(new FakeDataHost());
    // Every concept already known — nothing new since last run.
    await stateStore.save({ knownConceptNames: ['A'] });
    const concepts: readonly CorpusConcept[] = [
      {
        name: 'A',
        aliases: [],
        anchor: { sourcePath: 'A.md', location: { page: 1, charRange: { start: 0, end: 1 } } },
      },
    ];

    const outcome = await runCorpusRelationBatchIfDue(wiring, stateStore, {
      vault: new MemoryVault({ 'A.md': 'a' }),
      ingestionSessionClosed: true,
      allConcepts: concepts,
    });

    expect(outcome).toEqual({ ran: false, reason: 'ingestion-session-closed' });
    expect(transport.calls).toHaveLength(0);
  });

  // ---- course scope (`ol-2zfj.29`, C7.10 / `[D-082]`) -----------------------
  //
  // `corpusConceptsFrom`'s own describe block above covers the threading;
  // these two cover what threading is FOR — `nominate.ts`'s `shareACourse`
  // check (landed inert by `ol-x3qg`) actually gating candidates once
  // `allConcepts` carries real `courses` data. Fixture paths sit under
  // `01 Courses/<Course>/` for readability even though this level takes
  // `CorpusConcept.courses` as an explicit input rather than deriving it
  // from the path — that derivation is `corpusConceptsFrom`'s own job,
  // covered separately above.

  it('a her-link-nominated pair spanning two different courses never reaches the verdict port', async () => {
    const transport = fakeTransport(() => ({
      ok: true,
      result: { verdicts: [{ a: 'Bud', b: 'Scale', type: 'contrasts-with', confidence: 0.9 }] },
    }));
    const wiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const stateStore = new ObsidianCorpusRelationStateStore(new FakeDataHost());
    const vault = new MemoryVault({
      '01 Courses/CourseA/Bud.md': 'A bud is a kind of scale, and it sits beside [[Scale]].',
      '01 Courses/CourseB/Scale.md': 'A scale is the covering a bud is made of.',
    });
    const concepts: readonly CorpusConcept[] = [
      {
        name: 'Bud',
        aliases: [],
        courses: ['CourseA'],
        anchor: {
          sourcePath: '01 Courses/CourseA/Bud.md',
          location: { page: 1, charRange: { start: 0, end: 56 } },
        },
      },
      {
        name: 'Scale',
        aliases: [],
        courses: ['CourseB'],
        anchor: {
          sourcePath: '01 Courses/CourseB/Scale.md',
          location: { page: 1, charRange: { start: 0, end: 37 } },
        },
      },
    ];

    const outcome = await runCorpusRelationBatchIfDue(wiring, stateStore, {
      vault,
      ingestionSessionClosed: true,
      allConcepts: concepts,
    });

    // The trigger still fires (a batch boundary closed with new concepts
    // present) — course scope narrows CANDIDATES, not the trigger.
    expect(outcome.ran).toBe(true);
    expect(outcome.candidatesNominated).toBe(0);
    expect(outcome.relations).toEqual([]);
    expect(transport.calls).toHaveLength(0);
  });

  it('a same-course pair nominated ONLY by embedding proximity still reaches the verdict port', async () => {
    const TEXT_ALPHA = 'Alpha describes an isolated topic on its own page.';
    const TEXT_BETA = 'Beta describes a nearly identical topic worded differently.';
    const transport = fakeTransport((request) => {
      const payload = request.payload as { candidates: unknown[] };
      expect(payload.candidates).toHaveLength(1);
      return {
        ok: true,
        result: {
          verdicts: [{ a: 'Alpha', b: 'Beta', type: 'contrasts-with', confidence: 0.8 }],
        },
      };
    });
    const wiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const stateStore = new ObsidianCorpusRelationStateStore(new FakeDataHost());
    const vault = new MemoryVault({
      '01 Courses/CourseA/Alpha.md': TEXT_ALPHA,
      '01 Courses/CourseA/Beta.md': TEXT_BETA,
    });
    const concepts: readonly CorpusConcept[] = [
      {
        name: 'Alpha',
        aliases: [],
        courses: ['CourseA'],
        anchor: {
          sourcePath: '01 Courses/CourseA/Alpha.md',
          location: { page: 1, charRange: { start: 0, end: TEXT_ALPHA.length } },
        },
      },
      {
        name: 'Beta',
        aliases: [],
        courses: ['CourseA'],
        anchor: {
          sourcePath: '01 Courses/CourseA/Beta.md',
          location: { page: 1, charRange: { start: 0, end: TEXT_BETA.length } },
        },
      },
    ];
    const cache = await buildEmbeddingCache(
      new Map([
        [TEXT_ALPHA, [1, 0, 0]],
        [TEXT_BETA, [1, 0.01, 0]],
      ]),
    );

    const outcome = await runCorpusRelationBatchIfDue(wiring, stateStore, {
      vault,
      ingestionSessionClosed: true,
      allConcepts: concepts,
      embeddingProximity: { cache, threshold: 0.9 },
    });

    expect(transport.calls).toHaveLength(1);
    expect(outcome.ran).toBe(true);
    expect(outcome.candidatesNominated).toBe(1);
    expect(outcome.relations).toHaveLength(1);
    expect(outcome.relations?.[0]).toMatchObject({ type: 'contrasts-with' });
  });
});

// ---- readConceptsAndRelations ---------------------------------------------
//
// The landing seam (`ol-2zfj.12`). Before it, BOTH producers' edges were
// computed and dropped. These tests fix the one property that matters: an
// edge from either stage reaches the fold, and neither stage's output is
// silently discarded.
//
// INV-3: every concept name and every line of vault content below is coined
// for this file. None is drawn from any real vault.

/**
 * One transport standing in for both tasks, dispatching on task id — the
 * `concepts.extract.v1` per-document read and the `concepts.relations.v1`
 * corpus verdict. Two concepts, one prose block each, so the extract
 * response's 1-based `anchorIndex` is stable at 1 and 2.
 */
function twoStageTransport() {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      if (request.taskId === 'concepts.extract.v1') {
        return {
          ok: true,
          result: {
            concepts: [
              { name: 'Bud', aliases: [], anchorIndex: 1, alsoInIndexes: [] },
              { name: 'Scale', aliases: [], anchorIndex: 2, alsoInIndexes: [] },
            ],
            relations: [{ type: 'is-a', fromIndex: 1, toIndex: 2, confidence: 0.6 }],
          },
        };
      }
      return {
        ok: true,
        result: {
          verdicts: [{ a: 'Bud', b: 'Scale', type: 'contrasts-with', confidence: 0.9 }],
        },
      };
    },
  };
}

// Fixture paths sit under a shared `01 Courses/CourseA/` folder
// (`ol-2zfj.29`): `corpusConceptsFrom` now threads `ReadConcept.courses`
// through, derived by the real `readConcepts` pipeline from path structure
// (`notePathCourses`, `olea-core`'s `01 Courses` convention). A root-level
// fixture path resolves to `courses: []` on both sides, which `shareACourse`
// (`packages/core/src/concept/corpus-relations/nominate.ts`) correctly reads
// as "confirmed to sit in no course" and drops from every pairing — moving
// both fixtures under the SAME course folder is what keeps this describe
// block's her-link-nominated corpus edge nominating at all under the
// corrected, course-scoped rule, rather than silently flipping a true pass
// into a false one (the exact risk `findings/x3qg-batch-scope.md` named).
const TWO_CONCEPT_VAULT = {
  '01 Courses/CourseA/Bud.md':
    'A bud is a kind of scale, and it sits beside [[Scale]] in the same margin.',
  '01 Courses/CourseA/Scale.md': 'A scale is the covering a bud is made of.',
};

describe('readConceptsAndRelations — both producers land in one fold', () => {
  it('folds the per-document stage AND the corpus stage into a single RelationSet', async () => {
    const transport = twoStageTransport();
    const conceptWiring = await buildConceptWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const corpusWiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });

    const pass = await readConceptsAndRelations(
      conceptWiring,
      corpusWiring,
      new ObsidianCorpusRelationStateStore(new FakeDataHost()),
      { vault: new MemoryVault(TWO_CONCEPT_VAULT), ingestionSessionClosed: true },
    );

    expect(pass).not.toBeNull();
    expect(pass?.corpus.ran).toBe(true);

    // The whole point of the bead: neither stage's edges are dropped. And
    // D-070's distinction survives the fold end to end — the corpus edge was
    // nominated by her own wikilink in `Bud.md`, so `verdict.ts` stamps it
    // `'hers'` (`ol-9qwy`) and it lands as an ASSERTION, while the
    // per-document `is-a` is a model proposal and lands as a candidate.
    const byType = (pass?.relations.entries ?? []).map((entry) => ({
      type: entry.edge.type,
      stage: entry.stage,
      standing: entry.triageStanding,
      provenance: entry.edge.provenance,
    }));
    expect(byType).toEqual(
      expect.arrayContaining([
        {
          type: 'is-a',
          stage: 'per-document',
          standing: 'candidate',
          provenance: 'model-proposed',
        },
        { type: 'contrasts-with', stage: 'corpus', standing: 'assertion', provenance: 'hers' },
      ]),
    );
    expect(byType).toHaveLength(2);
  });

  it('every folded edge carries provenance, confidence and both endpoints introducing passages (C7.10)', async () => {
    const transport = twoStageTransport();
    const conceptWiring = await buildConceptWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const corpusWiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });

    const pass = await readConceptsAndRelations(
      conceptWiring,
      corpusWiring,
      new ObsidianCorpusRelationStateStore(new FakeDataHost()),
      { vault: new MemoryVault(TWO_CONCEPT_VAULT), ingestionSessionClosed: true },
    );

    expect(pass?.relations.entries.length).toBeGreaterThan(0);
    for (const entry of pass?.relations.entries ?? []) {
      expect(['hers', 'model-proposed']).toContain(entry.edge.provenance);
      expect(typeof entry.edge.confidence).toBe('number');
      expect(entry.edge.introducingPassages.from.sourcePath).toBeTruthy();
      expect(entry.edge.introducingPassages.to.sourcePath).toBeTruthy();
      expect(entry.evidence).toBe('current');
    }
  });

  it('a tick that crosses no batch boundary still folds the per-document edges — the corpus stage gates itself, it never blanks the fold', async () => {
    const transport = twoStageTransport();
    const conceptWiring = await buildConceptWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const corpusWiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });

    const pass = await readConceptsAndRelations(
      conceptWiring,
      corpusWiring,
      new ObsidianCorpusRelationStateStore(new FakeDataHost()),
      { vault: new MemoryVault(TWO_CONCEPT_VAULT), ingestionSessionClosed: false },
    );

    expect(pass?.corpus.ran).toBe(false);
    expect(pass?.relations.entries.map((entry) => entry.edge.type)).toEqual(['is-a']);
    expect(transport.calls.some((call) => call.taskId === 'concepts.relations.v1')).toBe(false);
  });

  it('returns null when the Worker is unconfigured — F7.8 grey-out, propagated rather than half-worked', async () => {
    const deps = {
      dataHost: new FakeDataHost(),
      createTransport: () => twoStageTransport(),
    };
    const pass = await readConceptsAndRelations(
      await buildConceptWiring(deps),
      await buildCorpusRelationWiring(deps),
      new ObsidianCorpusRelationStateStore(new FakeDataHost()),
      { vault: new MemoryVault(TWO_CONCEPT_VAULT), ingestionSessionClosed: true },
    );
    expect(pass).toBeNull();
  });

  it('nothing is persisted by the fold — the pass leaves no relation state behind (the Class C line)', async () => {
    const transport = twoStageTransport();
    const dataHost = new FakeDataHost();
    const conceptWiring = await buildConceptWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const corpusWiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });

    await readConceptsAndRelations(
      conceptWiring,
      corpusWiring,
      new ObsidianCorpusRelationStateStore(dataHost),
      { vault: new MemoryVault(TWO_CONCEPT_VAULT), ingestionSessionClosed: true },
    );

    // The corpus stage's own known-concept bookkeeping is all that persists —
    // a rebuildable trigger cache, never the edges themselves. No relation,
    // provenance, passage or confidence reaches any store.
    const blob = dataHost.blob as Record<string, unknown>;
    expect(Object.keys(blob)).toEqual(['corpusRelationState']);
    expect(JSON.stringify(blob)).not.toContain('contrasts-with');
    expect(JSON.stringify(blob)).not.toContain('is-a');
  });
});
