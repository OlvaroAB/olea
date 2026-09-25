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
 * **PDF pages, rendered — `ol-egov.141.89.8.4` (`[D-324]`, resolving
 * `ol-9cle`).** A `'vision-page'` job for `format: 'pdf'` used to be an
 * unconditional, honest, non-retryable gap ("no page-to-image renderer
 * exists in either repo yet"). That renderer now exists
 * (`./page-render/pdf-page-renderer.ts`, `ol-9cle`) and is wired in here:
 * when `deps.pageRenderer` (a `PageRenderPort`) is supplied, a `'pdf'` page
 * is rendered to a PNG at `PDF_PAGE_RENDER_SCALE` and read exactly the way a
 * standalone image already is — same extractor, same landing logic, factored
 * into `readAndLandPage` below so the two paths cannot drift apart. A
 * render failure (`PageRenderError`) is per.md section 2's own rule for this
 * step: "the unit is recorded as not read because it could not be rendered,
 * not retried until the renderer changes, and never read as having no
 * content" — so every `PageRenderError` becomes a named, non-retryable
 * `JobRunOutcome`, never a fabricated empty reading. `pageRenderer` is
 * absent by default: a host that has not composed the real
 * `createObsidianPageRenderer` (`./page-renderer.ts`) still gets today's
 * honest gap, unchanged — see the still-open PPTX/DOCX note just below.
 *
 * **PPTX and DOCX stay the honest gap.** Their pages already carry embedded
 * raster image PARTS (`../extract/embedded-image.ts`, `ol-egov.141.89.8.20`)
 * rather than needing a render step, but per that file's own module doc, a
 * slide or region can carry zero, one or several such images, and which to
 * send — "send all, pick the largest, or combine" — is a selection policy
 * this bead's own notes say to "decide ... with evidence before wiring,"
 * not something to pick unilaterally under this bead's remaining time. Left
 * as a named follow-up (see this bead's report) rather than wired here.
 *
 * **`[D-326]` producer provenance, wired from the wire's own stamp.** Every
 * `SuccessResponse` this file's transport receives already carries a
 * `stamp: { modelId, promptVersion, ... }` alongside `result`
 * (`olea-service/src/index.ts`) — `readVisionResult` now reads it, so
 * `VisionPageExtractResult.modelId`/`.promptVersion` are the ACTUAL model
 * and prompt version that produced THIS reading, never a locally-assumed
 * constant. `readAndLandPage` (below) turns every reading — `'complete'`,
 * `'partial'` and `'unreadable'` alike — into a manifest-entry value
 * (mirroring `packages/core/src/ingestion/unit-manifest/types.ts`'s shape
 * locally; see `VisionUnitManifestEntry`'s own doc for why it is mirrored
 * rather than imported) carrying that provenance plus a digest of the image
 * bytes sent, and hands it to `deps.onManifestEntry` when one is supplied.
 * **Persisting that entry anywhere durable is deliberately NOT done here** —
 * `UnitManifest` has no store yet (a stored-shape call this bead does not
 * make unilaterally); `onManifestEntry` is the seam a later wiring bead
 * composes into one.
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
import { PageRenderError } from './page-render/errors.js';
import type { PageRenderPort } from './page-render/types.js';

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
  /**
   * The resolved model id that produced this reading, read from the wire
   * response's own `stamp.modelId` (`[D-326]`'s producer provenance) — see
   * the module doc. `WorkerVisionPageExtractor.extract` (the real
   * implementation) always supplies this; a `VisionPageExtractPort` test
   * double may omit it, since a fake answering directly has no wire stamp to
   * read — `readAndLandPage` falls back to a declared, honestly-labelled
   * placeholder in that case (see `UNREPORTED_PROVENANCE_FIELD`).
   */
  readonly modelId?: string;
  /** The prompt version that produced this reading, from `stamp.promptVersion` — same provenance and same optionality reasoning as `modelId` above. */
  readonly promptVersion?: string;
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

  // `[D-326]`: every real `SuccessResponse` carries `stamp.modelId`/
  // `stamp.promptVersion` alongside `result` (`olea-service/src/index.ts`) —
  // read here so producer provenance travels with the reading, not derived
  // from a locally-assumed constant.
  const stamp = response['stamp'];
  if (typeof stamp !== 'object' || stamp === null) {
    throw new WorkerVisionPageExtractorError(
      'WorkerVisionPageExtractor: the Worker response carried no `stamp` object.',
    );
  }
  const s = stamp as Record<string, unknown>;
  const modelId = s['modelId'];
  if (typeof modelId !== 'string') {
    throw new WorkerVisionPageExtractorError(
      'WorkerVisionPageExtractor: the Worker response carried no string `stamp.modelId`.',
    );
  }
  const promptVersion = s['promptVersion'];
  if (typeof promptVersion !== 'string') {
    throw new WorkerVisionPageExtractorError(
      'WorkerVisionPageExtractor: the Worker response carried no string `stamp.promptVersion`.',
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
    modelId,
    promptVersion,
  };
}

/**
 * Mirrors `packages/core/src/ingestion/unit-manifest/types.ts`'s
 * `UnitProducerProvenance` — not imported directly because that module is
 * not yet exported from `olea-core`'s public surface
 * (`packages/core/src/index.ts`, a shared file staged by the orchestrator,
 * not this bead's to edit; see this bead's report for the export lines it
 * still needs). Same reasoning `VISION_EXTRACT_V2_TASK_ID`'s own doc gives
 * for mirroring the frozen catalogue's task id locally rather than
 * importing it: mirror the shape, pin it, report the wiring gap rather than
 * reach around the package boundary.
 */
export interface VisionUnitProducerProvenance {
  readonly task: string;
  readonly promptVersion: string;
  readonly modelIdentity: string;
  readonly imageDigest: string;
}

/**
 * Mirrors the three outcomes this runner can actually reach in
 * `unit-manifest/types.ts`'s `UnitReadingState` union — always `method:
 * 'image'` here, since every unit this file lands came from the image path
 * (a standalone image, or a rendered PDF page); the `'text-and-image'`
 * method belongs to `[D-324]`'s still-open figure-cue routing (see this
 * bead's report), not reachable from this file yet.
 */
export type VisionUnitReadingState =
  | {
      readonly kind: 'read';
      readonly method: 'image';
      readonly provenance: VisionUnitProducerProvenance;
    }
  | {
      readonly kind: 'partial';
      readonly method: 'image';
      readonly coverage: string;
      readonly provenance: VisionUnitProducerProvenance;
    }
  | {
      readonly kind: 'unreadable';
      readonly reason: string;
      readonly provenance: VisionUnitProducerProvenance;
    };

/** Mirrors `unit-manifest/types.ts`'s `UnitManifestEntry` — see `VisionUnitProducerProvenance`'s doc for why mirrored rather than imported. Always `conceptExtractionState: 'not-started'`: this file only ever produces a freshly-read entry, never one concept extraction has already run over. */
export interface VisionUnitManifestEntry {
  readonly unitId: string;
  readonly sourcePath: VaultPath;
  readonly page: number;
  readonly readingState: VisionUnitReadingState;
  readonly conceptExtractionState: 'not-started';
}

/**
 * Mirrors `unit-manifest/manifest.ts#stableUnitId`'s algorithm exactly
 * (`${sourcePath}#${page}`) — not imported for the same reason above.
 * `vision-page-runner.spec.ts` pins the literal format so a future import
 * of the real function is a safe, test-verified swap.
 */
function stableVisionUnitId(sourcePath: VaultPath, page: number): string {
  return `${sourcePath}#${page}`;
}

/** The declared placeholder used when a `VisionPageExtractPort` (a test double, never the real `WorkerVisionPageExtractor`) answers without a `modelId`/`promptVersion` — see `VisionPageExtractResult`'s own doc. Honestly labelled rather than silently substituting an empty string a reader might mistake for real data. */
const UNREPORTED_PROVENANCE_FIELD = 'unreported (extractor did not supply it)';

/** The declared placeholder for a `'partial'` reading with no named coverage — same posture `olea-service/src/tasks/visionExtract.ts`'s `COVERAGE_NOT_STATED` takes for the identical gap server-side. */
const COVERAGE_NOT_STATED_FALLBACK = 'coverage not stated by the model';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * SHA-256 of the base64 image payload actually sent to the model — the
 * `imageDigest` `[D-326]`'s producer provenance names. Mirrors
 * `packages/core/src/ingestion/hash.ts#hashContent`'s algorithm (SHA-256 via
 * `SubtleCrypto`) so a digest computed here and a `contentHash` computed
 * there sit in the same hash family; not imported directly for the same
 * package-boundary reason as the types above. Hashes the base64 TEXT, never
 * decoded bytes: that is exactly, and only, what left this device for the
 * model to read (D-005 — no page bytes, no derived content, only an opaque
 * digest of what was sent).
 */
async function hashImagePayload(pageImageBase64: string): Promise<string> {
  // `TextEncoder.encode` always returns a freshly-allocated `Uint8Array`
  // backed by its own exactly-sized `ArrayBuffer` (never a view into a
  // larger one), so `.buffer` needs no `.slice()` narrowing the way
  // `hashContent` needs for an arbitrary caller-supplied view.
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(pageImageBase64).buffer,
  );
  return toHex(new Uint8Array(digest));
}

