/**
 * The client-side transcription port (F5.1 voice input, `ol-p4t01`,
 * `[D-007]`) — turns spoken audio into text and feeds it into the SAME
 * `GradeExplainBackInput` (`../grading/gradingPipeline.js`) a typed answer
 * already uses. **Voice is an input method, not a new grading path**: this
 * module produces no verdict, stores nothing, and grades nothing — it ends at
 * `studentAnswer: string`, exactly where typed input already starts.
 *
 * ===========================================================================
 * WHY THE WIRE TYPES ARE A MIRROR, NOT AN IMPORT
 * ===========================================================================
 * Same reasoning `gradingPipeline.ts`'s own module doc gives for its wire
 * types: `olea-core` (this package, public repo) cannot depend on
 * `olea-service` (private repo, INV-3) — there is no import path between them,
 * by design. `TranscribeAudioWireRequest`/`TranscribeAudioWireResponse` below
 * are a **maintained mirror** of `olea-service/src/tasks/audioTranscribe.ts`'s
 * zod schemas (`audioTranscribeRequest`/`audioTranscribeResponse`), not a
 * shared type — the two files must be read together whenever either changes.
 *
 * ===========================================================================
 * REACHABILITY — DELIBERATELY STOPS HERE
 * ===========================================================================
 * This file and `./workerTranscriptionCaller.ts` build the port and its
 * production implementation, mirroring `../grading/workerJudgeCaller.ts`
 * exactly. What is NOT built:
 *
 * - Any plugin-side composition root. `packages/plugin/src/grading/wiring.ts`'s
 *   `GradingWiring` (`judgeCaller: JudgeCaller | null`, `null` when the Worker
 *   isn't configured) is the pattern a future `TranscriptionWiring` would
 *   mirror exactly — reusing the SAME `isWorkerConfigured` check that
 *   `buildGradingWiring` already runs, since transcription and grading share
 *   one Worker configuration. D-007's "greys out with the other AI features"
 *   therefore needs no new offline-detection logic, only threading the
 *   existing check through a second wiring object — that threading is plugin
 *   work, outside this bead's ownership (`packages/core/src/transcription/`).
 * - Any audio-capture or recording UI. F5.1 names voice as an input option
 *   ("spoken or typed"); it names no command, button or view, and D-072's
 *   reachability rule does not license inventing one where the contract is
 *   silent — see `ol-p4t01`'s own bead for the surface-bead pointer this
 *   stops at.
 *
 * `buildGradeExplainBackInputFromTranscript` below is the actual seam: a
 * real, callable function producing a real `GradeExplainBackInput`, with no
 * caller anywhere in this package yet — the identical "real infrastructure,
 * no caller yet" shape `gradeExplainBackAttempt` itself already has (see that
 * function's own module doc in `packages/plugin/src/grading/wiring.ts` for
 * why building the destination now would be a Class C move).
 */

import type { GradeExplainBackInput } from '../grading/gradingPipeline.js';

/**
 * The `audio.transcribe.v1` request exactly as the Worker's zod schema shapes
 * it (`olea-service/src/tasks/audioTranscribe.ts`'s `audioTranscribeRequest`).
 */
export interface TranscribeAudioWireRequest {
  /**
   * Base64-encoded audio bytes. See the Worker task's own doc for the size
   * bound (`MAX_AUDIO_BASE64_CHARS`, ≈10MB of raw audio) and why it is a
   * declared cap rather than a measured one.
   */
  readonly audioBase64: string;
  /** e.g. `"audio/webm"`, `"audio/mp4"`, `"audio/wav"` — forwarded as-is; never inspected here. */
  readonly mimeType: string;
}

/**
 * The `audio.transcribe.v1` response exactly as the Worker returns it, after
 * its own anti-hallucination check (`audioTranscribe.ts`'s
 * `groundTranscription`): `transcript` is `""` rather than a confabulated
 * sentence when Whisper's own voice-activity signal says there was no speech.
 */
export interface TranscribeAudioWireResponse {
  readonly transcript: string;
  readonly durationSeconds: number;
}

/** Performs the actual transcription call. Not implemented here — see `./workerTranscriptionCaller.ts`. */
export type TranscriptionCaller = (
  input: TranscribeAudioWireRequest,
) => Promise<TranscribeAudioWireResponse>;

/**
 * Everything `buildGradeExplainBackInputFromTranscript` needs besides the
 * transcript itself — the rest of `GradeExplainBackInput`, unchanged by voice
 * being the input method (F5.1: "voice is an input method, not a new grading
 * path"). Indexed off `GradeExplainBackInput` itself rather than re-declared,
 * so this type can never drift from the pipeline's own — the two evolve
 * together by construction.
 */
export interface ExplainBackPromptContext {
  readonly question: GradeExplainBackInput['question'];
  readonly referenceAnswer: GradeExplainBackInput['referenceAnswer'];
  readonly sourceBlocks: GradeExplainBackInput['sourceBlocks'];
  readonly misconceptionDigest: GradeExplainBackInput['misconceptionDigest'];
}

/**
 * Turns a transcript into the exact input `gradeExplainBack` already accepts
 * from typed answers — the whole point being that this function's output is
 * indistinguishable from what a typed-answer caller would build, which is
 * what makes "voice is an input method, not a new grading path" true of the
 * code and not just of the prose. Pure, synchronous, no I/O.
 *
 * `transcript.transcript` becomes `studentAnswer` verbatim, including when it
 * is `""` (the Worker's own honest "no speech detected" answer). No special
 * case is needed for that: `gradeExplainBack` already treats an empty
 * `studentAnswer` as "she gave no answer" rather than as unusable input (see
 * that function's own module doc) — the same honest-refusal shape
 * `groundTranscription` produces on the service side is already a value this
 * pipeline knows how to receive.
 */
export function buildGradeExplainBackInputFromTranscript(
  transcript: TranscribeAudioWireResponse,
  context: ExplainBackPromptContext,
): GradeExplainBackInput {
  return {
    question: context.question,
    studentAnswer: transcript.transcript,
    referenceAnswer: context.referenceAnswer,
    sourceBlocks: context.sourceBlocks,
    misconceptionDigest: context.misconceptionDigest,
  };
}
