/**
 * The pure half of the alignment driver (`ol-egov.141.89.7.52`, `[D-431]`): the closed concept
 * list's handles and descriptions, the batch plan with its omission ledger, the coverage record and
 * each call's view of it, aggregation per concept, and the four digests an alignment result is only
 * current against (`./scope-reading-types.ts`'s `AlignmentDigests`).
 *
 * **Why it is mechanism, and public.** Everything here is arithmetic, ordering and hashing over
 * values the caller passes in; it calls no model, reads no file and holds no state. The closed list
 * is built on her device from her own vault and travels only transiently (boundary document 2.1 and
 * 2.2: processing may be remote, storage is not); what a stored result keeps of it is a digest.
 * The prompt, the attestation rule and the model routing stay in the service: this module sees only
 * the prompt version and model id a response stamp carries.
 *
 * **Declared and measured constants.** The description cap and the run call cap are declared
 * (plain English, pinned, never fitted). The concept budget is measured: derivation private (D-191).
 *
 * **Digests.** Each is `sha256:` plus the hex of the canonical JSON of its preimage, so any device
 * recomputes the same text without coordinating. A reader recomputes them at read time to label a
 * stored result current or unverified, with no call.
 *
 * **Frozen configuration.** The digest covers the client's own settings plus the stamp's prompt
 * version and model id (the prompt version stands for the prompt and the attestation rule, the model
 * id for the seat). A prompt or model change therefore reads earlier results as unverified.
 *
 * Counts, ids and digests only (D-005): no function here logs or returns her wording except the
 * values it was handed.
 */

import { hashText } from '../ingestion/hash.js';
import { canonicalJson } from './canonical-json.js';
import type {
  AlignmentCoverageNote,
  AlignmentDigests,
  AlignmentOmissionReason,
  AlignmentResult,
} from './scope-reading-types.js';

export class AlignPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlignPlanError';
  }
}

// ------------------------------------------------------------------------------------------------
// Digests
// ------------------------------------------------------------------------------------------------

/** A digest as a result carries it: `sha256:` and the hex of the canonical JSON of `value`. */
export async function alignDigestOf(value: unknown): Promise<string> {
  return `sha256:${await hashText(canonicalJson(value))}`;
}

// ------------------------------------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------------------------------------

export const ALIGN_TASK_ID = 'outcomes.align.v1';

/** Declared: a concept's description is cut to at most this many characters, at a sentence end where one fits. A plain-English choice, never fitted. */
export const ALIGN_DESCRIPTION_CAP = 400;

/** Measured; derivation private (D-191). */
export const ALIGN_CONCEPT_BUDGET = 34;

/**
 * The most distinct passages one call carries on the records side. Arithmetic on the Worker's
 * ruled output ceiling, which was sized on a call of this many records, so it inherits that ruling.
 */
export const ALIGN_PASSAGE_BUDGET = 77;

/** Declared: the most alignment calls one run makes for one course and one document revision. Pairs past it are listed as omitted, never dropped. */
export const ALIGN_RUN_CALL_CAP = 8;

/** The omission ledger's closed list, in the precedence a pair's single reason is chosen by. */
export const ALIGN_OMISSION_REASONS = Object.freeze([
  'no-stable-key',
  'over-call-budget',
  'group-over-budget',
  'run-cap',
] as const satisfies readonly AlignmentOmissionReason[]);

/** A call made but not answered usably, kept apart from the omission reasons. */
export const ALIGN_CALL_FAILURE_REASONS = Object.freeze([
  'failed-alignment',
  'unavailable',
  'not-run',
] as const);

/** Every reason a pending result may be reached by, in the order its primary reason is chosen. */
export const ALIGN_PENDING_REASONS = Object.freeze([
  'document-not-read',
  ...ALIGN_OMISSION_REASONS,
  ...ALIGN_CALL_FAILURE_REASONS,
] as const);

export const ALIGN_CANNOT_TELL_REASONS = Object.freeze([
  'depends-on-unread-unit',
  'depends-on-figure',
  'ambiguous',
  'voided-by-check',
  'partly-read',
] as const);

export const ALIGN_DESCRIPTION_NONE_REASONS = Object.freeze([
  'no-source-recorded',
  'source-failed-check',
] as const);

export const ALIGN_DESCRIPTION_SOURCES = Object.freeze([
  'her-definition',
  'introducing-passage',
] as const);

