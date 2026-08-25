/**
 * `WorkerCorpusRelationVerdict` — the production `CorpusRelationVerdictPort`
 * (`[D-082]`, component register row 1.2a, `[EXT-5]` `ol-2zfj.7`, `[EXT-11]`
 * `ol-kw4a`, `[D-118]`).
 *
 * `packages/core/src/concept/corpus-relations/verdict.ts` defines the port;
 * until this file existed, nothing implemented it outside the module's own
 * spec suite — `[EXT-5]` shipped the corpus-level relation stage with no
 * production caller for exactly this reason, closed as the D-072 escape
 * hatch and handed to this bead. This class turns a `CorpusVerdictRequest`
 * into `concepts.relations.v1`'s frozen envelope, sends it through an
 * injected `WorkerTaskTransport`, and turns the response back into a
 * `CorpusVerdictResponse` — the same seam `WorkerConceptReader`
 * (`./workerConceptReader.ts`) already uses for `concepts.extract.v1`.
 *
 * **Why the wire request drops `anchor` entirely.** `CorpusVerdictRequest`
 * carries a full `CorpusConcept` (name, aliases, `anchor: Provenance`) per
 * endpoint, because the core-side port abstraction needs the anchor to
 * reconcile a verdict back into a `ConceptRelation` afterwards
 * (`reconcileCorpusVerdicts`, called by `./corpusRelationCaller.ts`, not by
 * this class). `Provenance.sourcePath` is a real vault path — exactly the
 * identifier D-005 keeps out of a transient model call — so this adapter
 * sends only `name`, `aliases` and the endpoint's `passageText` over the
 * wire, and never `anchor`. Nothing about reconciliation needs the anchor to
 * have crossed the wire: the port's own caller still holds the original
 * `CorpusVerdictRequestCandidate` objects (anchors included) after this
 * class returns, because `verdict()` only ever receives a response body back
 * from the Worker, never round-trips the request through it.
 *
 * **Why no index resolution is needed here, unlike `WorkerConceptReader`.**
 * `concepts.extract.v1` cites a concept back by passage index because the
 * model is inventing NEW concepts the client has never named. Here the two
 * endpoints are named up front, in the request, by the client — the model
 * only ever confirms or abstains on a pair it was handed — so the response
 * names endpoints back by their own verbatim `name`, and
 * `reconcileCorpusVerdicts` (core) is what checks a returned name resolves
 * against the candidates actually sent. This class does the minimum
 * boundary-crossing job: parse the wire shape into `CorpusVerdict[]`, throw
 * loudly on anything malformed, and let the core-side reconciliation do the
 * grounding it already owns.
 *
 * **Why the task id and contract version are local constants** — same
 * reasoning as `workerConceptReader.ts`'s own note: `olea-contracts`' `main`
 * points at TypeScript source, so a value import would make this module
 * unloadable from a plain Node process running `packages/core` or
 * `packages/plugin`'s built output. `workerCorpusRelationVerdict.spec.ts`
 * asserts both constants equal the frozen catalogue's.
 */

import type {
  CorpusRelationVerdictPort,
  CorpusVerdict,
  CorpusVerdictRequest,
  CorpusVerdictResponse,
  RelationType,
  WorkerTaskTransport,
} from 'olea-core';

/** `TASK_IDS.CONCEPTS_RELATIONS`, mirrored — see the module doc. Pinned by `workerCorpusRelationVerdict.spec.ts`. */
export const CONCEPTS_RELATIONS_TASK_ID = 'concepts.relations.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms and pinned by the same test. */
export const CONCEPTS_RELATIONS_CONTRACT_VERSION = 1;

/** The two types this stage may emit — mirrors `CORPUS_STAGE_EMITTABLE_TYPES` (`olea-core`) without importing a `Set` across the wire boundary. */
const CORPUS_ELIGIBLE_WIRE_TYPES: ReadonlySet<string> = new Set(['prerequisite', 'contrasts-with']);

/**
 * Anything that went wrong reaching the Worker or reading its reply — a
 * malformed body, an unrecognised type, a refusal code. There is no
 * `*UnavailableError` split here the way `WorkerConceptReader` has: nothing
 * in this stage's caller (`./corpusRelationCaller.ts`) treats "the Worker
 * refused" as a distinct case from "the Worker is unreachable" — both mean
 * the batch produced no verdicts this run, and the caller already tolerates
 * that (see its own module doc).
 */
export class WorkerCorpusRelationVerdictError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerCorpusRelationVerdictError';
    this.code = code;
  }
}

export interface WorkerCorpusRelationVerdictDeps {
  readonly transport: WorkerTaskTransport;
}

interface WireEndpoint {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly sourceChunks: readonly string[];
}

interface WireCandidate {
  readonly a: WireEndpoint;
  readonly b: WireEndpoint;
}

