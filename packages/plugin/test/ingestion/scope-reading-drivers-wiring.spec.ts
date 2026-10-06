/**
 * `[D-534]` (`ol-egov.141.89.7.52`): the scope-reading drivers behind an OFF switch. After the
 * trigger records a document's extraction it may hand the work to `runScopeReadingDrivers`
 * (`scope-reading/drivers.ts`), but only when the switch the composition root passes is on. The
 * ruling (1b) did not extend `[D-344]`, so the switch defaults to off and no model call beyond the
 * one extraction may run automatically in production.
 *
 * Proved here, through `buildIngestionRunner`: off means the drivers are never entered and nothing
 * beyond the extraction is sent or written; on (in a test only) hands them the structure id, the
 * revision digests, the basis pages and the assessment paths; a driver failure never fails ingestion.
 * Synthetic text only (INV-3). Same fakes as `outcomes-extract-scope-reading.spec.ts`.
 */
import type {
  ListOptions,
  PersistedQueue,
  QueueStore,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
  WorkerTaskRequest,
} from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIngestionRunner, type ScopeReadingDriversDeps } from '../../src/ingestion/wiring.js';
import type { ScopeReadingDriverInput } from '../../src/scope-reading/drivers.js';
import { SCOPE_READING_DRIVERS_ENABLED } from '../../src/scope-reading/drivers.js';
import { createScopeReadingPersistence } from '../../src/scope-reading/persistence.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';

const hoisted = vi.hoisted(() => ({
  seen: [] as unknown[],
  failWith: undefined as Error | undefined,
}));

vi.mock('../../src/scope-reading/drivers.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/scope-reading/drivers.js')>();
  return {
    ...actual,
    runScopeReadingDrivers: async (input: unknown) => {
      hoisted.seen.push(input);
      if (hoisted.failWith !== undefined) throw hoisted.failWith;
    },
  };
});

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
  blob: unknown = {
    [WORKER_CONFIG_STORAGE_KEY]: {
      version: 1,
      baseUrl: 'https://worker.example',
      token: 't',
    } satisfies PersistedWorkerConfig,
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

const PAPER = 'Papers/2024.pdf';
const DEVICE = 'olea-dev1';
const NOW = '2026-10-06T10:00:00.000Z';
const BASIS = { revisionDigest: 'rev-1', unitsRead: 1, unitsTotal: 1, pages: [1] } as const;
const ANSWER = {
  outcomes: [],
  paperStructure: {
    sections: [
      {
        label: 'Section one',
        questionForm: 'short answer',
        itemCount: 3,
        marks: 20,
        anchorIndex: 1,
      },
    ],
  },
};

async function ingest(drivers: ScopeReadingDriversDeps | undefined) {
  const vault = new MemoryVaultSource();
  vault.setBinary(PAPER, buildOnePagePdf('Section A: answer all questions.'));
  const calls: WorkerTaskRequest[] = [];
  const transport = {
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      const chunks = (request.payload as { sourceChunks: string[] }).sourceChunks;
      return {
        ok: true,
        stamp: { promptVersion: '1.0.0', modelId: 'm-test' },
        result: {
          ...ANSWER,
          numbering: { chunks: chunks.map((c, i) => ({ sentIndex: i + 1, length: c.length })) },
        },
      };
    },
  };
  const { engine } = await buildIngestionRunner({
    vault,
    queueStore: new MemoryQueueStore(),
    capability: { canDrain: true },
    outcomes: {
      dataHost: new FakeDataHost(),
      createTransport: (_config: WorkerConfig) => transport,
      registeredDocumentFor: async (p: VaultPath) =>
        p === PAPER ? { documentKind: 'past-paper' as const, courses: ['TESTC101'] } : null,
      scopeReading: {
        deviceId: async () => DEVICE,
        readingBasisFor: async () => BASIS,
        now: () => NOW,
        ...(drivers !== undefined ? { drivers } : {}),
      },
    },
  });
  await engine.enqueue({
    contentHash: 'doc-v1',
    label: 'A registered document',
    payload: { kind: 'source', sourcePath: PAPER, format: 'pdf' },
  });
  const tick = await engine.tick();
  const persistence = createScopeReadingPersistence({ vault, deviceId: DEVICE, now: () => NOW });
  return { tick, calls, persistence };
}

beforeEach(() => {
  hoisted.seen = [];
  hoisted.failWith = undefined;
});

describe('the scope-reading drivers switch ([D-534] 1b)', () => {
  it('ships off: the code-level constant the composition root passes is false', () => {
    expect(SCOPE_READING_DRIVERS_ENABLED).toBe(false);
  });

  it('with no drivers dep (what main.ts passes), the trigger never enters the drivers and sends and writes only the extraction', async () => {
    const { tick, calls, persistence } = await ingest(undefined);
    expect(tick).toEqual({ kind: 'ran', contentHash: 'doc-v1', outcome: 'done' });
    expect(hoisted.seen).toHaveLength(0);
    expect(calls.map((c) => c.taskId)).toEqual(['outcomes.extract.v1']);
    const loaded = await persistence.load();
    expect(loaded.partDemands.size).toBe(0);
    expect(loaded.alignments.size).toBe(0);
    expect(loaded.structures.size).toBe(1);
  });

  it('with the switch passed as off, the trigger makes no driver call and writes nothing further', async () => {
    const { calls, persistence } = await ingest({ enabled: false });
    expect(hoisted.seen).toHaveLength(0);
    expect(calls).toHaveLength(1);
    const loaded = await persistence.load();
    expect(loaded.partDemands.size).toBe(0);
    expect(loaded.alignments.size).toBe(0);
  });

  it('with the switch on in a test, the drivers get the structure id, the revision digest, the basis pages and the assessment paths', async () => {
    const { persistence } = await ingest({
      enabled: true,
      assessmentPaths: async () => new Set(['Assessments/one.md']),
    });
    expect(hoisted.seen).toHaveLength(1);
    const input = hoisted.seen[0] as ScopeReadingDriverInput;
    const stored = await persistence.readDocument({
      sourcePath: PAPER,
      documentKind: 'past-paper',
      revisionDigest: 'rev-1',
    });
    if (stored.structure.status !== 'current') throw new Error('expected a current structure');
    expect(input.recorded.structure?.structureId).toBe(stored.structure.structureId);
    expect(input.ref).toEqual({
      sourcePath: PAPER,
      documentKind: 'past-paper',
      revisionDigest: 'rev-1',
    });
    expect(input.basis.pages).toEqual([1]);
    expect(input.deliveryRevisionDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(input.courses).toEqual(['TESTC101']);
    expect([...(input.assessmentPaths ?? [])]).toEqual(['Assessments/one.md']);
    expect(input.units).toHaveLength(1);
  });

  it('a driver failure never fails ingestion, and the extraction stays recorded', async () => {
    hoisted.failWith = new Error('driver blew up');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { tick, persistence } = await ingest({ enabled: true });
      expect(tick).toEqual({ kind: 'ran', contentHash: 'doc-v1', outcome: 'done' });
      expect(hoisted.seen).toHaveLength(1);
      expect((await persistence.load()).structures.size).toBe(1);
      expect(errors).toHaveBeenCalledWith(
        'Olea: scope reading drivers failed (ingestion unaffected)',
        expect.anything(),
      );
    } finally {
      errors.mockRestore();
    }
  });
});