export const ALIGN_AGGREGATION_RULE =
  'aggregation-v1: aligned > pending > cannot tell > not aligned';

const firstInOrder = <T extends string>(order: readonly T[], values: ReadonlySet<string>): T => {
  const found = order.find((reason) => values.has(reason));
  if (found === undefined) throw new AlignPlanError('aggregate: a reason outside its list.');
  return found;
};

// ------------------------------------------------------------------------------------------------
// Handles: short, stable, from the sorted order of the persisted keys, never from a name
// ------------------------------------------------------------------------------------------------

export const alignHandleFor = (ordinal: number): string => `c${String(ordinal).padStart(3, '0')}`;

export interface AlignHandleInput {
  readonly conceptId: string;
  readonly key: string | null;
  readonly stableKey: boolean;
}

/**
 * Assigns `c001`, `c002`, ... in the sorted order of the stable keys. A concept with no stable key
 * gets no handle: it is never sent and its pairs go to the ledger as `no-stable-key`.
 */
export function assignAlignHandles(
  concepts: readonly AlignHandleInput[],
): Map<string, string | null> {
  const stable = concepts
    .filter(
      (c): c is AlignHandleInput & { key: string } => c.stableKey && typeof c.key === 'string',
    )
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const seen = new Set<string>();
  for (const c of stable) {
    if (seen.has(c.key))
      throw new AlignPlanError('assignAlignHandles: two concepts share one key.');
    seen.add(c.key);
  }
  const out = new Map<string, string | null>(concepts.map((c) => [c.conceptId, null]));
  stable.forEach((c, i) => {
    out.set(c.conceptId, alignHandleFor(i + 1));
  });
  return out;
}

// ------------------------------------------------------------------------------------------------
// Descriptions: her verbatim definition, else the introducing passage, else none
// ------------------------------------------------------------------------------------------------

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Whitespace collapsed, case folded, substring: the containment rule extraction's own check uses. */
export function containsNormalised(source: unknown, span: unknown): boolean {
  if (typeof source !== 'string' || typeof span !== 'string') return false;
  const s = collapse(span);
  return s.length > 0 && collapse(source).includes(s);
}

// A sentence end: terminal punctuation, any closing quotes or brackets, then whitespace or the end.
const SENTENCE_END = /[.!?]+[)"'\]’”»]*(?=\s|$)/g;

export interface CutDescription {
  readonly text: string;
  readonly truncated?: { readonly fullLength: number };
  readonly cutAt?: 'sentence-end' | 'word-boundary' | 'cap';
}

/**
 * Cuts a description to `cap` characters at the last sentence end inside the cap; failing that at
 * the last whitespace inside it (never mid-word); only an unbroken token longer than the cap is cut
 * at the cap itself. A cut is never silent: it carries the full length.
 */
export function cutAlignDescription(fullText: string, cap: number): CutDescription {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new AlignPlanError('cutAlignDescription: cap must be a positive integer.');
  }
  const text = fullText.trim();
  if (text.length <= cap) return { text };
  let end = -1;
  for (const m of text.matchAll(SENTENCE_END)) {
    const e = (m.index ?? 0) + m[0].length;
    if (e <= cap) end = e;
    else break;
  }
  if (end > 0) {
    return {
      text: text.slice(0, end).trimEnd(),
      truncated: { fullLength: text.length },
      cutAt: 'sentence-end',
    };
  }
  const window = text.slice(0, cap + 1);
  const ws = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'), window.lastIndexOf('\t'));
  if (ws > 0) {
    const cut = text.slice(0, ws).trimEnd();
    if (cut.length > 0) {
      return { text: cut, truncated: { fullLength: text.length }, cutAt: 'word-boundary' };
    }
  }
  return { text: text.slice(0, cap), truncated: { fullLength: text.length }, cutAt: 'cap' };
}

export interface AlignDescriptionSource {
  /** `ConceptRecord.definition`, verbatim. */
  readonly definition?: string | null;
  /** The bound note is a registered assessment document: excluded. */
  readonly definitionSourceIsAssessment?: boolean;
  /** The definition is found in its bound note (normalised containment). */
  readonly definitionFoundInSource?: boolean | null;
  /** The introducing passage. */
  readonly anchor?: {
    readonly text: string;
    readonly sourceIsAssessment: boolean;
    readonly foundInSource: boolean;
  } | null;
}

