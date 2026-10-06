/**
 * `WorkerDemandClassifyReader` — the client-side adapter for `demand.classify.v1` (`[D-431]`, David
 * 2026-09-29, decision sheet row 18; client half `ol-egov.141.89.7.33`). The service task is
 * `olea-service/src/tasks/demandClassify.ts`; its design authority is
 * `olea-service/docs/dev/intelligence-build/scp.md` section 2.3.
 *
 * **What it does.** One call reads ONE past-paper question part in its full context (the part's own
 * instruction, its section's heading and instruction, its group's stem and stimulus status, the
 * parts it depends on, its marks when stated), never the instruction verb alone, and reads the
 * answer back as the stored shape `ScopePartDemand` (`packages/core/src/outcome/scope-reading-types.ts`,
 * `[D-429]`'s part-demand store). It mirrors `WorkerOutcomesExtractReader`: a local mirrored task id
 * and contract version, a dedicated reader error distinct from the availability error, and no
 * `obsidian` import (INV-1).
 *
 * ## The four verdicts, kept apart, and what is never a verdict
 *
 * - `decided`: one of the five words of `[D-262]` (`PAPER_DEMANDS`);
 * - `compound`: exactly two DIFFERENT demands, in the order the part asks them;
 * - `unsupported`: an operation outside the five, kept as the paper's own instruction with its
 *   command word verbatim and its refs. **It is never coerced into a demand** (`[D-438]`
 *   condition 3, row 18): the reader has no path that turns an unfamiliar operation into one of the
 *   five, and a sixth demand is refused as a failure, not adopted;
 * - `cannot-tell`, with its reason.
 *
 * **Not yet read is absence.** No value here says it: a part that has not been read has no record
 * in the store, and this reader returns a verdict or throws. **Unavailable is operational**: an
 * outage is `DemandClassifyReaderUnavailableError` and an answer this reader cannot trust is
 * `DemandClassifyReaderError`; neither is ever stored as a verdict. The wire stage
 * (`ol-egov.141.89.7.5`) leaves the part unrecorded on either and retries.
 *
 * ## An answer it cannot trust is refused, not repaired
 *
 * The Worker already voids a verdict that cites nothing it sent and one that reads a printed result
 * on a stimulus that is not identified (`checkDemandClassify`), so a conforming answer never trips
 * the checks here; the reader repeats the ones it can decide from the request alone: a demand
 * outside the five, a compound that is not two different known demands, a decided, compound or
 * unsupported verdict with no ref, and a ref that names no passage sent as citable context (a stimulus
 * pointer, whose text is not in the request, is not one; whether a sent passage held anything
 * groundable is the Worker's check). Each is a failure of the call, never a
 * verdict. The command word is the Worker's to check (whole words, case-insensitive, against a
 * sent instruction); this reader carries it as the Worker returned it, and never maps one to a
 * demand by a table.
 *
 * ## Refs are the caller's ordinals
 *
 * Each sent passage carries the wire `ref` the Worker sees AND the client's own `unitIndex` (the
 * document's landed-unit ordinal, `ScopeReadingAnchor.unitIndex`). The ordinal is never sent (D-005);
 * the answer's refs are mapped back to it here, so the verdict speaks the stored shape's language
 * (`ScopePartDemand.refs`).
 *
 * **Reachability (`[D-072]`).** Constructed in production code by `runDemandDriver`
 * (`../scope-reading/demand-driver.ts`, `ol-egov.141.89.7.52`): after the structure reading is stored,
 * one call per part, the verdict written through `recordPartDemand`. That driver has no production
 * caller yet: `runScopeReadingDrivers` (`../scope-reading/drivers.ts`) is built and tested, and the one
 * call in `wiring.ts` waits on `[D-534]` (automatic spend) and on `ol-egov.141.89.7.68` releasing that
 * file. The paper item port (`../oracle/paper-item-port.ts`) is not its caller: it calls
 * `cards.generate.v1` and `quiz.generate.v1`. A workbench caller would not discharge it.
 */

import type {
  PaperDemand,
  PaperStimulusForm,
  ScopePartDemand,
  WorkerTaskTransport,
} from 'olea-core';
import { PAPER_DEMANDS } from 'olea-core';

