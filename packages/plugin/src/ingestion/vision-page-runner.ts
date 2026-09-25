/**
 * `createWorkerVisionPageRunner` — the production `visionRunner` DF-21
 * reserved (`ExtractionRunnerDeps.visionRunner`, `packages/core/src/ingestion
 * /extraction-runner.ts`'s `runVisionPageJob`), for the one slice this bead
 * (`ol-15f8`, discovered from `ol-2zfj.121`) scopes: a **standalone image
 * source** (C3.1/C3.3 — a screenshot, an exported diagram, a photographed
 * page) whose `format` is `'image'`. For that format the page IS the file —
 * `vault.readBinary(sourcePath)` already gives the exact bytes `vision
 * .extract.v2` needs, no rendering step required (`image.ts`'s own doc: an
 * image has no text layer by construction, so `routePage` always sends it
 * here).
 *
 * A `'vision-page'` job for `pdf`/`pptx`/`docx` is a **page inside** a
 * multi-page document, which needs a rendered page image neither repo has a
 * renderer for yet (`ol-9cle`). This runner recognises that shape and
 * returns the same DF-21-style honest, non-retryable failure the module's
 * default `visionRunner`-less path already returns — naming the missing
 * renderer, never crashing, never silently doing nothing.
 *
 * **Migrated to `vision.extract.v2` by `ol-egov.141.89.8.18` (`[D-325]`,
 * `ol-egov.141.89.8.7`, discovered from `ol-2zfj.156`).** This file used to
 * speak `vision.extract.v1`'s two-outcome `readable`/`unreadableReason`
 * shape; it now speaks `v2`'s three named outcomes
 * (`complete`/`partial`/`unreadable`) and reads a figure's own description
 * (`figureDescription`) as a field separate from the page's transcribed text
 * — see "FIGURE DESCRIPTION" and "PARTIAL COVERAGE" below for what changed
 * and what is still owed. `v1` itself is untouched and stays served
 * (`olea-service/src/tasks/visionExtract.ts`'s `visionExtractTask`) — this
 * file was its only client, so nothing else in this repo still calls it.
 *
 * **Pattern.** Mirrors `retrieval/workerGroundingJudge.ts` /
 * `concept/workerConceptReader.ts`: a one-method `VisionPageExtractPort`
 * (the actual seam a fake stands in for in tests) implemented by
 * `WorkerVisionPageExtractor`, a thin class that turns a request into
 * `vision.extract.v2`'s frozen envelope, sends it through an injected
 * `WorkerTaskTransport`, and turns the reply back into a checked shape —
 * throwing a narrow `WorkerVisionPageExtractorError` on anything unusable,
 * exactly those two siblings' "fail closed, never open" posture. Layered on
 * top, `createWorkerVisionPageRunner` is the piece those two siblings don't
 * need: a `JobRunner` (a bare function, same shape
 * `transcription/workerTranscriptionCaller.ts`'s `TranscriptionCaller`
 * caller wraps), because `visionRunner` is a `JobRunner`, not a
 * `GroundingJudgePort`/`ConceptReaderPort` — it owns reading the job's own
 * `vault.readBinary`, choosing the mime type, and turning the port's answer
 * into the SAME `ExtractedUnit` shape the text-layer path produces
 * (`extraction-runner.ts`'s `extractResolvedSource`: one unit per page, full
 * text, `charRange: { start: 0, end: text.length }`) before handing it to
 * `sink.receive` — no other call site does that translation for a
 * `'vision-page'` job.
 *
 * **INV-5.** The empty-context guard for this task lives server-side
 * (`visionExtract.ts`'s `emptyInputGuard` / `isStructurallyEmptyPageImage`),
 * the same task-level-hook shape `cards.generate.v1`/`quiz.generate.v1` use
 * through `GroundingContract.emptyContextGuard` — this file does not
 * duplicate that judgement client-side. What this file DOES own is not
 * inventing a unit when the guard (or the model's own honest refusal) comes
 * back `outcome: 'unreadable'`, or `'complete'`/`'partial'` with no covered
 * text: that produces zero units, exactly the shape `extractResolvedSource`
 * already gives a furniture-only/empty page, never a fabricated concept.
 *
 * **FIGURE DESCRIPTION — kept apart, and there is nowhere for it to flow
 * yet.** `[D-325]`'s figure condition means `result.figureDescription` can
 * be non-null on a `'complete'` or `'partial'` reading, including the case
 * where `extractedText` is EMPTY (a figure-only page: the server's
 * `groundV2` reclassifies "no text, but a describable figure" out of
 * `'unreadable'` into `'complete'` precisely so that content is not lost —
 * see `visionExtract.ts`'s own doc). This runner never merges
 * `figureDescription` into a passage's `text` (that would be exactly the
 * "her material's own words" confusion `[D-325]` exists to prevent — a
 * figure description is Olea's wording, never citable as hers) and has
 * nothing else to hand it to: `ExtractedUnit`/`Provenance`
 * (`packages/core/src/extract/types.ts`) has no field for a figure
 * description, and this bead does not own that file. So `figureDescription`
 * is read off the response (proving it arrived and was recognised, not
 * silently swallowed by a parse failure — `vision-page-runner.spec.ts` tests
 * this) and then deliberately DROPPED. A real consumer needs one of: a new
 * optional field on `Provenance` (closest fit — it is already "where a unit
 * of text came from"), or a second `ExtractedUnitSink` call carrying a
 * distinct artefact kind. Either is a persisted-shape decision outside this
 * bead's `owns` and is reported rather than made here.
 *
 * **PARTIAL COVERAGE — the covered text is kept; the coverage NAME is not.**
 * A `'partial'` outcome's `extractedText` is real, honestly-scoped material
 * and is landed as an `ExtractedUnit` exactly like a `'complete'` reading's
 * text — losing it because the model ran out of its output allowance would
 * be strictly worse than keeping a partial page. What is NOT done: recording
 * `result.coverage` itself (what portion the model says it covered) anywhere
 * durable, or re-queuing the job to ask for the REST of the page. Both would
 * need a persisted field this bead does not own — `PersistedJob`/
 * `JobRunOutcome` (`packages/core/src/ingestion/types.ts`) have no slot for
 * "this job already covered X, ask for the rest," and inventing one here
 * would be exactly the kind of persisted-shape call this bead's own Class C
 * rule stops at. So a `'partial'` page is landed once, as far as it reads,
 * and never revisited — reported as follow-up work, not built unilaterally.
 *
 * **DF-21, "error → retryable only for an outage" (`[D-325]` fix).** `v1`'s
 * build marked EVERY failure reaching `vision.extract.v1` non-retryable,
 * reasoning that a malformed body, a refusal or a transport failure would
 * all "reach the same bytes and the same refusal" on a retry. That reasoning
 * holds for a genuine request/response problem (an `invalid-request`, a
 * response this module cannot parse) but NOT for a service outage: `[D-325]`
 * rules this outright — "service outages stay separate from judgements about
 * the page ... unavailable is operational and retried, never a result." So
 * `isUnavailableVisionFailure` below splits the catch: the transport itself
 * failing before any response arrives, or a well-formed Worker response
 * naming `upstream-error` (`olea-service/src/index.ts`'s own code for "the
 * model could not be reached / could not produce a usable response"), is
 * retried the same transient-environment way a vault read failure already
 * is; every other shape stays DF-21 non-retryable, on the original
 * reasoning. See that function's own doc for why `internal-error` is
 * deliberately NOT folded into the retryable set here.
 *
 * **D-005.** Nothing here logs. No page bytes, no `sourcePath`, no
 * `job.label` (a vault-relative path or lecture title — content-adjacent,
 * same posture `ingestion/materiality/workerJudge.ts`'s module doc states
 * for a note path) ever appears in a thrown error's message or a
 * `JobRunOutcome.reason` string — every message below names `job.contentHash`
 * (an opaque hash) or a structural fact (a format, an extension class,
 * a Worker error code), never an identifier that names her material, and
 * never a figure description or covered-text excerpt either.
 *
 * **Why the task id and contract version are local constants** — same
 * reasoning `workerConceptReader.ts`/`workerGroundingJudge.ts` give: `olea-
 * contracts`'s `main` points at TypeScript source, so a value import would
 * make this module unloadable from a plain Node process running
 * `packages/core`/`packages/plugin`'s built output.
 * `vision-page-runner.spec.ts` asserts both constants equal the frozen
 * catalogue's.
 *
 * **Reachability.** `ingestion/wiring.ts`'s `buildIngestionRunner` composes
 * this exactly the way `concept/wiring.ts`'s `buildConceptWiring` composes
 * `WorkerConceptReader` — load the persisted Worker config, build a real
 * transport only when it is usable (F7.8), else leave `visionRunner` unset.
 * The real production caller is `main.ts`'s `buildIngestionRunner` call,
 * whose `vision: { dataHost: this, createTransport: createRecordingTransport
 * }` option (`packages/plugin/src/main.ts:1522`) turns this on — see that
 * file's own comment there, and `wiring.ts`'s `buildVisionRunner`, for the
 * F7.8 grey-out gate. `wiring.ts` and `main.ts` import only
 * `createWorkerVisionPageRunner`/`WorkerVisionPageExtractor` by name from
 * this file, both unchanged by this migration, so neither needed touching
 * here.
 */

