/**
 * The examiner-scope reading store (`[D-429]`, ruled 2026-09-29, decision sheet row 16, option a):
 * the typed API over the scope-reading log (`./scope-reading-log.ts`) — three stores in Olea's own
 * layer, written by the client from transient Worker answers, never sent anywhere and never held
 * server-side.
 *
 * - **Document processing state** (`recordDocumentState`): where each document revision stands —
 *   registered, partly read, pending (owed, with a reason), read and stating nothing, or recorded.
 * - **Paper structure and demand per part** (`recordPaperStructure`, `recordPartDemand`): the
 *   structure reading of a past paper revision, and a demand verdict per part, each demand naming the
 *   structure it read so a replaced structure invalidates it.
 * - **Alignment results** (`recordAlignmentResults`): one result per (course, document revision,
 *   concept), with the digests it is only current against.
 *
 * **What is refused at the door**, because a record that should not exist is cheaper to refuse than
 * to read around: a model-produced state or verdict without its reader provenance (INV-4, D7.3 —
 * "source and reader-version provenance" is the ruling's own condition); an aligned result that
 * cites nothing (S.3: a within-scope verdict with no surviving passage ref is voided, so it can never
 * be stored as aligned); a structure or part demand for anything but a past paper; a partly-read
 * count that cannot hold. A batch is validated whole before anything is written.
 *
 * **What is not stored here.** Passage text, the Worker's raw response, model self-ratings used for
 * branching, or any server identifier. Anchors are ordinals into the document's own landed units.
 * `load` returns the projection (`./scope-reading-project.ts`); the views over it take what is
 * current from the caller, so a stale reading is never served as current.
 *
 * The production caller that writes these records is the ingestion trigger's discard point
 * (`packages/plugin/src/ingestion/wiring.ts`, `triggerOutcomesExtractForLandedUnit`), through
 * `packages/plugin/src/scope-reading/persistence.ts`; adding that call is wire work
 * (`ol-egov.141.89.7.5`), because that file is claimed by another lane.
 */

import type { VaultSource } from '../vault/types.js';
import {
  appendScopeReadingEvents,
  readScopeReadingLog,
  type ScopeReadingDraft,
  scopeReadingLogPath,
} from './scope-reading-log.js';
import {
  alignmentResultKey,
  documentStateKey,
  isAlignmentResultPayload,
  isDocumentStatePayload,
  isPaperStructurePayload,
  isPartDemandPayload,
  paperStructureKey,
  partDemandKey,
  projectScopeReadings,
  type ScopeReadingProjection,
} from './scope-reading-project.js';
import type {
  AlignmentResultPayload,
  DocumentStatePayload,
  PaperStructurePayload,
  PartDemandPayload,
} from './scope-reading-types.js';

export interface ScopeReadingStoreOptions {
  /** This install's stable device id (`packages/plugin/src/device/device-id.ts`); names its own files. */
  readonly deviceId: string;
  /** Injectable for deterministic tests. Defaults to `new Date().toISOString()`. */
  readonly now?: () => string;
}

export interface RecordOutcome {
  /** `false` when the key's current record already had this content (nothing was written). */
  readonly appended: boolean;
}

export interface ScopeReadingStore {
  recordDocumentState(payload: DocumentStatePayload): Promise<RecordOutcome>;
  /** Also returns the record's id (its content hash), which a part-demand record names to say what it read. Unchanged content returns the id already current. */
  recordPaperStructure(
    payload: PaperStructurePayload,
  ): Promise<RecordOutcome & { readonly structureId: string }>;
  recordPartDemand(payload: PartDemandPayload): Promise<RecordOutcome>;
  /** One read, one write, whole-batch validation. */
  recordAlignmentResults(
    payloads: readonly AlignmentResultPayload[],
  ): Promise<{ readonly appended: number; readonly unchanged: number }>;
  /** The projection of everything every reachable device has written. */
  load(): Promise<ScopeReadingProjection>;
}

function refuse(what: string, why: string): never {
  throw new Error(`scope-reading store: ${what}: ${why}`);
}

