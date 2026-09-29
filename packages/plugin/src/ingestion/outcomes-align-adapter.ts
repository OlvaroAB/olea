/**
 * `WorkerOutcomesAlignReader` — the client-side adapter for `outcomes.align.v1` (`[D-431]`, David
 * 2026-09-29, decision sheet row 18; client half `ol-egov.141.89.7.33`). The service task is
 * `olea-service/src/tasks/outcomesAlign.ts` and its design authority is
 * `olea-service/docs/dev/intelligence-build/scp.md` sections 2.4, S.3, S.4 and S.6.
 *
 * **What it does.** One call per records batch and concept batch: it sends the course context, the
 * coverage record, the records with their passages and the closed concept list, and reads the
 * answer back as ONE OUTCOME PER (record, concept) PAIR, in the request's own order. It mirrors
 * `WorkerOutcomesExtractReader`: a local mirrored task id and contract version, a dedicated reader
 * error distinct from the availability error, and no `obsidian` import (INV-1).
 *
 * **What it does not do.** Aggregation (aligned, pending, cannot tell, not aligned), basis mapping,
 * the omission ledger, batching and the stored result are client code that lives with the wire
 * stage (`scp.md` S.4 steps 1 and 4, `[D-429]`). Nothing here reads a document, retains anything or
 * writes the store.
 *
 * ## The four outcomes, kept apart (`scp.md` S.3)
 *
 * - `within-scope`: the Worker attested the concept for the record, citing passages that were sent
 *   for that record; the refs come back as the caller's own unit ordinals;
 * - `not-within-scope`: the record WAS decided and the answer does not attest the concept. It is
 *   the only place this verdict arises: the Worker never says it, the client derives it, and only
 *   from a record the answer actually decided;
 * - `cannot-tell`, with a reason from the closed list: `ambiguous`, `depends-on-unread-unit` (with
 *   the unit's ordinal), `depends-on-figure`, or `voided-by-check`. `voided-by-check` covers a
 *   within-scope verdict a Worker check took away AND every pair of a record the answer omitted
 *   (`decided: false`). **A missing record is voided by check, never not within scope**: an
 *   undecided pair read as a decided "no" is the loss this stage exists to prevent;
 * - **unavailable**: operational, never a verdict, never a value in the result. It is thrown as
 *   `OutcomesAlignReaderUnavailableError` (offline, or a spent budget), and an answer this reader
 *   cannot trust is thrown as `OutcomesAlignReaderError`. The wire stage maps the first onto a
 *   pending result (`unavailable`) and the second onto a failed alignment.
 *
 * ## An answer it cannot trust is refused, not repaired
 *
 * The Worker already runs these checks (`checkAlignDecisions`), so a conforming answer never trips
 * them here; the reader repeats the ones it can decide from the request alone, for the same reason
 * `resolveAnchor` in the extract adapter does not trust a Worker's grounding on faith: a batch id
 * or coverage digest that is not the one sent, a decision for a record that was not sent, a handle
 * outside the batch, a duplicate, a ref that is not a citable passage of THAT record (a figure
 * description never counts), and a `depends-on-unread-unit` naming a unit the coverage lists as
 * read. Each is a failure of the whole call: the batch's pairs stay pending and are retried, and
 * no half-trusted verdict is stored. Self-rated confidence is recorded beside the record and never
 * branched on.
 *
 * ## Refs are the caller's ordinals
 *
 * A passage and a coverage unit each carry the wire `ref` the Worker sees AND the client's own
 * `unitIndex` (the document's landed-unit ordinal, `ScopeReadingAnchor.unitIndex`). The ordinal is
 * never sent (D-005: the Worker has no business with the client's addressing); the answer's refs are
 * mapped back to it here, so the result speaks the stored shape's language
 * (`AlignmentResult.aligned.refs`).
 *
 * **Reachability (`[D-072]`).** Nothing calls this in production yet, deliberately. Its production
 * caller is the wire stage, `ol-egov.141.89.7.5`: the alignment run that plans batches, builds the
 * closed list, calls `read`, aggregates the pairs and writes the alignment store
 * (`packages/core/src/outcome/scope-reading-store.ts`). A workbench caller would not discharge it.
 */