/** `TASK_IDS.DEMAND_CLASSIFY` (`olea-contracts`, `f1ed01e`), mirrored so this module loads from plain Node. Pinned by this adapter's spec. */
export const DEMAND_CLASSIFY_TASK_ID = 'demand.classify.v1';

/** This task's contract version. */
export const DEMAND_CLASSIFY_CONTRACT_VERSION = 1;

/** One passage sent as context: the wire handle, the client's ordinal (never sent) and the text. */
export interface DemandClassifyPassage {
  readonly ref: string;
  readonly unitIndex: number;
  readonly text: string;
}

export type DemandClassifyStimulusStatus =
  | 'identified'
  | 'none'
  | 'not-identified'
  | 'described-figure';

export interface DemandClassifyReadRequest {
  readonly part: {
    readonly partId: string;
    /** How the paper numbers the part, local content. */
    readonly label: string;
    /** The part's OWN instruction. */
    readonly instruction: DemandClassifyPassage;
    readonly questionForm: string;
    /** Absent means unknown: never zero. */
    readonly marks?: number;
  };
  /** The section the part sits in: its heading and its instruction, each optional. */
  readonly section?: {
    readonly heading?: DemandClassifyPassage;
    readonly instruction?: DemandClassifyPassage;
  };
  readonly group: {
    /** The group's stem passages. Where an identified stimulus is to be READ, its text travels here. */
    readonly stem?: readonly DemandClassifyPassage[];
    readonly stimulus: {
      readonly status: DemandClassifyStimulusStatus;
      readonly form?: PaperStimulusForm;
      /** A pointer only: its text is not in the request, so it is not citable by itself. */
      readonly ref?: string;
      /** The perception chain's description of a figure, context and never a citable passage. */
      readonly description?: string;
    };
  };
  /** The earlier parts this one depends on, each with its own instruction as context. */
  readonly dependsOn?: readonly {
    readonly partId: string;
    readonly label: string;
    readonly instruction: DemandClassifyPassage;
  }[];
}

/** The response stamp's provenance fields (D7.3), which a stored verdict carries beside `task`. */
export interface DemandClassifyReadStamp {
  readonly promptVersion: string;
  readonly modelId: string;
}

export interface DemandClassifyReadResult {
  /** The verdict, in the stored shape. Never a "not yet read" and never an "unavailable". */
  readonly demand: ScopePartDemand;
  readonly stamp: DemandClassifyReadStamp;
}

const CANNOT_TELL_REASONS: readonly string[] = [
  'stimulus-not-identified',
  'ambiguous',
  'depends-on-figure',
  'no-surviving-ref',
];

/**
 * Distinct from a transport failure, so a caller can tell "the Worker is unreachable" from "the
 * Worker answered but this reader could not trust the answer" without string-matching a message.
 * `code` is the Worker's error code when it refused.
 */
export class DemandClassifyReaderError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DemandClassifyReaderError';
    this.code = code;
  }
}

/** `'offline'` (the transport failed before any response) or `'budget-exhausted'` (`quota-exceeded`): the part stays unread, never given a verdict. */
export class DemandClassifyReaderUnavailableError extends Error {
  readonly reason: 'offline' | 'budget-exhausted';
  constructor(reason: 'offline' | 'budget-exhausted', message: string) {
    super(message);
    this.name = 'DemandClassifyReaderUnavailableError';
    this.reason = reason;
  }
}

export interface WorkerDemandClassifyReaderDeps {
  readonly transport: WorkerTaskTransport;
}

