/**
 * `[D-429]` (decision sheet row 16, `ol-egov.141.89.7.5`): the ingestion trigger writes the
 * examiner-scope reading where it is produced. `triggerOutcomesExtractForLandedUnit` used to drop
 * the paper-structure half of every `outcomes.extract.v1` answer and record nothing about a
 * document's processing state; with `outcomes.scopeReading` supplied it now records, in Olea's own
 * layer (`scope-reading/persistence.ts`), one processing state per document revision and the
 * structure reading of a past paper, with the reader's stamp on each.
 *
 * What the ruling asks of it, and where each is proved below:
 *  - source and reader-version provenance on every model-produced record;
 *  - pending kept distinct from empty (an owed extraction is `pending` with a reason and is never
 *    written as "the document states nothing"; an empty answer over a document not read in full is
 *    partly read, never empty);
 *  - stale readings never served as current (read against another revision or reader version);
 *  - nothing sent to the Worker beyond the one call the trigger already made, nothing stored there.
 *
 * Same fakes and technique as `outcomes-extract-trigger.spec.ts` (duplicated there by that file's
 * own convention): a real PDF through the real extractor, a fake Worker transport, an in-memory
 * vault. Synthetic text only (INV-3). What this cannot show is that `main.ts` supplies the dep, which
 * `test/main-outcomes-trigger.spec.ts` pins at source level.
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
import { listOutcomeRecords } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { OutcomesExtractDocumentKind } from '../../src/ingestion/outcomes-extract-adapter.js';
import { buildIngestionRunner } from '../../src/ingestion/wiring.js';
import { createScopeReadingPersistence } from '../../src/scope-reading/persistence.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function buildOnePagePdf(pageText: string): Uint8Array {
  const raw = `BT /F1 12 Tf 20 150 Td (${escapePdfLiteral(pageText)}) Tj ET`;
  const streamText = new TextDecoder('latin1').decode(asciiBytes(raw));
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n',
    `5 0 obj\n<< /Length ${streamText.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
  ];
  const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF';
  return asciiBytes(`%PDF-1.4\n${objects.join('')}${trailer}`);
}

/**
 * In-memory `VaultSource` holding both binary bytes (for real PDF extraction, `setBinary`) and
 * text (for `resolveOutcome`/`reconcileOutcomeConcepts`'s own `.olea/` JSON reads and writes) —
 * `wiring.spec.ts`'s `MemoryVaultSource` and `WritableTextVault` merged into one fake, since this
 * file's own tests need both a real extractable source AND real outcome persistence.
 */
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

/** Same role `ObsidianQueueStore` fills over `data.json` in production. */
class MemoryQueueStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = queue;
  }
}

/** Same role `ObsidianDataHost`'s real `this` (the plugin) fills — `worker/config-store.ts`'s persisted-config seam. */
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

function unconfiguredHost(): FakeDataHost {
  return new FakeDataHost();
}

/** A well-formed `outcomes.extract.v1` response envelope, carrying a real D7.3 stamp unless `stamp: null` is passed to simulate a malformed one. */
function outcomesExtractResponse(
  result: unknown,
  stamp: { promptVersion: string; modelId: string } | null = {
    promptVersion: '1.0.0',
    modelId: 'm-test',
  },
): unknown {
  return { ok: true, ...(stamp !== null ? { stamp } : {}), result };
}

const CAN_DRAIN = { canDrain: true };

const WORKER_CONFIG: PersistedWorkerConfig = {
  version: 1,
  baseUrl: 'https://worker.example',
  token: 't',
};

function registeredDocumentFixture(
  path: VaultPath,
  documentKind: OutcomesExtractDocumentKind,
  courses: readonly string[] = ['TESTC101'],
) {
  return async (sourcePath: VaultPath) => (sourcePath === path ? { documentKind, courses } : null);
}

const DEVICE = 'olea-dev1';
const NOW = '2026-09-29T10:00:00.000Z';
const FULL = { revisionDigest: 'rev-1', unitsRead: 1, unitsTotal: 1 } as const;
const PARTIAL = { revisionDigest: 'rev-1', unitsRead: 1, unitsTotal: 4 } as const;

interface Basis {
  readonly revisionDigest: string;
  readonly unitsRead: number;
  readonly unitsTotal: number;
}

function scopeReadingDeps(basis: Basis | null = FULL) {
  return {
    deviceId: async () => DEVICE,
    readingBasisFor: async (_path: VaultPath) => basis,
    now: () => NOW,
  };
}

const PAPER_SOURCE = 'Papers/2024.pdf';
const OBJECTIVES_SOURCE = 'Objectives/week1.pdf';

function refFor(path: VaultPath, documentKind: OutcomesExtractDocumentKind, digest = 'rev-1') {
  return { sourcePath: path, documentKind, revisionDigest: digest } as const;
}