export interface WorkerVisionPageRunnerDeps {
  readonly vault: VaultSource;
  readonly extractor: VisionPageExtractPort;
  readonly sink: ExtractedUnitSink;
  /**
   * Renders one PDF page to an image, resolving `[D-324]`'s renderer gap
   * (`ol-9cle`) for `format: 'pdf'` — see the module doc's "PDF pages,
   * rendered" section. Absent by default: a host that has not composed
   * `createObsidianPageRenderer` (`./page-renderer.ts`) still gets today's
   * honest, named, non-retryable gap for a `'pdf'`/`'pptx'`/`'docx'` page.
   * PPTX and DOCX stay unrendered here regardless of whether this is
   * supplied — see the module doc for why.
   */
  readonly pageRenderer?: PageRenderPort;
  /**
   * `[D-326]` producer provenance, for a host that wants to build a durable
   * unit manifest — see the module doc's own section. Called at most once
   * per reading actually reached (never for a render/transport failure that
   * short-circuits before a `VisionPageExtractResult` exists), with one
   * `VisionUnitManifestEntry` covering exactly the reading just made.
   * **Absent by default: this file persists nothing itself** — a host that
   * wants a durable manifest supplies this and does the persisting; see
   * this bead's report for what still needs building.
   */
  readonly onManifestEntry?: (entry: VisionUnitManifestEntry) => void;
}

