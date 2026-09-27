/**
 * `vision-page-runner.ts` tests (`ol-15f8`, migrated to `vision.extract.v2`
 * by `ol-egov.141.89.8.18` — `[D-325]`, `ol-egov.141.89.8.7`) — see
 * `features/F3-learn-from-anything.md`'s "Standalone image reaches
 * vision.extract" scenarios, which this file's `describe`/`it` names are
 * written to satisfy directly.
 *
 * Two layers, tested separately, mirroring `workerGroundingJudge.spec.ts` /
 * `workerConceptReader.spec.ts`'s own split:
 *  - `WorkerVisionPageExtractor` — the pure request/response adapter over a
 *    fake `WorkerTaskTransport`, no vault, no job shape.
 *  - `createWorkerVisionPageRunner` — the `JobRunner`, tested against a fake
 *    `VaultSource`/`VisionPageExtractPort`/`ExtractedUnitSink`, never a real
 *    network call and no `obsidian` import anywhere in this file (INV-1).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TASK_IDS } from 'olea-contracts';
import type {
  DocxFigureCueResult,
  EmbeddedRasterImage,
  ExtractedUnit,
  JobRunnerView,
  ListOptions,
  PptxFigureCueSlide,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
  VisionPageDraft,
  WorkerTaskRequest,
  WritingOutcome,
} from 'olea-core';
import { docxFigureCue, pptxFigureCue } from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageRenderError } from '../../src/ingestion/page-render/errors.js';
import type {
  PageRenderPort,
  PdfPageRenderRequest,
  RenderedPage,
} from '../../src/ingestion/page-render/types.js';
import {
  bytesToBase64,
  createWorkerVisionPageRunner,
  MAX_OFFICE_IMAGE_LIST_LENGTH,
  MAX_OFFICE_IMAGE_TOTAL_BYTES,
  PDF_PAGE_RENDER_SCALE,
  VISION_EXTRACT_CONTRACT_VERSION,
  VISION_EXTRACT_V2_TASK_ID,
  type VisionPageExtractPort,
  type VisionPageExtractRequest,
  type VisionPageExtractResult,
  type VisionUnitManifestEntry,
  WorkerVisionPageExtractor,
  WorkerVisionPageExtractorError,
} from '../../src/ingestion/vision-page-runner.js';

/**
 * `pptxFigureCue`/`docxFigureCue` (`ol-egov.141.89.8.26`'s D-324 combine cue)
 * are mocked here, not exercised against a real OOXML zip — `packages/core`
 * (which owns `fflate`) already tests their own logic exhaustively
 * (`pptx.spec.ts`/`docx.spec.ts`); `packages/plugin` does not depend on
 * `fflate` at all, and adding it just to rebuild a zip fixture a second time
 * in a different package would test the same logic twice while testing this
 * file's actual job — does the RUNNER call the cue correctly, respect
 * `qualifies`, bound the result, and build the right wire request — less
 * directly. `vitest` hoists this call above every import in the file
 * (including the `docxFigureCue`/`pptxFigureCue` import above), so the
 * runner's own `import { docxFigureCue, pptxFigureCue } from 'olea-core'`
 * (`vision-page-runner.ts`) resolves to these same mocks. `importOriginal`
 * keeps every other `olea-core` export (`isExtractionJobPayload`,
 * `stableUnitId`, the Writing-contract adapters) real; only the two cue
 * functions are replaced.
 */
vi.mock('olea-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('olea-core')>();
  return { ...actual, pptxFigureCue: vi.fn(), docxFigureCue: vi.fn() };
});

/** Records what was sent and answers with whatever the test scripted — same shape `workerGroundingJudge.spec.ts` uses. */
class RecordingTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

/** A transport whose `send` itself fails — a raw transport/outage failure, never a well-formed Worker response. */
class FailingTransport {
  constructor(private readonly error: Error) {}
  async send(_request: WorkerTaskRequest): Promise<unknown> {
    throw this.error;
  }
}

function okResponse(result: unknown) {
  return { ok: true, stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'm' }, result };
}

/** A `vision.extract.v2` `'complete'` result with no figure and no reason — the common case. */
function completeResult(extractedText: string): VisionPageExtractResult {
  return {
    outcome: 'complete',
    extractedText,
    figureDescription: null,
    coverage: null,
    unreadableReason: null,
  };
}

// A tiny, real PNG signature followed by junk IHDR bytes — enough to be
// non-empty raw bytes for base64 round-tripping; this file never asserts
// anything about pixel content.
const FAKE_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
]);

describe('WorkerVisionPageExtractor — the frozen vocabulary it mirrors', () => {
  it('sends the task id the frozen catalogue reserves for vision.extract.v2 (D-325)', () => {
    expect(VISION_EXTRACT_V2_TASK_ID).toBe(TASK_IDS.VISION_EXTRACT_V2);
  });

  it('sends the current contract version (unchanged by the v1 -> v2 task-shape migration)', () => {
    expect(VISION_EXTRACT_CONTRACT_VERSION).toBe(2);
  });
});

describe('WorkerVisionPageExtractor — the request it builds', () => {
  it('sends exactly pageImageBase64 and mimeType, field for field with the service request shape', async () => {
    const transport = new RecordingTransport(() => okResponse(completeResult('a page of text')));
    const extractor = new WorkerVisionPageExtractor({ transport });

    await extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' });

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe('vision.extract.v2');
    expect(request?.contractVersion).toBe(2);
    expect(request?.payload).toEqual({ pageImageBase64: 'QUJD', mimeType: 'image/png' });
  });
});

describe('WorkerVisionPageExtractor — the response it reads', () => {
  it('returns outcome/extractedText/figureDescription/coverage/unreadableReason field for field on a complete page', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        outcome: 'complete',
        extractedText: 'Stratigraphic succession',
        figureDescription: null,
        coverage: null,
        unreadableReason: null,
      }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    const result = await extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' });

    expect(result).toEqual({
      outcome: 'complete',
      extractedText: 'Stratigraphic succession',
      figureDescription: null,
      coverage: null,
      unreadableReason: null,
      modelId: 'm',
      promptVersion: '1.0.0',
    });
  });

  it('carries a non-null figureDescription through untouched, field for field', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        outcome: 'complete',
        extractedText: '',
        figureDescription: 'A labelled diagram of the rock cycle, arrows between three states.',
        coverage: null,
        unreadableReason: null,
      }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    const result = await extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' });

    expect(result.figureDescription).toBe(
      'A labelled diagram of the rock cycle, arrows between three states.',
    );
  });

  it("carries a partial reading's coverage through untouched", async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        outcome: 'partial',
        extractedText: 'the top half of the page',
        figureDescription: null,
        coverage: 'the top half of the page',
        unreadableReason: null,
      }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    const result = await extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' });

    expect(result.outcome).toBe('partial');
    expect(result.coverage).toBe('the top half of the page');
  });

  it("returns an unreadable outcome just as faithfully — INV-5's honest refusal, not an error", async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        outcome: 'unreadable',
        extractedText: '',
        figureDescription: null,
        coverage: null,
        unreadableReason: 'blank-page',
      }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    const result = await extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' });

    expect(result).toEqual({
      outcome: 'unreadable',
      extractedText: '',
      figureDescription: null,
      coverage: null,
      unreadableReason: 'blank-page',
      modelId: 'm',
      promptVersion: '1.0.0',
    });
  });
});