import type { PaperQuestionGroupKind, PaperStimulusForm, WorkerTaskTransport } from 'olea-core';

/** `TASK_IDS.OUTCOMES_ALIGN` (`olea-contracts`, `f1ed01e`), mirrored so this module loads from plain Node. Pinned by this adapter's spec. */
export const OUTCOMES_ALIGN_TASK_ID = 'outcomes.align.v1';

/** This task's contract version. */
export const OUTCOMES_ALIGN_CONTRACT_VERSION = 1;

export type AlignDocumentKind = 'objectives' | 'past-paper' | 'stated-scope';

/** The sets a unit of the revision sits in (`scp.md` S.3), with "sent" split by where it was sent. */
export type AlignUnitState =
  | 'sent'
  | 'sent-in-other-call'
  | 'read-not-sent'
  | 'not-read'
  | 'unreadable';

/** What a passage sent with a record is. Only the first three can be cited. */
export type AlignPassageRole = 'record' | 'group-stem' | 'group-stimulus' | 'figure-description';

const CITABLE_ROLES: ReadonlySet<AlignPassageRole> = new Set([
  'record',
  'group-stem',
  'group-stimulus',
]);

export type AlignRecordKind = 'declaration' | 'question-part' | 'stated-entry';

export type AlignStimulusStatus = 'identified' | 'none' | 'not-identified' | 'described-figure';

/** One unit of the revision and where it stands. Every unit is listed: none is invisible to the call. */
export interface AlignCoverageUnit {
  /** The wire handle the Worker sees. */
  readonly ref: string;
  /** The client's ordinal for the unit; never sent. */
  readonly unitIndex: number;
  readonly state: AlignUnitState;
  /** The call the unit was sent in, when `sent-in-other-call`. */
  readonly batchId?: string;
  /** The perception chain's closed-list reason, when the unit was not sent or not read. */
  readonly reason?: string;
}

export interface AlignPassage {
  readonly ref: string;
  readonly unitIndex: number;
  readonly text: string;
  readonly role: AlignPassageRole;
}

export interface AlignRecord {
  readonly recordId: string;
  readonly kind: AlignRecordKind;
  readonly anchorRef: string;
  readonly headingPath?: readonly string[];
  readonly passages: readonly AlignPassage[];
  /** A question part is sent inside its group; the group's stem and stimulus travel as passages. */
  readonly group?: {
    readonly groupId: string;
    readonly kind: PaperQuestionGroupKind;
    readonly stimulus: {
      readonly status: AlignStimulusStatus;
      readonly form?: PaperStimulusForm;
      readonly ref?: string;
    };
  };
}

export interface AlignConcept {
  /** A stable handle: `c` then three or more digits, never derived from a name. */
  readonly handle: string;
  readonly name: string;
  /** A verbatim span of her own material, never a model's wording. */
  readonly description?: {
    readonly text: string;
    readonly source: 'her-definition' | 'introducing-passage';
    readonly truncated?: { readonly fullLength: number };
  };
  /** Why there is no description; a concept is never dropped for lacking one. */
  readonly descriptionNone?: string;
  readonly attribution: { readonly courseId: string; readonly courseName?: string };
}

export interface OutcomesAlignReadRequest {
  readonly documentKind: AlignDocumentKind;
  /** Echoed in the answer. */
  readonly batchId: string;
  /** Course context disambiguates wording; it never attests. */
  readonly courseContext: { readonly courseId: string; readonly courseName: string };
  readonly coverage: { readonly digest: string; readonly units: readonly AlignCoverageUnit[] };
  readonly records: readonly AlignRecord[];
  /** The closed concept list for this call: the only handles an answer may use. */
  readonly concepts: readonly AlignConcept[];
}

/** Why a pair could not be decided. `voided-by-check` is a Worker check's, or a record the answer left out. */
export type AlignCannotTellReason =
  | 'ambiguous'
  | 'depends-on-unread-unit'
  | 'depends-on-figure'
  | 'voided-by-check';

