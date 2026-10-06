/**
 * `runDemandDriver` — reads each recorded past-paper part's demand and stores the verdict
 * (`ol-egov.141.89.7.52`, `[D-429]`, `[D-431]`, scp.md 2.1 and 2.3).
 *
 * **What it does.** After `recordExtraction` returns a structure with `parts`, it builds one
 * `demand.classify.v1` request per part from the stored structure and the units that landed with
 * that extraction (passage text is never stored: an anchor is an ordinal into those units), calls the
 * reader, and writes the answer through `recordPartDemand` naming the structure record it read.
 *
 * **Nothing read is not a verdict.** A part whose answer is unavailable, refused by the reader, or
 * whose anchors fall outside this delivery's units is left with NO record: absence, never a
 * "cannot tell" it did not earn. The first unavailable answer (offline or over budget) stops the
 * loop, so a spent budget is not spent against. Calls are sequential for the same reason.
 *
 * **No repeat spend.** A part whose demand is already current against this structure record is
 * skipped; an unchanged structure returns the id already current, so an identical re-delivery sends
 * nothing.
 *
 * Every failure is logged content-free (D-005), swallowed and never thrown: ingestion is
 * unaffected. This module constructs `WorkerDemandClassifyReader`, which is the reader's production
 * construction site; the driver itself has no production caller until `wiring.ts` calls
 * `runScopeReadingDrivers` (waits on `[D-534]` and `ol-egov.141.89.7.68`).
 */

import type {
  ExtractedUnit,
  PaperQuestionGroup,
  PaperStimulusForm,
  ScopePaperStructure,
  ScopeReadingAnchor,
  ScopeStructurePart,
  WorkerTaskTransport,
} from 'olea-core';
import { partDemandView } from 'olea-core';
import {
  type DemandClassifyPassage,
  DemandClassifyReaderUnavailableError,
  type DemandClassifyReadRequest,
  WorkerDemandClassifyReader,
} from '../ingestion/demand-classify-adapter.js';
import type { DocumentRef, RecordedExtraction, ScopeReadingPersistence } from './persistence.js';

/**
 * `[D-534]` cost brief, item 5: a part the reader refused twice is marked unread and not retried
 * until the revision changes. The count is keyed by `refusalKey`, which names the structure record,
 * so a replaced structure starts again at zero. This module only reads and bumps it: where the
 * count lives is the caller's (`inMemoryRefusalLedger` is session-long and forgotten on restart; a
 * count that survives a restart needs a stored field, which this lane does not add).
 */
export interface PartRefusalLedger {
  count(key: string): number;
  record(key: string): void;
}

/** A part refused this many times is held back. */
export const REFUSED_PART_LIMIT = 2;

export const refusalKey = (structureId: string, partId: string): string =>
  `${structureId}|${partId}`;

export function inMemoryRefusalLedger(): PartRefusalLedger {
  const counts = new Map<string, number>();
  return {
    count: (key) => counts.get(key) ?? 0,
    record: (key) => void counts.set(key, (counts.get(key) ?? 0) + 1),
  };
}

export interface DemandDriverInput {
  readonly persistence: ScopeReadingPersistence;
  readonly ref: DocumentRef;
  readonly recorded: RecordedExtraction;
  /** This delivery's landed units; a unit's ordinal is its index. */
  readonly units: readonly ExtractedUnit[];
  readonly transport: WorkerTaskTransport;
  /** Held-back parts: a part refused {@link REFUSED_PART_LIMIT} times is not sent. Absent: no limit. */
  readonly refusals?: PartRefusalLedger;
}

export interface DemandDriverResult {
  readonly sent: number;
  readonly recorded: number;
  readonly skipped: number;
  /** Parts not sent because the reader refused them {@link REFUSED_PART_LIMIT} times. Absent when none. */
  readonly heldBack?: number;
}

type ScopeGroup = PaperQuestionGroup<ScopeReadingAnchor>;

export const wireRef = (unitIndex: number): string => `u${unitIndex}`;

/** One landed unit as a wire passage, or null when the ordinal is outside this delivery. */
export function passageAt(
  units: readonly ExtractedUnit[],
  unitIndex: number,
): DemandClassifyPassage | null {
  const unit = units[unitIndex];
  if (unit === undefined) return null;
  return { ref: wireRef(unitIndex), unitIndex, text: unit.text };
}

/** A part's group chain, own group first, then each ancestor by `parentGroupId`. A cycle or a missing group ends it. */
export function groupChain(reading: ScopePaperStructure, part: ScopeStructurePart): ScopeGroup[] {
  const byId = new Map((reading.groups ?? []).map((group) => [group.id, group]));
  const chain: ScopeGroup[] = [];
  const seen = new Set<string>();
  let next = byId.get(part.groupId);
  while (next !== undefined && !seen.has(next.id)) {
    seen.add(next.id);
    chain.push(next);
    next = next.parentGroupId === undefined ? undefined : byId.get(next.parentGroupId);
  }
  return chain;
}

/** The unit ordinals of a part's non-section group anchors, outermost first, de-duplicated. */
export function stemAnchors(chain: readonly ScopeGroup[]): number[] {
  const out: number[] = [];
  for (const group of [...chain].reverse()) {
    if (group.kind === 'section') continue;
    if (!out.includes(group.anchor.unitIndex)) out.push(group.anchor.unitIndex);
  }
  return out;
}