export interface ChosenDescription {
  readonly description?: {
    readonly text: string;
    readonly source: 'her-definition' | 'introducing-passage';
    readonly truncated?: { readonly fullLength: number };
  };
  readonly descriptionNone?: 'no-source-recorded' | 'source-failed-check';
  readonly cutAt?: string;
  readonly failures: readonly { readonly source: string; readonly failure: string }[];
}

/** Chooses one concept's description, checked by code before it is sent. A concept is never dropped for lacking one. */
export function chooseAlignDescription(
  source: AlignDescriptionSource,
  cap: number,
): ChosenDescription {
  const failures: { source: string; failure: string }[] = [];
  const candidates = [
    {
      kind: 'her-definition' as const,
      text: typeof source.definition === 'string' ? source.definition : '',
      excluded: source.definitionSourceIsAssessment === true,
      found: source.definitionFoundInSource === true,
    },
    {
      kind: 'introducing-passage' as const,
      text: typeof source.anchor?.text === 'string' ? source.anchor.text : '',
      excluded: source.anchor?.sourceIsAssessment === true,
      found: source.anchor?.foundInSource === true,
    },
  ];
  for (const c of candidates) {
    if (c.text.trim() === '') continue;
    if (c.excluded) {
      failures.push({ source: c.kind, failure: 'excluded-source' });
      continue;
    }
    if (!c.found) {
      failures.push({ source: c.kind, failure: 'not-found-in-source' });
      continue;
    }
    const cut = cutAlignDescription(c.text, cap);
    if (!containsNormalised(c.text, cut.text)) {
      failures.push({ source: c.kind, failure: 'cut-not-contained' });
      continue;
    }
    return {
      description: {
        text: cut.text,
        source: c.kind,
        ...(cut.truncated ? { truncated: cut.truncated } : {}),
      },
      ...(cut.cutAt ? { cutAt: cut.cutAt } : {}),
      failures,
    };
  }
  return {
    descriptionNone: failures.length > 0 ? 'source-failed-check' : 'no-source-recorded',
    failures,
  };
}

// ------------------------------------------------------------------------------------------------
// The batch plan and the omission ledger
// ------------------------------------------------------------------------------------------------

export interface PlanRecordInput {
  readonly recordId: string;
  /** A past-paper question group: every record with one group id travels together. */
  readonly groupId?: string;
  readonly passageRefs: readonly string[];
}

export interface PlanConceptInput {
  readonly conceptId: string;
  readonly handle: string | null;
}

export interface PlanOmission {
  readonly recordId: string;
  readonly conceptId: string;
  readonly reason: AlignmentOmissionReason;
}

export interface PlannedCall {
  readonly batchId: string;
  readonly recordIds: readonly string[];
  readonly conceptIds: readonly string[];
  readonly passageRefs: readonly string[];
}

export interface BatchPlan {
  readonly constants: {
    readonly passageBudget: number;
    readonly conceptBudget: number;
    readonly callCap: number;
  };
  readonly recordBatchCount: number;
  readonly conceptBatchCount: number;
  readonly calls: readonly PlannedCall[];
  readonly notMade: readonly {
    readonly batchId: string;
    readonly recordIds: readonly string[];
    readonly conceptIds: readonly string[];
  }[];
  readonly omitted: readonly PlanOmission[];
}

const positiveInt = (value: number, what: string): void => {
  if (!Number.isInteger(value) || value < 1) {
    throw new AlignPlanError(`planAlignBatches: ${what} must be a positive integer.`);
  }
};

/**
 * Splits both sides by constants and assigns every (record, concept) pair to exactly one call or to
 * the omission ledger with one reason, before any call is made; a pair in neither fails here.
 *
 * - Records are packed into batches in the order given by a passage budget (distinct passage refs
 *   per call). A question group is the atom and is never split. An atom over the budget is not cut:
 *   its pairs are omitted, `group-over-budget` for a group and `over-call-budget` for a lone record.
 * - Concepts with a handle are split into batches of `conceptBudget` in the order given. A concept
 *   with no handle is never sent: `no-stable-key`.
 * - One call per (records batch, concept batch), records-batch major. Calls past `callCap` are not
 *   made: their pairs are omitted, `run-cap`, and listed so they run first next time.
 *
 * `batchPrefix` is '' for the production ids `b1`, `b2`, ...; any other prefix gives `<prefix>-b1`.
 */