const CANNOT_TELL_REASONS: readonly AlignCannotTellReason[] = [
  'ambiguous',
  'depends-on-unread-unit',
  'depends-on-figure',
  'voided-by-check',
];

export type AlignPairVerdict =
  | {
      readonly kind: 'within-scope';
      /** The unit ordinals of the passages that show it, each a citable passage sent for the record. */
      readonly refs: readonly number[];
    }
  | { readonly kind: 'not-within-scope' }
  | {
      readonly kind: 'cannot-tell';
      readonly reason: AlignCannotTellReason;
      /** The ordinal of the unread unit, for `depends-on-unread-unit`. */
      readonly unitIndex?: number;
    };

export interface AlignPairReading {
  readonly handle: string;
  readonly verdict: AlignPairVerdict;
}

export interface AlignRecordReading {
  readonly recordId: string;
  /** False when the answer did not decide this record: every pair below is `voided-by-check`. */
  readonly decided: boolean;
  /** Self-rated, recorded and never branched on. */
  readonly confidence?: number;
  /** One per concept sent, in the request's order. */
  readonly pairs: readonly AlignPairReading[];
}

/** The response stamp's provenance fields (D7.3), which a stored result carries beside `task`. */
export interface AlignReadStamp {
  readonly promptVersion: string;
  readonly modelId: string;
}

export interface OutcomesAlignReadResult {
  readonly batchId: string;
  readonly coverageDigest: string;
  /** Absent only when no call was made (nothing to decide). */
  readonly stamp?: AlignReadStamp;
  /** One per record sent, in the request's order. */
  readonly records: readonly AlignRecordReading[];
}

/**
 * Distinct from a transport failure, so a caller can tell "the Worker is unreachable" from "the
 * Worker answered but this reader could not trust the answer" without string-matching a message.
 * `code` is the Worker's error code when it refused, else a local one (`echo-mismatch`).
 */
export class OutcomesAlignReaderError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'OutcomesAlignReaderError';
    this.code = code;
  }
}

/** `'offline'` (the transport failed before any response) or `'budget-exhausted'` (`quota-exceeded`): the pairs are pending, never decided. */
export class OutcomesAlignReaderUnavailableError extends Error {
  readonly reason: 'offline' | 'budget-exhausted';
  constructor(reason: 'offline' | 'budget-exhausted', message: string) {
    super(message);
    this.name = 'OutcomesAlignReaderUnavailableError';
    this.reason = reason;
  }
}

export interface WorkerOutcomesAlignReaderDeps {
  readonly transport: WorkerTaskTransport;
}