/**
 * The Worker always returns `result.numbering` (`groundOutcomes`, `ol-egov.141.89.7.38`): for each
 * passage number it showed the model, the position of that chunk among the chunks sent. With no
 * furniture-only chunk among them it is the identity, which is what every document here sends. Added
 * to a scripted success envelope that carries none, so a fixture stays the answer a Worker gives.
 */
function withWorkerNumbering(request: WorkerTaskRequest, envelope: unknown): unknown {
  if (typeof envelope !== 'object' || envelope === null) return envelope;
  const body = envelope as { ok?: unknown; result?: unknown };
  if (body.ok !== true || typeof body.result !== 'object' || body.result === null) return envelope;
  if ('numbering' in body.result) return envelope;
  const chunks = (request.payload as { sourceChunks: string[] }).sourceChunks;
  const numbering = {
    chunks: chunks.map((chunk, i) => ({ sentIndex: i + 1, length: chunk.length })),
  };
  return { ...body, result: { ...body.result, numbering } };
}

async function ingest(params: {
  readonly vault: MemoryVaultSource;
  readonly path: VaultPath;
  readonly documentKind: OutcomesExtractDocumentKind;
  readonly dataHost: FakeDataHost;
  readonly send: (request: WorkerTaskRequest) => unknown | Promise<unknown>;
  readonly scopeReading?: ReturnType<typeof scopeReadingDeps> | undefined;
  readonly contentHash?: string;
}) {
  const calls: WorkerTaskRequest[] = [];
  const transport = {
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      return withWorkerNumbering(request, await params.send(request));
    },
  };
  const { engine } = await buildIngestionRunner({
    vault: params.vault,
    queueStore: new MemoryQueueStore(),
    capability: CAN_DRAIN,
    outcomes: {
      dataHost: params.dataHost,
      createTransport: (_config: WorkerConfig) => transport,
      registeredDocumentFor: registeredDocumentFixture(params.path, params.documentKind),
      ...(params.scopeReading !== undefined ? { scopeReading: params.scopeReading } : {}),
    },
  });
  await engine.enqueue({
    contentHash: params.contentHash ?? 'doc-v1',
    label: 'A registered document',
    payload: { kind: 'source', sourcePath: params.path, format: 'pdf' },
  });
  const tick = await engine.tick();
  return { tick, calls };
}

function persistence(vault: MemoryVaultSource) {
  return createScopeReadingPersistence({ vault, deviceId: DEVICE, now: () => NOW });
}