export function planAlignBatches(input: {
  readonly records: readonly PlanRecordInput[];
  readonly concepts: readonly PlanConceptInput[];
  readonly passageBudget: number;
  readonly conceptBudget: number;
  readonly callCap: number;
  readonly batchPrefix: string;
}): BatchPlan {
  const { records, concepts, passageBudget, conceptBudget, callCap, batchPrefix } = input;
  positiveInt(passageBudget, 'passageBudget');
  positiveInt(conceptBudget, 'conceptBudget');
  positiveInt(callCap, 'callCap');
  const recordIds = new Set<string>();
  for (const r of records) {
    if (recordIds.has(r.recordId)) {
      throw new AlignPlanError('planAlignBatches: record ids must be unique.');
    }
    recordIds.add(r.recordId);
  }
  const conceptIds = new Set<string>();
  for (const c of concepts) {
    if (conceptIds.has(c.conceptId)) {
      throw new AlignPlanError('planAlignBatches: concept ids must be unique.');
    }
    conceptIds.add(c.conceptId);
  }

  interface Atom {
    groupId: string | undefined;
    recordIds: string[];
    refs: Set<string>;
  }
  const atoms: Atom[] = [];
  const byGroup = new Map<string, Atom>();
  for (const r of records) {
    if (r.groupId !== undefined) {
      let atom = byGroup.get(r.groupId);
      if (atom === undefined) {
        atom = { groupId: r.groupId, recordIds: [], refs: new Set() };
        byGroup.set(r.groupId, atom);
        atoms.push(atom);
      }
      atom.recordIds.push(r.recordId);
      for (const ref of r.passageRefs) atom.refs.add(ref);
    } else {
      atoms.push({ groupId: undefined, recordIds: [r.recordId], refs: new Set(r.passageRefs) });
    }
  }

  const recordOmission = new Map<string, AlignmentOmissionReason>();
  const recordBatches: { recordIds: string[]; refs: Set<string> }[] = [];
  let current: { recordIds: string[]; refs: Set<string> } | null = null;
  for (const atom of atoms) {
    if (atom.refs.size > passageBudget) {
      const reason = atom.groupId !== undefined ? 'group-over-budget' : 'over-call-budget';
      for (const id of atom.recordIds) recordOmission.set(id, reason);
      continue;
    }
    const union: Set<string> | null = current ? new Set([...current.refs, ...atom.refs]) : null;
    if (current && union && union.size <= passageBudget) {
      current.recordIds.push(...atom.recordIds);
      current.refs = union;
    } else {
      current = { recordIds: [...atom.recordIds], refs: new Set(atom.refs) };
      recordBatches.push(current);
    }
  }

  const sendable = concepts.filter((c) => typeof c.handle === 'string');
  const conceptBatches: string[][] = [];
  for (let i = 0; i < sendable.length; i += conceptBudget) {
    conceptBatches.push(sendable.slice(i, i + conceptBudget).map((c) => c.conceptId));
  }

  const calls: PlannedCall[] = [];
  const notMade: PlannedCall[] = [];
  let n = 0;
  for (const rb of recordBatches) {
    for (const cb of conceptBatches) {
      n++;
      const call: PlannedCall = {
        batchId: `${batchPrefix === '' ? '' : `${batchPrefix}-`}b${n}`,
        recordIds: [...rb.recordIds],
        conceptIds: [...cb],
        passageRefs: [...rb.refs],
      };
      if (calls.length < callCap) calls.push(call);
      else notMade.push(call);
    }
  }

  const runCapPairs = new Set<string>();
  for (const call of notMade) {
    for (const r of call.recordIds) for (const c of call.conceptIds) runCapPairs.add(`${r}|${c}`);
  }
  const handleOf = new Map(concepts.map((c) => [c.conceptId, c.handle]));
  const omitted: PlanOmission[] = [];
  for (const r of records) {
    for (const c of concepts) {
      let reason: AlignmentOmissionReason | null = null;
      if (typeof handleOf.get(c.conceptId) !== 'string') reason = 'no-stable-key';
      else if (recordOmission.has(r.recordId)) reason = recordOmission.get(r.recordId) ?? null;
      else if (runCapPairs.has(`${r.recordId}|${c.conceptId}`)) reason = 'run-cap';
      if (reason !== null) omitted.push({ recordId: r.recordId, conceptId: c.conceptId, reason });
    }
  }

  const plan: BatchPlan = {
    constants: { passageBudget, conceptBudget, callCap },
    recordBatchCount: recordBatches.length,
    conceptBatchCount: conceptBatches.length,
    calls,
    notMade: notMade.map((c) => ({
      batchId: c.batchId,
      recordIds: c.recordIds,
      conceptIds: c.conceptIds,
    })),
    omitted,
  };
  assertAlignLedgerComplete(plan, records, concepts);
  return plan;
}