export class WorkerOutcomesAlignReader {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: WorkerOutcomesAlignReaderDeps) {
    this.transport = deps.transport;
  }

  async read(request: OutcomesAlignReadRequest): Promise<OutcomesAlignReadResult> {
    assertRequestReadable(request);
    // Nothing to decide is nothing to send: with no record there is no pair, and with no concept
    // every record has none. Neither is a verdict and neither costs a call.
    if (request.records.length === 0 || request.concepts.length === 0) {
      return {
        batchId: request.batchId,
        coverageDigest: request.coverage.digest,
        records: request.records.map((record) => ({
          recordId: record.recordId,
          decided: false,
          pairs: [],
        })),
      };
    }

    let body: unknown;
    try {
      body = await this.transport.send({
        contractVersion: OUTCOMES_ALIGN_CONTRACT_VERSION,
        taskId: OUTCOMES_ALIGN_TASK_ID,
        payload: toPayload(request),
      });
    } catch (error) {
      throw new OutcomesAlignReaderUnavailableError(
        'offline',
        `WorkerOutcomesAlignReader: the transport failed before any response arrived: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return readOutcomesAlignResponse(body, request);
  }
}

/**
 * Reads one Worker envelope against the request that produced it: pure, no transport. For a caller
 * that already holds the body (a capturing transport, a replay) and for tests.
 */
export function readOutcomesAlignResponse(
  body: unknown,
  request: OutcomesAlignReadRequest,
): OutcomesAlignReadResult {
  const response = readEnvelope(body);
  const stamp = readStamp(response);
  const result = readResult(response);

  if (result.batchId !== request.batchId || result.coverageDigest !== request.coverage.digest) {
    // An echo that is not the call's own makes the call an operational failure, never a verdict.
    throw new OutcomesAlignReaderError(
      "WorkerOutcomesAlignReader: the answer's batch id or coverage digest is not the call's.",
      'echo-mismatch',
    );
  }

  const recordsById = new Map(request.records.map((record) => [record.recordId, record]));
  const handles = new Set(request.concepts.map((concept) => concept.handle));
  const unitIndexByRef = unitIndexes(request);
  const unreadUnitRefs = new Set(
    request.coverage.units
      .filter((unit) => unit.state === 'not-read' || unit.state === 'unreadable')
      .map((unit) => unit.ref),
  );

  const rawDecisions = result.decisions ?? [];
  if (!Array.isArray(rawDecisions)) {
    throw new OutcomesAlignReaderError(
      'WorkerOutcomesAlignReader: the answer carried a `decisions` that was not an array.',
    );
  }

  const decided = new Map<
    string,
    { readonly attests: Map<string, AlignPairVerdict>; readonly confidence?: number }
  >();
  for (const [index, rawDecision] of rawDecisions.entries()) {
    const decision = asObject(rawDecision);
    const recordId = decision.recordId;
    const record = typeof recordId === 'string' ? recordsById.get(recordId) : undefined;
    if (typeof recordId !== 'string' || record === undefined) {
      throw new OutcomesAlignReaderError(
        `WorkerOutcomesAlignReader: decision ${index} named a record that was not sent.`,
      );
    }
    if (decided.has(recordId)) {
      throw new OutcomesAlignReaderError(
        `WorkerOutcomesAlignReader: decision ${index} repeated a record already decided.`,
      );
    }
    const confidence = decision.confidence;
    if (
      confidence !== undefined &&
      (typeof confidence !== 'number' || !Number.isFinite(confidence))
    ) {
      throw new OutcomesAlignReaderError(
        `WorkerOutcomesAlignReader: decision ${index} carried a confidence that was not a number.`,
      );
    }
    const rawAttests = decision.attests ?? [];
    if (!Array.isArray(rawAttests)) {
      throw new OutcomesAlignReaderError(
        `WorkerOutcomesAlignReader: decision ${index} carried an \`attests\` that was not an array.`,
      );
    }
    const citableRefs = new Set(
      record.passages.filter((p) => CITABLE_ROLES.has(p.role)).map((p) => p.ref),
    );
    const attests = new Map<string, AlignPairVerdict>();
    for (const rawAttest of rawAttests) {
      const { handle, verdict } = toAttestation(
        rawAttest,
        `decision ${index}`,
        handles,
        citableRefs,
        unreadUnitRefs,
        unitIndexByRef,
      );
      if (attests.has(handle)) {
        throw new OutcomesAlignReaderError(
          `WorkerOutcomesAlignReader: decision ${index} attested one concept twice.`,
        );
      }
      attests.set(handle, verdict);
    }
    decided.set(recordId, {
      attests,
      ...(typeof confidence === 'number' ? { confidence } : {}),
    });
  }

  const records: AlignRecordReading[] = request.records.map((record) => {
    const decision = decided.get(record.recordId);
    return {
      recordId: record.recordId,
      decided: decision !== undefined,
      ...(decision?.confidence !== undefined ? { confidence: decision.confidence } : {}),
      pairs: request.concepts.map((concept): AlignPairReading => {
        // A record the answer left out is undecided, never "no": voided by check.
        if (decision === undefined) {
          return {
            handle: concept.handle,
            verdict: { kind: 'cannot-tell', reason: 'voided-by-check' },
          };
        }
        return {
          handle: concept.handle,
          verdict: decision.attests.get(concept.handle) ?? { kind: 'not-within-scope' },
        };
      }),
    };
  });

  return {
    batchId: request.batchId,
    coverageDigest: request.coverage.digest,
    stamp,
    records,
  };
}

