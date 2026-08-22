import { describe, expect, it } from 'vitest';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import { buildFullIndex } from './build.js';
import type { YieldScheduler } from './scheduling.js';
import { createCancellationController } from './scheduling.js';

/**
 * In-memory `VaultSource` that records every `read()` call, in order. This
 * is the instrument the cancellation test uses to prove real work stopped:
 * counting reads is a direct measure of documents actually indexed, not a
 * flag `buildFullIndex` could set without doing (or skipping) the work it
 * describes.
 */
class RecordingVaultSource implements VaultSource {
  readonly reads: VaultPath[] = [];
  private readonly files: Map<string, string>;

  constructor(files: Record<string, string>) {
    this.files = new Map(Object.entries(files));
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    let paths = [...this.files.keys()];
    if (options.under !== undefined) {
      const under = options.under;
      paths = paths.filter((p) => p === under || p.startsWith(`${under}/`));
    }
    return paths.sort();
  }

  async read(path: VaultPath): Promise<string> {
    this.reads.push(path);
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }

  async readBinary(): Promise<Uint8Array> {
    throw new Error('not used');
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  watch(): Unsubscribe {
    return () => {};
  }
}

/**
 * A fully test-controlled `YieldScheduler` — no real timer anywhere. Resolves
 * `yield()` on the microtask queue only, and calls `onYield` synchronously
 * first so a test can react (e.g. cancel) exactly on a chosen chunk boundary.
 */
class RecordingScheduler implements YieldScheduler {
  yieldCount = 0;
  constructor(private readonly onYield?: (count: number) => void) {}

  async yield(): Promise<void> {
    this.yieldCount += 1;
    this.onYield?.(this.yieldCount);
  }
}

function vaultWithDocs(count: number): RecordingVaultSource {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    // Zero-padded so `list()`'s sorted order matches numeric order.
    files[`doc-${String(i).padStart(2, '0')}.md`] = `# Doc ${i}\nbody ${i}\n`;
  }
  return new RecordingVaultSource(files);
}

describe('buildFullIndex — chunking (C2.6, Q6.2)', () => {
  it('processes documents in bounded chunks and reports progress with a running count after each', async () => {
    const vault = vaultWithDocs(7);
    const progress: Array<{ documentsProcessed: number; documentsTotal: number }> = [];
    const scheduler = new RecordingScheduler();

    const result = await buildFullIndex({
      vault,
      scheduler,
      chunkSize: 3,
      onProgress: (p) => progress.push(p),
    });

    expect(result.status).toBe('complete');
    expect(progress).toEqual([
      { documentsProcessed: 3, documentsTotal: 7 },
      { documentsProcessed: 6, documentsTotal: 7 },
      { documentsProcessed: 7, documentsTotal: 7 },
    ]);
  });

  it('yields between chunks but not after the final one', async () => {
    const vault = vaultWithDocs(7);
    const scheduler = new RecordingScheduler();

    await buildFullIndex({ vault, scheduler, chunkSize: 3 });

    // 3 chunks (3, 3, 1) -> 2 gaps between them, never a trailing yield.
    expect(scheduler.yieldCount).toBe(2);
  });

  it('a single chunk covering the whole vault never yields at all', async () => {
    const vault = vaultWithDocs(5);
    const scheduler = new RecordingScheduler();

    await buildFullIndex({ vault, scheduler, chunkSize: 10 });

    expect(scheduler.yieldCount).toBe(0);
  });

  it('an empty vault completes with an empty index and never yields', async () => {
    const vault = vaultWithDocs(0);
    const scheduler = new RecordingScheduler();

    const result = await buildFullIndex({ vault, scheduler, chunkSize: 3 });

    expect(result).toEqual({ status: 'complete', index: { version: 1, documents: [] } });
    expect(scheduler.yieldCount).toBe(0);
  });
});

describe('buildFullIndex — cancellation actually stops work (C2.6, Q6.2)', () => {
  it('cancelling during a between-chunk yield stops indexing before the next chunk reads anything', async () => {
    const vault = vaultWithDocs(10);
    const controller = createCancellationController();
    // Cancel exactly when the 2nd yield fires — i.e. after chunks 1 and 2
    // (6 documents) have been indexed, before chunk 3 starts.
    const scheduler = new RecordingScheduler((count) => {
      if (count === 2) controller.cancel();
    });

    const result = await buildFullIndex({
      vault,
      scheduler,
      signal: controller.signal,
      chunkSize: 3,
    });

    expect(result).toEqual({ status: 'cancelled' });
    // The real proof: only the documents from the two completed chunks were
    // ever read. If cancellation were a flag checked only after finishing
    // the loop (or not checked at all), this would be 10, not 6.
    expect(vault.reads).toEqual([
      'doc-00.md',
      'doc-01.md',
      'doc-02.md',
      'doc-03.md',
      'doc-04.md',
      'doc-05.md',
    ]);
    expect(vault.reads.length).toBeLessThan(10);
  });

  it('a signal already cancelled before the build starts reads nothing at all', async () => {
    const vault = vaultWithDocs(5);
    const controller = createCancellationController();
    controller.cancel();
    const scheduler = new RecordingScheduler();

    const result = await buildFullIndex({
      vault,
      scheduler,
      signal: controller.signal,
      chunkSize: 2,
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(vault.reads).toEqual([]);
  });

  it('a build with no signal at all cannot be cancelled and always completes', async () => {
    const vault = vaultWithDocs(4);
    const scheduler = new RecordingScheduler();

    const result = await buildFullIndex({ vault, scheduler, chunkSize: 1 });

    expect(result.status).toBe('complete');
    expect(vault.reads.length).toBe(4);
  });
});