/** Every pair in exactly one call or in the ledger; anything else fails the run before any call. */
export function assertAlignLedgerComplete(
  plan: BatchPlan,
  records: readonly { readonly recordId: string }[],
  concepts: readonly { readonly conceptId: string }[],
): true {
  const where = new Map<string, string>();
  const mark = (key: string, place: string): void => {
    const known = where.get(key);
    if (known !== undefined) {
      throw new AlignPlanError(`ledger: a pair is accounted twice (${known} and ${place}).`);
    }
    where.set(key, place);
  };
  for (const call of plan.calls) {
    for (const r of call.recordIds)
      for (const c of call.conceptIds) mark(`${r}|${c}`, call.batchId);
  }
  for (const o of plan.omitted) {
    if (!(ALIGN_OMISSION_REASONS as readonly string[]).includes(o.reason)) {
      throw new AlignPlanError(`ledger: unknown omission reason ${o.reason}.`);
    }
    mark(`${o.recordId}|${o.conceptId}`, `omitted:${o.reason}`);
  }
  const expected = records.length * concepts.length;
  if (where.size !== expected) {
    throw new AlignPlanError(
      `ledger: ${expected - where.size} pair(s) are in no call and not in the ledger.`,
    );
  }
  for (const r of records) {
    for (const c of concepts) {
      if (!where.has(`${r.recordId}|${c.conceptId}`)) {
        throw new AlignPlanError('ledger: a pair is unaccounted.');
      }
    }
  }
  return true;
}

// ------------------------------------------------------------------------------------------------
// Coverage: the revision's record, and the view each call carries
// ------------------------------------------------------------------------------------------------

export type AlignCoverageState = 'read' | 'not-read' | 'unreadable';

export interface AlignCoverageUnitInput {
  readonly ref: string;
  readonly unitIndex: number;
  readonly state: AlignCoverageState;
  readonly reason?: string;
}

export interface RevisionCoverage {
  readonly revisionDigest: string;
  readonly units: readonly AlignCoverageUnitInput[];
  readonly digest: string;
}

/** The revision's coverage record: every unit, read or not. Its digest rides in every call and every answer echoes it. */
export async function alignRevisionCoverage(
  revisionDigest: string,
  units: readonly AlignCoverageUnitInput[],
): Promise<RevisionCoverage> {
  const clean = units.map((u) => ({
    ref: u.ref,
    unitIndex: u.unitIndex,
    state: u.state,
    ...(u.reason !== undefined ? { reason: u.reason } : {}),
  }));
  for (const u of clean) {
    if (!['read', 'not-read', 'unreadable'].includes(u.state)) {
      throw new AlignPlanError('coverage: unknown unit state.');
    }
  }
  return {
    revisionDigest,
    units: clean,
    digest: await alignDigestOf({ revision: revisionDigest, units: clean }),
  };
}

export interface AlignCallUnitView {
  readonly ref: string;
  readonly unitIndex: number;
  readonly state: 'sent' | 'sent-in-other-call' | 'read-not-sent' | 'not-read' | 'unreadable';
  readonly batchId?: string;
  readonly reason?: string;
}

/**
 * One call's view of the coverage record: every unit sits in exactly one set (sent here; sent in
 * another call of this run, by batch id; read but not sent, with a reason; not read or unreadable,
 * with its reason). No unit is invisible to the call.
 */
export function alignCoverageForCall(
  coverage: RevisionCoverage,
  call: { readonly batchId: string; readonly passageRefs: readonly string[] },
  madeCalls: readonly { readonly batchId: string; readonly passageRefs: readonly string[] }[],
  anchoredRefs: ReadonlySet<string>,
): AlignCallUnitView[] {
  const here = new Set(call.passageRefs);
  return coverage.units.map((u): AlignCallUnitView => {
    if (u.state !== 'read') {
      return {
        ref: u.ref,
        unitIndex: u.unitIndex,
        state: u.state,
        ...(u.reason !== undefined ? { reason: u.reason } : {}),
      };
    }
    if (here.has(u.ref)) return { ref: u.ref, unitIndex: u.unitIndex, state: 'sent' };
    const other = madeCalls.find(
      (c) => c.batchId !== call.batchId && c.passageRefs.includes(u.ref),
    );
    if (other) {
      return {
        ref: u.ref,
        unitIndex: u.unitIndex,
        state: 'sent-in-other-call',
        batchId: other.batchId,
      };
    }
    return {
      ref: u.ref,
      unitIndex: u.unitIndex,
      state: 'read-not-sent',
      reason: anchoredRefs.has(u.ref) ? 'record-not-sent' : 'no-record-anchored',
    };
  });
}

