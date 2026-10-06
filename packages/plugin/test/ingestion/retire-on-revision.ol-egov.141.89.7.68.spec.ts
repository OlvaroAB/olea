/**
 * `[D-531]` (`ol-egov.141.89.7.68`): the outcomes trigger retires the outcomes a revised document no
 * longer states, once the revision has been read in full — see olea-service's `features/
 * F4-oracle.md`, F4.1, "the plugin retires a revised document's stale outcomes once its version is
 * read in full" and the two scenarios after it, which these names are written to satisfy.
 *
 * Driven through `buildIngestionRunner` with a real one-page PDF per version, so each delivery
 * carries the real revision digest of the bytes it was read from. The page record (in production
 * the unit manifest) is a small fake here: it lists a version when it first sees its bytes, and
 * records a page as extracted only for the version that is current. Synthetic text only (INV-3).
 */
import {
  hashContent,
  type ListOptions,
  listOutcomeRecords,
  type OutcomeRecord,
  type PersistedQueue,
  type QueueStore,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import type { OutcomePageState } from '../../../core/src/outcome/retire-on-revision.js';
import {
  buildIngestionRunner,
  type OutcomeRevisionTriggerDeps,
} from '../../src/ingestion/wiring.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function buildOnePagePdf(pageText: string): Uint8Array {
  const raw = `BT /F1 12 Tf 20 150 Td (${pageText}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n',
    `5 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
  ];
  const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF';
  return asciiBytes(`%PDF-1.4\n${objects.join('')}${trailer}`);
}

class MemoryVaultSource implements VaultSource {
  private readonly binary = new Map<string, Uint8Array>();
  private readonly text = new Map<string, string>();
  setBinary(path: VaultPath, bytes: Uint8Array): void {
    this.binary.set(path, bytes);
  }
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    let paths = [...this.binary.keys(), ...this.text.keys()];
    if (options.under !== undefined) {
      const prefix = `${options.under}/`;
      paths = paths.filter((path) => path === options.under || path.startsWith(prefix));
    }
    if (options.extensions !== undefined) {
      const exts = options.extensions;
      paths = paths.filter((path) => exts.some((ext) => path.toLowerCase().endsWith(`.${ext}`)));
    }
    return [...new Set(paths)].sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.text.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const found = this.binary.get(path);
    if (!found) throw new Error(`not found: ${path}`);
    return found;
  }
  async write(path: VaultPath, content: string): Promise<void> {
    this.text.set(path, content);
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.binary.has(path) || this.text.has(path);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

class MemoryQueueStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = queue;
  }
}

