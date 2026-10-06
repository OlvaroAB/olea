/**
 * `runScopeReadingDrivers` — the one entry point the ingestion trigger calls after
 * `recordExtraction` (`ol-egov.141.89.7.52`, scp.md 2.1): the demand driver, then the alignment
 * driver, each in its own try/catch, never throwing. A failure of either is logged content-free
 * (D-005) and leaves ingestion, the Outcome records and the next document unaffected.
 *
 * **Reachability (`[D-072]`), and the off switch (`[D-534]` 1b).** Wired: `ingestion/wiring.ts`'s
 * `triggerOutcomesExtractForLandedUnit` calls it right after the extraction is recorded, inside the
 * log-and-swallow try/catch, but only when `outcomes.scopeReading.drivers.enabled` (default off) is true, and
 * the default when no caller passes the switch is {@link SCOPE_READING_DRIVERS_ENABLED}, which ships `false` (`main.ts` passes nothing). `[D-344]` authorised
 * automatic spend for outcome extraction only; these calls (one demand call per part, up to eight
 * alignment calls per course) are not covered, so no model call beyond the extraction runs
 * automatically in production until a decision extends it.
 */

import type { ExtractedUnit, OutcomeRecord, VaultSource, WorkerTaskTransport } from 'olea-core';
import { runAlignmentDriver } from './alignment-driver.js';
import type { DocumentReadingBasis } from './basis.js';
import { runDemandDriver } from './demand-driver.js';
import type { DocumentRef, RecordedExtraction, ScopeReadingPersistence } from './persistence.js';

/**
 * `[D-534]` 1b: the off switch. A code-level constant, never a setting: a settings control would be
 * a new surface the student could see, and no clause defines one. Turning it on takes a decision
 * that extends `[D-344]` to these calls (with the expected cost, retry limits and applicable budget
 * the ruling asks to bring back), then flipping this one value, or passing `drivers: { enabled: true, assessmentPaths }` from the `scopeReading` block in `main.ts` (the `assessmentPaths` reader is `resolveAssessments(vault, base).records.map(r => r.path)`).
 */
export const SCOPE_READING_DRIVERS_ENABLED = false;

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