import type {
  EmbeddedInNote,
  ExtractedUnit,
  ExtractedUnitSink,
  JobRunner,
  JobRunnerView,
  JobRunOutcome,
  VaultPath,
  VaultSource,
  WorkerTaskTransport,
} from 'olea-core';
import { isExtractionJobPayload } from 'olea-core';

/** `TASK_IDS.VISION_EXTRACT_V2`, mirrored — see the module doc. Pinned by `vision-page-runner.spec.ts`. */
export const VISION_EXTRACT_V2_TASK_ID = 'vision.extract.v2';

/**
 * `CONTRACT_VERSION`, mirrored on the same terms and pinned by the same
 * test. Unchanged by the `v1` → `v2` migration: the envelope version moves
 * only when the ENVELOPE itself changes (`olea-contracts`'s `tasks.ts`
 * module doc — "`CONTRACT_VERSION` moves only when the envelope moves"); a
 * task's own trailing `.vN` is what tracks a payload-shape change instead.
 */
export const VISION_EXTRACT_CONTRACT_VERSION = 2;

/**
 * The three raster formats `vision.extract.v2` accepts — same request shape
 * as `v1` (`olea-service/src/tasks/visionExtract.ts`'s
 * `SUPPORTED_VISION_MIME_TYPES` — private, mirrored here as a declared
 * client-side constant, not derived: the mapping "a `.png` file is
 * `image/png`" needs no measurement). Deliberately narrower than
 * `packages/core/src/extract/registry.ts`'s `IMAGE_EXTENSIONS` (which also
 * treats `.gif`/`.bmp`/`.tif`/`.tiff`/`.heic`/`.heif` as `format: 'image'`
 * for routing purposes) — a standalone image in one of those wider formats
 * still routes to a `'vision-page'` job, and this runner reports it as the
 * honest, named, non-retryable gap below rather than guessing at an
 * unsupported mime type.
 */