/**
 * The pdf.js render scale used when rasterising a routed PDF page for
 * `vision.extract.v2` (`[D-324]`; `ol-9cle`'s `PageRenderPort`).
 *
 * @provenance declared, never fitted (`docs/design/component-baseline.md`'s
 * declared-vs-derived line; `page-render/types.ts`'s own module doc leaves
 * this "a plain-English legibility choice for whoever wires this port"). A
 * PDF's default unit is 72 points per inch; a scale of 2 renders at roughly
 * 144 DPI — comfortably legible for body text, and well inside
 * `MAX_VISION_IMAGE_BASE64_CHARS`' generous headroom for a single page
 * (`olea-service/src/tasks/visionExtract.ts`) even at a dense A4/Letter page
 * size. UNMEASURED against a live model call, same status this file already
 * records for the image-input envelope generally (see the top module doc).
 */
export const PDF_PAGE_RENDER_SCALE = 2;

/**
 * Strips a data URL's `data:<mime>;base64,` prefix, leaving the standard
 * base64 `vision.extract.v2` requires. `RenderedPage.dataUrl` is always this
 * shape (`canvas.toDataURL('image/png')`'s own contract, `page-render/types.ts`).
 */
function dataUrlBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
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
/**
 * Builds this reading's `[D-326]` manifest entry and hands it to
 * `deps.onManifestEntry`, when one is supplied — see that field's own doc.
 * A no-op (and no digest computed) when it is absent, so a host that has
 * not wired a manifest sink pays nothing extra for this.
 */
async function emitManifestEntry(
  deps: WorkerVisionPageRunnerDeps,
  sourcePath: VaultPath,
  page: number,
  pageImageBase64: string,
  result: VisionPageExtractResult,
): Promise<void> {
  if (!deps.onManifestEntry) return;

  const provenance: VisionUnitProducerProvenance = {
    task: VISION_EXTRACT_V2_TASK_ID,
    promptVersion: result.promptVersion ?? UNREPORTED_PROVENANCE_FIELD,
    modelIdentity: result.modelId ?? UNREPORTED_PROVENANCE_FIELD,
    imageDigest: await hashImagePayload(pageImageBase64),
  };

  const readingState: VisionUnitReadingState =
    result.outcome === 'unreadable'
      ? { kind: 'unreadable', reason: result.unreadableReason ?? 'not-legible', provenance }
      : result.outcome === 'partial'
        ? {
            kind: 'partial',
            method: 'image',
            coverage: result.coverage ?? COVERAGE_NOT_STATED_FALLBACK,
            provenance,
          }
        : { kind: 'read', method: 'image', provenance };

  deps.onManifestEntry({
    unitId: stableVisionUnitId(sourcePath, page),
    sourcePath,
    page,
    readingState,
    conceptExtractionState: 'not-started',
  });
}

