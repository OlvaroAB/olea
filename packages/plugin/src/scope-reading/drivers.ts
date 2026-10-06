/**
 * `runScopeReadingDrivers` — the one entry point the ingestion trigger calls after
 * `recordExtraction` (`ol-egov.141.89.7.52`, scp.md 2.1): the demand driver, then the alignment
 * driver, each in its own try/catch, never throwing. A failure of either is logged content-free
 * (D-005) and leaves ingestion, the Outcome records and the next document unaffected.
 *
 * **Reachability (`[D-072]`).** Built, exported and tested; it has NO production caller yet. The
 * call belongs in `packages/plugin/src/ingestion/wiring.ts`, right after the extraction is recorded
 * (about 22 lines, shaped in `docs/direction/papers/examiner-scope-status/09-scope-reading-drivers.md`
 * section 5 of the service repo). It waits on `[D-534]` part 1 (whether the calls run automatically
 * on arrival) and on `ol-egov.141.89.7.68` releasing `wiring.ts`.
 */

import type { ExtractedUnit, OutcomeRecord, VaultSource, WorkerTaskTransport } from 'olea-core';
import { runAlignmentDriver } from './alignment-driver.js';
import type { DocumentReadingBasis } from './basis.js';
import { runDemandDriver } from './demand-driver.js';
import type { DocumentRef, RecordedExtraction, ScopeReadingPersistence } from './persistence.js';

export interface ScopeReadingDriverInput {
  /** The instance `openScopeReadingWriter` opened. */
  readonly persistence: ScopeReadingPersistence;
  readonly ref: DocumentRef;
  /** The manifest basis, with its page list. */
  readonly basis: DocumentReadingBasis;
  /** `persistence.recordExtraction`'s result. */
  readonly recorded: RecordedExtraction;
  /** THIS delivery's landed units; a unit's ordinal is its index. */
  readonly units: readonly ExtractedUnit[];
  /** The revision digest the sink delivered for this path, when it had one. */
  readonly deliveryRevisionDigest?: string;
  /** The courses the document is registered to. */
  readonly courses: readonly string[];
  /** The objectives resolved in this extraction. */
  readonly declarations: readonly OutcomeRecord[];
  /** The trigger's recording transport. */
  readonly transport: WorkerTaskTransport;
  /** Her vault, for the closed concept list. */
  readonly vault: VaultSource;
  /** Registered assessment documents' paths, excluded as description sources. */
  readonly assessmentPaths?: ReadonlySet<string>;
}

export async function runScopeReadingDrivers(input: ScopeReadingDriverInput): Promise<void> {
  try {
    await runDemandDriver(input);
  } catch (error) {
    console.error('Olea: part demands were not read (ingestion unaffected)', { error });
  }
  try {
    await runAlignmentDriver(input);
  } catch (error) {
    console.error('Olea: alignment was not run (ingestion unaffected)', { error });
  }
}
