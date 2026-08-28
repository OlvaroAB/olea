/**
 * Mechanical answer-vs-source overlap pre-check, upstream of Slot J
 * (`explain-back.judge.v1`) — `ol-nvdk` / P4-T02a.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 *
 * `ol-subh` (E2a) found that a language-model judge can be talked into
 * praising an answer that is just the source text returned unchanged, unless
 * a prompt rule names that failure explicitly. Prompt 1.1.0 fixed it — one
 * rule, 6/7 false praise down to 0/7 — but the fix is a sentence a future
 * prompt edit or model swap can silently stop honouring. `ol-nvdk` asked for
 * a MECHANICAL, deterministic overlap measure as defence-in-depth against
 * exactly that drift. `[D-089]` and then `[D-138]` (see "RECORD-ONLY" below)
 * settled that the measure stays record-only rather than gating anything: it
 * does not veto a model call, and does not replace the prompt rule — see
 * "WHAT THIS DOES NOT CATCH" below.
 *
 * ===========================================================================
 * WHERE THIS RUNS: CLIENT, NOT WORKER
 * ===========================================================================
 *
 * The bead left client-vs-Worker open. This lives in `olea-core` (client)
 * because:
 *
 * - It is pure computation over strings the client already holds — her
 *   answer and the source excerpt/reference answer it is being graded
 *   against. No content needs to travel anywhere to compute it.
 * - The project's stated architecture is "local event-sourcing with a
 *   stateless remote calculator" (`olea-service/CLAUDE.md` §"The execution
 *   model"): the Worker receives transient context, computes, and forgets.
 *   A measurement that needs no model call is exactly the kind of work that
 *   shouldn't cross the wire at all.
 *
 * This module's own gate never shipped (see "RECORD-ONLY" below), so the
 * trade-off `ol-p4t02` originally recorded here — a client-side pre-check
 * makes the round trip itself optional, which a Worker-side one could not —
 * never came into play; it is history, not a live consideration.
 *
 * ===========================================================================
 * THE MEASURE, AND WHY CONTAINMENT IS THE HEADLINE SIGNAL
 * ===========================================================================
 *
 * Three candidate measures were computed against the same input
 * (`measureAnswerSourceOverlap` returns all three):
 *
 * - **`containment`** (primary/reported): the fraction of the answer's
 *   contiguous word n-grams (default n=8, adaptively shrunk for short
 *   answers) that appear verbatim, in the same order, somewhere in the
 *   source. This is the standard shingling measure plagiarism detectors use
 *   because it specifically detects "copied contiguous phrases," and is
 *   naturally tolerant of an answer that reuses individual technical terms
 *   scattered non-contiguously — which a genuine explanation does all the
 *   time and should not be punished for.
 * - **`lcsRatio`** (diagnostic only): longest common token subsequence
 *   (order-preserving, not necessarily contiguous) over answer length.
 * - **`jaccard`** (diagnostic only): unstructured unigram bag-of-words
 *   overlap.
 *
 * **Evidence for choosing containment as the headline signal** (computed
 * offline, no model calls, against the 7-source E2a ratified pool in
 * `eval/data/` — see `ol-nvdk`'s bead notes for the numbers; the pool's real
 * content stays in `olea-service`, so only the shape is repeated here):
 * word-8-gram containment gave a **clean bimodal split** — the
 * verbatim-source-paste trap measured 1.000 on every source, and every one
 * of the other five knowledge-independent traps (blank, i-don't-know,
 * confident-filler, question-restatement, off-topic) measured 0.000 on
 * every source. `lcsRatio` and `jaccard` did not separate anywhere near as
 * cleanly (`i-dont-know` alone reached 0.5 `lcsRatio` on one source, purely
 * from short-answer token coincidence) — they are reported for visibility
 * but are not fit to gate on. The separation held across n=4..12, so n=8
 * is not a fragile pick; it is inside a wide flat region, chosen as a round
 * number in the middle of it rather than to fit a particular result.
 *
 * ===========================================================================
 * WHAT THIS DOES NOT CATCH — the semantic layer still matters
 * ===========================================================================
 *
 * Containment is order-sensitive and near-exact by design: swap synonyms
 * into a paste, reorder a couple of clauses, or paraphrase while keeping the
 * structure, and the 8-word runs stop matching — containment falls sharply
 * even though the "explanation" is still just dressed-up reproduction. That
 * is intentional, not a gap this file should try to close: E2a's own
 * argument for the prompt-rule layer is that near-verbatim paraphrase is a
 * *semantic* judgement ("is this the same claim in different words?"), which
 * a mechanical string measure cannot make reliably without starting to
 * produce false positives against genuine explanations that legitimately
 * reuse source vocabulary. Two layers, two failure modes: this module is the
 * structural floor for the case that needs no judgement at all; prompt 1.1.0
 * (`explain-back.judge/system.prompt.md`) remains the semantic layer for
 * everything short of that.
 *
 * ===========================================================================
 * RECORD-ONLY — THE THRESHOLD WAS DELETED, NOT MERELY LEFT DISABLED
 * ===========================================================================
 *
 * This module never got past "ships with its threshold off by default":
 * `ol-subh`'s own E2a already gates false praise via the prompt layer, and
 * `[D-089]` ruled component 2.4's restatement check record-only before any
 * decision bead ratified a gate term for it. `[D-138]` then deleted the
 * unratified `thresholdContainment` dial itself, rather than leaving a dead
 * knob that reads as a live tuning point — nothing downstream gates on
 * `containment`, so a threshold field with no gate to attach it to was
 * standing drift, not caution held in reserve.
 *
 * `precheckRestatement` therefore only ever measures and returns an
 * `OverlapMeasurement`. It does not decide anything, never short-circuits a
 * model call, and never fabricates a grading. A caller that wants to act on
 * `containment` — surface it to the student, log it, feed a future ratified
 * gate — does so with the number this function reports; inventing that
 * decision is out of scope for this module by design.
 */