describe('WorkerVisionPageExtractor — refuses to hand back an unusable shape, so the runner can fail closed', () => {
  it('throws when the response body is not an object', async () => {
    const transport = new RecordingTransport(() => 'not an object');
    const extractor = new WorkerVisionPageExtractor({ transport });

    await expect(
      extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
    ).rejects.toThrow(WorkerVisionPageExtractorError);
  });

  it('throws when the response carries no `ok` discriminant', async () => {
    const transport = new RecordingTransport(() => ({ result: { outcome: 'complete' } }));
    const extractor = new WorkerVisionPageExtractor({ transport });

    await expect(
      extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
    ).rejects.toThrow(WorkerVisionPageExtractorError);
  });

  it('throws WorkerVisionPageExtractorError (carrying the Worker code) on an ok:false refusal', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'upstream-error',
      message: 'The model call failed.',
    }));
    const extractor = new WorkerVisionPageExtractor({ transport });

    try {
      await extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerVisionPageExtractorError);
      expect((error as WorkerVisionPageExtractorError).code).toBe('upstream-error');
    }
  });

  it('throws when result.outcome is missing or not one of the three named outcomes', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        outcome: 'readable',
        extractedText: '',
        figureDescription: null,
        coverage: null,
        unreadableReason: null,
      }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    await expect(
      extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
    ).rejects.toThrow(WorkerVisionPageExtractorError);
  });

  it('throws when result.extractedText is missing or not a string', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        outcome: 'complete',
        figureDescription: null,
        coverage: null,
        unreadableReason: null,
      }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    await expect(
      extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
    ).rejects.toThrow(WorkerVisionPageExtractorError);
  });

  it.each(['figureDescription', 'coverage', 'unreadableReason'] as const)(
    'throws when result.%s is present but neither null nor a string',
    async (field) => {
      const transport = new RecordingTransport(() =>
        okResponse({
          outcome: 'complete',
          extractedText: '',
          figureDescription: null,
          coverage: null,
          unreadableReason: null,
          [field]: 42,
        }),
      );
      const extractor = new WorkerVisionPageExtractor({ transport });

      await expect(
        extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
      ).rejects.toThrow(WorkerVisionPageExtractorError);
    },
  );

  it('throws when the response carries no `stamp` object — [D-326] producer provenance', async () => {
    const transport = new RecordingTransport(() => ({
      ok: true,
      result: completeResult('x'),
    }));
    const extractor = new WorkerVisionPageExtractor({ transport });

    await expect(
      extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
    ).rejects.toThrow(/no `stamp` object/);
  });

  it('throws when `stamp.modelId` is missing or not a string', async () => {
    const transport = new RecordingTransport(() => ({
      ok: true,
      stamp: { contractVersion: 2, promptVersion: '1.0.0' },
      result: completeResult('x'),
    }));
    const extractor = new WorkerVisionPageExtractor({ transport });

    await expect(
      extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
    ).rejects.toThrow(/stamp\.modelId/);
  });

  it('throws when `stamp.promptVersion` is missing or not a string', async () => {
    const transport = new RecordingTransport(() => ({
      ok: true,
      stamp: { contractVersion: 2, modelId: 'm' },
      result: completeResult('x'),
    }));
    const extractor = new WorkerVisionPageExtractor({ transport });

    await expect(
      extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
    ).rejects.toThrow(/stamp\.promptVersion/);
  });
});

describe('bytesToBase64', () => {
  it('round-trips through atob to the original bytes', () => {
    const encoded = bytesToBase64(FAKE_PNG_BYTES);
    const decoded = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(FAKE_PNG_BYTES));
  });

  it('carries no `data:` prefix — the exact shape vision.extract.v2 requires', () => {
    const encoded = bytesToBase64(FAKE_PNG_BYTES);
    expect(encoded.startsWith('data:')).toBe(false);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('handles an image larger than one base64 chunk without a call-stack error', () => {
    const big = new Uint8Array(0x8000 * 3 + 17).fill(7);
    expect(() => bytesToBase64(big)).not.toThrow();
  });
});

// ---- the JobRunner layer -------------------------------------------------

/** In-memory `VaultSource` — same role `wiring.spec.ts`'s `MemoryVaultSource` fills. */
class MemoryVaultSource implements VaultSource {
  private readonly binary = new Map<string, Uint8Array>();
  private readonly failing = new Set<string>();

  setBinary(path: VaultPath, bytes: Uint8Array): void {
    this.binary.set(path, bytes);
  }

  failOn(path: VaultPath): void {
    this.failing.add(path);
  }

  async list(_options: ListOptions = {}): Promise<readonly VaultPath[]> {
    return [...this.binary.keys()].sort();
  }

  async read(path: VaultPath): Promise<string> {
    throw new Error(`MemoryVaultSource.read: no text files in this fake (${path})`);
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    if (this.failing.has(path)) throw new Error('simulated transient read failure');
    const found = this.binary.get(path);
    if (!found) throw new Error(`not found: ${path}`);
    return found;
  }

  async write(): Promise<void> {
    throw new Error('MemoryVaultSource.write: not needed by these tests');
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.binary.has(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

/** Records every `receive` call — never partially, per `ExtractedUnitSink`'s own "at most once per job" contract. */
class RecordingSink {
  readonly calls: (readonly ExtractedUnit[])[] = [];
  async receive(units: readonly ExtractedUnit[]): Promise<void> {
    this.calls.push(units);
  }
}

/** Narrows a `VisionPageExtractRequest` to its single-image branch — throws (a real test failure, not a silent cast) if the request actually carries an `images` list, for the tests asserting the pre-existing single-image shape specifically. */
function singleImageRequest(request: VisionPageExtractRequest | undefined): {
  pageImageBase64: string;
  mimeType: string;
} {
  if (!request || 'images' in request) {
    throw new Error('expected a single-image VisionPageExtractRequest, got an images list');
  }
  return request;
}

/** A `VisionPageExtractPort` fake that records every request and answers with whatever the test scripts, or throws. */
class FakeExtractor implements VisionPageExtractPort {
  readonly requests: VisionPageExtractRequest[] = [];
  constructor(
    private readonly reply: (
      request: VisionPageExtractRequest,
    ) => VisionPageExtractResult | Promise<VisionPageExtractResult>,
  ) {}
  async extract(request: VisionPageExtractRequest): Promise<VisionPageExtractResult> {
    this.requests.push(request);
    return this.reply(request);
  }
}

function visionPageJob(overrides: Partial<JobRunnerView> = {}): JobRunnerView {
  return {
    contentHash: 'hash-abc123',
    label: 'irrelevant to the runner',
    payload: {
      kind: 'vision-page',
      sourcePath: 'Slides/diagram.png',
      format: 'image',
      page: 1,
    },
    attempts: 0,
    ...overrides,
  };
}

describe('createWorkerVisionPageRunner — a readable standalone image', () => {
  it('reads the file, sends it as base64, and lands one ExtractedUnit in the sink on a complete reading', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('Figure 3: the rock cycle'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(visionPageJob());

    expect(outcome).toEqual({ ok: true });
    expect(extractor.requests).toHaveLength(1);
    expect(singleImageRequest(extractor.requests[0]).mimeType).toBe('image/png');
    expect(singleImageRequest(extractor.requests[0]).pageImageBase64).toBe(
      bytesToBase64(FAKE_PNG_BYTES),
    );

    expect(sink.calls).toHaveLength(1);
    const units = sink.calls[0];
    expect(units).toHaveLength(1);
    expect(units?.[0]).toEqual({
      text: 'Figure 3: the rock cycle',
      provenance: {
        sourcePath: 'Slides/diagram.png',
        location: { page: 1, charRange: { start: 0, end: 'Figure 3: the rock cycle'.length } },
      },
    });
  });

  it("carries embeddedIn through to the unit's provenance, same shape the text-layer path produces", async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.jpg', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('embedded figure text'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const embeddedIn = { notePath: 'Notes/lecture.md', blockStart: 10, blockEnd: 40 };
    await runner(
      visionPageJob({
        payload: {
          kind: 'vision-page',
          sourcePath: 'Slides/diagram.jpg',
          format: 'image',
          page: 1,
          embeddedIn,
        },
      }),
    );

    expect(sink.calls[0]?.[0]?.provenance.embeddedIn).toEqual(embeddedIn);
  });

  it.each(['png', 'jpg', 'jpeg', 'webp'])('accepts a supported .%s extension', async (ext) => {
    const vault = new MemoryVaultSource();
    const path = `Slides/diagram.${ext}` as VaultPath;
    vault.setBinary(path, FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('text'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: path, format: 'image', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: true });
  });
});

describe('createWorkerVisionPageRunner — a partial reading', () => {
  it('lands the covered text as an ExtractedUnit, the same shape a complete reading gets', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/dense.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => ({
      outcome: 'partial',
      extractedText: 'the first three paragraphs',
      figureDescription: null,
      coverage: 'the first three paragraphs',
      unreadableReason: null,
    }));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/dense.png', format: 'image', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: true });
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]?.[0]?.text).toBe('the first three paragraphs');
  });
});