export class WorkerDemandClassifyReader {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: WorkerDemandClassifyReaderDeps) {
    this.transport = deps.transport;
  }

  async read(request: DemandClassifyReadRequest): Promise<DemandClassifyReadResult> {
    citableUnitIndexes(request); // a request whose answer could not be mapped back is refused before a call is spent
    let body: unknown;
    try {
      body = await this.transport.send({
        contractVersion: DEMAND_CLASSIFY_CONTRACT_VERSION,
        taskId: DEMAND_CLASSIFY_TASK_ID,
        payload: toPayload(request),
      });
    } catch (error) {
      throw new DemandClassifyReaderUnavailableError(
        'offline',
        `WorkerDemandClassifyReader: the transport failed before any response arrived: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return readDemandClassifyResponse(body, request);
  }
}

/**
 * Reads one Worker envelope against the request that produced it: pure, no transport. For a caller
 * that already holds the body (a capturing transport, a replay) and for tests.
 */
export function readDemandClassifyResponse(
  body: unknown,
  request: DemandClassifyReadRequest,
): DemandClassifyReadResult {
  const response = readEnvelope(body);
  const stamp = readStamp(response);
  const result = readResult(response);

  const verdict = asObject(result.verdict);
  const commandWord = result.commandWord;
  if (commandWord !== undefined && (typeof commandWord !== 'string' || commandWord.length === 0)) {
    throw new DemandClassifyReaderError(
      'WorkerDemandClassifyReader: the answer carried a command word that was not a string.',
    );
  }

  if (verdict.kind === 'cannot-tell') {
    const reason = verdict.reason;
    if (typeof reason !== 'string' || !CANNOT_TELL_REASONS.includes(reason)) {
      throw new DemandClassifyReaderError(
        'WorkerDemandClassifyReader: the answer carried a cannot-tell with no known reason.',
      );
    }
    // A cannot-tell carries no refs and no command word: it read nothing it can point at.
    return { demand: { status: 'cannot-tell', reason }, stamp };
  }

  if (verdict.kind !== 'demand' && verdict.kind !== 'compound' && verdict.kind !== 'unsupported') {
    throw new DemandClassifyReaderError(
      'WorkerDemandClassifyReader: the answer carried a verdict of an unknown kind.',
    );
  }
  const refs = toRefs(result.refs, citableUnitIndexes(request));
  const word = commandWord === undefined ? {} : { commandWord };

  if (verdict.kind === 'demand') {
    return {
      demand: { status: 'decided', demand: toDemand(verdict.demand), ...word, refs },
      stamp,
    };
  }
  if (verdict.kind === 'compound') {
    const demands = verdict.demands;
    if (!Array.isArray(demands) || demands.length !== 2) {
      throw new DemandClassifyReaderError(
        'WorkerDemandClassifyReader: a compound verdict must name exactly two demands.',
      );
    }
    const first = toDemand(demands[0]);
    const second = toDemand(demands[1]);
    if (first === second) {
      throw new DemandClassifyReaderError(
        'WorkerDemandClassifyReader: a compound verdict must name two different demands.',
      );
    }
    return { demand: { status: 'compound', demands: [first, second], ...word, refs }, stamp };
  }
  // `unsupported`: the paper's own operation, kept with its command word and refs, never a demand.
  return { demand: { status: 'unsupported', ...word, refs }, stamp };
}

/** One of `PAPER_DEMANDS`, or a failure: a sixth demand is a Class C addition, not something to adopt. */
function toDemand(value: unknown): PaperDemand {
  if (!(PAPER_DEMANDS as readonly unknown[]).includes(value)) {
    throw new DemandClassifyReaderError(
      'WorkerDemandClassifyReader: the answer named a demand outside the five.',
    );
  }
  return value as PaperDemand;
}

/** The cited refs as unit ordinals, in first-cited order, each a passage sent as citable context. At least one. */
function toRefs(raw: unknown, unitIndexByRef: ReadonlyMap<string, number>): readonly number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DemandClassifyReaderError(
      'WorkerDemandClassifyReader: a decided, compound or unsupported verdict must cite at least one passage.',
    );
  }
  const ordinals: number[] = [];
  for (const ref of raw) {
    const ordinal = typeof ref === 'string' ? unitIndexByRef.get(ref) : undefined;
    if (ordinal === undefined) {
      throw new DemandClassifyReaderError(
        'WorkerDemandClassifyReader: the answer cited a ref that names no passage sent as citable context.',
      );
    }
    if (!ordinals.includes(ordinal)) ordinals.push(ordinal);
  }
  return ordinals;
}

/**
 * The passages a verdict may cite, each wire ref to its unit ordinal: the part's instruction, the
 * section's heading and instruction, the group's stem and the dependencies' instructions. A
 * stimulus pointer and a figure description are not among them. Refuses a ref standing for two
 * different units.
 */
function citableUnitIndexes(request: DemandClassifyReadRequest): ReadonlyMap<string, number> {
  const passages: DemandClassifyPassage[] = [
    request.part.instruction,
    ...(request.section?.heading ? [request.section.heading] : []),
    ...(request.section?.instruction ? [request.section.instruction] : []),
    ...(request.group.stem ?? []),
    ...(request.dependsOn ?? []).map((dependency) => dependency.instruction),
  ];
  const byRef = new Map<string, number>();
  for (const passage of passages) {
    const known = byRef.get(passage.ref);
    if (known !== undefined && known !== passage.unitIndex) {
      throw new DemandClassifyReaderError(
        'WorkerDemandClassifyReader: one ref stands for two different units in this request, so an answer could not be mapped back.',
      );
    }
    byRef.set(passage.ref, passage.unitIndex);
  }
  return byRef;
}

/** The wire payload: the request as the Worker's schema names it, with every client-only ordinal left behind. */
function toPayload(request: DemandClassifyReadRequest): Record<string, unknown> {
  const sent = (passage: DemandClassifyPassage) => ({ ref: passage.ref, text: passage.text });
  const { part, section, group, dependsOn } = request;
  return {
    part: {
      partId: part.partId,
      label: part.label,
      instruction: sent(part.instruction),
      questionForm: part.questionForm,
      ...(part.marks !== undefined ? { marks: part.marks } : {}),
    },
    ...(section !== undefined
      ? {
          section: {
            ...(section.heading !== undefined ? { heading: sent(section.heading) } : {}),
            ...(section.instruction !== undefined
              ? { instruction: sent(section.instruction) }
              : {}),
          },
        }
      : {}),
    group: {
      ...(group.stem !== undefined ? { stem: group.stem.map(sent) } : {}),
      stimulus: {
        status: group.stimulus.status,
        ...(group.stimulus.form !== undefined ? { form: group.stimulus.form } : {}),
        ...(group.stimulus.ref !== undefined ? { ref: group.stimulus.ref } : {}),
        ...(group.stimulus.description !== undefined
          ? { description: group.stimulus.description }
          : {}),
      },
    },
    ...(dependsOn !== undefined
      ? {
          dependsOn: dependsOn.map((dependency) => ({
            partId: dependency.partId,
            label: dependency.label,
            instruction: sent(dependency.instruction),
          })),
        }
      : {}),
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function readEnvelope(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) {
    throw new DemandClassifyReaderError(
      'WorkerDemandClassifyReader: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response.ok === false) {
    const code = typeof response.code === 'string' ? response.code : undefined;
    const message = typeof response.message === 'string' ? response.message : 'no message supplied';
    if (code === 'quota-exceeded') {
      throw new DemandClassifyReaderUnavailableError(
        'budget-exhausted',
        `WorkerDemandClassifyReader: ${message}`,
      );
    }
    throw new DemandClassifyReaderError(
      `WorkerDemandClassifyReader: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response.ok !== true) {
    throw new DemandClassifyReaderError(
      'WorkerDemandClassifyReader: the Worker response carried no `ok` discriminant.',
    );
  }
  return response;
}

/** D7.3: the real stamp off THIS response, never a guess. A result without one is discarded. */
function readStamp(response: Record<string, unknown>): DemandClassifyReadStamp {
  const { promptVersion, modelId } = asObject(response.stamp);
  if (
    typeof promptVersion !== 'string' ||
    promptVersion.length === 0 ||
    typeof modelId !== 'string' ||
    modelId.length === 0
  ) {
    throw new DemandClassifyReaderError(
      'WorkerDemandClassifyReader: the Worker response carried no D7.3 stamp (promptVersion and modelId).',
    );
  }
  return { promptVersion, modelId };
}

function readResult(response: Record<string, unknown>): Record<string, unknown> {
  const result = response.result;
  if (typeof result !== 'object' || result === null) {
    throw new DemandClassifyReaderError(
      'WorkerDemandClassifyReader: the Worker response carried no `result` object.',
    );
  }
  return result as Record<string, unknown>;
}
