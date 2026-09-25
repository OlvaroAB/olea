/**
 * Component register row 3.9's open-by-construction signal, made concrete
 * against the review-log fields that actually exist.
 *
 * `../support-level/types.ts` already named the SHAPE the signal must take —
 * {@link FailureShape}, admitting failure shape and recovery behaviour,
 * excluding latency, never a stage label or elapsed time. What that module
 * does not do is say how to GET a `FailureShape` out of a real graded
 * review. That derivation is this module's whole job, and it is where "her
 * review evidence for that concept at the granularity of the thing the
 * support is doing — explicitly finer than 'she got the card right'" (the
 * row's own words) is either honoured or quietly reduced back to the FSRS
 * rating it was supposed to improve on.
 *
 * ## Explain-back: correctness is read before depth (D-286, D-281)
 *
 * `[D-286 / GRD-3]` splits explain-back grading into two passes — pass one,
 * a narrow correct/partial/incorrect correctness verdict, and pass two, the
 * SOLO depth assessment below, which runs for a correct or partial verdict
 * and is SKIPPED for a clearly incorrect one. `[D-281]` names correctness as
 * an independent, required condition for the growth-stage tree's top stage:
 * *"Depth without correctness is a confident wrong answer, and the fold must
 * never promote one."* This module owes the same discipline, and used not
 * to: it read `soloLevel` alone, so a relational-but-incorrect answer read
 * as a clean pass. {@link deriveFailureShape} now reads `correctness` FIRST:
 *
 * - `'incorrect'` → always `'wrong-concept'`, whatever `soloLevel` says (or
 *   even if it is absent — pass two was never run). Depth never overrides
 *   correctness.
 * - `undefined` (unknown — a record written before this field existed;
 *   `[D-281]`: "read as unknown and can never be read as correct") → depth
 *   is read but capped below `'none'`: a clean or partial soloLevel both
 *   read as `'minor-slip'`, never a promotion on unverified depth alone.
 *   Unlike a confirmed `'incorrect'` verdict, an unknown one is not KNOWN to
 *   be wrong, so it is not escalated all the way to `'wrong-concept'`
 *   either — `'minor-slip'` is the honest middle: real, breaks a clean
 *   streak, but not an escalation trigger on data this module cannot vouch
 *   for. A `'prestructural'` reading still reads `'wrong-concept'`
 *   regardless, since that shape does not depend on correctness at all.
 * - `'correct'` / `'partial'` → depth is read at full strength (D-286 runs
 *   pass two for both, so a partial-but-well-structured answer still gets
 *   scored for structure), via the SOLO mapping below.
 *
 * A graded explain-back review carries `explainBackGrade.soloLevel` — Biggs
 * & Collis's five-level taxonomy (`olea-contracts`' `SoloLevel`), not a
 * pass/fail. That is real texture a card-level rating cannot express:
 * *"listed several relevant ideas without integrating them"* and *"missed
 * the point of the question entirely"* are both failures, but they are not
 * the same failure, and `[D-094]`'s ladder cares which one happened —
 * escalation is named for `'blank'` and `'wrong-concept'` specifically, not
 * for any failure. The mapping below reads the SOLO level as that texture,
 * once correctness has already cleared the answer for a depth reading:
 *
 * - `'extended-abstract'` / `'relational'` → `'none'`. A genuinely
 *   integrated or generalised answer is a clean pass — not merely "not
 *   wrong", the two levels the register's growth-stage `tree` reserves for
 *   real understanding.
 * - `'multistructural'` / `'unistructural'` → `'minor-slip'`. She engaged
 *   the actual question and produced relevant content — one point or
 *   several, unintegrated — which is real, recoverable shortfall, below
 *   `[D-094]`'s escalation bar (its own failure ranking puts "visible
 *   flapping" and "lingering drag" below "premature withdrawal", and an
 *   escalation on every partial answer would flap the level on the ordinary
 *   texture of learning).
 * - `'prestructural'` → `'wrong-concept'`. SOLO's own definition is a
 *   response that misses the point of the task, not merely an incomplete
 *   one — the closest honest match to `[D-094]`'s named escalation trigger
 *   for genuine conceptual confusion, not a partial one.
 *
 * `'blank'` (the row's other escalation-triggering shape, "an unengaged or
 * empty response") has no SOLO level at all — SOLO grades what she wrote,
 * and there is nothing to grade when she wrote nothing. A truly blank
 * attempt is therefore never observable through `explainBackGrade`; it can
 * only be observed, if at all, at the point an attempt is recorded as
 * declined or abandoned — a fact this module has no input for today, named
 * as a gap below.
 *
 * ## Recall (qa/cloze): the honest limit of today's data, and why the
 * fallback errs toward offering rather than toward invented texture
 *
 * A recall-tier review carries only the FSRS four-way `rating`
 * (`again`/`hard`/`good`/`easy`). `hard`/`good`/`easy` are all "she
 * recalled it", varying only in ease — genuinely nothing finer than
 * card-level correctness exists in that half of the scale, and this module
 * does not pretend otherwise: all three map to `'none'`.
 *
 * `'again'` is the one recall-tier failure, and it is irreducibly coarse —
 * there is no field anywhere that distinguishes "wrote nothing" from "wrote
 * a confidently wrong answer" for a `qa`/`cloze` card. **Inventing that
 * distinction from a single four-way rating would be exactly the kind of
 * fitted, undefended texture the register's declared/derived line and
 * `[D-094]`'s own "tuning: none available, and none should be invented"
 * forbid.** So `'again'` maps to `'wrong-concept'` — the escalation trigger,
 * not the shrug-off `'minor-slip'` — on the row's own stated asymmetry:
 * *"the evidence puts high support strongly positive for low-prior-knowledge
 * learners and strongly negative for high ... so err toward offering."*
 * Treating an ambiguous recall failure as escalation-worthy is erring in the
 * direction the row names; treating it as a shrug-off would be erring the
 * other way with no evidence to justify it. **This is a Class B judgement
 * call** (a non-persisted, reversible interpretation of ambiguous data), not
 * a re-reading of `[D-094]`'s own ladder rules, and it is recorded here
 * rather than left implicit in a branch, per this component's own precedent
 * (`ladder.ts`'s snap-back-doubling note).
 *
 * ## Recognition (MCQ) is out of scope, structurally
 *
 * `[D-094]`'s scope clause: the ladder lives on recall and explanation
 * tiers only — recognition (MCQ) has no ladder, "its options are its
 * scaffolding." {@link deriveFailureShape} throws on an `'mcq'` instrument
 * rather than silently returning a value, the same choice
 * `SupportLadderTier`'s own doc states: a caller holding a recognition-tier
 * instrument has no business calling into this component at all, and a
 * function that returned a plausible-looking answer here would hide that
 * mistake instead of surfacing it.
 *
 * ## What this module is NOT: hint uptake
 *
 * `SessionSupportOutcome.hintUptake` is the other half `[D-094]` admits
 * ("failure shape AND recovery behaviour"), and **no field anywhere in the
 * review log records whether an offered hint or source expansion was used.**
 * This is a genuine gap, not an oversight this module can close: adding that
 * field is a review-log schema change (the schema is FROZEN at v5,
 * `[D-117]`), which is this component's `boundary: split` policy half
 * touching a shape only the schema's own decision bead can grow — Class C,
 * out of this module's reach and out of `study-session/`'s ownership.
 * Every caller of the chooser (`./support-level-chooser.js`) must supply
 * `hintUptake` itself; until a real signal exists, the honest default is
 * `false` (never assume a hint was used — that keeps the ratchet's freeze
 * behaviour from firing on a fabricated positive).
 */