export const SUPPORTED_VISION_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type SupportedVisionMimeType = (typeof SUPPORTED_VISION_MIME_TYPES)[number];

const MIME_TYPE_BY_EXTENSION: Readonly<Record<string, SupportedVisionMimeType>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** `null` for any extension `vision.extract.v2` does not accept — see `SUPPORTED_VISION_MIME_TYPES`'s doc. */
function mimeTypeFromPath(path: VaultPath): SupportedVisionMimeType | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return MIME_TYPE_BY_EXTENSION[ext] ?? null;
}

/** Chunk size for the binary-string build below — large enough to be fast, small enough that `String.fromCharCode(...chunk)` never approaches a call-stack argument limit on a several-megabyte image. */
const BASE64_CHUNK_BYTES = 0x8000;

/**
 * Raw bytes to standard base64, no `data:` prefix — the exact shape
 * `visionExtractRequest.pageImageBase64` requires. Hand-rolled off `btoa`
 * (available in both this package's DOM lib and modern Node, unlike
 * `packages/core`, which stays `btoa`-free for INV-1 host-agnosticism —
 * see `retrieval/quantise.ts`'s module doc for that reasoning; this file
 * lives in `packages/plugin`, which already assumes a DOM-shaped host).
 * Chunked to avoid spreading a multi-megabyte `Uint8Array` into
 * `String.fromCharCode` in one call.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

export interface VisionPageExtractRequest {
  readonly pageImageBase64: string;
  readonly mimeType: SupportedVisionMimeType;
}

/** `vision.extract.v2`'s three named outcomes. Never `'unavailable'` — that is an operational failure (a thrown error), not a result value; see the module doc's DF-21 section. */
export const VISION_PAGE_EXTRACT_OUTCOMES = ['complete', 'partial', 'unreadable'] as const;
export type VisionPageExtractOutcome = (typeof VISION_PAGE_EXTRACT_OUTCOMES)[number];