// ------------------------------------------------------------------------------------------------
// Aggregation per concept: order-invariant
// ------------------------------------------------------------------------------------------------

export type AlignPairVerdictKind =
  | { readonly kind: 'within-scope'; readonly refs: readonly number[] }
  | { readonly kind: 'not-within-scope' }
  | {
      readonly kind: 'cannot-tell';
      readonly reason:
        | 'ambiguous'
        | 'depends-on-unread-unit'
        | 'depends-on-figure'
        | 'voided-by-check';
    }
  | { readonly kind: 'omitted'; readonly reason: AlignmentOmissionReason }
  | { readonly kind: 'pending'; readonly reason: 'failed-alignment' | 'unavailable' };

export interface AlignPair {
  /** The persisted identity of the record: an Outcome id, or a structure part id. Never a wire id. */
  readonly recordId: string;
  readonly verdict: AlignPairVerdictKind;
}

export interface AggregatedConcept {
  readonly result: AlignmentResult;
  readonly coverage: AlignmentCoverageNote;
}

const countByReason = <T extends string>(reasons: readonly T[]): { reason: T; count: number }[] => {
  const counts = new Map<T, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([reason, count]) => ({ reason, count }));
};

/**
 * One concept's result over every pair it has, sent or omitted. In order:
 * - the document states nothing (`recordCount` is 0): not aligned, `states-no-scope`;
 * - aligned on any within-scope pair with surviving refs (record ids and unit ordinals, sorted);
 * - else pending if any pair was omitted (the ledger's reason) or its call was not answered usably;
 * - else cannot tell on a cannot-tell or voided pair, or any unit of the document not read;
 * - else not aligned, `searched`.
 * Every result carries its coverage note: the units not read and the pairs not sent, by reason.
 * Order of `pairs` never matters.
 */
export function aggregateAlignConcept(
  pairs: readonly AlignPair[],
  coverage: { readonly units: readonly AlignCoverageUnitInput[] },
  doc: { readonly recordCount: number },
): AggregatedConcept {
  const unitsNotRead = coverage.units
    .filter((u) => u.state !== 'read')
    .map((u) => ({ unit: u.ref, reason: u.reason ?? u.state }));
  const notSent = countByReason(
    pairs.flatMap((p) => (p.verdict.kind === 'omitted' ? [p.verdict.reason] : [])),
  );
  const note: AlignmentCoverageNote = {
    unitsNotRead,
    pairsNotSent: notSent,
  };
  const done = (result: AlignmentResult): AggregatedConcept => ({ result, coverage: note });

  if (doc.recordCount === 0) return done({ kind: 'not-aligned', reason: 'states-no-scope' });

  const within = pairs.filter(
    (p) => p.verdict.kind === 'within-scope' && p.verdict.refs.length > 0,
  );
  if (within.length > 0) {
    const refs = new Set<number>();
    for (const p of within) {
      if (p.verdict.kind === 'within-scope') for (const r of p.verdict.refs) refs.add(r);
    }
    return done({
      kind: 'aligned',
      recordIds: [...new Set(within.map((p) => p.recordId))].sort(),
      refs: [...refs].sort((a, b) => a - b),
    });
  }

  const pendingReasons = new Set<string>();
  for (const p of pairs) {
    if (p.verdict.kind === 'omitted' || p.verdict.kind === 'pending') {
      pendingReasons.add(p.verdict.reason);
    }
  }
  if (pendingReasons.size > 0) {
    const reason = firstInOrder(
      ALIGN_PENDING_REASONS.filter((r) => r !== 'document-not-read' && r !== 'not-run'),
      pendingReasons,
    );
    return done({ kind: 'pending', reason });
  }

  const cannotReasons = new Set<string>();
  for (const p of pairs) {
    if (p.verdict.kind === 'cannot-tell') cannotReasons.add(p.verdict.reason);
    else if (p.verdict.kind === 'within-scope' && p.verdict.refs.length === 0) {
      cannotReasons.add('voided-by-check');
    }
  }
  if (unitsNotRead.length > 0) cannotReasons.add('partly-read');
  if (cannotReasons.size > 0) {
    return done({
      kind: 'cannot-tell',
      reason: firstInOrder(ALIGN_CANNOT_TELL_REASONS, cannotReasons),
    });
  }
  return done({ kind: 'not-aligned', reason: 'searched' });
}

