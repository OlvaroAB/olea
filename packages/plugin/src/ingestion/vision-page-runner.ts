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
 * multi-page document. A PDF page needs a rendered page image
 * (`deps.pageRenderer`, see "PDF pages, rendered" below); a PPTX slide or
 * DOCX region instead carries its own embedded raster image part(s) and is
 * sent via the D-324 combine cue (see "PPTX and DOCX, sent" below). Whatever
 * is still genuinely unresolvable — a PDF with no `pageRenderer` wired —
 * gets the same DF-21-style honest, non-retryable failure the module's
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
 * honest gap, unchanged for PDF — PPTX/DOCX do not need this port at all
 * (see "PPTX and DOCX, sent" just below).
 *
 * **PPTX and DOCX, sent — `ol-egov.141.89.8.26`'s send wiring.** Their pages
 * carry embedded raster image PARTS (`../extract/embedded-image.ts`,
 * `ol-egov.141.89.8.20`) rather than needing a render step, and which of
 * several such images to send — "send all, pick the largest, or combine" —
 * was this bead's own open question. The orchestrator self-ratified
 * **combine** as Class B (2026-09-27, `findings/office-image-selection.md`
 * in the service repo), and `../extract/pptx.ts`'s `pptxFigureCue` /
 * `../extract/docx.ts`'s `docxFigureCue` implement and test that trigger:
 * a slide/region qualifies when its non-recurring candidate images, summed,
 * clear the same `FIGURE_CUE_MIN_SHARE` `figure-cue.ts` uses for PDF (DOCX's
 * own denominator is its declared `w:sectPr`/`w:pgSz`, never guessed when
 * absent) — and that same call now also runs INSIDE `pptxExtractor.extract`/
 * `docxExtractor.extract` themselves, widening a qualifying page's own
 * `route` to `'both'` so it actually reaches a `'vision-page'` job in the
 * first place (`extraction-runner.ts`, outside this bead's `owns`, enqueues
 * one only for a `'vision'`/`'both'` page — see `pptx.ts`'s own module doc).
 * **Turning a qualifying slide/region's several candidate images into ONE
 * call is now wired**, over `ol-egov.141.89.8.36`'s widened
 * `vision.extract.v2` request (`olea-service/src/tasks/visionExtract.ts`,
 * `{ images: [{ pageImageBase64, mimeType }, ...] }`, resolving the interface
 * gap this bead used to escalate rather than the client-side-composite path
 * — no DOM `canvas` needed after all). `sendOfficeFigureCueImages` (below)
 * re-derives `pptxFigureCue`/`docxFigureCue`'s own answer against the vault
 * bytes at drain time, bounds the result client-side against
 * `MAX_OFFICE_IMAGE_LIST_LENGTH`/`MAX_OFFICE_IMAGE_TOTAL_BYTES` (mirroring
 * the wire's own bounds, refusing rather than splitting or truncating over
 * either), and hands the ordered list to `readAndLandPage` exactly like a
 * standalone image or a rendered PDF page. See that function's own doc for
 * the three named, non-retryable refusals it can still return instead of a
 * call.
 *
 * **`[D-326]` producer provenance, wired from the wire's own stamp.** Every
 * `SuccessResponse` this file's transport receives already carries a
 * `stamp: { modelId, promptVersion, ... }` alongside `result`
 * (`olea-service/src/index.ts`) — `readVisionResult` now reads it, so
 * `VisionPageExtractResult.modelId`/`.promptVersion` are the ACTUAL model
 * and prompt version that produced THIS reading, never a locally-assumed
 * constant. `readAndLandPage` (below) turns every reading — `'complete'`,
 * `'partial'` and `'unreadable'` alike — into a manifest-entry value (this
 * bead exported `packages/core/src/ingestion/unit-manifest/types.ts`'s
 * shape from `olea-core`; `UnitProducerProvenance`, and — since this bead's
 * part 3 added the wire-vs-enum validation that made it safe
 * (`normalizeUnreadableReason`, below) — `UnitReadingState`/
 * `UnitManifestEntry` too, are now imported directly, with
 * `VisionUnitReadingState`/`VisionUnitManifestEntry` kept only as aliases —
 * see `VisionUnitReadingState`'s own doc for why) carrying that provenance
 * plus a digest of the image bytes sent, and hands it to
 * `deps.onManifestEntry` when one is supplied.
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
 *
 * **The `[D-300]`/`ol-egov.141.89.20` Writing-contract adapter's production
 * caller (`ol-egov.141.89.8.31`).** `readAndLandPage`'s two call sites
 * (`vision-page-runner.ts:857-858` for a failed call, `:878-879` for a
 * settled reading) call `writingOutcomeForFailure`/`writingOutcomeFor` —
 * which call `packages/core/src/stage-contract/adapters/vision-page.ts`'s
 * `writingFromVisionPageCallFailure`/`writingFromVisionPageExtract` —
 * unconditionally, the same real path composed into production above, so
 * that adapter is no longer "no caller yet, like every sibling adapter" (its
 * own module doc's previous words). `deps.onWritingOutcome` says only where
 * the resulting outcome goes, if anywhere; no host supplies one yet, so
 * nothing today persists or otherwise consumes it — a further, separate
 * step, reported rather than built here (see this bead's report). No
 * behaviour of the reading itself changes: the Worker request sent and the
 * `ExtractedUnit`s landed in `deps.sink` are exactly as before.
 */

import type {
  DocxFigureCueResult,
  EmbeddedInNote,
  EmbeddedRasterImage,
  ExtractedUnit,
  ExtractedUnitSink,
  JobRunner,
  JobRunnerView,
  JobRunOutcome,
  PptxFigureCueSlide,
  UnitManifestEntry,
  UnitProducerProvenance,
  UnitReadingState,
  UnitUnreadableReason,
  VaultPath,
  VaultSource,
  VisionPageCallFailure,
  VisionPageDraft,
  VisionPageSeamContext,
  WorkerTaskTransport,
  WritingOutcome,
} from 'olea-core';
import {
  docxFigureCue,
  isExtractionJobPayload,
  pptxFigureCue,
  stableUnitId,
  writingFromVisionPageCallFailure,
  writingFromVisionPageExtract,
} from 'olea-core';
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

/**
 * `null` for any of `embedded-image.ts`'s own raster media types
 * `vision.extract.v2` does not accept — see `SUPPORTED_VISION_MIME_TYPES`'s
 * doc. `EmbeddedRasterImage.mimeType` (`ol-egov.141.89.8.20`'s
 * `RASTER_EXTENSION_MIME`, `packages/core/src/extract/embedded-image.ts`)
 * recognises a wider raster vocabulary (`image/gif`, `image/bmp`,
 * `image/tiff`) than this task's three-format allow-list — a slide or
 * region whose *qualifying* image is one of those is a genuine, narrower
 * gap than the two named send-side bounds below, and is refused the same
 * "named, non-retryable, never a paid guess" way `mimeTypeFromPath`'s own
 * unsupported-extension case already is (see
 * `sendOfficeFigureCueImages`'s own doc).
 */
function supportedVisionMimeType(mimeType: string): SupportedVisionMimeType | null {
  return (SUPPORTED_VISION_MIME_TYPES as readonly string[]).includes(mimeType)
    ? (mimeType as SupportedVisionMimeType)
    : null;
}

/**
 * How many images an ordered list for one region may carry, checked
 * client-side before a request is even built — mirrors
 * `olea-service/src/tasks/visionExtract.ts`'s own
 * `MAX_VISION_IMAGE_LIST_LENGTH` (`ol-egov.141.89.8.36`), which enforces the
 * identical bound wire-side. Declared here rather than imported: the two
 * repos are separate deployments (this package cannot depend on
 * `olea-service`), so this is a deliberate, literal mirror — kept equal by a
 * pinning test (`vision-page-runner.spec.ts`), the same "declared, mirrored,
 * pinned by this file's own test" posture `VISION_EXTRACT_CONTRACT_VERSION`
 * above already takes for a cross-file constant this package cannot import.
 * Checking it here, before the wire call, is what lets a region over the
 * bound be refused with a **client-side** named reason instead of reaching
 * the Worker only to be refused there — see `sendOfficeFigureCueImages`'s
 * own doc for why refused, never split into more than one call.
 */
export const MAX_OFFICE_IMAGE_LIST_LENGTH = 20;

/**
 * Combined decoded-byte ceiling across one region's candidate images,
 * checked client-side before base64 is even built — mirrors
 * `olea-service/src/tasks/visionExtract.ts`'s own
 * `MAX_VISION_TOTAL_IMAGE_BYTES` (`ol-egov.141.89.8.36`). Same mirrored,
 * pinned, cross-repo-constant posture as `MAX_OFFICE_IMAGE_LIST_LENGTH`
 * above. Checked against each `EmbeddedRasterImage.bytes.length` — the
 * DECODED size — the same quantity the wire-side bound is checked against,
 * so a region that would pass here passes there too.
 */
export const MAX_OFFICE_IMAGE_TOTAL_BYTES = 24_000_000;

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

/** One image's wire payload — the shape a single-image request has always had, and the shape of every element of an ordered-list request (below). */
export interface VisionPageImage {
  readonly pageImageBase64: string;
  readonly mimeType: SupportedVisionMimeType;
}

/**
 * The request `VisionPageExtractPort.extract` takes — one image (the
 * pre-existing, byte-identical shape) OR an ordered list of images for one
 * region (`ol-egov.141.89.8.26`'s send wiring, over
 * `olea-service/src/tasks/visionExtract.ts`'s widened `vision.extract.v2`
 * request, `ol-egov.141.89.8.36`). `WorkerVisionPageExtractor.extract`
 * forwards this value as the wire payload UNCHANGED — the two shapes here
 * are, field for field, the two branches of that file's own
 * `visionExtractRequest` union, so no translation happens at the boundary
 * and a single-image request stays byte-identical to before this bead (see
 * that class's own doc).
 */
export type VisionPageExtractRequest =
  | VisionPageImage
  | { readonly images: readonly VisionPageImage[] };

/** Every image in a request, in order — a single-image request becomes a one-element list. Mirrors `olea-service/src/tasks/visionExtract.ts`'s own `resolveVisionImages`. */
function imagesOfRequest(request: VisionPageExtractRequest): readonly VisionPageImage[] {
  return 'images' in request ? request.images : [request];
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
    // `request` is forwarded verbatim as the payload — see
    // `VisionPageExtractRequest`'s own doc: its two shapes are, field for
    // field, `visionExtractRequest`'s two union branches
    // (`olea-service/src/tasks/visionExtract.ts`), so a single-image request
    // reaches the wire exactly as it always has, and an ordered-list request
    // reaches it exactly as `ol-egov.141.89.8.36` defined it.
    const body = await this.transport.send({
      contractVersion: VISION_EXTRACT_CONTRACT_VERSION,
      taskId: VISION_EXTRACT_V2_TASK_ID,
      payload: request,
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
 * `packages/core/src/ingestion/unit-manifest/types.ts`'s
 * `UnitProducerProvenance`, re-exported under this file's established name
 * — this bead (`ol-egov.141.89.8.4`) added the export lines
 * (`packages/core/src/index.ts`) that make the direct import possible, so
 * this is no longer a hand-mirrored shape: a real divergence from core's
 * type is now a compile error here, not a silent drift risk. Kept as a type
 * alias, not a bare re-export of the name, so nothing downstream that
 * already spells `VisionUnitProducerProvenance` needs to change.
 */
export type VisionUnitProducerProvenance = UnitProducerProvenance;

/**
 * Now core's real `UnitReadingState` union, not a local mirror — part 3 of
 * this bead (`ol-egov.141.89.8.4`) resolved the one reason the earlier swap
 * (`VisionUnitProducerProvenance`, above) did not extend here: `'unreadable'`
 * .reason is core's closed `UnitUnreadableReason` enum
 * (`'blank-page'`/`'not-legible'`/`'no-text-on-page'`), and this file used
 * to read `result.unreadableReason` off the wire as an unvalidated
 * `string | null` and pass it straight through — an out-of-catalogue string
 * the Worker should never send but this file could not actually rule out.
 * `normalizeUnreadableReason` (below) is that missing check: a value outside
 * the three catalogue entries now maps to the same safe declared default
 * `null` already used, and is counted via `deps.onUnknownUnreadableReason`,
 * never passed through. With that guard in place, the type this runner
 * builds is honestly core's own — this alias exists only so nothing
 * downstream that already spells `VisionUnitReadingState` needs to change
 * (same reasoning `VisionUnitProducerProvenance`'s doc gives). This runner
 * still only ever reaches three of the six `UnitReadingState` kinds
 * (`'read'`/`'partial'`/`'unreadable'` — never `'pending'`/`'unavailable'`/
 * `'failed'`, which belong to the job-runner's `JobRunOutcome` side, not a
 * settled reading); a TypeScript union assignment accepts that narrower
 * shape without complaint, so no further narrowing is declared here.
 */
export type VisionUnitReadingState = UnitReadingState;

/**
 * Now core's real `UnitManifestEntry`, for the same reason
 * `VisionUnitReadingState`'s own doc gives. Always
 * `conceptExtractionState: 'not-started'`: this file only ever produces a
 * freshly-read entry, never one concept extraction has already run over —
 * kept as its own named alias here so `deps.onManifestEntry`'s signature
 * keeps reading `VisionUnitManifestEntry`.
 */
export type VisionUnitManifestEntry = UnitManifestEntry;

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

/**
 * `[D-326]`'s `imageDigest` for a request that may carry SEVERAL images
 * (`ol-egov.141.89.8.26`'s send wiring) — `UnitProducerProvenance.imageDigest`
 * (`packages/core/src/ingestion/unit-manifest/types.ts`, outside this bead's
 * `owns`) is a single string, so this stays a single digest rather than
 * widening that persisted shape, which would be exactly the kind of
 * persisted-shape call this file's own module doc already declines to make
 * unilaterally. For a ONE-image request this is byte-identical to
 * `hashImagePayload(image.pageImageBase64)` — `Array.prototype.join` inserts
 * no separator around a single element, so this bead changes no existing
 * manifest entry's digest. For two or more, every image's base64 is joined
 * with `'\n'` (never a legal base64 character, so no ambiguity between "one
 * image ending in the bytes that spell `\n`" and "a boundary") before
 * hashing, in the SAME order they were sent — the digest is therefore
 * sensitive to both content and order, matching the ordered-list request's
 * own contract.
 */
async function hashRequestPayload(request: VisionPageExtractRequest): Promise<string> {
  const joined = imagesOfRequest(request)
    .map((image) => image.pageImageBase64)
    .join('\n');
  return hashImagePayload(joined);
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
   * honest, named, non-retryable gap for a `'pdf'` page. PPTX and DOCX never
   * need this port at all — they send their own embedded raster images
   * instead (`sendOfficeFigureCueImages`, the module doc's "PPTX and DOCX,
   * sent" section), regardless of whether this is supplied.
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
  /**
   * Called with no argument, once per reading, whenever the wire's own
   * `unreadableReason` was a non-null string outside core's closed
   * three-value `UnitUnreadableReason` enum — see
   * `normalizeUnreadableReason`'s own doc for why that case exists and what
   * it maps to instead. **Absent by default: this file counts nothing
   * itself** (D-005 — no logging), same "a host that wants one supplies
   * one" posture `onManifestEntry` already takes.
   */
  readonly onUnknownUnreadableReason?: () => void;
  /**
   * The Writing-contract outcome for this reading
   * (`packages/core/src/stage-contract/adapters/vision-page.ts`,
   * `ol-egov.141.89.20`) — `writingFromVisionPageExtract`/
   * `writingFromVisionPageCallFailure`, called from this runner's own real
   * path (`writingOutcomeFor`/`writingOutcomeForFailure`, below)
   * **unconditionally, on every real reading this runner makes**, whether or
   * not this is supplied (see those functions' own doc for why: that is what
   * makes the call itself a production caller, `ol-egov.141.89.8.31`,
   * distinct from `onManifestEntry`'s "absent by default, pays nothing when
   * unwired" posture directly above). **No host consumes or persists the
   * outcome yet** — this file does neither itself; a consumer is a further,
   * separate step (see this bead's report).
   */
  readonly onWritingOutcome?: (outcome: WritingOutcome<VisionPageDraft>) => void;
}

/**
 * Core's `UnitUnreadableReason` is type-only and carries no runtime value to
 * check membership against, so its three closed values are mirrored here as
 * a plain array — the one place this file validates against them.
 */
const UNIT_UNREADABLE_REASONS: readonly UnitUnreadableReason[] = [
  'blank-page',
  'not-legible',
  'no-text-on-page',
];

/**
 * Validates the wire's own `unreadableReason` against core's closed
 * three-value `UnitUnreadableReason` enum before it becomes a
 * `UnitReadingState`'s `reason` field (`ol-egov.141.89.8.4` part 3,
 * resolving the gap `VisionUnitReadingState`'s own doc named). `null` (the
 * pre-existing, honest "the model/guard named no reason" case) is not
 * treated as unknown — it already maps to the same declared default and is
 * not counted. A non-null string outside the three catalogue values — a
 * wire/service drift this client cannot rule out but must never trust
 * blindly — maps to that SAME safe default and is counted via
 * `deps.onUnknownUnreadableReason`, but is never itself passed through as
 * though it were one of the three a manifest consumer switches on.
 */
function normalizeUnreadableReason(
  wireReason: string | null,
  deps: WorkerVisionPageRunnerDeps,
): UnitUnreadableReason {
  if (wireReason === null) return 'not-legible';
  if ((UNIT_UNREADABLE_REASONS as readonly string[]).includes(wireReason)) {
    return wireReason as UnitUnreadableReason;
  }
  deps.onUnknownUnreadableReason?.();
  return 'not-legible';
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
  request: VisionPageExtractRequest,
  result: VisionPageExtractResult,
): Promise<void> {
  if (!deps.onManifestEntry) return;

  const provenance: VisionUnitProducerProvenance = {
    task: VISION_EXTRACT_V2_TASK_ID,
    promptVersion: result.promptVersion ?? UNREPORTED_PROVENANCE_FIELD,
    modelIdentity: result.modelId ?? UNREPORTED_PROVENANCE_FIELD,
    imageDigest: await hashRequestPayload(request),
  };

  const readingState: VisionUnitReadingState =
    result.outcome === 'unreadable'
      ? {
          kind: 'unreadable',
          reason: normalizeUnreadableReason(result.unreadableReason, deps),
          provenance,
        }
      : result.outcome === 'partial'
        ? {
            kind: 'partial',
            method: 'image',
            coverage: result.coverage ?? COVERAGE_NOT_STATED_FALLBACK,
            provenance,
          }
        : { kind: 'read', method: 'image', provenance };

  deps.onManifestEntry({
    unitId: stableUnitId(sourcePath, page),
    sourcePath,
    page,
    readingState,
    conceptExtractionState: 'not-started',
  });
}

/**
 * `vision.extract.v2` has no fallback seat wired (no second model sits
 * behind it for an undecided/unavailable case) — every Writing outcome this
 * runner produces is from the one, `'candidate'`, seat. A declared constant,
 * not derived, for the same reason `VISION_EXTRACT_V2_TASK_ID` is.
 */
const VISION_PAGE_WRITING_SEAT: VisionPageSeamContext['seat'] = 'candidate';

/**
 * The `[D-300]`/`ol-egov.141.89.20` Writing-contract context for one reading
 * or one failed call: the image(s) actually sent are the only evidence this
 * seam reads. `evidenceDigests` carries one digest per image, in order — for
 * a single-image request this is byte-identical to before this bead (one
 * element, `hashImagePayload` on that one image's own base64); an
 * ordered-list request (`ol-egov.141.89.8.26`'s send wiring) gets one entry
 * per image rather than `hashRequestPayload`'s single joined digest, since
 * `evidenceDigests` is already an array field
 * (`packages/core/src/stage-contract/provenance.ts`) built for exactly this.
 */
async function visionPageWritingContext(
  request: VisionPageExtractRequest,
): Promise<VisionPageSeamContext> {
  const digests = await Promise.all(
    imagesOfRequest(request).map((image) => hashImagePayload(image.pageImageBase64)),
  );
  return {
    seat: VISION_PAGE_WRITING_SEAT,
    taskId: VISION_EXTRACT_V2_TASK_ID,
    evidenceDigests: digests,
  };
}

/**
 * The Writing outcome for one settled reading — `writingFromVisionPageExtract`
 * (`packages/core/src/stage-contract/adapters/vision-page.ts`), called
 * unconditionally from `readAndLandPage`, below, for every `'complete'`,
 * `'partial'` and `'unreadable'` result alike (`ol-egov.141.89.8.31`, giving
 * that adapter its production caller — see its own module doc). Never gated
 * behind `deps.onWritingOutcome`: that field only says where the resulting
 * outcome goes, not whether the adapter runs.
 */
async function writingOutcomeFor(
  request: VisionPageExtractRequest,
  result: VisionPageExtractResult,
): Promise<WritingOutcome<VisionPageDraft>> {
  return writingFromVisionPageExtract(result, await visionPageWritingContext(request));
}

/**
 * The Writing outcome for a call that never reached a settled result —
 * `writingFromVisionPageCallFailure`'s arm, same unconditional-call posture
 * as `writingOutcomeFor` above. Reads `error` the same way
 * `isUnavailableVisionFailure` already does to tell a raw transport failure
 * (`reachedWorker: false`) from a well-formed Worker refusal
 * (`reachedWorker: true`, carrying the Worker's own `code`).
 */
async function writingOutcomeForFailure(
  request: VisionPageExtractRequest,
  error: unknown,
): Promise<WritingOutcome<VisionPageDraft>> {
  const failure: VisionPageCallFailure =
    error instanceof WorkerVisionPageExtractorError
      ? { reachedWorker: true, ...(error.code !== undefined ? { code: error.code } : {}) }
      : { reachedWorker: false };
  return writingFromVisionPageCallFailure(failure, await visionPageWritingContext(request));
}

/**
 * Sends one already-obtained request (a single standalone-image/rendered-PDF
 * image, or — since `ol-egov.141.89.8.26`'s send wiring — an ordered list of
 * a PPTX/DOCX region's qualifying images) to `vision.extract.v2` and lands
 * whatever comes back — the one place every caller turns a
 * `VisionPageExtractResult` into a `JobRunOutcome`, so the image-file path,
 * the PDF-render path and the office-image path (below) cannot drift apart
 * on how a `'complete'`/`'partial'`/`'unreadable'` reading is handled. Also
 * the one place that builds this reading's `[D-326]` manifest entry
 * (`emitManifestEntry`, above) — every outcome that reaches this far
 * (`'complete'`, `'partial'`, `'unreadable'`) gets one, even when it lands
 * zero `ExtractedUnit`s (a figure-only or unreadable page is still a
 * completed reading, and `[D-326]`'s record exists precisely to say so).
 * Also, since `ol-egov.141.89.8.31`, the one place that produces this
 * reading's Writing-contract outcome
 * (`writingOutcomeFor`/`writingOutcomeForFailure`, above) — unconditionally,
 * on every branch, before `deps.onWritingOutcome` (if any) is told about it.
 */
async function readAndLandPage(
  deps: WorkerVisionPageRunnerDeps,
  job: JobRunnerView,
  request: VisionPageExtractRequest,
  sourcePath: VaultPath,
  page: number,
  embeddedIn: EmbeddedInNote | undefined,
): Promise<JobRunOutcome> {
  let result: VisionPageExtractResult;
  try {
    result = await deps.extractor.extract(request);
  } catch (error) {
    // Computed unconditionally — not `deps.onWritingOutcome?.(await
    // writingOutcomeForFailure(...))`, which would never evaluate the
    // adapter call at all when no consumer is wired (optional-call argument
    // short-circuiting) and so would not be a real production caller.
    const writingOutcome = await writingOutcomeForFailure(request, error);
    deps.onWritingOutcome?.(writingOutcome);
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

  await emitManifestEntry(deps, sourcePath, page, request, result);
  // Same "computed first, handed off second" shape as the catch block above,
  // for the same reason.
  const writingOutcome = await writingOutcomeFor(request, result);
  deps.onWritingOutcome?.(writingOutcome);

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
      { pageImageBase64: dataUrlBase64(rendered.dataUrl), mimeType: rendered.mimeType },
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

/**
 * The candidate images for one PPTX slide or DOCX region — re-derives
 * `pptxFigureCue`/`docxFigureCue`'s own answer against the vault bytes read
 * at DRAIN time (not the bytes the extraction pass that enqueued this job
 * saw — see `pptx.ts`'s own module doc for why that is a third, independent
 * re-derivation, the same "separate sibling" duplication this format's
 * extractors already accept elsewhere). `[]` when the format/page combination
 * has nothing (a DOCX page other than `1` — this format has exactly one
 * logical region — or a slide/region `pptxFigureCue`/`docxFigureCue` itself
 * says does not qualify).
 */
function officeFigureCueImages(
  format: 'pptx' | 'docx',
  sourcePath: VaultPath,
  bytes: Uint8Array,
  page: number,
): readonly EmbeddedRasterImage[] {
  if (format === 'docx') {
    if (page !== 1) return [];
    const cue: DocxFigureCueResult = docxFigureCue({ path: sourcePath, bytes });
    return cue.qualifies ? cue.images : [];
  }
  const slides: readonly PptxFigureCueSlide[] = pptxFigureCue({ path: sourcePath, bytes });
  const slide = slides.find((s) => s.page === page);
  return slide?.qualifies ? slide.images : [];
}

/**
 * `ol-egov.141.89.8.26`'s send wiring: a PPTX slide or DOCX region whose
 * embedded images qualify (`pptxFigureCue`/`docxFigureCue`, the Class B
 * combine policy the orchestrator self-ratified 2026-09-27, citing
 * `findings/office-image-selection.md`) sent as ONE `vision.extract.v2` call
 * carrying that region's qualifying images, in order — `ol-egov.141.89.8.36`'s
 * widened request accepts exactly this shape.
 *
 * **Three named, non-retryable refusals, each stated here rather than left
 * to silently truncate or guess** — mirroring this file's own DF-21 posture
 * for every other named gap:
 *  1. **No qualifying images at all.** Either the format/page has none
 *     (`officeFigureCueImages` above), or every candidate a fresh
 *     `pptxFigureCue`/`docxFigureCue` call names is one this job never
 *     needed sent — nothing to call the Worker with. Distinct from every
 *     `sendOfficeFigureCueImages` caller: `deps.extractor` is never touched.
 *  2. **An unsupported raster mime type.** `EmbeddedRasterImage.mimeType`
 *     (`embedded-image.ts`'s own `RASTER_EXTENSION_MIME`) recognises
 *     `image/gif`/`image/bmp`/`image/tiff` alongside the three
 *     `vision.extract.v2` accepts — see `supportedVisionMimeType`'s own doc.
 *     A single unsupported image in an otherwise-qualifying region refuses
 *     the WHOLE call rather than silently dropping just that one image,
 *     which would silently change what the combine policy's own area sum
 *     computed and sent.
 *  3. **Over either named bound**
 *     (`MAX_OFFICE_IMAGE_LIST_LENGTH`/`MAX_OFFICE_IMAGE_TOTAL_BYTES`).
 *     **Refused, never split into more than one call.** A region this large
 *     is, by both bounds' own declared provenance, far outside the one real
 *     deck `findings/office-image-selection.md` measured (headroom of
 *     >5x/~4x that census's own qualifying-slide average) — genuinely rare,
 *     not a routine case this cue exists to serve. Splitting would need a
 *     second, independent Class B call this bead does not make unilaterally:
 *     how to merge several partial readings' `extractedText`/
 *     `figureDescription`/`coverage` into one region's answer, with what
 *     provenance/manifest-entry shape (`[D-326]`'s `imageDigest` is a single
 *     string; `readAndLandPage` lands at most one `ExtractedUnit` per page).
 *     Refusing is the same "named, honest gap, never guessed" answer this
 *     file already gives an unsupported image extension or a missing PDF
 *     renderer, and needs none of those unresolved merge questions.
 */
async function sendOfficeFigureCueImages(
  deps: WorkerVisionPageRunnerDeps,
  job: JobRunnerView,
  format: 'pptx' | 'docx',
  sourcePath: VaultPath,
  page: number,
  embeddedIn: EmbeddedInNote | undefined,
): Promise<JobRunOutcome> {
  let bytes: Uint8Array;
  try {
    bytes = await deps.vault.readBinary(sourcePath);
  } catch {
    // The ordinary transient-environment shape every other vault read in
    // this file gets.
    return { ok: false, retryable: true };
  }

  const images = officeFigureCueImages(format, sourcePath, bytes, page);
  if (images.length === 0) {
    return {
      ok: false,
      retryable: false,
      reason:
        `WorkerVisionPageRunner: job ${job.contentHash} is a '${format}' page whose embedded ` +
        'images do not clear the D-324 combine-cue floor (or it has none) — nothing qualifying ' +
        'to send to vision.extract.v2.',
    };
  }

  if (images.length > MAX_OFFICE_IMAGE_LIST_LENGTH) {
    return {
      ok: false,
      retryable: false,
      reason:
        `WorkerVisionPageRunner: job ${job.contentHash} names ${images.length} qualifying ` +
        `images, over the declared MAX_OFFICE_IMAGE_LIST_LENGTH (${MAX_OFFICE_IMAGE_LIST_LENGTH}) ` +
        '— refused, never truncated to the first N images.',
    };
  }

  const totalBytes = images.reduce((sum, image) => sum + image.bytes.length, 0);
  if (totalBytes > MAX_OFFICE_IMAGE_TOTAL_BYTES) {
    return {
      ok: false,
      retryable: false,
      reason:
        `WorkerVisionPageRunner: job ${job.contentHash}'s qualifying images total ${totalBytes} ` +
        `decoded bytes, over the declared MAX_OFFICE_IMAGE_TOTAL_BYTES (${MAX_OFFICE_IMAGE_TOTAL_BYTES}) ` +
        '— refused, never truncated to fewer images or fewer bytes.',
    };
  }

  const wireImages: VisionPageImage[] = [];
  for (const image of images) {
    const mimeType = supportedVisionMimeType(image.mimeType);
    if (mimeType === null) {
      return {
        ok: false,
        retryable: false,
        reason:
          `WorkerVisionPageRunner: job ${job.contentHash} has a qualifying image of mime type ` +
          `'${image.mimeType}', which vision.extract.v2 does not accept (only ` +
          `${SUPPORTED_VISION_MIME_TYPES.join('/')}) — refused, never a paid guess, and never ` +
          'sent with just that one image silently dropped from the combine.',
      };
    }
    wireImages.push({ pageImageBase64: bytesToBase64(image.bytes), mimeType });
  }

  // Single-image byte-identity (`ol-egov.141.89.8.36`'s own acceptance
  // criterion): a region with exactly one qualifying image sends the plain
  // single-image shape, not a one-element `images` list.
  const firstImage = wireImages[0];
  const request: VisionPageExtractRequest =
    wireImages.length === 1 && firstImage !== undefined ? firstImage : { images: wireImages };

  return readAndLandPage(deps, job, request, sourcePath, page, embeddedIn);
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
      if (format === 'pptx' || format === 'docx') {
        // `ol-egov.141.89.8.26`'s send wiring — see
        // `sendOfficeFigureCueImages`'s own doc for the three named refusals
        // it can still return instead of a call.
        return sendOfficeFigureCueImages(deps, job, format, sourcePath, page, embeddedIn);
      }
      // A PDF page with no pageRenderer wired needs a rendered page image
      // this runner does not have a way to obtain without one. Named,
      // non-retryable gap — never silently doing nothing, never crashing.
      return {
        ok: false,
        retryable: false,
        reason:
          `WorkerVisionPageRunner: job ${job.contentHash} needs a rendered page image for a ` +
          `'${format}' document, and no page renderer is wired for it in this run (ol-9cle's ` +
          "renderer exists for 'pdf') — only standalone image sources (format 'image') and " +
          "'pptx'/'docx' regions (via the D-324 combine cue) are unconditionally wired today.",
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

    return readAndLandPage(
      deps,
      job,
      { pageImageBase64: bytesToBase64(bytes), mimeType },
      sourcePath,
      page,
      embeddedIn,
    );
  };
}
