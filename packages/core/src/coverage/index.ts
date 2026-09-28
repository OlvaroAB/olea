/**
 * The standing views' population record and per-unit coverage (`ol-egov.141.89.11.4`).
 * See `./population.ts` for the rules and `./readers.ts` for the production inputs.
 */

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
