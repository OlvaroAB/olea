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
 * **RETRACTED, `ol-ppxj.43` [DOS-C9]: "not yet in the frozen task-id
 * catalogue" is stale.** `outcomes.extract.v1` landed in the catalogue via
 * `ol-2jod.21` [D-254] (three commits: `olea`'s `TASK_IDS.OUTCOMES_EXTRACT`,
 * the `olea-service` re-vendor, and one registry line in
 * `olea-service/src/tasks/registry.ts`) — the constants below are pinned to
 * a real catalogue entry now, not a private reservation. **Still not wired
 * to a production caller, and that part remains true**: `ol-2jod.21`'s own
 * ruling explicitly withheld the plugin's automatic trigger, gating it on a
 * measured five-course real-model run (`[EXT-14]`) rather than landing it
 * alongside the catalogue addition. See `wiring.ts`'s
 * `buildOutcomesExtractWiring`/`runOutcomesExtract` module doc for that
 * still-open half.
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
 *
 * **Unknown marks, parts, total and time (`[D-431]`, `ol-egov.141.89.7.33`).** The Worker's
 * `outcomes.extract.v1` at prompt 1.2.0 keeps what a paper does not state as unknown instead of
 * dropping it, and this reader accepts both that response and every earlier one unchanged:
 *
 * - a section with NO `marks` field is kept, with `marks` absent (the store mapping,
 *   `scope-reading/persistence.ts`, turns absent into unknown): never zero, never estimated from
 *   the item count, never a failure that loses the whole paper. A stated value, including a
 *   printed `0`, is still read as stated; an explicit `null` reads as unknown as well, since the
 *   only thing it can mean is "not stated";
 * - `paperStructure.questionParts` are read like groups (each part's instruction anchor resolved
 *   onto the caller's own passage, the original wording staying in her source), with `marks`
 *   stated or absent and `dependsOn` stated (naming part ids) or unknown, which is what an absent
 *   `dependsOn` means: a dependency nobody stated is never independent. No demand is read here,
 *   ever: a part's demand is `demand.classify.v1`'s (`./demand-classify-adapter.ts`);
 * - `totalMarks` and `timeAllowanceMinutes` come back as plain numbers (their anchor must still
 *   resolve onto a sent passage, and the stored shape keeps none).
 *
 * As with `questionGroups`, every new key is present in the result only when the response carried
 * it: a 1.0.0 or 1.1.0 response reads to the very object it read to before, and **absent is not
 * empty** (an empty `questionParts` list means a reader that looked and found none).
 */

import type {
  PaperQuestionGroup,
  PaperQuestionGroupKind,
  PaperStimulus,
  PaperStimulusForm,
  PaperStimulusNotIdentifiedReason,
  WorkerTaskTransport,
} from 'olea-core';
import {
  PAPER_QUESTION_GROUP_KINDS,
  PAPER_STIMULUS_FORMS,
  PAPER_STIMULUS_NOT_IDENTIFIED_REASONS,
} from 'olea-core';

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
  /**
   * ABSENT means the paper does not state the section's marks (`[D-431]`): unknown, never zero and
   * never worked out from the item count. A stated value, a printed `0` included, is present.
   */
  readonly marks?: number;
  readonly anchor: TAnchor;
}

/**
 * A part's dependency on other parts of the same reading, by the Worker's part ids. `unknown` is
 * what a dependency nobody stated is: never independent. Structurally the stored
 * `ScopePartDependency` (`packages/core/src/outcome/scope-reading-types.ts`).
 */
export type PartDependencyCandidate =
  | { readonly status: 'stated'; readonly onPartIds: readonly string[] }
  | { readonly status: 'unknown' };

/**
 * One labelled question part inside a kept group (`[D-431]`). The instruction is a REFERENCE: the
 * anchor of the one passage that carries it, so the original wording stays in her source and is
 * never copied or forced into a taxonomy. Carries no demand (`demand.classify.v1` reads that).
 * Structurally the fields of `ExtractedPaperStructure['questionParts']` in
 * `scope-reading/persistence.ts`.
 */
