/**
 * `buildConceptWiring` / `readConceptsFromVault` tests (EXT-7, `ol-5nle`).
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`ObsidianDataHost`, `WorkerTaskTransport`, `VaultSource`) — no `obsidian`
 * import anywhere in this file, mirroring `test/grading/wiring.spec.ts` and
 * `test/retrieval/wiring.spec.ts`.
 */
import type {
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
  WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildConceptWiring,
  DEFAULT_MAX_PASSAGES_PER_READ,
  DEFAULT_PASSAGES_PER_CALL,
  readConceptsFromVault,
} from '../../src/concept/wiring.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';

// ---- shared fakes -----------------------------------------------------

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

/**
 * A minimal `VaultSource` fake, just enough for `gatherPassages` to walk —
 * the same shape `packages/core/src/concept/read.spec.ts`'s `MemoryVault`
 * uses, kept local rather than exported since only this file needs it.
 */
class MemoryVault implements VaultSource {
  constructor(private readonly files: Record<string, string>) {}

  list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const { under, extensions } = options;
    return Promise.resolve(
      Object.keys(this.files)
        .filter((p) => under === undefined || p === under || p.startsWith(`${under}/`))
        .filter((p) => extensions === undefined || extensions.includes(p.split('.').pop() ?? ''))
        .sort(),
    );
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
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }
}

// ---- buildConceptWiring -------------------------------------------------

describe('buildConceptWiring — F7.8 grey-out', () => {
  it('returns a null conceptReader when no Worker config has ever been saved', async () => {
    const wiring = await buildConceptWiring({
      dataHost: new FakeDataHost(),
      createTransport: () => fakeTransport(() => ({ ok: true, result: { concepts: [] } })),
    });
    expect(wiring.conceptReader).toBeNull();
  });

  it('returns a null conceptReader when the config is present but blank', async () => {
    const wiring = await buildConceptWiring({
      dataHost: configuredHost({ version: 1, baseUrl: '', token: '' }),
      createTransport: () => fakeTransport(() => ({ ok: true, result: { concepts: [] } })),
    });
    expect(wiring.conceptReader).toBeNull();
  });
});

describe('buildConceptWiring — a configured Worker builds a real, usable ConceptReaderPort', () => {
  it('constructs the transport with the persisted config and the reader actually reaches it', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    let seenConfig: WorkerConfig | null = null;
    const transport = fakeTransport(() => ({
      ok: true,
      result: { concepts: [{ name: 'Concept X', anchorIndex: 1 }] },
    }));

    const wiring = await buildConceptWiring({
      dataHost: host,
      createTransport: (config) => {
        seenConfig = config;
        return transport;
      },
    });

    expect(seenConfig).toEqual({ baseUrl: 'https://worker.example', token: 'secret-token' });
    expect(wiring.conceptReader).not.toBeNull();

    const result = await wiring.conceptReader?.read({
      passages: [
        {
          text: 'A concept explained in prose.',
          anchor: { sourcePath: 'a.md', location: { page: 1, charRange: { start: 0, end: 1 } } },
          course: undefined,
        },
      ],
    });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.taskId).toBe('concepts.extract.v1');
    expect(result?.concepts[0]?.name).toBe('Concept X');
  });
});

// ---- readConceptsFromVault ------------------------------------------------

describe('readConceptsFromVault', () => {
  it('returns null rather than throwing when the Worker is unconfigured', async () => {
    const wiring = await buildConceptWiring({
      dataHost: new FakeDataHost(),
      createTransport: () => fakeTransport(() => ({ ok: true, result: { concepts: [] } })),
    });

    const vault = new MemoryVault({ 'Note.md': 'Some prose about a concept.' });
    const result = await readConceptsFromVault(wiring, vault);

    expect(result).toBeNull();
  });

  it('reaches readConcepts through the real, configured reader — the declared default budget applies', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const transport = fakeTransport((request) => {
      const payload = request.payload as { sourceChunks: string[] };
      return {
        ok: true,
        result: {
          concepts: payload.sourceChunks.map((_, i) => ({
            name: `Concept from passage ${i + 1}`,
            anchorIndex: i + 1,
          })),
        },
      };
    });
    const wiring = await buildConceptWiring({ dataHost: host, createTransport: () => transport });

    const vault = new MemoryVault({ 'Note.md': 'A single prose paragraph naming a real concept.' });
    const result = await readConceptsFromVault(wiring, vault);

    expect(transport.calls).toHaveLength(1);
    expect(result?.outcome).toBe('read');
    expect(result && result.outcome === 'read' ? result.concepts : []).toHaveLength(1);
  });

  it('declares the budget defaults it falls back to', () => {
    expect(DEFAULT_MAX_PASSAGES_PER_READ).toBeGreaterThan(0);
    expect(DEFAULT_PASSAGES_PER_CALL).toBeGreaterThan(0);
    expect(DEFAULT_PASSAGES_PER_CALL).toBeLessThanOrEqual(DEFAULT_MAX_PASSAGES_PER_READ);
  });

  it('a caller-supplied budget overrides the declared default', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const transport = fakeTransport(() => ({ ok: true, result: { concepts: [] } }));
    const wiring = await buildConceptWiring({ dataHost: host, createTransport: () => transport });

    // Two files, budget of one passage — only one should reach the reader.
    const vault = new MemoryVault({
      'A.md': 'First real paragraph about a concept.',
      'B.md': 'Second real paragraph about another concept.',
    });
    const result = await readConceptsFromVault(wiring, vault, { budget: { maxPassages: 1 } });

    expect(transport.calls).toHaveLength(1);
    const payload = transport.calls[0]?.payload as { sourceChunks: string[] };
    expect(payload.sourceChunks).toHaveLength(1);
    expect(result?.truncatedByBudget).toBe(true);
  });

  it('a vault with no readable material reports why, rather than an empty result silently (F1.4) — and never calls the Worker (INV-5)', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const transport = fakeTransport(() => ({
      ok: true,
      result: { concepts: [{ name: 'Should never be sent', anchorIndex: 1 }] },
    }));
    const wiring = await buildConceptWiring({ dataHost: host, createTransport: () => transport });

    const vault = new MemoryVault({});
    const result = await readConceptsFromVault(wiring, vault);

    expect(result?.outcome).toBe('unrecognised');
    expect(transport.calls).toHaveLength(0);
  });
});
