/**
 * `WorkerOutcomesExtractReader` — the client-side adapter for
 * `outcomes.extract.v1` (component register row 1.1b, `[ONT-R5]`, F4.1;
 * service side: `olea-service/src/tasks/outcomesExtract.ts`, `ol-4s30`
 * [EXT-13]).
 *
 * **JOIN POINT FOR THE ORCHESTRATOR — READ BEFORE WIRING.** This file is
 * deliberately written against a MINIMAL LOCAL interface
 * (`OutcomeCandidate<TAnchor>` / `PaperSectionCandidate<TAnchor>` /
 * `OutcomesExtractReadResult<TAnchor>` below) rather than importing an
 * `Outcome` type from `olea-core`, because a concurrent lane this same round
 * owns `packages/core/src/outcome/` (the real `Outcome` type, its events, and
 * its writer) and this bead does not touch `packages/core` at all. Once that
 * lane lands, wiring this adapter into the product is:
 *
 *   1. Give `TAnchor` a real value — the same `Provenance` type
 *      `WorkerConceptReader` (`../concept/workerConceptReader.ts`) already
 *      resolves `anchorIndex` onto, so an `OutcomeSourcePassage<Provenance>`
 *      is what a real caller constructs.
 *   2. If `packages/core/src/outcome/` defines an `OutcomeReaderPort` (the
 *      same shape `ConceptReaderPort` gives `WorkerConceptReader`), make this
 *      class `implements` it — `read()`'s signature below is already shaped
 *      to match that pattern (one `documentKind`-tagged request in, one
 *      typed result out) so this should be a signature check, not a rewrite.
 *   3. Map `OutcomeCandidate`/`PaperSectionCandidate` onto whatever
 *      `packages/core/src/outcome/` actually calls its proposal shapes —
 *      likely a rename only; the FIELDS here (`label`, `confidence`, `anchor`
 *      for outcomes; `label`, `questionForm`, `itemCount`, `marks`, `anchor`
 *      for sections) are taken directly from the service task's response
 *      schema (`outcomesExtractOutcomeProposal` / `outcomesExtractPaperSectionProposal`
 *      in `outcomesExtract.ts`), so they should already line up.
 *   4. A composition root (`buildIngestionWiring`-shaped, mirroring
 *      `concept/wiring.ts`'s `buildConceptWiring`) still needs writing, and a
 *      real production caller per the plan's D-072 clause — neither exists
 *      yet; this bead's own service-side bead (`ol-4s30`) names both as
 *      explicitly undone follow-up, not silently deferred.
 *
 * **Not yet wired anywhere** — `outcomes.extract.v1` is not yet in the frozen
 * task-id catalogue (`olea-contracts`'s `TASK_IDS`), so the constants below
 * are this adapter's own reservation, not (yet) a value pinned equal to one
 * there the way `WorkerConceptReader`'s own constants are — see
 * `outcomesExtract.ts`'s module doc in `olea-service` for the full reasoning
 * on why routing was deliberately left for a follow-up bead.
 *
 * Mirrors `WorkerConceptReader`'s shape throughout (local mirrored task-id/
 * contract-version constants rather than a value import — `olea-contracts`'
 * `main` points at TypeScript source, which would make this module unloadable
 * from a plain Node process the same way that file's own doc explains;
 * resolving an `anchorIndex` back to the real passage the caller sent rather
 * than trusting the Worker's own grounding twice over the same boundary; a
 * dedicated error type distinct from a generic throw).
 *
 * Deliberately imports `WorkerTaskTransport`/`WorkerTaskRequest` from
 * `olea-core` — NOT part of this round's `packages/core/src/outcome/` work,
 * but the same long-standing generic transport port `WorkerConceptReader`,
 * `WorkerEmbeddingProvider`, `WorkerJudgeCaller` and `WorkerTranscriptionCaller`
 * already share, so reusing it here adds no coupling to the lane building
 * `packages/core/src/outcome/`.
 */

import type { WorkerTaskTransport } from 'olea-core';

/** `TASK_IDS.OUTCOMES_EXTRACT`-to-be — see this file's module doc. Pinned by this adapter's own spec. */
export const OUTCOMES_EXTRACT_TASK_ID = 'outcomes.extract.v1';

/** This task's contract version — 1 until the catalogue entry says otherwise. */
export const OUTCOMES_EXTRACT_CONTRACT_VERSION = 1;

export type OutcomesExtractDocumentKind = 'objectives' | 'past-paper';

