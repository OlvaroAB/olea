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
 *
 * **`key` rides the wire the other direction from `anchor` -- `ol-l40p`
 * [REL-9].** `CorpusConcept.key` (new, optional) is safe to send precisely
 * because it is NOT `anchor`/`sourcePath`: `ConceptRecord.key`'s own doc
 * (olea-core) calls it "opaque, immutable, never displayed to her", so it
 * carries no D-005 exposure the way a vault path would. `toWireEndpoint`
 * below sends it when present; `toCorpusVerdict` reads the service's
 * `aKey`/`bKey` echo back off the response. No vendored schema in
 * `packages/contracts` needed a change for this: the envelope's `payload`
 * is `z.unknown()` (`worker.ts`) and this repo hand-parses the per-task
 * response body itself, exactly as it already did for `direction`/
 * `confidence` above.
 *
 * **Sends the endpoint-dictionary shape, not the legacy inline one --
 * `ol-2zfj.108` [NEW-24], ONT-R2/ONT-R3.** `concepts.relations.v1`'s request
 * schema (`olea-service`'s `src/tasks/conceptsRelations.ts`) accepts either
 * shape at the boundary, but this class -- the one production sender -- only
 * ever builds the dictionary. Every endpoint travels the wire once, keyed by
 * its own `name` (the flat, post-corroboration identity
 * `nominateCorpusRelationCandidates` and `groundCorpusVerdicts` already treat
 * as unique within one batch), and each candidate pair carries the two names
 * as references into that dictionary rather than the two endpoints repeated
 * in full. This is the exact saving ONT-R2/ONT-R3 asked for: a "hub" concept
 * nominated against many others under the declared cap rides the wire once
 * instead of once per pair. There is no flag and no fallback -- the inline
 * shape is simply never built here.
 */

import type {
  CorpusRelationVerdictPort,
  CorpusVerdict,
  CorpusVerdictBatchFailure,
  CorpusVerdictRequest,
  CorpusVerdictResponse,
  RelationType,
  WorkerTaskTransport,
} from 'olea-core';
import {
  type SourceChunkOrigins,
  type SourceOriginFrontmatterHost,
  sourceChunkOriginsFragment,
} from '../source-origin.js';

/** `TASK_IDS.CONCEPTS_RELATIONS`, mirrored — see the module doc. Pinned by `workerCorpusRelationVerdict.spec.ts`. */
export const CONCEPTS_RELATIONS_TASK_ID = 'concepts.relations.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms and pinned by the same test. */
export const CONCEPTS_RELATIONS_CONTRACT_VERSION = 2;

/**
 * The types this stage may emit — mirrors `CORPUS_STAGE_EMITTABLE_TYPES` (`olea-core`) without importing a `Set` across the wire boundary.
 *
 * **`causes` joined in `ol-egov.141.89.4.23` (`[D-296]`).** Left out of this list, a service that
 * offers `causes` (`concepts.relations` prompt 1.3.0) would make `toCorpusVerdict` throw on the
 * first causes verdict and lose the WHOLE batch — every prerequisite and contrasts-with verdict in
 * the same response included. This list and the service's response enum must move together.
 */
const CORPUS_ELIGIBLE_WIRE_TYPES: ReadonlySet<string> = new Set([
  'prerequisite',
  'contrasts-with',
  'causes',
]);

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

/**
 * The declared ceiling on one `concepts.relations.v1` request payload, in UTF-8 bytes of the
 * serialized `{ endpoints, candidates }` body (`ol-egov.141.89.3.61`). This transport budget is
 * independent of the expanded-prompt budget below: dictionary entries travel once, but the
 * service repeats both endpoints for every pair. Retained alongside the model input bound.
 */
export const CORPUS_RELATION_REQUEST_CEILING_BYTES = 128_000;

/**
 * Mirrors `olea-service/src/tasks/conceptsRelations.ts`'s
 * `CORPUS_RELATIONS_PROMPT_CEILING_BYTES` (`ol-egov.141.89.3.62`):
 * floor(0.75 * (256,000 context tokens - 28,672 output tokens)) * 3 bytes/token = 511,488.
 * This constant MUST change with the service's model/window/output ceiling. No runtime service
 * dependency: the client budgets system plus user UTF-8 bytes before sending a request.
 */
export const CORPUS_RELATIONS_PROMPT_CEILING_BYTES = 511_488;

/**
 * Bounds checked against the two service files above and
 * `olea-service/prompts/concepts.relations/system.prompt.md` on 2026-10-26. The system text is
 * 9,542 UTF-8 bytes; the fixed user instructions fit in 2,048. Keep these bounds in sync with
 * those texts. Passage rendering is delegated by the service: reserve 512 bytes per possible
 * rendered passage for numbering, separators, spoken-source roles, all three uncertainty flags,
 * and empty/stub notices. Flagged claims can split one source chunk into at most 2N + 1 passages
 * (N claims and N + 1 intervening spans). Text itself is counted in full, never truncated.
 */
const RELATIONS_SYSTEM_PROMPT_BUDGET_BYTES = 16_384;
const RELATIONS_USER_INSTRUCTIONS_BUDGET_BYTES = 2_048;
const RELATIONS_SOURCE_WRAPPER_BUDGET_BYTES = 512;
const RELATIONS_FIXED_PROMPT_BUDGET_BYTES =
  RELATIONS_SYSTEM_PROMPT_BUDGET_BYTES + RELATIONS_USER_INSTRUCTIONS_BUDGET_BYTES;

const utf8 = new TextEncoder();

function jsonBytes(value: unknown): number {
  return utf8.encode(JSON.stringify(value)).length;
}

type VerdictCandidate = CorpusVerdictRequest['candidates'][number];

/** Includes the inter-pair separator, even for the last pair (a two-byte overestimate). */
function pairPromptWrapperBytes(pairNumber: number): number {
  return utf8.encode(`Pair ${pairNumber}:\n\n\n\n\n`).length;
}

function endpointPromptBytes(endpoint: WireEndpoint): number {
  const aliases =
    endpoint.aliases.length > 0 ? ` (also known as: ${endpoint.aliases.join(', ')})` : '';
  // Labels a and b have identical byte lengths. These are formatEndpoint's exact wrappers.
  const heading = `Concept a: "${endpoint.name}"${aliases}\nSource material for a:\n`;
  return (
    utf8.encode(heading).length +
    endpoint.sourceChunks.reduce((sum, text, index) => {
      const claims = endpoint.sourceChunkOrigins?.[index]?.flaggedClaims?.length ?? 0;
      // Also covers replacement characters if a UTF-16 claim boundary splits a surrogate pair.
      return (
        sum +
        utf8.encode(text).length +
        4 * claims +
        (2 * claims + 1) * RELATIONS_SOURCE_WRAPPER_BUDGET_BYTES
      );
    }, 0)
  );
}

/**
 * Splits a call's candidate pairs into request batches whose serialized payload stays under
 * `ceilingBytes` AND whose expanded prompt estimate stays under
 * `CORPUS_RELATIONS_PROMPT_CEILING_BYTES`, each pair whole. Pairs are grouped by their endpoints'
 * documents (first endpoint, then second); ties keep the nominated order. Dictionary entries
 * count once toward the payload but once PER PAIR toward the prompt. An empty input gives no
 * batches. A pair larger than either ceiling is isolated; a prompt-oversized singleton becomes
 * a local batch failure in `verdict`, without being sent or truncating its passages.
 */
export function planCorpusRelationBatches(
  candidates: readonly VerdictCandidate[],
  frontmatterHost: SourceOriginFrontmatterHost | undefined,
  ceilingBytes: number = CORPUS_RELATION_REQUEST_CEILING_BYTES,
): VerdictCandidate[][] {
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (x, y) =>
        compareText(x.candidate.a.anchor.sourcePath, y.candidate.a.anchor.sourcePath) ||
        compareText(x.candidate.b.anchor.sourcePath, y.candidate.b.anchor.sourcePath) ||
        x.index - y.index,
    )
    .map(({ candidate }) => candidate);

  const emptyBytes = jsonBytes({ endpoints: {}, candidates: [] });
  interface EndpointBytes {
    readonly payload: number;
    readonly prompt: number;
  }
  /** Resolve reused names to their FIRST dictionary entry, just like buildDictionaryPayload. */
  const costOf = (
    candidate: VerdictCandidate,
    present: ReadonlyMap<string, EndpointBytes>,
    pairNumber: number,
  ) => {
    const fresh = new Map<string, EndpointBytes>();
    const sizeOf = (endpoint: VerdictCandidate['a']): EndpointBytes => {
      const known = present.get(endpoint.name) ?? fresh.get(endpoint.name);
      if (known !== undefined) return known;
      const wire = toWireEndpoint(endpoint, frontmatterHost);
      const size = {
        payload: jsonBytes(wire) + jsonBytes(endpoint.name) + 1,
        prompt: endpointPromptBytes(wire),
      };
      fresh.set(endpoint.name, size);
      return size;
    };
    const a = sizeOf(candidate.a);
    const b = sizeOf(candidate.b);
    return {
      fresh,
      payload:
        [...fresh.values()].reduce((sum, size) => sum + size.payload, 0) +
        jsonBytes({ a: candidate.a.name, b: candidate.b.name }) +
        1,
      prompt: pairPromptWrapperBytes(pairNumber) + a.prompt + b.prompt,
    };
  };

  const batches: VerdictCandidate[][] = [];
  let current: VerdictCandidate[] = [];
  let present = new Map<string, EndpointBytes>();
  let bytes = emptyBytes;
  let promptBytes = RELATIONS_FIXED_PROMPT_BUDGET_BYTES;
  for (const candidate of ordered) {
    let cost = costOf(candidate, present, current.length + 1);
    if (
      current.length > 0 &&
      (bytes + cost.payload > ceilingBytes ||
        promptBytes + cost.prompt > CORPUS_RELATIONS_PROMPT_CEILING_BYTES)
    ) {
      batches.push(current);
      current = [];
      present = new Map();
      bytes = emptyBytes;
      promptBytes = RELATIONS_FIXED_PROMPT_BUDGET_BYTES;
      cost = costOf(candidate, present, 1);
    }
    bytes += cost.payload;
    promptBytes += cost.prompt;
    current.push(candidate);
    for (const [name, size] of cost.fresh) present.set(name, size);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function compareText(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The serialized size of the payload one batch would send, for measurement and tests. */
export function corpusRelationPayloadBytes(
  candidates: readonly VerdictCandidate[],
  frontmatterHost?: SourceOriginFrontmatterHost,
): number {
  const { endpoints, candidates: wire } = buildDictionaryPayload(candidates, frontmatterHost);
  return jsonBytes({ endpoints, candidates: wire });
}

/**
 * Upper bound on the service's expanded system + user prompt, for preflight and tests. Resolve
 * names as the dictionary does, then repeat BOTH endpoint sizes per pair, including aliases,
 * passages, annotations and decimal pair numbers. Opaque keys are not rendered by the service.
 */
export function corpusRelationPromptBytes(
  candidates: readonly VerdictCandidate[],
  frontmatterHost?: SourceOriginFrontmatterHost,
): number {
  const endpoints = new Map<string, number>();
  const sizeOf = (endpoint: VerdictCandidate['a']): number => {
    const known = endpoints.get(endpoint.name);
    if (known !== undefined) return known;
    const bytes = endpointPromptBytes(toWireEndpoint(endpoint, frontmatterHost));
    endpoints.set(endpoint.name, bytes);
    return bytes;
  };
  return candidates.reduce(
    (sum, candidate, index) =>
      sum + pairPromptWrapperBytes(index + 1) + sizeOf(candidate.a) + sizeOf(candidate.b),
    RELATIONS_FIXED_PROMPT_BUDGET_BYTES,
  );
}

export interface WorkerCorpusRelationVerdictDeps {
  readonly transport: WorkerTaskTransport;
  /** `ol-egov.141.89.8.56`: lets a `.md` that declares a transcript role be recognised. Optional. */
  readonly frontmatterHost?: SourceOriginFrontmatterHost;
  /** Overrides `CORPUS_RELATION_REQUEST_CEILING_BYTES`; tests only. */
  readonly requestCeilingBytes?: number;
}

interface WireEndpoint {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly sourceChunks: readonly string[];
  /** `ol-egov.141.89.8.56` (D-465): aligned with `sourceChunks`; present only when the endpoint's passage is a supplied transcript. */
  readonly sourceChunkOrigins?: SourceChunkOrigins;
  /**
   * The candidate's own `CorpusConcept.key`, when the caller that built the
   * `CorpusVerdictRequest` supplied one -- `ol-l40p` [REL-9]. Mirrors the
   * module doc's `anchor`/`sourcePath` exclusion in spirit but is the
   * opposite call: a key is NOT a vault path or any other D-005 identifier
   * (`ConceptRecord.key`'s own doc, olea-core: "opaque, immutable, never
   * displayed to her"), so unlike `anchor` it is safe and intended to travel
   * on the wire. `toWireEndpoint` below sends `key` ALONE for this purpose --
   * never `anchor`, never a `sourcePath` -- exactly the same restraint the
   * module doc already states for the other, unsafe field.
   */
  readonly key?: string;
}

/** One candidate pair as sent on the wire -- two references into `WireEndpointDictionary`, never the endpoints themselves. */
interface WireCandidatePair {
  readonly a: string;
  readonly b: string;
}

/** Keyed by each endpoint's own `name` -- see the module doc's "Sends the endpoint-dictionary shape" note. */
type WireEndpointDictionary = Readonly<Record<string, WireEndpoint>>;

function toWireEndpoint(
  endpoint: CorpusVerdictRequest['candidates'][number]['a'],
  frontmatterHost: SourceOriginFrontmatterHost | undefined,
): WireEndpoint {
  return {
    name: endpoint.name,
    aliases: [...endpoint.aliases],
    // A single chunk today — `concepts.relations.v1`'s request schema takes
    // an array (mirroring every other generative task's `sourceChunks`) so
    // the service's `hasGroundableContent`/`renderSourceContext` machinery
    // applies unchanged; there is exactly one passage per endpoint on this
    // side of the port.
    sourceChunks: [endpoint.passageText],
    // `ol-egov.141.89.8.56`: the origin of that one passage, from the endpoint's own anchor path.
    ...sourceChunkOriginsFragment(
      [{ path: endpoint.anchor.sourcePath, text: endpoint.passageText }],
      frontmatterHost,
    ),
    // `ol-l40p` [REL-9]: `key` only -- never `endpoint.anchor` and never a
    // vault path, per this file's module doc and `WireEndpoint.key`'s own
    // doc. Omitted entirely (never `key: undefined`) when the candidate has
    // none, matching the request schema's own optional field.
    ...(endpoint.key !== undefined ? { key: endpoint.key } : {}),
  };
}

/**
 * Builds the dictionary payload for one batch -- every distinct endpoint
 * (by `name`) once, and each candidate pair as a reference into it. A "hub"
 * endpoint reused across several candidates (the same `CorpusConcept`
 * object, resolved by `nominateCorpusRelationCandidates`, olea-core) is
 * written into `endpoints` on its first sighting only; later sightings only
 * add another `WireCandidatePair` entry, which is the whole saving.
 */
function buildDictionaryPayload(
  candidates: CorpusVerdictRequest['candidates'],
  frontmatterHost: SourceOriginFrontmatterHost | undefined,
): {
  endpoints: WireEndpointDictionary;
  candidates: readonly WireCandidatePair[];
} {
  const endpoints: Record<string, WireEndpoint> = {};
  for (const candidate of candidates) {
    if (!(candidate.a.name in endpoints))
      endpoints[candidate.a.name] = toWireEndpoint(candidate.a, frontmatterHost);
    if (!(candidate.b.name in endpoints))
      endpoints[candidate.b.name] = toWireEndpoint(candidate.b, frontmatterHost);
  }
  return {
    endpoints,
    candidates: candidates.map((candidate) => ({ a: candidate.a.name, b: candidate.b.name })),
  };
}

export class WorkerCorpusRelationVerdict implements CorpusRelationVerdictPort {
  private readonly transport: WorkerTaskTransport;
  private readonly frontmatterHost: SourceOriginFrontmatterHost | undefined;
  private readonly ceilingBytes: number;

  constructor(deps: WorkerCorpusRelationVerdictDeps) {
    this.transport = deps.transport;
    this.frontmatterHost = deps.frontmatterHost;
    this.ceilingBytes = deps.requestCeilingBytes ?? CORPUS_RELATION_REQUEST_CEILING_BYTES;
  }

  /**
   * `ol-egov.141.89.3.61`: the call is split into request batches under the declared ceiling
   * (`planCorpusRelationBatches`), sent one after another, each failing on its own. A batch that
   * fails is recorded in `failedBatches` and the others' verdicts are kept. A pair whose prompt
   * cannot fit alone uses that same failure path locally, before transport. When EVERY batch
   * fails (always the case for a one-batch call) the first error is thrown, as before.
   */
  async verdict(request: CorpusVerdictRequest): Promise<CorpusVerdictResponse> {
    // Mirrors `WorkerConceptReader.read`'s own INV-5 refusal-by-construction:
    // `runCorpusRelationBatch` never calls a port with an empty batch, but
    // this class does not assume every caller upholds that.
    if (request.candidates.length === 0) {
      return { verdicts: [] };
    }

    const batches = planCorpusRelationBatches(
      request.candidates,
      this.frontmatterHost,
      this.ceilingBytes,
    );
    const verdicts: CorpusVerdict[] = [];
    const failedBatches: CorpusVerdictBatchFailure[] = [];
    let firstError: WorkerCorpusRelationVerdictError | undefined;
    for (const batch of batches) {
      try {
        const promptBytes = corpusRelationPromptBytes(batch, this.frontmatterHost);
        if (promptBytes > CORPUS_RELATIONS_PROMPT_CEILING_BYTES) {
          throw new WorkerCorpusRelationVerdictError(
            `WorkerCorpusRelationVerdict: a single pair's estimated prompt is ${promptBytes} ` +
              `bytes, over the ${CORPUS_RELATIONS_PROMPT_CEILING_BYTES}-byte ceiling.`,
            'prompt-too-large',
          );
        }
        verdicts.push(...(await this.sendBatch(batch)));
      } catch (error) {
        const wrapped =
          error instanceof WorkerCorpusRelationVerdictError
            ? error
            : new WorkerCorpusRelationVerdictError(
                `WorkerCorpusRelationVerdict: a batch failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
        firstError ??= wrapped;
        failedBatches.push({ candidates: batch.length, reason: wrapped.code ?? wrapped.name });
      }
    }
    if (failedBatches.length === batches.length && firstError !== undefined) throw firstError;
    return {
      verdicts,
      batchesSent: batches.length,
      ...(failedBatches.length > 0 ? { failedBatches } : {}),
    };
  }

  private async sendBatch(
    candidates: readonly VerdictCandidate[],
  ): Promise<readonly CorpusVerdict[]> {
    const { endpoints, candidates: wireCandidates } = buildDictionaryPayload(
      candidates,
      this.frontmatterHost,
    );

    let body: unknown;
    try {
      body = await this.transport.send({
        contractVersion: CONCEPTS_RELATIONS_CONTRACT_VERSION,
        taskId: CONCEPTS_RELATIONS_TASK_ID,
        payload: { endpoints, candidates: wireCandidates },
      });
    } catch (error) {
      throw new WorkerCorpusRelationVerdictError(
        `WorkerCorpusRelationVerdict: the transport failed before any response arrived: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const response = readResponseBody(body);
    return readVerdicts(response);
  }
}

function readResponseBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerCorpusRelationVerdictError(
      'WorkerCorpusRelationVerdict: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response.ok === false) {
    const code = typeof response.code === 'string' ? response.code : undefined;
    const message = typeof response.message === 'string' ? response.message : 'no message supplied';
    throw new WorkerCorpusRelationVerdictError(
      `WorkerCorpusRelationVerdict: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response.ok !== true) {
    throw new WorkerCorpusRelationVerdictError(
      'WorkerCorpusRelationVerdict: the Worker response carried no `ok` discriminant.',
    );
  }

  return response;
}

function readResult(response: Record<string, unknown>): Record<string, unknown> {
  const result = response.result;
  return typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {};
}

function readVerdicts(response: Record<string, unknown>): readonly CorpusVerdict[] {
  const rawVerdicts = readResult(response).verdicts;
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

  const a = entry.a;
  const b = entry.b;
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

  const type = entry.type;
  if (typeof type !== 'string' || !CORPUS_ELIGIBLE_WIRE_TYPES.has(type)) {
    // Belt and braces, same posture as `workerConceptReader.ts`'s relation
    // type check: `conceptsRelationsVerdict`'s zod schema (olea-service)
    // already restricts `type` to the two corpus-eligible values, so
    // reaching here means that check did not run.
    throw new WorkerCorpusRelationVerdictError(
      `WorkerCorpusRelationVerdict: verdict ${index} carried an unrecognised type (${String(type)}).`,
    );
  }

  const directionRaw = entry.direction;
  let direction: 'a-to-b' | 'b-to-a' | undefined;
  if (directionRaw !== undefined) {
    if (directionRaw !== 'a-to-b' && directionRaw !== 'b-to-a') {
      throw new WorkerCorpusRelationVerdictError(
        `WorkerCorpusRelationVerdict: verdict ${index} carried an unrecognised direction (${String(directionRaw)}).`,
      );
    }
    direction = directionRaw;
  }

  const confidence = entry.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    throw new WorkerCorpusRelationVerdictError(
      `WorkerCorpusRelationVerdict: verdict ${index} carried no numeric confidence.`,
    );
  }

  // `ol-l40p` [REL-9]: optional, resolved server-side from the SAME
  // candidate whose name/aliases were sent (`CorpusVerdict.aKey`'s own doc,
  // olea-core) -- never invented by the model, so absence is the ordinary
  // case whenever the request's matching endpoint carried no `key` at all.
  // A PRESENT-but-malformed value (not a non-empty string) is a defect in
  // the Worker's own response, same posture as every other field here.
  const aKeyRaw = entry.aKey;
  let aKey: string | undefined;
  if (aKeyRaw !== undefined) {
    if (typeof aKeyRaw !== 'string' || aKeyRaw.length === 0) {
      throw new WorkerCorpusRelationVerdictError(
        `WorkerCorpusRelationVerdict: verdict ${index} carried a non-string or empty aKey.`,
      );
    }
    aKey = aKeyRaw;
  }

  const bKeyRaw = entry.bKey;
  let bKey: string | undefined;
  if (bKeyRaw !== undefined) {
    if (typeof bKeyRaw !== 'string' || bKeyRaw.length === 0) {
      throw new WorkerCorpusRelationVerdictError(
        `WorkerCorpusRelationVerdict: verdict ${index} carried a non-string or empty bKey.`,
      );
    }
    bKey = bKeyRaw;
  }

  return {
    a,
    b,
    type: type as RelationType,
    ...(direction !== undefined ? { direction } : {}),
    confidence,
    ...(aKey !== undefined ? { aKey } : {}),
    ...(bKey !== undefined ? { bKey } : {}),
  };
}
