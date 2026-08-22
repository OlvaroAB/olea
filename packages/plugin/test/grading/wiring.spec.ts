/**
 * `buildGradingWiring` / `gradeExplainBackAttempt` tests (`ol-drfy`).
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`ObsidianDataHost`, `WorkerTaskTransport`) — no `obsidian` import
 * anywhere in this file, and none needed: neither `grading/wiring.ts` nor
 * its dependencies import `obsidian`. What is NOT proven here, because it
 * cannot be without a running Obsidian host: that `main.ts` actually calls
 * these with `createObsidianWorkerTransport` and a real plugin instance as
 * the data host — see `test/main-wiring.spec.ts`'s source-level assertions
 * for that half, mirroring the split `test/retrieval/wiring.spec.ts` already
 * uses for `buildRetrievalWiring`.
 */
import type { WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildGradingWiring, gradeExplainBackAttempt } from '../../src/grading/wiring.js';
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

/** A `WorkerTaskTransport` fake that answers `explain-back.judge.v1` with a scripted grading. */
function fakeTransport(
  reply: (request: WorkerTaskRequest) => unknown = () => ({
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.2.0', modelId: 'test-model' },
    result: { verdict: 'correct', feedback: 'Well explained.', missedPoints: [] },
  }),
) {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      return reply(request);
    },
  };
}

const baseInput = {
  question: 'What is a heap?',
  studentAnswer: 'A tree-shaped structure.',
  referenceAnswer: 'A complete binary tree obeying the heap property.',
  sourceBlocks: [],
  misconceptionDigest: [],
};

// ---- buildGradingWiring -------------------------------------------------

describe('buildGradingWiring — F7.8 grey-out', () => {
  it('returns a null judgeCaller when no Worker config has ever been saved', async () => {
    const wiring = await buildGradingWiring({
      dataHost: new FakeDataHost(),
      createTransport: () => fakeTransport(),
    });
    expect(wiring.judgeCaller).toBeNull();
  });

  it('returns a null judgeCaller when the config is present but blank (baseUrl or token empty)', async () => {
    const wiring = await buildGradingWiring({
      dataHost: configuredHost({ version: 1, baseUrl: '', token: '' }),
      createTransport: () => fakeTransport(),
    });
    expect(wiring.judgeCaller).toBeNull();
  });
});

describe('buildGradingWiring — a configured Worker builds a real, usable JudgeCaller', () => {
  it('constructs the transport with the persisted config and the caller actually reaches it', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    let seenConfig: WorkerConfig | null = null;
    const transport = fakeTransport();

    const wiring = await buildGradingWiring({
      dataHost: host,
      createTransport: (config) => {
        seenConfig = config;
        return transport;
      },
    });

    expect(seenConfig).toEqual({ baseUrl: 'https://worker.example', token: 'secret-token' });
    expect(wiring.judgeCaller).not.toBeNull();

    const result = await wiring.judgeCaller?.(baseInput);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.taskId).toBe('explain-back.judge.v1');
    expect(result?.verdict).toBe('correct');
  });
});

// ---- gradeExplainBackAttempt --------------------------------------------

describe('gradeExplainBackAttempt', () => {
  it('returns null rather than throwing when the Worker is unconfigured', async () => {
    const wiring = await buildGradingWiring({
      dataHost: new FakeDataHost(),
      createTransport: () => fakeTransport(),
    });

    const result = await gradeExplainBackAttempt(wiring, baseInput);

    expect(result).toBeNull();
  });

  it('reaches gradeExplainBack through the real, configured JudgeCaller — the pending grading it returns', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const transport = fakeTransport();
    const wiring = await buildGradingWiring({
      dataHost: host,
      createTransport: () => transport,
    });

    const result = await gradeExplainBackAttempt(wiring, baseInput);

    expect(transport.calls).toHaveLength(1);
    expect(result?.status).toBe('pending-review');
    expect(result?.grading.verdict).toBe('correct');
  });

  it('refuses rather than confabulates on an empty referenceAnswer, and never calls the Worker (INV-5)', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const transport = fakeTransport();
    const wiring = await buildGradingWiring({
      dataHost: host,
      createTransport: () => transport,
    });

    await expect(
      gradeExplainBackAttempt(wiring, { ...baseInput, referenceAnswer: '   ' }),
    ).rejects.toThrow(/UnusableGradingInputError|referenceAnswer/i);
    expect(transport.calls).toHaveLength(0);
  });
});
