/**
 * The prose half of F2.7 ("explain why I got this wrong",
 * `features/F2-review.md:267`) — a cassette-replayed `explain-why.generate.v1`
 * call, mirroring `../oracle/generate.ts`'s shape exactly (`ol-4k45` [XWY-2],
 * closing the half `./ground.ts`'s old module doc named BLOCKED).
 *
 * ## Why this is a separate file from `./ground.ts`, not an addition to it
 *
 * `ground.ts` is the GROUNDING half — real, local, free, and it stays that
 * way; see that file's own module doc. This file is the PROSE half: it makes
 * no retrieval decision of its own, takes a `GroundExplanationResult` as
 * input, and turns its cited chunks into an explanation by replaying the
 * SAME cassette mechanism `../oracle/generate.ts` already built for
 * `quiz.generate.v1` — `CassetteGenerationProvider`, imported and reused
 * rather than reimplemented, because the mechanism (hash the payload, look
 * up `(taskId, payloadHash)`, refuse rather than approximate on a miss) does
 * not change with the task id.
 *
 * ## Where the recording comes from
 *
 * `packages/workbench/scripts/precompute-generation.mjs` records the one
 * `explain-why.generate.v1` call this file ever replays, against the REAL,
 * public fixture vault (`packages/core/fixtures/vault/`) — never a real
 * course, never real student material (INV-3: this cassette ships inline in
 * the public workbench bundle). See that script's own module doc for the
 * exact query, course and answer pair recorded, and `../explain-scenarios.ts`
 * for where this function is called with matching arguments (the payload
 * hash must match byte-for-byte, or `CassetteGenerationProvider` throws
 * `GenerationReplayError` rather than serving something close).
 *
 * ## Never calls the Worker
 *
 * Same discipline as `../oracle/generate.ts`'s `CassetteGenerationProvider`:
 * this class only ever reads an already-loaded `GenerationCassette`. D-021
 * and INV-1 both require the browser bundle to carry no live model-call path.
 */

import { CassetteGenerationProvider } from '../oracle/generate.js';
import {
  type PipelineTrace,
  recordStageAsync,
  type StageId,
  type StageRecord,
} from '../oracle/trace.js';
import type { GenerationCassette } from '../synthetic-bridge.js';
import type { GroundExplanationResult } from './ground.js';

export const EXPLAIN_WHY_GENERATE_TASK_ID = 'explain-why.generate.v1';

/** `explain-why.generate.v1`'s request shape, restated locally rather than imported — same reason `../oracle/generate.ts`'s `QuizGenerateRequestPayload` gives: this package has no dependency on `olea-service`, by construction. */
export interface ExplainWhyGenerateRequestPayload {
  readonly courseCode: string;
  readonly conceptName?: string;
  readonly question: string;
  readonly studentAnswer: string;
  readonly correctAnswer: string;
  readonly sourceChunks: readonly string[];
}

/** `explain-why.generate.v1`'s response shape — the fields this file's caller needs, restated locally for the same reason as the request. */
export interface ExplainWhyGenerateResponsePayload {
  readonly explanations: readonly {
    readonly text: string;
    readonly citedChunkIndex: number;
  }[];
}

export interface GenerateExplainProseInput {
  readonly cassette: GenerationCassette;
  /** The upstream grounding half's result — `sourceChunks` is derived from it, never passed independently, so a refusal here always means an inherited empty context (same rule `../oracle/generate.ts`'s `GenerateScenarioInput` states for `quiz.generate.v1`). */
  readonly grounding: GroundExplanationResult;
  readonly courseCode: string;
  readonly conceptName?: string;
  readonly question: string;
  readonly studentAnswer: string;
  readonly correctAnswer: string;
}

export interface ExplainProseResult {
  readonly request: ExplainWhyGenerateRequestPayload;
  /** `true` when the model returned zero explanations — F2.7's "refuse rather than invent" idiom, the array-length-zero convention every generative task in this catalogue shares. */
  readonly refused: boolean;
  readonly text: string | null;
  /** 1-based index into `request.sourceChunks` — `null` on a refusal. */
  readonly citedChunkIndex: number | null;
  readonly trace: PipelineTrace;
}

function isExplainWhyGenerateResponse(value: unknown): value is ExplainWhyGenerateResponsePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { explanations?: unknown }).explanations)
  );
}

/** `GroundExplanationResult -> string[]`, or `[]` on a refusal — the one place a refused grounding becomes an empty prose-generation context. */
function sourceChunksFrom(grounding: GroundExplanationResult): readonly string[] {
  return grounding.result.status === 'grounded' ? grounding.result.chunks.map((c) => c.text) : [];
}

/**
 * Runs one `explain-why.generate.v1` call, replaying `input.cassette` — never
 * a network call. Records exactly one `'generate'` `StageRecord`, the same
 * `StageId` `../oracle/generate.ts`'s own generative stage uses (the
 * mechanism is identical; only the task id and payload shape differ).
 * `inputSummary`/`outputSummary` carry counts and ids only, never chunk or
 * explanation text (D-005's "no content" discipline, same as every other
 * pipeline stage in this package).
 */
export async function generateExplainProse(
  input: GenerateExplainProseInput,
): Promise<ExplainProseResult> {
  const sourceChunks = sourceChunksFrom(input.grounding);
  const request: ExplainWhyGenerateRequestPayload = {
    courseCode: input.courseCode,
    ...(input.conceptName === undefined ? {} : { conceptName: input.conceptName }),
    question: input.question,
    studentAnswer: input.studentAnswer,
    correctAnswer: input.correctAnswer,
    sourceChunks,
  };
  const provider = new CassetteGenerationProvider({ cassette: input.cassette });

  const upstreamRefused = input.grounding.result.status !== 'grounded';

  const stage = await recordStageAsync(
    'generate',
    () => provider.call(EXPLAIN_WHY_GENERATE_TASK_ID, request),
    (call) => {
      const explanations =
        call.response.ok && isExplainWhyGenerateResponse(call.response.result)
          ? call.response.result.explanations
          : [];
      return {
        status: !call.response.ok ? 'threw' : explanations.length === 0 ? 'empty' : 'ok',
        inputSummary: {
          taskId: call.taskId,
          courseCode: request.courseCode,
          sourceChunkCount: sourceChunks.length,
        },
        outputSummary: call.response.ok
          ? {
              ok: true,
              promptVersion: call.promptVersion,
              modelId: call.modelId,
              explanations: explanations.length,
            }
          : { ok: false, code: call.response.code },
        // Same attribution rule `../oracle/generate.ts`'s `generateScenario`
        // uses: an empty context here is always inherited from the
        // grounding stage's own refusal, never this stage's fault.
        couldHaveSucceeded: !upstreamRefused,
        attributedTo: upstreamRefused ? ('retrieve' satisfies StageId) : null,
      };
    },
  );

  const explanations =
    stage.result.response.ok && isExplainWhyGenerateResponse(stage.result.response.result)
      ? stage.result.response.result.explanations
      : [];
  const first = explanations[0];

  return {
    request,
    refused: first === undefined,
    text: first?.text ?? null,
    citedChunkIndex: first?.citedChunkIndex ?? null,
    trace: { stages: [stage.record] },
  };
}

export type { StageRecord };