class FakeDataHost {
  constructor(
    public blob: unknown = {
      [WORKER_CONFIG_STORAGE_KEY]: {
        version: 1,
        baseUrl: 'https://worker.example',
        token: 't',
      } satisfies PersistedWorkerConfig,
    },
  ) {}
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

const DOC = 'Objectives/Synthetic objectives.pdf';
const ALPHA = 'Describe the synthetic alpha process in a closed system';
const BETA = 'Compare the two synthetic beta models of transport';
const V1 = buildOnePagePdf('Synthetic objectives version one');
const V2 = buildOnePagePdf('Synthetic objectives version two');
const V3 = buildOnePagePdf('Synthetic objectives version three');

/**
 * A fake page record for one document of one page: it lists a version the first time it sees its
 * bytes (so its history starts empty), and records page extraction only for the current version.
 */
function fakePageRecord(vault: MemoryVaultSource) {
  const known: string[] = [];
  const histories = new Map<string, OutcomePageState[]>();
  const marks: { readonly digest: string; readonly pages: readonly number[] }[] = [];
  const currentDigest = async (path: VaultPath) => hashContent(await vault.readBinary(path));
  const deps: OutcomeRevisionTriggerDeps = {
    currentRevision: async (path) => {
      const digest = await currentDigest(path);
      if (!known.includes(digest)) {
        known.push(digest);
        histories.set(digest, []);
      }
      return {
        sourcePath: path,
        revisionDigest: digest,
        expectedPages: [1],
        history: [...(histories.get(digest) ?? [])],
        knownRevisions: [...known],
      };
    },
    markOutcomesExtracted: async (path, digest, pages) => {
      marks.push({ digest, pages });
      if (digest !== (await currentDigest(path))) return;
      const history = histories.get(digest);
      for (const page of pages) history?.push({ page, reading: 'read', outcomesExtracted: true });
    },
    now: () => '2026-10-06',
  };
  return { deps, marks };
}

interface Harness {
  readonly vault: MemoryVaultSource;
  answer: readonly string[];
  /** Runs before the Worker replies: a test uses it to replace the file during the call. */
  duringCall?: () => void;
  stamp: boolean;
  deliver(contentHash: string): Promise<unknown>;
}

async function harness(options: {
  readonly revisions?: (vault: MemoryVaultSource) => OutcomeRevisionTriggerDeps;
  readonly dataHost?: FakeDataHost;
}): Promise<Harness> {
  const vault = new MemoryVaultSource();
  vault.setBinary(DOC, V1);
  const state: Harness = {
    vault,
    answer: [],
    stamp: true,
    deliver: async () => undefined,
  };
  const transport = {
    send: async (request: WorkerTaskRequest) => {
      state.duringCall?.();
      const chunks = (request.payload as { sourceChunks: string[] }).sourceChunks;
      return {
        ok: true,
        ...(state.stamp ? { stamp: { promptVersion: '1.0.0', modelId: 'm-test' } } : {}),
        result: {
          outcomes: state.answer.map((label) => ({ label, confidence: 0.9, anchorIndex: 1 })),
          paperStructure: { sections: [] },
          numbering: { chunks: chunks.map((c, i) => ({ sentIndex: i + 1, length: c.length })) },
        },
      };
    },
  };
  const revisions = options.revisions?.(vault);
  const { engine } = await buildIngestionRunner({
    vault,
    queueStore: new MemoryQueueStore(),
    capability: { canDrain: true },
    outcomes: {
      dataHost: options.dataHost ?? new FakeDataHost(),
      createTransport: (_config: WorkerConfig) => transport,
      registeredDocumentFor: async (p: VaultPath) =>
        p === DOC ? { documentKind: 'objectives' as const, courses: ['SYNTH101'] } : null,
      ...(revisions !== undefined ? { revisions } : {}),
    },
  });
  state.deliver = async (contentHash: string) => {
    await engine.enqueue({
      contentHash,
      label: 'A registered document',
      payload: { kind: 'source', sourcePath: DOC, format: 'pdf' },
    });
    return engine.tick();
  };
  return state;
}

async function byLabel(vault: VaultSource): Promise<ReadonlyMap<string, OutcomeRecord>> {
  return new Map((await listOutcomeRecords(vault)).map(({ record }) => [record.label, record]));
}

describe('retiring outcomes on revision through the outcomes trigger ([D-531])', () => {
  it('the plugin retires a revised document’s stale outcomes once its version is read in full', async () => {
    let page: ReturnType<typeof fakePageRecord> | undefined;
    const run = await harness({
      revisions: (vault) => {
        page = fakePageRecord(vault);
        return page.deps;
      },
    });
    const d1 = await hashContent(V1);
    const d2 = await hashContent(V2);
    const d3 = await hashContent(V3);

    run.answer = [ALPHA, BETA];
    expect(await run.deliver('doc-v1')).toEqual({
      kind: 'ran',
      contentHash: 'doc-v1',
      outcome: 'done',
    });
    let records = await byLabel(run.vault);
    expect(records.get(ALPHA)?.statedInRevision).toBe(d1);
    expect(records.get(BETA)?.statedInRevision).toBe(d1);
    expect(page?.marks).toEqual([{ digest: d1, pages: [1] }]);

    // The document is replaced by a revision that no longer states beta.
    run.vault.setBinary(DOC, V2);
    run.answer = [ALPHA];
    await run.deliver('doc-v2');
    records = await byLabel(run.vault);
    expect(records.size).toBe(2);
    expect(records.get(ALPHA)).toMatchObject({ status: 'active', statedInRevision: d2 });
    expect(records.get(BETA)).toMatchObject({ status: 'retired', statedInRevision: d1 });

    // A reread of the same revision that happens to state beta again changes nothing.
    run.answer = [ALPHA, BETA];
    await run.deliver('doc-v2-again');
    records = await byLabel(run.vault);
    expect(records.get(BETA)).toMatchObject({ status: 'retired', statedInRevision: d1 });

    // A later revision that states beta again reinstates the same record.
    const betaId = records.get(BETA)?.id;
    run.vault.setBinary(DOC, V3);
    await run.deliver('doc-v3');
    records = await byLabel(run.vault);
    expect(records.get(BETA)).toMatchObject({ id: betaId, status: 'active', statedInRevision: d3 });
    expect(records.get(ALPHA)).toMatchObject({ status: 'active', statedInRevision: d3 });
  });

  it('a late delivery writes nothing: no record is minted, restamped or reinstated, and no page is marked', async () => {
    let page: ReturnType<typeof fakePageRecord> | undefined;
    const run = await harness({
      revisions: (vault) => {
        page = fakePageRecord(vault);
        return page.deps;
      },
    });
    run.answer = [ALPHA];
    // She replaces the file while the extraction call is in flight: the delivery's bytes are old.
    run.duringCall = () => run.vault.setBinary(DOC, V2);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      expect(await run.deliver('doc-v1')).toEqual({
        kind: 'ran',
        contentHash: 'doc-v1',
        outcome: 'done',
      });
    } finally {
      info.mockRestore();
    }
    expect(await listOutcomeRecords(run.vault)).toHaveLength(0);
    expect(page?.marks).toEqual([]);
  });

  it('a failed or unavailable extraction marks no page', async () => {
    let page: ReturnType<typeof fakePageRecord> | undefined;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const unstamped = await harness({
        revisions: (vault) => {
          page = fakePageRecord(vault);
          return page.deps;
        },
      });
      unstamped.answer = [ALPHA];
      unstamped.stamp = false;
      await unstamped.deliver('doc-v1');
      expect(page?.marks).toEqual([]);
      expect(await listOutcomeRecords(unstamped.vault)).toHaveLength(0);

      const offline = await harness({
        revisions: (vault) => {
          page = fakePageRecord(vault);
          return page.deps;
        },
        dataHost: new FakeDataHost({}),
      });
      offline.answer = [ALPHA];
      await offline.deliver('doc-v1');
      expect(page?.marks).toEqual([]);
      expect(await listOutcomeRecords(offline.vault)).toHaveLength(0);
    } finally {
      errors.mockRestore();
    }
  });

  it('with no page record (what main.ts passes today) the trigger is as it was: nothing stamped, nothing retired', async () => {
    const run = await harness({});
    run.answer = [ALPHA, BETA];
    await run.deliver('doc-v1');
    run.vault.setBinary(DOC, V2);
    run.answer = [ALPHA];
    await run.deliver('doc-v2');
    const records = await byLabel(run.vault);
    expect(records.get(BETA)?.status).toBe('active');
    for (const record of records.values()) {
      expect('statedInRevision' in record).toBe(false);
    }
  });
});
