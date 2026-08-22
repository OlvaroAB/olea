/**
 * The generation cassette — a task-id + prompt-version + model-id +
 * payload-hash-keyed, hard-refusing record of `POST /v1/task` responses for
 * the generative chat tasks (`olea-service`'s `ol-opmb.3` [TB-3]).
 *
 * ## What this is, and is not
 *
 * `embedding-cassette.ts` (this package, `ol-opmb.2` [TB-2]) is the direct
 * precedent and this file copies its discipline field-for-field, adapted
 * from "one model, many content hashes" to "many task ids, each pinned to
 * its own prompt version and model, many payload hashes": one real call to
 * `cards.generate.v1`/`quiz.generate.v1` costs real neurons (Slot G, not the
 * cheapest slot — see the parent bead's spend cap). This is the "record
 * once, replay forever" half of that trade. `olea-service/scripts/harness/
 * cassette.mjs` is the only thing in this project that ever calls a real
 * generative model for the synthetic world, and
 * `packages/workbench/scripts/precompute-generation.mjs` is the only thing
 * that ever calls it against the synthetic world specifically. Every
 * workbench render and every test afterwards replays a cassette
 * (`packages/workbench/src/oracle/generate.ts`'s `CassetteGenerationProvider`)
 * and calls no network at all — D-021/INV-1: the workbench is dev tooling
 * and its browser bundle must never carry a live model-call path of its own.
 *
 * ## Why the key is FOUR fields, not one content hash
 *
 * `EmbeddingCassette` is pinned to exactly one model for the whole file, so
 * "the model changed" is a single top-level check. A generation cassette
 * spans multiple task ids (`cards.generate.v1`, `quiz.generate.v1`, ...),
 * each independently routed to its own slot, model and prompt version
 * (`olea-service/src/tasks/registry.ts`) — so the same payload hash could
 * legitimately exist under two different task ids, and the same
 * `(taskId, payloadHash)` pair could legitimately have been recorded against
 * an OLDER prompt version or model than the one currently pinned, if the
 * prompt changed after the recording. `findGenerationEntry` below refuses
 * that reuse outright rather than serving stale output — "a cassette that
 * silently replays a superseded prompt version is a harness reporting on
 * code that no longer exists" (the parent bead's own phrase, copied here on
 * purpose because it is the same failure mode `readCassette`'s model check
 * in `embedding-cassette.ts` already guards, one axis wider).
 *
 * ## Never falls back to "close enough"
 *
 * Same rule as `embedding-cassette.ts`'s `readCassette`: a schema, version,
 * or dataset-version mismatch throws `GenerationCassetteMismatchError`
 * rather than silently starting over or serving a partial result. A lookup
 * that finds an entry for the right `(taskId, payloadHash)` but the WRONG
 * `promptVersion`/`modelId` throws the same error rather than treating it as
 * an ordinary cache miss — silently re-recording under those circumstances
 * would hide the fact that a stale entry existed at all.
 *
 * `datasetVersion` covers what content-hash keying alone cannot: a
 * regeneration of the workbench's generation-scenario payloads that changes
 * which REQUESTS exist (a different course/concept/chunk set) without
 * necessarily changing every individual payload hash. Bump it whenever that
 * shape changes; a stale cassette then refuses rather than silently serving
 * a partial, mismatched replay.
 */

export const GENERATION_CASSETTE_VERSION = 1 as const;

/**
 * Bump whenever the workbench's generation scenarios change what REQUESTS
 * exist (not merely their content — content changes already invalidate via
 * payload-hash keying). A cassette built against a different dataset version
 * is refused outright by `readGenerationCassette`, never silently reused.
 */
export const GENERATION_DATASET_VERSION = 1 as const;

export type GenerationTaskResponse =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface GenerationCassetteEntry {
  readonly taskId: string;
  readonly promptVersion: string;
  readonly modelId: string;
  readonly payloadHash: string;
  /** The `POST /v1/task` response this entry replays — never the request payload (D-005: no content persisted beyond what replay itself requires; see `cassette.mjs`'s own module doc for where the request lives, gitignored, Node-side only). */
  readonly response: GenerationTaskResponse;
}

export interface GenerationCassette {
  readonly version: typeof GENERATION_CASSETTE_VERSION;
  readonly datasetVersion: number;
  /** Ascending `(taskId, payloadHash)` order — deterministic, meaningful equality in tests, same convention `EmbeddingCassette.entries` already uses. */
  readonly entries: readonly GenerationCassetteEntry[];
}

export class GenerationCassetteMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationCassetteMismatchError';
  }
}

/** An empty cassette at the current version, for the dataset a fresh precompute pass is about to fill in. */
export function emptyGenerationCassette(datasetVersion: number): GenerationCassette {
  return { version: GENERATION_CASSETTE_VERSION, datasetVersion, entries: [] };
}

/**
 * Parses and validates a cassette against the dataset version the caller is
 * about to use it for — the hard-refusal check the module doc argues for.
 * Throws `GenerationCassetteMismatchError` on any of: not an object, wrong
 * schema version, wrong dataset version, or a malformed entry. Never returns
 * a partially-trusted result.
 */