/**
 * `unreadableReason`/`coverage` are carried through for parity with the wire
 * shape and future observability, but nothing in this file logs either or
 * any other field here — see the module doc's D-005 note. `unreadableReason`
 * is a closed, small, categorical label, never the page's own text;
 * `coverage` is the model's own short account of what it covered, read here
 * but not persisted anywhere yet — see the module doc's "PARTIAL COVERAGE"
 * section.
 */
export interface VisionPageExtractResult {
  readonly outcome: VisionPageExtractOutcome;
  readonly extractedText: string;
  /** The model's own account of a figure's relationships. `null` when the page carries no figure worth describing. Never merged into `extractedText` — see the module doc's "FIGURE DESCRIPTION" section for why, and for what this runner does with it (nothing, yet, on purpose). */
  readonly figureDescription: string | null;
  /** Non-null exactly when `outcome` is `'partial'`. */
  readonly coverage: string | null;
  /** Non-null exactly when `outcome` is `'unreadable'`. */
  readonly unreadableReason: string | null;
}

/** The seam `WorkerVisionPageExtractor` implements — the thing a test fakes instead of a real Worker call. */
export interface VisionPageExtractPort {
  extract(request: VisionPageExtractRequest): Promise<VisionPageExtractResult>;
}

/**
 * Anything that went wrong reaching the Worker or reading its reply.
 * `createWorkerVisionPageRunner` catches every one of these (see the module
 * doc's DF-21 note) and never lets the message — which may echo the Worker's
 * own `code`/`message`, never her content — leak beyond a `JobRunOutcome
 * .reason` built fresh, naming only `job.contentHash`.
 */
export class WorkerVisionPageExtractorError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerVisionPageExtractorError';
    this.code = code;
  }
}

export interface WorkerVisionPageExtractorDeps {
  readonly transport: WorkerTaskTransport;
}

export class WorkerVisionPageExtractor implements VisionPageExtractPort {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: WorkerVisionPageExtractorDeps) {
    this.transport = deps.transport;
  }

  async extract(request: VisionPageExtractRequest): Promise<VisionPageExtractResult> {
    const body = await this.transport.send({
      contractVersion: VISION_EXTRACT_CONTRACT_VERSION,
      taskId: VISION_EXTRACT_V2_TASK_ID,
      payload: { pageImageBase64: request.pageImageBase64, mimeType: request.mimeType },
    });
    return readVisionResult(body);
  }
}

/** `null` for `value === null`, the string itself for a string, and a thrown `WorkerVisionPageExtractorError` for anything else — the shared shape `unreadableReason`/`coverage`/`figureDescription` all need. */
function readNullableString(
  value: unknown,
  fieldName: 'figureDescription' | 'coverage' | 'unreadableReason',
): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  throw new WorkerVisionPageExtractorError(
    `WorkerVisionPageExtractor: the Worker response carried a non-null, non-string \`${fieldName}\`.`,
  );
}

