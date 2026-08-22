import { describe, expect, it } from 'vitest';
import type { PersistedKeywordIndex } from '../keyword-index/types.js';
import { EmbeddingCacheEngine } from './embeddingCache.js';
import { retrieve } from './engine.js';
import type {
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
  PersistedEmbeddingCache,
} from './types.js';

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

/**
 * The fake embedding space these tests run in — and the one thing about it
 * that matters more than anything else it does.
 *
 * **It used to be orthogonal, and that made the INV-5 tests below unable to
 * fail** (`ol-cmpl`). The previous fixture was one axis per synonym group and
 * a one-hot vector per text, so two texts either shared an axis (cosine
 * exactly 1) or did not (cosine exactly 0). There was no middle. Every
 * "refuses on irrelevant content" test therefore passed on a property of the
 * fixture — unrelated things really were at zero in it — rather than on any
 * property of the system. **Nothing in a real embedding space is orthogonal.**
 * Every sentence of English shares a large common direction with every other
 * sentence of English, which is why the measured floor for *unrelated* text is
 * nowhere near zero.
 *
 * So this space is built to the shape that was actually measured against her
 * corpus on the first corpus-wide pass this project ran (`@cf/baai/bge-m3`,
 * 254 notes, 1,772 distinct chunks; the numbers live in
 * `olea-service/eval/grounding/README.md`, which carries no content and may be
 * quoted):
 *
 * | pairing                        | p10   | p50   | p90   |
 * | ------------------------------ | ----- | ----- | ----- |
 * | unrelated chunk vs query       | 0.284 | 0.375 | 0.470 |
 * | genuinely related chunk        | 0.504 | 0.573 | 0.698 |
 *
 * Three orthogonal components, weighted so those two bands come out:
 *
 *   - a **background** direction every text carries, weight² 0.375 — this is
 *     the "it is all English" component, and it alone puts unrelated text at
 *     0.375 rather than at 0;
 *   - a **topic** direction, weight² 0.198 — one of the named synonym axes
 *     when the text triggers one, otherwise a direction hashed into a generic
 *     topic subspace. Sharing a named axis lifts a pair from 0.375 to ≈ 0.573,
 *     the measured related median. **Text on no named topic still has a
 *     topic**, which is why gibberish here is a full-length vector sitting at
 *     background similarity to everything rather than a short or a null one —
 *     the property that let gibberish reach 0.522 against the real corpus;
 *   - an **idiosyncratic** direction per text, weight² 0.427, seeded from the
 *     text itself — this is what gives each band its spread, so a pair can
 *     land anywhere in ≈ [0.28, 0.47] unrelated or ≈ [0.50, 0.65] related
 *     instead of at a single point.
 *
 * The weights sum to 1, so every vector is unit length whatever it is about.
 *
 * `theFixtureIsRealistic` below asserts these bands hold. That test is what
 * stops this file quietly reverting to an orthogonal fixture: if it does, the
 * bands collapse and the guard goes red before the INV-5 tests can start
 * passing for the wrong reason again.
 */
const SYNONYM_AXES: readonly (readonly string[])[] = [
  ['mitochondria', 'powerhouse'],
  ['photosynthesis', 'chlorophyll', 'sunlight'],
  ['ribosome'],
  ['unrelated'],
  ['other'],
];

const BACKGROUND_DIM = 0;
const NAMED_TOPIC_DIM_0 = 1;
/** Where text on no *named* topic puts its topic weight. 24 dims keeps two such texts near-orthogonal on this component without making them exactly orthogonal. */
const GENERIC_TOPIC_DIM_0 = NAMED_TOPIC_DIM_0 + SYNONYM_AXES.length;
const GENERIC_TOPIC_DIMS = 24;
const IDIOSYNCRATIC_DIM_0 = GENERIC_TOPIC_DIM_0 + GENERIC_TOPIC_DIMS;
/** 35 dims puts the idiosyncratic cross-term's spread at ≈ 0.072, which is what reproduces the measured p10 0.284 / p90 0.470 band around a mean of 0.375. */
const IDIOSYNCRATIC_DIMS = 35;
const DIM = IDIOSYNCRATIC_DIM_0 + IDIOSYNCRATIC_DIMS;
const BACKGROUND_WEIGHT = Math.sqrt(0.375);
const TOPIC_WEIGHT = Math.sqrt(0.198);
const IDIOSYNCRATIC_WEIGHT = Math.sqrt(0.427);

