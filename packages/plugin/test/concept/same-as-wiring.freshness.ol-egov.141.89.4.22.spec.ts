/**
 * `resolveSameAsForPass` keeps a stale relation withheld (`ol-egov.141.89.4.22`): since
 * `ol-egov.141.89.4.15`, `readRelationSetWithCache` withholds a cached edge whose endpoint has
 * moved since it was judged (rel.md §3 Default 4). Same-as resolution used to re-read every
 * non-disposed relation-cache record and fold it back on top, so the withheld edge came back
 * downstream. These tests prove it now stays withheld — at `resolveSameAsForPass`'s own layer, with
 * and without a confirmed same-as link touching it, and end to end across three ticks of
 * `readConceptsAndRelations` — and that fresh edges still merge.
 *
 * No `obsidian` import anywhere in this file. Every fixture string is invented (INV-3).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ConceptKeyRecord,
  ConceptRelation,
  ConceptsRead,
  ListOptions,
  NoteAnchor,
  VaultEvent,
  VaultPath,
  VaultSource,
  WorkerTaskRequest,
} from 'olea-core';
import {
  computeConceptRevision,
  conceptKeyRecordPath,
  confirmSameAsLink,
  FolderSource,
  proposeSameAsLink,
  servedRelations,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObsidianCorpusRelationStateStore } from '../../src/concept/corpusRelationStateStore.js';
import {
  persistRelationCacheFromPass,
  readRelationSetWithCache,
} from '../../src/concept/relation-wiring.js';
import { resolveSameAsForPass } from '../../src/concept/same-as-wiring.js';
import type { ConceptAndRelationPass } from '../../src/concept/wiring.js';
import {
  buildConceptWiring,
  buildCorpusRelationWiring,
  readConceptsAndRelations,
} from '../../src/concept/wiring.js';
import type {
  MaterialityHashStore,
  MaterialityRecord,
} from '../../src/ingestion/materiality/types.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';

// ---- shared fakes -----------------------------------------------------------

function materialityRecord(path: string, rawHash: string): MaterialityRecord {
  return {
    path,
    hashes: { rawHash, canonicalHash: rawHash },
    canonicalLength: 0,
    lastChangedAt: 0,
    lastVerdictAt: null,
  };
}

/** A `MaterialityHashStore` over a plain map — the revision lives in `hashes.rawHash`. */
function fakeHashStore(revisions: Readonly<Record<string, string>>): MaterialityHashStore {
  return {
    async load(path: string) {
      const rawHash = revisions[path];
      return rawHash === undefined ? null : materialityRecord(path, rawHash);
    },
    async save() {
      throw new Error('fakeHashStore.save is not used by these tests');
    },
  };
}

// ---- resolveSameAsForPass over a freshness-gated baseline -------------------

const introducingPassages = {
  from: { sourcePath: 'Alpha.md', location: { page: 1 } },
  to: { sourcePath: 'Gamma.md', location: { page: 1 } },
};

/** The judgment-time digest a real write-side stamp records for one single-path endpoint. */
const digestFor = (path: string, rawHash: string): string =>
  computeConceptRevision([path], () => rawHash) as string;

function noteAnchor(notePath: string): NoteAnchor {
  return { kind: 'note', noteUid: null, notePath };
}

async function seedConceptKey(vault: FolderSource, key: string, notePath: string): Promise<void> {
  const record: ConceptKeyRecord = {
    key,
    tier: 1,
    anchor: noteAnchor(notePath),
    aliases: [],
    mintedAt: '2026-09-27T00:00:00.000Z',
    schemaVersion: 1,
  };
  await vault.write(conceptKeyRecordPath(record.key), `${JSON.stringify(record, null, 2)}\n`);
}

function corpusEdge(
  overrides: Partial<
    ConceptRelation & {
      fromKey?: string;
      toKey?: string;
      endpointRevisions?: { readonly from: string; readonly to: string };
    }
  > = {},
) {
  return {
    type: 'prerequisite' as const,
    from: 'Alpha',
    to: 'Gamma',
    provenance: 'model-proposed' as const,
    confidence: 0.7,
    introducingPassages,
    fromKey: 'key-alpha',
    toKey: 'key-gamma',
    ...overrides,
  };
}

function passWith(
  corpusRelations?: readonly ReturnType<typeof corpusEdge>[],
): ConceptAndRelationPass {
  return {
    read: {
      outcome: 'read',
      concepts: [],
      relations: [],
      relationsDropped: 0,
    } as unknown as ConceptsRead,
    corpus:
      corpusRelations === undefined
        ? { ran: false }
        : ({
            ran: true,
            relations: corpusRelations,
          } as unknown as ConceptAndRelationPass['corpus']),
    relations: { entries: [], mergedDuplicates: 0, contradictions: 0, droppedUnemittable: 0 },
  } as unknown as ConceptAndRelationPass;
}

