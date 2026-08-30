/**
 * `ol-azo7`'s acceptance test: production and
 * `olea-service/scripts/harness/grounding-eval.mjs` compute the SAME
 * composite grounding signals — and therefore the SAME grounded/refused
 * decision — on the SAME real input. A rule measured in the harness and
 * executed here through a different, hand-re-derived formula is exactly how
 * a ratified number stops describing the product; this test is what rules
 * that out.
 *
 * **This reads real vault content and real query text at runtime, and it
 * must never write any of it anywhere.** The inputs live in the private
 * `olea-service` repo, a sibling of this one in the same workspace
 * (`olea-service/CLAUDE.md`'s "sanctioned homes for real content"): the
 * real-vault snapshot (`docs/Obsidian-vault-copy/`), a cached corpus
 * embedding pass (`.olea-harness/retrieval/…/embedding-cache.json`), cached
 * query vectors (`.olea-harness/grounding/query-vectors.json`), the RATIFIED
 * labelled set (`eval/grounding/grounding-set-v1.0.1.json`) and one cached,
 * RATIFIED harness report (`.olea-harness/grounding/…/grounding-eval.json`).
 * This file's own SOURCE contains none of that content — only item ids
 * (`ans-01`, `ans-21`, `gib-01`), which the set's own README already
 * establishes as the opaque, quotable naming scheme (INV-3). Every value
 * this test reads from those files stays in memory for the duration of one
 * `expect(...)` call and is never logged, written or asserted into a message
 * string.
 *
 * **Skips itself, whole, rather than failing, when the private sibling
 * repo isn't checked out** — this is the public `olea` repo, and CI here
 * must not depend on private data being present. A `describe.skipIf` is the
 * failure-closed choice: a checkout without `olea-service` simply doesn't
 * run this file, and nothing here is available to fabricate a result if the
 * data is partially present, since every load below throws on a missing
 * field instead.
 *
 * Item selection matters here and is not arbitrary. `ans-01` (no
 * `excludeChunks`) and `gib-01` (obviously unrelated) are easy anchors, but
 * they sit nowhere near a threshold boundary — under RECOMMENDED there are
 * zero false refusals among the 40 answerable items, so an anchor-only test
 * would pass under almost any threshold, including deliberately wrong ones
 * (N-013: a check that cannot fail is anti-evidence). `ans-21` exercises the
 * `excludeChunks` filtering path (`eval/grounding/README.md`). The rest are
 * the actual decision-boundary items, chosen from the reference report's own
 * `recommended.groundedUnanswerable`/`refusedAnswerable` lists: `near-01`,
 * `near-02`, `near-03`, `near-04`, `near-06` and `near-09` are near-miss
 * items RECOMMENDED wrongly GROUNDS (the false positives its precision
 * figure is built from); `near-05` and `near-07` are near-miss items it
 * correctly REFUSES, each failing a different clause right at the edge (one
 * on `top1`, one on `marginP99`) — see `compositeSignals.ts`'s
 * `RECOMMENDED_COMPOSITE_THRESHOLDS`. A wrong threshold flips these, which
 * is what makes the verdict assertion below actually able to fail.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFullIndex } from '../keyword-index/build.js';
import { searchKeywordIndex } from '../keyword-index/query.js';
import { FolderSource } from '../vault/folder-source.js';
import { chunksFromIndex } from './chunks.js';
import { computeCompositeGroundingSignals } from './compositeSignals.js';
import { assembleGroundedContext } from './groundedContext.js';
import { hybridRetrieve } from './hybrid.js';
import type { RetrievalChunk, VectorLike } from './types.js';

const PRIVATE_REPO = new URL('../../../../../olea-service/', import.meta.url);
// The corpus embedding cache and reference report below were both cached
// (2026-08-14/15) against the T0 snapshot. `docs/Obsidian-vault-copy/` used
// to BE that flat snapshot; a later reorg (`ol-3ux7.5.10`) pure-renamed T0
// to `UNIVERSITY_20260810/` and added a second, larger T1 snapshot
// (`UNIVERSITY_20260828/`) alongside it (`docs/README.md`). Pointing this
// test at the bare directory after that reorg silently swaps in a bigger,
// different corpus — `buildLexicon`'s idf weighting is corpus-wide, so
// `lexBest` drifts even though `top1`/`marginP99` (keyed off the unchanged
// embedding cache's content hashes) do not. Pin to T0 explicitly so this
// test keeps replaying the exact corpus the cached numbers came from.
const VAULT_ROOT = new URL('docs/Obsidian-vault-copy/UNIVERSITY_20260810/', PRIVATE_REPO);
const CORPUS_EMBEDDING_CACHE = new URL(
  '.olea-harness/retrieval/2026-08-14T23-41-02-925Z__slot-e-corpus/embedding-cache.json',
  PRIVATE_REPO,
);
const QUERY_VECTORS = new URL('.olea-harness/grounding/query-vectors.json', PRIVATE_REPO);
const GROUNDING_SET = new URL('eval/grounding/grounding-set-v1.0.1.json', PRIVATE_REPO);
const REFERENCE_REPORT = new URL(
  '.olea-harness/grounding/2026-08-15T22-38-34-269Z/grounding-eval.json',
  PRIVATE_REPO,
);

const REQUIRED = [
  VAULT_ROOT,
  CORPUS_EMBEDDING_CACHE,
  QUERY_VECTORS,
  GROUNDING_SET,
  REFERENCE_REPORT,
];
const ALL_PRESENT = REQUIRED.every((url) => existsSync(url));

const ITEM_IDS = [
  'ans-01',
  'ans-21',
  'gib-01',
  // near-miss items RECOMMENDED grounds (false positives — the boundary it overshoots).
  'near-01',
  'near-02',
  'near-03',
  'near-04',
  'near-06',
  'near-09',
  // near-miss items RECOMMENDED correctly refuses (the boundary from the other side).
  'near-05',
  'near-07',
] as const;

interface GroundingSetItem {
  readonly id: string;
  readonly kind: 'answerable' | 'unanswerable';
  readonly query: string;
  readonly excludeChunks?: readonly string[];
}

interface ReferenceSignal {
  readonly id: string;
  readonly lexBest: number;
  readonly top1: number;
  readonly marginP99: number;
}

interface ReferenceReport {
  readonly signals: readonly ReferenceSignal[];
  readonly recommended: {
    readonly refusedAnswerable: readonly string[];
    readonly groundedUnanswerable: readonly string[];
  };
}

describe.skipIf(!ALL_PRESENT)(
  'composite grounding signals — equivalence with a cached, ratified harness run (ol-azo7)',
  () => {
    it("reproduces the harness's own lexBest/top1/marginP99 numbers, and its RECOMMENDED grounded/refused verdict", async () => {
      const set = JSON.parse(readFileSync(GROUNDING_SET, 'utf8')) as {
        items: readonly GroundingSetItem[];
      };
      const report = JSON.parse(readFileSync(REFERENCE_REPORT, 'utf8')) as ReferenceReport;
      const corpusCache = JSON.parse(readFileSync(CORPUS_EMBEDDING_CACHE, 'utf8')) as {
        entries: readonly { contentHash: string; vector: readonly number[] }[];
      };
      const queryVectors = (
        JSON.parse(readFileSync(QUERY_VECTORS, 'utf8')) as {
          vectors: Record<string, readonly number[]>;
        }
      ).vectors;

      const build = await buildFullIndex({
        vault: new FolderSource(VAULT_ROOT.pathname),
        scheduler: { yield: async () => {} },
      });
      if (build.status !== 'complete') throw new Error('buildFullIndex did not complete.');
      const index = build.index;
      const chunks = await chunksFromIndex(index);

      // grounding-eval.mjs's own id resolution: a chunk id is registered
      // under both the path spelling the chunker emits AND that path with
      // its first segment stripped — the labelled set stores the second.
      // Ported here (test-only) so this test resolves `excludeChunks`
      // exactly the way the reference report's own numbers were produced.
      const byId = new Map<string, RetrievalChunk>();
      for (const chunk of chunks) {
        const rel = chunk.path.includes('/')
          ? chunk.path.slice(chunk.path.indexOf('/') + 1)
          : chunk.path;
        byId.set(`${chunk.path}#${chunk.blockIndex}`, chunk);
        if (!byId.has(`${rel}#${chunk.blockIndex}`)) byId.set(`${rel}#${chunk.blockIndex}`, chunk);
      }

      const embeddingsByHash = new Map<string, VectorLike>();
      for (const entry of corpusCache.entries) {
        embeddingsByHash.set(entry.contentHash, entry.vector as VectorLike);
      }

      const signalsById = new Map(report.signals.map((s) => [s.id, s] as const));

      for (const id of ITEM_IDS) {
        const item = set.items.find((i) => i.id === id);
        if (!item) throw new Error(`fixture item missing from the grounding set: ${id}`);
        const expected = signalsById.get(id);
        if (!expected) throw new Error(`fixture item missing from the reference report: ${id}`);
        const queryVector = queryVectors[id];
        if (!queryVector) throw new Error(`no cached query vector for: ${id}`);

        // The harness's own exclusion handling (`keptChunksFor`/
        // `keptEmbeddingsFor` in grounding-eval.mjs), honoured identically:
        // the corpus MINUS this item's own source chunks.
        const excludedIds = new Set<string>();
        for (const exId of item.excludeChunks ?? []) {
          const chunk = byId.get(exId);
          if (chunk) excludedIds.add(`${chunk.path}#${chunk.blockIndex}`);
        }
        const keptChunks = chunks.filter((c) => !excludedIds.has(`${c.path}#${c.blockIndex}`));
        const keptEmbeddings = new Map<string, VectorLike>();
        for (const chunk of keptChunks) {
          if (keptEmbeddings.has(chunk.contentHash)) continue;
          const vector = embeddingsByHash.get(chunk.contentHash);
          if (vector) keptEmbeddings.set(chunk.contentHash, vector);
        }
        const keywordHits = searchKeywordIndex(index, item.query).filter(
          (hit) => !excludedIds.has(`${hit.path}#${hit.blockIndex}`),
        );

        // --- production: the signals themselves --------------------------
        const signals = computeCompositeGroundingSignals({
          query: item.query,
          chunks: keptChunks,
          queryVector,
          embeddings: keptEmbeddings,
        });

        // The harness rounds every signal to 4 decimals before recording it
        // (`round()` in grounding-eval.mjs); 3-decimal closeness absorbs
        // that without asserting more precision than the reference actually
        // carries.
        expect(signals.lexBest).toBeCloseTo(expected.lexBest, 3);
        expect(signals.top1 ?? Number.NaN).toBeCloseTo(expected.top1, 3);
        expect(signals.marginP99 ?? Number.NaN).toBeCloseTo(expected.marginP99, 3);

        // --- production: the actual shipped call shape --------------------
        const hits = await hybridRetrieve({
          query: item.query,
          chunks: keptChunks,
          keywordHits,
          queryVector,
          embeddings: keptEmbeddings,
        });
        const result = assembleGroundedContext(hits, {
          requireComposite: true,
          compositeSignals: signals,
        });

        // The oracle for "should RECOMMENDED have grounded this" is the
        // harness's OWN recorded verdict lists, not a threshold comparison
        // re-derived from `expected`'s raw numbers — so this assertion
        // cannot pass merely because both sides share the same arithmetic.
        const harnessGrounded =
          item.kind === 'answerable'
            ? !report.recommended.refusedAnswerable.includes(id)
            : report.recommended.groundedUnanswerable.includes(id);

        expect(result.status === 'grounded').toBe(harnessGrounded);
      }
    });
  },
);