// ------------------------------------------------------------------------------------------------
// The four digests
// ------------------------------------------------------------------------------------------------

export interface ClosedListEntry {
  readonly key: string | null;
  readonly name: string;
  /** The course the concept is attributed to. */
  readonly attribution: string;
  /** SHA-256 hex of the sent description text, or null when none was sent. */
  readonly descriptionSha256: string | null;
}

/** The closed list's digest: one entry per concept, ordered by key (the order handles follow). */
export function alignClosedListDigest(entries: readonly ClosedListEntry[]): Promise<string> {
  return alignDigestOf(entries);
}

/** The preimage of the batch-plan digest. `structureId` is carried for a past paper only. */
export function alignBatchPlanPreimage(
  plan: BatchPlan,
  structureId?: string,
): Record<string, unknown> {
  return {
    constants: plan.constants,
    recordBatchCount: plan.recordBatchCount,
    conceptBatchCount: plan.conceptBatchCount,
    calls: plan.calls.map((c) => ({
      batchId: c.batchId,
      recordIds: c.recordIds,
      conceptIds: c.conceptIds,
    })),
    notMade: plan.notMade,
    omitted: plan.omitted,
    ...(structureId !== undefined ? { structureId } : {}),
  };
}

export function alignBatchPlanDigest(plan: BatchPlan, structureId?: string): Promise<string> {
  return alignDigestOf(alignBatchPlanPreimage(plan, structureId));
}

export interface FrozenConfigurationInput {
  readonly documentKind: 'objectives' | 'past-paper' | 'stated-scope';
  readonly descriptionCap: number;
  readonly conceptBudget: number;
  readonly passageBudget: number;
  readonly runCallCap: number;
  /** From the response stamp: the prompt version stands for the prompt and the attestation rule. */
  readonly promptVersion: string;
  /** From the response stamp: the model id stands for the seat. */
  readonly modelId: string;
  /** Which concepts a list holds: this course's only, until the other-course candidates have a client source. */
  readonly membership: string;
}

/** The preimage of the frozen-configuration digest (client half plus the stamp's two fields). */
export function alignFrozenConfigurationPreimage(
  input: FrozenConfigurationInput,
): Record<string, unknown> {
  return {
    taskId: ALIGN_TASK_ID,
    promptVersion: input.promptVersion,
    modelId: input.modelId,
    documentKind: input.documentKind,
    descriptionCap: input.descriptionCap,
    descriptionSources: ALIGN_DESCRIPTION_SOURCES,
    descriptionNoneReasons: ALIGN_DESCRIPTION_NONE_REASONS,
    conceptBudget: input.conceptBudget,
    passageBudget: input.passageBudget,
    runCallCap: input.runCallCap,
    omissionReasons: ALIGN_OMISSION_REASONS,
    pendingReasons: ALIGN_PENDING_REASONS,
    cannotTellReasons: ALIGN_CANNOT_TELL_REASONS,
    aggregationRule: ALIGN_AGGREGATION_RULE,
    membership: input.membership,
  };
}

export function alignFrozenConfigurationDigest(input: FrozenConfigurationInput): Promise<string> {
  return alignDigestOf(alignFrozenConfigurationPreimage(input));
}

export interface AlignDigestInputs {
  readonly closedList: readonly ClosedListEntry[];
  readonly coverage: RevisionCoverage;
  readonly plan: BatchPlan;
  readonly structureId?: string;
  readonly configuration: FrozenConfigurationInput;
}

/** The four digests a result is only current against. */
export async function alignDigests(input: AlignDigestInputs): Promise<AlignmentDigests> {
  return {
    closedList: await alignClosedListDigest(input.closedList),
    coverage: input.coverage.digest,
    batchPlan: await alignBatchPlanDigest(input.plan, input.structureId),
    frozenConfiguration: await alignFrozenConfigurationDigest(input.configuration),
  };
}
