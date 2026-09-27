/**
 * Writing adapter for the transcription seam (F5.1, `ol-p4t01`; this bead
 * `ol-egov.141.89.8.40`; `ol-egov.141.89.8.31`'s own notes name this as the
 * follow-up transcription needed once `audio.transcribe.v1`'s wire response
 * carried a branching outcome — `olea-service/src/tasks/audioTranscribe.ts`,
 * `outcome: 'transcribed' | 'no-speech'`). Pure; mirrors `./vision-page.ts`'s
 * shape exactly, one level down: `AudioTranscribeResultShape` below is a
 * structural mirror of the Worker's own response, not an import — the same
 * `packages/core` never imports `olea-service` (INV-3) reasoning
 * `vision-page.ts`'s own doc gives, and the same reasoning
 * `packages/core/src/transcription/transcribe.ts`'s `TranscribeAudioWireResponse`
 * already gives for mirroring that file's request/response schemas.
 *
 * **Production caller.** `packages/plugin/src/transcription/wiring.ts`'s
 * `buildTranscriptionWiring` wraps the real `TranscriptionCaller`
 * (`createWorkerTranscriptionCaller`) so that every call it makes computes
 * this adapter's outcome unconditionally, before handing it to an optional
 * `onWritingOutcome` hook — see that file's own module doc for why the call
 * itself, not the hook, is what makes this a production caller
 * (`[D-072]`), and for the one thing it is NOT yet: the wrapped caller has
 * no invocable surface anywhere in the plugin (F5.1 names no command, view
 * or button, and `packages/core/src/transcription/transcribe.ts`'s own
 * module doc — "WHY THE WIRE TYPES ARE A MIRROR" section's sibling, "WHY THIS
 * STOPS HERE" — records that gap; a proposed decision bead is filed against
 * `ol-0r92.14`'s notes for the surface itself, not this one).
 *
 * **The mapping — a reading, not a check, so most readings are
 * `unverified`, never `checks-passed`.** No code checks run over a
 * transcript today, so a written outcome always carries an empty check list
 * (`writingFromChecks`'s own doc: "there were no checks at all" is exactly
 * what `unverified` means).
 *
 * - `'no-speech'`, or `'transcribed'` with an empty `transcript` (an
 *   honestly empty answer that never tripped the Worker's own no-speech
 *   signal — see `audioTranscribe.ts`'s `groundTranscription` doc for why
 *   the two can diverge): `declined`, basis `nothing-to-write-from` —
 *   nothing to write from, the same "no unit invented from nothing" posture
 *   `vision-page.ts` takes for an unreadable or figure-only page.
 * - `'transcribed'` with a non-empty `transcript`: `written`, an
 *   empty-checks receipt (`unverified`).
 * - A failed call (`writingFromAudioTranscribeCallFailure`, below) — the
 *   transport itself failing before any response arrives, or the Worker
 *   answering with a well-formed refusal — is the operational-failure arm,
 *   read through `./worker-failure.js#readWorkerErrorCode` exactly the way
 *   `vision-page.ts` reads it. Unlike vision, `audio.transcribe.v1` names no
 *   `grounding-refused`-shaped code of its own today (INV-5's shape here is
 *   entirely inside `groundTranscription`, which always answers `ok: true`
 *   with `'no-speech'`, never a refusal error) — `readWorkerErrorCode` is
 *   still the right call: if the Worker ever does answer with that code, it
 *   reads as `declined`/`nothing-to-write-from` rather than `unavailable`,
 *   the same way it would for any other seam using this shared reading.
 *
 * **Never content (D-005).** `AudioTranscribeDraft.transcript` is the only
 * content-bearing field anywhere in this module's output, and it is the
 * draft itself, not the receipt: `writingFromChecks` builds an empty-checks
 * receipt from an empty list, so no transcript text ever reaches a check's
 * `note`.
 */

import type { StageUnavailableCause } from '../provenance.js';
import {
  failedCallProvenance,
  type ModelStamp,
  modelProvenance,
  type StageSeamContext,
} from '../provenance.js';
import type { WritingDeclined, WritingOutcome, WritingUnavailable } from '../writing.js';
import { writingFromChecks } from '../writing.js';
import { readWorkerErrorCode } from './worker-failure.js';