describe('createWorkerVisionPageRunner — figure description is kept apart from passages', () => {
  it("never merges a non-null figureDescription into the landed unit's text", async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/labelled.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => ({
      outcome: 'complete',
      extractedText: 'The caption above the figure.',
      figureDescription: 'A diagram with three labelled arrows between states A, B and C.',
      coverage: null,
      unreadableReason: null,
    }));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    await runner(
      visionPageJob({
        payload: {
          kind: 'vision-page',
          sourcePath: 'Slides/labelled.png',
          format: 'image',
          page: 1,
        },
      }),
    );

    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]?.[0]?.text).toBe('The caption above the figure.');
    expect(sink.calls[0]?.[0]?.text).not.toContain('labelled arrows');
  });

  it('[D-325] figure-only page (empty extractedText, non-null figureDescription) lands zero units — nowhere for the figure to flow yet', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/figure-only.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => ({
      outcome: 'complete',
      extractedText: '',
      figureDescription: 'A bare full-bleed diagram with no surrounding text.',
      coverage: null,
      unreadableReason: null,
    }));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({
        payload: {
          kind: 'vision-page',
          sourcePath: 'Slides/figure-only.png',
          format: 'image',
          page: 1,
        },
      }),
    );

    expect(outcome).toEqual({ ok: true });
    expect(sink.calls).toHaveLength(0);
  });
});

describe('createWorkerVisionPageRunner — INV-5: an unreadable page is a refusal, never a fabrication', () => {
  it("an unreadable outcome (the server's empty-context guard, or the model's own refusal) produces zero units and ok: true", async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/blank.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => ({
      outcome: 'unreadable',
      extractedText: '',
      figureDescription: null,
      coverage: null,
      unreadableReason: 'blank-page',
    }));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/blank.png', format: 'image', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: true });
    expect(sink.calls).toHaveLength(0); // never called with an empty array — see ExtractedUnitSink's own contract
  });

  it('a complete outcome with empty text is treated the same honest way — no unit invented from nothing', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/edge.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult(''));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/edge.png', format: 'image', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: true });
    expect(sink.calls).toHaveLength(0);
  });
});

describe('createWorkerVisionPageRunner — DF-21 honest, named failures', () => {
  it('a non-vision-page payload is a non-retryable failure, not a crash', async () => {
    const vault = new MemoryVaultSource();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('x'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({ payload: { kind: 'source', sourcePath: 'x.pdf', format: 'pdf' } }),
    );

    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      reason: expect.stringContaining('hash-abc123'),
    });
  });

  it('a pdf page with no pageRenderer wired names the missing renderer (ol-9cle) and is non-retryable — pptx/docx have their own path now (see below)', async () => {
    const vault = new MemoryVaultSource();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('x'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Lectures/deck.pdf', format: 'pdf', page: 3 },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.retryable ? '' : outcome.reason).toContain('ol-9cle');
    expect(extractor.requests).toHaveLength(0); // never called the Worker for an unsupported shape
  });

  it('an unsupported image extension (e.g. .gif) is named and non-retryable, never a paid guess', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/scan.gif', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('x'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/scan.gif', format: 'image', page: 1 },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(false);
    expect(extractor.requests).toHaveLength(0);
  });

  it('a vault read failure is retryable — the ordinary transient shape every other extractor gets', async () => {
    const vault = new MemoryVaultSource();
    vault.failOn('Slides/flaky.png');
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('x'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/flaky.png', format: 'image', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: false, retryable: true });
  });
});

/** A `PageRenderPort` fake that records every request and answers with whatever the test scripts, or throws. */
class FakePageRenderer implements PageRenderPort {
  readonly requests: PdfPageRenderRequest[] = [];
  constructor(
    private readonly reply: (request: PdfPageRenderRequest) => RenderedPage | Promise<RenderedPage>,
  ) {}
  async renderPage(request: PdfPageRenderRequest): Promise<RenderedPage> {
    this.requests.push(request);
    return this.reply(request);
  }
}

const FAKE_RENDERED_PAGE: RenderedPage = {
  dataUrl: `data:image/png;base64,${bytesToBase64(FAKE_PNG_BYTES)}`,
  mimeType: 'image/png',
  width: 100,
  height: 100,
};