export interface QuestionPartCandidate<TAnchor> {
  readonly id: string;
  readonly label: string;
  readonly groupId: string;
  readonly instructionAnchor: TAnchor;
  /** The paper's own descriptor, verbatim. */
  readonly questionForm: string;
  /** Absent means the paper prints no marks on or beside the part: unknown, never zero. */
  readonly marks?: number;
  readonly dependsOn: PartDependencyCandidate;
}

export interface OutcomesExtractReadRequest<TAnchor> {
  readonly documentKind: OutcomesExtractDocumentKind;
  readonly passages: readonly OutcomeSourcePassage<TAnchor>[];
}

export interface OutcomesExtractReadResult<TAnchor> {
  readonly outcomes: readonly OutcomeCandidate<TAnchor>[];
  readonly paperStructure: {
    readonly sections: readonly PaperSectionCandidate<TAnchor>[];
    /**
     * The Worker's question groups (`ol-egov.141.89.7.21`), each anchor (and an identified
     * stimulus's anchor) resolved onto the caller's own anchor. ABSENT when the response carried
     * none: absent is not empty — an older Worker that never said is not a paper with no groups.
     * Carried in memory only; where they are stored waits on `[D-429]`.
     */
    readonly questionGroups?: readonly PaperQuestionGroup<TAnchor>[];
    /**
     * The Worker's question parts (`[D-431]`, prompt 1.2.0), each instruction anchor resolved onto
     * the caller's own anchor. ABSENT when the response carried none: absent is not empty.
     */
    readonly questionParts?: readonly QuestionPartCandidate<TAnchor>[];
    /** The paper's stated total marks. ABSENT when the paper states none: unknown, never zero. */
    readonly totalMarks?: number;
    /** The paper's stated time allowance in whole minutes. ABSENT when the paper states none. */
    readonly timeAllowanceMinutes?: number;
  };
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
    const questionGroups = readQuestionGroupProposals(response, passages);
    const questionParts = readQuestionPartProposals(response, passages);
    const totalMarks = readStatedPaperNumber(
      response,
      passages,
      'totalMarks',
      'total marks',
      false,
    );
    const timeAllowanceMinutes = readStatedPaperNumber(
      response,
      passages,
      'timeAllowanceMinutes',
      'time allowance',
      true,
    );
    return {
      outcomes,
      // Every key past `sections` is present only when the response carried it, so a response
      // from before it existed reads to exactly the object it always did.
      paperStructure: {
        sections,
        ...(questionGroups !== undefined ? { questionGroups } : {}),
        ...(questionParts !== undefined ? { questionParts } : {}),
        ...(totalMarks !== undefined ? { totalMarks } : {}),
        ...(timeAllowanceMinutes !== undefined ? { timeAllowanceMinutes } : {}),
      },
    };
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
  const marks = readOptionalMarks(entry.marks, `paper section ${index} ("${label}")`);
  const anchorPassage = resolveAnchor(
    entry.anchorIndex,
    passages,
    `paper section ${index} ("${label}")`,
  );
  return {
    label,
    questionForm,
    itemCount,
    ...(marks !== undefined ? { marks } : {}),
    anchor: anchorPassage.anchor,
  };
}

/**
 * Marks the paper states, or `undefined` for marks it does not (`[D-431]`): an absent field, and an
 * explicit `null`, are both "not stated" and never become zero. Anything else that is not a
 * non-negative number is a stated value this reader cannot trust, and is refused rather than read
 * as unknown (guessing which it was would be inventing). A printed `0` is a stated value.
 */
