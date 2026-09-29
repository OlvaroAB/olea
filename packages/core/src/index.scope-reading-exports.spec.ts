// `ol-egov.141.89.7.32` and `ol-egov.141.89.2.31`: the examiner-scope reading store, the structured
// practice-paper helpers, the paper journal and the unmet-demand reader are reachable from the public
// entry point (`olea-core`), so a plugin module never deep-imports `olea-core/src/...` or
// `../../../core/src/...` for them.
//
// This asserts that each name is the real thing, not merely present: `undefined` from a missing
// re-export is what the budget-exports precedent (`index.budget-exports.spec.ts`) was written for.
// The type names are checked by importing them from the barrel below: a barrel that drops one turns
// the typecheck red.
import { describe, expect, it } from 'vitest';
import { unmetDemandsByConcept } from './gap/demand.js';
import type {
  AlignmentResultPayload,
  DocumentStatePayload,
  PaperChoicePattern,
  PaperClassifiableReasonCode,
  PaperCompletion,
  PaperEmptySlotReasonCode,
  PaperJournalRecord,
  PaperMarks,
  PaperPartDependency,
  PaperReuseFingerprint,
  PaperSlotWorkerResult,
  PaperStructuredGroup,
  PaperStructuredPart,
  PaperStructuredSection,
  PaperStructuredShape,
  PaperStructureProblem,
  ReadingPolicy,
  ScopePaperStructure,
  ScopeReadingProjection,
  ScopeReadingStore,
  UnmetDemandsInput,
  UnresolvedStructure,
  UnresolvedStructureKind,
} from './index.js';
import * as oleaCore from './index.js';
import { classifyPaperSlotWorkerResult } from './oracle/paper-journal.js';
import { paperPartsInDependencyOrder } from './oracle/paper-structure.js';
import { canonicalJson } from './outcome/canonical-json.js';
import { createScopeReadingStore } from './outcome/scope-reading-store.js';
import { SCOPE_READING_SCHEMA_VERSION } from './outcome/scope-reading-types.js';

// A type-only reference so the imports above are used: each is a barrel type a plugin module names.
export type BarrelTypeWitness = [
  AlignmentResultPayload,
  DocumentStatePayload,
  PaperChoicePattern,
  PaperClassifiableReasonCode,
  PaperCompletion,
  PaperEmptySlotReasonCode,
  PaperJournalRecord,
  PaperMarks,
  PaperPartDependency,
  PaperReuseFingerprint,
  PaperSlotWorkerResult,
  PaperStructuredGroup,
  PaperStructuredPart,
  PaperStructuredSection,
  PaperStructuredShape,
  PaperStructureProblem,
  ReadingPolicy,
  ScopePaperStructure,
  ScopeReadingProjection,
  ScopeReadingStore,
  UnmetDemandsInput,
  UnresolvedStructure,
  UnresolvedStructureKind,
];

