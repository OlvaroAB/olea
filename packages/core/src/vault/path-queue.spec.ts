/**
 * `withPathQueue` (`ol-egov.141.89.104.2`): one queue per normalised vault path. Ordering, error
 * release, the key, and that an idle queue leaves nothing behind.
 */

import { describe, expect, it } from 'vitest';
import { pathQueueDepthForTests, pathQueueKey, withPathQueue } from './path-queue.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('withPathQueue', () => {
  it('runs tasks on one path one at a time, in the order they were queued', async () => {
    const order: string[] = [];
    const firstMayFinish = deferred();
    const first = withPathQueue('.olea/a.json', async () => {
      order.push('first:start');
      await firstMayFinish.promise;
      order.push('first:end');
    });
    const second = withPathQueue('.olea/a.json', async () => {
      order.push('second');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    firstMayFinish.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('runs tasks on different paths concurrently', async () => {
    const order: string[] = [];
    const held = deferred();
    const a = withPathQueue('.olea/a.json', async () => {
      await held.promise;
      order.push('a');
    });
    const b = withPathQueue('.olea/b.json', async () => {
      order.push('b');
    });
    await b;
    expect(order).toEqual(['b']);
    held.resolve();
    await a;
  });

  it('a rejected task releases the queue, and its rejection reaches only its own caller', async () => {
    const failing = withPathQueue('.olea/a.json', async () => {
      throw new Error('task failed');
    });
    const next = withPathQueue('.olea/a.json', async () => 'next ran');
    await expect(failing).rejects.toThrow('task failed');
    await expect(next).resolves.toBe('next ran');
  });

  it('paths one disk would store as one file share a queue', () => {
    expect(pathQueueKey('.olea/Same-As/A.json')).toBe(pathQueueKey('.olea/same-as/a.json'));
    expect(pathQueueKey('./.olea//a.json')).toBe(pathQueueKey('.olea/a.json'));
    expect(pathQueueKey('.olea/café.json')).toBe(pathQueueKey('.olea/café.json'));
    expect(pathQueueKey('.olea/a.json')).not.toBe(pathQueueKey('.olea/b.json'));
  });

  it('a different spelling of one path waits on the same queue', async () => {
    const order: string[] = [];
    const held = deferred();
    const first = withPathQueue('.olea/x/A.json', async () => {
      await held.promise;
      order.push('first');
    });
    const second = withPathQueue('./.olea/x/a.json', async () => {
      order.push('second');
    });
    held.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('leaves no queue behind once every task has settled', async () => {
    await Promise.all([
      withPathQueue('.olea/idle-1.json', async () => undefined),
      withPathQueue('.olea/idle-1.json', async () => undefined),
      withPathQueue('.olea/idle-2.json', async () => {
        throw new Error('x');
      }).catch(() => undefined),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pathQueueDepthForTests()).toBe(0);
  });
});
