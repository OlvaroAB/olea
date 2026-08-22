/**
 * `createWorkerJudgeCaller` — the production `JudgeCaller` (`ol-drfy`,
 * closing the seam `P4-T02` declared and left unimplemented — see the
 * wiring register's `JudgeCaller` finding, `olea/docs/dev/wiring-register.md`).
 *
 * Mirrors `../retrieval/workerProvider.ts`'s `WorkerEmbeddingProvider`
 * deliberately: it builds the `explain-back.judge.v1` envelope, sends it
 * through an injected `WorkerTaskTransport`, and turns whatever comes back
 * into the `ExplainBackGradingWireResponse` shape `gradeExplainBack`
 * expects. No network call of its own outside the injected transport, no
 * state, no retry — those live at the transport/composition layer.
 *
 * ===========================================================================
 * GROUNDING IS DELIBERATELY NOT DONE HERE
 * ===========================================================================
 * `olea-service/src/tasks/explainBackJudge.ts` (private repo, cited by path
 * per INV-3) hands grounding to "the caller" because the Worker task cannot
 * verify a `blockId` the model returns actually names one of the blocks it
 * was given — that check needs the caller's own copy of `sourceBlocks`
 * compared against the response. This class is *not* that caller in the
 * sense that matters: `gradeExplainBack` (`gradingPipeline.ts`) is, and it
 * already runs `groundCitations` on whatever this class returns before
 * anything downstream (misconception store, mastery rollup) ever sees a
 * citation. So this class's whole job is to marshal the request and
 * response *faithfully* — validate shape, never pre-filter or invent a
 * citation — because `groundCitations` is the one place that check is
 * supposed to happen, and duplicating it here would only make a future
 * drift between the two invisible.
 *
 * ===========================================================================
 * WHY THE TASK ID AND CONTRACT VERSION ARE LOCAL CONSTANTS
 * ===========================================================================
 * Same reasoning `workerProvider.ts` gives for `RETRIEVAL_EMBED_TASK_ID`:
 * `olea-contracts`' `main` points at TypeScript source, so importing its
 * values here would make this module unloadable from a plain Node process
 * running `packages/core/dist`. `workerJudgeCaller.spec.ts` asserts both
 * constants equal the frozen catalogue's, the same way `workerProvider.spec
 * .ts` does for the embed task.
 *
 * ===========================================================================
 * NEVER LOGS (D-005)
 * ===========================================================================
 * No field of `ExplainBackGradingWireResponse` is content-free — `feedback`,
 * `missedPoints`, every `citedIssues[].description`, every
 * `misconceptionCandidates[].statement`/`.correction` is what she wrote or
 * what the model said about it. This module has no logging call anywhere in
 * it, the same defence `transport.ts`/`config-store.ts` use for the bearer
 * token; `workerJudgeCaller.spec.ts` asserts the source contains none.
 */

import type { WorkerTaskTransport } from '../retrieval/workerProvider.js';
import type {
  CitedIssue,
  CitedIssueKind,
  ExplainBackGradingWireResponse,
  ExplainBackJudgeWireRequest,
  JudgeCaller,
  MisconceptionCandidate,
} from './gradingPipeline.js';

/**
 * `TASK_IDS.EXPLAIN_BACK_JUDGE`, mirrored — see the module doc for why it is
 * not imported. Pinned to the frozen catalogue by `workerJudgeCaller.spec.ts`.
 */
export const EXPLAIN_BACK_JUDGE_TASK_ID = 'explain-back.judge.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms and pinned by the same test. */
export const EXPLAIN_BACK_JUDGE_CONTRACT_VERSION = 1;

/**
 * Anything that went wrong between asking for a grading and having one.
 * `code` is the Worker's own `ErrorCode` when the failure came back as a
 * well-formed error response, and `undefined` when the response was
 * unusable for some other reason (malformed body, unrecognised verdict).
 */
export class WorkerJudgeError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerJudgeError';
    this.code = code;
  }
}

export interface WorkerJudgeCallerDeps {
  readonly transport: WorkerTaskTransport;
}

/**
 * Builds the production `JudgeCaller` — a plain function, matching the port
 * `gradingPipeline.ts` declares, rather than a class implementing it,
 * because `JudgeCaller` is itself a function type with no other members to
 * satisfy.
 */
export function createWorkerJudgeCaller(deps: WorkerJudgeCallerDeps): JudgeCaller {
  return async (input: ExplainBackJudgeWireRequest): Promise<ExplainBackGradingWireResponse> => {
    const body = await deps.transport.send({
      contractVersion: EXPLAIN_BACK_JUDGE_CONTRACT_VERSION,
      taskId: EXPLAIN_BACK_JUDGE_TASK_ID,
      payload: input,
    });
    return readGrading(body);
  };
}

const VERDICTS = new Set(['correct', 'partial', 'incorrect']);
const CITED_ISSUE_KINDS = new Set(['omission', 'error', 'confusion']);

