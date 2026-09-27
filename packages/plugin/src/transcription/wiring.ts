/**
 * `buildTranscriptionWiring` — the plugin-side composition root for the
 * transcription pipeline (`ol-p4t01`'s `audio.transcribe.v1`), following
 * exactly the pattern `grading/wiring.ts` established for
 * `buildGradingWiring`: load the persisted Worker config, build a real
 * `TranscriptionCaller` when (and only when) the Worker is usable, and hand
 * back `null` otherwise rather than a caller doomed to fail on its first
 * real request (F7.8: grey out, never half-work).
 *
 * ===========================================================================
 * WHY THIS STOPS HERE — NO RECORDING UI, NO COMMAND, NO VIEW
 * ===========================================================================
 * `ol-0r92.14`'s own brief puts the clause gate first: F5.1 ("spoken or
 * typed") authorises voice as an input MODALITY for explain-back, but names
 * no invocable surface for it — no command id, no view, no modal, no
 * button — and neither does any other clause in the functional scope.
 * `docs/dev/surface-register.md` (private repo) carries no explain-back row
 * at all yet, voice or typed, because `grading/wiring.ts`'s own module doc
 * already records that there is no explain-back destination anywhere in the
 * review UI. Per this repo's "no user-visible affordance without a clause"
 * rule, a lane may not invent one to close that gap. This module is
 * therefore surface-free plumbing only — a composition root with no caller,
 * exactly the shape `grading/wiring.ts` itself first shipped in (a real,
 * callable port with "no caller yet" stated plainly in its own module doc).
 * The gap this leaves — WHAT surface F5.1 needs, and where a recording
 * control would actually live — is escalated as a proposed decision bead
 * rather than guessed at here; see `ol-0r92.14`'s notes for the bead id.
 * **Still true after `ol-egov.141.89.8.40`** (below): wrapping the caller so
 * it also produces a Writing-contract outcome does not manufacture a caller
 * for `transcriptionCaller` itself — nothing here or anywhere else in the
 * plugin invokes it with real audio yet.
 *
 * `buildGradeExplainBackInputFromTranscript` (`olea-core`) is the seam a
 * future caller uses once a surface exists: it turns this wiring's
 * `TranscriptionCaller` output into the same `GradeExplainBackInput` a typed
 * answer produces, so voice is provably an input method feeding the
 * existing grading path (`grading/wiring.ts`'s `gradeExplainBackAttempt`),
 * never a second grading path of its own.
 *
 * ===========================================================================
 * THE WRITING-CONTRACT OUTCOME (`ol-egov.141.89.8.40`)
 * ===========================================================================
 * `audio.transcribe.v1`'s wire response carries a branching `outcome`
 * (`olea-service/src/tasks/audioTranscribe.ts`) as of this bead, giving
 * `packages/core/src/stage-contract/adapters/audio-transcribe.ts`'s adapter
 * something to read. `withWritingOutcome`, below, wraps the real
 * `TranscriptionCaller` `createWorkerTranscriptionCaller` builds so that
 * EVERY call it makes computes the Writing outcome unconditionally —
 * `writingFromAudioTranscribeResult`/`writingFromAudioTranscribeCallFailure`
 * evaluated first into a local variable, then handed to the optional
 * `deps.onWritingOutcome`, never `deps.onWritingOutcome?.(await
 * writingOutcomeFor(...))`, which would short-circuit and never evaluate the
 * adapter call at all when no consumer is wired (optional-call argument
 * short-circuiting). This is exactly the shape
 * `vision-page-runner.ts`'s `readAndLandPage` already gives
 * `vision.extract.v2` (`ol-egov.141.89.8.31`) — the call itself, not the
 * hook, is what would make this a production caller once something calls
 * `transcriptionCaller` with real audio (see the section above: nothing
 * does yet).
 *
 * The evidence digest the adapter's context carries is a SHA-256 of the
 * base64 audio TEXT actually sent (`olea-core`'s `hashText`, same algorithm
 * `vision-page-runner.ts`'s `hashImagePayload` uses for the identical
 * reason) — an opaque digest of what left this device, never the transcript
 * or the audio bytes themselves (D-005).
 *
 * ===========================================================================
 * NEVER LOGS (D-005)
 * ===========================================================================
 * A transcript is what she said, verbatim — the same content-heavy string
 * `workerTranscriptionCaller.ts` already refuses to log or include in any
 * thrown error. This module never touches the transcript text itself as
 * content: `withWritingOutcome` reads only `result.outcome`/`.transcript.length`
 * (never the transcript's characters) to decide the Writing outcome, and the
 * adapter's own draft carries the transcript only inside `WritingOutcome`,
 * never logged.
 */

import {
  AUDIO_TRANSCRIBE_TASK_ID,
  type AudioTranscribeCallFailure,
  type AudioTranscribeDraft,
  type AudioTranscribeSeamContext,
  createWorkerTranscriptionCaller,
  hashText,
  type TranscribeAudioWireRequest,
  type TranscribeAudioWireResponse,
  type TranscriptionCaller,
  type WorkerTaskTransport,
  WorkerTranscriptionError,
  type WritingOutcome,
  writingFromAudioTranscribeCallFailure,
  writingFromAudioTranscribeResult,
} from 'olea-core';
import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';

/**
 * `audio.transcribe.v1` has no fallback seat wired (no second model sits
 * behind it for an undecided/unavailable case) — every Writing outcome this
 * wiring produces is from the one, `'candidate'`, seat. A declared constant,
 * not derived, mirroring `vision-page-runner.ts`'s
 * `VISION_PAGE_WRITING_SEAT` for the identical reason.
 */
