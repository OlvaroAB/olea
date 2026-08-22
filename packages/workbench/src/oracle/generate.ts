/**
 * The generative driver — a `quiz.generate.v1` call, cassette-backed, plus
 * INV-6's accept gate made real (`ol-opmb.3` [TB-3], extending `ol-opmb.1`
 * [TB-1]'s `oracle/derive.ts` + `oracle/trace.ts` pattern and `ol-opmb.2`
 * [TB-2]'s `oracle/retrieve.ts` + `oracle/embedding-provider.ts` pattern).
 *
 * ## Why `quiz.generate.v1`, not `cards.generate.v1`
 *
 * Both are routed, grounded (INV-5) generative tasks (`olea-service/src/
 * tasks/registry.ts`). Only `quiz.generate.v1`'s output has a REAL accept
 * boundary already built in `olea-core`: `acceptGeneratedMcq`
 * (`../oracle-bridge.js`), which turns a `GeneratedMcqCandidate` into the
 * `McqFields` a vault write would use, and refuses (throws) a blank
 * `feedback`. `cards.generate.v1`'s two-sided `{front, back}` cards have no
 * such function yet — nothing in `packages/core` accepts one — and this
 * lane owns no path into `packages/core` to add one (file ownership,
 * `ol-opmb.3`'s brief). Demonstrating INV-6 as "a real gate a user passes
 * through" needs a gate that already exists to pass through, so this file
 * calls the task that has one.
 *
 * ## This class never makes a network call
 *
 * Same discipline as `CassetteEmbeddingProvider`
 * (`./embedding-provider.ts`): `CassetteGenerationProvider` only ever reads
 * an already-loaded `GenerationCassette`
 * (`olea-synthetic`'s `generation-cassette.ts`, `../synthetic-bridge.js`).
 * The one place in this project that calls a real generative model for the
 * synthetic world is `packages/workbench/scripts/precompute-generation.mjs`,
 * a Node harness script outside the browser bundle entirely, which itself
 * delegates the actual `POST /v1/task` call and the cache-invalidation
 * discipline to `olea-service`'s `scripts/harness/cassette.mjs` — see that
 * file's own module doc. Keeping the live call out of this class is what
 * D-021 and INV-1 both need.
 *
 * ## Never falls back to "close enough"
 *
 * A requested `(taskId, payload)` whose content hash the cassette does not
 * carry at all is REFUSED, not approximated — no similar-payload
 * substitution, no empty-result silent success. `findGenerationEntryByRequest`
 * (`generation-cassette.ts`) already does the exact-match lookup; this class
 * adds nothing but the throw when it comes back empty.
 *
 * ## The request never carries a task's own prompt or model literals
 *
 * `quizGenerateRequestPayload` below builds `{courseCode, conceptName,
 * sourceChunks, questionCount}` from purely synthetic vocabulary
 * (`../synthetic-bridge.js`'s `COURSES`/`CONCEPTS`) — never a real course
 * code, never `olea-service`'s own E3 scaffolding values (`PSYCH305` etc,
 * which live in the PRIVATE repo's task definitions and stay there). This
 * file has no dependency on `olea-service` at all, by construction: it
 * cannot import a private prompt file even by accident, because nothing here
 * ever resolves a specifier that could reach one.
 *
 * ## Attribution — the load-bearing idea this stage extends
 *
 * When the upstream `retrieve` stage refused (any reason), `sourceChunks` is
 * empty and this stage's own call is EXACTLY the INV-5 adversarial case:
 * "write me questions from nothing." A correctly-behaving model refuses
 * (`questions: []`), and that refusal is not this stage's fault — it
 * inherited an empty context from a stage that already had nothing to give
 * it, the same shape `oracle/derive.ts`'s `queue` stage already uses for a
 * `rank` abstention. `generateScenario` below sets `couldHaveSucceeded:
 * false, attributedTo: 'retrieve'` in exactly that case, never `'generate'`
 * — `'generate'` did the right thing.
 */

import type { GeneratedMcqCandidate, GroundingResult, McqFields } from '../oracle-bridge.js';
import { acceptGeneratedMcq } from '../oracle-bridge.js';
import type { GenerationCassette, GenerationTaskResponse } from '../synthetic-bridge.js';
import { findGenerationEntryByRequest, hashGenerationPayload } from '../synthetic-bridge.js';
import {
  type PipelineTrace,
  recordStage,
  recordStageAsync,
  type StageId,
  type StageRecord,
} from './trace.js';