/** FNV-1a, so a text's idiosyncratic direction is stable across runs and machines. */
function seedFor(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

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

/** A unit direction spread over `dims` dimensions. Box-Muller, so it is uniform on the sphere rather than biased toward the corners of a cube. */
function unitDirection(random: () => number, dims: number): number[] {
  const values: number[] = [];
  let magnitude = 0;
  for (let d = 0; d < dims; d++) {
    const u = Math.max(random(), Number.EPSILON);
    const value = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    values.push(value);
    magnitude += value * value;
  }
  const scale = 1 / Math.sqrt(magnitude);
  return values.map((value) => value * scale);
}

function fakeEmbed(text: string): readonly number[] {
  const lower = text.toLowerCase();
  const vector = new Array<number>(DIM).fill(0);

  vector[BACKGROUND_DIM] = BACKGROUND_WEIGHT;

  const axes = SYNONYM_AXES.map((axis, i) =>
    axis.some((word) => lower.includes(word)) ? i : -1,
  ).filter((i) => i >= 0);
  if (axes.length > 0) {
    // Split the topic weight across every axis the text triggers, so a text on
    // two topics is not twice as related to everything as a text on one.
    const share = TOPIC_WEIGHT / Math.sqrt(axes.length);
    for (const axis of axes) vector[NAMED_TOPIC_DIM_0 + axis] = share;
  } else {
    // Text on no NAMED topic still has a topic. Giving it one keeps its vector
    // unit length, which is what makes gibberish here sit at ordinary
    // background similarity to the whole corpus rather than being detectable
    // by being short — the property that let gibberish reach 0.522 for real.
    const generic = unitDirection(mulberry32(seedFor(`topic:${text}`)), GENERIC_TOPIC_DIMS);
    for (let i = 0; i < GENERIC_TOPIC_DIMS; i++) {
      vector[GENERIC_TOPIC_DIM_0 + i] = (generic[i] ?? 0) * TOPIC_WEIGHT;
    }
  }

  const idiosyncratic = unitDirection(mulberry32(seedFor(text)), IDIOSYNCRATIC_DIMS);
  for (let i = 0; i < IDIOSYNCRATIC_DIMS; i++) {
    vector[IDIOSYNCRATIC_DIM_0 + i] = (idiosyncratic[i] ?? 0) * IDIOSYNCRATIC_WEIGHT;
  }

  return vector;
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly requests: EmbedRequest[] = [];
  down = false;
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    this.requests.push(request);
    if (this.down) throw new Error('provider unavailable');
    return { vectors: request.texts.map(fakeEmbed) };
  }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function index(docs: { path: string; blocks: string[] }[]): PersistedKeywordIndex {
  return {
    version: 1,
    documents: docs.map((doc) => ({
      path: doc.path,
      courses: [],
      contentHash: 'unused',
      blocks: doc.blocks.map((text, blockIndex) => ({
        blockIndex,
        kind: 'paragraph' as const,
        text,
      })),
    })),
  };
}

async function makeDeps(idx: PersistedKeywordIndex, provider = new FakeEmbeddingProvider()) {
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider,
    model: 'fake-model-v1',
  });
  return { deps: { keywordIndex: idx, embeddingCache, embeddingProvider: provider }, provider };
}

/**
 * The guard on the fixture itself, and the reason the INV-5 tests below are
 * worth running at all (`ol-cmpl`).
 *
 * A refusal test can only mean something if its fixture can produce the case
 * that breaks refusal. The old one could not: unrelated text sat at cosine 0,
 * so "refuses on unrelated text" was true of the fixture before the system was
 * consulted. These assertions pin the fake space to the bands that were
 * MEASURED on real embeddings, so reverting to an orthogonal fixture — or
 * quietly shrinking the background component until unrelated text drops toward
 * zero again — turns this red rather than turning the suite green.
 */
/** The fixture's own worst unrelated case against a `mitochondria` query — ≈ 0.52, the figure `ol-cmpl` records for real gibberish. Asserted, not assumed, by the test below. */
const ADVERSARIAL_FILLER = 'filler passage number 6';

