/**
 * The embedding cassette — a content-hash-keyed, model-pinned store of
 * pre-computed vectors for `retrieval-corpus.ts` + `queries.ts`
 * (`olea-service`'s `ol-opmb.2` [TB-2]).
 *
 * ## What this is, and is not
 *
 * One embedding pass over the synthetic corpus costs real neurons (the
 * cheapest slot, but real). This is the "embed once, replay forever" half of
 * that trade: `packages/workbench/scripts/precompute-embeddings.mjs` is the
 * only thing in this project that ever calls a real embedding model for the
 * synthetic world, and it writes its result through this module's shape.
 * Every workbench render and every test afterwards replays a cassette —
 * `packages/workbench/src/oracle/embedding-provider.ts`'s
 * `CassetteEmbeddingProvider` — and calls no network at all. That is what
 * makes a re-run free, and it is also what INV-1/D-021 need: the workbench
 * is dev tooling and its browser bundle must never carry a live model-call
 * path of its own.
 *
 * ## The cache-invalidation logic is COPIED, not reinvented, and it is
 * DELIBERATELY STRICTER than `olea-core`'s `EmbeddingCacheEngine`
 *
 * `EmbeddingCacheEngine` (`olea-core/src/retrieval/embeddingCache.ts`) treats
 * a model or schema-version mismatch as "start from zero" — silent,
 * automatic, correct for a live client cache that should just rebuild.
 * `readCassette` below does the opposite on purpose: it THROWS, exactly the
 * way `olea-service/scripts/harness/grounding-eval.mjs`'s `loadCorpusCache`
 * and `ensureQueryVectors` already do for the real-vault harness pass (see
 * their `if (parsed.model !== SLOT_E_MODEL) throw ...` — this is that same
 * check, same reasoning, same refuse-don't-silently-rebuild posture, ported
 * field-for-field). The reason a HARD refusal is right here and a silent
 * rebuild is right in `EmbeddingCacheEngine` is the same reason in both
 * directions: a client cache SHOULD self-heal because nobody is watching it
 * and paying a real embed-pass cost per user is exactly what D-006 wants; a
 * CASSETTE exists so a run never spends by accident, and a cassette that
 * silently discarded a stale model's vectors and moved on would either
 * pretend to work while comparing two different vector spaces by cosine
 * (D-004's own catastrophic case) or silently trigger a re-embed nobody
 * asked for and nobody priced. Neither is acceptable for a harness artifact,
 * so this refuses instead — "a cassette reporting on code that no longer
 * exists" is the parent bead's own phrase for exactly this failure mode.
 *
 * `datasetVersion` covers what content-hash keying alone cannot: a
 * regeneration of `retrieval-corpus.ts`/`queries.ts` that changes which
 * TEXTS exist (added, removed or reshuffled documents) without necessarily
 * changing every individual hash. Bump it whenever either module's shape
 * changes; a stale cassette then refuses rather than silently serving a
 * partial, mismatched replay.
 */

export const EMBEDDING_CASSETTE_VERSION = 1 as const;

/**
 * Bump whenever `retrieval-corpus.ts` or `queries.ts` changes what TEXTS
 * exist (not merely their content — content changes already invalidate via
 * content-hash keying). A cassette built against a different dataset version
 * is refused outright by `readCassette`, never silently reused.
 */
export const RETRIEVAL_DATASET_VERSION = 2 as const;

/**
 * The model id this cassette is pinned to. Restated here (not imported from
 * `olea-service`, which the public repo may never depend on at runtime) —
 * `precompute-embeddings.mjs` asserts this equals `SLOT_MODEL_CONFIG.E.modelId`
 * before spending anything, so drift between the two is caught at the one
 * place both values are in scope, the same discipline
 * `workerProvider.ts`'s own module doc explains for its task id constants.
 */
export const CASSETTE_MODEL_ID = '@cf/baai/bge-m3';

export interface EmbeddingCassetteEntry {
  readonly contentHash: string;
  /** Full precision — this is a pre-network-call replay source, not the client's on-device cache (which quantises, `ol-l1qz`). `EmbeddingCacheEngine` quantises on arrival exactly as it would a live provider's response. */
  readonly vector: readonly number[];
}