function readOptionalMarks(marks: unknown, describe: string): number | undefined {
  if (marks === undefined || marks === null) return undefined;
  if (typeof marks !== 'number' || Number.isNaN(marks) || marks < 0) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: ${describe} carried no valid marks.`,
    );
  }
  return marks;
}

function readQuestionGroupProposals<TAnchor>(
  response: Record<string, unknown>,
  passages: readonly OutcomeSourcePassage<TAnchor>[],
): readonly PaperQuestionGroup<TAnchor>[] | undefined {
  const paperStructure = readResult(response).paperStructure;
  const container =
    typeof paperStructure === 'object' && paperStructure !== null
      ? (paperStructure as Record<string, unknown>)
      : {};
  const raw = container.questionGroups;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new OutcomesExtractReaderError(
      'WorkerOutcomesExtractReader: the Worker response carried a `result.paperStructure.questionGroups` that was not an array.',
    );
  }
  return raw.map((entry, index) => toQuestionGroup(entry, passages, index));
}

function toQuestionGroup<TAnchor>(
  raw: unknown,
  passages: readonly OutcomeSourcePassage<TAnchor>[],
  index: number,
): PaperQuestionGroup<TAnchor> {
  const entry = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const describe = `question group ${index}`;
  const { id, label, kind, parentGroupId, memberLabels, choose } = entry;
  if (typeof id !== 'string' || id.length === 0) {
    throw new OutcomesExtractReaderError(`WorkerOutcomesExtractReader: ${describe} carried no id.`);
  }
  if (typeof label !== 'string' || label.length === 0) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: ${describe} carried no label.`,
    );
  }
  if (!(PAPER_QUESTION_GROUP_KINDS as readonly unknown[]).includes(kind)) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: ${describe} carried an unknown kind.`,
    );
  }
  if (
    !Array.isArray(memberLabels) ||
    memberLabels.length === 0 ||
    !memberLabels.every((m) => typeof m === 'string' && m.length > 0)
  ) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: ${describe} carried no valid memberLabels.`,
    );
  }
  if (parentGroupId !== undefined && (typeof parentGroupId !== 'string' || parentGroupId === '')) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: ${describe} carried an invalid parentGroupId.`,
    );
  }
  if (
    choose !== undefined &&
    (typeof choose !== 'number' || !Number.isInteger(choose) || choose < 1)
  ) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: ${describe} carried an invalid choose.`,
    );
  }
  const anchor = resolveAnchor(entry.anchorIndex, passages, describe).anchor;
  return {
    id,
    kind: kind as PaperQuestionGroupKind,
    label,
    ...(parentGroupId !== undefined ? { parentGroupId } : {}),
    memberLabels: memberLabels as string[],
    ...(choose !== undefined ? { choose } : {}),
    anchor,
    stimulus: toStimulus(entry.stimulus, passages, describe),
  };
}

function readPaperStructureContainer(response: Record<string, unknown>): Record<string, unknown> {
  const paperStructure = readResult(response).paperStructure;
  return typeof paperStructure === 'object' && paperStructure !== null
    ? (paperStructure as Record<string, unknown>)
    : {};
}

/** `undefined` (absent, not empty) when the response carried no `questionParts`. */
function readQuestionPartProposals<TAnchor>(
  response: Record<string, unknown>,
  passages: readonly OutcomeSourcePassage<TAnchor>[],
): readonly QuestionPartCandidate<TAnchor>[] | undefined {
  const raw = readPaperStructureContainer(response).questionParts;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new OutcomesExtractReaderError(
      'WorkerOutcomesExtractReader: the Worker response carried a `result.paperStructure.questionParts` that was not an array.',
    );
  }
  return raw.map((entry, index) => toQuestionPart(entry, passages, index));
}