function readVisionResult(body: unknown): VisionPageExtractResult {
  if (typeof body !== 'object' || body === null) {
    throw new WorkerVisionPageExtractorError(
      'WorkerVisionPageExtractor: the Worker response was not an object.',
    );
  }
  const response = body as Record<string, unknown>;

  if (response['ok'] === false) {
    const code = typeof response['code'] === 'string' ? response['code'] : undefined;
    const message =
      typeof response['message'] === 'string' ? response['message'] : 'no message supplied';
    throw new WorkerVisionPageExtractorError(
      `WorkerVisionPageExtractor: the Worker refused the request (${code ?? 'no code'}): ${message}`,
      code,
    );
  }
  if (response['ok'] !== true) {
    throw new WorkerVisionPageExtractorError(
      'WorkerVisionPageExtractor: the Worker response carried no `ok` discriminant.',
    );
  }

  const result = response['result'];
  if (typeof result !== 'object' || result === null) {
    throw new WorkerVisionPageExtractorError(
      'WorkerVisionPageExtractor: the Worker response carried no `result` object.',
    );
  }
  const r = result as Record<string, unknown>;

  const outcome = r['outcome'];
  if (
    typeof outcome !== 'string' ||
    !(VISION_PAGE_EXTRACT_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    throw new WorkerVisionPageExtractorError(
      'WorkerVisionPageExtractor: the Worker response carried no valid `outcome`.',
    );
  }
  const extractedText = r['extractedText'];
  if (typeof extractedText !== 'string') {
    throw new WorkerVisionPageExtractorError(
      'WorkerVisionPageExtractor: the Worker response carried no string `extractedText`.',
    );
  }
  const figureDescription = readNullableString(r['figureDescription'], 'figureDescription');
  const coverage = readNullableString(r['coverage'], 'coverage');
  const unreadableReason = readNullableString(r['unreadableReason'], 'unreadableReason');

  return {
    outcome: outcome as VisionPageExtractOutcome,
    extractedText,
    figureDescription,
    coverage,
    unreadableReason,
  };
}

export interface WorkerVisionPageRunnerDeps {
  readonly vault: VaultSource;
  readonly extractor: VisionPageExtractPort;
  readonly sink: ExtractedUnitSink;
}

/**
 * `[D-325]`'s DF-21 fix — see the module doc's own section for the full
 * argument. `true` means the reading could not be reached at all, so a retry
 * is worth attempting; `false` means retrying would reach the identical
 * conclusion on the identical bytes.
 *
 * Two shapes count as unavailable:
 *  - `error` is not this module's own `WorkerVisionPageExtractorError` at
 *    all — the transport itself threw before any response arrived
 *    (`WorkerVisionPageExtractor.extract` does not wrap `transport.send`'s
 *    own failures), the ordinary network/outage shape.
 *  - `error` IS a `WorkerVisionPageExtractorError` naming the Worker's own
 *    `upstream-error` code — "the model could not be reached" / "could not
 *    produce a usable response, even after a retry" (`olea-service
 *    /src/index.ts`'s `StructuredOutputTransportError`/
 *    `StructuredOutputParseError` handling).
 *
 * Every other `WorkerVisionPageExtractorError` — a malformed/unusable
 * response body (no `ok` discriminant, no valid `outcome`, a wrong field
 * type) or any other Worker error code (`invalid-request`,
 * `grounding-refused`, `quota-exceeded`, `internal-error`,
 * `update-required`, `unauthenticated`) — is a genuine problem with THIS
 * request or THIS response, not an outage, and stays non-retryable.
 * `internal-error` is deliberately excluded even though `olea-core`'s
 * `JobRunOutcome` doc reads generically as "network, the Worker's
 * `upstream-error`/`internal-error`": `olea-service/src/index.ts`'s own
 * `isUpstreamFailure` branch exists precisely so a genuine internal/route-
 * refusal failure does not get silently retried as if it were a flaky
 * upstream (that file's own comment: "a C6 stop that reads like a flaky
 * upstream is a C6 stop nobody investigates").
 */
function isUnavailableVisionFailure(error: unknown): boolean {
  if (!(error instanceof WorkerVisionPageExtractorError)) return true;
  return error.code === 'upstream-error';
}

/**
 * Builds the real `visionRunner` — see the module doc for the whole shape.
 * Never throws: every failure this function can observe is turned into a
 * `JobRunOutcome` before it returns.
 */
export function createWorkerVisionPageRunner(deps: WorkerVisionPageRunnerDeps): JobRunner {
  return async (job: JobRunnerView): Promise<JobRunOutcome> => {
    if (!isExtractionJobPayload(job.payload) || job.payload.kind !== 'vision-page') {
      return {
        ok: false,
        retryable: false,
        reason: `WorkerVisionPageRunner: job ${job.contentHash} is not a recognised vision-page payload.`,
      };
    }

    const { sourcePath, format, page, embeddedIn } = job.payload;

    if (format !== 'image') {
      // A page INSIDE a pdf/pptx/docx needs a rendered page image; no
      // renderer exists in either repo yet (`ol-9cle`). Named, non-retryable
      // gap — never silently doing nothing, never crashing.
      return {
        ok: false,
        retryable: false,
        reason:
          `WorkerVisionPageRunner: job ${job.contentHash} needs a rendered page image for a ` +
          `'${format}' document, and no page-to-image renderer exists in either repo yet ` +
          "(ol-9cle) — only standalone image sources (format 'image') are wired today.",
      };
    }

    const mimeType = mimeTypeFromPath(sourcePath);
    if (mimeType === null) {
      return {
        ok: false,
        retryable: false,
        reason:
          `WorkerVisionPageRunner: job ${job.contentHash} names an image extension ` +
          'vision.extract.v2 does not accept — only .png/.jpg/.jpeg/.webp are wired.',
      };
    }

    let bytes: Uint8Array;
    try {
      bytes = await deps.vault.readBinary(sourcePath);
    } catch {
      // The ordinary transient-environment shape `extraction-runner.ts`'s
      // own catch-all already gives every other vault read failure (a file
      // deleted between discovery and drain, a transient read error).
      return { ok: false, retryable: true };
    }

    let result: VisionPageExtractResult;
    try {
      result = await deps.extractor.extract({ pageImageBase64: bytesToBase64(bytes), mimeType });
    } catch (error) {
      if (isUnavailableVisionFailure(error)) {
        // `[D-325]`: an outage is never a judgement about the page — retried,
        // the same transient-environment shape a vault read failure gets
        // just above, never DF-21's permanent stop.
        return { ok: false, retryable: true };
      }
      // DF-21: a genuine problem with this request or this response (a
      // refusal, a malformed body) will reach the identical conclusion on
      // the identical bytes — retrying buys nothing.
      return {
        ok: false,
        retryable: false,
        reason: `WorkerVisionPageRunner: vision.extract.v2 could not serve job ${job.contentHash}.`,
      };
    }

    if (result.outcome === 'unreadable') {
      // INV-5 / honest failure: zero units, not an error — the same shape
      // `extractResolvedSource` already gives a furniture-only/empty page.
      // Never fabricates a concept out of a refusal.
      return { ok: true };
    }

    // `'complete'` or `'partial'` from here. `result.figureDescription` and
    // (for `'partial'`) `result.coverage` are deliberately read and then not
    // acted on further — see the module doc's "FIGURE DESCRIPTION" and
    // "PARTIAL COVERAGE" sections for why, and what each still needs.
    if (result.extractedText.length === 0) {
      // No passage text to land — either an honestly empty reading, or
      // `[D-325]`'s figure-only-page case (`'complete'` with only a
      // `figureDescription`), which has nowhere to flow on this side yet.
      // Same "no unit invented from nothing" shape v1 held for empty text.
      return { ok: true };
    }

    const embeddedInField: { embeddedIn?: EmbeddedInNote } = embeddedIn ? { embeddedIn } : {};
    const unit: ExtractedUnit = {
      text: result.extractedText,
      provenance: {
        sourcePath,
        location: { page, charRange: { start: 0, end: result.extractedText.length } },
        ...embeddedInField,
      },
    };
    await deps.sink.receive([unit]);
    return { ok: true };
  };
}