/** The baseline production folds before same-as resolution (`./wiring.ts`'s `readConceptsAndRelations`), on a tick whose corpus stage did not run. */
async function productionShapedPass(
  vault: FolderSource,
  hashStore: MaterialityHashStore,
): Promise<ConceptAndRelationPass> {
  const pass = passWith(undefined);
  return { ...pass, relations: await readRelationSetWithCache(vault, pass, { hashStore }) };
}

describe('resolveSameAsForPass keeps a stale relation withheld (ol-egov.141.89.4.22)', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-same-as-freshness-'));
    vault = new FolderSource(root);
    await seedConceptKey(vault, 'key-alpha', 'Alpha.md');
    await seedConceptKey(vault, 'key-beta', 'Beta.md');
    await seedConceptKey(vault, 'key-gamma', 'Gamma.md');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a relation withheld as stale by the baseline stays withheld after same-as resolution', async () => {
    await persistRelationCacheFromPass(
      vault,
      passWith([
        corpusEdge({
          endpointRevisions: {
            from: digestFor('Alpha.md', 'rev-1'),
            to: digestFor('Gamma.md', 'rev-1'),
          },
        }),
      ]),
    );
    // Gamma's source has moved since the edge was judged.
    const pass = await productionShapedPass(
      vault,
      fakeHashStore({ 'Alpha.md': 'rev-1', 'Gamma.md': 'rev-2' }),
    );
    expect(servedRelations(pass.relations)).toHaveLength(0);

    const result = await resolveSameAsForPass(vault, pass);
    expect(servedRelations(result.relations)).toHaveLength(0);
  });

  it('a fresh relation still serves after same-as resolution', async () => {
    await persistRelationCacheFromPass(
      vault,
      passWith([
        corpusEdge({
          endpointRevisions: {
            from: digestFor('Alpha.md', 'rev-1'),
            to: digestFor('Gamma.md', 'rev-1'),
          },
        }),
      ]),
    );
    const pass = await productionShapedPass(
      vault,
      fakeHashStore({ 'Alpha.md': 'rev-1', 'Gamma.md': 'rev-1' }),
    );

    const served = servedRelations((await resolveSameAsForPass(vault, pass)).relations);
    expect(served).toHaveLength(1);
    expect(served[0]?.from).toBe('Alpha');
  });

  it('under a confirmed same-as link, a stale record on the losing key stays withheld while the fresh one on the canonical key merges alone', async () => {
    await proposeSameAsLink(vault, 'key-alpha', 'key-beta');
    await confirmSameAsLink(vault, 'key-alpha', 'key-beta');
    await persistRelationCacheFromPass(
      vault,
      passWith([
        corpusEdge({
          confidence: 0.6,
          endpointRevisions: {
            from: digestFor('Alpha.md', 'rev-1'),
            to: digestFor('Gamma.md', 'rev-1'),
          },
        }),
        corpusEdge({
          from: 'Beta',
          fromKey: 'key-beta',
          confidence: 0.9,
          // Judged against a Beta revision that has since moved.
          endpointRevisions: {
            from: digestFor('Beta.md', 'rev-1'),
            to: digestFor('Gamma.md', 'rev-1'),
          },
        }),
      ]),
    );
    const pass = await productionShapedPass(
      vault,
      fakeHashStore({ 'Alpha.md': 'rev-1', 'Beta.md': 'rev-2', 'Gamma.md': 'rev-1' }),
    );
    expect(servedRelations(pass.relations).map((relation) => relation.from)).toEqual(['Alpha']);

    const result = await resolveSameAsForPass(vault, pass);
    const attestations = result.relations.entries.flatMap((entry) => entry.attestations);
    expect(attestations.some((attestation) => attestation.from === 'Beta')).toBe(false);
    expect(servedRelations(result.relations).map((relation) => relation.from)).toEqual(['Alpha']);
  });

  it('with no hash store the baseline serves every non-disposed record, so both still merge (unchanged fallback)', async () => {
    await proposeSameAsLink(vault, 'key-alpha', 'key-beta');
    await confirmSameAsLink(vault, 'key-alpha', 'key-beta');
    await persistRelationCacheFromPass(
      vault,
      passWith([corpusEdge(), corpusEdge({ from: 'Beta', fromKey: 'key-beta', confidence: 0.9 })]),
    );
    const bare = passWith(undefined);
    const pass = { ...bare, relations: await readRelationSetWithCache(vault, bare) };

    const result = await resolveSameAsForPass(vault, pass);
    const attestations = result.relations.entries.flatMap((entry) => entry.attestations);
    expect(attestations.some((attestation) => attestation.from === 'Beta')).toBe(true);
    expect(attestations.some((attestation) => attestation.from === 'Alpha')).toBe(true);
  });
});

