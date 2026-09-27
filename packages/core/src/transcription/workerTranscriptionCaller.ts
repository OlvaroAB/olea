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
 * The plugin-side composition root that hands a real `TranscriptionCaller`
 * to something now exists (`packages/plugin/src/transcription/wiring.ts`,
 * `ol-0r92.14`); what is still NOT built anywhere is the invocable surface
 * that would call it with real audio — see `./transcribe.ts`'s module doc.
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

/** The two values `audioTranscribeResponse`'s additive `outcome` field can carry — see `transcribe.ts`'s `TranscribeAudioWireResponse` doc (`ol-egov.141.89.8.40`). */
const AUDIO_TRANSCRIBE_OUTCOMES = ['transcribed', 'no-speech'] as const;

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

  // `ol-egov.141.89.8.40`: additive, required on every real response — never
  // guessed when absent (a response that predates the field reads as
  // malformed, not silently defaulted). No production caller reaches this
  // path with real audio yet (see this file's module doc), so no live
  // traffic is at risk of the stricter check.
  const outcome = r.outcome;
  if (
    typeof outcome !== 'string' ||
    !(AUDIO_TRANSCRIBE_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    throw new WorkerTranscriptionError(
      'WorkerTranscriptionCaller: the Worker response carried no valid outcome field.',
    );
  }

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

  // `[D-326]`-style producer provenance, threaded from the envelope's own
  // `stamp` — same reasoning `vision-page-runner.ts`'s `WorkerVisionPageExtractor`
  // gives for folding `stamp.modelId`/`stamp.promptVersion` into its own
  // parsed result. Optional: a test double may answer without one.
  const stamp = response.stamp;
  const s = typeof stamp === 'object' && stamp !== null ? (stamp as Record<string, unknown>) : null;
  const modelId = s !== null && typeof s.modelId === 'string' ? s.modelId : undefined;
  const promptVersion =
    s !== null && typeof s.promptVersion === 'string' ? s.promptVersion : undefined;

  return {
    outcome: outcome as TranscribeAudioWireResponse['outcome'],
    transcript,
    durationSeconds,
    ...(modelId !== undefined ? { modelId } : {}),
    ...(promptVersion !== undefined ? { promptVersion } : {}),
  };
}
