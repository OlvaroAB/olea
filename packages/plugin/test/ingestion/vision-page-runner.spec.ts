/**
 * `vision-page-runner.ts` tests (`ol-15f8`) — see
 * `features/F3-learn-from-anything.md`'s "Standalone image reaches
 * vision.extract.v1" scenarios, which this file's `describe`/`it` names are
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
  ExtractedUnit,
  JobRunnerView,
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
  WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  bytesToBase64,
  createWorkerVisionPageRunner,
  VISION_EXTRACT_CONTRACT_VERSION,
  VISION_EXTRACT_TASK_ID,
  type VisionPageExtractPort,
  type VisionPageExtractRequest,
  type VisionPageExtractResult,
  WorkerVisionPageExtractor,
  WorkerVisionPageExtractorError,
} from '../../src/ingestion/vision-page-runner.js';

/** Records what was sent and answers with whatever the test scripted — same shape `workerGroundingJudge.spec.ts` uses. */
class RecordingTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

function okResponse(result: unknown) {
  return { ok: true, stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'm' }, result };
}

// A tiny, real PNG signature followed by junk IHDR bytes — enough to be
// non-empty raw bytes for base64 round-tripping; this file never asserts
// anything about pixel content.
const FAKE_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
]);

describe('WorkerVisionPageExtractor — the frozen vocabulary it mirrors', () => {
  it('sends the task id the frozen catalogue reserves for W2/Slot V vision extraction', () => {
    expect(VISION_EXTRACT_TASK_ID).toBe(TASK_IDS.VISION_EXTRACT);
  });

  it('sends the current contract version', () => {
    expect(VISION_EXTRACT_CONTRACT_VERSION).toBe(2);
  });
});

describe('WorkerVisionPageExtractor — the request it builds', () => {
  it('sends exactly pageImageBase64 and mimeType, field for field with the service request shape', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ readable: true, extractedText: 'a page of text', unreadableReason: null }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    await extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' });

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe('vision.extract.v1');
    expect(request?.contractVersion).toBe(2);
    expect(request?.payload).toEqual({ pageImageBase64: 'QUJD', mimeType: 'image/png' });
  });
});

describe('WorkerVisionPageExtractor — the response it reads', () => {
  it('returns readable/extractedText/unreadableReason field for field on a readable page', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        readable: true,
        extractedText: 'Stratigraphic succession',
        unreadableReason: null,
      }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    const result = await extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' });

    expect(result).toEqual({
      readable: true,
      extractedText: 'Stratigraphic succession',
      unreadableReason: null,
    });
  });

  it("returns a readable: false result just as faithfully — INV-5's honest refusal, not an error", async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ readable: false, extractedText: '', unreadableReason: 'blank-page' }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    const result = await extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' });

    expect(result).toEqual({ readable: false, extractedText: '', unreadableReason: 'blank-page' });
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
    const transport = new RecordingTransport(() => ({ result: { readable: true } }));
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

  it('throws when result.readable is missing or not boolean', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ extractedText: '', unreadableReason: null }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    await expect(
      extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
    ).rejects.toThrow(WorkerVisionPageExtractorError);
  });

  it('throws when result.extractedText is missing or not a string', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ readable: true, unreadableReason: null }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    await expect(
      extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
    ).rejects.toThrow(WorkerVisionPageExtractorError);
  });

  it('throws when result.unreadableReason is present but neither null nor a string', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ readable: false, extractedText: '', unreadableReason: 42 }),
    );
    const extractor = new WorkerVisionPageExtractor({ transport });

    await expect(
      extractor.extract({ pageImageBase64: 'QUJD', mimeType: 'image/png' }),
    ).rejects.toThrow(WorkerVisionPageExtractorError);
  });
});

describe('bytesToBase64', () => {
  it('round-trips through atob to the original bytes', () => {
    const encoded = bytesToBase64(FAKE_PNG_BYTES);
    const decoded = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(FAKE_PNG_BYTES));
  });

  it('carries no `data:` prefix — the exact shape vision.extract.v1 requires', () => {
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
  it('reads the file, sends it as base64, and lands one ExtractedUnit in the sink', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => ({
      readable: true,
      extractedText: 'Figure 3: the rock cycle',
      unreadableReason: null,
    }));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(visionPageJob());

    expect(outcome).toEqual({ ok: true });
    expect(extractor.requests).toHaveLength(1);
    expect(extractor.requests[0]?.mimeType).toBe('image/png');
    expect(extractor.requests[0]?.pageImageBase64).toBe(bytesToBase64(FAKE_PNG_BYTES));

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
    const extractor = new FakeExtractor(() => ({
      readable: true,
      extractedText: 'embedded figure text',
      unreadableReason: null,
    }));
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
    const extractor = new FakeExtractor(() => ({
      readable: true,
      extractedText: 'text',
      unreadableReason: null,
    }));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: path, format: 'image', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: true });
  });
});

describe('createWorkerVisionPageRunner — INV-5: an unreadable page is a refusal, never a fabrication', () => {
  it("a readable: false result (the server's empty-context guard, or the model's own refusal) produces zero units and ok: true", async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/blank.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => ({
      readable: false,
      extractedText: '',
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

  it('a readable: true result with empty text is treated the same honest way — no unit invented from nothing', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/edge.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => ({
      readable: true,
      extractedText: '',
      unreadableReason: null,
    }));
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
    const extractor = new FakeExtractor(() => ({
      readable: true,
      extractedText: 'x',
      unreadableReason: null,
    }));
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

  it('a page inside a pdf/pptx/docx names the missing renderer (ol-9cle) and is non-retryable', async () => {
    const vault = new MemoryVaultSource();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => ({
      readable: true,
      extractedText: 'x',
      unreadableReason: null,
    }));
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
    const extractor = new FakeExtractor(() => ({
      readable: true,
      extractedText: 'x',
      unreadableReason: null,
    }));
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
    const extractor = new FakeExtractor(() => ({
      readable: true,
      extractedText: 'x',
      unreadableReason: null,
    }));
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(
      visionPageJob({
        payload: { kind: 'vision-page', sourcePath: 'Slides/flaky.png', format: 'image', page: 1 },
      }),
    );

    expect(outcome).toEqual({ ok: false, retryable: true });
  });

  it('anything wrong with the vision.extract.v1 call itself is non-retryable per DF-21 — retrying reaches the same bytes and the same refusal', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Slides/diagram.png', FAKE_PNG_BYTES);
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => {
      throw new WorkerVisionPageExtractorError('the Worker refused the request (upstream-error)');
    });
    const runner = createWorkerVisionPageRunner({ vault, extractor, sink });

    const outcome = await runner(visionPageJob());

    expect(outcome).toEqual({
      ok: false,
      retryable: false,
      reason: expect.stringContaining('hash-abc123'),
    });
    expect(sink.calls).toHaveLength(0);
  });
});

describe('createWorkerVisionPageRunner — D-005: never names her material', () => {
  it("every non-retryable reason names the job's content hash, never the sourcePath or label", async () => {
    const vault = new MemoryVaultSource();
    const sink = new RecordingSink();
    const extractor = new FakeExtractor(() => {
      throw new Error('boom');
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
