/**
 * Component register row 4.5's named health check, for F8.7's recognition
 * derivation (`../today/earlier-course-recognition.js`, `RECOG-1`).
 *
 * The row states the method in its own words: *"the neutralised-twin method
 * again — a vault where one concept legitimately reappears across two
 * courses, against one where two different concepts merely share wording."*
 * Same family as `rhythm-neutralised-twin.ts` (this directory's own
 * pattern): the derivation has already run — a caller (a test, a workbench
 * inspector) builds a genuine case (one `conceptId` genuinely present in two
 * courses' scope, with evidence) and its neutralised twin (two DIFFERENT
 * concept ids, one per course, standing in for two concepts that merely share
 * wording — a homonym), runs `buildEarlierCourseRecognitions` on each, and
 * hands the two recognition counts here. This module does no I/O and calls
 * the derivation itself.
 *
 * ## Why the twin case's false positive is GATED here, unlike rows 4.2/4.4
 *
 * `rhythm-neutralised-twin.ts` and the cramming detector both report a
 * false-positive rate on the twin without failing on it, because both rest
 * on a declared threshold with a genuine tuning tradeoff — some non-zero rate
 * is the honest cost of a workable cutoff. This derivation has no threshold
 * at all: it matches concept ids for equality and nothing else (register row
 * 4.5, "practical ceiling" — cross-course MERGE, i.e. treating two different
 * ids as one concept, is explicitly out of scope). So a neutralised twin
 * (two distinct concept ids) producing a recognition that links them is not
 * an inherent false-positive cost to report — it would mean the derivation
 * matched across different ids, which is a correctness bug, not a threshold
 * to tune. Register row 4.5's own words: *"concept-identity fuzziness is the
 * real risk here, not a threshold"* — the fuzziness risk sits upstream, in
 * extraction assigning ids, never in this exact-match derivation. Both
 * failure kinds are therefore gated.
 */
import type { CheckVerdict } from './types.js';

export interface RecognitionTwinCase {
  /** Opaque case id — never a real course code or concept name (INV-3). */
  readonly id: string;
  /** Recognitions `buildEarlierCourseRecognitions` produced for the genuine case (one concept id, present in both courses, with evidence). */
  readonly realRecognitionCount: number;
  /** Recognitions produced for the SAME case with only concept identity neutralised (two different ids standing in for two concepts sharing wording, not one). */
  readonly neutralisedRecognitionCount: number;
}

export interface RecognitionNeutralisedTwinMeasured {
  readonly n: number;
  /** Ids where the genuine case produced no recognition at all — the derivation failed to recognise a real cross-course match. */
  readonly missedReal: readonly string[];
  /** Ids where the neutralised twin (different concept ids) still produced a recognition — a false cross-id match. */
  readonly falsePositiveOnTwin: readonly string[];
}

/**
 * Fails on any missed real case, any false positive on a neutralised twin, or
 * if zero cases were supplied (N-013). Unlike `checkRhythmNeutralisedTwin`,
 * `falsePositiveOnTwin` here DOES affect `ok` — see this module's doc for why
 * that asymmetry with row 4.2/4.4's checks is deliberate.
 */
export function checkEarlierCourseRecognitionNeutralisedTwin(
  cases: readonly RecognitionTwinCase[],
): CheckVerdict<RecognitionNeutralisedTwinMeasured> {
  const missedReal = cases.filter((c) => c.realRecognitionCount <= 0).map((c) => c.id);
  const falsePositiveOnTwin = cases
    .filter((c) => c.neutralisedRecognitionCount > 0)
    .map((c) => c.id);

  const measured: RecognitionNeutralisedTwinMeasured = {
    n: cases.length,
    missedReal,
    falsePositiveOnTwin,
  };

  if (cases.length === 0) {
    return { ok: false, measured, detail: 'zero cases supplied — nothing was checked' };
  }
  if (missedReal.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${missedReal.length} of ${cases.length} genuine case(s) produced no recognition at all: ${missedReal.join(', ')}`,
    };
  }
  if (falsePositiveOnTwin.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${falsePositiveOnTwin.length} of ${cases.length} neutralised twin(s) (different concept ids) still produced a recognition: ${falsePositiveOnTwin.join(', ')}`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `every genuine case was recognised and every neutralised twin correctly produced none, across ${cases.length} case(s)`,
  };
}
