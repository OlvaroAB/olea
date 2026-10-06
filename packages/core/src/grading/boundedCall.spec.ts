import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BoundedCallError,
  boundedCall,
  boundedCallWithRetries,
  classifyGradingCallFailure,
  GRADING_CALL_BOUNDS,
} from './boundedCall.js';

// Synthetic only (INV-3): nothing here carries a request or a response body.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('boundedCall: a call that outlives its bound ends with a typed timeout', () => {
  // @auto:core/grading/boundedCall.spec
  it('rejects with reason timeout once the bound elapses on a call that never settles', async () => {
    const outcome = boundedCall(() => new Promise<string>(() => {}), { boundMs: 1_000 });
    const seen = outcome.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(999);
    let settledEarly = false;
    void seen.then(() => {
      settledEarly = true;
    });
    await Promise.resolve();
    expect(settledEarly).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const error = await seen;
    expect(error).toBeInstanceOf(BoundedCallError);
    expect((error as BoundedCallError).reason).toBe('timeout');
  });

  // @auto:core/grading/boundedCall.spec
  it('gives a transport failure, an invalid response and a not-configured failure each their own typed reason', async () => {
    const reasonOf = async (call: () => Promise<unknown>): Promise<string> => {
      try {
        await boundedCall(call, { boundMs: 1_000 });
      } catch (error) {
        return (error as BoundedCallError).reason;
      }
      return 'no-failure';
    };
    expect(await reasonOf(() => Promise.reject(new Error('socket closed')))).toBe('transport');
    expect(
      await reasonOf(() => {
        const e = new Error('refused');
        e.name = 'WorkerJudgeError';
        Object.assign(e, { code: 'UPSTREAM' });
        return Promise.reject(e);
      }),
    ).toBe('transport');
    expect(
      await reasonOf(() => {
        const e = new Error('not an object');
        e.name = 'WorkerJudgeError';
        return Promise.reject(e);
      }),
    ).toBe('invalid-response');
    expect(await reasonOf(() => Promise.reject(new BoundedCallError('not-configured')))).toBe(
      'not-configured',
    );
  });

  it('leaves an input the pipeline refused on purpose untouched, never a typed call failure', async () => {
    const refusal = new Error('empty reference');
    refusal.name = 'UnusableGradingInputError';
    expect(classifyGradingCallFailure(refusal)).toBeNull();
    await expect(boundedCall(() => Promise.reject(refusal), { boundMs: 1_000 })).rejects.toBe(
      refusal,
    );
  });

  it('resolves with the value of a call that settles inside its bound', async () => {
    await expect(boundedCall(() => Promise.resolve('ok'), { boundMs: 1_000 })).resolves.toBe('ok');
  });
});

describe('boundedCall: a result after the bound is dropped', () => {
  // @auto:core/grading/boundedCall.spec
  it('discards a late result: the caller saw the timeout and nothing observes the value', async () => {
    let finish: (value: string) => void = () => {};
    const late = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const observed: string[] = [];
    const outcome = boundedCall(() => late, { boundMs: 500 }).then(
      (value) => observed.push(`value:${value}`),
      (error: unknown) => observed.push(`error:${(error as BoundedCallError).reason}`),
    );
    await vi.advanceTimersByTimeAsync(600);
    finish('too late');
    await outcome;
    await vi.advanceTimersByTimeAsync(10);
    expect(observed).toEqual(['error:timeout']);
  });
});

describe('boundedCallWithRetries: retries are bounded', () => {
  const options = {
    boundMs: 1_000,
    transportRetries: GRADING_CALL_BOUNDS.transportRetries,
    invalidResponseRetries: GRADING_CALL_BOUNDS.invalidResponseRetries,
  };

  it('retries a transport failure at most the declared number of times, then surfaces the typed failure', async () => {
    let calls = 0;
    const failure = boundedCallWithRetries(() => {
      calls += 1;
      return Promise.reject(new Error('socket closed'));
    }, options);
    await expect(failure).rejects.toMatchObject({ reason: 'transport' });
    expect(calls).toBe(1 + GRADING_CALL_BOUNDS.transportRetries);
  });

  it('never retries a timeout: the timed-out call may still be running', async () => {
    let calls = 0;
    const failure = boundedCallWithRetries(() => {
      calls += 1;
      return new Promise<string>(() => {});
    }, options).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(((await failure) as BoundedCallError).reason).toBe('timeout');
    expect(calls).toBe(1);
  });

  it('succeeds when a retry within the allowance succeeds', async () => {
    let calls = 0;
    const value = await boundedCallWithRetries(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('blip')) : Promise.resolve('fine');
    }, options);
    expect(value).toBe('fine');
    expect(calls).toBe(2);
  });
});