describe('createWorkerVisionPageRunner — a PDF page, rendered via the injected pageRenderer (D-324, resolves ol-9cle)', () => {
  it('renders the routed page and lands a unit on a complete reading', async () => {
    const vault = new MemoryVaultSource();
    const pdfPath = 'Lectures/deck.pdf' as VaultPath;
    vault.setBinary(pdfPath, new Uint8Array([1, 2, 3]));
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('Figure 3: the rock cycle'));
    const pageRenderer = new FakePageRenderer(() => FAKE_RENDERED_PAGE);
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink, pageRenderer });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: pdfPath, format: 'pdf', page: 3 },
      }),
    );

    expect(outcome).toEqual({ ok: true });
    expect(pageRenderer.requests).toEqual([
      { pdfBytes: new Uint8Array([1, 2, 3]), pageNumber: 3, scale: PDF_PAGE_RENDER_SCALE },
    ]);
    expect(extractor.requests).toHaveLength(1);
    expect(singleImageRequest(extractor.requests[0]).mimeType).toBe('image/png');
    expect(singleImageRequest(extractor.requests[0]).pageImageBase64).toBe(
      bytesToBase64(FAKE_PNG_BYTES),
    );
    expect(sink.calls[0]?.[0]?.text).toBe('Figure 3: the rock cycle');
    expect(sink.calls[0]?.[0]?.provenance.location.page).toBe(3);
  });

  it('a render failure is a named, non-retryable outcome — never retried until the renderer changes, never read as empty', async () => {
    const vault = new MemoryVaultSource();
    const pdfPath = 'Lectures/corrupt.pdf' as VaultPath;
    vault.setBinary(pdfPath, new Uint8Array([1, 2, 3]));
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('should never be called'));
    const pageRenderer = new FakePageRenderer(() => {
      throw new PageRenderError(
        'PdfJsPageRenderer: pdf.js could not render page 3.',
        'render-failed',
      );
    });
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink, pageRenderer });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: pdfPath, format: 'pdf', page: 3 },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.retryable ? '' : outcome.reason).toContain('render-failed');
    expect(extractor.requests).toHaveLength(0); // never paid for a call on bytes it couldn't render
  });

  it('a vault read failure before rendering is retryable — the ordinary transient shape', async () => {
    const vault = new MemoryVaultSource();
    const pdfPath = 'Lectures/flaky.pdf' as VaultPath;
    vault.failOn(pdfPath);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('x'));
    const pageRenderer = new FakePageRenderer(() => FAKE_RENDERED_PAGE);
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink, pageRenderer });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: pdfPath, format: 'pdf', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: false, retryable: true });
    expect(pageRenderer.requests).toHaveLength(0);
  });

  it('an unreadable rendered page produces zero units, same INV-5 honesty as a standalone image', async () => {
    const vault = new MemoryVaultSource();
    const pdfPath = 'Lectures/blank.pdf' as VaultPath;
    vault.setBinary(pdfPath, new Uint8Array([1, 2, 3]));
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => ({
      outcome: 'unreadable',
      extractedText: '',
      figureDescription: null,
      coverage: null,
      unreadableReason: 'blank-page',
    }));
    const pageRenderer = new FakePageRenderer(() => FAKE_RENDERED_PAGE);
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink, pageRenderer });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: pdfPath, format: 'pdf', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: true });
    expect(sink.calls).toHaveLength(0);
  });

  it('without a pageRenderer wired, a PDF page still gets the honest ol-9cle-named gap — unchanged default behaviour', async () => {
    const vault = new MemoryVaultSource();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('x'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink }); // no pageRenderer

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Lectures/deck.pdf', format: 'pdf', page: 3 },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.retryable ? '' : outcome.reason).toContain('ol-9cle');
  });

  it('a pageRenderer supplied is irrelevant to pptx/docx — they never use this port, only the D-324 combine cue (see the describe block below)', async () => {
    const vault = new MemoryVaultSource();
    const pptxPath = 'Lectures/deck.pptx' as VaultPath;
    vault.setBinary(pptxPath, new Uint8Array([1, 2, 3]));
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('x'));
    const pageRenderer = new FakePageRenderer(() => FAKE_RENDERED_PAGE);
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink, pageRenderer });
    vi.mocked(pptxFigureCue).mockReturnValue([{ page: 1, qualifies: false, images: [] }]);

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: pptxPath, format: 'pptx', page: 1 },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(false);
    expect(pageRenderer.requests).toHaveLength(0); // never invoked for a format it does not render
  });
});

