/**
 * `readConceptsAndRelations` wires `[D-402]` binding condition 3's old cross-course merge audit
 * into the real ingestion tick (`ol-egov.141.89.3.19`, discovered from `ol-egov.141.89.3.18`,
 * which built the pure detection/proposal unit with no production caller).
 *
 * `findMergeAuditFindings`/`proposeMergeAudits`/`proposeAndPersistMergeAudits` already have their
 * own unit tests elsewhere (`olea-core`'s `merge-audit.spec.ts` and `merge-audit-store.spec.ts`).
 * This file tests only the WIRING: that a real `readConceptsAndRelations` tick actually calls the
 * persist step over an old-merge-shaped record already on disk, and that the resulting proposal
 * survives a second tick unchanged rather than being re-proposed or lost.
 *
 * Mirrors `wiring.same-as-proposal-seams.ol-egov.141.89.3.4.spec.ts`'s fakes and conventions — no
 * `obsidian` import anywhere in this file (INV-1).
 *
 * INV-3: every concept name, course code and line of vault content below is coined for this
 * file. None is drawn from any real vault.
 */
import type {
  ConceptKeyRecord,
  ListOptions,
  TopicAnchor,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
  WorkerTaskRequest,
} from 'olea-core';
import { conceptKeyRecordPath } from 'olea-core';
// Deep import, not `olea-core`'s barrel — see `../../src/concept/wiring.ts`'s own comment on the
// same choice.
import { listMergeAuditProposalRecords } from 'olea-core/src/concept/merge-audit-store.js';
import { describe, expect, it } from 'vitest';
import { ObsidianCorpusRelationStateStore } from '../../src/concept/corpusRelationStateStore.js';
import {
  buildConceptWiring,
  buildCorpusRelationWiring,
  readConceptsAndRelations,
} from '../../src/concept/wiring.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';

// ---- shared fakes (mirrors wiring.same-as-proposal-seams.ol-egov.141.89.3.4.spec.ts) ----------

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

const READY_CONFIG: PersistedWorkerConfig = {
  version: 1,
  baseUrl: 'https://worker.example',
  token: 'secret-token',
};

function emptyTransport() {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      if (request.taskId === 'concepts.extract.v1') {
        return { ok: true, result: { concepts: [] } };
      }
      return { ok: true, result: { verdicts: [] } };
    },
  };
}

class MemoryVault implements VaultSource {
  private readonly files: Record<string, string> = {};
  constructor(files: Record<string, string> = {}) {
    Object.assign(this.files, files);
  }
  list(options?: ListOptions): Promise<readonly VaultPath[]> {
    let paths = Object.keys(this.files);
    if (options?.under !== undefined) {
      const prefix = `${options.under}/`;
      paths = paths.filter((path) => path === options.under || path.startsWith(prefix));
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
    return this.read(path).then((t) => new TextEncoder().encode(t));
  }
  write(path: VaultPath, content: string): Promise<void> {
    this.files[path] = content;
    return Promise.resolve();
  }
  delete(path: VaultPath): Promise<void> {
    delete this.files[path];
    return Promise.resolve();
  }
  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(path in this.files);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }
}

function topicAnchor(overrides: Partial<TopicAnchor> = {}): TopicAnchor {
  return { kind: 'topic', course: 'COURSEA', name: 'shared wording', aliases: [], ...overrides };
}

/** One ordinary, unrelated note — every test needs at least one readable passage in scope, or
 * `readConcepts` reports `'unrecognised'`/`'no-readable-material'` and `readConceptsAndRelations`
 * returns `null` before this bead's wiring ever runs (see `read.ts`'s own `budgeted.length === 0`
 * branch). This note carries no cross-course evidence of its own. */
const UNRELATED_NOTE_PATH = '01 Courses/COURSEA/Week 2/Other Note.md';
const UNRELATED_NOTE_CONTENT =
  '---\ntopic: [Some other topic]\n---\n\nOrdinary prose unrelated to the audited identity.\n';

function crossCourseRecord(): ConceptKeyRecord {
  return {
    key: 'concept-key1:legacy',
    tier: 2,
    anchor: topicAnchor({
      introducingPaths: [
        '01 Courses/COURSEA/Week 1/Lecture.md',
        '01 Courses/COURSEB/Week 3/Lecture.md',
      ],
    }),
    mintedAt: '2026-09-01',
    schemaVersion: 1,
  };
}

describe('readConceptsAndRelations wires proposeAndPersistMergeAudits into the real tick (ol-egov.141.89.3.19)', () => {
  it('an old-merge-shaped record already on disk gets a persisted proposal on the very next tick', async () => {
    const record = crossCourseRecord();
    const vault = new MemoryVault({
      [conceptKeyRecordPath(record.key)]: `${JSON.stringify(record, null, 2)}\n`,
      [UNRELATED_NOTE_PATH]: UNRELATED_NOTE_CONTENT,
    });
    const transport = emptyTransport();
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
      { vault, ingestionSessionClosed: true },
    );
    expect(pass).not.toBeNull();

    const proposals = await listMergeAuditProposalRecords(vault);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.record).toMatchObject({
      key: record.key,
      wording: 'shared wording',
      anchorCourse: 'COURSEA',
      status: 'proposed',
    });
    // Never an automatic confirm or decline — only ever a proposal, exactly as the
    // collision-to-proposal seam beside it holds for same-as.
    expect(proposals.every(({ record: r }) => r.status === 'proposed')).toBe(true);
  });

  it('proposes nothing new on a second tick over the same, unchanged vault (idempotent, no duplicate proposal)', async () => {
    const record = crossCourseRecord();
    const vault = new MemoryVault({
      [conceptKeyRecordPath(record.key)]: `${JSON.stringify(record, null, 2)}\n`,
      [UNRELATED_NOTE_PATH]: UNRELATED_NOTE_CONTENT,
    });
    const transport = emptyTransport();
    const conceptWiring = await buildConceptWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const corpusWiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const stateStore = new ObsidianCorpusRelationStateStore(new FakeDataHost());

    await readConceptsAndRelations(conceptWiring, corpusWiring, stateStore, {
      vault,
      ingestionSessionClosed: true,
    });
    await readConceptsAndRelations(conceptWiring, corpusWiring, stateStore, {
      vault,
      ingestionSessionClosed: true,
    });

    const proposals = await listMergeAuditProposalRecords(vault);
    expect(proposals).toHaveLength(1);
  });

  it('proposes nothing when no stored identity carries cross-course evidence', async () => {
    const singleCourseRecord: ConceptKeyRecord = {
      key: 'concept-key1:single-course',
      tier: 2,
      anchor: topicAnchor({ introducingPaths: ['01 Courses/COURSEA/Week 1/Lecture.md'] }),
      mintedAt: '2026-09-01',
      schemaVersion: 1,
    };
    const vault = new MemoryVault({
      [conceptKeyRecordPath(singleCourseRecord.key)]:
        `${JSON.stringify(singleCourseRecord, null, 2)}\n`,
      [UNRELATED_NOTE_PATH]: UNRELATED_NOTE_CONTENT,
    });
    const transport = emptyTransport();
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
      new ObsidianCorpusRelationStateStore(new FakeDataHost()),
      { vault, ingestionSessionClosed: true },
    );

    expect(await listMergeAuditProposalRecords(vault)).toHaveLength(0);
  });
});
