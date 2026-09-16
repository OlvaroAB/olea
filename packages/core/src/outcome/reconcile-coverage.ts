/**
 * Coverage reads over the outcome→concept containment edge (`[OUT-3]`, F4.1, component register
 * rows 1.1b and 2.11). Two plain shares — no model call, no free parameter, pure functions of
 * records already resolved (`./reconcile.ts` is what populates `OutcomeRecord.conceptKeys` in the
 * first place; this module only reads the result).
 *
 * **Named consumers, per the component register — neither built yet.** `runOutcomesExtract`'s own
 * reachability note (`packages/plugin/src/ingestion/wiring.ts`) already names the general
 * pattern: a composition may ship ahead of the surface that will call it, with the gap named
 * rather than hidden. These two consumers are named there for the same reason:
 * - `outcomeCoverageShare` ("share of Outcomes with at least one attached concept") is read by
 *   component register row **2.11**, the practice-paper generator (F4.11): its unlock rule's
 *   material-coverage input needs to know whether a course's examiner-declared scope has concept
 *   coverage behind it before a paper's blueprint can be filled. Row 2.11 itself is still "to
 *   build" (`ol-0r92.75` [H-blueprint]) — no production call site exists yet, tracked there.
 * - `conceptCoverageShare` ("share of concepts under some Outcome") is read by F4.2's high-yield
 *   ranking, which register row 1.1b already names as treating Outcome as "its own evidence
 *   basis, stated separately from past-paper evidence" — a concept under no Outcome at all has no
 *   examiner-declared parent to inherit that separate evidence tier from. No ranking call site
 *   reads this yet; it lands once that reading is built.
 *
 * Both take already-resolved records, never touch a vault, and never branch on
 * `OutcomeRecord.extractorSelfRating` — `[D-253]`'s "no consumer may branch or threshold on it
 * until calibrated" rule applies here exactly as it does everywhere else the field is read.
 */

import type { OutcomeRecord } from './types.js';

export interface OutcomeConceptCoverage {
  readonly outcomeCount: number;
  readonly attachedOutcomeCount: number;
  /** `attachedOutcomeCount / outcomeCount`, or 0 when there are no active outcomes to divide by. */
  readonly outcomeCoverageShare: number;
  readonly conceptCount: number;
  readonly attachedConceptCount: number;
  /** `attachedConceptCount / conceptCount`, or 0 when the course's registry is empty. */
  readonly conceptCoverageShare: number;
}

/**
 * `outcomes` — a course's ACTIVE Outcome records (F8.5-retired ones are excluded, mirroring
 * `./reconcile.ts`'s own skip: a withdrawn outcome is not live scope to measure coverage of).
 * `conceptKeys` — every concept key in that course's registry, the denominator for
 * `conceptCoverageShare` (duplicates are tolerated and deduplicated here).
 */
export function outcomeConceptCoverage(
  outcomes: readonly OutcomeRecord[],
  conceptKeys: readonly string[],
): OutcomeConceptCoverage {
  const activeOutcomes = outcomes.filter((outcome) => outcome.status === 'active');
  const attachedOutcomes = activeOutcomes.filter((outcome) => outcome.conceptKeys.length > 0);

  const attachedConceptKeySet = new Set<string>();
  for (const outcome of activeOutcomes) {
    for (const key of outcome.conceptKeys) attachedConceptKeySet.add(key);
  }
  const conceptKeySet = new Set(conceptKeys);
  let attachedConceptCount = 0;
  for (const key of conceptKeySet) {
    if (attachedConceptKeySet.has(key)) attachedConceptCount += 1;
  }

  return {
    outcomeCount: activeOutcomes.length,
    attachedOutcomeCount: attachedOutcomes.length,
    outcomeCoverageShare:
      activeOutcomes.length === 0 ? 0 : attachedOutcomes.length / activeOutcomes.length,
    conceptCount: conceptKeySet.size,
    attachedConceptCount,
    conceptCoverageShare: conceptKeySet.size === 0 ? 0 : attachedConceptCount / conceptKeySet.size,
  };
}
