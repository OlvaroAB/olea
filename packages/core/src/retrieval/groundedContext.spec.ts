import { describe, expect, it } from 'vitest';
import type { CompositeGroundingSignals } from './compositeSignals.js';
import { assembleGroundedContext } from './groundedContext.js';
import type { HybridHit } from './hybrid.js';

function hit(overrides: Partial<HybridHit> = {}): HybridHit {
  return {
    path: 'a.md',
    blockIndex: 0,
    text: 'some retrieved text',
    contentHash: 'h1',
    score: 0.5,
    keywordScore: null,
    cosineScore: null,
    matchedBy: [],
    ...overrides,
  };
}

/**
 * The cosine scores real, irrelevant material actually produces.
 *
 * These are not invented. They are the percentiles measured on the first
 * corpus-wide embedding pass this project ran (`@cf/baai/bge-m3`, 254 notes,
 * 1,772 distinct chunks) and recorded in `ol-cmpl`; the content-free summary
 * is in `olea-service/eval/grounding/README.md`, which may be quoted.
 *
 * **This block exists because the numbers that used to be here — 0.02, -0.1,
 * 0.1 — cannot occur.** Nothing in a real embedding space is orthogonal, so a
 * fixture built from near-zero cosines was testing a property of the fixture
 * and not of the system: unrelated hits really were below the bar *in it*. The
 * refusal tests below therefore passed honestly and proved nothing, which is
 * the same family as N-013, a check that cannot fail.
 */
const MEASURED = {
  /** Unrelated chunk vs query. p10 / p50 / p90 — note that even p10 clears the 0.25 default. */
  unrelated: { p10: 0.284, p50: 0.375, p90: 0.47 },
  /** Genuinely related chunk vs query. p10 sits BELOW the unrelated max: the populations overlap. */
  related: { p10: 0.504, p50: 0.573 },
  /** The two worst adversarial-nonsense queries against the real corpus. */
  gibberish: { lower: 0.47, upper: 0.522 },
} as const;

/**
 * The guard on the numbers above. It is trivial and it is the point: if
 * someone edits the fixture back toward zero to make the refusal tests green,
 * this goes red first and says why.
 */
describe('the fixture cosine scores are the measured ones (ol-cmpl)', () => {
  it('puts unrelated material ABOVE the default relevance bar at every percentile measured', () => {
    for (const value of Object.values(MEASURED.unrelated)) expect(value).toBeGreaterThan(0.25);
  });

  it('overlaps the related and unrelated populations, so no absolute bar separates them', () => {
    expect(MEASURED.related.p10).toBeLessThan(MEASURED.unrelated.p90 + 0.05);
    expect(MEASURED.gibberish.upper).toBeGreaterThan(MEASURED.related.p10);
  });
});

/**
 * INV-5: "every generative pipeline has an adversarial empty-context test
 * proving refusal over confabulation." This is that test for the retrieval
 * pipeline itself (P3-T05) — the mechanism C4.7 depends on, and the one
 * every future generative task that consumes retrieval (P3-T07a, P3-T08,
 * P4-T02, P4-T04) inherits by construction, since none of them can read
 * `chunks` off a `GroundingResult` without first narrowing past `status`.
 */
