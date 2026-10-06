/**
 * `runAlignmentDriver` — aligns each registered course's concepts to a document's records and stores
 * one result per concept (`ol-egov.141.89.7.52`, `[D-429]`, `[D-431]`, scp.md S.3, S.4, S.6, S.11).
 *
 * **What it does, per registered course.** Builds the course's closed concept list from her vault
 * (`./closed-list.ts`), the records from what the extraction recorded (an objectives document's
 * active declarations, or a past paper's parts inside their groups), the coverage record of the
 * delivery's units, and the batch plan with its omission ledger (`olea-core`'s
 * `scope-alignment-plan.ts`, which also holds the digests). It then makes the planned calls one at a
 * time through `WorkerOutcomesAlignReader`, aggregates every pair per concept, and writes the whole
 * course's results in one `recordAlignmentResults`.
 *
 * **When it runs (AT-1, a Class B default).** Only when this delivery is the whole revision: it
 * carries the revision digest, that digest equals the manifest basis's, and the delivery's unit pages
 * are exactly the pages the manifest names. Otherwise nothing is written: absence reads "not yet
 * known", never "not aligned". A later ruling on `ol-egov.141.89.7.68` replaces this predicate.
 *
 * **Never a verdict it did not earn.** An unreachable or over-budget service leaves that call's and
 * every later call's pairs pending (`unavailable`); a reader refusal or a mixed configuration (a
 * call whose stamp differs from the run's first) makes that call's pairs pending
 * (`failed-alignment`). Pending results carry no reader provenance. A document read and found to
 * state nothing writes `states-no-scope` for every keyed concept with no call, attributed to the
 * extraction's reader.
 *
 * **No repeat spend.** Before any call, the closed-list, coverage and batch-plan digests are compared
 * with the stored results; when every keyed concept already has a settled (non-pending) result
 * current against all three, nothing is sent. The frozen-configuration digest is not in that
 * comparison: it covers the response stamp's prompt version and model id, which only a call returns.
 *
 * Aligned `recordIds` are the persisted identities (Outcome ids, structure part ids), never wire ids;
 * every wire ref is `u<ordinal>`; nothing path- or title-derived crosses (D-005). A past paper's
 * structure id goes only into the batch-plan digest (`[D-534]` part 2, option i).
 *
 * Every failure is logged content-free and swallowed. This module constructs
 * `WorkerOutcomesAlignReader`, its production construction site; the driver has no production caller
 * until `wiring.ts` calls `runScopeReadingDrivers` (waits on `[D-534]` and `ol-egov.141.89.7.68`).
 */

import {
  ALIGN_CONCEPT_BUDGET,
  ALIGN_DESCRIPTION_CAP,
  ALIGN_PASSAGE_BUDGET,
  ALIGN_RUN_CALL_CAP,
  type AlignCoverageUnitInput,
  type AlignmentCoverageNote,
  type AlignmentResult,
  type AlignPair,
  aggregateAlignConcept,
  alignBatchPlanDigest,
  alignClosedListDigest,
  alignCoverageForCall,
  alignFrozenConfigurationDigest,
  alignmentResultsForDocument,
  alignRevisionCoverage,
  assignAlignHandles,
  type BatchPlan,
  type ClosedListEntry,
  chooseAlignDescription,
  type ExtractedUnit,
  type FrozenConfigurationInput,
  hashText,
  type OutcomeRecord,
  type PlanRecordInput,
  planAlignBatches,
  type VaultSource,
  type WorkerTaskTransport,
} from 'olea-core';
import {
  type AlignConcept,
  type AlignRecord,
  OutcomesAlignReaderError,
  OutcomesAlignReaderUnavailableError,
  type OutcomesAlignReadRequest,
  type OutcomesAlignReadResult,
  WorkerOutcomesAlignReader,
} from '../ingestion/outcomes-align-adapter.js';
import type { DocumentReadingBasis } from './basis.js';
import { buildClosedList, CLOSED_LIST_MEMBERSHIP, type ClosedListConcept } from './closed-list.js';
import {
  groupChain,
  identifiedStimulus,
  type PartRefusalLedger,
  passageAt,
  REFUSED_PART_LIMIT,
  stemAnchors,
  wireRef,
} from './demand-driver.js';
import {
  type DocumentRef,
  type ExtractionStamp,
  type RecordedExtraction,
  SCOPE_READING_ALIGN_TASK,
  SCOPE_READING_EXTRACT_TASK,
  type ScopeReadingPersistence,
} from './persistence.js';