const AUDIO_TRANSCRIBE_WRITING_SEAT: AudioTranscribeSeamContext['seat'] = 'candidate';

/**
 * The `[D-300]`/`ol-egov.141.89.20` Writing-contract context for one call:
 * the audio actually sent is the only evidence this seam reads, so its
 * digest is `evidenceDigests`' one entry — same shape
 * `visionPageWritingContext` gives `vision-page-runner.ts`.
 */
async function audioTranscribeWritingContext(
  input: TranscribeAudioWireRequest,
): Promise<AudioTranscribeSeamContext> {
  return {
    seat: AUDIO_TRANSCRIBE_WRITING_SEAT,
    taskId: AUDIO_TRANSCRIBE_TASK_ID,
    evidenceDigests: [await hashText(input.audioBase64)],
  };
}

/**
 * The Writing outcome for one settled response — called unconditionally
 * from `withWritingOutcome`, below, for every successful call. Never gated
 * behind `deps.onWritingOutcome`: that field only says where the resulting
 * outcome goes, not whether the adapter runs.
 */
async function writingOutcomeForTranscription(
  input: TranscribeAudioWireRequest,
  result: TranscribeAudioWireResponse,
): Promise<WritingOutcome<AudioTranscribeDraft>> {
  return writingFromAudioTranscribeResult(result, await audioTranscribeWritingContext(input));
}

/**
 * The Writing outcome for a call that never reached a settled response —
 * same unconditional-call posture as `writingOutcomeForTranscription` above.
 * Reads `error` the way `vision-page-runner.ts`'s `writingOutcomeForFailure`
 * reads its own: a `WorkerTranscriptionError` carries the Worker's own `code`
 * when the failure came back as a well-formed refusal (`reachedWorker:
 * true`); anything else (the transport itself throwing) is
 * `reachedWorker: false`.
 */
async function writingOutcomeForTranscriptionFailure(
  input: TranscribeAudioWireRequest,
  error: unknown,
): Promise<WritingOutcome<AudioTranscribeDraft>> {
  const failure: AudioTranscribeCallFailure =
    error instanceof WorkerTranscriptionError
      ? { reachedWorker: true, ...(error.code !== undefined ? { code: error.code } : {}) }
      : { reachedWorker: false };
  return writingFromAudioTranscribeCallFailure(failure, await audioTranscribeWritingContext(input));
}

/**
 * Wraps a real `TranscriptionCaller` so every call it makes also produces a
 * Writing-contract outcome — computed unconditionally (see the module doc's
 * "THE WRITING-CONTRACT OUTCOME" section for why), handed to `onWritingOutcome`
 * when supplied, and re-thrown/returned exactly as the wrapped caller would
 * have on its own: this wrapper changes no observable behaviour of a call
 * that never inspects the outcome.
 */
function withWritingOutcome(
  caller: TranscriptionCaller,
  onWritingOutcome?: (outcome: WritingOutcome<AudioTranscribeDraft>) => void,
): TranscriptionCaller {
  return async (input: TranscribeAudioWireRequest): Promise<TranscribeAudioWireResponse> => {
    let result: TranscribeAudioWireResponse;
    try {
      result = await caller(input);
    } catch (error) {
      // Computed first, into a local variable, then handed off — not
      // `onWritingOutcome?.(await writingOutcomeForTranscriptionFailure(...))`,
      // which would never evaluate the adapter call at all when no consumer
      // is wired (optional-call argument short-circuiting).
      const writingOutcome = await writingOutcomeForTranscriptionFailure(input, error);
      onWritingOutcome?.(writingOutcome);
      throw error;
    }
    const writingOutcome = await writingOutcomeForTranscription(input, result);
    onWritingOutcome?.(writingOutcome);
    return result;
  };
}

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern `grading/wiring.ts` and every other store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export interface TranscriptionWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
  /**
   * The Writing-contract outcome for this call
   * (`packages/core/src/stage-contract/adapters/audio-transcribe.ts`,
   * `ol-egov.141.89.8.40`) — computed unconditionally, on every real call
   * `transcriptionCaller` makes, whether or not this is supplied (see the
   * module doc's "THE WRITING-CONTRACT OUTCOME" section for why: that is
   * what makes the call itself a production caller once one exists,
   * distinct from an "absent by default, pays nothing when unwired"
   * posture). **No host consumes or persists the outcome yet** — this file
   * does neither itself.
   */
  readonly onWritingOutcome?: (outcome: WritingOutcome<AudioTranscribeDraft>) => void;
}

export interface TranscriptionWiring {
  /**
   * `null` when the Worker isn't configured yet (F7.8) — the same grey-out
   * contract `GradingWiring.judgeCaller` uses. No production caller of this
   * field exists anywhere in the plugin yet (see module doc): it is composed
   * here so the eventual surface has one pre-tested seam to call rather than
   * reinventing the config-load/grey-out dance itself. Wrapped
   * (`withWritingOutcome`) so that whenever it IS eventually called with
   * real audio, every call also produces a Writing-contract outcome without
   * further wiring (`ol-egov.141.89.8.40`).
   */
  readonly transcriptionCaller: TranscriptionCaller | null;
}

export async function buildTranscriptionWiring(
  deps: TranscriptionWiringDeps,
): Promise<TranscriptionWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();

  if (!isWorkerConfigured(config)) {
    return { transcriptionCaller: null };
  }

  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  const caller = createWorkerTranscriptionCaller({ transport });
  return { transcriptionCaller: withWritingOutcome(caller, deps.onWritingOutcome) };
}
