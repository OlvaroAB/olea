/**
 * `createWorkerVisionPageRunner` — the production `visionRunner` DF-21
 * reserved (`ExtractionRunnerDeps.visionRunner`, `packages/core/src/ingestion
 * /extraction-runner.ts`'s `runVisionPageJob`), for the one slice this bead
 * (`ol-15f8`, discovered from `ol-2zfj.121`) scopes: a **standalone image
 * source** (C3.1/C3.3 — a screenshot, an exported diagram, a photographed
 * page) whose `format` is `'image'`. For that format the page IS the file —
 * `vault.readBinary(sourcePath)` already gives the exact bytes `vision
 * .extract.v1` needs, no rendering step required (`image.ts`'s own doc: an
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
 * **Pattern.** Mirrors `retrieval/workerGroundingJudge.ts` /
 * `concept/workerConceptReader.ts`: a one-method `VisionPageExtractPort`
 * (the actual seam a fake stands in for in tests) implemented by
 * `WorkerVisionPageExtractor`, a thin class that turns a request into
 * `vision.extract.v1`'s frozen envelope, sends it through an injected
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
 * back `readable: false`: that produces zero units, exactly the shape
 * `extractResolvedSource` already gives a furniture-only/empty page, never a
 * fabricated concept.
 *
 * **DF-21, "error → non-retryable".** Anything wrong with the
 * `vision.extract.v1` call itself — a malformed body, a refusal, a
 * transport-level failure reaching it — is reported `ok: false, retryable:
 * false`. A page that could not be served this way will not be served
 * differently on a retry: the bytes and the request are identical every
 * time. (A local `vault.readBinary` failure is treated differently —
 * `retryable: true` — because that is the ordinary transient-environment
 * shape `extraction-runner.ts`'s own catch-all already gives every other
 * vault read failure.)
 *
 * **D-005.** Nothing here logs. No page bytes, no `sourcePath`, no
 * `job.label` (a vault-relative path or lecture title — content-adjacent,
 * same posture `ingestion/materiality/workerJudge.ts`'s module doc states
 * for a note path) ever appears in a thrown error's message or a
 * `JobRunOutcome.reason` string — every message below names `job.contentHash`
 * (an opaque hash) or a structural fact (a format, an extension class),
 * never an identifier that names her material.
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
 * See that module's own doc for the one gap this bead does not close: `main
 * .ts`'s real `buildIngestionRunner` call does not yet supply the `vision`
 * field that would turn this on in production — a named follow-up, not a
 * silent gap (D-072 clause 5's escape hatch).
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

/** `TASK_IDS.VISION_EXTRACT`, mirrored — see the module doc. Pinned by `vision-page-runner.spec.ts`. */
export const VISION_EXTRACT_TASK_ID = 'vision.extract.v1';

/** `CONTRACT_VERSION`, mirrored on the same terms and pinned by the same test. */
export const VISION_EXTRACT_CONTRACT_VERSION = 2;

/**
 * The three raster formats `vision.extract.v1` accepts
 * (`olea-service/src/tasks/visionExtract.ts`'s `SUPPORTED_VISION_MIME_TYPES`
 * — private, mirrored here as a declared client-side constant, not derived:
 * the mapping "a `.png` file is `image/png`" needs no measurement). Deliberately
 * narrower than `packages/core/src/extract/registry.ts`'s `IMAGE_EXTENSIONS`
 * (which also treats `.gif`/`.bmp`/`.tif`/`.tiff`/`.heic`/`.heif` as
 * `format: 'image'` for routing purposes) — a standalone image in one of
 * those wider formats still routes to a `'vision-page'` job, and this runner
 * reports it as the honest, named, non-retryable gap below rather than
 * guessing at an unsupported mime type.
 */
export const SUPPORTED_VISION_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type SupportedVisionMimeType = (typeof SUPPORTED_VISION_MIME_TYPES)[number];

const MIME_TYPE_BY_EXTENSION: Readonly<Record<string, SupportedVisionMimeType>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** `null` for any extension `vision.extract.v1` does not accept — see `SUPPORTED_VISION_MIME_TYPES`'s doc. */
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

/**
 * `unreadableReason` is carried through for parity with the wire shape and
 * future observability, but nothing in this file logs it or any other field
 * here — see the module doc's D-005 note. It is a closed, small, categorical
 * label (`'blank-page' | 'not-legible' | 'no-text-on-page'`), never the
 * page's own text.
 */
export interface VisionPageExtractResult {
  readonly readable: boolean;
  readonly extractedText: string;
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
      taskId: VISION_EXTRACT_TASK_ID,
      payload: { pageImageBase64: request.pageImageBase64, mimeType: request.mimeType },
    });
    return readVisionResult(body);
  }
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

  const readable = r['readable'];
  if (typeof readable !== 'boolean') {
    throw new WorkerVisionPageExtractorError(
      'WorkerVisionPageExtractor: the Worker response carried no boolean `readable`.',
    );
  }
  const extractedText = r['extractedText'];
  if (typeof extractedText !== 'string') {
    throw new WorkerVisionPageExtractorError(
      'WorkerVisionPageExtractor: the Worker response carried no string `extractedText`.',
    );
  }
  const unreadableReason = r['unreadableReason'];
  if (unreadableReason !== null && typeof unreadableReason !== 'string') {
    throw new WorkerVisionPageExtractorError(
      'WorkerVisionPageExtractor: the Worker response carried a non-null, non-string `unreadableReason`.',
    );
  }

  return { readable, extractedText, unreadableReason };
}

export interface WorkerVisionPageRunnerDeps {
  readonly vault: VaultSource;
  readonly extractor: VisionPageExtractPort;
  readonly sink: ExtractedUnitSink;
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
          'vision.extract.v1 does not accept — only .png/.jpg/.jpeg/.webp are wired.',
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
    } catch {
      // DF-21: whatever went wrong reaching vision.extract.v1 (a malformed
      // body, a refusal, a transport failure) will reach the identical
      // conclusion on the identical bytes — retrying buys nothing.
      return {
        ok: false,
        retryable: false,
        reason: `WorkerVisionPageRunner: vision.extract.v1 could not serve job ${job.contentHash}.`,
      };
    }

    if (!result.readable || result.extractedText.length === 0) {
      // INV-5 / honest-failure: zero units, not an error — the same shape
      // `extractResolvedSource` already gives a furniture-only/empty page.
      // Never fabricates a concept out of a refusal.
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