export interface AlignmentDriverInput {
  readonly persistence: ScopeReadingPersistence;
  readonly ref: DocumentRef;
  readonly basis: DocumentReadingBasis;
  readonly recorded: RecordedExtraction;
  readonly units: readonly ExtractedUnit[];
  readonly deliveryRevisionDigest?: string;
  readonly courses: readonly string[];
  readonly declarations: readonly OutcomeRecord[];
  readonly transport: WorkerTaskTransport;
  readonly vault: VaultSource;
  /** Vault paths of registered assessment documents, excluded as description sources. */
  readonly assessmentPaths?: ReadonlySet<string>;
  /**
   * Held-back batches (`ol-egov.141.89.7.84`): a batch the reader answered unusably
   * {@link REFUSED_PART_LIMIT} times under one batch plan is not sent again. Absent: no limit. The
   * count is the caller's; `runScopeReadingDrivers` and `resumeScopeReading` default to the session ledger.
   */
  readonly refusals?: PartRefusalLedger;
}

export interface AlignmentDriverResult {
  /** Why nothing ran, or `'ran'`. */
  readonly outcome: 'ran' | 'not-whole-revision' | 'no-reading' | 'nothing-to-align';
  readonly calls: number;
  readonly written: number;
  /** Batches not sent because the reader refused them {@link REFUSED_PART_LIMIT} times. Absent when none. */
  readonly heldBack?: number;
}

/**
 * AT-1: this delivery is the whole revision. It carries the revision digest, that digest is the
 * basis's, and its unit pages are exactly the pages the manifest names.
 */
export function isWholeRevision(input: {
  readonly basis: DocumentReadingBasis;
  readonly units: readonly ExtractedUnit[];
  readonly deliveryRevisionDigest?: string;
}): boolean {
  const { basis, units, deliveryRevisionDigest } = input;
  if (deliveryRevisionDigest === undefined || deliveryRevisionDigest !== basis.revisionDigest) {
    return false;
  }
  if (basis.pages === undefined || units.length === 0) return false;
  const delivered = [...new Set(units.map((unit) => unit.provenance.location.page))].sort(
    (a, b) => a - b,
  );
  return (
    delivered.length === basis.pages.length &&
    delivered.every((page, i) => page === basis.pages?.[i])
  );
}

interface PlanRecord {
  /** The persisted identity: an Outcome id, or a structure part id. */
  readonly id: string;
  readonly wireId: string;
  readonly wire: AlignRecord;
  readonly groupId?: string;
}

const sha256Hex = (text: string): Promise<string> => hashText(text);

