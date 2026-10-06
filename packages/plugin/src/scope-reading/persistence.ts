/**
 * `createScopeReadingPersistence` — the plugin-side module that persists the examiner-scope reading
 * (`[D-429]`, ruled 2026-09-29, decision sheet row 16, option a) in Olea's own layer, and reads it
 * back with staleness labelled.
 *
 * **What it is.** A thin, obsidian-free adapter between what the extraction trigger already holds
 * after one `outcomes.extract.v1` call (`../ingestion/outcomes-extract-adapter.ts`'s result, the
 * response stamp, and the document's coverage) and `olea-core`'s scope-reading store
 * (`packages/core/src/outcome/scope-reading-store.ts`). It decides two things the store cannot:
 *
 * - **Which processing state the outcome of a call is.** An extraction that found something is
 *   `recorded`; one that found nothing over a document read IN FULL is `read-states-nothing` (an
 *   EMPTY result); one that found nothing over a document read only in part is `partly-read`, never
 *   empty — a document not yet fully read has not been shown to state nothing. `coverage` is
 *   therefore required input, so no caller can forget to say how much was read. An owed extraction
 *   (`recordPending`) is `pending` with its reason, and is never written as empty.
 * - **How today's reader shape maps onto the stored one.** Sections keep their marks as stated (the
 *   1.1.0 contract requires them; the `[D-431]` contract will let them be absent, which maps to
 *   unknown, never zero), groups carry over with their anchors turned into landed-unit ordinals, and
 *   parts, a paper total and a time allowance are carried when the reader supplies them and are
 *   absent otherwise (absent is not empty).
 *
 * **Write order is the safe order.** A structure reading is written BEFORE the state that says it
 * exists, so a `recorded` state always has its structure behind it; a crash between the two leaves
 * the earlier state, which reads as not yet known, never as a reading that is not there.
 *
 * **Reads never serve a stale reading as current.** `readDocument` takes the document's current
 * revision digest and the reader versions the caller accepts, and returns the state and structure
 * views labelled against them (`current`, `stale-revision`, `stale-reader`, or `absent`/`unknown`).
 * A structure written under a `partly-read` state is a partial reading: the state says so, so a
 * consumer of the structure reads the state beside it.
 *
 * **Reachability.** The writes are wired (`ol-egov.141.89.7.5`, client `b077cb4e`). The ingestion
 * trigger's `openScopeReadingWriter` (`../ingestion/wiring.ts:423`) opens this module at :443, and
 * `triggerOutcomesExtractForLandedUnit` (:641) writes through it: `recordPending` on an unavailable
 * Worker, a reader error or a failed call (:664, :697, :706), and `recordExtraction` after
 * `reconcileResolvedOutcomes` (:720). `main.ts:2064` supplies its `scopeReading` deps. Two more
 * writers, `recordPartDemand` and `recordAlignmentResults`, are called by the drivers
 * (`./drivers.ts`, `ol-egov.141.89.7.52`) with the structure id `recordExtraction` now returns; the
 * drivers have NO production caller yet: the one line in `wiring.ts` that calls
 * `runScopeReadingDrivers` waits on `[D-534]` (automatic spend) and on `ol-egov.141.89.7.68`
 * releasing that file. Two members still have no production caller (the wiring register's
 * `ScopeReadingStore` row): `recordRegistered`, which waits on registration wiring, and
 * `readDocument`, since nothing reads the store yet. Nothing here reaches a model or a network:
 * INV-1 (no `obsidian` import) and C6 (no server-side state) hold by construction.
 */

import {
  type AlignmentCoverageNote,
  type AlignmentDigests,
  type AlignmentResult,
  createScopeReadingStore,
  type DocumentStateView,
  documentStateView,
  type PaperQuestionGroup,
  type ReadingPolicy,
  type ScopeDocumentKind,
  type ScopePaperStructure,
  type ScopePartDemand,
  type ScopePartDependency,
  type ScopePendingReason,
  type ScopeReaderProvenance,
  type ScopeReadingAnchor,
  type ScopeReadingProjection,
  type ScopeReadingStore,
  type ScopeStructurePart,
  type ScopeStructureSection,
  type StructureView,
  structureView,
  type VaultSource,
} from 'olea-core';

