/**
 * `ol-egov.141.89.7.82` ([D-518], [D-515]): the vision page runner composed with its revision digest
 * switched on, in this test only. Production leaves it off (`ingestion/wiring.ts` buildVisionRunner
 * passes no `deliverRevisionDigest`), because turning it on also changes when questions drafted
 * from image pages are held ([D-515]), which is not ruled.
 *
 * The composition is the one production runs, minus the queue: core's extraction runner reads a
 * synthetic PDF with two text pages and one image page, lands the text pages and enqueues the image
 * page; the vision page runner renders and reads that page and lands it. Both land in a sink that
 * hands a delivery with a digest to `CitationRevisionTrigger.onSourceUnitsLanded`, exactly as
 * `ingestion/wiring.ts` withUnitsLandedHook and `main.ts` onUnitsLanded do (the trigger before the
 * generation sweep, and only for a delivery that carries a digest).
 *
 * The [D-515] group reports, without deciding, what the digest changes for a question drafted from
 * an image page: its citation records the digest of the delivery it was drafted from
 * (`generation/pipeline.ts` citationFromUnit takes `sourceRevisions.get(sourcePath)`), seeded here
 * as that function would write it. Every string and byte is invented (INV-3).
 */
import {
  createExtractionJobRunner,
  type EnqueueInput,
  type ExtractedUnit,
  hashContent,
  type JobEnqueuer,
  type JobRunnerView,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  bytesToBase64,
  createWorkerVisionPageRunner,
  type VisionPageExtractPort,
  type VisionPageExtractRequest,
  type VisionPageExtractResult,
} from '../../../src/ingestion/vision-page-runner.js';
import {
  DOC,
  type Harness,
  heldIds,
  MemoryVaultSource,
  type QuestionSpec,
  rewrites,
  seedQuestions,
  setup,
} from './source-rewrite-harness.ol-egov.141.89.7.82.js';

