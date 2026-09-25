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
 * **Not to be conflated with C5.6's readiness (`[D-264]`; audited by
 * `ol-v7r5.47`).** The word "readiness" names two distinct quantities in
 * this codebase, and this module is the other one. C5.6's readiness
 * (`../allocation/resolve-inputs.js`'s `PlanPolicyCourseInput.readiness`) is
 * evidence-backed recall coverage against an assessment's scope, used to
 * weight cross-course time allocation. `ReadinessFactors` here is R7's
 * recognition/knowledge split: a per-row *weight* on the gap view's existing
 * oracle ranking, based on whether the paper's format makes recognition
 * evidence predictive. Neither reads the other's output, and no consumer
 * imports both under one name — verified at audit time by checking every
 * caller of `resolvePlanPolicyCourseInputs` and every caller of
 * `readinessFactorsFor`/`GapRow.readiness` for overlap; the only shared file
 * is `../index.js`'s barrel re-export, which is not a computation.
 *
 * **The one number in this module is ratified as a measured provisional
 * baseline — `[D-278]`, 2026-09-24.** `DEFAULT_MCQ_RECOGNITION_WEIGHT` (0.60)
 * was swept against real rankings and replayed term logs and adopted as the
 * baseline, with a written revisit condition and a rule for moving it (see the
 * constant's own doc). It is declared-with-baseline, not a fit: it may never
 * be tuned on synthetic data (`eval/CLAUDE.md`), and it moves only by decision
 * bead. Setting it to `1` still disables the weighting entirely and returns
 * the oracle's own ordering, which is what keeps it reversible from the
 * outside rather than by a code change.
 *
 * **When the credit fires (`ol-egov.141.89.9.4`).** On a recall-style
 * assessment, for a concept with demonstrated recognition. By default
 * "demonstrated" still means any past successful quiz answer
 * (`tiersSucceeded.recognition`), as today; a caller that supplies
 * `currentRecognition` (`../mastery/attainment.ts`'s
 * `readAllCurrentRecognition`) narrows it to a correct answer that is
 * current (not yet due again) and standing (not proven invalid), so a stale
 * or invalid answer never lowers need either (review 3.4; the attainment
 * chain spec's section 2.5). Wiring the gap view's caller to supply it is
 * `ol-egov.141.89.9.5`'s.
 *
 * **`currentRecognition` is `[D-349]`'s narrower claim, RULED 2026-09-25:**
 * "one qualifying success can provisionally demonstrate that particular
 * demand" — never a persistent capability, and this module treats it as
 * exactly that provisional, one that a later fact can withdraw. David's
 * ruling asked four things be defined for it (att.md section 7, proposal 5,
 * private repo); this module's answers, for the credit it consumes:
 *
 * 1. **"Current"** is `readAllCurrentRecognition`'s own definition: the
 *    LATEST rated review on the instrument succeeded, AND that instrument's
 *    recall estimate right now is at or above the retention target
 *    (`HOLDING_CUT`). Both conditions, not either alone.
 * 2. **A subsequent failure** withdraws the credit immediately: because
 *    "current" reads the latest rated review, one later "again" on the same
 *    instrument turns `currentRecognition` false the moment it is logged,
 *    whatever earlier success qualified it — there is no window in which a
 *    stale success keeps discounting need after it is known to have lapsed.
 * 3. **Confidence is a binary gate on one fixed discount, never graded.**
 *    This module shows no separate confidence number: `applied` is true or
 *    false, and the only weight it ever produces is `1` (not provisionally
 *    demonstrated) or {@link DEFAULT_MCQ_RECOGNITION_WEIGHT} (provisionally
 *    demonstrated) — never a value between them, and never a value derived
 *    from how many qualifying reviews occurred or by how much the recall
 *    estimate cleared the cut. That flatness *is* this module's answer to
 *    "if it is shown at all": a magnitude of confidence is not shown.
 * 4. **Missing qualifying evidence reads as unknown, never as inability.**
 *    Withdrawn, absent or never-supplied `currentRecognition` all land on
 *    `weight = 1` — the oracle's own unweighted order, identical to "no
 *    signal either way" — never a value below `1`, which would read as a
 *    measured demonstration that she cannot do it (F4.9's floor; the same
 *    argument {@link DEFAULT_MCQ_RECOGNITION_WEIGHT}'s own doc makes for why
 *    nothing in this module is ever allowed to zero a row out).
 *
 * **Never restated here: which demand was checked, or whether it was the
 * right one.** This module receives `currentRecognition` as an opaque,
 * already-vetted fact — it does not know or decide that the assessment's
 * declared demand is `recall-a-fact` rather than, say, `calculate`, that the
 * success was unaided rather than assisted, or that the instrument declares
 * this demand at all. Every one of those checks is `../gap/demand.ts`'s
 * `demandsMetNow` (`[D-349]`'s own vocabulary match) and `./build.ts`'s
 * `unmetDemands` gate, which forces `currentRecognition` to `false` whenever
 * any declared demand is unmet (`./build.ts`'s `buildRow`) — so a "calculate"
 * demand is never satisfied by recognition-only practice, but that gate is
 * enforced once, upstream, rather than re-derived in this module from a
 * `PaperDemand` it never sees.
 *
 * **`ReadinessFactors.weight` is a third, orthogonal multiplier — never a
 * restatement of `oracle/rank.ts`'s `masteryNeedWeight` (`ol-v7r5.64`
 * [DOS-C6]).** Both happen to read facts about the same recognition-tier
 * evidence (mastery's own stage ceiling for recognition-only practice, and
 * this module's format-match discount), but they answer different questions
 * for different reasons — R7's own point, restated here so the two are never
 * folded into one explanation. A caller building reasoning text should read
 * `factors.masteryNeedWeight` for "what her mastery stage discounts" and
 * `ReadinessFactors.weight`/`.applied` for "what THIS paper's format
 * discounts further," never inferring one from the other or from the
 * combined `gapScore` — see `./build.js`'s module doc and `GapRow`'s
 * `assessmentRelevance` field for the third, pre-mastery-need number that
 * makes this attribution possible without recomputation.
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
 * **Ratified as the measured provisional baseline — `[D-278]` (2026-09-24).**
 * A sensitivity sweep over real rankings and replayed term logs (zero spend;
 * the finding and the sweep live in the private repo,
 * `findings/e7-gap-recognition-weight.md`) could not yet see the weight: no
 * replayed log holds a course whose concepts have mixed recognition evidence,
 * so the flat result is evidence neither for nor against 0.60. David adopted
 * 0.60 as the provisional baseline on that footing, never as a fit, with a
 * written pre-commitment. Its **revisit condition**: the first
 * completed recall-style assessment whose recorded scope holds at least three
 * concepts with mixed recognition evidence. It **moves only** under the
 * moved-enough rule (an order change in the part of the list she actually
 * walks AND worse recorded outcomes than the replayed counterfactual at 1.00),
 * after two such occasions in different courses, and only through a decision
 * bead. It stays deliberately not near 0: a concept she has only ever
 * recognised is still a concept she has never produced, and F4.9's
 * always-cover-the-full-syllabus clause is the reason no weight in this
 * pipeline is ever allowed to zero a row out (`rank.ts`'s `masteryNeedWeight`
 * makes the same argument for the same reason).
 */
export const DEFAULT_MCQ_RECOGNITION_WEIGHT = 0.6;

export interface ReadinessOptions {
  /**
   * See {@link DEFAULT_MCQ_RECOGNITION_WEIGHT}. **`1` disables the weighting
   * entirely** — the gap view then returns the oracle ranking's own order,
   * the supported way to turn the weighting off from outside for a replay or
   * a counterfactual.
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
  /**
   * At least one scored recognition (MCQ) event **succeeded** for this
   * concept — `ConceptMasteryEvidence.tiersSucceeded.recognition`. A wrong
   * MCQ answer is not demonstrated recognition and must never set this
   * (ol-lfhj, R7, review 3.4: "a wrong answer never lowers need") — reading
   * `tiersPracticed` here instead would make a wrong answer discount need
   * the same as a right one. When the caller supplies `currentRecognition`
   * to {@link readinessFactorsFor}, this is that fact instead: a correct
   * answer that is current and standing (`ol-egov.141.89.9.4`;
   * `[D-349]`'s ruled definition of "current," and what a subsequent
   * failure does to it, are on {@link readinessFactorsFor}'s doc).
   */
  readonly recognitionEvidence: boolean;
  /** Every scored event is recognition — carried for the surface, never used to zero a row (R7's framing clause). */
  readonly recognitionOnly: boolean;
  /** Whether the weighting actually fired. `false` whenever the format is not MCQ, there is no mastery entry, or there is no recognition evidence. */
  readonly applied: boolean;
  /**
   * `mcqRecognitionWeight` when `applied`, otherwise exactly `1`. Multiplies
   * the oracle's `priorityScore` to give the gap view's own `gapScore`.
   * **The only two values this ever takes** (`[D-349]`'s criterion 3): no
   * confidence gradient is expressed between "not provisionally
   * demonstrated" (`1`) and "provisionally demonstrated" (`mcqRecognitionWeight`).
   */
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
 *
 * `currentRecognition` (`ol-egov.141.89.9.4`): when supplied, whether a
 * correct, current, standing quiz answer exists for this concept
 * (`../mastery/attainment.ts`'s `readAllCurrentRecognition`) — and the credit
 * reads that instead of any past success, so a stale, wrong or invalid answer
 * never lowers need. Omitted, the credit reads exactly as it did before.
 */
export function readinessFactorsFor(
  mastery: ConceptMasteryResult | undefined,
  assessmentFormat: AssessmentFormat,
  options: ReadinessOptions = {},
  currentRecognition?: boolean,
): ReadinessFactors {
  const configured = options.mcqRecognitionWeight ?? DEFAULT_MCQ_RECOGNITION_WEIGHT;
  if (!(configured > 0 && configured <= 1)) {
    throw new Error(
      `readinessFactorsFor: mcqRecognitionWeight must be within (0, 1], got ${configured}`,
    );
  }

  const recognitionEvidence =
    currentRecognition ?? mastery?.evidence.tiersSucceeded?.recognition ?? false;
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