function toQuestionPart<TAnchor>(
  raw: unknown,
  passages: readonly OutcomeSourcePassage<TAnchor>[],
  index: number,
): QuestionPartCandidate<TAnchor> {
  const entry = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const describe = `question part ${index}`;
  const { id, label, groupId, questionForm } = entry;
  if (typeof id !== 'string' || id.length === 0) {
    throw new OutcomesExtractReaderError(`WorkerOutcomesExtractReader: ${describe} carried no id.`);
  }
  if (typeof label !== 'string' || label.length === 0) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: ${describe} carried no label.`,
    );
  }
  if (typeof groupId !== 'string' || groupId.length === 0) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: ${describe} carried no groupId.`,
    );
  }
  if (typeof questionForm !== 'string' || questionForm.length === 0) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: ${describe} carried no questionForm.`,
    );
  }
  const marks = readOptionalMarks(entry.marks, describe);
  const instructionAnchor = resolveAnchor(
    entry.instructionAnchorIndex,
    passages,
    `${describe} instruction`,
  ).anchor;
  return {
    id,
    label,
    groupId,
    instructionAnchor,
    questionForm,
    ...(marks !== undefined ? { marks } : {}),
    dependsOn: toPartDependency(entry.dependsOn, describe),
  };
}

/** An absent dependency is unknown, never independent — the Worker's own default, restated. */
function toPartDependency(raw: unknown, describe: string): PartDependencyCandidate {
  if (raw === undefined) return { status: 'unknown' };
  const entry = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  if (entry.status === 'unknown') return { status: 'unknown' };
  if (entry.status === 'stated') {
    const ids = entry.onPartIds;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      throw new OutcomesExtractReaderError(
        `WorkerOutcomesExtractReader: ${describe} carried a stated dependency with no valid onPartIds.`,
      );
    }
    return { status: 'stated', onPartIds: ids as string[] };
  }
  throw new OutcomesExtractReaderError(
    `WorkerOutcomesExtractReader: ${describe} carried a dependency with an unknown status.`,
  );
}

/**
 * `paperStructure.totalMarks` or `.timeAllowanceMinutes`: `{ value, anchorIndex }` on the wire, a
 * plain number here (the stored shape keeps no anchor, but the anchor must still name a passage
 * that was sent, or the value is refused as ungrounded). `undefined` (absent, or an explicit
 * `null`) means the paper states none: unknown, never zero.
 */
function readStatedPaperNumber<TAnchor>(
  response: Record<string, unknown>,
  passages: readonly OutcomeSourcePassage<TAnchor>[],
  field: 'totalMarks' | 'timeAllowanceMinutes',
  describe: string,
  wholeMinutes: boolean,
): number | undefined {
  const raw = readPaperStructureContainer(response)[field];
  if (raw === undefined || raw === null) return undefined;
  const entry = typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const value = entry.value;
  const valid =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (wholeMinutes ? Number.isInteger(value) && value >= 1 : value >= 0);
  if (!valid) {
    throw new OutcomesExtractReaderError(
      `WorkerOutcomesExtractReader: the paper's ${describe} carried no valid value.`,
    );
  }
  resolveAnchor(entry.anchorIndex, passages, `the paper's ${describe}`);
  return value;
}

/** An absent stimulus is unknown, never "none" — the Worker's own default, restated. */
function toStimulus<TAnchor>(
  raw: unknown,
  passages: readonly OutcomeSourcePassage<TAnchor>[],
  describe: string,
): PaperStimulus<TAnchor> {
  if (raw === undefined) return { status: 'not-identified' };
  const entry = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { status, form, reason } = entry;
  const validForm = (PAPER_STIMULUS_FORMS as readonly unknown[]).includes(form);
  if (status === 'none') return { status: 'none' };
  if (status === 'identified') {
    if (!validForm) {
      throw new OutcomesExtractReaderError(
        `WorkerOutcomesExtractReader: ${describe} carried an identified stimulus with no valid form.`,
      );
    }
    const anchor = resolveAnchor(entry.anchorIndex, passages, `${describe} stimulus`).anchor;
    return { status: 'identified', form: form as PaperStimulusForm, anchor };
  }
  if (status === 'not-identified') {
    const validReason = (PAPER_STIMULUS_NOT_IDENTIFIED_REASONS as readonly unknown[]).includes(
      reason,
    );
    return {
      status: 'not-identified',
      ...(validForm ? { form: form as PaperStimulusForm } : {}),
      ...(validReason ? { reason: reason as PaperStimulusNotIdentifiedReason } : {}),
    };
  }
  throw new OutcomesExtractReaderError(
    `WorkerOutcomesExtractReader: ${describe} carried a stimulus with an unknown status.`,
  );
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