/** The response stamp's provenance fields (`olea-contracts` `responseStamp`: `promptVersion`, `modelId`), which is what a caller has after one call. */
export interface ExtractionStamp {
  readonly promptVersion: string;
  readonly modelId: string;
}

/** The reader's task id — `OUTCOMES_EXTRACT_TASK_ID` in the adapter, restated so this module does not import the adapter's Worker plumbing. */
export const SCOPE_READING_EXTRACT_TASK = 'outcomes.extract.v1';

/** The demand reader's task id, restated for the same reason (`demand-classify-adapter.ts`'s `DEMAND_CLASSIFY_TASK_ID`). */
export const SCOPE_READING_DEMAND_TASK = 'demand.classify.v1';

/** The alignment reader's task id, restated for the same reason (`outcomes-align-adapter.ts`'s `OUTCOMES_ALIGN_TASK_ID`). */
export const SCOPE_READING_ALIGN_TASK = 'outcomes.align.v1';

/** What `recordExtraction` returns: the state it chose, and, when a structure was written or matched unchanged, its id and stored reading. */
export interface RecordedExtraction {
  readonly state: 'recorded' | 'read-states-nothing' | 'partly-read';
  /** The structure record's id (what a part demand names) and the reading as stored. Absent when the call carried no structure. */
  readonly structure?: { readonly structureId: string; readonly reading: ScopePaperStructure };
  readonly stamp: ExtractionStamp;
}

/** An anchor as today's adapter resolves it: the caller's own `OutcomeSourceReference`, of which only the landed-unit ordinal is stored. */
export interface ExtractedAnchor {
  readonly blockIndex: number;
}

/**
 * The paper-structure half of an extraction result, as `outcomes-extract-adapter.ts` returns it
 * today, plus the fields the `[D-431]` contract will add. Structurally assignable from the adapter's
 * `OutcomesExtractReadResult['paperStructure']`.
 */
export interface ExtractedPaperStructure {
  readonly sections: readonly {
    readonly label: string;
    readonly questionForm: string;
    readonly itemCount: number;
    /** Absent means the paper states none: unknown, never zero. */
    readonly marks?: number;
    readonly anchor: ExtractedAnchor;
  }[];
  readonly questionGroups?: readonly PaperQuestionGroup<ExtractedAnchor>[];
  readonly questionParts?: readonly {
    readonly id: string;
    readonly label: string;
    readonly groupId: string;
    readonly instructionAnchor: ExtractedAnchor;
    readonly questionForm: string;
    readonly marks?: number;
    readonly dependsOn?: ScopePartDependency;
  }[];
  readonly totalMarks?: number;
  readonly timeAllowanceMinutes?: number;
}

export interface ExtractionRecordInput {
  readonly sourcePath: string;
  readonly documentKind: 'objectives' | 'past-paper';
  /** The content digest of the text the reading was made from. */
  readonly revisionDigest: string;
  /** How much of the document this reading covers. Required: it decides empty versus partly read. */
  readonly coverage: { readonly unitsRead: number; readonly unitsTotal: number };
  /** Declarations found (objectives). Their Outcome records are persisted by the existing resolve and reconcile path, not here. */
  readonly declarationCount: number;
  readonly paperStructure: ExtractedPaperStructure;
  readonly stamp: ExtractionStamp;
  readonly coverageDigest?: string;
}

export interface DocumentRef {
  readonly sourcePath: string;
  readonly documentKind: ScopeDocumentKind;
  readonly revisionDigest: string;
}

export interface DocumentReading {
  readonly state: DocumentStateView;
  readonly structure: StructureView;
}

export interface ScopeReadingPersistenceDeps {
  readonly vault: VaultSource;
  /** This install's stable device id (`../device/device-id.ts`). */
  readonly deviceId: string;
  /** Injectable for deterministic tests. */
  readonly now?: () => string;
}

