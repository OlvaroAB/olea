/**
 * The resume pass and the new-concept pass (`ol-egov.141.89.7.73`, `[D-534]`, scp.md S.4, S.6).
 *
 * **What they are.** `runScopeReadingDrivers` reads a delivery once. These two re-run only what that
 * delivery left owed, from what is stored, so a later delivery or a reconnect never re-sends a read
 * that already holds a result:
 *
 * - {@link resumeScopeReading}: the parts of the stored structure with no demand against it
 *   (a replaced structure owes them all again), and, per registered course, the concepts whose
 *   alignment is absent, stale against the structure or coverage, pending on an outage or a refusal,
 *   or still short of pairs past the run cap. A settled result is never re-sent or rewritten.
 * - {@link alignNewConcepts}: only the concepts that have no result at all for the course (S.4, "a new
 *   concept in the course"). Pending and settled concepts are left exactly as stored.
 *
 * **Why the caller supplies the units.** A passage's text is never stored (an anchor is an ordinal
 * into the landed units), so a read needs the document's units again, as the delivery that triggered
 * the pass carries them. Alignment additionally needs the whole revision (AT-1), as the full driver does.
 *
 * **Behind the same off switch (`[D-534]` 1b).** `enabled` defaults to
 * {@link SCOPE_READING_DRIVERS_ENABLED}, which ships `false`; the wiring's `drivers.enabled` is the
 * value a caller passes. Off, nothing is read, sent or written. `[D-344]` is not extended to these
 * calls, so this module has no production caller: see the report of `ol-egov.141.89.7.73` for where one goes.
 *
 * Never throws; every failure is logged content-free (D-005).
 */

import type { ScopePaperStructure } from 'olea-core';
import {
  type AlignmentDriverInput,
  type AlignmentDriverResult,
  runAlignmentDriver,
} from './alignment-driver.js';
import {
  type DemandDriverResult,
  type PartRefusalLedger,
  runDemandDriver,
} from './demand-driver.js';
import { SCOPE_READING_DRIVERS_ENABLED, sessionRefusals } from './drivers.js';
import type { RecordedExtraction } from './persistence.js';

export interface ResumeInput extends Omit<AlignmentDriverInput, 'recorded'> {
  /** The switch. Absent, the shipped default {@link SCOPE_READING_DRIVERS_ENABLED} (off). */
  readonly enabled?: boolean;
  /** Held-back parts and batches. Absent: the session ledger, shared with the first-delivery path. */
  readonly refusals?: PartRefusalLedger;
}

export interface ResumeResult {
  readonly outcome: 'disabled' | 'nothing-recorded' | 'ran' | 'failed';
  readonly demand?: DemandDriverResult;
  readonly alignment?: AlignmentDriverResult;
}

/** What the store holds for the document's current revision, in the shape the drivers take, or undefined when no reading is recorded. */
async function storedExtraction(input: ResumeInput): Promise<RecordedExtraction | undefined> {
  const { state, structure } = await input.persistence.readDocument(input.ref);
  if (state.status !== 'known') return undefined;
  const kind = state.state.kind;
  if (kind !== 'recorded' && kind !== 'read-states-nothing' && kind !== 'partly-read') {
    return undefined;
  }
  const provenance =
    state.provenance ?? (structure.status === 'current' ? structure.provenance : undefined);
  if (provenance === undefined) return undefined;
  const reading: ScopePaperStructure | undefined =
    structure.status === 'current' ? structure.reading : undefined;
  return {
    state: kind,
    ...(structure.status === 'current' && reading !== undefined
      ? { structure: { structureId: structure.structureId, reading } }
      : {}),
    stamp: { promptVersion: provenance.promptVersion, modelId: provenance.modelId },
  };
}

export async function resumeScopeReading(input: ResumeInput): Promise<ResumeResult> {
  if (!(input.enabled ?? SCOPE_READING_DRIVERS_ENABLED)) return { outcome: 'disabled' };
  let recorded: RecordedExtraction | undefined;
  try {
    recorded = await storedExtraction(input);
  } catch (error) {
    console.error('Olea: the stored reading could not be read (ingestion unaffected)', { error });
    return { outcome: 'failed' };
  }
  if (recorded === undefined) return { outcome: 'nothing-recorded' };
  const refusals = input.refusals ?? sessionRefusals;
  const driverInput = { ...input, recorded, refusals };
  let demand: DemandDriverResult | undefined;
  let alignment: AlignmentDriverResult | undefined;
  try {
    demand = await runDemandDriver({
      persistence: input.persistence,
      ref: input.ref,
      recorded,
      units: input.units,
      transport: input.transport,
      refusals,
    });
  } catch (error) {
    console.error('Olea: owed part demands were not read (ingestion unaffected)', { error });
  }
  try {
    alignment = await runAlignmentDriver(driverInput, 'owed');
  } catch (error) {
    console.error('Olea: owed alignment was not run (ingestion unaffected)', { error });
  }
  return {
    outcome: 'ran',
    ...(demand !== undefined ? { demand } : {}),
    ...(alignment !== undefined ? { alignment } : {}),
  };
}

export async function alignNewConcepts(input: ResumeInput): Promise<ResumeResult> {
  if (!(input.enabled ?? SCOPE_READING_DRIVERS_ENABLED)) return { outcome: 'disabled' };
  try {
    const recorded = await storedExtraction(input);
    if (recorded === undefined) return { outcome: 'nothing-recorded' };
    const alignment = await runAlignmentDriver(
      { ...input, recorded, refusals: input.refusals ?? sessionRefusals },
      'new',
    );
    return { outcome: 'ran', alignment };
  } catch (error) {
    console.error('Olea: new-concept alignment was not run (ingestion unaffected)', { error });
    return { outcome: 'failed' };
  }
}
