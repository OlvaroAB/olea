import { describe, expect, it } from 'vitest';
import {
  type CompositeGroundingSignals,
  RECOMMENDED_COMPOSITE_THRESHOLDS,
} from './compositeSignals.js';
import { cosinePercentile } from './cosine.js';
import {
  assembleBandedGroundedContext,
  assembleGroundedContext,
  classifyGroundingBand,
  type GroundingJudgePort,
  type GroundingJudgeRequest,
  type GroundingJudgeVerdict,
  resolveGroundedContext,
} from './groundedContext.js';
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

// -----------------------------------------------------------------------------------------------
// `[D-089]` — the two-threshold band
//
// Scenarios: features/C2-index.md, "C4.7 / `[D-089]` — The refusal posture is a two-threshold
// band", plus the band additions to that file's C4.7 / INV-5 block.
// -----------------------------------------------------------------------------------------------

/**
 * Where the two bars sit in the MEASURED signal space, stated as aggregates
 * only (`olea-service/.olea-harness/band-curve/final/band-curve.json`; the
 * derivation is private, the numbers travel).
 *
 * The single fact these fixtures are built to respect: the highest `top1` any
 * unanswerable query reached sits ABOVE the lowest `top1` any answerable query
 * reached. The populations overlap — that is `ol-cmpl`'s finding and it is why
 * the band exists at all — so a fixture must place its three tiers around that
 * overlap rather than in three tidy, separated regions.
 */
const BAND = { lower: 0.545, upper: 0.715 } as const;

const ABOVE_BAND_TOP1 = 0.78;
const IN_BAND_TOP1 = 0.63;
const BELOW_BAND_TOP1 = 0.48;

function bandSignals(top1: number, lexBest = 0.4): CompositeGroundingSignals {
  return { lexBest, top1, marginP99: 0.12 };
}

/** A judge that records every call, so "nothing was sent" is counted rather than inferred. */
function countingJudge(supported: boolean) {
  const calls: GroundingJudgeRequest[] = [];
  return {
    calls,
    port: {
      judge: async (request: GroundingJudgeRequest): Promise<GroundingJudgeVerdict> => {
        calls.push(request);
        return { supported, reason: 'because' };
      },
    } satisfies GroundingJudgePort,
  };
}

const bandHits: HybridHit[] = [
  hit({ path: 'a.md', blockIndex: 0, contentHash: 'h1', cosineScore: 0.61, keywordScore: 2 }),
  hit({ path: 'b.md', blockIndex: 3, contentHash: 'h2', cosineScore: 0.44, keywordScore: 1 }),
];