export interface ScopeReadingPersistence {
  /** The store itself, for callers that need a read the wrappers below do not offer. */
  readonly store: ScopeReadingStore;
  recordRegistered(ref: DocumentRef): Promise<void>;
  /** Extraction is owed and will be retried. Never an empty result. */
  recordPending(ref: DocumentRef, reason: ScopePendingReason): Promise<void>;
  /** Records what one extraction call returned, choosing `recorded`, `read-states-nothing` or `partly-read` (see the module doc). */
  recordExtraction(input: ExtractionRecordInput): Promise<RecordedExtraction>;
  /** One part's demand verdict, read against the structure record `structureId` names. Task and stamp make its provenance. */
  recordPartDemand(input: {
    readonly ref: DocumentRef;
    readonly structureId: string;
    readonly partId: string;
    readonly demand: ScopePartDemand;
    readonly stamp: ExtractionStamp;
  }): Promise<{ readonly appended: boolean }>;
  /** One course's alignment results for one document revision, validated as a whole before any is written. `provenance` is absent for a pending result. */
  recordAlignmentResults(input: {
    readonly ref: DocumentRef;
    readonly courseId: string;
    readonly digests: AlignmentDigests;
    readonly results: readonly {
      readonly conceptKey: string;
      readonly result: AlignmentResult;
      readonly coverage: AlignmentCoverageNote;
      readonly provenance?: { readonly task: string } & ExtractionStamp;
    }[];
  }): Promise<{ readonly appended: number; readonly unchanged: number }>;
  /** The state and structure of the document's CURRENT revision, labelled against what the caller says is current. */
  readDocument(ref: DocumentRef, policy?: ReadingPolicy): Promise<DocumentReading>;
  load(): Promise<ScopeReadingProjection>;
}

const anchorOf = (anchor: ExtractedAnchor): ScopeReadingAnchor => ({
  unitIndex: anchor.blockIndex,
});

const marksOf = (marks: number | undefined): ScopeStructureSection['marks'] =>
  marks === undefined ? { status: 'unknown' } : { status: 'stated', value: marks };

/** Maps the extraction's paper-structure half onto the stored shape. `groups` and `parts` stay absent when the reader carried none. */
export function scopePaperStructureFrom(structure: ExtractedPaperStructure): ScopePaperStructure {
  const sections: ScopeStructureSection[] = structure.sections.map((section) => ({
    label: section.label,
    questionForm: section.questionForm,
    itemCount: section.itemCount,
    marks: marksOf(section.marks),
    anchor: anchorOf(section.anchor),
  }));
  const groups = structure.questionGroups?.map(
    (group): PaperQuestionGroup<ScopeReadingAnchor> => ({
      id: group.id,
      kind: group.kind,
      label: group.label,
      ...(group.parentGroupId !== undefined ? { parentGroupId: group.parentGroupId } : {}),
      memberLabels: group.memberLabels,
      ...(group.choose !== undefined ? { choose: group.choose } : {}),
      anchor: anchorOf(group.anchor),
      stimulus:
        group.stimulus.status === 'identified'
          ? {
              status: 'identified',
              form: group.stimulus.form,
              anchor: anchorOf(group.stimulus.anchor),
            }
          : group.stimulus,
    }),
  );
  const parts = structure.questionParts?.map(
    (part): ScopeStructurePart => ({
      id: part.id,
      label: part.label,
      groupId: part.groupId,
      instructionAnchor: anchorOf(part.instructionAnchor),
      questionForm: part.questionForm,
      marks: marksOf(part.marks),
      dependsOn: part.dependsOn ?? { status: 'unknown' },
    }),
  );
  return {
    sections,
    ...(groups !== undefined ? { groups } : {}),
    ...(parts !== undefined ? { parts } : {}),
    totalMarks: marksOf(structure.totalMarks),
    timeAllowance:
      structure.timeAllowanceMinutes === undefined
        ? { status: 'unknown' }
        : { status: 'stated', minutes: structure.timeAllowanceMinutes },
  };
}

