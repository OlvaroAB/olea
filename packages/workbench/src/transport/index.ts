/**
 * The simulator's transport factory — `createSimulatorTransport` (WBX-4,
 * `ol-3ux7.64.5`; design: `../../../olea-service/docs/dev/simulator-design.md`
 * §5, F9.S4).
 *
 * Three modes behind ONE switch, all implementing the plugin's real
 * `WorkerTaskTransport` (`olea-core`'s `retrieval/workerProvider.ts`) — the
 * IDENTICAL interface `packages/plugin/src/worker/transport.ts`'s
 * `WorkerHttpTransport` implements for the real product, over the plugin's
 * own `HttpRequestFn` (never a bare `fetch` from a caller's point of view,
 * so a test double needs to satisfy nothing but that one function — same
 * reasoning as `WorkerHttpTransport`'s own module doc).
 *
 * - **`replay`** — a pre-loaded `GenerationCassette` only. A hit replays
 *   free, zero `httpRequest` calls, ever. A miss throws the SAME
 *   `WorkerTransportError` a genuine network failure would, so the plugin
 *   renders its real F7 unreachable-Worker state rather than a bespoke
 *   simulator error path.
 * - **`record`** — every call goes to `baseUrl`, which in this bead's own
 *   wiring is `olea-service`'s `scripts/simulator-serve.mjs` same-origin
 *   `/__olea` proxy. The proxy decides hit/miss/spend server-side (that
 *   file's own `createRecordReplayProxyHandler`); this mode is a thin
 *   `WorkerHttpTransport` pointed at it. The token this mode is given is
 *   never read by that proxy (it always uses its own process-env
 *   `OLEA_STAGING_TOKEN`, never the browser's) but is still sent, so the
 *   identical code path works unmodified against a real Worker too.
 * - **`direct`** — checks the SAME kind of pre-loaded cassette first (free
 *   replay on a hit) and falls back to a real `httpRequest` call on a miss,
 *   reporting the miss through `onMiss` rather than recording it (no disk
 *   in a browser). This is the private-Pages-deployment mode (WBX-7): no
 *   proxy exists there, so the pasted token travels with every live call,
 *   held only in the caller's own config store (`main.ts`'s simulator
 *   `plugin-data` host, per the design doc's §5 — never this module, which
 *   holds a token only for the lifetime of the request it is passed on).
 *
 * **The cassette is a caller-supplied, already-loaded value — this module
 * NEVER fetches or reads one itself.** How it gets into the page (a
 * build-time bundle, a fetch of a static JSON asset, IndexedDB) is the
 * simulator controller's call, not this factory's — see this bead's own
 * close-evidence report for the exact wiring call it expects `main.ts` to
 * make, since an integration lane owns that file concurrently with this one.
 *
 * D-005 / INV-3: `onMiss` receives a task id and a payload hash only — never
 * the payload itself, never her content — matching every other D-005 seam in
 * this codebase (`WorkerHttpTransport`'s own `onCallRecorded` doc is the
 * direct precedent for "figures only, never content"). This module also
 * never imports `obsidian` (INV-1): `worker/transport.ts` is "deliberately
 * obsidian-free" by its own module doc, and nothing added here changes that.
 *
 * ## `retrieval.embed.v1` is the ONE exception to "never fetches anything itself"
 * (WBX-16d, `ol-3ux7.64.18.4`)
 *
 * The generation cassette above is small enough to load once, up front, as a caller-supplied
 * value. The bundled embedding cassette is not (`olea-service`'s `scripts/simulator-build.mjs`
 * already had to shard it under Cloudflare Pages' 25 MiB per-file cap), so eagerly fetching every
 * shard defeats the point of sharding at all. `replay` and `direct` both check an OPTIONAL
 * `embedShards: EmbedShardStore` (`./embed-shards.js`) for any `retrieval.embed.v1` request
 * BEFORE their own cassette/live handling: a full hit (every requested chunk resolves) answers
 * with zero network; anything else — no store given, no bundled index, an unknown key — falls
 * through unchanged to that mode's EXISTING miss behaviour (`replay` throws
 * `WorkerTransportError`; `direct` reports the miss and goes live). `record` mode is untouched:
 * its proxy already owns embed hit/miss server-side (`simulator-serve.mjs`'s own
 * `createEmbedHandler`).
 */

import {
  RETRIEVAL_EMBED_TASK_ID,
  type WorkerTaskRequest,
  type WorkerTaskTransport,
} from 'olea-core';
import type { HttpRequestFn, WorkerConfig } from '../../../plugin/src/worker/transport.js';
import { WorkerHttpTransport, WorkerTransportError } from '../../../plugin/src/worker/transport.js';
import type { GenerationCassette, GenerationCassetteEntry } from '../synthetic-bridge.js';
import { findGenerationEntryByRequest, hashGenerationPayload } from '../synthetic-bridge.js';
import type { EmbedShardStore } from './embed-shards.js';

