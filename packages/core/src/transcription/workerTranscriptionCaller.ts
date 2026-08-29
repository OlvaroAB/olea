/**
 * `createWorkerTranscriptionCaller` — the production `TranscriptionCaller`
 * for `audio.transcribe.v1` (`ol-p4t01`, F5.1), mirroring
 * `../grading/workerJudgeCaller.ts`'s `createWorkerJudgeCaller` exactly:
 * builds the envelope, sends it through an injected `WorkerTaskTransport`,
 * and turns whatever comes back into `TranscribeAudioWireResponse`. No
 * network call of its own outside the injected transport, no state, no
 * retry — those live at the transport/composition layer.
 *
 * ===========================================================================
 * WHY THE TASK ID AND CONTRACT VERSION ARE LOCAL CONSTANTS
 * ===========================================================================
 * Same reasoning `workerJudgeCaller.ts`/`workerProvider.ts` give:
 * `olea-contracts`'s `main` points at TypeScript source, so importing its
 * values here would make this module unloadable from a plain Node process
 * running `packages/core/dist`. `workerTranscriptionCaller.spec.ts` asserts
 * both constants equal the frozen catalogue's.
 *
 * ===========================================================================
 * NEVER LOGS (D-005)
 * ===========================================================================
 * The transcript is what she said, verbatim — the single most content-heavy
 * string this package ever handles. This module has no logging call anywhere
 * in it, and never includes the transcript (or the audio) in a thrown error's
 * message either: every `WorkerTranscriptionError` message below is
 * shape-level ("no transcript field"), never content-level ("transcript was
 * X"). `workerTranscriptionCaller.spec.ts` asserts the source contains no
 * `console.*` call, the same defence `workerJudgeCaller.spec.ts` uses.
 *
 * ===========================================================================
 * REACHABILITY
 * ===========================================================================
 * This is a real, callable production port, not a test fake — it reaches the
 * actual `WorkerTaskTransport` seam `createWorkerJudgeCaller` already uses.
 * What is NOT built here: the plugin-side composition root that hands a real
 * `TranscriptionCaller` to anything. See `./transcribe.ts`'s module doc for
 * the named seam this bead stops at.
 */

import type { WorkerTaskTransport } from '../retrieval/workerProvider.js';
import type {
  TranscribeAudioWireRequest,
  TranscribeAudioWireResponse,
  TranscriptionCaller,
} from './transcribe.js';

/**
 * `TASK_IDS.AUDIO_TRANSCRIBE`, mirrored — see the module doc for why it is
 * not imported. Pinned to the frozen catalogue by
 * `workerTranscriptionCaller.spec.ts`.
 */
export const AUDIO_TRANSCRIBE_TASK_ID = 'audio.transcribe.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms and pinned by the same test. */
export const AUDIO_TRANSCRIBE_CONTRACT_VERSION = 2;

/**
 * Anything that went wrong between sending audio and having a transcript.
 * `code` is the Worker's own `ErrorCode` when the failure came back as a
 * well-formed error response, and `undefined` when the response was unusable
 * for some other reason (malformed body). Never carries the transcript or the
 * audio — see the module doc's D-005 note.
 */
export class WorkerTranscriptionError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerTranscriptionError';
    this.code = code;
  }
}

export interface WorkerTranscriptionCallerDeps {
  readonly transport: WorkerTaskTransport;
}

/**
 * Builds the production `TranscriptionCaller` — a plain function, matching
 * the port `./transcribe.ts` declares, rather than a class implementing it,
 * because `TranscriptionCaller` is itself a function type with no other
 * members to satisfy.
 */
export function createWorkerTranscriptionCaller(
  deps: WorkerTranscriptionCallerDeps,
): TranscriptionCaller {
  return async (input: TranscribeAudioWireRequest): Promise<TranscribeAudioWireResponse> => {
    const body = await deps.transport.send({
      contractVersion: AUDIO_TRANSCRIBE_CONTRACT_VERSION,
      taskId: AUDIO_TRANSCRIBE_TASK_ID,
      payload: input,
    });
    return readTranscription(body);
  };
}

function readTranscription(body: unknown): TranscribeAudioWireResponse {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerTranscriptionError(
      'WorkerTranscriptionCaller: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response.ok === false) {
    const code = typeof response.code === 'string' ? response.code : undefined;
    const message = typeof response.message === 'string' ? response.message : 'no message supplied';
    throw new WorkerTranscriptionError(
      `WorkerTranscriptionCaller: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response.ok !== true) {
    throw new WorkerTranscriptionError(
      'WorkerTranscriptionCaller: the Worker response carried no `ok` discriminant.',
    );
  }

  const result = response.result;
  if (typeof result !== 'object' || result === null) {
    throw new WorkerTranscriptionError(
      'WorkerTranscriptionCaller: the Worker response carried no `result` object.',
    );
  }
  const r = result as Record<string, unknown>;

  const transcript = r.transcript;
  if (typeof transcript !== 'string') {
    throw new WorkerTranscriptionError(
      'WorkerTranscriptionCaller: the Worker response carried no transcript field.',
    );
  }
  const durationSeconds = r.durationSeconds;
  if (
    typeof durationSeconds !== 'number' ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0
  ) {
    throw new WorkerTranscriptionError(
      'WorkerTranscriptionCaller: the Worker response carried no valid durationSeconds field.',
    );
  }

  return { transcript, durationSeconds };
}