/** One trap-category measurement — record-only per `[D-138]`, see the module header. */
export interface OverlapMeasurement {
  /**
   * Fraction (0..1) of the answer's `ngramSize`-word shingles that occur
   * verbatim, in order, somewhere in the source material. The headline signal.
   */
  readonly containment: number;
  /** Longest common token subsequence / answer token count. Diagnostic only. */
  readonly lcsRatio: number;
  /** Unigram Jaccard over the token sets. Diagnostic only. */
  readonly jaccard: number;
  /** The n actually used for `containment` (adaptively shrunk for short answers). */
  readonly ngramSize: number;
  readonly answerTokenCount: number;
  readonly sourceTokenCount: number;
}

/** Requested word-shingle size for `containment`. Adaptively shrunk, never grown. */
const DEFAULT_NGRAM_SIZE = 8;

/** Shortest shingle still considered meaningful for a near-total-reproduction check. */
const MIN_NGRAM_SIZE = 3;

/**
 * `lcsRatio`'s dynamic program is O(answerTokens x sourceTokens). Real
 * explain-back answers and source excerpts are exam-scale text (E2a pins its
 * excerpt at 1,800 characters, a few hundred tokens), so this cap is far
 * above any real input; it exists only so a pathological caller cannot turn
 * a diagnostic-only number into a performance incident.
 */
const LCS_TOKEN_CAP = 2000;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function ngramSet(tokens: readonly string[], n: number): Set<string> {
  const shingles = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    shingles.add(tokens.slice(i, i + n).join(' '));
  }
  return shingles;
}

/** Longest common (not necessarily contiguous) token subsequence length. */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  const at = a.length > LCS_TOKEN_CAP ? a.slice(0, LCS_TOKEN_CAP) : a;
  const bt = b.length > LCS_TOKEN_CAP ? b.slice(0, LCS_TOKEN_CAP) : b;
  let previousRow = new Array<number>(bt.length + 1).fill(0);
  for (let i = 1; i <= at.length; i++) {
    const currentRow = new Array<number>(bt.length + 1).fill(0);
    for (let j = 1; j <= bt.length; j++) {
      const diagonal = previousRow[j - 1] ?? 0;
      const above = previousRow[j] ?? 0;
      const left = currentRow[j - 1] ?? 0;
      currentRow[j] = at[i - 1] === bt[j - 1] ? diagonal + 1 : Math.max(above, left);
    }
    previousRow = currentRow;
  }
  return previousRow[bt.length] ?? 0;
}