export {
  deriveEmbedKey,
  type EmbedShardFile,
  type EmbedShardIndex,
  EmbedShardStore,
  type EmbedShardStoreOptions,
} from './embed-shards.js';

export type SimulatorTransportMode = 'replay' | 'record' | 'direct';

/** Reported on a cassette miss in `replay`/`direct` mode — task id and payload hash only, never the payload (D-005/INV-3). */
export interface SimulatorTransportMiss {
  readonly taskId: string;
  readonly payloadHash: string;
}

/**
 * The F7.3 usage-recording shape `WorkerHttpTransport` already defines,
 * restated as a standalone type via `ConstructorParameters` so this module
 * names it without redeclaring its fields (`packages/plugin/src/worker/
 * transport.ts`'s own doc explains the shape and why every figure is
 * optional and never defaulted).
 */
export type SimulatorCallRecordedHandler = ConstructorParameters<typeof WorkerHttpTransport>[2];

export interface CreateSimulatorTransportOptions {
  readonly mode: SimulatorTransportMode;
  /** Required for `replay` and `direct` — the already-loaded cassette to check. Unused by `record`. */
  readonly cassette?: GenerationCassette;
  /**
   * Required for `record` (the proxy's origin, e.g.
   * `http://127.0.0.1:4322/__olea`) and `direct` (the real staging base
   * URL). Unused by `replay`.
   */
  readonly baseUrl?: string;
  /** `direct`'s pasted F7.1 token (required there). `record` may pass anything, or omit it — the proxy never reads it. Unused by `replay`. */
  readonly token?: string;
  /**
   * The HTTP primitive `record`/`direct` issue calls through. Defaults to a
   * plain browser `fetch` adapter (`browserFetchRequest` below); tests
   * inject a fake so nothing here ever needs a real network call. Unused by
   * `replay`.
   */
  readonly httpRequest?: HttpRequestFn;
  /**
   * `replay`/`direct`: called once per cassette miss, BEFORE the mode's own
   * handling of that miss (`replay` still throws afterwards — a miss there
   * is a hard refusal; `direct` calls this and then goes live).
   */
  readonly onMiss?: (miss: SimulatorTransportMiss) => void;
  /**
   * Forwarded verbatim to `WorkerHttpTransport` for `record`/`direct`'s live
   * calls (F7.3). Never called for a cassette hit in `direct` mode, since no
   * call was made to record.
   */
  readonly onCallRecorded?: SimulatorCallRecordedHandler;
  /**
   * `replay`/`direct` only (WBX-16d): the bundled embedding-shard store, checked for
   * `retrieval.embed.v1` requests before the mode's own cassette/live handling. Omitting it
   * means `retrieval.embed.v1` is treated exactly like any other task id — a checkout that never
   * built shards (`scripts/simulator-build.mjs`'s own tolerance for an absent cassette) still
   * works, just with retrieval.embed.v1 always falling to the mode's ordinary miss path. Unused
   * by `record` (its proxy already owns embed hit/miss server-side).
   */
  readonly embedShards?: EmbedShardStore;
}

/** A plain browser `fetch` adapter satisfying `HttpRequestFn` — the default `httpRequest` for `record`/`direct`. */
export const browserFetchRequest: HttpRequestFn = async (params) => {
  const response = await fetch(params.url, {
    method: params.method,
    headers: params.headers,
    body: params.body,
  });
  return { status: response.status, text: await response.text() };
};

/**
 * Turns a cassette entry back into the `/v1/task` response envelope the
 * plugin's transport returns from a real call — the browser-side twin of
 * `olea-service`'s `scripts/simulator-serve.mjs`'s `envelopeFromOutcome`
 * (same reasoning, necessarily duplicated rather than shared: two separate
 * deployables with no module boundary between them). Usage is honest zeros
 * with `inputTokensSource: 'unreported'` — the call really did cost nothing
 * this time, which is what "unreported" means everywhere else in this
 * codebase (`src/responseMetadata.ts` in `olea-service`, restated here
 * because that file cannot be imported across the repo boundary).
 */
function envelopeFromCassetteEntry(
  request: WorkerTaskRequest,
  entry: GenerationCassetteEntry,
): unknown {
  if (!entry.response.ok) {
    return { ok: false, code: entry.response.code, message: entry.response.message };
  }
  return {
    ok: true,
    stamp: {
      contractVersion: request.contractVersion,
      promptVersion: entry.promptVersion,
      modelId: entry.modelId,
      usage: {
        inputTokens: 0,
        inputTokensSource: 'unreported',
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
      },
    },
    result: entry.response.result,
    // The one honest constant a stateless calculator can offer — see
    // `olea-service`'s `src/responseMetadata.ts`'s `optimisticBudgetHeadroom`
    // for the fuller argument; restated as a literal for the same
    // cross-repo reason as the usage block above.
    budgetHeadroom: 1,
  };
}