/** `quiz.generate.v1`'s request shape, restated locally rather than imported — see the module doc's "never carries a task's own prompt or model literals". */
export interface QuizGenerateRequestPayload {
  readonly courseCode: string;
  readonly conceptName: string;
  readonly sourceChunks: readonly string[];
  readonly questionCount?: number;
}

/** `quiz.generate.v1`'s response shape — the fields `acceptGeneratedMcq` (`../oracle-bridge.js`) consumes, restated locally for the same reason as the request. */
export interface QuizGenerateResponsePayload {
  readonly questions: readonly {
    readonly stem: string;
    readonly correctAnswer: string;
    readonly distractors: readonly string[];
    readonly feedback: string;
  }[];
}

export const QUIZ_GENERATE_TASK_ID = 'quiz.generate.v1';

export class GenerationReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationReplayError';
  }
}

export interface CassetteGenerationProviderDeps {
  readonly cassette: GenerationCassette;
}

export interface GenerationTaskCallResult {
  readonly taskId: string;
  readonly promptVersion: string;
  readonly modelId: string;
  readonly response: GenerationTaskResponse;
}

/** Replays a recorded `POST /v1/task` response for one generative task call. Never calls `fetch`. */
export class CassetteGenerationProvider {
  private readonly cassette: GenerationCassette;

  constructor(deps: CassetteGenerationProviderDeps) {
    this.cassette = deps.cassette;
  }

  async call(taskId: string, payload: unknown): Promise<GenerationTaskCallResult> {
    const payloadHash = await hashGenerationPayload(payload);
    const entry = findGenerationEntryByRequest(this.cassette, { taskId, payloadHash });
    if (entry === undefined) {
      throw new GenerationReplayError(
        `CassetteGenerationProvider: no recording for ${JSON.stringify(taskId)} (payload ${payloadHash}). ` +
          'Run packages/workbench/scripts/precompute-generation.mjs to record this exact call once ' +
          'before replaying it here — a cassette that invented an answer for a request it never saw ' +
          'would be a harness reporting on code that no longer exists.',
      );
    }
    return {
      taskId,
      promptVersion: entry.promptVersion,
      modelId: entry.modelId,
      response: entry.response,
    };
  }
}

export interface GenerateScenarioInput {
  readonly cassette: GenerationCassette;
  readonly courseCode: string;
  readonly conceptName: string;
  /** The upstream `retrieve` stage's result — `sourceChunks` is derived from it, never passed independently, so a refusal here always means an inherited empty context. */
  readonly retrieval: GroundingResult;
  readonly questionCount?: number;
}

export interface GenerateScenarioResult {
  readonly request: QuizGenerateRequestPayload;
  readonly call: GenerationTaskCallResult;
  /** `[]` on any refusal or error — never an invented candidate. */
  readonly candidates: readonly QuizGenerateResponsePayload['questions'][number][];
  readonly trace: PipelineTrace;
}

/** `GroundedChunk[] -> string[]`, or `[]` on a refusal — the one place a refused retrieval becomes an empty generation context. */
function sourceChunksFrom(retrieval: GroundingResult): readonly string[] {
  return retrieval.status === 'grounded' ? retrieval.chunks.map((c) => c.text) : [];
}

/**
 * Runs one `quiz.generate.v1` call, replaying `input.cassette` — never a
 * network call. Records exactly one `'generate'` `StageRecord`
 * (`./trace.js`). `inputSummary`/`outputSummary` carry counts and ids only,
 * never chunk or question text (D-005's "no content" discipline, same as
 * `retrieveScenario`).
 */