function validateDocumentState(payload: DocumentStatePayload): void {
  if (!isDocumentStatePayload(payload))
    refuse('document state', 'not a valid document state payload');
  const { state } = payload;
  if (state.kind === 'partly-read') {
    const ok =
      Number.isInteger(state.unitsRead) &&
      Number.isInteger(state.unitsTotal) &&
      state.unitsRead >= 0 &&
      state.unitsRead <= state.unitsTotal;
    if (!ok) refuse('document state', 'partly-read units are not a count that can hold');
  }
  if (
    (state.kind === 'recorded' || state.kind === 'read-states-nothing') &&
    payload.provenance === undefined
  ) {
    refuse(
      'document state',
      `a "${state.kind}" state is model-produced and must carry its reader provenance`,
    );
  }
}

function validateStructure(payload: PaperStructurePayload): void {
  if (!isPaperStructurePayload(payload))
    refuse('paper structure', 'not a valid paper structure payload');
  if (payload.source.documentKind !== 'past-paper') {
    refuse('paper structure', 'only a past paper has a structure reading');
  }
}

function validatePartDemand(payload: PartDemandPayload): void {
  if (!isPartDemandPayload(payload)) refuse('part demand', 'not a valid part demand payload');
  if (payload.source.documentKind !== 'past-paper') {
    refuse('part demand', 'only a past paper has parts');
  }
}

function validateAlignmentResult(payload: AlignmentResultPayload): void {
  if (!isAlignmentResultPayload(payload))
    refuse('alignment result', 'not a valid alignment result payload');
  const { result } = payload;
  if (result.kind === 'aligned' && (result.recordIds.length === 0 || result.refs.length === 0)) {
    refuse(
      'alignment result',
      'an aligned result must cite the records and passage refs it aligned on',
    );
  }
  if (payload.source.documentKind === 'past-paper' && !payload.structureId) {
    refuse(
      'alignment result',
      'a past-paper result must name the structure its part ids came from ([D-534])',
    );
  }
  if (result.kind !== 'pending' && payload.provenance === undefined) {
    refuse(
      'alignment result',
      `a "${result.kind}" result is model-decided and must carry its reader provenance`,
    );
  }
}

export function createScopeReadingStore(
  vault: VaultSource,
  options: ScopeReadingStoreOptions,
): ScopeReadingStore {
  // Fails at construction on a device id that could not name a file, not on the first write.
  scopeReadingLogPath('document-state', options.deviceId);
  const { deviceId } = options;
  const append = (
    store: 'document-state' | 'paper-structure' | 'alignment-result',
    drafts: readonly ScopeReadingDraft[],
  ) =>
    appendScopeReadingEvents(
      vault,
      store,
      deviceId,
      drafts,
      options.now !== undefined ? { now: options.now } : {},
    );

  return {
    async recordDocumentState(payload) {
      validateDocumentState(payload);
      const [result] = await append('document-state', [
        { kind: 'document-state', key: documentStateKey(payload.source), payload },
      ]);
      return { appended: result?.appended ?? false };
    },

    async recordPaperStructure(payload) {
      validateStructure(payload);
      const [result] = await append('paper-structure', [
        { kind: 'structure', key: paperStructureKey(payload.source), payload },
      ]);
      if (result === undefined) refuse('paper structure', 'nothing was written or matched');
      return { appended: result.appended, structureId: result.entry.eventId };
    },

    async recordPartDemand(payload) {
      validatePartDemand(payload);
      const [result] = await append('paper-structure', [
        { kind: 'part-demand', key: partDemandKey(payload.source, payload.partId), payload },
      ]);
      return { appended: result?.appended ?? false };
    },

    async recordAlignmentResults(payloads) {
      for (const payload of payloads) validateAlignmentResult(payload);
      const results = await append(
        'alignment-result',
        payloads.map((payload) => ({
          kind: 'alignment-result',
          key: alignmentResultKey(payload.courseId, payload.source, payload.conceptKey),
          payload,
        })),
      );
      const appended = results.filter((r) => r.appended).length;
      return { appended, unchanged: results.length - appended };
    },

    async load() {
      const [documentState, paperStructure, alignmentResult] = await Promise.all([
        readScopeReadingLog(vault, 'document-state', { deviceId }),
        readScopeReadingLog(vault, 'paper-structure', { deviceId }),
        readScopeReadingLog(vault, 'alignment-result', { deviceId }),
      ]);
      return projectScopeReadings({ documentState, paperStructure, alignmentResult });
    },
  };
}