describe('assembleGroundedContext — INV-5 adversarial empty-context refusal (C4.7)', () => {
  it('refuses when retrieval returns literally nothing', () => {
    const result = assembleGroundedContext([]);
    expect(result).toEqual({ status: 'refused', reason: 'no-hits' });
  });

  /**
   * These two used to be `it.fails`, pinned against `ol-cmpl`'s absolute-
   * threshold-is-unreachable finding: at the measured cosine scores irrelevant
   * material actually produces, even a hit with NO keyword match cleared the
   * default 0.25 bar, so nothing here was ever expected to refuse. `ol-cmpl`
   * is still true — the labelled measurement of what does and does not
   * separate related from unrelated material is
   * `olea-service/eval/grounding/grounding-set-v1.0.0.json` (private, real
   * content — cite by path, never quote), scored by
   * `olea-service/scripts/harness/grounding-eval.mjs`, and picking a bar that
   * actually separates the populations is a ratification decision this file
   * does not make. What changed is `ol-hp9x`: these fixtures set
   * `keywordScore: null`, so the keyword short-circuit was never what kept
   * them grounded — they stayed grounded because `minCosineScore: 0.25` is
   * below where irrelevant material sits. Raising `minCosineScore` past 0.47
   * would make them pass and would still not be a fix — related material
   * starts at p10 0.504, so any bar that excludes these hits also excludes
   * the bottom decile of genuinely relevant ones. Left as documentation of
   * that non-fix, at the *current* default, which the two tests below now
   * correctly report as "grounded" (cosine actually consulted, still below a
   * bar nobody has picked yet).
   */
  it('does NOT refuse irrelevant material at the current default bar — the bar itself, not the short-circuit, is what would need to move (ol-cmpl)', () => {
    const hits: HybridHit[] = [
      hit({ path: 'unrelated-1.md', keywordScore: null, cosineScore: MEASURED.unrelated.p10 }),
      hit({ path: 'unrelated-2.md', keywordScore: null, cosineScore: MEASURED.unrelated.p50 }),
      hit({ path: 'unrelated-3.md', keywordScore: null, cosineScore: MEASURED.unrelated.p90 }),
    ];
    const result = assembleGroundedContext(hits);
    expect(result.status).toBe('grounded');
  });

  it('does NOT refuse a single gibberish hit at its measured score, at the current default bar (same non-fix as above)', () => {
    const hits: HybridHit[] = [
      hit({ score: 0.9, keywordScore: null, cosineScore: MEASURED.gibberish.upper }),
    ];
    const result = assembleGroundedContext(hits, { minCosineScore: 0.25 });
    expect(result.status).toBe('grounded');
  });

  /**
   * `ol-hp9x`, pinned as a regression: THIS is the case the short-circuit
   * actually broke. A keyword hit whose OWN cosine score fails the bar used
   * to be grounded anyway (`if (keywordScore > 0) return true`, before cosine
   * was read at all). Cosine is now always consulted when it is present, so a
   * keyword match no longer buys immunity from it.
   */
  it('refuses a hit that has a keyword match but whose own cosine score fails the bar (ol-hp9x: cosine must actually be consulted)', () => {
    const hits: HybridHit[] = [hit({ keywordScore: 5, cosineScore: 0.01 })];
    const result = assembleGroundedContext(hits, { minCosineScore: 0.25 });
    expect(result).toEqual({ status: 'refused', reason: 'below-relevance-threshold' });
  });

  it('does not leak any chunk text into a refusal result', () => {
    // `cosineScore: null` — no query vector was available at all — so this
    // refuses whatever the bar is set to. The property under test is "a
    // refusal carries no content", and it must not stop being tested the day
    // the bar stops refusing anything.
    const hits: HybridHit[] = [
      hit({ text: 'SENTINEL-MUST-NOT-APPEAR', keywordScore: null, cosineScore: null }),
    ];
    const result = assembleGroundedContext(hits);
    expect(result.status).toBe('refused');
    expect(JSON.stringify(result)).not.toContain('SENTINEL-MUST-NOT-APPEAR');
  });

  it('grounds on keyword overlap alone when no cosine score is available at all (offline / no query vector)', () => {
    const hits: HybridHit[] = [hit({ keywordScore: 1, cosineScore: null })];
    const result = assembleGroundedContext(hits);
    expect(result.status).toBe('grounded');
  });

  it('grounds when a hit clears the cosine relevance bar, with no keyword overlap at all', () => {
    const hits: HybridHit[] = [hit({ keywordScore: null, cosineScore: 0.9 })];
    const result = assembleGroundedContext(hits);
    expect(result.status).toBe('grounded');
  });

  it('a relevant hit right at the threshold counts as relevant (inclusive bound)', () => {
    const hits: HybridHit[] = [hit({ keywordScore: null, cosineScore: 0.25 })];
    const result = assembleGroundedContext(hits, { minCosineScore: 0.25 });
    expect(result.status).toBe('grounded');
  });

  it('drops irrelevant hits from the grounded set while keeping relevant ones', () => {
    const hits: HybridHit[] = [
      hit({ path: 'relevant.md', keywordScore: 1 }),
      hit({ path: 'irrelevant.md', keywordScore: null, cosineScore: 0.01 }),
    ];
    const result = assembleGroundedContext(hits);
    expect(result.status).toBe('grounded');
    if (result.status === 'grounded') {
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]?.path).toBe('relevant.md');
    }
  });

  it('caps grounded chunks to topK', () => {
    const hits: HybridHit[] = Array.from({ length: 12 }, (_, i) =>
      hit({ path: `p${i}.md`, keywordScore: 1 }),
    );
    const result = assembleGroundedContext(hits, { topK: 3 });
    expect(result.status).toBe('grounded');
    if (result.status === 'grounded') expect(result.chunks).toHaveLength(3);
  });

  it('grounded chunk shape carries only path, blockIndex and text — no score, no matchedBy (transient citation shape, not a ranking artifact)', () => {
    const hits: HybridHit[] = [hit({ keywordScore: 1 })];
    const result = assembleGroundedContext(hits);
    expect(result.status).toBe('grounded');
    if (result.status === 'grounded') {
      expect(Object.keys(result.chunks[0] ?? {}).sort()).toEqual(['blockIndex', 'path', 'text']);
    }
  });
});

