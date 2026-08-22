/**
 * `testWorkerConnection` tests. Obsidian-free — exercises the function
 * against a fake `WorkerTaskTransport`, asserting the three-way outcome
 * described in `test-connection.ts`'s module doc.
 *
 * Scenario: `features/F7-plugin-surface.md`, "F7.1 — testing the connection
 * never spends" — @auto:plugin/worker/test-connection.spec.
 */
import type { WorkerTaskRequest, WorkerTaskTransport } from 'olea-core';
import { RETRIEVAL_EMBED_CONTRACT_VERSION, RETRIEVAL_EMBED_TASK_ID } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  describeTestConnectionOutcome,
  TEST_CONNECTION_MESSAGES,
  testWorkerConnection,
} from '../../src/worker/test-connection.js';

class FakeTransport implements WorkerTaskTransport {
  sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown | Promise<never>) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

describe('testWorkerConnection — the request it sends', () => {
  it('sends the frozen retrieval.embed.v1 envelope with an empty chunks array', async () => {
    const transport = new FakeTransport(() => ({
      ok: false,
      code: 'invalid-request',
      message: 'x',
    }));
    await testWorkerConnection(transport);

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toEqual({
      contractVersion: RETRIEVAL_EMBED_CONTRACT_VERSION,
      taskId: RETRIEVAL_EMBED_TASK_ID,
      payload: { chunks: [] },
    });
  });
});

describe('testWorkerConnection — outcomes', () => {
  it('reachable + authenticated on invalid-request (the expected shape of a valid token, per the module doc)', async () => {
    const transport = new FakeTransport(() => ({
      ok: false,
      code: 'invalid-request',
      message: 'x',
    }));
    await expect(testWorkerConnection(transport)).resolves.toEqual({
      reachable: true,
      authenticated: true,
    });
  });

  it('reachable but not authenticated on unauthenticated', async () => {
    const transport = new FakeTransport(() => ({
      ok: false,
      code: 'unauthenticated',
      message: 'x',
    }));
    await expect(testWorkerConnection(transport)).resolves.toEqual({
      reachable: true,
      authenticated: false,
      message: TEST_CONNECTION_MESSAGES.unauthenticated,
    });
  });

  it('unreachable when the transport throws (network failure or non-JSON body)', async () => {
    const transport = new FakeTransport(() => {
      throw new Error('network down');
    });
    await expect(testWorkerConnection(transport)).resolves.toEqual({
      reachable: false,
      message: TEST_CONNECTION_MESSAGES.unreachable,
    });
  });

  it('reports unrecognised on a real ok:true success — that would mean the Worker validation changed, not that the probe should claim success', async () => {
    const transport = new FakeTransport(() => ({ ok: true, stamp: {}, result: {} }));
    await expect(testWorkerConnection(transport)).resolves.toEqual({
      reachable: true,
      authenticated: false,
      message: TEST_CONNECTION_MESSAGES.unrecognised,
    });
  });

  it('reports unrecognised on an unexpected error code', async () => {
    const transport = new FakeTransport(() => ({
      ok: false,
      code: 'quota-exceeded',
      message: 'x',
    }));
    await expect(testWorkerConnection(transport)).resolves.toEqual({
      reachable: true,
      authenticated: false,
      message: TEST_CONNECTION_MESSAGES.unrecognised,
    });
  });

  it('reports unrecognised on a malformed/non-object body rather than throwing', async () => {
    const transport = new FakeTransport(() => 'not an object');
    await expect(testWorkerConnection(transport)).resolves.toEqual({
      reachable: true,
      authenticated: false,
      message: TEST_CONNECTION_MESSAGES.unrecognised,
    });
  });
});

describe('describeTestConnectionOutcome', () => {
  it('describes success as connected', () => {
    expect(describeTestConnectionOutcome({ reachable: true, authenticated: true })).toMatch(
      /connected/i,
    );
  });

  it('passes through the message for unreachable', () => {
    expect(
      describeTestConnectionOutcome({
        reachable: false,
        message: TEST_CONNECTION_MESSAGES.unreachable,
      }),
    ).toBe(TEST_CONNECTION_MESSAGES.unreachable);
  });

  it('passes through the message for reachable-but-unauthenticated', () => {
    expect(
      describeTestConnectionOutcome({
        reachable: true,
        authenticated: false,
        message: TEST_CONNECTION_MESSAGES.unauthenticated,
      }),
    ).toBe(TEST_CONNECTION_MESSAGES.unauthenticated);
  });
});
