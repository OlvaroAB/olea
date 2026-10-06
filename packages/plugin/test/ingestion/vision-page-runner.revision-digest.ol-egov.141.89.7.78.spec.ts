/**
 * The vision page runner's revision digest (`ol-egov.141.89.7.78`, `[D-531]`): with
 * `deliverRevisionDigest` on, a page read from its image is delivered with the content hash of the
 * very bytes the runner read, keyed by its source, so the outcomes trigger can place it against the
 * document's current version and the page record can count the page extracted. With it off (the
 * default, and what `ingestion/wiring.ts`'s `buildVisionRunner` composes today) the delivery carries
 * no digest and nothing else the runner does changes. Written to olea-service
 * `features/F4-oracle.md`, F4.1, the scenario tagged with this file.
 *
 * Why it ships off: the same sink feeds `main.ts`'s `onUnitsLanded`, where a digest on a one-page
 * vision delivery would reach the citation-revision rewrite (`[D-518]`) and the generation
 * citations (`[D-515]`), which today see none for these deliveries. See the runner's field doc.
 *
 * Every string and byte below is invented (INV-3).
 */
import {
  type DocxFigureCueResult,
  docxFigureCue,
  type EmbeddedRasterImage,
  type ExtractedUnit,
  hashContent,
  type JobRunnerView,
  type VaultPath,
} from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  outcomeRevisionReadInFull,
  planOutcomeDelivery,
} from '../../../core/src/outcome/retire-on-revision.js';
import { createVaultUnitManifestStore } from '../../src/grove/unit-manifest-store.js';
import type { PdfPageRenderRequest, RenderedPage } from '../../src/ingestion/page-render/types.js';
import {
  bytesToBase64,
  createWorkerVisionPageRunner,
  type VisionPageExtractPort,
  type VisionPageExtractRequest,
  type VisionPageExtractResult,
  type WorkerVisionPageRunnerDeps,
} from '../../src/ingestion/vision-page-runner.js';
import { eventedTestVault } from '../grove/unit-manifest-test-vault.js';

vi.mock('olea-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('olea-core')>();
  return { ...actual, docxFigureCue: vi.fn() };
});

const IMAGE = 'Objectives/Synthetic scan.png' as VaultPath;
const PDF = 'Objectives/Synthetic objectives.pdf' as VaultPath;
const DOCX = 'Objectives/Synthetic objectives.docx' as VaultPath;

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF_BYTES = new TextEncoder().encode('%PDF-1.4 synthetic objectives, version one');
const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]);

/** Records every `receive` call with every argument it was given. */
class RecordingSink {
  readonly calls: {
    units: readonly ExtractedUnit[];
    args: number;
    revisions?: ReadonlyMap<string, string>;
  }[] = [];
  async receive(...args: [readonly ExtractedUnit[], ReadonlyMap<string, string>?]): Promise<void> {
    const [units, revisions] = args;
    this.calls.push({
      units,
      args: args.length,
      ...(revisions !== undefined ? { revisions } : {}),
    });
  }
}

class FakeExtractor implements VisionPageExtractPort {
  readonly requests: VisionPageExtractRequest[] = [];
  constructor(private readonly text: string) {}
  async extract(request: VisionPageExtractRequest): Promise<VisionPageExtractResult> {
    this.requests.push(request);
    return {
      outcome: 'complete',
      extractedText: this.text,
      figureDescription: null,
      coverage: null,
      unreadableReason: null,
      promptVersion: '1.0.0',
      modelId: 'model-synthetic',
    };
  }
}

const RENDERED: RenderedPage = {
  dataUrl: `data:image/png;base64,${bytesToBase64(IMAGE_BYTES)}`,
  mimeType: 'image/png',
  width: 300,
  height: 200,
};

function job(sourcePath: VaultPath, format: 'image' | 'pdf' | 'docx'): JobRunnerView {
  return {
    contentHash: `job-${format}`,
    label: 'a synthetic page',
    payload: { kind: 'vision-page', sourcePath, format, page: 1 },
    attempts: 0,
  };
}

function compose(overrides: Partial<WorkerVisionPageRunnerDeps> = {}) {
  const vault = eventedTestVault({ [IMAGE]: IMAGE_BYTES, [PDF]: PDF_BYTES, [DOCX]: DOCX_BYTES });
  const sink = new RecordingSink();
  const extractor = new FakeExtractor('Synthetic objective: describe the closed alpha process');
  const renderRequests: PdfPageRenderRequest[] = [];
  const runner = createWorkerVisionPageRunner({
    vault,
    extractor,
    sink,
    pageRenderer: {
      renderPage: async (request) => {
        renderRequests.push(request);
        return RENDERED;
      },
    },
    ...overrides,
  });
  return { vault, sink, extractor, runner, renderRequests };
}

beforeEach(() => {
  const image: EmbeddedRasterImage = { bytes: new Uint8Array([7, 7]), mimeType: 'image/png' };
  const cue: DocxFigureCueResult = { qualifies: true, images: [image] };
  vi.mocked(docxFigureCue).mockReturnValue(cue);
});