function jaccardOf(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Measures how much of `studentAnswer` is mechanically reproduced from
 * `sourceMaterial` (the reference answer, optionally joined with a source
 * excerpt — the bead's `referenceAnswer + source excerpt` formula; today's
 * `explain-back.judge.v1` contract only carries `referenceAnswer`, and the
 * two coincide, see the caller in `precheckRestatement`).
 *
 * Pure and deterministic: same inputs, same output, no I/O, no randomness.
 * An empty answer measures as all-zero rather than throwing — there is
 * nothing to have restated, which `precheckRestatement` treats as "let the
 * model see it" (E2a's blank trap is already handled correctly by the
 * model, per its passing gate; this pre-check has no reason to intercept it).
 */
export function measureAnswerSourceOverlap(
  studentAnswer: string,
  sourceMaterial: string,
  ngramSize: number = DEFAULT_NGRAM_SIZE,
): OverlapMeasurement {
  const answerTokens = tokenize(studentAnswer);
  const sourceTokens = tokenize(sourceMaterial);

  if (answerTokens.length === 0) {
    return {
      containment: 0,
      lcsRatio: 0,
      jaccard: 0,
      ngramSize: Math.max(MIN_NGRAM_SIZE, Math.min(ngramSize, 1)),
      answerTokenCount: 0,
      sourceTokenCount: sourceTokens.length,
    };
  }

  const effectiveN = Math.max(MIN_NGRAM_SIZE, Math.min(ngramSize, answerTokens.length));
  const answerShingles = ngramSet(answerTokens, effectiveN);
  const sourceShingles = ngramSet(sourceTokens, effectiveN);
  let matched = 0;
  for (const shingle of answerShingles) {
    if (sourceShingles.has(shingle)) {
      matched++;
    }
  }
  const containment = answerShingles.size === 0 ? 0 : matched / answerShingles.size;
  const lcsRatio = lcsLength(answerTokens, sourceTokens) / answerTokens.length;
  const jaccard = jaccardOf(answerTokens, sourceTokens);

  return {
    containment,
    lcsRatio,
    jaccard,
    ngramSize: effectiveN,
    answerTokenCount: answerTokens.length,
    sourceTokenCount: sourceTokens.length,
  };
}

// ---------------------------------------------------------------------------
// The pre-check: measurement only — see "RECORD-ONLY" in the module header
// ---------------------------------------------------------------------------

export interface RestatementPrecheckInput {
  readonly question: string;
  readonly studentAnswer: string;
  readonly referenceAnswer: string;
  /** Additional source text beyond the reference answer, if the caller has it. */
  readonly sourceExcerpt?: string;
}

export interface RestatementPrecheckOptions {
  readonly ngramSize?: number;
}

/**
 * Combines `input.referenceAnswer` with `input.sourceExcerpt` (if supplied)
 * and measures the student's answer against that combined source material.
 * Pure, synchronous, no I/O, and purely observational — see "RECORD-ONLY" in
 * the module header. `[D-138]` deleted the threshold this used to gate on;
 * this function never decided anything even before that, and does not
 * regain that role now — it only ever returns the measurement.
 */
export function precheckRestatement(
  input: RestatementPrecheckInput,
  options: RestatementPrecheckOptions = {},
): OverlapMeasurement {
  const sourceMaterial = input.sourceExcerpt
    ? `${input.referenceAnswer}\n\n${input.sourceExcerpt}`
    : input.referenceAnswer;
  return measureAnswerSourceOverlap(input.studentAnswer, sourceMaterial, options.ngramSize);
}