export interface EmbeddingCassette {
  readonly version: typeof EMBEDDING_CASSETTE_VERSION;
  readonly model: string;
  readonly datasetVersion: number;
  /** Ascending content-hash order — deterministic, meaningful equality in tests, same convention `PersistedEmbeddingCache.entries` already uses. */
  readonly entries: readonly EmbeddingCassetteEntry[];
}

export class CassetteMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CassetteMismatchError';
  }
}

/** An empty cassette at the current version, for the model/dataset a fresh precompute pass is about to fill in. */
export function emptyCassette(model: string, datasetVersion: number): EmbeddingCassette {
  return { version: EMBEDDING_CASSETTE_VERSION, model, datasetVersion, entries: [] };
}

/**
 * Parses and validates a cassette against the model and dataset version the
 * caller is about to use it for — the hard-refusal check the module doc
 * argues for. Throws `CassetteMismatchError` on any of: not an object,
 * wrong schema version, wrong model, or wrong dataset version. Never returns
 * a partially-trusted result.
 */
export function readCassette(
  raw: unknown,
  expected: { readonly model: string; readonly datasetVersion: number },
): EmbeddingCassette {
  if (typeof raw !== 'object' || raw === null) {
    throw new CassetteMismatchError(
      'embedding-cassette: the cassette file is not a JSON object. Re-run the precompute pass.',
    );
  }
  const parsed = raw as Partial<EmbeddingCassette>;
  if (parsed.version !== EMBEDDING_CASSETTE_VERSION) {
    throw new CassetteMismatchError(
      `embedding-cassette: holds schema version ${JSON.stringify(parsed.version)}, not ${EMBEDDING_CASSETTE_VERSION}. Delete it and re-run the precompute pass — there is no migration to write.`,
    );
  }
  if (parsed.model !== expected.model) {
    throw new CassetteMismatchError(
      `embedding-cassette: holds vectors for ${JSON.stringify(parsed.model)}, not ${JSON.stringify(expected.model)}. ` +
        'Comparing vectors from two embedding spaces by cosine is a silent, total corruption of ranking. Delete it and re-run the precompute pass.',
    );
  }
  if (parsed.datasetVersion !== expected.datasetVersion) {
    throw new CassetteMismatchError(
      `embedding-cassette: was built against dataset version ${JSON.stringify(parsed.datasetVersion)}, not ${JSON.stringify(expected.datasetVersion)}. ` +
        'retrieval-corpus.ts or queries.ts changed shape since this cassette was computed; re-run the precompute pass rather than replaying a mismatched set.',
    );
  }
  if (!Array.isArray(parsed.entries)) {
    throw new CassetteMismatchError('embedding-cassette: holds no `entries` array.');
  }
  for (const entry of parsed.entries) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { contentHash?: unknown }).contentHash !== 'string' ||
      !Array.isArray((entry as { vector?: unknown }).vector)
    ) {
      throw new CassetteMismatchError(
        'embedding-cassette: an entry is malformed (missing contentHash or vector).',
      );
    }
  }
  return {
    version: EMBEDDING_CASSETTE_VERSION,
    model: expected.model,
    datasetVersion: expected.datasetVersion,
    entries: parsed.entries as readonly EmbeddingCassetteEntry[],
  };
}

/** `EmbeddingCassette.entries`, keyed by content hash — what a replay provider looks vectors up by. */
export function cassetteEntriesByHash(
  cassette: EmbeddingCassette,
): ReadonlyMap<string, readonly number[]> {
  return new Map(cassette.entries.map((entry) => [entry.contentHash, entry.vector] as const));
}

/** Serialisable form, entries sorted ascending by content hash — same convention `PersistedEmbeddingCache.entries` uses, deterministic on disk. */
export function toSerialisableCassette(cassette: EmbeddingCassette): EmbeddingCassette {
  return {
    ...cassette,
    entries: [...cassette.entries].sort((a, b) =>
      a.contentHash < b.contentHash ? -1 : a.contentHash > b.contentHash ? 1 : 0,
    ),
  };
}