describe('[D-089] the band classifies from the cheap signals alone', () => {
  it('puts a query above the upper bar in the above-band tier', () => {
    expect(classifyGroundingBand(bandSignals(ABOVE_BAND_TOP1), BAND)).toBe('above-band');
  });

  it('puts a query between the bars in the band', () => {
    expect(classifyGroundingBand(bandSignals(IN_BAND_TOP1), BAND)).toBe('in-band');
  });

  it('puts a query below the lower bar in the below-band tier', () => {
    expect(classifyGroundingBand(bandSignals(BELOW_BAND_TOP1), BAND)).toBe('below-band');
  });

  it('refuses to classify at all when the semantic signal never ran', () => {
    expect(classifyGroundingBand({ lexBest: 0.4, top1: null, marginP99: null }, BAND)).toBeNull();
  });

  /**
   * `ol-3h2f`. The bars are on `top1` and NOTHING ELSE, so a corpus small
   * enough to make `marginP99` degenerate cannot move a tier. Below, the same
   * `top1` is classified with `marginP99` at its small-corpus value (exactly
   * zero) and at its full-corpus value; the tier is identical.
   */
  it('does not consult marginP99, so a small corpus cannot move a tier (ol-3h2f)', () => {
    for (const top1 of [ABOVE_BAND_TOP1, IN_BAND_TOP1, BELOW_BAND_TOP1]) {
      const smallCorpus: CompositeGroundingSignals = { lexBest: 0.4, top1, marginP99: 0 };
      const fullCorpus: CompositeGroundingSignals = { lexBest: 0.4, top1, marginP99: 0.1633 };
      expect(classifyGroundingBand(smallCorpus, BAND)).toBe(
        classifyGroundingBand(fullCorpus, BAND),
      );
    }
  });

  /**
   * `ol-3h2f`'s own N-013 note, pinned where the argument for the band lives.
   * `cosinePercentile` floor-indexes, so for p = 0.99 and any n <= 100 the
   * "99th percentile" IS the maximum and `marginP99` is exactly zero. This is
   * arithmetic, not a measurement — and it is the whole reason the band is not
   * placed on that statistic.
   */
  it('pins WHY marginP99 was unusable as a bar: it is exactly 0 for n <= 100 (ol-3h2f)', () => {
    for (const n of [1, 10, 50, 99, 100]) {
      const ascending = Array.from({ length: n }, (_, i) => i / n);
      const top1 = ascending[n - 1] as number;
      expect(top1 - cosinePercentile(ascending, 0.99)).toBe(0);
    }
    // And that it stops being identically zero the moment n clears 100 — the
    // degeneration is a gradient, not a cliff, so neither half may be assumed.
    const n = 101;
    const ascending = Array.from({ length: n }, (_, i) => i / n);
    expect((ascending[n - 1] as number) - cosinePercentile(ascending, 0.99)).toBeGreaterThan(0);
  });

  it('the optional lexical floor can only demote INTO the band, never below it', () => {
    const thin = bandSignals(ABOVE_BAND_TOP1, 0.05);
    expect(classifyGroundingBand(thin, { ...BAND, lex: 0.4 })).toBe('in-band');
    const belowAndThin = bandSignals(BELOW_BAND_TOP1, 0.05);
    expect(classifyGroundingBand(belowAndThin, { ...BAND, lex: 0.4 })).toBe('below-band');
  });
});

describe('[D-089] above the upper bar, generation proceeds from the cheap signals alone', () => {
  it('grounds and consults no judge', async () => {
    const judge = countingJudge(false);
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judge: judge.port,
      compositeSignals: bandSignals(ABOVE_BAND_TOP1),
    });
    expect(result.status).toBe('grounded');
    expect(judge.calls).toHaveLength(0);
  });
});

describe('[D-089] below the lower bar, the refusal is decided from numbers alone', () => {
  it('refuses with the below-band reason and consults no judge', async () => {
    const judge = countingJudge(true);
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judge: judge.port,
      compositeSignals: bandSignals(BELOW_BAND_TOP1),
    });
    expect(result).toMatchObject({ status: 'refused', reason: 'below-band' });
    expect(judge.calls).toHaveLength(0);
  });

  /**
   * The per-tier network promise, counted rather than inferred. A refusal that
   * phoned home first renders identically to one that did not, from every
   * screen anyone would look at, which is exactly why this is asserted on the
   * call count and not on the result's shape.
   */
  it('sends nothing over the network — zero port calls, not merely an empty result', async () => {
    const judge = countingJudge(true);
    await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judge: judge.port,
      compositeSignals: bandSignals(BELOW_BAND_TOP1),
    });
    expect(judge.calls).toEqual([]);
  });

  /**
   * The structural half of the same promise: the function that produces a
   * below-band refusal is synchronous and takes no port at all, so it has no
   * means of sending anything even if a future edit wanted it to.
   */
  it('is decided by a pure, synchronous function that cannot send anything', () => {
    const decision = assembleBandedGroundedContext(bandHits, {
      band: BAND,
      compositeSignals: bandSignals(BELOW_BAND_TOP1),
    });
    expect(decision).toMatchObject({ status: 'refused', reason: 'below-band' });
  });
});

