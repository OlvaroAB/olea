/**
 * `buildTranscriptionWiring` tests (`ol-0r92.14`; the Writing-outcome
 * wrapping below is `ol-egov.141.89.8.40`).
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`ObsidianDataHost`, `WorkerTaskTransport`) — no `obsidian` import
 * anywhere in this file, and none needed: `transcription/wiring.ts` imports
 * no `obsidian` module. Mirrors `test/grading/wiring.spec.ts`'s
 * `buildGradingWiring` grey-out coverage exactly, scoped to the one field
 * this composition root exposes.
 *
 * What is deliberately NOT tested here, because it does not exist: any
 * recording UI, command, or view calling `transcriptionCaller` — see
 * `wiring.ts`'s module doc for why (`ol-0r92.14`'s clause-gate finding,
 * still true after `ol-egov.141.89.8.40`).
 */
import type { AudioTranscribeDraft, WorkerTaskRequest, WritingOutcome } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildTranscriptionWiring } from '../../src/transcription/wiring.js';
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

/** A `WorkerTaskTransport` fake that answers `audio.transcribe.v1` with a scripted transcript. */
function fakeTransport(
  reply: (request: WorkerTaskRequest) => unknown = () => ({
    ok: true,
    stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'test-model' },
    result: { outcome: 'transcribed', transcript: 'a spoken answer', durationSeconds: 12 },
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

const configuredHostFixture: PersistedWorkerConfig = {
  version: 1,
  baseUrl: 'https://worker.example',
  token: 'secret-token',
};

describe('buildTranscriptionWiring — F7.8 grey-out', () => {
  it('returns a null transcriptionCaller when no Worker config has ever been saved', async () => {
    const wiring = await buildTranscriptionWiring({
      dataHost: new FakeDataHost(),
      createTransport: () => fakeTransport(),
    });
    expect(wiring.transcriptionCaller).toBeNull();
  });

  it('returns a null transcriptionCaller when the config is present but blank (baseUrl or token empty)', async () => {
    const wiring = await buildTranscriptionWiring({
      dataHost: configuredHost({ version: 1, baseUrl: '', token: '' }),
      createTransport: () => fakeTransport(),
    });
    expect(wiring.transcriptionCaller).toBeNull();
  });
});

describe('buildTranscriptionWiring — a configured Worker builds a real, usable TranscriptionCaller', () => {
  it('constructs the transport with the persisted config and the caller actually reaches it', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    let seenConfig: WorkerConfig | null = null;
    const transport = fakeTransport();

    const wiring = await buildTranscriptionWiring({
      dataHost: host,
      createTransport: (config) => {
        seenConfig = config;
        return transport;
      },
    });

    expect(seenConfig).toEqual({ baseUrl: 'https://worker.example', token: 'secret-token' });
    expect(wiring.transcriptionCaller).not.toBeNull();

    const result = await wiring.transcriptionCaller?.({
      audioBase64: 'ZmFrZQ==',
      mimeType: 'audio/webm',
    });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.taskId).toBe('audio.transcribe.v1');
    expect(result?.transcript).toBe('a spoken answer');
  });

  it('surfaces a WorkerTranscriptionError rather than swallowing a malformed response', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const transport = fakeTransport(() => ({ ok: true, result: {} }));

    const wiring = await buildTranscriptionWiring({
      dataHost: host,
      createTransport: () => transport,
    });

    await expect(
      wiring.transcriptionCaller?.({ audioBase64: 'ZmFrZQ==', mimeType: 'audio/webm' }),
    ).rejects.toThrow(/outcome field/);
  });
});

describe('buildTranscriptionWiring — the Writing-contract outcome (ol-egov.141.89.8.40)', () => {
  it('computes a written outcome on a real transcribed call, and hands it to onWritingOutcome', async () => {
    const outcomes: WritingOutcome<AudioTranscribeDraft>[] = [];
    const wiring = await buildTranscriptionWiring({
      dataHost: configuredHost(configuredHostFixture),
      createTransport: () => fakeTransport(),
      onWritingOutcome: (outcome) => outcomes.push(outcome),
    });

    const result = await wiring.transcriptionCaller?.({
      audioBase64: 'ZmFrZQ==',
      mimeType: 'audio/webm',
    });

    expect(result?.transcript).toBe('a spoken answer');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe('written');
  });

  it("computes a declined/nothing-to-write-from outcome on the Worker's own no-speech answer", async () => {
    const outcomes: WritingOutcome<AudioTranscribeDraft>[] = [];
    const transport = fakeTransport(() => ({
      ok: true,
      stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'test-model' },
      result: { outcome: 'no-speech', transcript: '', durationSeconds: 2 },
    }));
    const wiring = await buildTranscriptionWiring({
      dataHost: configuredHost(configuredHostFixture),
      createTransport: () => transport,
      onWritingOutcome: (outcome) => outcomes.push(outcome),
    });

    await wiring.transcriptionCaller?.({ audioBase64: 'ZmFrZQ==', mimeType: 'audio/webm' });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'declined', basis: 'nothing-to-write-from' });
  });

  it('computes an unavailable outcome, and still re-throws, on a well-formed Worker refusal', async () => {
    const outcomes: WritingOutcome<AudioTranscribeDraft>[] = [];
    const transport = fakeTransport(() => ({
      ok: false,
      code: 'quota-exceeded',
      message: 'Daily usage limit reached.',
    }));
    const wiring = await buildTranscriptionWiring({
      dataHost: configuredHost(configuredHostFixture),
      createTransport: () => transport,
      onWritingOutcome: (outcome) => outcomes.push(outcome),
    });

    await expect(
      wiring.transcriptionCaller?.({ audioBase64: 'ZmFrZQ==', mimeType: 'audio/webm' }),
    ).rejects.toMatchObject({ name: 'WorkerTranscriptionError', code: 'quota-exceeded' });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      kind: 'unavailable',
      cause: 'service-refused',
      serviceCode: 'quota-exceeded',
    });
  });

  it('computes the outcome even when no onWritingOutcome is supplied — the call itself is the production caller, not the hook', async () => {
    // No `onWritingOutcome` at all: this must not throw or skip the adapter
    // call, and the caller's own return value must be unaffected.
    const wiring = await buildTranscriptionWiring({
      dataHost: configuredHost(configuredHostFixture),
      createTransport: () => fakeTransport(),
    });

    const result = await wiring.transcriptionCaller?.({
      audioBase64: 'ZmFrZQ==',
      mimeType: 'audio/webm',
    });

    expect(result?.transcript).toBe('a spoken answer');
  });
});
