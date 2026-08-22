/**
 * `buildIngestionRunner` tests (C3, P3-T03a / DF-21a) — see
 * `features/C3-ingestion.md`'s "Plugin-side extraction runner wiring"
 * scenarios, which this file's `describe`/`it` names are written to
 * satisfy directly.
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`VaultSource`, `QueueStore`, `DeviceCapability` — all structural ports
 * `olea-core` defines) — no `obsidian` import anywhere in this file, and
 * none needed: `wiring.ts` itself never imports `obsidian` (see its module
 * doc), so this is a full, real exercise of the composition logic, not a
 * mock of it. What is NOT proven here, because it cannot be without a
 * running Obsidian host: that `main.ts` actually calls `buildIngestionRunner`
 * with a real `ObsidianSource`/`ObsidianQueueStore`/`obsidianDeviceCapability()`
 * and that a real `Vault` produces the same result — see this bead's report
 * for what stays unproven and the `@manual` scenario in
 * `features/C3-ingestion.md`.
 */
import type {
  ExtractedUnit,
  ListOptions,
  PersistedQueue,
  QueueStore,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildIngestionRunner } from '../../src/ingestion/wiring.js';

// ---- a tiny hand-built single-page PDF, same technique
// `packages/core/src/ingestion/extraction-runner.spec.ts` uses (see its own
// comment): enough to exercise the real pdf extractor's text layer, not a
// mock of it. Invented content only (INV-3).

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function buildOnePagePdf(pageText: string): Uint8Array {
  const raw = `BT /F1 12 Tf 20 150 Td (${escapePdfLiteral(pageText)}) Tj ET`;
  const streamText = new TextDecoder('latin1').decode(asciiBytes(raw));
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n',
    `5 0 obj\n<< /Length ${streamText.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
  ];
  const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF';
  return asciiBytes(`%PDF-1.4\n${objects.join('')}${trailer}`);
}

/** In-memory `VaultSource` — the plugin's own testable seam for anything that would otherwise need a real Obsidian `Vault` (same role `ObsidianSource` fills in production; see `vault/obsidian-source.ts`'s module doc for why that class itself has no test file). */
class MemoryVaultSource implements VaultSource {
  private readonly binary = new Map<string, Uint8Array>();

  setBinary(path: VaultPath, bytes: Uint8Array): void {
    this.binary.set(path, bytes);
  }

  async list(_options: ListOptions = {}): Promise<readonly VaultPath[]> {
    return [...this.binary.keys()].sort();
  }

  async read(path: VaultPath): Promise<string> {
    throw new Error(`MemoryVaultSource.read: no text files in this fake (${path})`);
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
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

/** In-memory `QueueStore` — the same role `ObsidianQueueStore` fills over `data.json` in production. */
class MemoryQueueStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = queue;
  }
}

const CAN_DRAIN = { canDrain: true };
const CANNOT_DRAIN = { canDrain: false };

describe('buildIngestionRunner — construction', () => {
  it('resolves an engine and a sink, with the deferred enqueuer already bound (enqueue works immediately)', async () => {
    const vault = new MemoryVaultSource();
    const { engine, sink } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
    });

    expect(engine).toBeDefined();
    expect(sink).toBeDefined();
    expect(sink.all()).toEqual([]);

    // The runner's `deferredEnqueuer` is bound before `buildIngestionRunner`
    // resolves — enqueueing a vision-page follow-on job (something only the
    // runner itself does, deep inside a drain) would throw
    // "called before bind()" if it weren't. Proven indirectly below by a
    // full drain succeeding; proven directly here by the engine itself
    // being usable immediately.
    const result = await engine.enqueue({
      contentHash: 'construction-check',
      label: 'construction check',
      payload: { kind: 'source', sourcePath: 'nope.pdf', format: 'pdf' },
    });
    expect(result).toEqual({ status: 'queued' });
  });
});

describe('buildIngestionRunner — a lecture enqueued drains and produces indexed units', () => {
  it('enqueuing a PDF source job and ticking the engine extracts it through to the sink', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary(
      'Lectures/GEOL204-week2.pdf',
      buildOnePagePdf('GEOL204 Week 2 — Stratigraphic succession'),
    );

    const { engine, sink } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
    });

    const enqueueResult = await engine.enqueue({
      contentHash: 'lecture-week2',
      label: 'GEOL204 Week 2',
      payload: { kind: 'source', sourcePath: 'Lectures/GEOL204-week2.pdf', format: 'pdf' },
    });
    expect(enqueueResult).toEqual({ status: 'queued' });
    expect(sink.all()).toEqual([]); // nothing drained yet — enqueue alone extracts nothing

    const tick = await engine.tick();
    expect(tick).toEqual({ kind: 'ran', contentHash: 'lecture-week2', outcome: 'done' });

    const units: readonly ExtractedUnit[] = sink.forSource('Lectures/GEOL204-week2.pdf');
    expect(units).toHaveLength(1);
    expect(units[0]?.text).toContain('Stratigraphic succession');
    expect(units[0]?.provenance.sourcePath).toBe('Lectures/GEOL204-week2.pdf');
    expect(units[0]?.provenance.location.page).toBe(1);
    expect(sink.all()).toEqual(units);

    // The job itself is now recorded done — draining again is a no-op, not
    // a re-extraction (D-002 idempotency), so the sink gains nothing more.
    const secondTick = await engine.tick();
    expect(secondTick).toEqual({ kind: 'idle', reason: 'nothing-eligible' });
    expect(sink.forSource('Lectures/GEOL204-week2.pdf')).toHaveLength(1);
  });

  it('a device that cannot drain (mobile, D-002) enqueues but never extracts — the sink stays empty', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/deck.pdf', buildOnePagePdf('A lecture deck.'));

    const { engine, sink } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CANNOT_DRAIN,
    });

    await engine.enqueue({
      contentHash: 'mobile-lecture',
      label: 'A lecture deck',
      payload: { kind: 'source', sourcePath: 'Lectures/deck.pdf', format: 'pdf' },
    });

    const tick = await engine.tick();
    expect(tick).toEqual({ kind: 'blocked', reason: 'device-cannot-drain' });
    expect(sink.all()).toEqual([]);
  });
});