function toAttestation(
  raw: unknown,
  describe: string,
  handles: ReadonlySet<string>,
  citableRefs: ReadonlySet<string>,
  unreadUnitRefs: ReadonlySet<string>,
  unitIndexByRef: ReadonlyMap<string, number>,
): { readonly handle: string; readonly verdict: AlignPairVerdict } {
  const entry = asObject(raw);
  const handle = entry.handle;
  if (typeof handle !== 'string' || !handles.has(handle)) {
    throw new OutcomesAlignReaderError(
      `WorkerOutcomesAlignReader: ${describe} attested a concept outside this call's batch.`,
    );
  }

  if (entry.verdict === 'within-scope') {
    const refs = entry.refs;
    if (!Array.isArray(refs) || refs.length === 0) {
      throw new OutcomesAlignReaderError(
        `WorkerOutcomesAlignReader: ${describe} attested a concept within scope with no ref.`,
      );
    }
    const ordinals: number[] = [];
    for (const ref of refs) {
      // Only a citable passage sent for THIS record counts: a figure description, another
      // record's passage and an unsent ref are all refused, never quietly dropped.
      const ordinal =
        typeof ref === 'string' && citableRefs.has(ref) ? unitIndexByRef.get(ref) : undefined;
      if (ordinal === undefined) {
        throw new OutcomesAlignReaderError(
          `WorkerOutcomesAlignReader: ${describe} cited a ref that is not a citable passage sent for that record.`,
        );
      }
      if (!ordinals.includes(ordinal)) ordinals.push(ordinal);
    }
    return { handle, verdict: { kind: 'within-scope', refs: ordinals } };
  }

  if (entry.verdict === 'cannot-tell') {
    const reason = entry.reason;
    if (!(CANNOT_TELL_REASONS as readonly unknown[]).includes(reason)) {
      throw new OutcomesAlignReaderError(
        `WorkerOutcomesAlignReader: ${describe} carried a cannot-tell with an unknown reason.`,
      );
    }
    if (reason === 'depends-on-unread-unit') {
      const unitRef = entry.unitRef;
      const ordinal =
        typeof unitRef === 'string' && unreadUnitRefs.has(unitRef)
          ? unitIndexByRef.get(unitRef)
          : undefined;
      if (ordinal === undefined) {
        throw new OutcomesAlignReaderError(
          `WorkerOutcomesAlignReader: ${describe} said a pair depends on an unread unit but named none the coverage lists as unread.`,
        );
      }
      return {
        handle,
        verdict: { kind: 'cannot-tell', reason: 'depends-on-unread-unit', unitIndex: ordinal },
      };
    }
    return { handle, verdict: { kind: 'cannot-tell', reason: reason as AlignCannotTellReason } };
  }

  throw new OutcomesAlignReaderError(
    `WorkerOutcomesAlignReader: ${describe} carried an attestation with an unknown verdict.`,
  );
}

/**
 * The wire payload: the request as the Worker's schema names it, with every client-only ordinal
 * left behind. Built field by field so a stray property on a caller's object never travels.
 */
function toPayload(request: OutcomesAlignReadRequest): Record<string, unknown> {
  return {
    documentKind: request.documentKind,
    batchId: request.batchId,
    courseContext: {
      courseId: request.courseContext.courseId,
      courseName: request.courseContext.courseName,
    },
    coverage: {
      digest: request.coverage.digest,
      units: request.coverage.units.map((unit) => ({
        ref: unit.ref,
        state: unit.state,
        ...(unit.batchId !== undefined ? { batchId: unit.batchId } : {}),
        ...(unit.reason !== undefined ? { reason: unit.reason } : {}),
      })),
    },
    records: request.records.map((record) => ({
      recordId: record.recordId,
      kind: record.kind,
      anchorRef: record.anchorRef,
      ...(record.headingPath !== undefined ? { headingPath: [...record.headingPath] } : {}),
      passages: record.passages.map((passage) => ({
        ref: passage.ref,
        text: passage.text,
        role: passage.role,
      })),
      ...(record.group !== undefined
        ? {
            group: {
              groupId: record.group.groupId,
              kind: record.group.kind,
              stimulus: {
                status: record.group.stimulus.status,
                ...(record.group.stimulus.form !== undefined
                  ? { form: record.group.stimulus.form }
                  : {}),
                ...(record.group.stimulus.ref !== undefined
                  ? { ref: record.group.stimulus.ref }
                  : {}),
              },
            },
          }
        : {}),
    })),
    concepts: request.concepts.map((concept) => ({
      handle: concept.handle,
      name: concept.name,
      ...(concept.description !== undefined
        ? {
            description: {
              text: concept.description.text,
              source: concept.description.source,
              ...(concept.description.truncated !== undefined
                ? { truncated: { fullLength: concept.description.truncated.fullLength } }
                : {}),
            },
          }
        : {}),
      ...(concept.descriptionNone !== undefined
        ? { descriptionNone: concept.descriptionNone }
        : {}),
      attribution: {
        courseId: concept.attribution.courseId,
        ...(concept.attribution.courseName !== undefined
          ? { courseName: concept.attribution.courseName }
          : {}),
      },
    })),
  };
}