/**
 * Sends one already-obtained image (standalone-image bytes, or a rendered
 * PDF page) to `vision.extract.v2` and lands whatever comes back — the one
 * place either path turns a `VisionPageExtractResult` into a
 * `JobRunOutcome`, so the image-file path and the PDF-render path (below)
 * cannot drift apart on how a `'complete'`/`'partial'`/`'unreadable'`
 * reading is handled. Also the one place that builds this reading's
 * `[D-326]` manifest entry (`emitManifestEntry`, above) — every outcome
 * that reaches this far (`'complete'`, `'partial'`, `'unreadable'`) gets one,
 * even when it lands zero `ExtractedUnit`s (a figure-only or unreadable
 * page is still a completed reading, and `[D-326]`'s record exists
 * precisely to say so).
 */
async function readAndLandPage(
  deps: WorkerVisionPageRunnerDeps,
  job: JobRunnerView,
  pageImageBase64: string,
  mimeType: SupportedVisionMimeType,
  sourcePath: VaultPath,
  page: number,
  embeddedIn: EmbeddedInNote | undefined,
): Promise<JobRunOutcome> {
  let result: VisionPageExtractResult;
  try {
    result = await deps.extractor.extract({ pageImageBase64, mimeType });
  } catch (error) {
    if (isUnavailableVisionFailure(error)) {
      // `[D-325]`: an outage is never a judgement about the page — retried,
      // the same transient-environment shape a vault read failure gets,
      // never DF-21's permanent stop.
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

  await emitManifestEntry(deps, sourcePath, page, pageImageBase64, result);

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
}

/**
 * The `[D-324]` PDF branch: render the routed page with `deps.pageRenderer`,
 * then hand its bytes to `readAndLandPage` exactly the way a standalone
 * image already is. Every `PageRenderError` becomes a named, non-retryable
 * outcome — per.md section 2's own rule for this step ("not retried until
 * the renderer changes, and never read as having no content") — never a
 * fabricated empty reading and never silently retried against the same
 * unrenderable bytes.
 */
async function renderAndLandPdfPage(
  deps: WorkerVisionPageRunnerDeps,
  pageRenderer: PageRenderPort,
  job: JobRunnerView,
  sourcePath: VaultPath,
  page: number,
  embeddedIn: EmbeddedInNote | undefined,
): Promise<JobRunOutcome> {
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await deps.vault.readBinary(sourcePath);
  } catch {
    return { ok: false, retryable: true };
  }

  try {
    const rendered = await pageRenderer.renderPage({
      pdfBytes,
      pageNumber: page,
      scale: PDF_PAGE_RENDER_SCALE,
    });
    return await readAndLandPage(
      deps,
      job,
      dataUrlBase64(rendered.dataUrl),
      rendered.mimeType,
      sourcePath,
      page,
      embeddedIn,
    );
  } catch (error) {
    const code = error instanceof PageRenderError ? error.code : 'render-failed';
    return {
      ok: false,
      retryable: false,
      reason:
        `WorkerVisionPageRunner: job ${job.contentHash} could not be rendered to an image ` +
        `(${code}) — per.md section 2 treats a render failure as not read, never retried until ` +
        'the renderer itself changes, and never as a page with no content.',
    };
  }
}

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
      if (format === 'pdf' && deps.pageRenderer) {
        // `[D-324]`, resolving `ol-9cle` — see the module doc's "PDF pages,
        // rendered" section.
        return renderAndLandPdfPage(deps, deps.pageRenderer, job, sourcePath, page, embeddedIn);
      }
      // A page INSIDE a pptx/docx (or a pdf with no pageRenderer wired)
      // needs a rendered/selected page image this runner does not have a
      // way to obtain yet. Named, non-retryable gap — never silently doing
      // nothing, never crashing. See the module doc's PPTX/DOCX note for
      // why that half stays a gap rather than being wired unilaterally.
      return {
        ok: false,
        retryable: false,
        reason:
          `WorkerVisionPageRunner: job ${job.contentHash} needs a rendered page image for a ` +
          `'${format}' document, and no page renderer is wired for it in this run (ol-9cle's ` +
          "renderer exists for 'pdf'; PPTX/DOCX embedded-image selection is a separate, " +
          "still-open policy) — only standalone image sources (format 'image') are unconditionally wired today.",
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

    return readAndLandPage(deps, job, bytesToBase64(bytes), mimeType, sourcePath, page, embeddedIn);
  };
}