const byOrder = (
  a: { sort: readonly (number | string)[] },
  b: { sort: readonly (number | string)[] },
) => {
  for (let i = 0; i < a.sort.length; i++) {
    const x = a.sort[i] as number | string;
    const y = b.sort[i] as number | string;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
};

/** The records of an objectives document: one per active declaration whose unit landed here. */
function objectiveRecords(
  ref: DocumentRef,
  units: readonly ExtractedUnit[],
  declarations: readonly OutcomeRecord[],
): PlanRecord[] {
  const usable = declarations
    .filter((o) => o.status === 'active' && o.source.path === ref.sourcePath)
    .map((o) => ({ outcome: o, passage: passageAt(units, o.source.blockIndex) }))
    .filter(
      (e): e is { outcome: OutcomeRecord; passage: NonNullable<typeof e.passage> } =>
        e.passage !== null,
    )
    .map((e) => ({ ...e, sort: [e.outcome.source.blockIndex, e.outcome.id] as const }))
    .sort(byOrder);
  return usable.map(({ outcome, passage }, i) => {
    const section = units[passage.unitIndex]?.provenance.location.section;
    return {
      id: outcome.id,
      wireId: `r${i + 1}`,
      wire: {
        recordId: `r${i + 1}`,
        kind: 'declaration',
        anchorRef: passage.ref,
        ...(section !== undefined ? { headingPath: [section] } : {}),
        passages: [
          { ref: passage.ref, unitIndex: passage.unitIndex, text: passage.text, role: 'record' },
        ],
      },
    };
  });
}

/** The records of a past paper: one per structure part, inside its group. A part whose units did not land is left out. */
function paperRecords(recorded: RecordedExtraction, units: readonly ExtractedUnit[]): PlanRecord[] {
  const reading = recorded.structure?.reading;
  if (reading?.parts === undefined) return [];
  const out: PlanRecord[] = [];
  for (const part of reading.parts) {
    const instruction = passageAt(units, part.instructionAnchor.unitIndex);
    if (instruction === null) continue;
    const chain = groupChain(reading, part);
    const own = chain[0];
    const stemUnits = stemAnchors(chain);
    const stimulusUnit = identifiedStimulus(chain);
    const passages: AlignRecord['passages'][number][] = [
      {
        ref: instruction.ref,
        unitIndex: instruction.unitIndex,
        text: instruction.text,
        role: 'record',
      },
    ];
    let ok = true;
    const add = (unitIndex: number, role: 'group-stem' | 'group-stimulus'): void => {
      if (passages.some((p) => p.ref === wireRef(unitIndex))) return;
      const found = passageAt(units, unitIndex);
      if (found === null) {
        ok = false;
        return;
      }
      passages.push({ ref: found.ref, unitIndex, text: found.text, role });
    };
    for (const unitIndex of stemUnits) add(unitIndex, 'group-stem');
    if (stimulusUnit !== undefined) add(stimulusUnit.unitIndex, 'group-stimulus');
    if (!ok) continue;
    const stimulus: NonNullable<AlignRecord['group']>['stimulus'] =
      stimulusUnit !== undefined
        ? { status: 'identified', form: stimulusUnit.form, ref: wireRef(stimulusUnit.unitIndex) }
        : own?.stimulus.status === 'none'
          ? { status: 'none' }
          : {
              status: 'not-identified',
              ...(own?.stimulus.status === 'not-identified' && own.stimulus.form !== undefined
                ? { form: own.stimulus.form }
                : {}),
            };
    out.push({
      id: part.id,
      wireId: part.id,
      ...(own !== undefined ? { groupId: own.id } : {}),
      wire: {
        recordId: part.id,
        kind: 'question-part',
        anchorRef: instruction.ref,
        ...(chain.length > 0 ? { headingPath: [...chain].reverse().map((g) => g.label) } : {}),
        passages,
        ...(own !== undefined ? { group: { groupId: own.id, kind: own.kind, stimulus } } : {}),
      },
    });
  }
  return out;
}

type CallOutcome =
  | { readonly kind: 'answered'; readonly read: OutcomesAlignReadResult }
  | { readonly kind: 'failed'; readonly reason: 'failed-alignment' | 'unavailable' };

/**
 * What a pass aligns. `all` is the delivery's full run. `owed` is the resume pass: only the concepts
 * whose result is absent, stale against the structure or coverage, pending on an outage or a refusal,
 * or still short of pairs past the run cap. `new` is the incremental pass: only the concepts with no
 * result at all (scp.md S.4, "a new concept in the course").
 */
export type AlignmentMode = 'all' | 'owed' | 'new';

type OwedClass = 'settled' | 'retry' | 'cap-remainder';

type StoredView = ReturnType<typeof alignmentResultsForDocument>[number];

const runCapCount = (view: StoredView): number =>
  view.coverage.pairsNotSent.find((p) => p.reason === 'run-cap')?.count ?? 0;

/**
 * Whether a keyed concept's stored result leaves work owed. The closed-list and batch-plan digests
 * are deliberately not asked: a closed list that grew leaves earlier results unverified yet usable
 * (scp.md S.6), and re-sending them would re-spend for no new answer.
 */
function owedClass(view: StoredView | undefined, mode: AlignmentMode): OwedClass {
  if (view === undefined) return 'retry';
  if (mode === 'new') return 'settled';
  if (view.status === 'unverified') return 'retry';
  if (view.result.kind === 'pending') {
    const { reason } = view.result;
    // An over-budget record or group stays over budget until the structure changes.
    if (reason === 'over-call-budget' || reason === 'group-over-budget') return 'settled';
    if (reason === 'no-stable-key') return 'settled';
    return reason === 'run-cap' ? 'cap-remainder' : 'retry';
  }
  return runCapCount(view) > 0 ? 'cap-remainder' : 'settled';
}

async function alignCourse(
  input: AlignmentDriverInput,
  course: string,
  records: readonly PlanRecord[],
  mode: AlignmentMode,
): Promise<{ calls: number; written: number; heldBack?: number }> {
  const { persistence, ref, recorded, units } = input;
  const statesNothing = recorded.state === 'read-states-nothing';

  // Part 4: the closed list. Entries by key; handles follow the sorted stable keys.
  const listed = await buildClosedList(input.vault, course, {
    ...(input.assessmentPaths !== undefined ? { assessmentPaths: input.assessmentPaths } : {}),
  });
  const handles = assignAlignHandles(listed);
  const chosen = new Map(
    listed.map((concept) => [
      concept.conceptId,
      chooseAlignDescription(concept.source, ALIGN_DESCRIPTION_CAP),
    ]),
  );
  const closedListEntries: ClosedListEntry[] = [];
  for (const concept of listed) {
    const text = chosen.get(concept.conceptId)?.description?.text;
    closedListEntries.push({
      key: concept.key,
      name: concept.name,
      attribution: concept.attribution.courseId,
      descriptionSha256:
        text !== undefined && handles.get(concept.conceptId) !== null
          ? await sha256Hex(text)
          : null,
    });
  }

  const coverageUnits: AlignCoverageUnitInput[] = units.map((_, i) => ({
    ref: wireRef(i),
    unitIndex: i,
    state: 'read',
  }));
  const coverage = await alignRevisionCoverage(ref.revisionDigest, coverageUnits);
  const planRecords: PlanRecordInput[] = records.map((r) => ({
    recordId: r.id,
    ...(r.groupId !== undefined ? { groupId: r.groupId } : {}),
    passageRefs: r.wire.passages.map((p) => p.ref),
  }));
  const plan: BatchPlan = planAlignBatches({
    records: planRecords,
    concepts: listed.map((c) => ({
      conceptId: c.conceptId,
      handle: handles.get(c.conceptId) ?? null,
    })),
    passageBudget: ALIGN_PASSAGE_BUDGET,
    conceptBudget: ALIGN_CONCEPT_BUDGET,
    callCap: ALIGN_RUN_CALL_CAP,
    batchPrefix: '',
  });
  const structureId =
    ref.documentKind === 'past-paper' ? recorded.structure?.structureId : undefined;
  // `[D-534]` 2-ii: a past-paper result names the structure its part ids came from. With none
  // recorded there is nothing to name, so nothing is called or written: absence, never a verdict.
  if (ref.documentKind === 'past-paper' && structureId === undefined) {
    return { calls: 0, written: 0 };
  }
  const closedList = await alignClosedListDigest(closedListEntries);
  const batchPlan = await alignBatchPlanDigest(plan, structureId);

  const keyed = listed.filter((c) => c.stableKey);
  let targets: readonly ClosedListConcept[] = listed;
  let runPlan: BatchPlan = plan;
  if (mode === 'all') {
    // Idempotency: every keyed concept already settled and current against the three digests.
    const existing = alignmentResultsForDocument(await persistence.load(), course, ref, {
      closedList,
      coverage: coverage.digest,
      batchPlan,
    });
    const settled = new Set(
      existing
        .filter((v) => v.status === 'current' && v.result.kind !== 'pending')
        .map((v) => v.conceptKey),
    );
    if (keyed.length > 0 && keyed.every((c) => settled.has(c.key))) {
      return { calls: 0, written: 0 };
    }
  } else {
    // Resume and incremental passes: only the owed concepts, planned on their own so the call cap
    // is spent on them. The digests stay the full plan's, so a resumed result reads current beside
    // the settled ones; each pair of an owed concept is still decided in exactly one call.
    const stored = new Map(
      alignmentResultsForDocument(await persistence.load(), course, ref, {
        coverage: coverage.digest,
      }).map((v) => [v.conceptKey, v]),
    );
    const classes = new Map(keyed.map((c) => [c.key, owedClass(stored.get(c.key), mode)] as const));
    const chosenKeys = new Set(
      keyed.filter((c) => classes.get(c.key) !== 'settled').map((c) => c.key),
    );
    const planFor = (keys: ReadonlySet<string>): BatchPlan =>
      planAlignBatches({
        records: planRecords,
        concepts: listed
          .filter((c) => keys.has(c.key))
          .map((c) => ({ conceptId: c.conceptId, handle: handles.get(c.conceptId) ?? null })),
        passageBudget: ALIGN_PASSAGE_BUDGET,
        conceptBudget: ALIGN_CONCEPT_BUDGET,
        callCap: ALIGN_RUN_CALL_CAP,
        batchPrefix: '',
      });
    let resumed = planFor(chosenKeys);
    // A remainder past the cap that this plan would leave as large as it is is not worth another spend.
    for (;;) {
      const stuck = [...chosenKeys].filter((key) => {
        if (classes.get(key) !== 'cap-remainder') return false;
        const view = stored.get(key);
        const still = resumed.omitted.filter(
          (o) => o.conceptId === key && o.reason === 'run-cap',
        ).length;
        return view !== undefined && still >= runCapCount(view);
      });
      if (stuck.length === 0) break;
      for (const key of stuck) chosenKeys.delete(key);
      resumed = planFor(chosenKeys);
    }
    if (chosenKeys.size === 0) return { calls: 0, written: 0 };
    targets = listed.filter((c) => chosenKeys.has(c.key));
    runPlan = resumed;
  }

  const configuration = (stamp: ExtractionStamp | undefined): FrozenConfigurationInput => ({
    documentKind: ref.documentKind,
    descriptionCap: ALIGN_DESCRIPTION_CAP,
    conceptBudget: ALIGN_CONCEPT_BUDGET,
    passageBudget: ALIGN_PASSAGE_BUDGET,
    runCallCap: ALIGN_RUN_CALL_CAP,
    promptVersion: stamp?.promptVersion ?? '',
    modelId: stamp?.modelId ?? '',
    membership: CLOSED_LIST_MEMBERSHIP,
  });

  // A document read and found to state nothing: every keyed concept, no call.
  if (statesNothing) {
    const frozenConfiguration = await alignFrozenConfigurationDigest(configuration(recorded.stamp));
    const digests = { closedList, coverage: coverage.digest, batchPlan, frozenConfiguration };
    const results = targets.map((concept) => ({
      conceptKey: concept.key,
      result: (concept.stableKey
        ? { kind: 'not-aligned', reason: 'states-no-scope' }
        : { kind: 'pending', reason: 'no-stable-key' }) as AlignmentResult,
      coverage: { unitsNotRead: [], pairsNotSent: [] } as AlignmentCoverageNote,
      ...(concept.stableKey
        ? {
            provenance: {
              task: SCOPE_READING_EXTRACT_TASK,
              promptVersion: recorded.stamp.promptVersion,
              modelId: recorded.stamp.modelId,
            },
          }
        : {}),
    }));
    if (results.length === 0) return { calls: 0, written: 0 };
    await persistence.recordAlignmentResults({
      ref,
      courseId: course,
      digests,
      ...(structureId !== undefined ? { structureId } : {}),
      results,
    });
    return { calls: 0, written: results.length };
  }

  // Calls, one at a time. The first stamp is the run's; a different one is a failed alignment.
  const reader = new WorkerOutcomesAlignReader({ transport: input.transport });
  const recordById = new Map(records.map((r) => [r.id, r]));
  const conceptByKey = new Map(listed.map((c) => [c.key, c]));
  const anchoredRefs = new Set(records.flatMap((r) => r.wire.passages.map((p) => p.ref)));
  const outcomes = new Map<string, CallOutcome>();
  let runStamp: ExtractionStamp | undefined;
  let unavailable = false;
  let made = 0;
  let heldBack = 0;
  for (const call of runPlan.calls) {
    if (unavailable) {
      outcomes.set(call.batchId, { kind: 'failed', reason: 'unavailable' });
      continue;
    }
    // The key names the course, the batch plan and the batch, so a changed plan starts at zero.
    const heldKey = `align|${course}|${batchPlan}|${call.batchId}`;
    if (input.refusals !== undefined && input.refusals.count(heldKey) >= REFUSED_PART_LIMIT) {
      heldBack++;
      outcomes.set(call.batchId, { kind: 'failed', reason: 'failed-alignment' });
      continue;
    }
    const request: OutcomesAlignReadRequest = {
      documentKind: ref.documentKind,
      batchId: call.batchId,
      courseContext: { courseId: course, courseName: course },
      coverage: {
        digest: coverage.digest,
        units: alignCoverageForCall(coverage, call, runPlan.calls, anchoredRefs),
      },
      records: call.recordIds.map((id) => (recordById.get(id) as PlanRecord).wire),
      concepts: call.conceptIds.map((key) =>
        alignConceptOf(
          conceptByKey.get(key) as ClosedListConcept,
          handles.get(key) as string,
          chosen.get(key) as ReturnType<typeof chooseAlignDescription>,
        ),
      ),
    };
    try {
      made++;
      const read = await reader.read(request);
      if (read.stamp !== undefined) {
        if (runStamp === undefined) {
          runStamp = { promptVersion: read.stamp.promptVersion, modelId: read.stamp.modelId };
        } else if (
          runStamp.promptVersion !== read.stamp.promptVersion ||
          runStamp.modelId !== read.stamp.modelId
        ) {
          console.error(
            'Olea: an alignment call answered under a different configuration; its pairs stay pending',
          );
          input.refusals?.record(heldKey);
          outcomes.set(call.batchId, { kind: 'failed', reason: 'failed-alignment' });
          continue;
        }
      }
      outcomes.set(call.batchId, { kind: 'answered', read });
    } catch (error) {
      if (error instanceof OutcomesAlignReaderUnavailableError) {
        console.error('Olea: alignment not read: the service is unavailable', {
          reason: error.reason,
        });
        unavailable = true;
        outcomes.set(call.batchId, { kind: 'failed', reason: 'unavailable' });
      } else {
        console.error('Olea: an alignment call was not answered usably (ingestion unaffected)', {
          error: error instanceof OutcomesAlignReaderError ? error.code : undefined,
        });
        input.refusals?.record(heldKey);
        outcomes.set(call.batchId, { kind: 'failed', reason: 'failed-alignment' });
      }
    }
  }

  // Pairs per concept: from the ledger, or from the call the pair was in.
  const omittedAt = new Map(runPlan.omitted.map((o) => [`${o.recordId}|${o.conceptId}`, o.reason]));
  const pairsByConcept = new Map<string, AlignPair[]>(targets.map((c) => [c.key, []]));
  for (const call of runPlan.calls) {
    const outcome = outcomes.get(call.batchId) as CallOutcome;
    const handleToKey = new Map(call.conceptIds.map((key) => [handles.get(key) as string, key]));
    for (const recordId of call.recordIds) {
      const readRecord =
        outcome.kind === 'answered'
          ? outcome.read.records.find(
              (r) => r.recordId === (recordById.get(recordId) as PlanRecord).wireId,
            )
          : undefined;
      for (const key of call.conceptIds) {
        const verdict: AlignPair['verdict'] = (() => {
          if (outcome.kind === 'failed')
            return { kind: 'pending', reason: outcome.reason } as const;
          const pair = readRecord?.pairs.find((p) => handleToKey.get(p.handle) === key);
          if (pair === undefined)
            return { kind: 'cannot-tell', reason: 'voided-by-check' } as const;
          const v = pair.verdict;
          if (v.kind === 'within-scope') return { kind: 'within-scope', refs: v.refs } as const;
          if (v.kind === 'not-within-scope') return { kind: 'not-within-scope' } as const;
          return {
            kind: 'cannot-tell',
            reason: v.reason,
          } as const;
        })();
        pairsByConcept.get(key)?.push({ recordId, verdict });
      }
    }
  }
  for (const [pair, reason] of omittedAt) {
    const [recordId, key] = pair.split('|') as [string, string];
    pairsByConcept.get(key)?.push({ recordId, verdict: { kind: 'omitted', reason } });
  }

  const frozenConfiguration = await alignFrozenConfigurationDigest(configuration(runStamp));
  const digests = { closedList, coverage: coverage.digest, batchPlan, frozenConfiguration };
  const results = targets.map((concept) => {
    const { result, coverage: note } = aggregateAlignConcept(
      pairsByConcept.get(concept.key) ?? [],
      coverage,
      { recordCount: records.length },
    );
    // A model-decided result needs a stamp; with none it cannot have been decided, so it is owed.
    const decided = result.kind !== 'pending';
    if (decided && runStamp === undefined) {
      return {
        conceptKey: concept.key,
        result: { kind: 'pending', reason: 'failed-alignment' } as AlignmentResult,
        coverage: note,
      };
    }
    return {
      conceptKey: concept.key,
      result,
      coverage: note,
      ...(decided && runStamp !== undefined
        ? { provenance: { task: SCOPE_READING_ALIGN_TASK, ...runStamp } }
        : {}),
    };
  });
  if (results.length === 0)
    return { calls: made, written: 0, ...(heldBack > 0 ? { heldBack } : {}) };
  await persistence.recordAlignmentResults({
    ref,
    courseId: course,
    digests,
    ...(structureId !== undefined ? { structureId } : {}),
    results,
  });
  return { calls: made, written: results.length, ...(heldBack > 0 ? { heldBack } : {}) };
}

function alignConceptOf(
  concept: ClosedListConcept,
  handle: string,
  description: ReturnType<typeof chooseAlignDescription>,
): AlignConcept {
  return {
    handle,
    name: concept.name,
    ...(description.description !== undefined
      ? { description: description.description }
      : { descriptionNone: description.descriptionNone ?? 'no-source-recorded' }),
    attribution: concept.attribution,
  };
}

export async function runAlignmentDriver(
  input: AlignmentDriverInput,
  mode: AlignmentMode = 'all',
): Promise<AlignmentDriverResult> {
  const { recorded, ref } = input;
  if (recorded.state !== 'recorded' && recorded.state !== 'read-states-nothing') {
    return { outcome: 'no-reading', calls: 0, written: 0 };
  }
  if (!isWholeRevision(input)) return { outcome: 'not-whole-revision', calls: 0, written: 0 };

  const records =
    recorded.state === 'read-states-nothing'
      ? []
      : ref.documentKind === 'past-paper'
        ? paperRecords(recorded, input.units)
        : ref.documentKind === 'objectives'
          ? objectiveRecords(ref, input.units, input.declarations)
          : [];
  if (recorded.state === 'recorded' && records.length === 0) {
    return { outcome: 'nothing-to-align', calls: 0, written: 0 };
  }

  let calls = 0;
  let written = 0;
  let heldBack = 0;
  for (const course of [...new Set(input.courses)].sort()) {
    try {
      const done = await alignCourse(input, course, records, mode);
      calls += done.calls;
      written += done.written;
      heldBack += done.heldBack ?? 0;
    } catch (error) {
      console.error('Olea: alignment results were not recorded (ingestion unaffected)', { error });
    }
  }
  return { outcome: 'ran', calls, written, ...(heldBack > 0 ? { heldBack } : {}) };
}