describe('olea-core barrel: the examiner-scope reading store, the paper structure and journal, the unmet-demand reader', () => {
  it('exports every scope-reading name as the same function or constant the module declares', () => {
    expect(oleaCore.createScopeReadingStore).toBe(createScopeReadingStore);
    expect(oleaCore.SCOPE_READING_SCHEMA_VERSION).toBe(SCOPE_READING_SCHEMA_VERSION);
    expect(oleaCore.canonicalJson).toBe(canonicalJson);
    const functions = {
      scopeReadingLogPath: oleaCore.scopeReadingLogPath,
      scopeReadingEventId: oleaCore.scopeReadingEventId,
      orderScopeReadingEntries: oleaCore.orderScopeReadingEntries,
      latestEntryPerKey: oleaCore.latestEntryPerKey,
      readScopeReadingLog: oleaCore.readScopeReadingLog,
      appendScopeReadingEvents: oleaCore.appendScopeReadingEvents,
      documentStateKey: oleaCore.documentStateKey,
      paperStructureKey: oleaCore.paperStructureKey,
      partDemandKey: oleaCore.partDemandKey,
      alignmentResultKey: oleaCore.alignmentResultKey,
      isDocumentStatePayload: oleaCore.isDocumentStatePayload,
      isPaperStructurePayload: oleaCore.isPaperStructurePayload,
      isPartDemandPayload: oleaCore.isPartDemandPayload,
      isAlignmentResultPayload: oleaCore.isAlignmentResultPayload,
      projectScopeReadings: oleaCore.projectScopeReadings,
      documentStateView: oleaCore.documentStateView,
      structureView: oleaCore.structureView,
      partDemandView: oleaCore.partDemandView,
      alignmentFreshness: oleaCore.alignmentFreshness,
      alignmentResultView: oleaCore.alignmentResultView,
      alignmentResultsForDocument: oleaCore.alignmentResultsForDocument,
    };
    for (const [name, value] of Object.entries(functions)) {
      expect(typeof value, name).toBe('function');
    }
    expect(oleaCore.SCOPE_READING_FOLDER).toBe('.olea/outcomes/readings');
    expect([...oleaCore.SCOPE_READING_STORES]).toEqual([
      'document-state',
      'paper-structure',
      'alignment-result',
    ]);
    expect(oleaCore.SCOPE_READING_LOG_SCHEMA_VERSION).toBe(1);
  });

  it('exports the paper structure helpers and the paper journal as the module declares them', () => {
    expect(oleaCore.paperPartsInDependencyOrder).toBe(paperPartsInDependencyOrder);
    expect(oleaCore.classifyPaperSlotWorkerResult).toBe(classifyPaperSlotWorkerResult);
    const functions = {
      validatePaperStructure: oleaCore.validatePaperStructure,
      propagatePaperEmptiness: oleaCore.propagatePaperEmptiness,
      countedPaperMarks: oleaCore.countedPaperMarks,
      reconcilePaperStructureMarks: oleaCore.reconcilePaperStructureMarks,
      emptySlotGapKind: oleaCore.emptySlotGapKind,
      classifyPaperCompletion: oleaCore.classifyPaperCompletion,
      paperYieldAgainstStructure: oleaCore.paperYieldAgainstStructure,
      paperIntendedDemandBasis: oleaCore.paperIntendedDemandBasis,
      paperReuseFingerprint: oleaCore.paperReuseFingerprint,
      paperBlueprintDigest: oleaCore.paperBlueprintDigest,
      comparePaperReuseFingerprints: oleaCore.comparePaperReuseFingerprints,
      applyPaperJournalEvent: oleaCore.applyPaperJournalEvent,
      paperJournalOwedSlotIds: oleaCore.paperJournalOwedSlotIds,
      paperJournalPath: oleaCore.paperJournalPath,
      isPaperJournalRecord: oleaCore.isPaperJournalRecord,
      listPaperJournals: oleaCore.listPaperJournals,
      openPaperJournal: oleaCore.openPaperJournal,
      discardPaperJournal: oleaCore.discardPaperJournal,
      runPaperJournal: oleaCore.runPaperJournal,
      finalizePaperFromJournal: oleaCore.finalizePaperFromJournal,
    };
    for (const [name, value] of Object.entries(functions)) {
      expect(typeof value, name).toBe('function');
    }
    expect(typeof oleaCore.PaperJournalUnfinishedError).toBe('function');
    expect(oleaCore.PAPER_JOURNAL_FOLDER).toBe(`${oleaCore.PAPER_STORE_FOLDER}/journals`);
    expect(oleaCore.OPAQUE_PAPER_JOURNAL_ID_PREFIX).toBe('paper-journal-key1');
    expect(oleaCore.PAPER_JOURNAL_SCHEMA_VERSION).toBe(1);
    expect(oleaCore.PAPER_SLOT_RETRIES_DECLARED).toBe(1);
    expect(oleaCore.PAPER_STRUCTURE_FORMAT_VERSION).toBe('paper-structure-v1');
  });

  it('classifies a real Worker envelope through the barrel: refusal and outage stay apart', () => {
    const stamped = { ok: true, stamp: { promptVersion: 'v1' }, result: { questions: [] } };
    expect(oleaCore.classifyPaperSlotWorkerResult(stamped)).toMatchObject({
      status: 'generated',
      promptVersion: 'v1',
    });
    expect(
      oleaCore.classifyPaperSlotWorkerResult({ ok: false, code: 'grounding-refused', message: '' }),
    ).toEqual({ status: 'refused', reason: 'grounding-refused' });
    expect(
      oleaCore.classifyPaperSlotWorkerResult({ ok: false, code: 'upstream-error', message: '' }),
    ).toEqual({ status: 'unavailable', reason: 'upstream-error' });
  });

  it('exports the unmet-demand reader as the same function the module declares (2.31)', () => {
    expect(oleaCore.unmetDemandsByConcept).toBe(unmetDemandsByConcept);
    expect(oleaCore.demandsMetNow).toBeTypeOf('function');
  });
});