import type { InstrumentType, Rating, SoloLevel } from 'olea-contracts';
import type { FailureShape } from '../support-level/types.js';

/**
 * The slice of one graded review's real fields this module reads — never
 * the full `ReviewLogRecordV5`, so a caller can project any real record (or
 * a fixture) into this shape without this module importing `review-log/` at
 * all.
 */
export interface GradedReviewEvidence {
  readonly instrumentType: InstrumentType;
  readonly rating: Rating;
  /** Present only for a graded explain-back review — `ReviewLogRecordV5.explainBackGrade.soloLevel`, verbatim. */
  readonly soloLevel?: SoloLevel;
  /**
   * Present only for a graded explain-back review —
   * `ReviewLogRecordV5.explainBackGrade.correctness`, verbatim
   * (`[D-286 / GRD-3]`'s pass-one verdict; `[D-281]`'s independent
   * correctness condition). Undefined means UNKNOWN, never correct — a
   * record written before this field existed. See the module doc and
   * {@link deriveFailureShape} for how each value reads.
   */
  readonly correctness?: 'correct' | 'partial' | 'incorrect';
}

const EXPLANATION_CLEAN: readonly SoloLevel[] = ['relational', 'extended-abstract'];
const EXPLANATION_PARTIAL: readonly SoloLevel[] = ['unistructural', 'multistructural'];