describe('createWorkerVisionPageRunner — PPTX/DOCX embedded images, sent via the D-324 combine cue (ol-egov.141.89.8.26)', () => {
  const PPTX_PATH = 'Lectures/deck.pptx' as VaultPath;
  const DOCX_PATH = 'Papers/paper.docx' as VaultPath;

  // `pptxFigureCue`/`docxFigureCue` are one shared `vi.fn()` per the
  // top-of-file `vi.mock` (module-level, not per-test) — without this, a
  // later test's `.not.toHaveBeenCalled()` would see every earlier test's
  // calls too.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function pptxVault(): MemoryVaultSource {
    const vault = new MemoryVaultSource();
    // Fake, deliberately-not-a-real-zip bytes: `pptxFigureCue` is mocked in
    // this describe block (see the top-of-file `vi.mock`), so nothing here
    // ever actually unzips them — only `deps.vault.readBinary` needs to
    // resolve, and `pptxFigureCue` needs to be CALLED with them so the
    // per-test assertions below can check what it was called with.
    vault.setBinary(PPTX_PATH, new Uint8Array([1, 2, 3]));
    return vault;
  }

  function docxVault(): MemoryVaultSource {
    const vault = new MemoryVaultSource();
    vault.setBinary(DOCX_PATH, new Uint8Array([4, 5, 6]));
    return vault;
  }

  it('a pptx slide with exactly one qualifying image sends it as the plain single-image request, byte for byte — not a one-element images list', async () => {
    const vault = pptxVault();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('a diagram of the rock cycle'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });
    const image: EmbeddedRasterImage = { bytes: new Uint8Array([9, 9, 9]), mimeType: 'image/png' };
    const cueResult: PptxFigureCueSlide[] = [{ page: 1, qualifies: true, images: [image] }];
    vi.mocked(pptxFigureCue).mockReturnValue(cueResult);

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: PPTX_PATH, format: 'pptx', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: true });
    expect(pptxFigureCue).toHaveBeenCalledWith({ path: PPTX_PATH, bytes: expect.any(Uint8Array) });
    expect(extractor.requests).toHaveLength(1);
    const request = singleImageRequest(extractor.requests[0]);
    expect(request.mimeType).toBe('image/png');
    expect(request.pageImageBase64).toBe(bytesToBase64(image.bytes));
    expect(sink.calls[0]?.[0]?.text).toBe('a diagram of the rock cycle');
    expect(sink.calls[0]?.[0]?.provenance.location.page).toBe(1);
  });

  it('a pptx slide with several qualifying images sends them as one ordered images-list request, in order', async () => {
    const vault = pptxVault();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('read together'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });
    const imageA: EmbeddedRasterImage = { bytes: new Uint8Array([1]), mimeType: 'image/png' };
    const imageB: EmbeddedRasterImage = { bytes: new Uint8Array([2, 2]), mimeType: 'image/jpeg' };
    vi.mocked(pptxFigureCue).mockReturnValue([
      { page: 2, qualifies: true, images: [imageA, imageB] },
    ]);

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: PPTX_PATH, format: 'pptx', page: 2 },
      }),
    );

    expect(outcome).toEqual({ ok: true });
    expect(extractor.requests).toHaveLength(1);
    const request = extractor.requests[0];
    if (!request || !('images' in request)) throw new Error('expected an images list');
    expect(request.images).toEqual([
      { pageImageBase64: bytesToBase64(imageA.bytes), mimeType: 'image/png' },
      { pageImageBase64: bytesToBase64(imageB.bytes), mimeType: 'image/jpeg' },
    ]);
  });

  it('a pptx slide the cue says does not qualify is a named, non-retryable gap — the Worker is never called', async () => {
    const vault = pptxVault();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('should never be called'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });
    vi.mocked(pptxFigureCue).mockReturnValue([{ page: 1, qualifies: false, images: [] }]);

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: PPTX_PATH, format: 'pptx', page: 1 },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.retryable ? '' : outcome.reason).toContain('combine-cue floor');
    expect(extractor.requests).toHaveLength(0);
  });

  it('a docx region (page 1, the only region) with one qualifying image sends it', async () => {
    const vault = docxVault();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('a labelled diagram'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });
    const image: EmbeddedRasterImage = { bytes: new Uint8Array([7]), mimeType: 'image/webp' };
    const cueResult: DocxFigureCueResult = { qualifies: true, images: [image] };
    vi.mocked(docxFigureCue).mockReturnValue(cueResult);

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: DOCX_PATH, format: 'docx', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: true });
    expect(docxFigureCue).toHaveBeenCalledWith({ path: DOCX_PATH, bytes: expect.any(Uint8Array) });
    expect(sink.calls[0]?.[0]?.text).toBe('a labelled diagram');
  });

  it('a docx job naming a page other than 1 has nothing to send — docx has exactly one logical region — and never calls docxFigureCue', async () => {
    const vault = docxVault();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('should never be called'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });
    vi.mocked(docxFigureCue).mockReturnValue({ qualifies: true, images: [] }); // must not even be consulted

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: DOCX_PATH, format: 'docx', page: 2 },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(false);
    expect(docxFigureCue).not.toHaveBeenCalled();
    expect(extractor.requests).toHaveLength(0);
  });

  it('more qualifying images than MAX_OFFICE_IMAGE_LIST_LENGTH is refused, never truncated to the first N', async () => {
    const vault = pptxVault();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('should never be called'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });
    const images: EmbeddedRasterImage[] = Array.from(
      { length: MAX_OFFICE_IMAGE_LIST_LENGTH + 1 },
      (_, i) => ({ bytes: new Uint8Array([i]), mimeType: 'image/png' as const }),
    );
    vi.mocked(pptxFigureCue).mockReturnValue([{ page: 1, qualifies: true, images }]);

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: PPTX_PATH, format: 'pptx', page: 1 },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.retryable ? '' : outcome.reason).toContain('MAX_OFFICE_IMAGE_LIST_LENGTH');
    expect(extractor.requests).toHaveLength(0);
  });

  it('qualifying images totalling more than MAX_OFFICE_IMAGE_TOTAL_BYTES is refused, never truncated to fewer bytes', async () => {
    const vault = pptxVault();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('should never be called'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });
    const halfPlusOne = Math.floor(MAX_OFFICE_IMAGE_TOTAL_BYTES / 2) + 1;
    const images: EmbeddedRasterImage[] = [
      { bytes: new Uint8Array(halfPlusOne), mimeType: 'image/png' },
      { bytes: new Uint8Array(halfPlusOne), mimeType: 'image/png' },
    ];
    vi.mocked(pptxFigureCue).mockReturnValue([{ page: 1, qualifies: true, images }]);

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: PPTX_PATH, format: 'pptx', page: 1 },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.retryable ? '' : outcome.reason).toContain('MAX_OFFICE_IMAGE_TOTAL_BYTES');
    expect(extractor.requests).toHaveLength(0);
  });

  it('a qualifying image of an unsupported raster mime type (e.g. image/gif) refuses the whole call, never silently dropping just that one image from the combine', async () => {
    const vault = pptxVault();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('should never be called'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });
    const goodImage: EmbeddedRasterImage = { bytes: new Uint8Array([1]), mimeType: 'image/png' };
    const gifImage: EmbeddedRasterImage = { bytes: new Uint8Array([2]), mimeType: 'image/gif' };
    vi.mocked(pptxFigureCue).mockReturnValue([
      { page: 1, qualifies: true, images: [goodImage, gifImage] },
    ]);

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: PPTX_PATH, format: 'pptx', page: 1 },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.retryable ? '' : outcome.reason).toContain('image/gif');
    expect(extractor.requests).toHaveLength(0);
  });

  it('a vault read failure before the figure cue can even be computed is retryable — the ordinary transient shape', async () => {
    const vault = pptxVault();
    vault.failOn(PPTX_PATH);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('should never be called'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: PPTX_PATH, format: 'pptx', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: false, retryable: true });
    expect(pptxFigureCue).not.toHaveBeenCalled();
    expect(extractor.requests).toHaveLength(0);
  });
});

describe('createWorkerVisionPageRunner — [D-325] unavailable is retryable, a genuine refusal is not', () => {
  it('a raw transport failure (the transport itself threw, no response arrived) is retryable — the regression this bead fixes', async () => {
    // Before this bead, EVERY failure from the extract() call — including a
    // plain transport/outage failure — was reported non-retryable. This is
    // the failing-first assertion: with the pre-fix catch (a bare
    // `catch { return { ok: false, retryable: false, ... } }`), this
    // expectation would fail because the outcome would read
    // `retryable: false`.
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor: VisionPageExtractPort = {
      async extract() {
        throw new TypeError('fetch failed: network unreachable');
      },
    };
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(visionPageJob());

    expect(outcome).toEqual({ ok: false, retryable: true });
    expect(sink.calls).toHaveLength(0);
  });

  it("a well-formed Worker refusal naming upstream-error is retryable — D-325's 'unavailable is operational, never a result'", async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => {
      throw new WorkerVisionPageExtractorError(
        'WorkerVisionPageExtractor: the Worker refused the request (upstream-error): The model could not be reached.',
        'upstream-error',
      );
    });
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(visionPageJob());

    expect(outcome).toEqual({ ok: false, retryable: true });
    expect(sink.calls).toHaveLength(0);
  });

  it.each([
    'invalid-request',
    'grounding-refused',
    'quota-exceeded',
    'internal-error',
    undefined,
  ] as const)(
    'a Worker refusal naming %s stays non-retryable per DF-21 — retrying reaches the same bytes and the same outcome',
    async (code) => {
      const vault = new MemoryVaultSource();
      vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
      const sink = new RecordingSink();
      const extractor = new FakeExtractor(() => {
        throw new WorkerVisionPageExtractorError('the Worker refused the request', code);
      });
      const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

      const outcome = await runner(visionPageJob());

      expect(outcome).toEqual({
        ok: false,
        retryable: false,
        reason: expect.stringContaining('hash-abc123'),
      });
      expect(sink.calls).toHaveLength(0);
    },
  );

  it('a malformed/unusable response body stays non-retryable, same as any other unrecognised shape', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => {
      // No `code` at all — the shape `readVisionResult` throws for a body it
      // cannot parse (e.g. no `ok` discriminant), never an outage.
      throw new WorkerVisionPageExtractorError(
        'WorkerVisionPageExtractor: the Worker response carried no `ok` discriminant.',
      );
    });
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(visionPageJob());

    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      reason: expect.stringContaining('hash-abc123'),
    });
  });

  it('the FailingTransport shape at the extractor layer also throws a raw, unwrapped error (sanity check on the fake)', async () => {
    const transport = new FailingTransport(new Error('ECONNRESET'));
    const extractor = new WorkerVisionPageExtractor({ transport });

    await expect(
      extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
    ).rejects.not.toBeInstanceOf(WorkerVisionPageExtractorError);
  });
});

