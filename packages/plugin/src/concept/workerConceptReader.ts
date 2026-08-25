/**
 * `WorkerConceptReader` — the production `ConceptReaderPort` (F1.4, C7.3,
 * `[D-068]`, `[D-082]`, EXT-7 / `ol-5nle`).
 *
 * `packages/core/src/concept/read.ts` defines the port; until this file
 * existed, nothing implemented it outside a test fake — `ol-2zfj.1` shipped
 * the reading STAGE with no production caller for exactly this reason,
 * closed as the D-072 escape hatch and handed to this bead. This class turns
 * a `ConceptReadRequest` into `concepts.extract.v1`'s frozen envelope, sends
 * it through an injected `WorkerTaskTransport`, and turns the response back
 * into `ProposedConcept[]` — same seam, same shape,
 * `packages/core/src/retrieval/workerProvider.ts`'s `WorkerEmbeddingProvider`
 * one level over.
 *
 * **This adapter lives in `packages/plugin`, not `packages/core` — a
 * deliberate deviation from `WorkerEmbeddingProvider`'s home.** `ol-2zfj.1`
 * declared `packages/core/src/concept/` as its whole ownership and this bead
 * does not reopen that package; the port itself already lives in core
 * (`ConceptReaderPort`, `read.ts`), which is all a client-repo implementation
 * needs to import.
 *
 * **Why concepts are cited back by passage index, not returned as a
 * `Provenance` from the model.** The Worker's `concepts.extract.v1` response
 * never carries a `Provenance` — a model has no business constructing a
 * vault path, and D-005 keeps identifiers out of a transient model call
 * regardless. Instead the response names an `anchorIndex` / `alsoInIndexes`
 * into the numbered list of `sourceChunks` this class itself sent, and THIS
 * file — which is the one place that holds both the original
 * `ConceptPassage[]` and the response — is what turns a grounded index back
 * into the real `Provenance` the request already carried. The Worker's own
 * `groundConcepts` (`olea-service/src/tasks/conceptsExtract.ts`) already
 * drops any `anchorIndex` that does not name a chunk it actually sent; this
 * class does not re-trust that on faith and throws rather than silently
 * mis-anchoring if an index still fails to resolve — a response is never
 * trusted twice over the same boundary without a check on this side too.
 *
 * **Why the task id and contract version are local constants** — mirroring
 * `workerProvider.ts`'s own reasoning, restated for this seam: `olea-contracts`'
 * `main` points at TypeScript source, so a value import would make this module
 * unloadable from a plain Node process running `packages/core` or
 * `packages/plugin`'s built output. `workerConceptReader.spec.ts` asserts both
 * constants equal the frozen catalogue's.
 */

import {
  type ConceptPassage,
  type ConceptReaderPort,
  ConceptReaderUnavailableError,
  type ConceptReadRequest,
  type ConceptReadResponse,
  type ProposedConcept,
  type Provenance,
  type WorkerTaskTransport,
} from 'olea-core';

/** `TASK_IDS.CONCEPTS_EXTRACT`, mirrored — see the module doc. Pinned by `workerConceptReader.spec.ts`. */
export const CONCEPTS_EXTRACT_TASK_ID = 'concepts.extract.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms and pinned by the same test. */
export const CONCEPTS_EXTRACT_CONTRACT_VERSION = 1;

/**
 * Anything that went wrong reaching the Worker or reading its reply that is
 * NOT `ConceptReaderUnavailableError` — a malformed body, an index the
 * Worker's own grounding should have already dropped, a refusal code this
 * class does not map to an availability reason. `readConcepts` turns this
 * into `reason: 'reader-failed'`, distinct from `'reader-unavailable'`.
 */
export class WorkerConceptReaderError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerConceptReaderError';
    this.code = code;
  }
}

export interface WorkerConceptReaderDeps {
  readonly transport: WorkerTaskTransport;
}

