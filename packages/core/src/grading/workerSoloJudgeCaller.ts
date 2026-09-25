/**
 * `createWorkerSoloJudgeCaller` — the production `SoloJudgeCaller` for
 * `explain-back.solo.v1` (`ol-95vv.2` [MAT-5]), mirroring
 * `./workerJudgeCaller.ts`'s `createWorkerJudgeCaller` exactly: builds the
 * envelope, sends it through an injected `WorkerTaskTransport`, and turns
 * whatever comes back into the `ExplainBackSoloWireResponse` shape
 * `gradeSolo` expects. No network call of its own outside the injected
 * transport, no state, no retry — those live at the transport/composition
 * layer (see `./workerJudgeCaller.ts`'s own module doc for the fuller
 * argument, which applies here unchanged).
 *
 * **Grounding is deliberately not done here**, for the identical reason
 * `createWorkerJudgeCaller` gives: `gradeSolo` (`./explainBackSolo.ts`) runs
 * `groundSoloResponse` on whatever this class returns before anything
 * downstream ever sees a citation or a neighbour-use claim. This class's job
 * is to marshal the request and response *faithfully*.
 *
 * **The task id and contract version are local constants, not imported**,
 * same reasoning `workerJudgeCaller.ts`/`workerProvider.ts` give:
 * `olea-contracts`'s `main` points at TypeScript source, so importing its
 * values here would make this module unloadable from a plain Node process
 * running `packages/core/dist`. `workerSoloJudgeCaller.spec.ts` asserts both
 * constants equal the frozen catalogue's.
 *
 * **Never logs (D-005).** `rationale` is what the model said about her
 * answer's structure — content, never logged. This module has no logging
 * call anywhere in it.
 *
 * **This is a real, callable production port, not a test fake** — it reaches
 * the actual `WorkerTaskTransport` seam retrieval and `createWorkerJudgeCaller`
 * already use. What is NOT built by this bead is the composition-root wiring
 * that hands a real `WorkerSoloJudgeCaller` to `gradeSolo` from
 * `OleaPlugin`'s onload (`packages/plugin/src/main.ts`) — that file is out of
 * this bead's ownership; see `explainBackSolo.ts`'s module header for the
 * named seam.
 *
 * ===========================================================================
 * THE D7.3 STAMP (`ol-egov.141.89.38`)
 * ===========================================================================
 * Same reasoning `./workerJudgeCaller.ts` gives, restated for this seam: the
 * Worker's response body carries `stamp.promptVersion`/`stamp.modelId`
 * alongside `result`, and `SoloJudgeCaller`'s declared return type
 * (`explainBackSolo.ts`, owned by a sibling bead) has no `stamp` field yet —
 * so `readSoloGrading` returns `StampedExplainBackSoloWireResponse`, a
 * strict superset. `createWorkerSoloJudgeCaller` is typed to return
 * `StampedSoloJudgeCaller` (declared below, not the imported `SoloJudgeCaller`
 * itself) so this factory's own callers see `.stamp` on the result — a
 * `StampedSoloJudgeCaller` value is still usable wherever a bare
 * `SoloJudgeCaller` is required, since function return types are covariant
 * and the stamped response is a strict superset. `stamp` is `null` exactly
 * when the response carried none — never invented.
 */

import type { WorkerTaskTransport } from '../retrieval/workerProvider.js';
import type { ModelStamp } from '../stage-contract/provenance.js';
import type { ExplainBackSoloWireRequest, ExplainBackSoloWireResponse } from './explainBackSolo.js';

/** `TASK_IDS.EXPLAIN_BACK_SOLO`, mirrored — see the module doc. Pinned to the frozen catalogue by `workerSoloJudgeCaller.spec.ts`. */
export const EXPLAIN_BACK_SOLO_TASK_ID = 'explain-back.solo.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms and pinned by the same test. */
export const EXPLAIN_BACK_SOLO_CONTRACT_VERSION = 2;

/**
 * Anything that went wrong between asking for a SOLO grading and having one.
 * `code` is the Worker's own `ErrorCode` when the failure came back as a
 * well-formed error response, and `undefined` when the response was
 * unusable for some other reason (malformed body, unrecognised level).
 */
export class WorkerSoloJudgeError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerSoloJudgeError';
    this.code = code;
  }
}

export interface WorkerSoloJudgeCallerDeps {
  readonly transport: WorkerTaskTransport;
}

/** `ExplainBackSoloWireResponse` plus the D7.3 stamp this caller reads off the response body — see the module doc's "THE D7.3 STAMP" section. */
export type StampedExplainBackSoloWireResponse = ExplainBackSoloWireResponse & {
  readonly stamp: ModelStamp | null;
};

/**
 * `SoloJudgeCaller` (`explainBackSolo.ts`), narrowed to the concrete
 * response this module actually produces — see the module doc's "THE D7.3
 * STAMP" section for why this is declared here rather than the plain
 * imported `SoloJudgeCaller`.
 */