/**
 * One passage of source material and the caller's own anchor for it —
 * `TAnchor` is left generic on purpose (see module doc): a real caller
 * supplies its own `Provenance`-shaped value, this adapter never constructs
 * one itself (D-005: a model has no business naming a vault path, and
 * neither does this class on the model's behalf).
 */
export interface OutcomeSourcePassage<TAnchor> {
  readonly text: string;
  readonly anchor: TAnchor;
}

/** One examiner-declared unit of scope, resolved back onto the caller's own anchor type. */
export interface OutcomeCandidate<TAnchor> {
  readonly label: string;
  readonly confidence: number;
  readonly anchor: TAnchor;
}

/** One section of a past paper's own structure, resolved the same way. */
export interface PaperSectionCandidate<TAnchor> {
  readonly label: string;
  readonly questionForm: string;
  readonly itemCount: number;
  readonly marks: number;
  readonly anchor: TAnchor;
}

export interface OutcomesExtractReadRequest<TAnchor> {
  readonly documentKind: OutcomesExtractDocumentKind;
  readonly passages: readonly OutcomeSourcePassage<TAnchor>[];
}

export interface OutcomesExtractReadResult<TAnchor> {
  readonly outcomes: readonly OutcomeCandidate<TAnchor>[];
  readonly paperStructure: { readonly sections: readonly PaperSectionCandidate<TAnchor>[] };
}

/**
 * Distinct from a transport failure (never a network/connection problem —
 * see `read()` below), so a caller can tell "the Worker is unreachable" from
 * "the Worker answered but this adapter could not trust the answer" without
 * string-matching a message.
 */
export class OutcomesExtractReaderError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'OutcomesExtractReaderError';
    this.code = code;
  }
}

/**
 * Thrown for exactly the two availability reasons `WorkerConceptReader`
 * distinguishes (`[D-068]`'s accepted-cost shape): `'offline'` (the
 * transport itself failed before any response arrived) and
 * `'budget-exhausted'` (the Worker answered `quota-exceeded`). A composition
 * root maps this onto F7.8's grey-out affordance the same way it already
 * does for `ConceptReaderUnavailableError` — see this file's module doc,
 * point 2, for why this is a local class rather than an import from
 * `olea-core`: the real `OutcomeReaderPort` (if one is added) is
 * `packages/core/src/outcome/`'s call, not this adapter's to invent.
 */
export class OutcomesExtractReaderUnavailableError extends Error {
  readonly reason: 'offline' | 'budget-exhausted';
  constructor(reason: 'offline' | 'budget-exhausted', message: string) {
    super(message);
    this.name = 'OutcomesExtractReaderUnavailableError';
    this.reason = reason;
  }
}

export interface WorkerOutcomesExtractReaderDeps {
  readonly transport: WorkerTaskTransport;
}