describe('the fake embedding space is shaped like a real one (ol-cmpl)', () => {
  // Deliberately topic-free filler: none of these strings contains any word in
  // SYNONYM_AXES, so every pairing among them is genuinely unrelated.
  const unrelatedTexts = Array.from({ length: 40 }, (_, i) => `filler passage number ${i}`);

  function pairwise(texts: readonly string[]): number[] {
    const vectors = texts.map(fakeEmbed);
    const scores: number[] = [];
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        scores.push(cosine(vectors[i] ?? [], vectors[j] ?? []));
      }
    }
    return scores.sort((a, b) => a - b);
  }

  const percentile = (sorted: readonly number[], p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

  it('puts UNRELATED text where it was measured — near 0.375, not near zero', () => {
    const scores = pairwise(unrelatedTexts);
    expect(percentile(scores, 0.1)).toBeGreaterThan(0.25);
    expect(percentile(scores, 0.5)).toBeGreaterThan(0.33);
    expect(percentile(scores, 0.5)).toBeLessThan(0.43);
    expect(percentile(scores, 0.9)).toBeGreaterThan(0.42);
  });

  it('puts nine unrelated pairs in ten ABOVE the 0.25 default relevance bar, as the real corpus does', () => {
    // The measured unrelated p10 is 0.284, so nine unrelated pairs in ten
    // already clear the bar meant to exclude them. That is the whole of
    // `ol-cmpl` in one number. If this ever fails, the fixture has drifted
    // back toward orthogonality and every refusal test here has stopped
    // meaning anything.
    expect(percentile(pairwise(unrelatedTexts), 0.1)).toBeGreaterThan(0.25);
  });

  it('reproduces the gibberish case: an unrelated passage reaching ≈ 0.52 against a topical query', () => {
    // 0.522 is the figure `ol-cmpl` records for real gibberish against her
    // real corpus. `filler passage number 6` is the fixture's own worst case
    // and lands in the same place — which is what makes the INV-5 test below
    // an actual adversarial case rather than a formality.
    const score = cosine(fakeEmbed('mitochondria'), fakeEmbed(ADVERSARIAL_FILLER));
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(0.55);
  });

  it('puts RELATED text in a band that OVERLAPS the unrelated one, as the real corpus does', () => {
    const related = pairwise([
      'a note about mitochondria in the cell',
      'the powerhouse organelle and its membrane',
      'why the powerhouse of the cell matters',
      'mitochondria and cellular respiration',
    ]);
    const unrelated = pairwise(unrelatedTexts);
    expect(percentile(related, 0.5)).toBeGreaterThan(0.5);
    // The overlap is the point. Related p10 (0.504) sits BELOW unrelated max,
    // so no single cosine threshold can separate the two populations — the
    // measured fact that makes tuning `minCosineScore` a non-fix.
    expect(related[0]).toBeLessThan(unrelated[unrelated.length - 1] ?? 1);
  });

  it('is not one-hot: no pair is at exactly 0 or exactly 1', () => {
    const scores = pairwise([...unrelatedTexts.slice(0, 8), 'mitochondria', 'ribosome study note']);
    for (const score of scores) {
      expect(score).toBeGreaterThan(0.05);
      expect(score).toBeLessThan(0.995);
    }
  });
});

/**
 * INV-5: adversarial empty-context proof for `retrieve`, the actual call
 * site a generative task uses (P3-T05). Both shapes of "nothing to ground
 * on" that C4.7 names — retrieval empty, and retrieval non-empty but
 * irrelevant — must resolve to `status: 'refused'`, never to a `grounded`
 * result manufactured from whatever happened to be nearby.
 */
