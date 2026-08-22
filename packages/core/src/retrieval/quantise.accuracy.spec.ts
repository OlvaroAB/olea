/**
 * The measured accuracy cost of int8 quantisation (`ol-l1qz`).
 *
 * David's ruling on `ol-l1qz` allows quantisation *if it is measured* — so
 * this file is a measurement first and a regression guard second. It runs the
 * real `quantiseVector` and the real `cosineSimilarity` over a synthetic
 * corpus and reports, rather than asserts from received wisdom, what
 * quantising costs the ranking retrieval actually consumes.
 *
 * **Why synthetic, and what that does and does not buy.** INV-3 forbids real
 * vault content or real eval data in this repo, so a corpus of her actual
 * embeddings cannot live here. What can live here is a corpus whose
 * *statistics* are the ones quantisation error depends on, swept across the
 * range real corpora fall in. Scalar quantisation error is a function of
 * exactly two things: the shape of the component distribution (how much of
 * the int8 range a typical component uses once the scale is set by the
 * largest one) and the tightness of the score gaps between neighbouring
 * candidates (how little error it takes to swap two ranks). Both are
 * parameters here, and both are swept — including a profile deliberately
 * nastier than any real transformer embedding.
 *
 * The three profiles:
 *
 *   - `isotropic` — components i.i.d. gaussian, L2-normalised. The easy case,
 *     and the textbook one.
 *   - `clustered` — a mixture of 60 centroids with tight within-cluster
 *     noise, so a query's 50th-best neighbour is genuinely close to its best
 *     one. This is the case that actually decides recall: when every gap is
 *     large, no quantiser can lose a rank.
 *   - `rogue-dims` — `clustered`, plus 8 dimensions carrying ~7x the typical
 *     magnitude. This models the "rogue dimension" effect real transformer
 *     encoders show, and it is the specific thing that hurts max-scaling
 *     symmetric quantisation: the outlier sets the scale, so every ordinary
 *     component is squeezed into a fraction of the code range. If int8
 *     survives this profile it survives bge-m3.
 *
 * **What is measured.** Agreement with the full-precision ranking at the
 * three k values that matter downstream: k=50 (`hybrid.ts`'s
 * `SEMANTIC_CANDIDATE_POOL`, what enters RRF fusion at all), k=8
 * (`groundedContext.ts`'s `DEFAULT_TOP_K`, what actually reaches a prompt),
 * and k=1. Plus the absolute cosine error, because `groundedContext.ts`
 * compares a raw cosine against an absolute bar (`DEFAULT_MIN_COSINE_SCORE`,
 * 0.25) to decide grounded-vs-refused, and an absolute threshold is the one
 * consumer for which a scale-invariant ranking argument is not enough. That
 * boundary gets its own dedicated stress measurement below.
 */

import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from './cosine.js';
import { encodeQuantisedVector, quantiseVector } from './quantise.js';

const DIM = 1024;
const CORPUS = 2000;
const QUERIES = 40;

/** `hybrid.ts`'s `SEMANTIC_CANDIDATE_POOL` — what survives into fusion. */
const POOL_K = 50;
/** `groundedContext.ts`'s `DEFAULT_TOP_K` — what actually reaches a prompt. */
const GROUNDED_K = 8;
/** `groundedContext.ts`'s `DEFAULT_MIN_COSINE_SCORE` — the grounded/refused bar. */
const RELEVANCE_BAR = 0.25;

// ---------------------------------------------------------------------------
// Deterministic corpus generation. Seeded so a reported number is reproducible
// exactly, not "about that".
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function normalise(vector: Float64Array): Float64Array {
  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) return vector;
  for (let i = 0; i < vector.length; i++) vector[i] = (vector[i] ?? 0) / magnitude;
  return vector;
}

type Profile = 'isotropic' | 'clustered' | 'rogue-dims';

const CLUSTERS = 60;
/** How much of a clustered vector is its centroid. Higher = tighter clusters = tighter score gaps = harder for the quantiser. */
const CLUSTER_WEIGHT = 0.72;
const ROGUE_DIM_COUNT = 8;
const ROGUE_DIM_GAIN = 7;

interface Corpus {
  readonly floats: readonly Float64Array[];
  readonly codes: readonly Int8Array[];
  readonly queries: readonly Float64Array[];
}