export class WorkerOutcomesExtractReader {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: WorkerOutcomesExtractReaderDeps) {
    this.transport = deps.transport;
  }

  async read<TAnchor>(
    request: OutcomesExtractReadRequest<TAnchor>,
  ): Promise<OutcomesExtractReadResult<TAnchor>> {
    const passages = request.passages;
    // Same INV-5-adjacent discipline `WorkerConceptReader.read` holds: nothing
    // to be faithful to is nothing to send, and this class does not assume
    // every caller already checked for an empty batch.
    if (passages.length === 0) {
      return { outcomes: [], paperStructure: { sections: [] } };
    }

    let body: unknown;
    try {
      body = await this.transport.send({
        contractVersion: OUTCOMES_EXTRACT_CONTRACT_VERSION,
        taskId: OUTCOMES_EXTRACT_TASK_ID,
        payload: {
          sourceChunks: passages.map((passage) => passage.text),
          documentKind: request.documentKind,
        },
      });
    } catch (error) {
      throw new OutcomesExtractReaderUnavailableError(
        'offline',
        `WorkerOutcomesExtractReader: the transport failed before any response arrived: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const response = readResponseBody(body);
    const outcomes = readOutcomeProposals(response, passages);
    const sections = readSectionProposals(response, passages);
    return { outcomes, paperStructure: { sections } };
  }
}

function readResponseBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) {
    throw new OutcomesExtractReaderError(
      'WorkerOutcomesExtractReader: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response.ok === false) {
    const code = typeof response.code === 'string' ? response.code : undefined;
    const message = typeof response.message === 'string' ? response.message : 'no message supplied';
    if (code === 'quota-exceeded') {
      throw new OutcomesExtractReaderUnavailableError(
        'budget-exhausted',
        `WorkerOutcomesExtractReader: ${message}`,
      );
    }
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response.ok !== true) {
    throw new OutcomesExtractReaderError(
      'WorkerOutcomesExtractReader: the Worker response carried no `ok` discriminant.',
    );
  }

  return response;
}

function readResult(response: Record<string, unknown>): Record<string, unknown> {
  const result = response.result;
  return typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {};
}

function readOutcomeProposals<TAnchor>(
  response: Record<string, unknown>,
  passages: readonly OutcomeSourcePassage<TAnchor>[],
): readonly OutcomeCandidate<TAnchor>[] {
  const raw = readResult(response).outcomes;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new OutcomesExtractReaderError(
      'WorkerOutcomesExtractReader: the Worker response carried a `result.outcomes` that was not an array.',
    );
  }
  return raw.map((entry, index) => toOutcomeCandidate(entry, passages, index));
}

function toOutcomeCandidate<TAnchor>(
  raw: unknown,
  passages: readonly OutcomeSourcePassage<TAnchor>[],
  index: number,
): OutcomeCandidate<TAnchor> {
  const entry = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const label = entry.label;
  if (typeof label !== 'string' || label.length === 0) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: outcome ${index} carried no label.`,
    );
  }
  const confidence = entry.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: outcome ${index} ("${label}") carried no numeric confidence.`,
    );
  }
  const anchorPassage = resolveAnchor(entry.anchorIndex, passages, `outcome ${index} ("${label}")`);
  return { label, confidence, anchor: anchorPassage.anchor };
}

function readSectionProposals<TAnchor>(
  response: Record<string, unknown>,
  passages: readonly OutcomeSourcePassage<TAnchor>[],
): readonly PaperSectionCandidate<TAnchor>[] {
  const paperStructure = readResult(response).paperStructure;
  const container =
    typeof paperStructure === 'object' && paperStructure !== null
      ? (paperStructure as Record<string, unknown>)
      : {};
  const raw = container.sections;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new OutcomesExtractReaderError(
      'WorkerOutcomesExtractReader: the Worker response carried a `result.paperStructure.sections` that was not an array.',
    );
  }
  return raw.map((entry, index) => toSectionCandidate(entry, passages, index));
}

function toSectionCandidate<TAnchor>(
  raw: unknown,
  passages: readonly OutcomeSourcePassage<TAnchor>[],
  index: number,
): PaperSectionCandidate<TAnchor> {
  const entry = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const label = entry.label;
  if (typeof label !== 'string' || label.length === 0) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: paper section ${index} carried no label.`,
    );
  }
  const questionForm = entry.questionForm;
  if (typeof questionForm !== 'string' || questionForm.length === 0) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: paper section ${index} ("${label}") carried no questionForm.`,
    );
  }
  const itemCount = entry.itemCount;
  if (typeof itemCount !== 'number' || !Number.isInteger(itemCount) || itemCount < 0) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: paper section ${index} ("${label}") carried no valid itemCount.`,
    );
  }
  const marks = entry.marks;
  if (typeof marks !== 'number' || Number.isNaN(marks) || marks < 0) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: paper section ${index} ("${label}") carried no valid marks.`,
    );
  }
  const anchorPassage = resolveAnchor(
    entry.anchorIndex,
    passages,
    `paper section ${index} ("${label}")`,
  );
  return { label, questionForm, itemCount, marks, anchor: anchorPassage.anchor };
}

/**
 * Resolves a 1-based `anchorIndex` back onto the passage the caller actually
 * sent. The Worker's own `groundOutcomes` (`outcomesExtract.ts`) already
 * drops any `anchorIndex` that does not name a chunk it actually sent; this
 * class does not re-trust that on faith and throws rather than silently
 * mis-anchoring if an index still fails to resolve — same posture
 * `WorkerConceptReader.toProposedConcept` holds for its own `anchorIndex`.
 */
function resolveAnchor<TAnchor>(
  anchorIndex: unknown,
  passages: readonly OutcomeSourcePassage<TAnchor>[],
  describe: string,
): OutcomeSourcePassage<TAnchor> {
  if (typeof anchorIndex !== 'number' || !Number.isInteger(anchorIndex)) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: ${describe} carried no numeric anchorIndex.`,
    );
  }
  const passage = passages[anchorIndex - 1];
  if (passage === undefined) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: ${describe} cited passage ${anchorIndex}, which was never sent.`,
    );
  }
  return passage;
}
