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
 *
 * **The spend ledger (`[D-540]`, `ol-egov.141.89.7.76`).** Every demand and alignment call takes a
 * hold first (`../spend/vault-spend-ledger.ts`) and carries it as `remainingAllowanceUsd`; once the
 * 120-day period plus a hold would pass 80 percent of USD 12 the hold is declined, which the
 * readers raise as their over-budget signal, so the loops stop and the rest stays owed. With no
 * ledger passed in, nothing is sent.
 */

import type { ExtractedUnit, OutcomeRecord, VaultSource, WorkerTaskTransport } from 'olea-core';
import type { SpendLedger } from '../spend/vault-spend-ledger.js';
import { runAlignmentDriver } from './alignment-driver.js';
import type { DocumentReadingBasis } from './basis.js';
import { type PartRefusalLedger, runDemandDriver } from './demand-driver.js';
import {
  type DocumentRef,
  type RecordedExtraction,
  SCOPE_READING_ALIGN_TASK,
  SCOPE_READING_DEMAND_TASK,
  type ScopeReadingPersistence,
} from './persistence.js';

/**
 * `[D-534]` 1b: the off switch. A code-level constant, never a setting: a settings control would be
 * a new surface the student could see, and no clause defines one. Turning it on takes a decision
 * that extends `[D-344]` to these calls (with the expected cost, retry limits and applicable budget
 * the ruling asks to bring back), then flipping this one value, or passing `drivers: { enabled: true, assessmentPaths }` from the `scopeReading` block in `main.ts` (the `assessmentPaths` reader is `resolveAssessments(vault, base).records.map(r => r.path)`).
 * The spend ledger must be passed through as well (`[D-540]`: the `spend` dep the switch-on
 * composition adds); switched on with no ledger, the drivers send nothing.
 */
export const SCOPE_READING_DRIVERS_ENABLED = false;

/**
 * The refusal count (`ol-egov.141.89.7.84`, `[D-534]` cost brief item 5), kept in the spend ledger
 * (`[D-540]`, `ol-egov.141.89.7.76`): one `refusal` line per refusal, under an opaque SHA-256 of the
 * part or batch it names, counted over the ledger's 120-day period. The first-delivery path and the
 * resume pass read one count, and it survives a restart, so a part or batch refused
 * `REFUSED_PART_LIMIT` times is held back on every path until its structure or batch plan changes.
 * A count that cannot be read reads as held back; a refusal that cannot be written stops every
 * further call this session (`../spend/vault-spend-ledger.ts`). This replaces the in-memory session
 * ledger: with the spend ledger unavailable no call is sent at all, so nothing needs a fallback.
 */
export function spendRefusalLedger(spend: SpendLedger, taskId: string): PartRefusalLedger {
  return {
    count: (key) => spend.refusalCount(key),
    record: (key) => spend.recordRefusal(key, taskId),
  };
}

/** Why the entry points sent nothing: `[D-540]` precondition, a scope read is never sent without a hold. */
export const NO_SPEND_LEDGER_MESSAGE =
  'Olea: scope reading not run: no spend ledger was given, so no call is sent';

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
  /** Held-back parts and batches. Absent: the spend ledger's count ({@link spendRefusalLedger}). */
  readonly refusals?: PartRefusalLedger;
  /**
   * `[D-540]`: the spend ledger every demand and alignment call takes its hold from. Optional in the
   * type only so a composition that has not passed one yet still compiles; at run time its absence
   * sends nothing (fails closed).
   */
  readonly spend?: SpendLedger;
}

export async function runScopeReadingDrivers(input: ScopeReadingDriverInput): Promise<void> {
  const spend = input.spend;
  if (spend === undefined) {
    console.error(NO_SPEND_LEDGER_MESSAGE);
    return;
  }
  try {
    await runDemandDriver({
      ...input,
      spend,
      refusals: input.refusals ?? spendRefusalLedger(spend, SCOPE_READING_DEMAND_TASK),
    });
  } catch (error) {
    console.error('Olea: part demands were not read (ingestion unaffected)', { error });
  }
  try {
    await runAlignmentDriver({
      ...input,
      spend,
      refusals: input.refusals ?? spendRefusalLedger(spend, SCOPE_READING_ALIGN_TASK),
    });
  } catch (error) {
    console.error('Olea: alignment was not run (ingestion unaffected)', { error });
  }
}