describe('createWorkerVisionPageRunner — D-005: never names her material', () => {
  it("every non-retryable reason names the job's content hash, never the sourcePath or label", async () => {
    const vault = new MemoryVaultSource();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => {
      throw new WorkerVisionPageExtractorError('boom', 'invalid-request');
    });
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const secretPath = 'PSYCH326/Week 4/very-identifying-lecture-title.png';
    vault.setBinary(secretPath, FAKE_PNG_BYTES);
    const outcome = await runner(
      visionPageJob({
        contentHash: 'opaque-hash-xyz',
        label: 'PSYCH326 Week 4 lecture (do not leak this)',
        payload: { kind: 'vision-page', sourcePath: secretPath, format: 'image', page: 1 },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const reason = outcome.retryable ? '' : outcome.reason;
    expect(reason).toContain('opaque-hash-xyz');
    expect(reason).not.toContain(secretPath);
    expect(reason).not.toContain('very-identifying-lecture-title');
    expect(reason).not.toContain('PSYCH326');
  });

  it('has no console call anywhere in the source', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/ingestion/vision-page-runner.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/console\.\w+\(/);
  });
});

/** Records every entry `onManifestEntry` is called with, in order. */
class RecordingManifestSink {
  readonly entries: VisionUnitManifestEntry[] = [];
  readonly handler = (entry: VisionUnitManifestEntry): void => {
    this.entries.push(entry);
  };
}

describe('createWorkerVisionPageRunner — [D-326] onManifestEntry: producer provenance from the wire', () => {
  it('builds a read entry, with provenance, for a complete reading', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const manifest = new RecordingManifestSink();
    const extractor = new FakeExtractor(() => ({
      outcome: 'complete',
      extractedText: 'Figure 3: the rock cycle',
      figureDescription: null,
      coverage: null,
      unreadableReason: null,
      modelId: '@cf/meta/llama-4-scout-17b-16e-instruct',
      promptVersion: '3',
    }));
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onManifestEntry: manifest.handler,
    });

    await runner(visionPageJob());

    expect(manifest.entries).toHaveLength(1);
    const entry = manifest.entries[0];
    expect(entry?.unitId).toBe('Slides/diagram.png#1');
    expect(entry?.sourcePath).toBe('Slides/diagram.png');
    expect(entry?.page).toBe(1);
    expect(entry?.conceptExtractionState).toBe('not-started');
    expect(entry?.readingState.kind).toBe('read');
    if (entry?.readingState.kind !== 'read') return;
    expect(entry.readingState.method).toBe('image');
    expect(entry.readingState.provenance).toEqual({
      task: 'vision.extract.v2',
      promptVersion: '3',
      modelIdentity: '@cf/meta/llama-4-scout-17b-16e-instruct',
      imageDigest: expect.any(String),
    });
    // Core's `UnitReadingState` (`ol-egov.141.89.8.4` part 3's swap) makes
    // `provenance` optional on every kind — this runner always supplies it
    // for an image reading, but the type no longer says so, hence this
    // narrowing before the field access below.
    if (!entry.readingState.provenance) return expect.unreachable();
    expect(entry.readingState.provenance.imageDigest).toMatch(/^[0-9a-f]{64}$/); // hex SHA-256
  });

  it('builds a partial entry with coverage, falling back honestly when none was named', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/dense.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const manifest = new RecordingManifestSink();
    const extractor = new FakeExtractor(() => ({
      outcome: 'partial',
      extractedText: 'the top half',
      figureDescription: null,
      coverage: null, // the model named no coverage
      unreadableReason: null,
    }));
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onManifestEntry: manifest.handler,
    });

    await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/dense.png', format: 'image', page: 1 },
      }),
    );

    const entry = manifest.entries[0];
    expect(entry?.readingState.kind).toBe('partial');
    if (entry?.readingState.kind !== 'partial') return;
    expect(entry.readingState.coverage).toBe('coverage not stated by the model');
  });

  it('builds an unreadable entry with its reason', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/blank.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const manifest = new RecordingManifestSink();
    const extractor = new FakeExtractor(() => ({
      outcome: 'unreadable',
      extractedText: '',
      figureDescription: null,
      coverage: null,
      unreadableReason: 'blank-page',
    }));
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onManifestEntry: manifest.handler,
    });

    await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/blank.png', format: 'image', page: 1 },
      }),
    );

    const entry = manifest.entries[0];
    expect(entry?.readingState).toEqual({
      kind: 'unreadable',
      reason: 'blank-page',
      provenance: expect.objectContaining({ task: 'vision.extract.v2' }),
    });
  });

  it("maps a wire unreadableReason outside core's closed three-value enum to the safe declared default, and counts it via onUnknownUnreadableReason, never passing the out-of-catalogue string through (part 3, ol-egov.141.89.8.4)", async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/blank.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const manifest = new RecordingManifestSink();
    const extractor = new FakeExtractor(() => ({
      outcome: 'unreadable',
      extractedText: '',
      figureDescription: null,
      coverage: null,
      // Not one of core's three closed `UnitUnreadableReason` values
      // (`blank-page`/`not-legible`/`no-text-on-page`) — a wire/service
      // drift this client cannot rule out but must never trust blindly.
      unreadableReason: 'corrupted-scan',
    }));
    let unknownReasonCount = 0;
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onManifestEntry: manifest.handler,
      onUnknownUnreadableReason: () => {
        unknownReasonCount += 1;
      },
    });

    await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/blank.png', format: 'image', page: 1 },
      }),
    );

    const entry = manifest.entries[0];
    expect(entry?.readingState).toEqual({
      kind: 'unreadable',
      reason: 'not-legible',
      provenance: expect.objectContaining({ task: 'vision.extract.v2' }),
    });
    expect(unknownReasonCount).toBe(1);
  });

  it('never counts a null unreadableReason as unknown (the pre-existing, honest "no reason named" case)', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/blank.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const manifest = new RecordingManifestSink();
    const extractor = new FakeExtractor(() => ({
      outcome: 'unreadable',
      extractedText: '',
      figureDescription: null,
      coverage: null,
      unreadableReason: null,
    }));
    let unknownReasonCount = 0;
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onManifestEntry: manifest.handler,
      onUnknownUnreadableReason: () => {
        unknownReasonCount += 1;
      },
    });

    await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/blank.png', format: 'image', page: 1 },
      }),
    );

    const entry = manifest.entries[0];
    if (entry?.readingState.kind !== 'unreadable') return expect.unreachable();
    expect(entry.readingState.reason).toBe('not-legible');
    expect(unknownReasonCount).toBe(0);
  });

  it('falls back to a labelled placeholder when the port answers with no modelId/promptVersion', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const manifest = new RecordingManifestSink();
    const extractor = new FakeExtractor(() => completeResult('text')); // no modelId/promptVersion
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onManifestEntry: manifest.handler,
    });

    await runner(visionPageJob());

    const entry = manifest.entries[0];
    if (entry?.readingState.kind !== 'read') return expect.unreachable();
    // See the "builds a read entry" test above for why this narrowing is
    // now needed: core's `UnitReadingState` makes `provenance` optional.
    if (!entry.readingState.provenance) return expect.unreachable();
    expect(entry.readingState.provenance.modelIdentity).toContain('unreported');
    expect(entry.readingState.provenance.promptVersion).toContain('unreported');
  });

  it('a resumed page on a later pass gets the SAME unitId — [D-326] stable identity', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/dense.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const manifest = new RecordingManifestSink();
    const extractor = new FakeExtractor(() => ({
      outcome: 'partial',
      extractedText: 'first pass',
      figureDescription: null,
      coverage: 'the first half',
      unreadableReason: null,
    }));
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onManifestEntry: manifest.handler,
    });

    const job = visionPageJob({
      payload: { kind: 'vision-page', sourcePath: 'Slides/dense.png', format: 'image', page: 1 },
    });
    await runner(job); // "first pass"
    await runner(job); // "resumed pass"

    expect(manifest.entries).toHaveLength(2);
    expect(manifest.entries[0]?.unitId).toBe(manifest.entries[1]?.unitId);
  });

  it('is never called when the extractor call itself fails (nothing was read)', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const manifest = new RecordingManifestSink();
    const extractor: VisionPageExtractPort = {
      async extract() {
        throw new WorkerVisionPageExtractorError('boom', 'invalid-request');
      },
    };
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onManifestEntry: manifest.handler,
    });

    await runner(visionPageJob());

    expect(manifest.entries).toHaveLength(0);
  });

  it('is never called for a pdf render failure (nothing was read)', async () => {
    const vault = new MemoryVaultSource();
    const pdfPath = 'Lectures/corrupt.pdf' as VaultPath;
    vault.setBinary(pdfPath, new Uint8Array([1, 2, 3]));
    const sink = new RecordingSink();
    const manifest = new RecordingManifestSink();
    const extractor = new FakeExtractor(() => completeResult('should never be called'));
    const pageRenderer = new FakePageRenderer(() => {
      throw new PageRenderError('render failed', 'render-failed');
    });
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      pageRenderer,
      onManifestEntry: manifest.handler,
    });

    await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: pdfPath, format: 'pdf', page: 1 },
      }),
    );

    expect(manifest.entries).toHaveLength(0);
  });

  it('is a no-op (no digest computed, nothing thrown) when onManifestEntry is not supplied', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => completeResult('text'));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink }); // no onManifestEntry

    const outcome = await runner(visionPageJob());

    expect(outcome).toEqual({ ok: true });
  });
});

