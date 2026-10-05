/**
 * `[D-482]`: a declared bound on every call the explain-back grading path makes to the
 * Worker, and the typed reason a call that did not complete is given.
 *
 * WHY THIS EXISTS. `requestUrl` (the plugin's only transport) cannot be aborted, so a bound
 * here is a RACE, not a cancel: the call may still finish in the background, and its result
 * is dropped (settled flag) so nothing downstream can observe it. A call that hangs used to
 * leave the spinner up for as long as the platform allowed; now it ends as a typed
 * `timeout`, which the modal maps to its existing could-not-check result.
 *
 * Pure: no `obsidian`, no I/O beyond the timer. Never logs or carries content (D-005): a
 * failure carries a reason and nothing of the request or the response.
 */

export type BoundedCallReason = 'timeout' | 'transport' | 'invalid-response' | 'not-configured';

export class BoundedCallError extends Error {
  readonly reason: BoundedCallReason;

  constructor(reason: BoundedCallReason, options?: { readonly cause?: unknown }) {
    super(`bounded call failed: ${reason}`);
    this.name = 'BoundedCallError';
    this.reason = reason;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * The declared bounds, in one place. Class B defaults (declared in plain English, never
 * fitted; flagged for retroactive review): conservative, so a slow-but-working call is not
 * refused. Revisit against recorded latency (telemetry) when it exists.
 */
export const GRADING_CALL_BOUNDS = {
  /** Pass one (correctness), one attempt. The Worker's own ceiling is a 5,000-token answer. */
  correctnessMs: 30_000,
  /** Pass two (depth), one attempt: a longer structured answer. */
  depthMs: 45_000,
  /** One embedding call in the misconception match (a short batch of texts). */
  embedderMs: 10_000,
  /** Extra tries after a failed transport (never after a timeout). */
  transportRetries: 1,
  /** Extra tries after an unusable (malformed) response (never after a timeout). */
  invalidResponseRetries: 1,
} as const;

/** The longest the correctness call can take end to end: every attempt used and every one running to its bound. */
export const CORRECTNESS_OVERALL_BOUND_MS =
  GRADING_CALL_BOUNDS.correctnessMs *
  (1 + GRADING_CALL_BOUNDS.transportRetries + GRADING_CALL_BOUNDS.invalidResponseRetries);

/**
 * Maps a thrown error to a typed reason, by name (core cannot import the plugin's transport
 * error). `null` means "not a failure of the call" (an input the pipeline refused on purpose,
 * `UnusableGradingInputError`): it is rethrown untouched.
 */
export function classifyGradingCallFailure(error: unknown): BoundedCallReason | null {
  if (error instanceof BoundedCallError) return error.reason;
  const name = error instanceof Error ? error.name : '';
  if (name === 'UnusableGradingInputError') return null;
  if (name === 'WorkerJudgeError' || name === 'WorkerSoloJudgeError') {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? 'transport' : 'invalid-response';
  }
  return 'transport';
}

export interface BoundedCallOptions {
  readonly boundMs: number;
  readonly classify?: (error: unknown) => BoundedCallReason | null;
}

/** One attempt, raced against its bound. A result that arrives after the bound is dropped. */
export function boundedCall<T>(call: () => Promise<T>, options: BoundedCallOptions): Promise<T> {
  const classify = options.classify ?? classifyGradingCallFailure;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new BoundedCallError('timeout'));
    }, options.boundMs);

    let started: Promise<T>;
    try {
      started = call();
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      fail(error, classify, reject);
      return;
    }
    started.then(
      (value) => {
        if (settled) return; // late: the bound already ended this call
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fail(error, classify, reject);
      },
    );
  });
}

function fail(
  error: unknown,
  classify: (error: unknown) => BoundedCallReason | null,
  reject: (reason: unknown) => void,
): void {
  const reason = classify(error);
  if (reason === null) {
    reject(error);
    return;
  }
  reject(
    error instanceof BoundedCallError ? error : new BoundedCallError(reason, { cause: error }),
  );
}

export interface BoundedRetryOptions extends BoundedCallOptions {
  readonly transportRetries: number;
  readonly invalidResponseRetries: number;
}

/**
 * `boundedCall` with bounded retries: a transport failure is retried at most
 * `transportRetries` times and an unusable response at most `invalidResponseRetries` times;
 * a timeout or a not-configured failure is never retried (the timed-out call may still be
 * running; retrying would stack calls). After the allowance, the last typed failure is thrown.
 */
export async function boundedCallWithRetries<T>(
  call: () => Promise<T>,
  options: BoundedRetryOptions,
): Promise<T> {
  let transportLeft = options.transportRetries;
  let invalidLeft = options.invalidResponseRetries;
  for (;;) {
    try {
      return await boundedCall(call, options);
    } catch (error) {
      if (!(error instanceof BoundedCallError)) throw error;
      if (error.reason === 'transport' && transportLeft > 0) {
        transportLeft -= 1;
        continue;
      }
      if (error.reason === 'invalid-response' && invalidLeft > 0) {
        invalidLeft -= 1;
        continue;
      }
      throw error;
    }
  }
}