function hasStructure(structure: ExtractedPaperStructure): boolean {
  return (
    structure.sections.length > 0 ||
    (structure.questionGroups?.length ?? 0) > 0 ||
    (structure.questionParts?.length ?? 0) > 0
  );
}

export function createScopeReadingPersistence(
  deps: ScopeReadingPersistenceDeps,
): ScopeReadingPersistence {
  const store = createScopeReadingStore(deps.vault, {
    deviceId: deps.deviceId,
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });
  const sourceOf = (ref: DocumentRef) => ({
    sourcePath: ref.sourcePath,
    revisionDigest: ref.revisionDigest,
    documentKind: ref.documentKind,
  });

  return {
    store,

    async recordRegistered(ref) {
      await store.recordDocumentState({ source: sourceOf(ref), state: { kind: 'registered' } });
    },

    async recordPending(ref, reason) {
      await store.recordDocumentState({
        source: sourceOf(ref),
        state: { kind: 'pending', reason },
      });
    },

    async recordExtraction(input) {
      const { unitsRead, unitsTotal } = input.coverage;
      const provenance: ScopeReaderProvenance = {
        task: SCOPE_READING_EXTRACT_TASK,
        promptVersion: input.stamp.promptVersion,
        modelId: input.stamp.modelId,
      };
      const source = {
        sourcePath: input.sourcePath,
        revisionDigest: input.revisionDigest,
        documentKind: input.documentKind,
      } as const;
      const foundStructure =
        input.documentKind === 'past-paper' && hasStructure(input.paperStructure);
      const foundSomething =
        input.documentKind === 'objectives' ? input.declarationCount > 0 : foundStructure;
      const fullyRead = unitsRead >= unitsTotal;

      // The reading first, then the state that says it exists.
      let structure: RecordedExtraction['structure'];
      if (foundStructure) {
        const reading = scopePaperStructureFrom(input.paperStructure);
        const written = await store.recordPaperStructure({ source, provenance, reading });
        structure = { structureId: written.structureId, reading };
      }
      const extra = (state: RecordedExtraction['state']): RecordedExtraction => ({
        state,
        ...(structure !== undefined ? { structure } : {}),
        stamp: input.stamp,
      });
      const coverageDigest =
        input.coverageDigest !== undefined ? { coverageDigest: input.coverageDigest } : {};
      if (!fullyRead) {
        await store.recordDocumentState({
          source,
          state: { kind: 'partly-read', unitsRead, unitsTotal },
          provenance,
          ...coverageDigest,
        });
        return extra('partly-read');
      }
      const state = foundSomething ? 'recorded' : 'read-states-nothing';
      await store.recordDocumentState({
        source,
        state: { kind: state },
        provenance,
        ...coverageDigest,
      });
      return extra(state);
    },

    async recordPartDemand(input) {
      return store.recordPartDemand({
        source: sourceOf(input.ref),
        partId: input.partId,
        structureId: input.structureId,
        demand: input.demand,
        provenance: {
          task: SCOPE_READING_DEMAND_TASK,
          promptVersion: input.stamp.promptVersion,
          modelId: input.stamp.modelId,
        },
      });
    },

    async recordAlignmentResults(input) {
      return store.recordAlignmentResults(
        input.results.map((entry) => ({
          source: sourceOf(input.ref),
          courseId: input.courseId,
          conceptKey: entry.conceptKey,
          result: entry.result,
          digests: input.digests,
          coverage: entry.coverage,
          ...(entry.provenance !== undefined
            ? {
                provenance: {
                  task: entry.provenance.task,
                  promptVersion: entry.provenance.promptVersion,
                  modelId: entry.provenance.modelId,
                },
              }
            : {}),
        })),
      );
    },

    async readDocument(ref, policy) {
      const projection = await store.load();
      return {
        state: documentStateView(projection, sourceOf(ref)),
        structure: structureView(projection, sourceOf(ref), policy),
      };
    },

    load: () => store.load(),
  };
}