/** Every wire ref to its unit ordinal, refusing a ref that stands for two different units. */
function unitIndexes(request: OutcomesAlignReadRequest): ReadonlyMap<string, number> {
  const byRef = new Map<string, number>();
  const note = (ref: string, unitIndex: number): void => {
    const known = byRef.get(ref);
    if (known !== undefined && known !== unitIndex) {
      throw new OutcomesAlignReaderError(
        'WorkerOutcomesAlignReader: one ref stands for two different units in this request, so an answer could not be mapped back.',
      );
    }
    byRef.set(ref, unitIndex);
  };
  for (const unit of request.coverage.units) note(unit.ref, unit.unitIndex);
  for (const record of request.records) {
    for (const passage of record.passages) note(passage.ref, passage.unitIndex);
  }
  return byRef;
}

/** A request whose answer could not be read: refused before any call is spent on it. */
function assertRequestReadable(request: OutcomesAlignReadRequest): void {
  const recordIds = new Set<string>();
  for (const record of request.records) {
    if (recordIds.has(record.recordId)) {
      throw new OutcomesAlignReaderError(
        'WorkerOutcomesAlignReader: the request carried two records with one id.',
      );
    }
    recordIds.add(record.recordId);
  }
  const handles = new Set<string>();
  for (const concept of request.concepts) {
    if (handles.has(concept.handle)) {
      throw new OutcomesAlignReaderError(
        'WorkerOutcomesAlignReader: the request carried two concepts with one handle.',
      );
    }
    handles.add(concept.handle);
  }
  unitIndexes(request);
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function readEnvelope(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) {
    throw new OutcomesAlignReaderError(
      'WorkerOutcomesAlignReader: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response.ok === false) {
    const code = typeof response.code === 'string' ? response.code : undefined;
    const message = typeof response.message === 'string' ? response.message : 'no message supplied';
    if (code === 'quota-exceeded') {
      throw new OutcomesAlignReaderUnavailableError(
        'budget-exhausted',
        `WorkerOutcomesAlignReader: ${message}`,
      );
    }
    throw new OutcomesAlignReaderError(
      `WorkerOutcomesAlignReader: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response.ok !== true) {
    throw new OutcomesAlignReaderError(
      'WorkerOutcomesAlignReader: the Worker response carried no `ok` discriminant.',
    );
  }
  return response;
}

/** D7.3: the real stamp off THIS response, never a guess. A result without one is discarded. */
function readStamp(response: Record<string, unknown>): AlignReadStamp {
  const stamp = asObject(response.stamp);
  const { promptVersion, modelId } = stamp;
  if (
    typeof promptVersion !== 'string' ||
    promptVersion.length === 0 ||
    typeof modelId !== 'string' ||
    modelId.length === 0
  ) {
    throw new OutcomesAlignReaderError(
      'WorkerOutcomesAlignReader: the Worker response carried no D7.3 stamp (promptVersion and modelId).',
    );
  }
  return { promptVersion, modelId };
}

function readResult(response: Record<string, unknown>): Record<string, unknown> {
  const result = response.result;
  if (typeof result !== 'object' || result === null) {
    throw new OutcomesAlignReaderError(
      'WorkerOutcomesAlignReader: the Worker response carried no `result` object.',
    );
  }
  return result as Record<string, unknown>;
}