// ---- three ticks end to end through readConceptsAndRelations ----------------

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

const READY_CONFIG: PersistedWorkerConfig = {
  version: 1,
  baseUrl: 'https://worker.example',
  token: 'secret-token',
};

function configuredHost(config: PersistedWorkerConfig): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = { [WORKER_CONFIG_STORAGE_KEY]: config };
  return host;
}

/** A writable in-memory vault; clones its seed so no test mutates another's fixture. */
class MemoryVault implements VaultSource {
  private readonly files: Record<string, string>;
  constructor(files: Record<string, string>) {
    this.files = { ...files };
  }
  list(options?: ListOptions): Promise<readonly VaultPath[]> {
    let paths = Object.keys(this.files);
    if (options?.under !== undefined) {
      const prefix = `${options.under}/`;
      paths = paths.filter((path) => path.startsWith(prefix));
    }
    if (options?.extensions !== undefined) {
      const exts = options.extensions;
      paths = paths.filter((path) => exts.some((ext) => path.toLowerCase().endsWith(`.${ext}`)));
    }
    return Promise.resolve(paths.sort());
  }
  read(path: VaultPath): Promise<string> {
    const content = this.files[path];
    if (content === undefined) return Promise.reject(new Error(`no such file ${path}`));
    return Promise.resolve(content);
  }
  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.read(path).then((text) => new TextEncoder().encode(text));
  }
  write(path: VaultPath, content: string): Promise<void> {
    this.files[path] = content;
    return Promise.resolve();
  }
  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(path in this.files);
  }
  watch(_handler: (event: VaultEvent) => void) {
    return () => undefined;
  }
}

/** One transport for both tasks: the per-document read proposes two concepts; the corpus verdict a `contrasts-with` edge between them. */
function twoStageTransport() {
  return {
    send: async (request: WorkerTaskRequest) => {
      if (request.taskId === 'concepts.extract.v1') {
        return {
          ok: true,
          result: {
            concepts: [
              { name: 'Petal', aliases: [], anchorIndex: 1, alsoInIndexes: [] },
              { name: 'Sepal', aliases: [], anchorIndex: 2, alsoInIndexes: [] },
            ],
            relations: [],
          },
        };
      }
      return {
        ok: true,
        result: { verdicts: [{ a: 'Petal', b: 'Sepal', type: 'contrasts-with', confidence: 0.9 }] },
      };
    },
  };
}

const NOTE_PATH = '01 Courses/CourseA/Flowers.md';
const FLOWER_VAULT = {
  [NOTE_PATH]:
    'A petal is the coloured part, set just inside the [[Sepal]].\n\nA sepal is the green part that guards the bud.\n',
};

describe('readConceptsAndRelations — a stale cached relation stays withheld across three ticks (ol-egov.141.89.4.22)', () => {
  function contrastsWithEdge(pass: Awaited<ReturnType<typeof readConceptsAndRelations>>) {
    return pass?.relations.entries.find((entry) => entry.edge.type === 'contrasts-with');
  }

  it('served on tick 1 (judged) and tick 2 (cached, current); withheld on tick 3 once the note has moved', async () => {
    const transport = twoStageTransport();
    const conceptWiring = await buildConceptWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const corpusWiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const stateStore = new ObsidianCorpusRelationStateStore(new FakeDataHost());
    const vault = new MemoryVault(FLOWER_VAULT);

    const pass1 = await readConceptsAndRelations(conceptWiring, corpusWiring, stateStore, {
      vault,
      ingestionSessionClosed: true,
      hashStore: fakeHashStore({ [NOTE_PATH]: 'rev-1' }),
    });
    expect(pass1?.corpus.ran).toBe(true);
    expect(contrastsWithEdge(pass1)).toBeDefined();

    const pass2 = await readConceptsAndRelations(conceptWiring, corpusWiring, stateStore, {
      vault,
      ingestionSessionClosed: true,
      hashStore: fakeHashStore({ [NOTE_PATH]: 'rev-1' }),
    });
    expect(pass2?.corpus.ran).toBe(false);
    expect(contrastsWithEdge(pass2)).toBeDefined();

    // The note's recorded revision has moved; the corpus stage still does not run this tick, so
    // the only route for the edge is the cache, whose freshness gate now withholds it — and the
    // same-as fold that runs after it must not bring it back.
    const pass3 = await readConceptsAndRelations(conceptWiring, corpusWiring, stateStore, {
      vault,
      ingestionSessionClosed: true,
      hashStore: fakeHashStore({ [NOTE_PATH]: 'rev-2' }),
    });
    expect(pass3?.corpus.ran).toBe(false);
    expect(contrastsWithEdge(pass3)).toBeUndefined();
  });
});