const PAPER_ANSWER = {
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

const OBJECTIVES_ANSWER = {
  outcomes: [{ label: 'Explain diffusion across a membrane', confidence: 0.9, anchorIndex: 1 }],
  paperStructure: { sections: [] },
};

const EMPTY_ANSWER = { outcomes: [], paperStructure: { sections: [] } };

function newPaperVault() {
  const vault = new MemoryVaultSource();
  vault.setBinary(PAPER_SOURCE, buildOnePagePdf('Section A: answer all questions.'));
  return vault;
}

function newObjectivesVault() {
  const vault = new MemoryVaultSource();
  vault.setBinary(OBJECTIVES_SOURCE, buildOnePagePdf('Explain diffusion across a membrane.'));
  return vault;
}

describe('the ingestion trigger writes the examiner-scope reading where it is produced ([D-429])', () => {
  it('a past paper read in full records its structure and a recorded state, each with the reader stamp', async () => {
    const vault = newPaperVault();
    const { tick, calls } = await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(PAPER_ANSWER),
      scopeReading: scopeReadingDeps(),
    });
    expect(tick).toEqual({ kind: 'ran', contentHash: 'doc-v1', outcome: 'done' });
    expect(calls).toHaveLength(1);

    const reading = await persistence(vault).readDocument(refFor(PAPER_SOURCE, 'past-paper'));
    expect(reading.state).toMatchObject({
      status: 'known',
      state: { kind: 'recorded' },
      provenance: { task: 'outcomes.extract.v1', promptVersion: '1.0.0', modelId: 'm-test' },
    });
    expect(reading.structure).toMatchObject({
      status: 'current',
      provenance: { task: 'outcomes.extract.v1', promptVersion: '1.0.0', modelId: 'm-test' },
    });
    if (reading.structure.status !== 'current') throw new Error('expected a current structure');
    expect(reading.structure.reading.sections).toEqual([
      {
        label: 'Section one',
        questionForm: 'short answer',
        itemCount: 3,
        marks: { status: 'stated', value: 20 },
        anchor: { unitIndex: 0 },
      },
    ]);
  });

  it('an objectives document with declarations records a recorded state and no structure', async () => {
    const vault = newObjectivesVault();
    await ingest({
      vault,
      path: OBJECTIVES_SOURCE,
      documentKind: 'objectives',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(OBJECTIVES_ANSWER),
      scopeReading: scopeReadingDeps(),
    });
    const reading = await persistence(vault).readDocument(refFor(OBJECTIVES_SOURCE, 'objectives'));
    expect(reading.state).toMatchObject({ status: 'known', state: { kind: 'recorded' } });
    expect(reading.structure).toEqual({ status: 'absent' });
    // The Outcome records the existing path writes are unchanged by the new write.
    expect(await listOutcomeRecords(vault)).toHaveLength(1);
  });

  it('an empty answer over a document read in full is the one EMPTY result: read-states-nothing', async () => {
    const vault = newObjectivesVault();
    await ingest({
      vault,
      path: OBJECTIVES_SOURCE,
      documentKind: 'objectives',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(EMPTY_ANSWER),
      scopeReading: scopeReadingDeps(FULL),
    });
    const reading = await persistence(vault).readDocument(refFor(OBJECTIVES_SOURCE, 'objectives'));
    expect(reading.state).toMatchObject({
      status: 'known',
      state: { kind: 'read-states-nothing' },
    });
  });

  it('an empty answer over a document NOT read in full is partly read, never empty', async () => {
    const vault = newObjectivesVault();
    await ingest({
      vault,
      path: OBJECTIVES_SOURCE,
      documentKind: 'objectives',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(EMPTY_ANSWER),
      scopeReading: scopeReadingDeps(PARTIAL),
    });
    const reading = await persistence(vault).readDocument(refFor(OBJECTIVES_SOURCE, 'objectives'));
    expect(reading.state).toMatchObject({
      status: 'known',
      state: { kind: 'partly-read', unitsRead: 1, unitsTotal: 4 },
    });
  });

  it('a structure found over a partly read paper is kept, and the state beside it says partly read', async () => {
    const vault = newPaperVault();
    await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(PAPER_ANSWER),
      scopeReading: scopeReadingDeps(PARTIAL),
    });
    const reading = await persistence(vault).readDocument(refFor(PAPER_SOURCE, 'past-paper'));
    expect(reading.state).toMatchObject({
      state: { kind: 'partly-read', unitsRead: 1, unitsTotal: 4 },
    });
    expect(reading.structure.status).toBe('current');
  });

  it('the reading is keyed by the revision digest the basis names, so another revision reads as unknown or stale, never current', async () => {
    const vault = newPaperVault();
    await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(PAPER_ANSWER),
      scopeReading: scopeReadingDeps(FULL),
    });
    const later = await persistence(vault).readDocument(
      refFor(PAPER_SOURCE, 'past-paper', 'rev-2'),
    );
    expect(later.state).toEqual({ status: 'unknown', otherRevisionsRecorded: true });
    expect(later.structure).toEqual({ status: 'stale-revision' });
  });

  it('a reader version the caller does not accept is visible but never current', async () => {
    const vault = newPaperVault();
    await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(PAPER_ANSWER),
      scopeReading: scopeReadingDeps(FULL),
    });
    const reading = await persistence(vault).readDocument(refFor(PAPER_SOURCE, 'past-paper'), {
      acceptedReaderVersions: ['2.0.0'],
    });
    expect(reading.structure.status).toBe('stale-reader');
  });
});