/**
 * See the module doc for the full argument behind each branch. Throws on an
 * `'mcq'` instrument (recognition tier, out of `[D-094]`'s scope by rule) —
 * a thrown error surfaces a caller's mistake instead of returning a
 * plausible-looking value for a tier this component has no business scoring.
 */
export function deriveFailureShape(evidence: GradedReviewEvidence): FailureShape {
  if (evidence.instrumentType === 'mcq') {
    throw new Error(
      'deriveFailureShape: mcq is a recognition-tier instrument — [D-094] gives it no ladder, ' +
        'so it has no business being scored by this component at all',
    );
  }

  if (evidence.instrumentType === 'explain-back') {
    // [D-286 / GRD-3]: correctness is pass one and is read FIRST. A clearly
    // incorrect verdict is a failure whatever the depth pass found — pass
    // two is skipped entirely for 'incorrect', so soloLevel need not even be
    // present. This is the fix for the bug this module existed to close: a
    // relational or extended-abstract soloLevel must never override an
    // incorrect correctness verdict into 'none'.
    if (evidence.correctness === 'incorrect') {
      return 'wrong-concept';
    }

    const level = evidence.soloLevel;
    if (level === undefined) {
      throw new Error(
        'deriveFailureShape: an explain-back review with no soloLevel — either an ungraded ' +
          'attempt (this module has no input for that case; see module doc, "blank" section) ' +
          'or a caller error. Do not pass a soloLevel-less explain-back record here.',
      );
    }

    if (evidence.correctness === undefined) {
      // [D-281]: "Records written before this field existed read as unknown
      // and can never be read as correct." A record with no correctness
      // signal at all — every pre-D-286 single-pass grade — must not be
      // promoted to a clean pass on depth alone; that is exactly the
      // confident-wrong-answer promotion D-281 forbids for the growth-stage
      // fold, and this component owes the same discipline. Unlike a
      // CONFIRMED 'incorrect' verdict, though, an unknown one is not known to
      // be wrong, so it is not escalated to 'wrong-concept' either — it is
      // capped at 'minor-slip': real, breaks a clean streak, but not an
      // escalation trigger on data this component cannot actually vouch for.
      if (EXPLANATION_CLEAN.includes(level)) return 'minor-slip';
      if (EXPLANATION_PARTIAL.includes(level)) return 'minor-slip';
      return 'wrong-concept'; // 'prestructural'
    }

    // correctness is 'correct' or 'partial': pass one passed (D-286 runs the
    // depth pass for both), so depth is read at full strength.
    if (EXPLANATION_CLEAN.includes(level)) return 'none';
    if (EXPLANATION_PARTIAL.includes(level)) return 'minor-slip';
    return 'wrong-concept'; // 'prestructural'
  }

  // Recall tier: 'qa' | 'cloze'.
  return evidence.rating === 'again' ? 'wrong-concept' : 'none';
}