class ReplayTransport implements WorkerTaskTransport {
  constructor(
    private readonly cassette: GenerationCassette,
    private readonly onMiss: ((miss: SimulatorTransportMiss) => void) | undefined,
    private readonly embedShards: EmbedShardStore | undefined,
  ) {}

  async send(request: WorkerTaskRequest): Promise<unknown> {
    if (this.embedShards !== undefined && request.taskId === RETRIEVAL_EMBED_TASK_ID) {
      const served = await this.embedShards.answer(request);
      if (served !== undefined) return served;
      // Falls through to the cassette lookup below, unchanged — an embed request the shards
      // could not fully answer is handled exactly like any other cassette miss (module doc).
    }
    const payloadHash = await hashGenerationPayload(request.payload);
    const entry = findGenerationEntryByRequest(this.cassette, {
      taskId: request.taskId,
      payloadHash,
    });
    if (entry === undefined) {
      this.onMiss?.({ taskId: request.taskId, payloadHash });
      // The SAME class, the SAME message, a real network failure would
      // throw — so the plugin renders its genuine F7 unreachable-Worker
      // state (`WorkerHttpTransport`'s own module doc) rather than a
      // bespoke simulator-only error shape.
      throw new WorkerTransportError(
        'olea: could not reach the Worker. Check the base URL and your connection.',
      );
    }
    return envelopeFromCassetteEntry(request, entry);
  }
}

class DirectTransport implements WorkerTaskTransport {
  private readonly live: WorkerHttpTransport;

  constructor(
    private readonly cassette: GenerationCassette | undefined,
    httpRequest: HttpRequestFn,
    config: WorkerConfig,
    private readonly onMiss: ((miss: SimulatorTransportMiss) => void) | undefined,
    onCallRecorded: SimulatorCallRecordedHandler,
    private readonly embedShards: EmbedShardStore | undefined,
  ) {
    this.live = new WorkerHttpTransport(httpRequest, config, onCallRecorded);
  }

  async send(request: WorkerTaskRequest): Promise<unknown> {
    if (this.embedShards !== undefined && request.taskId === RETRIEVAL_EMBED_TASK_ID) {
      const served = await this.embedShards.answer(request);
      if (served !== undefined) return served;
      // Falls through unchanged — no bundled answer for this embed request, so it is handled
      // exactly like any other cassette miss below: reported, then a live call.
    }
    if (this.cassette !== undefined) {
      const payloadHash = await hashGenerationPayload(request.payload);
      const entry = findGenerationEntryByRequest(this.cassette, {
        taskId: request.taskId,
        payloadHash,
      });
      if (entry !== undefined) {
        return envelopeFromCassetteEntry(request, entry);
      }
      this.onMiss?.({ taskId: request.taskId, payloadHash });
    }
    // No bundled cassette at all, or a miss against it — go live. `direct`
    // never records (no disk in a browser); the miss report above is the
    // whole of its "fill this later" story (design §5).
    return this.live.send(request);
  }
}

/**
 * The one factory the simulator's wiring calls. See the module doc for what
 * each mode needs and does; throws synchronously (before any request is
 * ever sent) if a mode is missing what it needs, rather than failing
 * confusingly on the first `.send()`.
 */
export function createSimulatorTransport(
  options: CreateSimulatorTransportOptions,
): WorkerTaskTransport {
  const httpRequest = options.httpRequest ?? browserFetchRequest;

  if (options.mode === 'replay') {
    if (options.cassette === undefined) {
      throw new Error('createSimulatorTransport: "replay" mode needs a cassette.');
    }
    return new ReplayTransport(options.cassette, options.onMiss, options.embedShards);
  }

  if (options.mode === 'record') {
    if (options.baseUrl === undefined) {
      throw new Error(
        'createSimulatorTransport: "record" mode needs baseUrl (the proxy\'s origin, e.g. ' +
          'http://127.0.0.1:4322/__olea).',
      );
    }
    // The token is sent but never read by simulator-serve.mjs's proxy (it
    // always uses its own process-env OLEA_STAGING_TOKEN) — see this
    // factory's module doc. Kept as a real WorkerConfig field, rather than a
    // record-mode special case, so this is the identical code path a direct
    // call to a real Worker would take.
    return new WorkerHttpTransport(
      httpRequest,
      { baseUrl: options.baseUrl, token: options.token ?? '' },
      options.onCallRecorded,
    );
  }

  // 'direct'
  if (options.baseUrl === undefined || options.token === undefined) {
    throw new Error(
      'createSimulatorTransport: "direct" mode needs both baseUrl and token (F7.1\'s pasted token).',
    );
  }
  return new DirectTransport(
    options.cassette,
    httpRequest,
    { baseUrl: options.baseUrl, token: options.token },
    options.onMiss,
    options.onCallRecorded,
    options.embedShards,
  );
}

export type { HttpRequestFn, WorkerConfig } from '../../../plugin/src/worker/transport.js';
export { WorkerTransportError } from '../../../plugin/src/worker/transport.js';