/** The nearest group in the chain whose stimulus is identified, with its anchor. */
export function identifiedStimulus(
  chain: readonly ScopeGroup[],
): { readonly form: PaperStimulusForm; readonly unitIndex: number } | undefined {
  for (const group of chain) {
    if (group.stimulus.status === 'identified') {
      return { form: group.stimulus.form, unitIndex: group.stimulus.anchor.unitIndex };
    }
  }
  return undefined;
}

/** One part's request, or null when any unit it needs is outside this delivery or a dependency cannot be resolved. */
export function demandRequestFor(
  reading: ScopePaperStructure,
  part: ScopeStructurePart,
  units: readonly ExtractedUnit[],
): DemandClassifyReadRequest | null {
  const instruction = passageAt(units, part.instructionAnchor.unitIndex);
  if (instruction === null) return null;
  const chain = groupChain(reading, part);
  const own = chain[0];

  const sectionGroup = chain.find((group) => group.kind === 'section');
  let heading: DemandClassifyPassage | undefined;
  if (sectionGroup !== undefined) {
    const found = passageAt(units, sectionGroup.anchor.unitIndex);
    if (found === null) return null;
    heading = found;
  }

  const stem: DemandClassifyPassage[] = [];
  for (const unitIndex of stemAnchors(chain)) {
    const found = passageAt(units, unitIndex);
    if (found === null) return null;
    stem.push(found);
  }

  const stimulusUnit = identifiedStimulus(chain);
  let stimulus: DemandClassifyReadRequest['group']['stimulus'];
  if (stimulusUnit !== undefined) {
    const found = passageAt(units, stimulusUnit.unitIndex);
    if (found === null) return null;
    if (!stem.some((passage) => passage.ref === found.ref)) stem.push(found);
    stimulus = {
      status: 'identified',
      form: stimulusUnit.form,
      ref: found.ref,
    };
  } else if (own?.stimulus.status === 'none') {
    stimulus = { status: 'none' };
  } else {
    stimulus = {
      status: 'not-identified',
      ...(own?.stimulus.status === 'not-identified' && own.stimulus.form !== undefined
        ? { form: own.stimulus.form }
        : {}),
    };
  }

  let dependsOn: DemandClassifyReadRequest['dependsOn'];
  if (part.dependsOn.status === 'stated') {
    const named: NonNullable<DemandClassifyReadRequest['dependsOn']>[number][] = [];
    for (const id of part.dependsOn.onPartIds) {
      const other = (reading.parts ?? []).find((candidate) => candidate.id === id);
      const text = other === undefined ? null : passageAt(units, other.instructionAnchor.unitIndex);
      if (other === undefined || text === null) return null;
      named.push({ partId: other.id, label: other.label, instruction: text });
    }
    dependsOn = named;
  }

  return {
    part: {
      partId: part.id,
      label: part.label,
      instruction,
      questionForm: part.questionForm,
      ...(part.marks.status === 'stated' ? { marks: part.marks.value } : {}),
    },
    ...(heading !== undefined ? { section: { heading } } : {}),
    group: { ...(stem.length > 0 ? { stem } : {}), stimulus },
    ...(dependsOn !== undefined ? { dependsOn } : {}),
  };
}

export async function runDemandDriver(input: DemandDriverInput): Promise<DemandDriverResult> {
  const { persistence, ref, recorded, units } = input;
  const result: { sent: number; recorded: number; skipped: number; heldBack?: number } = {
    sent: 0,
    recorded: 0,
    skipped: 0,
  };
  const structure = recorded.structure;
  if (ref.documentKind !== 'past-paper' || structure === undefined) return result;
  const parts = structure.reading.parts;
  if (parts === undefined) return result;

  const projection = await persistence.load();
  const reader = new WorkerDemandClassifyReader({ transport: input.transport });
  for (const part of parts) {
    if (partDemandView(projection, ref, part.id).status === 'current') {
      result.skipped++;
      continue;
    }
    const heldKey = refusalKey(structure.structureId, part.id);
    if (input.refusals !== undefined && input.refusals.count(heldKey) >= REFUSED_PART_LIMIT) {
      result.heldBack = (result.heldBack ?? 0) + 1;
      continue;
    }
    const request = demandRequestFor(structure.reading, part, units);
    if (request === null) {
      result.skipped++;
      continue;
    }
    let read: Awaited<ReturnType<WorkerDemandClassifyReader['read']>>;
    try {
      result.sent++;
      read = await reader.read(request);
    } catch (error) {
      if (error instanceof DemandClassifyReaderUnavailableError) {
        console.error('Olea: part demands not read: the service is unavailable', {
          reason: error.reason,
        });
        return result;
      }
      console.error('Olea: a part demand was not read (ingestion unaffected)', { error });
      input.refusals?.record(heldKey);
      continue;
    }
    try {
      await persistence.recordPartDemand({
        ref,
        structureId: structure.structureId,
        partId: part.id,
        demand: read.demand,
        stamp: read.stamp,
      });
      result.recorded++;
    } catch (error) {
      console.error('Olea: a part demand was not recorded (ingestion unaffected)', { error });
    }
  }
  return result;
}