export type StampedSoloJudgeCaller = (
  input: ExplainBackSoloWireRequest,
) => Promise<StampedExplainBackSoloWireResponse>;

/**
 * Builds the production `SoloJudgeCaller` — a plain function, matching the
 * port `explainBackSolo.ts` declares, rather than a class implementing it,
 * because `SoloJudgeCaller` is itself a function type with no other members
 * to satisfy. Typed `StampedSoloJudgeCaller` here so this factory's own
 * callers see `.stamp` on the result.
 */
export function createWorkerSoloJudgeCaller(
  deps: WorkerSoloJudgeCallerDeps,
): StampedSoloJudgeCaller {
  return async (input: ExplainBackSoloWireRequest): Promise<StampedExplainBackSoloWireResponse> => {
    const body = await deps.transport.send({
      contractVersion: EXPLAIN_BACK_SOLO_CONTRACT_VERSION,
      taskId: EXPLAIN_BACK_SOLO_TASK_ID,
      payload: input,
    });
    return readSoloGrading(body);
  };
}

const SOLO_LEVELS = new Set([
  'prestructural',
  'unistructural',
  'multistructural',
  'relational',
  'extended-abstract',
]);

/**
 * Reads `stamp.promptVersion`/`stamp.modelId` off the Worker's response body
 * — same reading `./workerJudgeCaller.ts`'s `readStamp` does. `null`
 * whenever the response carried no usable stamp; never invented.
 */
function readStamp(response: Record<string, unknown>): ModelStamp | null {
  const stamp = response.stamp;
  if (typeof stamp !== 'object' || stamp === null) return null;
  const s = stamp as Record<string, unknown>;
  const promptVersion = s.promptVersion;
  const modelId = s.modelId;
  if (typeof promptVersion !== 'string' || promptVersion.length === 0) return null;
  if (typeof modelId !== 'string' || modelId.length === 0) return null;
  return { promptVersion, modelId };
}

function readSoloGrading(body: unknown): StampedExplainBackSoloWireResponse {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerSoloJudgeError('WorkerSoloJudgeCaller: the Worker response was not an object.');
  }
  const response = body as Record<string, unknown>;

  if (response.ok === false) {
    const code = typeof response.code === 'string' ? response.code : undefined;
    const message = typeof response.message === 'string' ? response.message : 'no message supplied';
    throw new WorkerSoloJudgeError(
      `WorkerSoloJudgeCaller: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response.ok !== true) {
    throw new WorkerSoloJudgeError(
      'WorkerSoloJudgeCaller: the Worker response carried no `ok` discriminant.',
    );
  }

  const result = response.result;
  if (typeof result !== 'object' || result === null) {
    throw new WorkerSoloJudgeError(
      'WorkerSoloJudgeCaller: the Worker response carried no `result` object.',
    );
  }
  const r = result as Record<string, unknown>;

  const soloLevel = r.soloLevel;
  if (typeof soloLevel !== 'string' || !SOLO_LEVELS.has(soloLevel)) {
    throw new WorkerSoloJudgeError(
      `WorkerSoloJudgeCaller: the Worker returned an unrecognised soloLevel (${JSON.stringify(soloLevel)}).`,
    );
  }
  const rationale = r.rationale;
  if (typeof rationale !== 'string' || rationale.length === 0) {
    throw new WorkerSoloJudgeError(
      'WorkerSoloJudgeCaller: the Worker response carried no rationale text.',
    );
  }

  const citedBlockIds = readStringArray(r.citedBlockIds, 'citedBlockIds');
  const neighbourUseDemonstrated = r.neighbourUseDemonstrated;
  if (neighbourUseDemonstrated !== undefined && typeof neighbourUseDemonstrated !== 'boolean') {
    throw new WorkerSoloJudgeError(
      "WorkerSoloJudgeCaller: 'neighbourUseDemonstrated' was present but not a boolean.",
    );
  }

  return {
    soloLevel: soloLevel as ExplainBackSoloWireResponse['soloLevel'],
    rationale,
    citedBlockIds,
    // `exactOptionalPropertyTypes`: the key is present only when the Worker
    // actually sent one — an explicit `neighbourUseDemonstrated: undefined`
    // is not the same as omitting it (same discipline `workerJudgeCaller.ts`
    // uses for `confusedWith`).
    ...(typeof neighbourUseDemonstrated === 'boolean' ? { neighbourUseDemonstrated } : {}),
    stamp: readStamp(response),
  };
}

/**
 * `undefined`/absent reads as `[]` — an old prompt/model that never
 * populated the field still validates here, mirroring
 * `soloDepthResponse`'s own `.default([])` on the Worker side. A
 * present-but-malformed array is a hard error.
 */
function readStringArray(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new WorkerSoloJudgeError(
      `WorkerSoloJudgeCaller: '${field}' was present but not a string array.`,
    );
  }
  return value as readonly string[];
}
