/**
 * `[D-344]` (`ol-2zfj.163`, option b) / `ol-2zfj.141` [IL-D10] / `ol-2zfj.153` [DOS-I4]:
 * outcomes.extract.v1's production trigger — see `olea-service`'s `features/F1-sources.md`,
 * the `[D-344]` block appended after "registering while offline...", which this file's
 * `describe`/`it` names are written to satisfy directly.
 *
 * Runs entirely against fakes at `wiring.ts`'s own testable seam (`VaultSource`, `QueueStore`,
 * `DeviceCapability`, `ObsidianDataHost`, a fake `WorkerTaskTransport`) — the same technique
 * `wiring.spec.ts` already uses for `buildIngestionRunner`/`runOutcomesExtractAndReconcile`,
 * duplicated here rather than imported (neither this file's fakes nor that file's are exported;
 * this repo's own precedent — `../../src/grading/wiring.ts`'s `extractSoloArtifactProvenance`
 * doc — is to duplicate a small fake/helper across files rather than couple two test files
 * together). No `obsidian` import anywhere in this file: `wiring.ts` never imports it, so this is
 * a full, real exercise of the composition logic, not a mock of it.
 *
 * What is NOT proven here, because it cannot be without a running Obsidian host: that `main.ts`
 * actually wires `outcomes` into its own `buildIngestionRunner` call with a real
 * `ObsidianSource`/review log. See `main-outcomes-trigger.spec.ts` (source-level reachability,
 * same technique `main-wiring.spec.ts` uses) and the `@manual` scenario in `F1-sources.md`.
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
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';

// ---- a tiny hand-built single-page PDF, the same technique `wiring.spec.ts` and
// `packages/core/src/ingestion/extraction-runner.spec.ts` already use: enough to exercise the
// real pdf extractor's text layer, not a mock of it. Invented content only (INV-3).

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

describe('outcomes.extract.v1 production trigger — buildIngestionRunner({ outcomes })', () => {
  it('a registered objectives document landed extraction resolves persisted Outcome records, never twice for one revision', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary(
      'Objectives/week1.pdf',
      buildOnePagePdf('Explain diffusion across a membrane.'),
    );

    const transport = fakeTransport(() =>
      outcomesExtractResponse({
        outcomes: [
          { label: 'Explain diffusion across a membrane', confidence: 0.9, anchorIndex: 1 },
        ],
        paperStructure: { sections: [] },
      }),
    );

    const { engine } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
      outcomes: {
        dataHost: configuredHost(WORKER_CONFIG),
        createTransport: (_config: WorkerConfig) => transport,
        registeredDocumentFor: registeredDocumentFixture('Objectives/week1.pdf', 'objectives'),
      },
    });

    await engine.enqueue({
      contentHash: 'week1-v1',
      label: 'Week 1 objectives',
      payload: { kind: 'source', sourcePath: 'Objectives/week1.pdf', format: 'pdf' },
    });
    const tick = await engine.tick();
    expect(tick).toEqual({ kind: 'ran', contentHash: 'week1-v1', outcome: 'done' });
    expect(transport.calls).toHaveLength(1);

    const persisted = await listOutcomeRecords(vault);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.record).toMatchObject({
      label: 'Explain diffusion across a membrane',
      courses: ['TESTC101'],
      provenance: { promptVersion: '1.0.0', modelVersion: 'm-test' },
      extractorSelfRating: 0.9,
    });

    // The SAME job is drained again (idempotent no-op, D-002) — never a second call.
    const secondTick = await engine.tick();
    expect(secondTick).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(transport.calls).toHaveLength(1);
    expect(await listOutcomeRecords(vault)).toHaveLength(1);
  });

  it('an unregistered or course-material document never calls outcomes.extract.v1', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/week3.pdf', buildOnePagePdf('Ordinary lecture content.'));

    const transport = fakeTransport(() =>
      outcomesExtractResponse({ outcomes: [], paperStructure: { sections: [] } }),
    );

    const { engine } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
      outcomes: {
        dataHost: configuredHost(WORKER_CONFIG),
        createTransport: (_config: WorkerConfig) => transport,
        // Never names 'Lectures/week3.pdf' as eligible — unregistered.
        registeredDocumentFor: registeredDocumentFixture('Objectives/week1.pdf', 'objectives'),
      },
    });

    await engine.enqueue({
      contentHash: 'week3-v1',
      label: 'Week 3 lecture',
      payload: { kind: 'source', sourcePath: 'Lectures/week3.pdf', format: 'pdf' },
    });
    const tick = await engine.tick();
    expect(tick).toEqual({ kind: 'ran', contentHash: 'week3-v1', outcome: 'done' });
    expect(transport.calls).toHaveLength(0);
    expect(await listOutcomeRecords(vault)).toHaveLength(0);
  });

  it('a new revision (new content hash) re-extracts; nothing re-triggers extraction with no new job', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Papers/2024.pdf', buildOnePagePdf('Section A: answer all questions.'));

    const transport = fakeTransport(() =>
      outcomesExtractResponse({ outcomes: [], paperStructure: { sections: [] } }),
    );

    const { engine } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
      outcomes: {
        dataHost: configuredHost(WORKER_CONFIG),
        createTransport: (_config: WorkerConfig) => transport,
        registeredDocumentFor: registeredDocumentFixture('Papers/2024.pdf', 'past-paper'),
      },
    });

    await engine.enqueue({
      contentHash: 'paper-2024-v1',
      label: '2024 past paper',
      payload: { kind: 'source', sourcePath: 'Papers/2024.pdf', format: 'pdf' },
    });
    await engine.tick();
    expect(transport.calls).toHaveLength(1);

    // "Re-registration" with no new content: registeredDocumentFor keeps answering the same way,
    // but no new job exists to drain — ticking again calls outcomes.extract.v1 zero more times.
    const idleTick = await engine.tick();
    expect(idleTick).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(transport.calls).toHaveLength(1);

    // A real revision: the document changed, re-ingested under a NEW content hash (the same way
    // `ingestion/arrival-watch.ts` enqueues a 'modify' event) — change detection, not re-registration.
    vault.setBinary(
      'Papers/2024.pdf',
      buildOnePagePdf('Section A, revised: answer all questions.'),
    );
    await engine.enqueue({
      contentHash: 'paper-2024-v2',
      label: '2024 past paper (revised)',
      payload: { kind: 'source', sourcePath: 'Papers/2024.pdf', format: 'pdf' },
    });
    const revisionTick = await engine.tick();
    expect(revisionTick).toEqual({ kind: 'ran', contentHash: 'paper-2024-v2', outcome: 'done' });
    expect(transport.calls).toHaveLength(2);
  });

  it('a response carrying no D7.3 stamp is discarded, not persisted with an invented provenance — the ingestion job still succeeds', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary(
      'Objectives/week1.pdf',
      buildOnePagePdf('Explain diffusion across a membrane.'),
    );

    const transport = fakeTransport(() =>
      outcomesExtractResponse(
        {
          outcomes: [{ label: 'Explain diffusion', confidence: 0.9, anchorIndex: 1 }],
          paperStructure: { sections: [] },
        },
        null, // no usable stamp
      ),
    );

    const { engine } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
      outcomes: {
        dataHost: configuredHost(WORKER_CONFIG),
        createTransport: (_config: WorkerConfig) => transport,
        registeredDocumentFor: registeredDocumentFixture('Objectives/week1.pdf', 'objectives'),
      },
    });

    await engine.enqueue({
      contentHash: 'week1-no-stamp',
      label: 'Week 1 objectives',
      payload: { kind: 'source', sourcePath: 'Objectives/week1.pdf', format: 'pdf' },
    });
    const tick = await engine.tick();
    expect(tick).toEqual({ kind: 'ran', contentHash: 'week1-no-stamp', outcome: 'done' });
    expect(transport.calls).toHaveLength(1);
    expect(await listOutcomeRecords(vault)).toHaveLength(0);
  });

  it('the Worker not being configured is a grey-out — never called, never fails the ingestion job', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary(
      'Objectives/week1.pdf',
      buildOnePagePdf('Explain diffusion across a membrane.'),
    );

    const transport = fakeTransport(() =>
      outcomesExtractResponse({ outcomes: [], paperStructure: { sections: [] } }),
    );

    const { engine } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
      outcomes: {
        dataHost: unconfiguredHost(),
        createTransport: (_config: WorkerConfig) => transport,
        registeredDocumentFor: registeredDocumentFixture('Objectives/week1.pdf', 'objectives'),
      },
    });

    await engine.enqueue({
      contentHash: 'week1-unconfigured',
      label: 'Week 1 objectives',
      payload: { kind: 'source', sourcePath: 'Objectives/week1.pdf', format: 'pdf' },
    });
    const tick = await engine.tick();
    expect(tick).toEqual({ kind: 'ran', contentHash: 'week1-unconfigured', outcome: 'done' });
    expect(transport.calls).toHaveLength(0);
    expect(await listOutcomeRecords(vault)).toHaveLength(0);
  });

  it('omitting deps.outcomes leaves buildIngestionRunner byte-identical — no eligibility check ever runs', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary(
      'Objectives/week1.pdf',
      buildOnePagePdf('Explain diffusion across a membrane.'),
    );

    const { engine, sink } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
    });

    await engine.enqueue({
      contentHash: 'week1-no-outcomes-dep',
      label: 'Week 1 objectives',
      payload: { kind: 'source', sourcePath: 'Objectives/week1.pdf', format: 'pdf' },
    });
    const tick = await engine.tick();
    expect(tick).toEqual({ kind: 'ran', contentHash: 'week1-no-outcomes-dep', outcome: 'done' });
    expect(sink.forSource('Objectives/week1.pdf')).toHaveLength(1);
    expect(await listOutcomeRecords(vault)).toHaveLength(0);
  });
});
