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
 * legitimately exist under two different task ids, under two different
 * prompt versions (the prompt changed after an earlier recording), AND under
 * two different models for the model-comparison keystone this cassette
 * exists to support: recording candidate model B's response to a payload
 * already recorded under candidate model A is the ORDINARY case, not an
 * error — it is exactly what "compare two models without re-running either"
 * means. `findGenerationEntry` below matches on the full 4-tuple directly,
 * so model A's and model B's recordings of the identical payload coexist in
 * `entries` side by side and each replays independently, keyed to the caller
 * asking for it by name.
 *
 * ## Never falls back to "close enough" — but a different pin is a MISS, not a THROW
 *
 * Same rule as `embedding-cassette.ts`'s `readCassette`: a schema, version,
 * or dataset-version mismatch throws `GenerationCassetteMismatchError`
 * rather than silently starting over or serving a partial result — that
 * discipline is unchanged, and still lives on `readGenerationCassette`
 * below.
 *
 * `findGenerationEntry`, one level down, is different on purpose: asking for
 * `(taskId, promptVersion, modelId, payloadHash)` and finding nothing for
 * that EXACT tuple is an ordinary miss (`undefined`), even when an entry
 * exists for the same `(taskId, payloadHash)` under some OTHER prompt
 * version or model. Earlier revisions of this module narrowed the lookup to
 * `(taskId, payloadHash)` first and then asserted the remaining two fields
 * against whatever single candidate that narrowing happened to find — which
 * meant recording model B for a payload already recorded under model A threw
 * before model B's call was ever attempted, the exact case this module exists
 * to make cheap. The narrow-then-assert shape never distinguished "no
 * recording exists" from "a DIFFERENT recording exists" — both looked like a
 * throw. Those are now two different, separately-reachable outcomes:
 * `findGenerationEntry`'s `undefined` return says only "not under the
 * requested pin"; `diagnoseGenerationCassetteMiss` below, called
 * independently and only for diagnostic reporting, says whether some OTHER
 * pin recorded the same payload. A caller that wants the old "this looks like
 * a superseded recording" hint composes the two rather than getting it as a
 * side effect of an assertion baked into the lookup.
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
 * This is the browser-safe half of `findGenerationEntry` below, which narrows
 * further to the full 4-tuple rather than trusting whichever entry this
 * 2-field lookup happens to find first. If more than one model's recording
 * exists for the same `(taskId, payloadHash)` — the coexistence this module
 * exists to support — this function returns array order's first match, not a
 * chosen one; callers with a pin to ask for should use `findGenerationEntry`
 * instead.
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
 * Looks up the entry for the full `(taskId, promptVersion, modelId,
 * payloadHash)` tuple. `undefined` means no recording exists under exactly
 * this pin — whether that is because NOTHING was ever recorded for this
 * payload, or because it was recorded only under a DIFFERENT prompt version
 * or model, is not distinguished here; both are an ordinary miss, and the
 * model-comparison keystone this module exists for depends on that being
 * true (model A's and model B's recordings of the same payload coexist in
 * `cassette.entries`, and a lookup pinned to model B must not be disturbed
 * by model A's entry sitting right next to it). Call
 * `diagnoseGenerationCassetteMiss` separately if a caller wants to know
 * whether some other pin recorded this exact payload — that is diagnostic
 * information for a miss report, never a reason to throw or to silently
 * serve the other pin's entry.
 *
 * Node-only in practice: only a caller with access to the task registry
 * (`olea-service`'s `cassette.mjs`) has a `promptVersion`/`modelId` pin to
 * ask for; see `findGenerationEntryByRequest` for the browser-safe lookup
 * that has no such pin to compare against.
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
  return cassette.entries.find(
    (entry) =>
      entry.taskId === key.taskId &&
      entry.promptVersion === key.promptVersion &&
      entry.modelId === key.modelId &&
      entry.payloadHash === key.payloadHash,
  );
}

/** One OTHER pin (not necessarily the one requested) that recorded the same `(taskId, payloadHash)`. */
export interface GenerationCassetteOtherPin {
  readonly promptVersion: string;
  readonly modelId: string;
}

/**
 * Diagnostic-only report for a `findGenerationEntry` miss — never a
 * substitute for it, and never thrown. `otherPins` lists every
 * `promptVersion`/`modelId` pin, other than the one queried, that DOES carry
 * a recording for the same `(taskId, payloadHash)` — ascending, so a report
 * is deterministic. `[]` means a genuine miss: nothing was ever recorded for
 * this payload under any pin, not just the one asked for.
 */
export interface GenerationCassetteMissDiagnostic {
  readonly otherPinExists: boolean;
  readonly otherPins: readonly GenerationCassetteOtherPin[];
}

/**
 * Explains a `findGenerationEntry` miss, without throwing and without being
 * consulted by `findGenerationEntry` itself. This is the explicit,
 * separately-callable form of the "stale pin" diagnostic that an earlier
 * revision of this module produced as a side effect of the lookup itself
 * (by throwing) — a cassette miss report that says "a recording exists for
 * this payload under a different model/promptVersion" is information a
 * caller may want to log or surface, not a reason to refuse the request.
 * `olea-service`'s `cassette.mjs` calls this only after `findGenerationEntry`
 * has already returned `undefined`, to enrich its own "no recording" refusal
 * message — never to decide whether to refuse.
 */
export function diagnoseGenerationCassetteMiss(
  cassette: GenerationCassette,
  key: {
    readonly taskId: string;
    readonly promptVersion: string;
    readonly modelId: string;
    readonly payloadHash: string;
  },
): GenerationCassetteMissDiagnostic {
  const otherPins = cassette.entries
    .filter(
      (entry) =>
        entry.taskId === key.taskId &&
        entry.payloadHash === key.payloadHash &&
        (entry.promptVersion !== key.promptVersion || entry.modelId !== key.modelId),
    )
    .map((entry) => ({ promptVersion: entry.promptVersion, modelId: entry.modelId }))
    .sort((a, b) =>
      a.promptVersion !== b.promptVersion
        ? a.promptVersion < b.promptVersion
          ? -1
          : 1
        : a.modelId < b.modelId
          ? -1
          : a.modelId > b.modelId
            ? 1
            : 0,
    );
  return { otherPinExists: otherPins.length > 0, otherPins };
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