export function readGenerationCassette(
  raw: unknown,
  expected: { readonly datasetVersion: number },
): GenerationCassette {
  if (typeof raw !== 'object' || raw === null) {
    throw new GenerationCassetteMismatchError(
      'generation-cassette: the cassette file is not a JSON object. Re-run the precompute pass.',
    );
  }
  const parsed = raw as Partial<GenerationCassette>;
  if (parsed.version !== GENERATION_CASSETTE_VERSION) {
    throw new GenerationCassetteMismatchError(
      `generation-cassette: holds schema version ${JSON.stringify(parsed.version)}, not ${GENERATION_CASSETTE_VERSION}. Delete it and re-run the precompute pass — there is no migration to write.`,
    );
  }
  if (parsed.datasetVersion !== expected.datasetVersion) {
    throw new GenerationCassetteMismatchError(
      `generation-cassette: was built against dataset version ${JSON.stringify(parsed.datasetVersion)}, not ${JSON.stringify(expected.datasetVersion)}. The workbench's generation scenarios changed shape since this cassette was computed; re-run the precompute pass rather than replaying a mismatched set.`,
    );
  }
  if (!Array.isArray(parsed.entries)) {
    throw new GenerationCassetteMismatchError('generation-cassette: holds no `entries` array.');
  }
  for (const entry of parsed.entries) {
    const e = entry as Partial<GenerationCassetteEntry>;
    if (
      typeof e !== 'object' ||
      e === null ||
      typeof e.taskId !== 'string' ||
      typeof e.promptVersion !== 'string' ||
      typeof e.modelId !== 'string' ||
      typeof e.payloadHash !== 'string' ||
      typeof e.response !== 'object' ||
      e.response === null
    ) {
      throw new GenerationCassetteMismatchError(
        'generation-cassette: an entry is malformed (missing taskId, promptVersion, modelId, payloadHash or response).',
      );
    }
  }
  return {
    version: GENERATION_CASSETTE_VERSION,
    datasetVersion: expected.datasetVersion,
    entries: parsed.entries as readonly GenerationCassetteEntry[],
  };
}

/**
 * Looks up the entry for `(taskId, payloadHash)` alone — no independent
 * "expected" prompt version/model to compare against, because the caller has
 * none (the browser workbench's case: `oracle/generate.ts` has no access to
 * `olea-service`'s task registry, by design — D-021/INV-1). Whatever
 * `promptVersion`/`modelId` the entry itself carries is trusted as ground
 * truth for what was actually used when it was recorded, and is surfaced to
 * the caller rather than silently dropped. `undefined` means a genuine miss.
 *
 * This is the browser-safe half of `findGenerationEntry` below, which adds
 * the Node-side mismatch check on top of it.
 */
export function findGenerationEntryByRequest(
  cassette: GenerationCassette,
  key: { readonly taskId: string; readonly payloadHash: string },
): GenerationCassetteEntry | undefined {
  return cassette.entries.find(
    (entry) => entry.taskId === key.taskId && entry.payloadHash === key.payloadHash,
  );
}

/**
 * Looks up the entry for `(taskId, payloadHash)`. `undefined` means a
 * genuine miss — nothing was ever recorded for this exact request. If an
 * entry exists for that pair but its `promptVersion`/`modelId` differ from
 * what the caller currently expects (the task's prompt or slot pin moved
 * since this was recorded), this THROWS rather than returning either the
 * stale entry or `undefined` — see the module doc's "never falls back to
 * close enough". Node-only in practice: only a caller with access to the
 * task registry (`olea-service`'s `cassette.mjs`) has an "expected" value to
 * pass; see `findGenerationEntryByRequest` for the browser-safe lookup.
 */
export function findGenerationEntry(
  cassette: GenerationCassette,
  key: {
    readonly taskId: string;
    readonly promptVersion: string;
    readonly modelId: string;
    readonly payloadHash: string;
  },
): GenerationCassetteEntry | undefined {
  const candidate = findGenerationEntryByRequest(cassette, key);
  if (candidate === undefined) return undefined;
  if (candidate.promptVersion !== key.promptVersion || candidate.modelId !== key.modelId) {
    throw new GenerationCassetteMismatchError(
      `generation-cassette: holds a recording for ${JSON.stringify(key.taskId)} (payload ${key.payloadHash}) ` +
        `at promptVersion ${JSON.stringify(candidate.promptVersion)} / model ${JSON.stringify(candidate.modelId)}, ` +
        `but the caller now expects promptVersion ${JSON.stringify(key.promptVersion)} / model ${JSON.stringify(key.modelId)}. ` +
        'The task changed prompt or model pin since this was recorded — replaying it would be a harness ' +
        'reporting on code that no longer exists. Re-run the precompute pass rather than reusing this entry.',
    );
  }
  return candidate;
}

/** Serialisable form, entries sorted ascending by `(taskId, payloadHash)` — deterministic on disk. */
export function toSerialisableGenerationCassette(cassette: GenerationCassette): GenerationCassette {
  return {
    ...cassette,
    entries: [...cassette.entries].sort((a, b) => {
      if (a.taskId !== b.taskId) return a.taskId < b.taskId ? -1 : 1;
      return a.payloadHash < b.payloadHash ? -1 : a.payloadHash > b.payloadHash ? 1 : 0;
    }),
  };
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Canonical (sorted-key) `JSON.stringify`, so two structurally-identical
 * payloads built with keys in a different order still hash the same. Array
 * order is preserved — it is meaningful (e.g. `sourceChunks` order).
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * SHA-256 of the payload's canonical JSON form, hex-encoded — the payload
 * hash half of a cassette key. `SubtleCrypto` rather than `node:crypto`,
 * same reason `hash.ts` (`olea-core`) gives: this package's tests and the
 * workbench's browser bundle both need to run this, and `SubtleCrypto` is
 * the one hashing primitive available in both.
 */
export async function hashGenerationPayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}