/**
 * Mirrors `olea-service/src/tasks/audioTranscribe.ts`'s `audioTranscribeResponse`
 * structurally — see this module's own doc for why mirrored rather than
 * imported (INV-3: core never imports the service). `modelId`/`promptVersion`
 * optional for the same reason `VisionPageExtractResultShape`'s own doc
 * gives: a test double may answer without a wire stamp to read; the real
 * `TranscriptionCaller` supplies them once threaded from the Worker's own
 * `stamp` (see `../../transcription/workerTranscriptionCaller.ts`).
 */
export interface AudioTranscribeResultShape {
  readonly outcome: 'transcribed' | 'no-speech';
  readonly transcript: string;
  readonly durationSeconds: number;
  readonly modelId?: string;
  readonly promptVersion?: string;
}

/** What a `'transcribed'` reading with a non-empty transcript writes. */
export interface AudioTranscribeDraft {
  readonly transcript: string;
  readonly durationSeconds: number;
}

/** The context this adapter needs beyond the result itself — no `stamp`: it is read off `result.modelId`/`.promptVersion` directly, since the wire stamp travels on the result, not resolved ahead by the caller. Same shape `VisionPageSeamContext` gives. */
export type AudioTranscribeSeamContext = Pick<
  StageSeamContext,
  'seat' | 'taskId' | 'evidenceDigests'
>;

function stampOf(result: AudioTranscribeResultShape): ModelStamp | null {
  return result.modelId !== undefined && result.promptVersion !== undefined
    ? { modelId: result.modelId, promptVersion: result.promptVersion }
    : null;
}

/**
 * One settled `audio.transcribe.v1` reading, as a writing outcome. Never
 * called for a failed call — see `writingFromAudioTranscribeCallFailure` for
 * that arm.
 */
export function writingFromAudioTranscribeResult(
  result: AudioTranscribeResultShape,
  context: AudioTranscribeSeamContext,
): WritingOutcome<AudioTranscribeDraft> {
  const provenance = modelProvenance({ ...context, stamp: stampOf(result) });

  if (result.outcome === 'no-speech' || result.transcript.length === 0) {
    // Whisper's own no-speech signal, or an honestly empty answer that never
    // tripped it either way: nothing to write from, not a run failure — see
    // this module's own doc.
    return { kind: 'declined', basis: 'nothing-to-write-from', provenance };
  }

  const draft: AudioTranscribeDraft = {
    transcript: result.transcript,
    durationSeconds: result.durationSeconds,
  };
  // No code checks exist for a transcription reading today — an empty list
  // is honestly `unverified`, never `checks-passed` (writing.ts's own
  // dispositionOf rule).
  return writingFromChecks(draft, [], provenance);
}

/**
 * A call that never reached a settled `audio.transcribe.v1` response:
 * `reachedWorker: false` for the transport itself failing before any
 * response arrived; `reachedWorker: true` with the Worker's own error `code`
 * for a well-formed refusal or an unusable response. Mirrors
 * `VisionPageCallFailure` exactly.
 */
export interface AudioTranscribeCallFailure {
  readonly reachedWorker: boolean;
  readonly code?: string;
}

/**
 * A failed call to `audio.transcribe.v1`, as a writing outcome. Reads the
 * Worker's own error code through `readWorkerErrorCode` — the same shared
 * reading every other Worker-error adapter in this directory uses.
 */
export function writingFromAudioTranscribeCallFailure(
  failure: AudioTranscribeCallFailure,
  context: AudioTranscribeSeamContext,
): WritingDeclined | WritingUnavailable {
  const provenance = failedCallProvenance({ ...context, stamp: null });

  if (!failure.reachedWorker) {
    return { kind: 'unavailable', cause: 'call-failed', provenance };
  }

  const reading = readWorkerErrorCode(failure.code);
  if (reading.kind === 'nothing-to-work-from') {
    return { kind: 'declined', basis: 'nothing-to-write-from', provenance };
  }
  const cause: StageUnavailableCause =
    reading.kind === 'service-refused' ? 'service-refused' : 'malformed';
  return {
    kind: 'unavailable',
    cause,
    ...(reading.kind === 'service-refused' ? { serviceCode: reading.serviceCode } : {}),
    provenance,
  };
}