function readGrading(body: unknown): ExplainBackGradingWireResponse {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerJudgeError('WorkerJudgeCaller: the Worker response was not an object.');
  }
  const response = body as Record<string, unknown>;

  if (response['ok'] === false) {
    const code = typeof response['code'] === 'string' ? response['code'] : undefined;
    const message =
      typeof response['message'] === 'string' ? response['message'] : 'no message supplied';
    throw new WorkerJudgeError(
      `WorkerJudgeCaller: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response['ok'] !== true) {
    throw new WorkerJudgeError(
      'WorkerJudgeCaller: the Worker response carried no `ok` discriminant.',
    );
  }

  const result = response['result'];
  if (typeof result !== 'object' || result === null) {
    throw new WorkerJudgeError(
      'WorkerJudgeCaller: the Worker response carried no `result` object.',
    );
  }
  const r = result as Record<string, unknown>;

  const verdict = r['verdict'];
  if (typeof verdict !== 'string' || !VERDICTS.has(verdict)) {
    throw new WorkerJudgeError(
      `WorkerJudgeCaller: the Worker returned an unrecognised verdict (${JSON.stringify(verdict)}).`,
    );
  }
  const feedback = r['feedback'];
  if (typeof feedback !== 'string' || feedback.length === 0) {
    throw new WorkerJudgeError('WorkerJudgeCaller: the Worker response carried no feedback text.');
  }

  return {
    verdict: verdict as ExplainBackGradingWireResponse['verdict'],
    feedback,
    missedPoints: readStringArray(r['missedPoints'], 'missedPoints'),
    citedIssues: readCitedIssues(r['citedIssues']),
    misconceptionCandidates: readMisconceptionCandidates(r['misconceptionCandidates']),
  };
}

/**
 * `undefined`/absent reads as `[]` — an old prompt/model that never
 * populated the field still validates here, mirroring
 * `explainBackJudgeResponse`'s own `.default([])` on the Worker side. A
 * present-but-malformed array is a hard error: something is wrong with the
 * response shape, not with what the model chose to say.
 */
function readStringArray(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new WorkerJudgeError(`WorkerJudgeCaller: '${field}' was present but not a string array.`);
  }
  return value as readonly string[];
}

function readCitedIssues(value: unknown): readonly CitedIssue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new WorkerJudgeError("WorkerJudgeCaller: 'citedIssues' was present but not an array.");
  }
  return value.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new WorkerJudgeError(`WorkerJudgeCaller: citedIssues[${index}] was not an object.`);
    }
    const entry = raw as Record<string, unknown>;
    const kind = entry['kind'];
    if (typeof kind !== 'string' || !CITED_ISSUE_KINDS.has(kind)) {
      throw new WorkerJudgeError(
        `WorkerJudgeCaller: citedIssues[${index}] carried an unrecognised kind.`,
      );
    }
    const description = entry['description'];
    if (typeof description !== 'string' || description.length === 0) {
      throw new WorkerJudgeError(
        `WorkerJudgeCaller: citedIssues[${index}] carried no description.`,
      );
    }
    const sourceBlockIds = readStringArray(
      entry['sourceBlockIds'],
      `citedIssues[${index}].sourceBlockIds`,
    );
    return { kind: kind as CitedIssueKind, description, sourceBlockIds };
  });
}

function readMisconceptionCandidates(value: unknown): readonly MisconceptionCandidate[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new WorkerJudgeError(
      "WorkerJudgeCaller: 'misconceptionCandidates' was present but not an array.",
    );
  }
  return value.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new WorkerJudgeError(
        `WorkerJudgeCaller: misconceptionCandidates[${index}] was not an object.`,
      );
    }
    const entry = raw as Record<string, unknown>;
    const concept = entry['concept'];
    const statement = entry['statement'];
    const correction = entry['correction'];
    if (typeof concept !== 'string' || concept.length === 0) {
      throw new WorkerJudgeError(
        `WorkerJudgeCaller: misconceptionCandidates[${index}] carried no concept.`,
      );
    }
    if (typeof statement !== 'string' || statement.length === 0) {
      throw new WorkerJudgeError(
        `WorkerJudgeCaller: misconceptionCandidates[${index}] carried no statement.`,
      );
    }
    if (typeof correction !== 'string' || correction.length === 0) {
      throw new WorkerJudgeError(
        `WorkerJudgeCaller: misconceptionCandidates[${index}] carried no correction.`,
      );
    }
    const correctionSourceBlockIds = readStringArray(
      entry['correctionSourceBlockIds'],
      `misconceptionCandidates[${index}].correctionSourceBlockIds`,
    );
    const confusedWith = entry['confusedWith'];
    return {
      concept,
      statement,
      correction,
      correctionSourceBlockIds,
      // `exactOptionalPropertyTypes`: the key is present only when there is
      // a real value — an explicit `confusedWith: undefined` is not the same
      // as omitting it (same discipline `gradingPipeline.ts` uses for
      // `sourceExcerpt`).
      ...(typeof confusedWith === 'string' && confusedWith.length > 0 ? { confusedWith } : {}),
    };
  });
}