function buildCorpus(profile: Profile, seed: number): Corpus {
  const random = mulberry32(seed);

  const rogueDims = new Set<number>();
  if (profile === 'rogue-dims') {
    for (let i = 0; i < ROGUE_DIM_COUNT; i++) {
      rogueDims.add(Math.floor(random() * DIM));
    }
  }

  const gains = new Float64Array(DIM).fill(1);
  for (const dim of rogueDims) gains[dim] = ROGUE_DIM_GAIN;

  const centroids: Float64Array[] = [];
  for (let c = 0; c < CLUSTERS; c++) {
    const centroid = new Float64Array(DIM);
    for (let d = 0; d < DIM; d++) centroid[d] = gaussian(random);
    centroids.push(normalise(centroid));
  }

  const draw = (): Float64Array => {
    const vector = new Float64Array(DIM);
    if (profile === 'isotropic') {
      for (let d = 0; d < DIM; d++) vector[d] = gaussian(random);
    } else {
      const centroid = centroids[Math.floor(random() * CLUSTERS)] ?? centroids[0];
      for (let d = 0; d < DIM; d++) {
        const base = centroid?.[d] ?? 0;
        vector[d] = CLUSTER_WEIGHT * base + (1 - CLUSTER_WEIGHT) * gaussian(random) * 0.05;
      }
    }
    // Rogue dimensions are applied after the direction is drawn: they are a
    // property of the encoder, shared by every vector it produces, not noise.
    for (let d = 0; d < DIM; d++) vector[d] = (vector[d] ?? 0) * (gains[d] ?? 1);
    return normalise(vector);
  };

  const floats: Float64Array[] = [];
  const codes: Int8Array[] = [];
  for (let i = 0; i < CORPUS; i++) {
    const vector = draw();
    floats.push(vector);
    codes.push(quantiseVector(vector));
  }

  const queries: Float64Array[] = [];
  for (let i = 0; i < QUERIES; i++) queries.push(draw());

  return { floats, codes, queries };
}

// ---------------------------------------------------------------------------
// Metrics.
// ---------------------------------------------------------------------------

/** Indices of the top `k` scorers, highest first — the same ordering rule `topKByCosine` uses, minus the tie-break, which cannot apply here because indices are unique. */
function topK(scores: readonly number[], k: number): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, k)
    .map((entry) => entry.index);
}

interface ProfileResult {
  readonly profile: Profile;
  readonly recallAtPool: number;
  readonly recallAtGrounded: number;
  readonly recallAt1: number;
  /**
   * The metric that separates a harmful miss from a harmless one, and the
   * reason recall alone is not enough here. In a clustered corpus the top
   * candidates are near-identical, so swapping ranks 1 and 2 costs recall@1 a
   * full point while costing the *answer* essentially nothing. This is the
   * true (full-precision) cosine the quantised ranking gave up: best exact
   * score minus the exact score of whatever the quantised ranking actually
   * put first. Zero means the quantiser picked the genuinely best chunk.
   */
  readonly top1ScoreLoss: number;
  /** The same idea over the whole grounded set: mean exact cosine of the quantised top-8 against mean exact cosine of the exact top-8. */
  readonly groundedScoreLoss: number;
  readonly meanAbsError: number;
  readonly maxAbsError: number;
  readonly p999AbsError: number;
}

function measure(profile: Profile, seed: number): ProfileResult {
  const { floats, codes, queries } = buildCorpus(profile, seed);

  let poolHits = 0;
  let groundedHits = 0;
  let topOneHits = 0;
  let top1LossSum = 0;
  let groundedLossSum = 0;
  let errorSum = 0;
  let errorCount = 0;
  let maxError = 0;
  const errors: number[] = [];

  for (const query of queries) {
    const floatScores: number[] = [];
    const codeScores: number[] = [];
    for (let i = 0; i < CORPUS; i++) {
      const exact = cosineSimilarity(query, floats[i] ?? new Float64Array(0));
      const approx = cosineSimilarity(query, codes[i] ?? new Int8Array(0));
      floatScores.push(exact);
      codeScores.push(approx);

      const error = Math.abs(exact - approx);
      errorSum += error;
      errorCount += 1;
      if (error > maxError) maxError = error;
      errors.push(error);
    }

    const exactPool = new Set(topK(floatScores, POOL_K));
    const approxPool = topK(codeScores, POOL_K);
    poolHits += approxPool.filter((index) => exactPool.has(index)).length;

    const exactGroundedRanking = topK(floatScores, GROUNDED_K);
    const exactGrounded = new Set(exactGroundedRanking);
    const approxGrounded = topK(codeScores, GROUNDED_K);
    groundedHits += approxGrounded.filter((index) => exactGrounded.has(index)).length;

    const exactBest = topK(floatScores, 1)[0];
    const approxBest = topK(codeScores, 1)[0];
    if (exactBest === approxBest) topOneHits += 1;
    top1LossSum += (floatScores[exactBest ?? 0] ?? 0) - (floatScores[approxBest ?? 0] ?? 0);

    const exactGroundedMean =
      exactGroundedRanking.reduce((sum, i) => sum + (floatScores[i] ?? 0), 0) / GROUNDED_K;
    const approxGroundedMean =
      approxGrounded.reduce((sum, i) => sum + (floatScores[i] ?? 0), 0) / GROUNDED_K;
    groundedLossSum += exactGroundedMean - approxGroundedMean;
  }

  errors.sort((a, b) => a - b);
  const p999 = errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.999))] ?? 0;

  return {
    profile,
    recallAtPool: poolHits / (QUERIES * POOL_K),
    recallAtGrounded: groundedHits / (QUERIES * GROUNDED_K),
    recallAt1: topOneHits / QUERIES,
    top1ScoreLoss: top1LossSum / QUERIES,
    groundedScoreLoss: groundedLossSum / QUERIES,
    meanAbsError: errorSum / errorCount,
    maxAbsError: maxError,
    p999AbsError: p999,
  };
}

