/**
 * The standing views' population record and per-unit coverage (`ol-egov.141.89.11.4`).
 * See `./population.ts` for the rules and `./readers.ts` for the production inputs.
 */

export {
  COUNT_CAUSE_MIN_STEPS,
  type CountCauseEvent,
  type CountCauseKind,
  type CountCauseMeasured,
  type CountCauseVerdict,
  type CountReceiptLine,
  checkCountCauseAttribution,
  countReceiptsBetween,
  type PopulationCountStep,
} from './count-cause.js';
export { type CoverageGateOptions, coverageGateOptionsOf } from './gate.js';
export { buildCoursePopulation, buildCoursePopulations } from './population.js';
export {
  conceptEvidenceFromAttainment,
  conceptEvidenceOfAttainment,
  conceptExtractionOfScopeSource,
  declarationsFromOutcomeRecords,
  populationReadingOfManifest,
  populationReadingOfScopeSource,
} from './readers.js';
export type * from './types.js';