describe('[D-089] inside the band, the composite is consulted and may still refuse', () => {
  it('sends the query and the retrieved passages for judgment', async () => {
    const judge = countingJudge(true);
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'the query',
      judge: judge.port,
      compositeSignals: bandSignals(IN_BAND_TOP1),
    });
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0]?.query).toBe('the query');
    expect(judge.calls[0]?.context).toContain('some retrieved text');
    expect(result.status).toBe('grounded');
  });

  it('a judge rejection is a refusal, distinguishable from a below-band one', async () => {
    const judge = countingJudge(false);
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judge: judge.port,
      compositeSignals: bandSignals(IN_BAND_TOP1),
    });
    expect(result).toMatchObject({ status: 'refused', reason: 'judge-rejected' });
  });

  it('the composite is band-scoped: it runs for the middle set only', async () => {
    const judge = countingJudge(true);
    for (const top1 of [ABOVE_BAND_TOP1, BELOW_BAND_TOP1, IN_BAND_TOP1, ABOVE_BAND_TOP1]) {
      await resolveGroundedContext(bandHits, {
        band: BAND,
        query: 'q',
        judge: judge.port,
        compositeSignals: bandSignals(top1),
      });
    }
    expect(judge.calls).toHaveLength(1);
  });
});

describe('[D-089] hedged generation is admitted nowhere, at any tier', () => {
  it('every outcome at every tier is exactly grounded or refused', async () => {
    const judge = countingJudge(true);
    for (const top1 of [ABOVE_BAND_TOP1, IN_BAND_TOP1, BELOW_BAND_TOP1]) {
      const result = await resolveGroundedContext(bandHits, {
        band: BAND,
        query: 'q',
        judge: judge.port,
        compositeSignals: bandSignals(top1),
      });
      expect(['grounded', 'refused']).toContain(result.status);
      if (result.status === 'grounded') {
        // No confidence caveat, no "this may not be well supported" qualifier,
        // no third shape: a grounded result is chunks and nothing else.
        expect(Object.keys(result).sort()).toEqual(['chunks', 'status']);
      }
    }
  });
});

describe('[D-089] a diagnostic refusal states only what retrieval actually returned', () => {
  it('names which notes and passages were found, at what strength, and nothing more', async () => {
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      compositeSignals: bandSignals(BELOW_BAND_TOP1),
    });
    expect(result.status).toBe('refused');
    if (result.status !== 'refused') return;
    expect(result.diagnostic?.found).toEqual([
      { path: 'a.md', blockIndex: 0, strength: 0.61 },
      { path: 'b.md', blockIndex: 3, strength: 0.44 },
    ]);
  });

  it('carries no chunk text — a refusal never carries her content', async () => {
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      compositeSignals: bandSignals(BELOW_BAND_TOP1),
    });
    expect(JSON.stringify(result)).not.toContain('some retrieved text');
  });

  it('makes no claim about the vault beyond the hits — there is no field for one', async () => {
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      compositeSignals: bandSignals(BELOW_BAND_TOP1),
    });
    if (result.status !== 'refused' || !result.diagnostic) throw new Error('expected a diagnostic');
    for (const found of result.diagnostic.found) {
      expect(Object.keys(found).sort()).toEqual(['blockIndex', 'path', 'strength']);
    }
    expect(Object.keys(result.diagnostic)).toEqual(['found']);
  });
});

