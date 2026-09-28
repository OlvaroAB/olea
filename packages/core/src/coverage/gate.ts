/**
 * The gap view's exhaustive gate, fed from the population (`ol-egov.141.89.11.4`,
 * `ol-egov.141.89.11.19`; the chain spec's 2.2 gate).
 *
 * The gap view forms one coverage scope over every source it read
 * (`../gap/build.ts#buildGapView`); `../gap/coverage.ts#summariseCoverageScope` holds
 * the reading half of the gate and, given declared units, the "at least one unit,
 * every unit aligned" half. This turns a set of course populations into those
 * options:
 *
 * - no course declares a scope (no examiner document anywhere, and every document
 *   store readable): no options, so the gate is today's, unchanged (a claim is not
 *   withdrawn on no new evidence);
 * - otherwise every declaring course's units go in, with their support when aligned
 *   and none when not, so one unaligned unit withholds the claim; and
 *   `declaredScopeUnknown` is set when any declaring course's denominator is not
 *   known (declarations not extracted, a document partly read, unread, unreadable or
 *   with no record) or a document store could not be read.
 *
 * A course with no declared scope does not withhold the claim here: the gap view's
 * sentence is scoped to the papers Olea could read, and such a course has none.
 */

import type { SummariseCoverageScopeOptions } from '../gap/coverage.js';
import type { CoursePopulation } from './types.js';

export type CoverageGateOptions = Pick<
  SummariseCoverageScopeOptions,
  'declaredUnits' | 'declaredScopeUnknown'
>;

export function coverageGateOptionsOf(
  populations: readonly CoursePopulation[],
): CoverageGateOptions {
  const storeUnreadable = populations.some((p) =>
    p.exhaustiveWithheldBecause.includes('document-store-unreadable'),
  );
  const declaring = populations.filter((p) => p.countedUnit === 'declared-unit');
  if (declaring.length === 0 && !storeUnreadable) return {};
  return {
    declaredUnits: declaring.flatMap((p) =>
      p.units.map((u) => ({
        declarationId: u.declarationId,
        conceptKeys: u.alignment === 'aligned' ? u.support : [],
      })),
    ),
    declaredScopeUnknown: storeUnreadable || declaring.some((p) => p.denominator.state !== 'known'),
  };
}
