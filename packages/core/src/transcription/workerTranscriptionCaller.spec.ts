import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION, TASK_IDS } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { WorkerTaskRequest, WorkerTaskTransport } from '../retrieval/workerProvider.js';
import type { TranscribeAudioWireRequest } from './transcribe.js';
import {
  AUDIO_TRANSCRIBE_CONTRACT_VERSION,
  AUDIO_TRANSCRIBE_TASK_ID,
  createWorkerTranscriptionCaller,
  WorkerTranscriptionError,
} from './workerTranscriptionCaller.js';

/** Records what was sent and answers with whatever the test scripted. */
class RecordingTransport implements WorkerTaskTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

function okResponse(result: unknown): unknown {
  return {
    ok: true,
    stamp: { contractVersion: CONTRACT_VERSION, promptVersion: '1.0.0', modelId: 'test-model' },
    result,
  };
}

const wireInput: TranscribeAudioWireRequest = {
  audioBase64: 'ZmFrZS1hdWRpby1ieXRlcw==',
  mimeType: 'audio/webm',
};

describe('createWorkerTranscriptionCaller — the frozen vocabulary it mirrors', () => {
  // Production code deliberately does not import olea-contracts as a value
  // (see the module doc) — this test is what stops the mirror drifting.
  it('sends the task id the frozen catalogue reserves for Slot A', () => {
    expect(AUDIO_TRANSCRIBE_TASK_ID).toBe(TASK_IDS.AUDIO_TRANSCRIBE);
  });

  it('sends the current contract version', () => {
    expect(AUDIO_TRANSCRIBE_CONTRACT_VERSION).toBe(CONTRACT_VERSION);
  });
});

describe('createWorkerTranscriptionCaller — the request it builds', () => {
  it('sends the wire input verbatim, in the frozen envelope', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ transcript: 'a spoken answer', durationSeconds: 5.5 }),
    );
    const callTranscription = createWorkerTranscriptionCaller({ transport });

    await callTranscription(wireInput);

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe(TASK_IDS.AUDIO_TRANSCRIBE);
    expect(request?.contractVersion).toBe(CONTRACT_VERSION);
    expect(request?.payload).toEqual(wireInput);
  });
});

describe('createWorkerTranscriptionCaller — reading the response', () => {
  it('parses a full response', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ transcript: 'a heap is a tree', durationSeconds: 3.25 }),
    );
    const callTranscription = createWorkerTranscriptionCaller({ transport });

    const result = await callTranscription(wireInput);

    expect(result).toEqual({ transcript: 'a heap is a tree', durationSeconds: 3.25 });
  });

  it('parses an honest empty transcript (the Worker\'s own no-speech refusal) without treating it as an error', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ transcript: '', durationSeconds: 2.0 }),
    );
    const callTranscription = createWorkerTranscriptionCaller({ transport });

    const result = await callTranscription(wireInput);

    expect(result).toEqual({ transcript: '', durationSeconds: 2.0 });
  });

  it('throws WorkerTranscriptionError with the code on a well-formed refusal', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'quota-exceeded',
      message: 'Daily usage limit reached.',
    }));
    const callTranscription = createWorkerTranscriptionCaller({ transport });

    await expect(callTranscription(wireInput)).rejects.toMatchObject({
      name: 'WorkerTranscriptionError',
      code: 'quota-exceeded',
    });
  });

  it('throws on a response missing the transcript field', async () => {
    const transport = new RecordingTransport(() => okResponse({ durationSeconds: 1 }));
    const callTranscription = createWorkerTranscriptionCaller({ transport });

    await expect(callTranscription(wireInput)).rejects.toBeInstanceOf(WorkerTranscriptionError);
  });

  it('throws on a response missing a valid durationSeconds field', async () => {
    const transport = new RecordingTransport(() => okResponse({ transcript: 'hi' }));
    const callTranscription = createWorkerTranscriptionCaller({ transport });

    await expect(callTranscription(wireInput)).rejects.toBeInstanceOf(WorkerTranscriptionError);
  });

  it('throws on a non-object response', async () => {
    const transport = new RecordingTransport(() => 'not an object');
    const callTranscription = createWorkerTranscriptionCaller({ transport });

    await expect(callTranscription(wireInput)).rejects.toBeInstanceOf(WorkerTranscriptionError);
  });
});

describe('createWorkerTranscriptionCaller — D-005: never logs', () => {
  it('has no console call anywhere in the source, and never echoes a transcript into an error message', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./workerTranscriptionCaller.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/console\.\w+\(/);
  });
});