// ---------------------------------------------------------------------------
// The measurement.
// ---------------------------------------------------------------------------

describe('int8 quantisation: measured ranking cost (ol-l1qz)', () => {
  const profiles: readonly Profile[] = ['isotropic', 'clustered', 'rogue-dims'];

  for (const [index, profile] of profiles.entries()) {
    it(`preserves the full-precision ranking on the "${profile}" profile`, () => {
      const result = measure(profile, 20260814 + index);

      // Reported, not just asserted — these numbers are the evidence behind
      // the decision record, and a future change to the quantiser should
      // show up here as a moved number rather than a silent regression.
      console.log(
        [
          `[ol-l1qz] profile=${profile} dim=${DIM} corpus=${CORPUS} queries=${QUERIES}`,
          `  recall@${POOL_K} (fusion pool)   = ${(result.recallAtPool * 100).toFixed(3)}%`,
          `  recall@${GROUNDED_K}  (grounded ctx)   = ${(result.recallAtGrounded * 100).toFixed(3)}%`,
          `  recall@1   (best hit)      = ${(result.recallAt1 * 100).toFixed(3)}%`,
          `  true cosine given up @1    = ${result.top1ScoreLoss.toExponential(3)}`,
          `  true cosine given up @${GROUNDED_K}    = ${result.groundedScoreLoss.toExponential(3)}`,
          `  cosine error  mean         = ${result.meanAbsError.toExponential(3)}`,
          `  cosine error  p99.9        = ${result.p999AbsError.toExponential(3)}`,
          `  cosine error  max          = ${result.maxAbsError.toExponential(3)}`,
        ].join('\n'),
      );

      // Bars set from the observed numbers with real headroom, so this fails
      // on a regression rather than on noise.
      expect(result.recallAtPool).toBeGreaterThan(0.99);
      expect(result.recallAtGrounded).toBeGreaterThan(0.98);
      expect(result.recallAt1).toBeGreaterThan(0.9);
      expect(result.meanAbsError).toBeLessThan(0.01);
      expect(result.maxAbsError).toBeLessThan(0.02);

      // The bar that actually matters, and the reason the recall bars above
      // are allowed to be as loose as they are: whatever ranks the quantiser
      // swapped, it gave up essentially none of the true relevance it was
      // ranking by. A rank swap between two chunks whose exact cosines differ
      // in the fourth decimal is a tie-break, not a wrong answer.
      expect(result.top1ScoreLoss).toBeLessThan(0.005);
      expect(result.groundedScoreLoss).toBeLessThan(0.005);
    });
  }
});

