/**
 * R7's **readiness/knowledge split**, applied in the one place the knowledge
 * model says it may be (F4.3, F4.8, P5-T06a).
 *
 * R7 in full, on the clause this module implements:
 *
 * > The gap view is where format matching cuts the other way: for an
 * > MCQ-format assessment, MCQ evidence is the *most* predictive readiness
 * > signal, and F4.3 may weight it accordingly. **Mastery describes knowledge;
 * > the gap view describes readiness for a specific paper; they may
 * > legitimately disagree.**
 *
 * **What that means concretely, and what it deliberately does not.** Mastery
 * (`../mastery/rollup.js`) weights recognition *down*: a concept practised only
 * on MCQs can reach `sapling` but never `tree`, because recognising a definition
 * among four options is not producing it. That is a statement about knowledge
 * and this module does not touch it — `masteryState` and the word shown for it
 * are byte-identical whether or not this weighting applies. What this module
 * changes is **need**: for a paper that will ask her to recognise, recognition
 * evidence is the evidence that predicts how she will do, so a concept she has
 * drilled on MCQs needs *less* of her remaining time than an identically-ranked
 * concept she has not.
 *
 * The direction is worth stating plainly because it is the opposite of
 * mastery's: mastery discounts MCQ evidence, this weights it up, and both are
 * right about different questions. R7 anticipates the disagreement and names
 * it as legitimate.
 *
 * **Framing (principle 12, R7's last clause).** The UI never says "MCQs don't
 * count" and it equally never says "MCQs are enough" — this weighting moves a
 * row's position, and the row still shows the mastery word mastery computed.
 * The copy is in `packages/plugin/src/gap/copy.ts`; nothing here produces
 * prose.
 *
 * **Every number in this module is provisional and unratified (Class B).**
 * `DEFAULT_MCQ_RECOGNITION_WEIGHT` is a guess with an argument, not a
 * measurement, exactly like `rank.ts`'s parameters — and, like them, it may
 * never be tuned on synthetic data (`eval/CLAUDE.md`). Setting it to `1`
 * disables the weighting entirely and returns the oracle's own ordering, which
 * is what makes this reversible from the outside rather than by a code change.
 *
 * **INV-1.** Pure; no `obsidian`, no I/O, no clock.
 */

import { type AssessmentFormatClass, formatClassOf } from '../assessment/format-class.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';

export { isDeclaredAssessmentType } from '../assessment/format-class.js';

/**
 * The practice format an assessment will actually ask for (F4.8).
 *
 * Three declared classes (`../assessment/format-class.js`'s
 * `AssessmentFormatClass`) plus `'unknown'` here for a case that module never
 * produces: **no assessment to derive a format from at all** (no upcoming
 * assessment, or none named). `'unknown'` is never what an unrecognised
 * `type` word resolves to — that falls to `'written'`, per `[D-246]` /
 * `[VOC-7]` — so `'unknown'` staying rare here is a *good* sign, not a
 * regression from the old two-value map.
 */
export type AssessmentFormat = AssessmentFormatClass | 'unknown';

/**
 * The format an assessment's verbatim `type` resolves to.
 *
 * Delegates to `../assessment/format-class.js`'s `formatClassOf` — the
 * declared word→class table lives there, alongside the reader, because it is
 * about assessment-type semantics rather than anything specific to the gap
 * view. `type` itself is never rewritten (`readAssessments` preserves it
 * verbatim); this only ever produces the internal class F4.8 uses to pick a
 * practice format, and that class is never shown to her.
 *
 * **Reachability note.** An unrecognised `type` word should, per `[D-246]`,
 * trigger the same ask-once-at-the-point-it-matters path F1.7 already
 * describes for assessment scope — but no caller for that ask exists yet in
 * either repo (F1.7's own "ask once" is a contract pattern, not a built
 * interaction). `../assessment/format-class.js`'s `isDeclaredAssessmentType`
 * is the signal such a caller would key on; wiring the caller itself is
 * left open on the decision bead rather than built speculatively here.
 */
export function assessmentFormatOf(type: string | undefined): AssessmentFormat {
  return formatClassOf(type);
}

/**
 * How much a concept's need is discounted when recognition evidence is the
 * predictive signal for this paper's format.
 *
 * **Provisional, unratified, unmeasured.** 0.6 is "meaningfully less pressing,
 * nowhere near settled" and that sentence is its entire justification. It is
 * deliberately not near 0: a concept she has only ever recognised is still a
 * concept she has never produced, and F4.9's always-cover-the-full-syllabus
 * clause is the reason no weight in this pipeline is ever allowed to zero a
 * row out (`rank.ts`'s `masteryNeedWeight` makes the same argument for the
 * same reason). Ratifying it needs a real MCQ-format assessment, her review
 * log across it, and how she actually did — through a decision bead.
 */
export const DEFAULT_MCQ_RECOGNITION_WEIGHT = 0.6;

export interface ReadinessOptions {
  /**
   * See {@link DEFAULT_MCQ_RECOGNITION_WEIGHT}. **`1` disables the weighting
   * entirely** — the gap view then returns the oracle ranking's own order,
   * which is the supported way to turn an unratified parameter off.
   */
  readonly mcqRecognitionWeight?: number;
}

/**
 * Why a concept's readiness weight is what it is — every input kept
 * individually inspectable, matching `OracleEdgeContribution`'s discipline,
 * because "why is this row here rather than there" has to be answerable
 * without re-running the computation.
 */
export interface ReadinessFactors {
  readonly assessmentFormat: AssessmentFormat;
  /** At least one scored recognition (MCQ) event exists for this concept — `ConceptMasteryEvidence.tiersPracticed.recognition`. */
  readonly recognitionEvidence: boolean;
  /** Every scored event is recognition — carried for the surface, never used to zero a row (R7's framing clause). */
  readonly recognitionOnly: boolean;
  /** Whether the weighting actually fired. `false` whenever the format is not MCQ, there is no mastery entry, or there is no recognition evidence. */
  readonly applied: boolean;
  /** `mcqRecognitionWeight` when `applied`, otherwise exactly `1`. Multiplies the oracle's `priorityScore` to give the gap view's own `gapScore`. */
  readonly weight: number;
}

/**
 * The readiness weight for one concept against one assessment format.
 *
 * `mastery` is `undefined` when no mastery entry exists for this concept —
 * which weights nothing, deliberately. "She has no recorded practice" is not
 * evidence she is ready; it is the absence of evidence either way, and the
 * oracle's own `masteryNeedWeight` already reads that absence (`'seed'` vs.
 * `'unknown'`, which `rank.ts` keeps distinct). Weighting on top of it here
 * would double-count one silence.
 */
export function readinessFactorsFor(
  mastery: ConceptMasteryResult | undefined,
  assessmentFormat: AssessmentFormat,
  options: ReadinessOptions = {},
): ReadinessFactors {
  const configured = options.mcqRecognitionWeight ?? DEFAULT_MCQ_RECOGNITION_WEIGHT;
  if (!(configured > 0 && configured <= 1)) {
    throw new Error(
      `readinessFactorsFor: mcqRecognitionWeight must be within (0, 1], got ${configured}`,
    );
  }

  const recognitionEvidence = mastery?.evidence.tiersPracticed.recognition ?? false;
  const recognitionOnly = mastery?.evidence.recognitionOnly ?? false;
  const applied = assessmentFormat === 'recall-style' && recognitionEvidence;

  return {
    assessmentFormat,
    recognitionEvidence,
    recognitionOnly,
    applied,
    weight: applied ? configured : 1,
  };
}