describe('an owed extraction is pending with its reason, and is never written as empty', () => {
  it('the Worker not being configured records pending: unavailable, and makes no call', async () => {
    const vault = newObjectivesVault();
    const { tick, calls } = await ingest({
      vault,
      path: OBJECTIVES_SOURCE,
      documentKind: 'objectives',
      dataHost: unconfiguredHost(),
      send: () => outcomesExtractResponse(EMPTY_ANSWER),
      scopeReading: scopeReadingDeps(),
    });
    expect(tick).toEqual({ kind: 'ran', contentHash: 'doc-v1', outcome: 'done' });
    expect(calls).toHaveLength(0);
    const reading = await persistence(vault).readDocument(refFor(OBJECTIVES_SOURCE, 'objectives'));
    expect(reading.state).toMatchObject({
      status: 'known',
      state: { kind: 'pending', reason: 'unavailable' },
    });
    expect(reading.state.status === 'known' && reading.state.provenance).toBeFalsy();
  });

  it('a transport that cannot reach the Worker records pending: unavailable; the ingestion job still succeeds', async () => {
    const vault = newPaperVault();
    const { tick } = await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => {
        throw new Error('network down');
      },
      scopeReading: scopeReadingDeps(),
    });
    expect(tick).toEqual({ kind: 'ran', contentHash: 'doc-v1', outcome: 'done' });
    const reading = await persistence(vault).readDocument(refFor(PAPER_SOURCE, 'past-paper'));
    expect(reading.state).toMatchObject({ state: { kind: 'pending', reason: 'unavailable' } });
    expect(reading.structure).toEqual({ status: 'absent' });
  });

  it('a quota answer records pending: over-budget', async () => {
    const vault = newPaperVault();
    await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => ({ ok: false, code: 'quota-exceeded', message: 'over' }),
      scopeReading: scopeReadingDeps(),
    });
    const reading = await persistence(vault).readDocument(refFor(PAPER_SOURCE, 'past-paper'));
    expect(reading.state).toMatchObject({ state: { kind: 'pending', reason: 'over-budget' } });
  });

  it('any other refusal or unusable answer records pending: failed', async () => {
    const vault = newPaperVault();
    await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => ({ ok: false, code: 'upstream-error', message: 'bad' }),
      scopeReading: scopeReadingDeps(),
    });
    const reading = await persistence(vault).readDocument(refFor(PAPER_SOURCE, 'past-paper'));
    expect(reading.state).toMatchObject({ state: { kind: 'pending', reason: 'failed' } });
  });

  it('a response with no usable stamp is discarded as before, and the revision is recorded pending: failed, not read', async () => {
    const vault = newObjectivesVault();
    await ingest({
      vault,
      path: OBJECTIVES_SOURCE,
      documentKind: 'objectives',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(OBJECTIVES_ANSWER, null),
      scopeReading: scopeReadingDeps(),
    });
    expect(await listOutcomeRecords(vault)).toHaveLength(0);
    const reading = await persistence(vault).readDocument(refFor(OBJECTIVES_SOURCE, 'objectives'));
    expect(reading.state).toMatchObject({ state: { kind: 'pending', reason: 'failed' } });
    expect(reading.structure).toEqual({ status: 'absent' });
  });

  it('a pending revision that is later read is superseded: the newest record for the key is current', async () => {
    const vault = newPaperVault();
    await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => {
        throw new Error('network down');
      },
      scopeReading: scopeReadingDeps(),
      contentHash: 'doc-v1',
    });
    await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(PAPER_ANSWER),
      scopeReading: scopeReadingDeps(),
      contentHash: 'doc-v1-retry',
    });
    const reading = await persistence(vault).readDocument(refFor(PAPER_SOURCE, 'past-paper'));
    expect(reading.state).toMatchObject({ state: { kind: 'recorded' } });
  });
});

describe('what is not recorded, and what never changes', () => {
  it('no reading basis (nothing to key the record by) writes nothing, and the Outcome path is unchanged', async () => {
    const vault = newObjectivesVault();
    await ingest({
      vault,
      path: OBJECTIVES_SOURCE,
      documentKind: 'objectives',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(OBJECTIVES_ANSWER),
      scopeReading: scopeReadingDeps(null),
    });
    expect(await listOutcomeRecords(vault)).toHaveLength(1);
    const projection = await persistence(vault).load();
    expect(projection.states.size).toBe(0);
    expect(projection.structures.size).toBe(0);
  });

  it('omitting scopeReading leaves the trigger as it was: no scope-reading file is ever written', async () => {
    const vault = newPaperVault();
    await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(PAPER_ANSWER),
    });
    const files = await vault.list();
    expect(files.filter((path) => path.includes('/readings/'))).toEqual([]);
  });

  it('a failing scope-reading write never fails the ingestion job or drops the Outcome records', async () => {
    const vault = newObjectivesVault();
    const originalWrite = vault.write.bind(vault);
    vault.write = async (path, content) => {
      if (path.includes('/readings/')) throw new Error('disk full');
      return originalWrite(path, content);
    };
    const { tick } = await ingest({
      vault,
      path: OBJECTIVES_SOURCE,
      documentKind: 'objectives',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(OBJECTIVES_ANSWER),
      scopeReading: scopeReadingDeps(),
    });
    expect(tick).toEqual({ kind: 'ran', contentHash: 'doc-v1', outcome: 'done' });
    expect(await listOutcomeRecords(vault)).toHaveLength(1);
  });

  it('makes exactly the one Worker call it always made: nothing is sent or stored server side', async () => {
    const vault = newPaperVault();
    const { calls } = await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(PAPER_ANSWER),
      scopeReading: scopeReadingDeps(),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.taskId).toBe('outcomes.extract.v1');
  });

  it('the stored records hold no passage text and no Worker body (D-005)', async () => {
    const vault = newPaperVault();
    await ingest({
      vault,
      path: PAPER_SOURCE,
      documentKind: 'past-paper',
      dataHost: configuredHost(WORKER_CONFIG),
      send: () => outcomesExtractResponse(PAPER_ANSWER),
      scopeReading: scopeReadingDeps(),
    });
    const stored = (await vault.list()).filter((path) => path.includes('/readings/'));
    expect(stored.length).toBeGreaterThan(0);
    for (const path of stored) {
      const text = await vault.read(path);
      expect(text).not.toContain('answer all questions');
      expect(text).not.toContain('"stamp"');
    }
  });
});