describe('retrieve — INV-5 adversarial empty-context refusal (C4.7)', () => {
  it('refuses against a completely empty vault (no documents indexed at all)', async () => {
    const { deps } = await makeDeps(index([]));
    const result = await retrieve(deps, 'mitochondria');
    expect(result).toEqual({ status: 'refused', reason: 'no-hits' });
  });

  /**
   * **This is the defect `ol-cmpl` records, and it is written down as a
   * failing expectation rather than deleted or weakened.**
   *
   * `it.fails` asserts that the body below THROWS. So this test is green while
   * `retrieve` grounds on unrelated content, and it goes RED the moment a
   * refusal rule lands that actually holds — at which point the `.fails` comes
   * off and the assertion stands as an ordinary test. It cannot be forgotten,
   * because it fails when the bug is fixed.
   *
   * Why the assertion does not hold today: with a realistic space, unrelated
   * text sits at ≈ 0.375, and `assembleGroundedContext`'s bar is 0.25. The
   * measured evidence is that no absolute bar separates the two populations,
   * so raising 0.25 is not the fix — it trades one failure for another. The
   * labelled measurement is
   * `olea-service/eval/grounding/grounding-set-v1.0.0.json` (private, real
   * content — cite by path, never quote), scored by
   * `olea-service/scripts/harness/grounding-eval.mjs`.
   */
  it.fails('SHOULD refuse against an indexed vault whose content shares no keyword and no semantic relation with the query — ol-cmpl: it does not', async () => {
    const { deps } = await makeDeps(index([{ path: 'filler.md', blocks: [ADVERSARIAL_FILLER] }]));
    const result = await retrieve(deps, 'mitochondria');
    expect(result.status).toBe('refused');
  });

  it('refuses for an empty query string against a non-empty index', async () => {
    const { deps } = await makeDeps(
      index([{ path: 'a.md', blocks: ['mitochondria is the powerhouse'] }]),
    );
    const result = await retrieve(deps, '');
    expect(result.status).toBe('refused');
  });

  it('never returns her content inside a refusal result', async () => {
    // The refusal is forced by the query, not by the relevance bar: an empty
    // query produces no keyword hits and no query vector, so this reaches
    // `no-hits` regardless of how the bar is set. That matters — the property
    // under test is "a refusal carries no content", and it must not stop being
    // tested the day the bar stops refusing anything.
    const { deps } = await makeDeps(
      index([{ path: 'a.md', blocks: ['SENTINEL-CONTENT-MUST-NOT-LEAK-ON-REFUSAL'] }]),
    );
    const result = await retrieve(deps, '');
    expect(result.status).toBe('refused');
    expect(JSON.stringify(result)).not.toContain('SENTINEL-CONTENT-MUST-NOT-LEAK-ON-REFUSAL');
  });
});

describe('retrieve — grounded path', () => {
  it('grounds on a chunk that keyword-matches the query, with transient chunk text and source location', async () => {
    const { deps } = await makeDeps(
      index([
        { path: 'course/lecture-1.md', blocks: ['Mitochondria is the powerhouse of the cell.'] },
      ]),
    );
    const result = await retrieve(deps, 'mitochondria');
    expect(result.status).toBe('grounded');
    if (result.status === 'grounded') {
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]).toEqual({
        path: 'course/lecture-1.md',
        blockIndex: 0,
        text: 'Mitochondria is the powerhouse of the cell.',
      });
    }
  });

  it('grounds on a semantic-only match with no literal keyword overlap', async () => {
    const { deps } = await makeDeps(
      index([{ path: 'a.md', blocks: ['A discussion of photosynthesis in plant cells.'] }]),
    );
    // Query and source share zero literal tokens (verified: "chlorophyll"/
    // "capture"/"sunlight" appear nowhere in the source text, and
    // "photosynthesis"/"plant"/"cells" appear nowhere in the query), but
    // both land on the same synonym axis in the fake embedding space.
    const result = await retrieve(deps, 'how does chlorophyll capture sunlight');
    expect(result.status).toBe('grounded');
    if (result.status === 'grounded') expect(result.chunks[0]?.path).toBe('a.md');
  });

  it('embeds every indexed chunk at most once across repeated calls (C2.3 cost discipline)', async () => {
    const { deps, provider } = await makeDeps(
      index([{ path: 'a.md', blocks: ['Mitochondria is the powerhouse of the cell.'] }]),
    );
    await retrieve(deps, 'mitochondria');
    const requestsAfterFirst = provider.requests.length;
    await retrieve(deps, 'mitochondria again');
    // The document chunk itself is not re-embedded; only the (different) query text is.
    const documentTexts = provider.requests.slice(requestsAfterFirst).flatMap((r) => r.texts);
    expect(documentTexts).not.toContain('Mitochondria is the powerhouse of the cell.');
  });

  it('degrades to keyword-only retrieval, never throwing, when the embedding provider is unreachable', async () => {
    const provider = new FakeEmbeddingProvider();
    provider.down = true;
    const { deps } = await makeDeps(
      index([{ path: 'a.md', blocks: ['Mitochondria is the powerhouse of the cell.'] }]),
      provider,
    );

    const result = await retrieve(deps, 'mitochondria');

    expect(result.status).toBe('grounded');
  });
});
