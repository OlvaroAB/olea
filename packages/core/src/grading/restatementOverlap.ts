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
 * prompt edit or model swap can silently stop honouring, and the gate it
 * protects is absolute (one false praise is a fail at any n, because the
 * failure is silent and she carries it into an exam). This module is the
 * defence-in-depth layer `ol-nvdk` asks for: a MECHANICAL, deterministic
 * overlap measure that can veto a model call entirely for the clearest case
 * (near-total reproduction), so that case no longer depends on the model
 * continuing to behave. It does not replace the prompt rule — see
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
 *   A check that needs no model call is exactly the kind of work that
 *   shouldn't cross the wire at all — "the cheapest call is the one not
 *   made" is truest when the call is never placed.
 * - It makes the round trip itself optional for the clearest case, which a
 *   Worker-side pre-check could not do (the request would already have been
 *   sent).
 *
 * The cost: a Worker-side implementation would make the property true for
 * every caller of the task id regardless of client version, and this one
 * does not. That is a real trade-off, recorded rather than assumed away; the
 * grading pipeline that wires this in (`ol-p4t02`) is the place to decide
 * whether a server-side mirror is also warranted once there is more than one
 * caller of `explain-back.judge.v1`.
 *
 * ===========================================================================
 * THE MEASURE, AND WHY CONTAINMENT IS THE GATING SIGNAL
 * ===========================================================================
 *
 * Three candidate measures were computed against the same input
 * (`measureAnswerSourceOverlap` returns all three):
 *
 * - **`containment`** (primary/gating): the fraction of the answer's
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
 * **Evidence for choosing containment as the gating signal** (computed
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
 * THRESHOLD DISCIPLINE — NOT RATIFIED HERE
 * ===========================================================================
 *
 * `olea-service/eval/CLAUDE.md`: thresholds move only via a decision bead
 * recording the evidence, and synthetic data never tunes one. This module
 * ships with its threshold **off by default** (`thresholdContainment: null`
 * in `DEFAULT_RESTATEMENT_PRECHECK_OPTIONS`) precisely because the number
 * above, while measured against real material, is a first pass by one
 * implementer reading one pool, not a ratified gate term. What `ol-subh`'s
 * own E2a already gives, and what a ratification would want to cite:
 *
 * - The 7-source ratified pool, containment measured per trap category
 *   (paste vs. the other five) — done here, see above.
 * - The equivalent measurement re-run through a live E2a pass with the
 *   pre-check wired in and again with it disabled, per `ol-nvdk`'s
 *   acceptance criteria, so the prompt layer's independent contribution
 *   stays visible (this module does not run that; it is a pure function
 *   with no harness attached, by design — see "WHERE THIS RUNS" above).
 * - A stated false-positive tolerance: `ol-nvdk` is explicit that a false
 *   positive here is a real answer graded wrongly harshly — loud rather
 *   than silent, but still a harm — so any ratified T should sit with
 *   margin below the lowest paste measurement, not merely above the
 *   highest non-paste one.
 *
 * Until a decision bead ratifies a value, callers that want the pre-check
 * active must pass an explicit `thresholdContainment` — this module will
 * never silently start short-circuiting model calls.
 */

/** One trap-category measurement worth citing when a threshold is ratified. */
export interface OverlapMeasurement {
  /**
   * Fraction (0..1) of the answer's `ngramSize`-word shingles that occur
   * verbatim, in order, somewhere in the source material. The gating signal.
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
// The pre-check: a verdict plus an optional fixed grading, never a bare bool
// ---------------------------------------------------------------------------

export interface RestatementPrecheckInput {
  readonly question: string;
  readonly studentAnswer: string;
  readonly referenceAnswer: string;
  /** Additional source text beyond the reference answer, if the caller has it. */
  readonly sourceExcerpt?: string;
}

export interface RestatementPrecheckOptions {
  /**
   * Containment (0..1) at or above which the answer is treated as
   * restatement. `null` disables the pre-check entirely: every call
   * measures and reports `overlap` but never short-circuits — see the
   * module doc header, "THRESHOLD DISCIPLINE — NOT RATIFIED HERE".
   */
  readonly thresholdContainment: number | null;
  readonly ngramSize?: number;
}

/**
 * Provisional default. **Not a ratified gate term** — see the module doc
 * header. `thresholdContainment: null` means "measure, never short-circuit,"
 * which is the only safe default for code nobody has decided to gate yet.
 */
export const DEFAULT_RESTATEMENT_PRECHECK_OPTIONS: RestatementPrecheckOptions = {
  thresholdContainment: null,
};

export interface RestatementPrecheckGrading {
  readonly verdict: 'incorrect';
  readonly feedback: string;
  readonly missedPoints: readonly string[];
}

export interface RestatementPrecheckResult {
  /** True when `grading` should be returned instead of calling the model. */
  readonly shortCircuited: boolean;
  readonly overlap: OverlapMeasurement;
  /** Non-null exactly when `shortCircuited` is true. */
  readonly grading: RestatementPrecheckGrading | null;
}

const RESTATEMENT_FEEDBACK =
  'This answer closely reproduces the source material rather than explaining it. ' +
  'Restating the text back is not evidence of understanding it — try again without the ' +
  'source in front of you, in your own words.';

const RESTATEMENT_FALLBACK_MISSED_POINT =
  'An explanation in your own words, distinct from the source text, is missing.';

/**
 * Naive sentence split, used only to build a mechanical `missedPoints` list.
 * Good enough for "which whole sentences of the source never appear in the
 * answer" — it does not need to be a real sentence tokenizer, because its
 * output is a hint list, not a scored artifact.
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * `missedPoints` for a short-circuited grading.
 *
 * The bead's proposal is "missedPoints derived mechanically as
 * source-minus-answer." Implemented literally that would return the source
 * sentences absent from the answer — which is **empty for the exact case
 * this pre-check exists to catch**: a verbatim paste is, by definition, not
 * missing any of the source. An empty `missedPoints` on a fixed
 * `verdict: "incorrect"` is precisely E2a's own `nothing-missed`
 * false-praise criterion (`src/harness/e2a.ts` §3(b) in `olea-service`) —
 * this pre-check would be mechanically reproducing the exact failure shape
 * it was built to guard against. So: return the literal source-minus-answer
 * sentences when there are any (a partial paste can meaningfully point at
 * what is missing), and fall back to one fixed, honest sentence naming what
 * is actually absent — an explanation in her own words — when the diff is
 * empty. `missedPoints` is therefore never empty out of this function.
 */
function mechanicalMissedPoints(sourceMaterial: string, studentAnswer: string): string[] {
  const answerLower = studentAnswer.toLowerCase();
  const missing = splitSentences(sourceMaterial).filter(
    (sentence) => !answerLower.includes(sentence.toLowerCase()),
  );
  return missing.length > 0 ? missing.slice(0, 5) : [RESTATEMENT_FALLBACK_MISSED_POINT];
}

/**
 * The mechanical pre-check itself. Pure, synchronous, no I/O.
 *
 * Always measures overlap; only returns a `grading` (and sets
 * `shortCircuited: true`) when `options.thresholdContainment` is non-null
 * and the measured `containment` meets or exceeds it. Callers are
 * responsible for skipping the model call when `shortCircuited` is true —
 * this function makes no network or model call itself, and never could
 * (there is nothing here to call).
 */
export function precheckRestatement(
  input: RestatementPrecheckInput,
  options: RestatementPrecheckOptions = DEFAULT_RESTATEMENT_PRECHECK_OPTIONS,
): RestatementPrecheckResult {
  const sourceMaterial = input.sourceExcerpt
    ? `${input.referenceAnswer}\n\n${input.sourceExcerpt}`
    : input.referenceAnswer;
  const overlap = measureAnswerSourceOverlap(
    input.studentAnswer,
    sourceMaterial,
    options.ngramSize,
  );

  // `answerTokenCount > 0` is a deliberate belt-and-braces guard, not derived
  // from the threshold: `measureAnswerSourceOverlap` already returns
  // `containment: 0` for an empty answer, but a threshold of exactly `0`
  // (nobody should ship that, yet nothing here should assume they won't)
  // would otherwise satisfy `0 >= 0` and short-circuit a blank answer with a
  // "restates the source" message — wrong on its face, and a second,
  // needless way to fail E2a's `blank` trap. The model already handles
  // blank correctly (E2a's gate is green on it today); this pre-check has
  // no reason to intercept it at any threshold.
  const triggered =
    options.thresholdContainment !== null &&
    overlap.answerTokenCount > 0 &&
    overlap.containment >= options.thresholdContainment;

  if (!triggered) {
    return { shortCircuited: false, overlap, grading: null };
  }

  return {
    shortCircuited: true,
    overlap,
    grading: {
      verdict: 'incorrect',
      feedback: RESTATEMENT_FEEDBACK,
      missedPoints: mechanicalMissedPoints(sourceMaterial, input.studentAnswer),
    },
  };
}

/**
 * Wires the pre-check in front of a model call so "zero model calls when
 * short-circuited" is a structural property of the call graph, not a
 * convention callers have to remember. `callModel` is never invoked when
 * `precheckRestatement` short-circuits — see `restatementOverlap.spec.ts`
 * for a test that asserts this by counting invocations.
 */
export async function gradeExplainBackWithPrecheck<TGrading>(
  input: RestatementPrecheckInput,
  options: RestatementPrecheckOptions,
  callModel: (input: RestatementPrecheckInput) => Promise<TGrading>,
): Promise<TGrading | RestatementPrecheckGrading> {
  const pre = precheckRestatement(input, options);
  if (pre.shortCircuited && pre.grading) {
    return pre.grading;
  }
  return callModel(input);
}