describe('int8 quantisation at the grounded/refused boundary (C4.7, INV-5)', () => {
  /**
   * The one consumer that reads an *absolute* cosine rather than a rank:
   * `assembleGroundedContext` grounds a hit whose cosine clears 0.25 and
   * refuses otherwise. Every ranking argument made above is scale-invariant
   * and says nothing whatsoever about an absolute bar, so the bar gets its own
   * measurement: chunks are constructed at a known true cosine on either side
   * of it, and the question asked is how far a chunk has to sit from the bar
   * before quantisation can no longer move it across.
   *
   * A flip for a chunk sitting *exactly* on the bar is not a finding — that is
   * a coin toss by construction, and the ~50% observed at delta=0 is the
   * correct and uninformative answer. The finding is the width of the band in
   * which flips are possible at all. If that band is narrower than the
   * precision anyone could claim for 0.25 — which `groundedContext.ts`
   * documents as a conservative heuristic, explicitly awaiting real retrieval
   * data (cost model §6, question 3) — then quantisation has not moved a
   * single refusal decision that anyone was in a position to predict.
   */
  it('can only move the grounded/refused decision inside a band far narrower than the bar is known to', () => {
    const random = mulberry32(20260815);
    const samples = 200;
    const deltas = [-0.005, -0.001, 0, 0.001, 0.005] as const;

    let maxShift = 0;
    let shiftSum = 0;
    let shiftCount = 0;
    const flipsByDelta = new Map<number, number>(deltas.map((delta) => [delta, 0]));

    for (let s = 0; s < samples; s++) {
      const query = normalise(Float64Array.from({ length: DIM }, () => gaussian(random)));

      // A direction orthogonal to the query, so a target's true cosine is set
      // by construction rather than by luck.
      const orthogonal = Float64Array.from({ length: DIM }, () => gaussian(random));
      let projection = 0;
      for (let d = 0; d < DIM; d++) projection += (orthogonal[d] ?? 0) * (query[d] ?? 0);
      for (let d = 0; d < DIM; d++) {
        orthogonal[d] = (orthogonal[d] ?? 0) - projection * (query[d] ?? 0);
      }
      normalise(orthogonal);

      for (const delta of deltas) {
        const trueCosine = RELEVANCE_BAR + delta;
        const perpendicular = Math.sqrt(1 - trueCosine * trueCosine);
        const target = new Float64Array(DIM);
        for (let d = 0; d < DIM; d++) {
          target[d] = trueCosine * (query[d] ?? 0) + perpendicular * (orthogonal[d] ?? 0);
        }

        const exact = cosineSimilarity(query, target);
        const approx = cosineSimilarity(query, quantiseVector(target));
        const shift = Math.abs(exact - approx);
        shiftSum += shift;
        shiftCount += 1;
        if (shift > maxShift) maxShift = shift;
        if (exact >= RELEVANCE_BAR !== approx >= RELEVANCE_BAR) {
          flipsByDelta.set(delta, (flipsByDelta.get(delta) ?? 0) + 1);
        }
      }
    }

    console.log(
      [
        `[ol-l1qz] relevance-bar stress: bar=${RELEVANCE_BAR} samples=${samples}/delta dim=${DIM}`,
        `  mean |shift| = ${(shiftSum / shiftCount).toExponential(3)}`,
        `  max  |shift| = ${maxShift.toExponential(3)}`,
        ...deltas.map(
          (delta) =>
            `  ground/refuse flips at true cosine ${(RELEVANCE_BAR + delta).toFixed(3)} (delta ${delta >= 0 ? '+' : ''}${delta}) = ${flipsByDelta.get(delta) ?? 0}/${samples}`,
        ),
      ].join('\n'),
    );

    // The band: a chunk 0.001 or further from the bar is never moved across
    // it, and the worst single shift observed is under a thousandth.
    expect(maxShift).toBeLessThan(0.001);
    expect(shiftSum / shiftCount).toBeLessThan(0.0005);
    for (const delta of deltas) {
      if (delta === 0) continue;
      expect(flipsByDelta.get(delta), `delta ${delta}`).toBe(0);
    }
  });
});

describe('the footprint the ruling was about (ol-l1qz, F2.13)', () => {
  /**
   * The 19.5 KB baseline reproduced in-repo rather than cited, so the
   * comparison is arithmetic anyone can re-run instead of two numbers from
   * two different measurements.
   */
  it('reproduces the version-1 per-vector cost and states the version-2 cost against it', () => {
    const random = mulberry32(1);
    const vector = normalise(Float64Array.from({ length: DIM }, () => gaussian(random)));
    const contentHash = 'a'.repeat(64); // hex SHA-256, `ingestion/hash.ts`

    const v1Entry = JSON.stringify({ contentHash, vector: [...vector] });
    const v2Entry = JSON.stringify({
      contentHash,
      codes: encodeQuantisedVector(quantiseVector(vector)),
    });

    const v1PerVector = v1Entry.length + 1; // + the comma joining it to the next entry
    const v2PerVector = v2Entry.length + 1;
    const scale = 8000; // C2.3's stated working scale

    console.log(
      [
        `[ol-l1qz] persisted footprint, dim=${DIM}, one entry as JSON:`,
        `  v1 (number array) = ${v1PerVector} B/vector -> ${((v1PerVector * scale) / 1e6).toFixed(1)} MB at ${scale} blocks`,
        `  v2 (base64 int8)  = ${v2PerVector} B/vector -> ${((v2PerVector * scale) / 1e6).toFixed(1)} MB at ${scale} blocks`,
        `  reduction         = ${(v1PerVector / v2PerVector).toFixed(1)}x`,
      ].join('\n'),
    );

    // The baseline the bead measured on a real corpus (~19.5 KB/vector),
    // reproduced here to within the width of the band. Synthetic doubles
    // serialise a character or two longer than the provider's, so this comes
    // out slightly *above* the real figure — which makes every ratio quoted
    // off the real baseline the conservative one.
    expect(v1PerVector).toBeGreaterThan(18_000);
    expect(v1PerVector).toBeLessThan(23_000);

    // The commitment: comfortably under 1.5 KB per vector, so under 12 MB at
    // C2.3's 8,000-block scale.
    expect(v2PerVector).toBeLessThan(1500);
    expect((v2PerVector * scale) / 1e6).toBeLessThan(12);
  });
});
