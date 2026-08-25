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

import type { ConceptMasteryResult } from '../mastery/rollup.js';

/**
 * The practice format an assessment will actually ask for (F4.8).
 *
 * `'unknown'` is not a failure state and is the correct answer far more often
 * than the other two: her assignments table carries a free-text `type` column
 * that the reader preserves verbatim (`AssessmentRecord.type`), and nothing in
 * the contract maps most of its values to a question format.
 */
export type AssessmentFormat = 'mcq' | 'unknown';

/**
 * Which formats an assessment `type` resolves to.
 *
 * **Exactly one entry, and widening it is not a lane's call.** F4.8 names four
 * `type` values she uses (Quiz, Assignment, Lab, Test) and states one mapping
 * outright — *"MCQ drilling for quizzes"*. It states nothing about the other
 * three, and a `Test` is at least as likely to be written as multiple-choice.
 * So `quiz` maps and the rest do not. Adding a row here changes what she sees
 * on the basis of a guess about her own courses, which is a decision-bead
 * matter (Class B at best, and only with her assessment data in hand), not a
 * default an implementer picks.
 *
 * Matched case-insensitively on the trimmed value, because `type` is her
 * free text and `Quiz` / `quiz` are not two formats.
 */
const FORMAT_BY_ASSESSMENT_TYPE: ReadonlyMap<string, AssessmentFormat> = new Map([['quiz', 'mcq']]);

/**
 * The format an assessment's verbatim `type` resolves to.
 *
 * An absent `type` — which `readAssessments` reports honestly rather than
 * defaulting — and any value the map does not cover both resolve to
 * `'unknown'`, which weights nothing. Nothing here guesses, for the same
 * reason nothing else in this pipeline guesses: a wrong format silently
 * reorders her study list.
 */
export function assessmentFormatOf(type: string | undefined): AssessmentFormat {
  if (type === undefined) return 'unknown';
  return FORMAT_BY_ASSESSMENT_TYPE.get(type.trim().toLowerCase()) ?? 'unknown';
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
  const applied = assessmentFormat === 'mcq' && recognitionEvidence;

  return {
    assessmentFormat,
    recognitionEvidence,
    recognitionOnly,
    applied,
    weight: applied ? configured : 1,
  };
}