function toWireEndpoint(endpoint: CorpusVerdictRequest['candidates'][number]['a']): WireEndpoint {
  return {
    name: endpoint.name,
    aliases: [...endpoint.aliases],
    // A single chunk today — `concepts.relations.v1`'s request schema takes
    // an array (mirroring every other generative task's `sourceChunks`) so
    // the service's `hasGroundableContent`/`renderSourceContext` machinery
    // applies unchanged; there is exactly one passage per endpoint on this
    // side of the port.
    sourceChunks: [endpoint.passageText],
  };
}

export class WorkerCorpusRelationVerdict implements CorpusRelationVerdictPort {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: WorkerCorpusRelationVerdictDeps) {
    this.transport = deps.transport;
  }

  async verdict(request: CorpusVerdictRequest): Promise<CorpusVerdictResponse> {
    // Mirrors `WorkerConceptReader.read`'s own INV-5 refusal-by-construction:
    // `runCorpusRelationBatch` never calls a port with an empty batch, but
    // this class does not assume every caller upholds that.
    if (request.candidates.length === 0) {
      return { verdicts: [] };
    }

    const wireCandidates: readonly WireCandidate[] = request.candidates.map((candidate) => ({
      a: toWireEndpoint(candidate.a),
      b: toWireEndpoint(candidate.b),
    }));

    let body: unknown;
    try {
      body = await this.transport.send({
        contractVersion: CONCEPTS_RELATIONS_CONTRACT_VERSION,
        taskId: CONCEPTS_RELATIONS_TASK_ID,
        payload: { candidates: wireCandidates },
      });
    } catch (error) {
      throw new WorkerCorpusRelationVerdictError(
        `WorkerCorpusRelationVerdict: the transport failed before any response arrived: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const response = readResponseBody(body);
    return { verdicts: readVerdicts(response) };
  }
}

function readResponseBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerCorpusRelationVerdictError(
      'WorkerCorpusRelationVerdict: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response['ok'] === false) {
    const code = typeof response['code'] === 'string' ? response['code'] : undefined;
    const message =
      typeof response['message'] === 'string' ? response['message'] : 'no message supplied';
    throw new WorkerCorpusRelationVerdictError(
      `WorkerCorpusRelationVerdict: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response['ok'] !== true) {
    throw new WorkerCorpusRelationVerdictError(
      'WorkerCorpusRelationVerdict: the Worker response carried no `ok` discriminant.',
    );
  }

  return response;
}

function readResult(response: Record<string, unknown>): Record<string, unknown> {
  const result = response['result'];
  return typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {};
}

function readVerdicts(response: Record<string, unknown>): readonly CorpusVerdict[] {
  const rawVerdicts = readResult(response)['verdicts'];
  if (rawVerdicts === undefined) return [];
  if (!Array.isArray(rawVerdicts)) {
    throw new WorkerCorpusRelationVerdictError(
      'WorkerCorpusRelationVerdict: the Worker response carried a `result.verdicts` that was not an array.',
    );
  }
  return rawVerdicts.map((raw, index) => toCorpusVerdict(raw, index));
}

function toCorpusVerdict(raw: unknown, index: number): CorpusVerdict {
  const entry = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

  const a = entry['a'];
  const b = entry['b'];
  if (typeof a !== 'string' || a.length === 0) {
    throw new WorkerCorpusRelationVerdictError(
      `WorkerCorpusRelationVerdict: verdict ${index} carried no endpoint "a" name.`,
    );
  }
  if (typeof b !== 'string' || b.length === 0) {
    throw new WorkerCorpusRelationVerdictError(
      `WorkerCorpusRelationVerdict: verdict ${index} carried no endpoint "b" name.`,
    );
  }

  const type = entry['type'];
  if (typeof type !== 'string' || !CORPUS_ELIGIBLE_WIRE_TYPES.has(type)) {
    // Belt and braces, same posture as `workerConceptReader.ts`'s relation
    // type check: `conceptsRelationsVerdict`'s zod schema (olea-service)
    // already restricts `type` to the two corpus-eligible values, so
    // reaching here means that check did not run.
    throw new WorkerCorpusRelationVerdictError(
      `WorkerCorpusRelationVerdict: verdict ${index} carried an unrecognised type (${String(type)}).`,
    );
  }

  const directionRaw = entry['direction'];
  let direction: 'a-to-b' | 'b-to-a' | undefined;
  if (directionRaw !== undefined) {
    if (directionRaw !== 'a-to-b' && directionRaw !== 'b-to-a') {
      throw new WorkerCorpusRelationVerdictError(
        `WorkerCorpusRelationVerdict: verdict ${index} carried an unrecognised direction (${String(directionRaw)}).`,
      );
    }
    direction = directionRaw;
  }

  const confidence = entry['confidence'];
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    throw new WorkerCorpusRelationVerdictError(
      `WorkerCorpusRelationVerdict: verdict ${index} carried no numeric confidence.`,
    );
  }

  return {
    a,
    b,
    type: type as RelationType,
    ...(direction !== undefined ? { direction } : {}),
    confidence,
  };
}