describe('with the vision digest switched on, a delivery carries the digest of the bytes read', () => {
  it('for a standalone image, a rendered PDF page and a document region alike', async () => {
    const { sink, runner } = compose({ deliverRevisionDigest: true });
    for (const [path, format] of [
      [IMAGE, 'image'],
      [PDF, 'pdf'],
      [DOCX, 'docx'],
    ] as const) {
      expect(await runner(job(path, format))).toEqual({ ok: true });
    }
    expect(sink.calls.map((call) => call.args)).toEqual([2, 2, 2]);
    expect(sink.calls.map((call) => [...(call.revisions ?? new Map())])).toEqual([
      [[IMAGE, await hashContent(IMAGE_BYTES)]],
      [[PDF, await hashContent(PDF_BYTES)]],
      [[DOCX, await hashContent(DOCX_BYTES)]],
    ]);
  });

  it('hashes the bytes read when the job drains, not the bytes that queued it', async () => {
    const { vault, sink, runner } = compose({ deliverRevisionDigest: true });
    const replaced = new TextEncoder().encode('%PDF-1.4 synthetic objectives, version two');
    vault.put(PDF, replaced);
    await runner(job(PDF, 'pdf'));
    expect(sink.calls[0]?.revisions?.get(PDF)).toBe(await hashContent(replaced));
  });

  it('a reading that lands no unit delivers nothing, digest or not', async () => {
    const { sink, runner } = compose({
      deliverRevisionDigest: true,
      extractor: {
        extract: async () => ({
          outcome: 'unreadable',
          extractedText: '',
          figureDescription: null,
          coverage: null,
          unreadableReason: 'blank-page',
        }),
      },
    });
    expect(await runner(job(IMAGE, 'image'))).toEqual({ ok: true });
    expect(sink.calls).toEqual([]);
  });
});

describe('with the switch off, the default, nothing the runner does changes', () => {
  it('delivers the same units, with no digest argument at all', async () => {
    const off = compose();
    const on = compose({ deliverRevisionDigest: true });
    for (const [path, format] of [
      [IMAGE, 'image'],
      [PDF, 'pdf'],
      [DOCX, 'docx'],
    ] as const) {
      expect(await off.runner(job(path, format))).toEqual(await on.runner(job(path, format)));
    }
    expect(off.sink.calls.map((call) => call.args)).toEqual([1, 1, 1]);
    expect(off.sink.calls.map((call) => call.units)).toEqual(
      on.sink.calls.map((call) => call.units),
    );
    expect(off.extractor.requests).toEqual(on.extractor.requests);
    expect(off.renderRequests).toEqual(on.renderRequests);
  });
});

describe('the page record accepts the digest as the current version', () => {
  it('so a document read from its image can be marked and read in full', async () => {
    const vault = eventedTestVault({ [IMAGE]: IMAGE_BYTES });
    const store = createVaultUnitManifestStore({
      vault,
      deviceId: 'olea-devicea0001',
      now: () => new Date('2026-10-06T10:00:00Z'),
    });
    await store.load();
    const sink = new RecordingSink();
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor: new FakeExtractor('Synthetic objective: compare the two beta models'),
      sink,
      onManifestEntry: (entry) => store.recordReading(entry),
      deliverRevisionDigest: true,
    });
    expect(await runner(job(IMAGE, 'image'))).toEqual({ ok: true });
    const digest = sink.calls[0]?.revisions?.get(IMAGE);
    expect(digest).toBe(await hashContent(IMAGE_BYTES));

    const before = await store.outcomeRevisionPagesFor(IMAGE);
    expect(before?.revisionDigest).toBe(digest);
    expect(planOutcomeDelivery(before, digest).standing).toBe('open');
    await store.recordOutcomeExtraction(IMAGE, digest as string, [1]);
    const after = await store.outcomeRevisionPagesFor(IMAGE);
    expect(after === undefined ? false : outcomeRevisionReadInFull(after)).toBe(true);
  });

  it('while without the digest the delivery is unplaced and the page is never marked', async () => {
    const vault = eventedTestVault({ [IMAGE]: IMAGE_BYTES });
    const store = createVaultUnitManifestStore({
      vault,
      deviceId: 'olea-devicea0001',
      now: () => new Date('2026-10-06T10:00:00Z'),
    });
    await store.load();
    const sink = new RecordingSink();
    const runner = createWorkerVisionPageRunner({
      vault,
      extractor: new FakeExtractor('Synthetic objective: compare the two beta models'),
      sink,
      onManifestEntry: (entry) => store.recordReading(entry),
    });
    await runner(job(IMAGE, 'image'));
    const pages = await store.outcomeRevisionPagesFor(IMAGE);
    expect(planOutcomeDelivery(pages, sink.calls[0]?.revisions?.get(IMAGE)).standing).toBe(
      'unplaced',
    );
    expect(pages === undefined ? true : outcomeRevisionReadInFull(pages)).toBe(false);
  });
});