/** Records every outcome `onWritingOutcome` is called with, in order. */
class RecordingWritingOutcomes {
  readonly outcomes: WritingOutcome<VisionPageDraft>[] = [];
  readonly handler = (outcome: WritingOutcome<VisionPageDraft>): void => {
    this.outcomes.push(outcome);
  };
}

describe('createWorkerVisionPageRunner — onWritingOutcome: the Writing-contract adapter production caller (ol-egov.141.89.8.31)', () => {
  it('a complete reading with text is written, carrying the draft and an unverified receipt from the candidate seat', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractor = new FakeExtractor(() => ({
      outcome: 'complete',
      extractedText: 'Figure 3: the rock cycle',
      figureDescription: null,
      coverage: null,
      unreadableReason: null,
      modelId: '@cf/meta/llama-4-scout-17b-16e-instruct',
      promptVersion: '3',
    }));
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onWritingOutcome: writing.handler,
    });

    await runner(visionPageJob());

    expect(writing.outcomes).toHaveLength(1);
    const outcome = writing.outcomes[0];
    expect(outcome?.kind).toBe('written');
    if (outcome?.kind !== 'written') return expect.unreachable();
    expect(outcome.draft).toEqual({
      text: 'Figure 3: the rock cycle',
      figureDescription: null,
    });
    expect(outcome.receipt.disposition).toBe('unverified');
    expect(outcome.receipt.provenance.producer).toEqual({
      kind: 'model',
      seat: 'candidate',
      taskId: 'vision.extract.v2',
      stamp: { modelId: '@cf/meta/llama-4-scout-17b-16e-instruct', promptVersion: '3' },
    });
    expect(outcome.receipt.provenance.evidenceDigests).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
  });

  it('a partial reading with text is also written, the coverage note never landing on the draft', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/dense.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractor = new FakeExtractor(() => ({
      outcome: 'partial',
      extractedText: 'the top half',
      figureDescription: null,
      coverage: 'the top half of the page',
      unreadableReason: null,
    }));
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onWritingOutcome: writing.handler,
    });

    await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/dense.png', format: 'image', page: 1 },
      }),
    );

    const outcome = writing.outcomes[0];
    expect(outcome?.kind).toBe('written');
    if (outcome?.kind !== 'written') return expect.unreachable();
    expect(outcome.draft.text).toBe('the top half');
    expect('coverage' in outcome.draft).toBe(false);
  });

  it('an unreadable reading is declined, nothing-to-write-from — never a draft, never unavailable', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/blank.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractor = new FakeExtractor(() => ({
      outcome: 'unreadable',
      extractedText: '',
      figureDescription: null,
      coverage: null,
      unreadableReason: 'blank-page',
    }));
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onWritingOutcome: writing.handler,
    });

    await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/blank.png', format: 'image', page: 1 },
      }),
    );

    expect(writing.outcomes[0]).toMatchObject({ kind: 'declined', basis: 'nothing-to-write-from' });
    expect('draft' in (writing.outcomes[0] ?? {})).toBe(false);
  });

  it("[D-325] a figure-only complete reading (empty text, a figure description) is declined too — the figure description never reaches the writing outcome as her material's text", async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/figure-only.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractor = new FakeExtractor(() => ({
      outcome: 'complete',
      extractedText: '',
      figureDescription: 'A bare full-bleed diagram with no surrounding text.',
      coverage: null,
      unreadableReason: null,
    }));
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onWritingOutcome: writing.handler,
    });

    await runner(
      visionPageJob({
        payload: {
          kind: 'vision-page',
          sourcePath: 'Slides/figure-only.png',
          format: 'image',
          page: 1,
        },
      }),
    );

    const outcome = writing.outcomes[0];
    expect(outcome).toMatchObject({ kind: 'declined', basis: 'nothing-to-write-from' });
    expect(JSON.stringify(outcome)).not.toContain('full-bleed');
  });

  it('a raw transport failure (no response ever arrived) is unavailable, call-failed — never a judgement about the page', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractor: VisionPageExtractPort = {
      async extract() {
        throw new TypeError('fetch failed: network unreachable');
      },
    };
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onWritingOutcome: writing.handler,
    });

    const outcome = await runner(visionPageJob());

    expect(outcome).toEqual({ ok: false, retryable: true }); // job-level classification unchanged
    expect(writing.outcomes[0]).toMatchObject({ kind: 'unavailable', cause: 'call-failed' });
  });

  it("the Worker's own grounding-refused reads as declined, nothing-to-write-from — INV-5's honest refusal, never an outage", async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractor = new FakeExtractor(() => {
      throw new WorkerVisionPageExtractorError(
        'the Worker refused the request',
        'grounding-refused',
      );
    });
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onWritingOutcome: writing.handler,
    });

    const outcome = await runner(visionPageJob());

    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      reason: expect.stringContaining('hash-abc123'),
    });
    expect(writing.outcomes[0]).toMatchObject({ kind: 'declined', basis: 'nothing-to-write-from' });
  });

  it.each(['invalid-request', 'quota-exceeded', 'internal-error', 'unauthenticated'])(
    'every other named Worker refusal (%s) is unavailable, service-refused, carrying the code — even where the job-level classification stays non-retryable',
    async (code) => {
      const vault = new MemoryVaultSource();
      vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
      const sink = new RecordingSink();
      const writing = new RecordingWritingOutcomes();
      const extractor = new FakeExtractor(() => {
        throw new WorkerVisionPageExtractorError('the Worker refused the request', code);
      });
      const runner = createWorkerVisionPageRunner({
        vault,
        extractor,
        sink,
        onWritingOutcome: writing.handler,
      });

      await runner(visionPageJob());

      expect(writing.outcomes[0]).toMatchObject({
        kind: 'unavailable',
        cause: 'service-refused',
        serviceCode: code,
      });
    },
  );

  it("upstream-error is unavailable per the writing outcome (service-refused) even though the job-level classification is retryable — DF-21's fix and D-300's outcome are separate concerns", async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractor = new FakeExtractor(() => {
      throw new WorkerVisionPageExtractorError('the Worker refused the request', 'upstream-error');
    });
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onWritingOutcome: writing.handler,
    });

    const outcome = await runner(visionPageJob());

    expect(outcome).toEqual({ ok: false, retryable: true });
    expect(writing.outcomes[0]).toMatchObject({
      kind: 'unavailable',
      cause: 'service-refused',
      serviceCode: 'upstream-error',
    });
  });

  it('a malformed/unusable response body (no usable code at all) is unavailable, malformed', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractor = new FakeExtractor(() => {
      throw new WorkerVisionPageExtractorError(
        'WorkerVisionPageExtractor: the Worker response carried no `ok` discriminant.',
      );
    });
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onWritingOutcome: writing.handler,
    });

    await runner(visionPageJob());

    expect(writing.outcomes[0]).toMatchObject({ kind: 'unavailable', cause: 'malformed' });
  });

  it('fires for a rendered PDF page too, the same shared readAndLandPage path a standalone image uses', async () => {
    const vault = new MemoryVaultSource();
    const pdfPath = 'Lectures/deck.pdf' as VaultPath;
    vault.setBinary(pdfPath, new Uint8Array([1, 2, 3]));
    const sink = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractor = new FakeExtractor(() => completeResult('Figure 3: the rock cycle'));
    const pageRenderer = new FakePageRenderer(() => FAKE_RENDERED_PAGE);
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      pageRenderer,
      onWritingOutcome: writing.handler,
    });

    await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: pdfPath, format: 'pdf', page: 3 },
      }),
    );

    expect(writing.outcomes).toHaveLength(1);
    expect(writing.outcomes[0]?.kind).toBe('written');
  });

  it('is never called for a pdf render failure (no call to vision.extract.v2 was ever made)', async () => {
    const vault = new MemoryVaultSource();
    const pdfPath = 'Lectures/corrupt.pdf' as VaultPath;
    vault.setBinary(pdfPath, new Uint8Array([1, 2, 3]));
    const sink = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractor = new FakeExtractor(() => completeResult('should never be called'));
    const pageRenderer = new FakePageRenderer(() => {
      throw new PageRenderError('render failed', 'render-failed');
    });
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      pageRenderer,
      onWritingOutcome: writing.handler,
    });

    await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: pdfPath, format: 'pdf', page: 1 },
      }),
    );

    expect(writing.outcomes).toHaveLength(0);
  });

  it('is never called for a non-vision-page payload or an unsupported shape (nothing was ever sent to vision.extract.v2)', async () => {
    const vault = new MemoryVaultSource();
    const sink = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractor = new FakeExtractor(() => completeResult('x'));
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor,
      sink,
      onWritingOutcome: writing.handler,
    });

    await runner(
      visionPageJob({ payload: { kind: 'source', sourcePath: 'x.pdf', format: 'pdf' } }),
    );
    await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Lectures/deck.pdf', format: 'pdf', page: 3 },
      }),
    );

    expect(writing.outcomes).toHaveLength(0);
  });

  it('behaviour of the read itself is unaffected: the same request is sent and the same unit lands, with or without onWritingOutcome supplied', async () => {
    const vaultWith = new MemoryVaultSource();
    vaultWith.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sinkWith = new RecordingSink();
    const writing = new RecordingWritingOutcomes();
    const extractorWith = new FakeExtractor(() => completeResult('Figure 3: the rock cycle'));
    const runnerWith = createWorkerVisionPageRunner({
      vault: vaultWith,
      extractor: extractorWith,
      sink: sinkWith,
      onWritingOutcome: writing.handler,
    });

    const vaultWithout = new MemoryVaultSource();
    vaultWithout.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sinkWithout = new RecordingSink();
    const extractorWithout = new FakeExtractor(() => completeResult('Figure 3: the rock cycle'));
    const runnerWithout = createWorkerVisionPageRunner({
      vault: vaultWithout,
      extractor: extractorWithout,
      sink: sinkWithout,
    }); // no onWritingOutcome

    const outcomeWith = await runnerWith(visionPageJob());
    const outcomeWithout = await runnerWithout(visionPageJob());

    expect(outcomeWith).toEqual(outcomeWithout);
    expect(extractorWith.requests).toEqual(extractorWithout.requests);
    expect(sinkWith.calls).toEqual(sinkWithout.calls);
    expect(writing.outcomes).toHaveLength(1); // still produced, whether or not a consumer is wired
  });
});