/** A minimal PDF, one page per entry; an empty entry is a page with no text layer, routed to vision. */
function pdfBytes(pages: readonly string[]): Uint8Array {
  const escapePdf = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  pages.forEach((text, i) => {
    const raw = `BT /F1 12 Tf 20 150 Td (${escapePdf(text)}) Tj ET`;
    objects.push(
      `${4 + i * 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
      `${5 + i * 2} 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
    );
  });
  const text = `%PDF-1.4\n${objects.join('')}trailer\n<< /Size ${4 + pages.length * 2} /Root 1 0 R >>\nstartxref\n0\n%%EOF`;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

const V1 = pdfBytes([
  'Ashwillow bark cracks in long vertical seams.',
  'Cindergrass returns first after a heath fire.',
  '',
]);
const V2 = pdfBytes([
  'Ashwillow bark peels in thin horizontal strips.',
  'Cindergrass returns only after the second winter.',
  '',
]);
const READING_V1 = 'Synthetic figure: a heath transect, before the fire.';
const READING_V2 = 'Synthetic figure: a heath transect, two winters after the fire.';

class SettableExtractor implements VisionPageExtractPort {
  text = READING_V1;
  readonly requests: VisionPageExtractRequest[] = [];
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

interface Landing {
  readonly units: readonly ExtractedUnit[];
  readonly revisions?: ReadonlyMap<string, string>;
}

/** The runners as production composes them, with the vision digest as given, landing in the trigger. */
function compose(vault: MemoryVaultSource, harness: Harness, deliverRevisionDigest: boolean) {
  const landings: Landing[] = [];
  const visionJobs: EnqueueInput[] = [];
  const sink = {
    async receive(units: readonly ExtractedUnit[], revisions?: ReadonlyMap<string, string>) {
      landings.push({ units, ...(revisions !== undefined ? { revisions } : {}) });
      // As main.ts onUnitsLanded: the rewrite sees a delivery only when it carries a digest.
      if (revisions !== undefined && revisions.size > 0) {
        await harness.trigger.onSourceUnitsLanded(vault, harness.actions, units, revisions);
      }
    },
  };
  const enqueuer: JobEnqueuer = {
    enqueue: async (input) => {
      visionJobs.push(input);
      return { status: 'queued' };
    },
  };
  const extractor = new SettableExtractor();
  const extraction = createExtractionJobRunner({ vault, enqueuer, sink });
  const vision = createWorkerVisionPageRunner({
    vault,
    extractor,
    sink,
    pageRenderer: {
      renderPage: async () => ({
        dataUrl: `data:image/png;base64,${bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7]))}`,
        mimeType: 'image/png',
        width: 300,
        height: 200,
      }),
    },
    deliverRevisionDigest,
  });

  /** One drain of the file as it is now: the text-layer job, then every image page it enqueued. */
  async function drain(reading: string): Promise<void> {
    visionJobs.length = 0;
    const source: JobRunnerView = {
      contentHash: `source-job-${landings.length}`,
      label: 'synthetic handout',
      payload: { kind: 'source', sourcePath: DOC, format: 'pdf' },
      attempts: 0,
    };
    expect(await extraction(source)).toEqual({ ok: true });
    extractor.text = reading;
    for (const job of [...visionJobs]) {
      expect(
        await vision({
          contentHash: job.contentHash,
          label: job.label,
          payload: job.payload,
          attempts: 0,
        }),
      ).toEqual({ ok: true });
    }
  }
  return { drain, landings, visionJobs, extractor };
}

/** The text a delivery landed for one page, units joined as the rewrite joins them. */
function landedPageText(landings: readonly Landing[], page: number): string[] {
  return landings.map((landing) =>
    landing.units
      .filter((unit) => unit.provenance.location.page === page)
      .map((unit) => unit.text)
      .join('\n\n'),
  );
}

async function vaultAt(bytes: Uint8Array, questions: readonly QuestionSpec[]) {
  const vault = new MemoryVaultSource();
  vault.binaries.set(DOC, bytes);
  seedQuestions(vault, questions);
  const harness = setup();
  await harness.trigger.tick(vault, harness.actions);
  return { vault, harness };
}

describe('with the vision digest switched on, a document with text and image pages is rewritten from all its pages', () => {
  it('each question from its own page of the new version, the image page from its new reading', async () => {
    const v1 = await hashContent(V1);
    const { vault, harness } = await vaultAt(V1, [
      { id: 'qt1', page: 1, revision: v1 },
      { id: 'qt2', page: 2, revision: v1 },
      { id: 'qi3', page: 3, revision: v1 },
    ]);
    expect(await heldIds(harness)).toEqual([]);

    // The file changes; its extraction lands before the next pass, as the arrival watch drives it.
    vault.binaries.set(DOC, V2);
    const { drain, landings } = compose(vault, harness, true);
    await drain(READING_V2);
    const v2 = await hashContent(V2);
    // Two deliveries, both carrying the new bytes' digest: the text pages, then the image page.
    expect(landings.map((landing) => [...(landing.revisions ?? new Map())])).toEqual([
      [[DOC, v2]],
      [[DOC, v2]],
    ]);
    expect(
      landings.map((l) => [...new Set(l.units.map((u) => u.provenance.location.page))]),
    ).toEqual([[1, 2], [3]]);

    await harness.trigger.tick(vault, harness.actions);
    const [page1] = landedPageText(landings, 1);
    const [page2] = landedPageText(landings, 2);
    expect(page1).toContain('horizontal strips');
    expect(page2).toContain('second winter');
    expect(Object.fromEntries(rewrites(harness))).toEqual({
      qt1: { text: page1, revision: v2 },
      qt2: { text: page2, revision: v2 },
      qi3: { text: READING_V2, revision: v2 },
    });
    expect(await heldIds(harness)).toEqual([]);
    expect(harness.judge.judge).not.toHaveBeenCalled();
  });

  it('held first, each question is rewritten as its page lands', async () => {
    const v1 = await hashContent(V1);
    const { vault, harness } = await vaultAt(V1, [
      { id: 'qt1', page: 1, revision: v1 },
      { id: 'qi3', page: 3, revision: v1 },
    ]);
    vault.binaries.set(DOC, V2);
    await harness.trigger.tick(vault, harness.actions);
    expect(await heldIds(harness)).toEqual(['qi3', 'qt1']);

    const { drain } = compose(vault, harness, true);
    await drain(READING_V2);
    expect(rewrites(harness).get('qt1')?.text).toContain('horizontal strips');
    expect(rewrites(harness).get('qi3')).toEqual({
      text: READING_V2,
      revision: await hashContent(V2),
    });
    expect(await heldIds(harness)).toEqual([]);
  });

  it('the same composition with the digest off, as today, leaves the image page held with no text', async () => {
    const v1 = await hashContent(V1);
    const { vault, harness } = await vaultAt(V1, [
      { id: 'qt1', page: 1, revision: v1 },
      { id: 'qi3', page: 3, revision: v1 },
    ]);
    vault.binaries.set(DOC, V2);
    const { drain, landings } = compose(vault, harness, false);
    await drain(READING_V2);
    expect(landings.map((landing) => landing.revisions === undefined)).toEqual([false, true]);
    await harness.trigger.tick(vault, harness.actions);
    expect([...rewrites(harness).keys()]).toEqual(['qt1']);
    expect(await heldIds(harness)).toEqual(['qi3']);
  });
});

describe('[D-515], reported and not ruled: when a question drafted from an image page is held', () => {
  /** Drafts the image page's question from a drain of V1, recording what citationFromUnit would. */
  async function draftedFromImagePage(deliverRevisionDigest: boolean) {
    const scratch = new MemoryVaultSource();
    scratch.binaries.set(DOC, V1);
    const { drain, landings } = compose(scratch, setup(), deliverRevisionDigest);
    await drain(READING_V1);
    const imageDelivery = landings.find((landing) =>
      landing.units.some((unit) => unit.provenance.location.page === 3),
    );
    const revision = imageDelivery?.revisions?.get(DOC);
    const { vault, harness } = await vaultAt(V1, [
      { id: 'qi3', page: 3, ...(revision !== undefined ? { revision } : {}) },
    ]);
    return { vault, harness, revision };
  }

  it('digest off (today): no file version is recorded, so it is held at once and never rewritten', async () => {
    const { vault, harness, revision } = await draftedFromImagePage(false);
    expect(revision).toBeUndefined();
    // Held at the first pass, the file unchanged.
    expect(await heldIds(harness)).toEqual(['qi3']);

    vault.binaries.set(DOC, V2);
    await harness.trigger.tick(vault, harness.actions);
    const { drain } = compose(vault, harness, false);
    await drain(READING_V2);
    await harness.trigger.tick(vault, harness.actions);
    expect(rewrites(harness).size).toBe(0);
    expect(await heldIds(harness)).toEqual(['qi3']);
  });

  it('digest on: not held while the file is unchanged, held when it changes, rewritten from the new reading', async () => {
    const { vault, harness, revision } = await draftedFromImagePage(true);
    expect(revision).toBe(await hashContent(V1));
    expect(await heldIds(harness)).toEqual([]);
    await harness.trigger.tick(vault, harness.actions);
    expect(await heldIds(harness)).toEqual([]);

    vault.binaries.set(DOC, V2);
    await harness.trigger.tick(vault, harness.actions);
    expect(await heldIds(harness)).toEqual(['qi3']);
    const { drain } = compose(vault, harness, true);
    await drain(READING_V2);
    expect(rewrites(harness).get('qi3')).toEqual({
      text: READING_V2,
      revision: await hashContent(V2),
    });
    expect(await heldIds(harness)).toEqual([]);
  });
});