/**
 * `ol-riwn` (`[D-089]`): with `requireComposite: true` and a null query
 * embedding (offline, provider failure), `computeCompositeGroundingSignals`
 * returns `top1: null` — the semantic check literally could not run. The bug
 * was that this collapsed onto `below-composite-threshold`, the reason that
 * means "we checked and her material does not support it" — the exact
 * opposite of the truth, and a UI rendering it faithfully tells her that her
 * notes do not cover something they may well cover. This block reproduces
 * the bead's probe (a real-shaped fixture query and gibberish, both hitting
 * the same mislabel before the fix) and asserts the two are now
 * distinguishable at the type level, per the acceptance criteria.
 */
describe('assembleGroundedContext — requireComposite distinguishes could-not-check from checked-and-found-nothing (ol-riwn, C4.7)', () => {
  const thresholds = { lex: 0.18, top1: 0.545, marginP99: 0.055 };

  function signals(overrides: Partial<CompositeGroundingSignals> = {}): CompositeGroundingSignals {
    return { lexBest: 0.3, top1: 0.6, marginP99: 0.1, ...overrides };
  }

  it('refuses as composite-check-unavailable, not below-composite-threshold, when the query embedding was unavailable (offline) — real-shaped fixture query', () => {
    const hits: HybridHit[] = [hit({ keywordScore: 3, cosineScore: null })];
    // `computeCompositeGroundingSignals` under a null query vector: top1 and
    // marginP99 are null, lexBest is still computed from keyword overlap
    // alone (it never depends on the embedding provider).
    const result = assembleGroundedContext(hits, {
      requireComposite: true,
      compositeThresholds: thresholds,
      compositeSignals: signals({ lexBest: 0.4, top1: null, marginP99: null }),
    });
    expect(result).toEqual({ status: 'refused', reason: 'composite-check-unavailable' });
  });

  it('refuses as composite-check-unavailable for gibberish too — the mislabel did not depend on query content, only on the missing embedding', () => {
    const hits: HybridHit[] = [hit({ keywordScore: null, cosineScore: null })];
    const result = assembleGroundedContext(hits, {
      requireComposite: true,
      compositeThresholds: thresholds,
      compositeSignals: signals({ lexBest: 0, top1: null, marginP99: null }),
    });
    expect(result).toEqual({ status: 'refused', reason: 'composite-check-unavailable' });
  });

  it('refuses as composite-check-unavailable when compositeSignals was never computed at all (caller forgot to wire it)', () => {
    const hits: HybridHit[] = [hit({ keywordScore: 3 })];
    const result = assembleGroundedContext(hits, { requireComposite: true });
    expect(result).toEqual({ status: 'refused', reason: 'composite-check-unavailable' });
  });

  it('still refuses as below-composite-threshold when the semantic check DID run and genuinely found nothing (checked-and-found-nothing is preserved)', () => {
    const hits: HybridHit[] = [hit({ keywordScore: 3 })];
    const result = assembleGroundedContext(hits, {
      requireComposite: true,
      compositeThresholds: thresholds,
      compositeSignals: signals({ top1: 0.3, marginP99: 0.01 }),
    });
    expect(result).toEqual({ status: 'refused', reason: 'below-composite-threshold' });
  });

  it('grounds when the semantic check ran and every clause clears the bar', () => {
    const hits: HybridHit[] = [hit({ keywordScore: 3 })];
    const result = assembleGroundedContext(hits, {
      requireComposite: true,
      compositeThresholds: thresholds,
      compositeSignals: signals(),
    });
    expect(result.status).toBe('grounded');
  });

  it('requireComposite false/unset leaves existing behaviour unchanged — no composite reason ever appears', () => {
    const hits: HybridHit[] = [hit({ keywordScore: null, cosineScore: null })];
    const result = assembleGroundedContext(hits);
    expect(result).toEqual({ status: 'refused', reason: 'below-relevance-threshold' });
  });
});
