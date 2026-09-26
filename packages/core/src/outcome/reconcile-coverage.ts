/**
 * Coverage reads over the outcome→concept containment edge (`[OUT-3]`, F4.1, component register
 * rows 1.1b and 2.11). Two plain shares — no model call, no free parameter, pure functions of
 * records already resolved (`./reconcile.ts` is what populates `OutcomeRecord.conceptKeys` in the
 * first place; this module only reads the result).
 *
 * **Named consumers, per the component register.**
 * - `outcomeCoverageShare` ("share of Outcomes with at least one attached concept") is read by
 *   component register row **2.11**, the practice-paper generator (F4.11): its unlock rule's
 *   material-coverage input needs to know whether a course's examiner-declared scope has concept
 *   coverage behind it before a paper's blueprint can be filled. Wired into production
 *   2026-09-25 (`ol-2zfj.172`): production caller is
 *   `packages/plugin/src/paper/provider.ts:118`'s `loadCourseState`, which passes the result to
 *   `packages/plugin/src/paper/unlock.ts`'s `evaluatePracticePaperUnlockForCourse` and, from
 *   there, into `packages/core/src/oracle/paper-unlock.ts:97`'s `evaluatePaperUnlock`.
 * - `conceptCoverageShare` ("share of concepts under some Outcome") is read by F4.2's high-yield
 *   ranking, which register row 1.1b already names as treating Outcome as "its own evidence
 *   basis, stated separately from past-paper evidence" — a concept under no Outcome at all has no
 *   examiner-declared parent to inherit that separate evidence tier from. No ranking call site
 *   reads this yet; it lands once that reading is built.
 *
 * Both take already-resolved records, never touch a vault, and never branch on
 * `OutcomeRecord.extractorSelfRating` — `[D-253]`'s "no consumer may branch or threshold on it
 * until calibrated" rule applies here exactly as it does everywhere else the field is read.
 *
 * **`outcomeCoverageKnown` / `conceptCoverageKnown` (ol-egov.141.89.11.15).** A course with zero
 * active Outcome declarations (or zero registry concepts) has UNKNOWN coverage — there is nothing
 * to measure against — not a genuine 0% share. The trace that found this
 * (`docs/dev/intelligence-build/vew.md`, olea-service) flagged the old behaviour: `0 / 0` read as
 * the same `outcomeCoverageShare: 0` a course with real declared scope and zero attachment would
 * read, feeding F4.11's unlock a fabricated measurement rather than an honest "cannot measure
 * yet". Ruling 4a (`[D-252]`/`[D-255]`) already answers what the unlock rule should do with that:
 * "far from it, material coverage is the gate" — a gate that cannot be confirmed cannot fire, the
 * same effective outcome the pre-existing 0-share fallback already produced for this exact case
 * (`0 >= coverageGateShare` is false regardless). So this fix changes nothing she sees: the share
 * numbers are unchanged for every existing typed reader, and the two new boolean fields are
 * additive. They exist so a future caller — F8.3's "a count and its source, never a quotient"
 * statement of why a course's paper is locked, not yet built (`packages/plugin/src/paper/copy.ts`
 * still renders generic degraded-coverage copy) — can render "no declared scope yet" honestly
 * instead of "0 of 0 concepts covered".
 */

import type { OutcomeRecord } from './types.js';

export interface OutcomeConceptCoverage {
  readonly outcomeCount: number;
  readonly attachedOutcomeCount: number;
  /**
   * `attachedOutcomeCount / outcomeCount`, or 0 when there are no active outcomes to divide by.
   * That 0 is a placeholder, not a measurement — check `outcomeCoverageKnown` before reading this
   * as "0% covered": a course with zero active declarations has UNKNOWN material coverage
   * (nothing to measure against), not a genuine zero share. Kept as 0 rather than `null` so every
   * existing typed reader (F4.11's coverage gate, `[D-255]`) keeps compiling and behaving exactly
   * as before — the gate never fires on 0 either way, so this is not a behaviour change for her;
   * `outcomeCoverageKnown` is the new, honest signal a caller can read once it wants to render the
   * unknown case differently from a real 0%. (ol-egov.141.89.11.15)
   */
  readonly outcomeCoverageShare: number;
  /**
   * `false` when `outcomeCount` is 0 (no active declarations to measure against — unknown, not
   * a measured zero); `true` whenever `outcomeCount > 0`, whatever the resulting share. Optional
   * (never absent from `outcomeConceptCoverage`'s own return, always populated there) only so a
   * hand-written `OutcomeConceptCoverage` fixture literal predating this field — none of which
   * this bead owns or may edit — keeps compiling untouched; a real caller of the function always
   * gets the field.
   */
  readonly outcomeCoverageKnown?: boolean;
  readonly conceptCount: number;
  readonly attachedConceptCount: number;
  /**
   * `attachedConceptCount / conceptCount`, or 0 when the course's registry is empty. Same caveat
   * as `outcomeCoverageShare`: check `conceptCoverageKnown` before reading this as a measurement.
   */
  readonly conceptCoverageShare: number;
  /**
   * `false` when `conceptCount` is 0 (no concepts in the registry to measure against — unknown,
   * not a measured zero); `true` whenever `conceptCount > 0`. Optional for the same
   * pre-existing-fixture-literal reason as `outcomeCoverageKnown` above.
   */
  readonly conceptCoverageKnown?: boolean;
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
    outcomeCoverageKnown: activeOutcomes.length > 0,
    conceptCount: conceptKeySet.size,
    attachedConceptCount,
    conceptCoverageShare: conceptKeySet.size === 0 ? 0 : attachedConceptCount / conceptKeySet.size,
    conceptCoverageKnown: conceptKeySet.size > 0,
  };
}