export class WorkerConceptReader implements ConceptReaderPort {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: WorkerConceptReaderDeps) {
    this.transport = deps.transport;
  }

  async read(request: ConceptReadRequest): Promise<ConceptReadResponse> {
    const passages = request.passages;
    // Mirrors `readConcepts`'s own INV-5 refusal-by-construction one level
    // down: `readConcepts` never calls a port with an empty batch, but this
    // class does not assume every caller upholds that — nothing to be
    // faithful to is nothing to send.
    if (passages.length === 0) {
      return { concepts: [] };
    }

    let body: unknown;
    try {
      body = await this.transport.send({
        contractVersion: CONCEPTS_EXTRACT_CONTRACT_VERSION,
        taskId: CONCEPTS_EXTRACT_TASK_ID,
        payload: { sourceChunks: passages.map((passage) => passage.text) },
      });
    } catch (error) {
      // A transport failure below the HTTP layer (no network, DNS, a
      // connection reset) is exactly `[D-068]`'s "offline" — the one
      // `ConceptReaderUnavailableReason` a Worker response body can never
      // itself carry, because there was no response.
      throw new ConceptReaderUnavailableError(
        'offline',
        `WorkerConceptReader: the transport failed before any response arrived: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { concepts: readProposals(body, passages) };
  }
}

function readProposals(
  body: unknown,
  passages: readonly ConceptPassage[],
): readonly ProposedConcept[] {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerConceptReaderError(
      'WorkerConceptReader: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response['ok'] === false) {
    const code = typeof response['code'] === 'string' ? response['code'] : undefined;
    const message =
      typeof response['message'] === 'string' ? response['message'] : 'no message supplied';
    // `[D-068]`'s accepted cost names budget-exhaustion as its own reason,
    // distinct from a generic failure — the one Worker error code with an
    // unambiguous mapping onto `ConceptReaderUnavailableReason`. Everything
    // else (`invalid-request`, `upstream-error`, `internal-error`,
    // `unauthenticated`, `update-required`) is a real failure this class does
    // not soften into "unavailable": an expired token or an outdated plugin
    // is the composition root's job to have already ruled out (F7.8 — see
    // `wiring.ts`), not this class's to guess at from an error code.
    if (code === 'quota-exceeded') {
      throw new ConceptReaderUnavailableError(
        'budget-exhausted',
        `WorkerConceptReader: ${message}`,
      );
    }
    throw new WorkerConceptReaderError(
      `WorkerConceptReader: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response['ok'] !== true) {
    throw new WorkerConceptReaderError(
      'WorkerConceptReader: the Worker response carried no `ok` discriminant.',
    );
  }

  const result = response['result'];
  const rawConcepts =
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>)['concepts']
      : undefined;
  if (!Array.isArray(rawConcepts)) {
    throw new WorkerConceptReaderError(
      'WorkerConceptReader: the Worker response carried no `result.concepts` array.',
    );
  }

  return rawConcepts.map((raw, index) => toProposedConcept(raw, passages, index));
}

function toProposedConcept(
  raw: unknown,
  passages: readonly ConceptPassage[],
  index: number,
): ProposedConcept {
  const entry = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const name = entry['name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new WorkerConceptReaderError(`WorkerConceptReader: concept ${index} carried no name.`);
  }

  const anchorIndex = entry['anchorIndex'];
  if (typeof anchorIndex !== 'number' || !Number.isInteger(anchorIndex)) {
    throw new WorkerConceptReaderError(
      `WorkerConceptReader: concept ${index} ("${name}") carried no numeric anchorIndex.`,
    );
  }
  const anchorPassage = passages[anchorIndex - 1];
  if (anchorPassage === undefined) {
    // The Worker's own `groundConcepts` already drops an anchorIndex it never
    // sent a passage for. Reaching here means that check did not run or this
    // adapter's index accounting has drifted from the Worker's — either way
    // a loud failure, not a silent mis-anchor onto the wrong passage.
    throw new WorkerConceptReaderError(
      `WorkerConceptReader: concept ${index} ("${name}") cited passage ${anchorIndex}, which was never sent.`,
    );
  }

  const aliasesRaw = entry['aliases'];
  const aliases: string[] = Array.isArray(aliasesRaw)
    ? aliasesRaw.filter((alias): alias is string => typeof alias === 'string')
    : [];

  // `alsoInIndexes` is corroborating detail, not the concept's identity —
  // unlike `anchorIndex`, an entry the Worker's grounding missed is filtered
  // out here rather than failing the whole concept.
  const alsoInRaw = entry['alsoInIndexes'];
  const alsoIn: Provenance[] = Array.isArray(alsoInRaw)
    ? alsoInRaw
        .filter((value): value is number => typeof value === 'number' && Number.isInteger(value))
        .map((value) => passages[value - 1])
        .filter((passage): passage is ConceptPassage => passage !== undefined)
        .map((passage) => passage.anchor)
    : [];

  return { name, aliases, anchor: anchorPassage.anchor, alsoIn };
}