export async function generateScenario(
  input: GenerateScenarioInput,
): Promise<GenerateScenarioResult> {
  const sourceChunks = sourceChunksFrom(input.retrieval);
  const request: QuizGenerateRequestPayload = {
    courseCode: input.courseCode,
    conceptName: input.conceptName,
    sourceChunks,
    ...(input.questionCount === undefined ? {} : { questionCount: input.questionCount }),
  };
  const provider = new CassetteGenerationProvider({ cassette: input.cassette });

  const upstreamRefused = input.retrieval.status === 'refused';

  const stage = await recordStageAsync(
    'generate',
    () => provider.call(QUIZ_GENERATE_TASK_ID, request),
    (call) => {
      const candidates =
        call.response.ok && isQuizGenerateResponse(call.response.result)
          ? call.response.result.questions
          : [];
      return {
        status: !call.response.ok ? 'threw' : candidates.length === 0 ? 'empty' : 'ok',
        inputSummary: {
          taskId: call.taskId,
          courseCode: request.courseCode,
          conceptName: request.conceptName,
          sourceChunkCount: sourceChunks.length,
        },
        outputSummary: call.response.ok
          ? {
              ok: true,
              promptVersion: call.promptVersion,
              modelId: call.modelId,
              candidates: candidates.length,
            }
          : { ok: false, code: call.response.code },
        // The load-bearing attribution: an empty context here is always
        // inherited from `retrieve`'s own refusal, never this stage's fault.
        couldHaveSucceeded: !upstreamRefused,
        attributedTo: upstreamRefused ? 'retrieve' : null,
      };
    },
  );

  const candidates =
    stage.result.response.ok && isQuizGenerateResponse(stage.result.response.result)
      ? stage.result.response.result.questions
      : [];

  return { request, call: stage.result, candidates, trace: { stages: [stage.record] } };
}

function isQuizGenerateResponse(value: unknown): value is QuizGenerateResponsePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { questions?: unknown }).questions)
  );
}

export interface AcceptAttribution {
  readonly couldHaveSucceeded: boolean;
  readonly attributedTo: StageId | null;
}

export const ACCEPT_NOT_BLOCKED: AcceptAttribution = {
  couldHaveSucceeded: true,
  attributedTo: null,
};

export interface AcceptScenarioResult {
  readonly accepted: readonly McqFields[];
  readonly rejected: readonly {
    readonly candidate: GeneratedMcqCandidate;
    readonly reason: string;
  }[];
  readonly trace: PipelineTrace;
}

/**
 * INV-6's accept gate, made real. Turns each GENERATED candidate into a
 * vault-ready `McqFields` via `acceptGeneratedMcq` (`../oracle-bridge.js`) —
 * only when THIS function is called. Nothing upstream calls it automatically
 * (see `generateScenario` above, which stops at producing candidates); the
 * only caller in this package is `main.ts`'s click handler on the workbench's
 * "Accept" button, so a trace that contains an `'accept'` `StageRecord` at
 * all is proof the gate was actually passed through, not merely rendered.
 *
 * A candidate whose `feedback` is blank is refused by `acceptGeneratedMcq`
 * itself (throws). This function catches that PER CANDIDATE — one bad
 * candidate in a batch does not silently abort every other one — and reports
 * it under `rejected` rather than dropping it.
 *
 * `attribution` carries forward `generateScenario`'s own
 * `couldHaveSucceeded`/`attributedTo` for the case where `candidates` is
 * empty because an UPSTREAM stage refused (never because nobody has clicked
 * yet — a not-yet-clicked state simply never calls this function at all, so
 * its trace has no `'accept'` record). Defaults to "nothing blocked this."
 */
export function acceptCandidates(
  candidates: readonly GeneratedMcqCandidate[],
  attribution: AcceptAttribution = ACCEPT_NOT_BLOCKED,
): AcceptScenarioResult {
  const stage = recordStage(
    'accept',
    () => {
      const accepted: McqFields[] = [];
      const rejected: { candidate: GeneratedMcqCandidate; reason: string }[] = [];
      for (const candidate of candidates) {
        try {
          accepted.push(acceptGeneratedMcq(candidate));
        } catch (error) {
          rejected.push({
            candidate,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { accepted, rejected };
    },
    (result) => ({
      status:
        candidates.length === 0
          ? attribution.couldHaveSucceeded
            ? 'empty'
            : 'abstained'
          : result.rejected.length > 0
            ? 'abstained'
            : 'ok',
      inputSummary: { candidates: candidates.length },
      outputSummary: { accepted: result.accepted.length, rejected: result.rejected.length },
      couldHaveSucceeded: candidates.length === 0 ? attribution.couldHaveSucceeded : true,
      attributedTo: candidates.length === 0 ? attribution.attributedTo : null,
    }),
  );

  return {
    accepted: stage.result.accepted,
    rejected: stage.result.rejected,
    trace: { stages: [stage.record] },
  };
}

export type { StageRecord };