describe('[D-089] §5 the band path fails closed, and says why truthfully', () => {
  const insufficientNotesReasons = ['below-band', 'below-composite-threshold', 'judge-rejected'];

  it('refuses when the judge throws', async () => {
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judge: {
        judge: async () => {
          throw new Error('transport exploded');
        },
      },
      compositeSignals: bandSignals(IN_BAND_TOP1),
    });
    expect(result).toMatchObject({ status: 'refused', reason: 'judge-unavailable' });
  });

  it('refuses when the judge exceeds its time budget', async () => {
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judgeTimeoutMs: 5,
      judge: { judge: () => new Promise(() => {}) },
      compositeSignals: bandSignals(IN_BAND_TOP1),
    });
    expect(result).toMatchObject({ status: 'refused', reason: 'judge-unavailable' });
  });

  it('refuses when the judge returns something that is not a verdict', async () => {
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judge: { judge: async () => ({}) as unknown as GroundingJudgeVerdict },
      compositeSignals: bandSignals(IN_BAND_TOP1),
    });
    expect(result).toMatchObject({ status: 'refused', reason: 'judge-unavailable' });
  });

  it('refuses when a band query has no judge wired at all — absent is not "skip the check"', async () => {
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      compositeSignals: bandSignals(IN_BAND_TOP1),
    });
    expect(result).toMatchObject({ status: 'refused', reason: 'judge-unavailable' });
  });

  it('never borrows the insufficient-notes reason for a transient failure', async () => {
    for (const judge of [
      {
        judge: async () => {
          throw new Error('boom');
        },
      },
      { judge: () => new Promise<GroundingJudgeVerdict>(() => {}) },
    ]) {
      const result = await resolveGroundedContext(bandHits, {
        band: BAND,
        query: 'q',
        judgeTimeoutMs: 5,
        judge,
        compositeSignals: bandSignals(IN_BAND_TOP1),
      });
      if (result.status !== 'refused') throw new Error('expected a refusal');
      expect(insufficientNotesReasons).not.toContain(result.reason);
    }
  });

  it('fails closed one layer earlier too: no semantic signal means the check never ran', async () => {
    const judge = countingJudge(true);
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judge: judge.port,
      compositeSignals: { lexBest: 0.4, top1: null, marginP99: null },
    });
    expect(result).toMatchObject({ status: 'refused', reason: 'composite-check-unavailable' });
    expect(judge.calls).toHaveLength(0);
  });
});

describe('INV-5 — the adversarial empty-context suite runs against the band path', () => {
  it('refuses with no hits at all, and asks no judge about nothing', async () => {
    const judge = countingJudge(true);
    const result = await resolveGroundedContext([], {
      band: BAND,
      query: 'q',
      judge: judge.port,
      compositeSignals: bandSignals(ABOVE_BAND_TOP1),
    });
    expect(result).toEqual({ status: 'refused', reason: 'no-hits' });
    expect(judge.calls).toHaveLength(0);
  });

  /**
   * The case `ol-cmpl` measured and the synthetic suite could not see: hits
   * that are genuinely retrieved, score well above the old 0.25 floor, and are
   * about nothing the query asked. At the measured gibberish `top1` the band
   * puts them below the lower bar, so they refuse on numbers alone — and,
   * because that tier sends nothing, without her query ever leaving the device.
   */
  it('refuses real-embedding gibberish, which sits above the old absolute floor (ol-cmpl)', async () => {
    const judge = countingJudge(true);
    for (const top1 of [MEASURED.gibberish.lower, MEASURED.gibberish.upper]) {
      expect(top1).toBeGreaterThan(0.25);
      const result = await resolveGroundedContext(
        [hit({ cosineScore: MEASURED.unrelated.p90, keywordScore: 1 })],
        { band: BAND, query: 'q', judge: judge.port, compositeSignals: bandSignals(top1) },
      );
      expect(result).toMatchObject({ status: 'refused', reason: 'below-band' });
    }
    expect(judge.calls).toHaveLength(0);
  });

  /**
   * N-013. The band is what refuses the case above, not some other clause that
   * happened to fire: retrieve the identical input with no band and it grounds.
   */
  it('N-013: the band is load-bearing — the same input grounds without it', () => {
    const hits = [hit({ cosineScore: MEASURED.unrelated.p90, keywordScore: 1 })];
    expect(assembleGroundedContext(hits).status).toBe('grounded');
  });
});

