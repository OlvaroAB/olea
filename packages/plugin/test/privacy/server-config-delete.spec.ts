/**
 * `deleteServerConfigRecord` tests (F7.4, `ol-p6t01`). See
 * `features/F7-plugin-surface.md` for the scenarios this asserts
 * (`plugin/privacy/server-config-delete.spec`).
 */
import { describe, expect, it } from 'vitest';
import { deleteServerConfigRecord } from '../../src/privacy/server-config-delete.js';
import type { DeleteHttpRequestFn } from '../../src/privacy/types.js';

const CONFIG = { baseUrl: 'https://olea.example.workers.dev', token: 'a-real-token' };

describe('deleteServerConfigRecord (F7.4, ol-p6t01)', () => {
  it('calls DELETE /v1/config with a bearer token and reports "deleted" on 200', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;
    const httpRequest: DeleteHttpRequestFn = async ({ url, headers }) => {
      capturedUrl = url;
      capturedAuth = headers.authorization;
      return { status: 200 };
    };

    const outcome = await deleteServerConfigRecord(CONFIG, httpRequest);

    expect(outcome).toEqual({ outcome: 'deleted' });
    expect(capturedUrl).toBe('https://olea.example.workers.dev/v1/config');
    expect(capturedAuth).toBe('Bearer a-real-token');
  });

  it('strips a trailing slash on the base URL before building the request', async () => {
    let capturedUrl: string | undefined;
    const httpRequest: DeleteHttpRequestFn = async ({ url }) => {
      capturedUrl = url;
      return { status: 200 };
    };

    await deleteServerConfigRecord(
      { ...CONFIG, baseUrl: 'https://olea.example.workers.dev/' },
      httpRequest,
    );

    expect(capturedUrl).toBe('https://olea.example.workers.dev/v1/config');
  });

  it('reports "unauthenticated" on 401, never a throw', async () => {
    const httpRequest: DeleteHttpRequestFn = async () => ({ status: 401 });

    const outcome = await deleteServerConfigRecord(CONFIG, httpRequest);

    expect(outcome).toEqual({ outcome: 'unauthenticated' });
  });

  it('degrades a transport failure to "unreachable" rather than propagating the throw', async () => {
    const httpRequest: DeleteHttpRequestFn = async () => {
      throw new Error('network down');
    };

    const outcome = await deleteServerConfigRecord(CONFIG, httpRequest);

    expect(outcome).toEqual({ outcome: 'unreachable' });
  });

  it('never includes the token in the error path — outcomes carry no token value', async () => {
    const httpRequest: DeleteHttpRequestFn = async () => {
      throw new Error('network down');
    };

    const outcome = await deleteServerConfigRecord(CONFIG, httpRequest);

    expect(JSON.stringify(outcome)).not.toContain(CONFIG.token);
  });
});