// -----------------------------------------------------------------------------------------------
// `[D-192]` (`ol-egov.75` / `ol-0r92.39`) — the composite composes with the band as an ADDITIONAL
// lower-bar veto, checked before band classification runs, rather than the two mechanisms being
// mutually exclusive. Scenarios: features/F4-oracle.md, the composite-veto addition to C4.7 /
// `[D-089]`'s band block.
// -----------------------------------------------------------------------------------------------
describe('[D-192] the composite composes with the band as an additional lower-bar veto (ol-0r92.39)', () => {
  it('RECOMMENDED_COMPOSITE_THRESHOLDS matches the ratified operating point', () => {
    expect(RECOMMENDED_COMPOSITE_THRESHOLDS).toEqual({ lex: 0.18, top1: 0.545, marginP99: 0.055 });
  });

  it('vetoes an ABOVE-band query before band classification ever runs — a query the band alone would have GROUNDED outright', () => {
    const decision = assembleBandedGroundedContext(bandHits, {
      band: BAND,
      requireComposite: true,
      compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS,
      // top1 clears both the band's upper bar and the composite's own top1
      // sub-threshold; lexBest alone is what fails the composite here, to
      // prove the veto is independent of — and checked ahead of — the tier
      // the band's own numbers would have produced.
      compositeSignals: bandSignals(ABOVE_BAND_TOP1, 0.05),
    });
    expect(decision).toEqual({ status: 'refused', reason: 'below-composite-threshold' });
  });

  it('vetoes an IN-band query before the judge is ever consulted', async () => {
    const judge = countingJudge(true);
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judge: judge.port,
      requireComposite: true,
      compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS,
      compositeSignals: bandSignals(IN_BAND_TOP1, 0.05),
    });
    expect(result).toMatchObject({ status: 'refused', reason: 'below-composite-threshold' });
    expect(judge.calls).toHaveLength(0);
  });

  it('leaves band-only behaviour byte-identical when requireComposite is unset — the pre-[D-192] default posture', async () => {
    const judge = countingJudge(true);
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judge: judge.port,
      // requireComposite intentionally NOT set — the same signals that veto
      // above would fail the composite's lex clause if it ran.
      compositeSignals: bandSignals(ABOVE_BAND_TOP1, 0.05),
    });
    expect(result.status).toBe('grounded');
    expect(judge.calls).toHaveLength(0);
  });

  it('the above-band path is unchanged when the composite ALSO clears every clause — grounds directly, no judge consulted', async () => {
    const judge = countingJudge(true);
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judge: judge.port,
      requireComposite: true,
      compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS,
      compositeSignals: bandSignals(ABOVE_BAND_TOP1), // default lexBest 0.4 clears 0.18
    });
    expect(result.status).toBe('grounded');
    expect(judge.calls).toHaveLength(0);
  });

  it('the in-band, judge-supported path is unchanged when the composite ALSO clears every clause', async () => {
    const judge = countingJudge(true);
    const result = await resolveGroundedContext(bandHits, {
      band: BAND,
      query: 'q',
      judge: judge.port,
      requireComposite: true,
      compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS,
      compositeSignals: bandSignals(IN_BAND_TOP1),
    });
    expect(result.status).toBe('grounded');
    expect(judge.calls).toHaveLength(1);
  });

  it('a composite veto reads as an "insufficient notes" reason, never a transient one', () => {
    // Same reason family assertion `[D-089] §5`'s block makes for `below-band`
    // and `judge-rejected` — a composite veto is "checked and found nothing,"
    // categorically different from `composite-check-unavailable` /
    // `judge-unavailable`, which mean the check never ran at all.
    const decision = assembleBandedGroundedContext(bandHits, {
      band: BAND,
      requireComposite: true,
      compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS,
      compositeSignals: bandSignals(ABOVE_BAND_TOP1, 0.05),
    });
    expect(decision).toMatchObject({ reason: 'below-composite-threshold' });
    if (decision.status === 'refused') {
      expect(['composite-check-unavailable', 'judge-unavailable']).not.toContain(decision.reason);
    }
  });
});
