/**
 * D-381 (`ol-egov.141.89.5.18`; chg.md §11's cache-key audit, row 1) —
 * `buildIngestionArrivalWatch` now enqueues a raw source with a
 * `workflowVersion` (`extraction-workflow-version.ts`). Kept separate from
 * `arrival-watch.spec.ts` so that suite's existing assertions (still
 * exercised there, unchanged) stay a clean signal of everything else.
 */
import type {
  EnqueueInput,
  EnqueueResult,
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildIngestionArrivalWatch,
  createInMemoryLastChangedTracker,
} from '../../src/ingestion/arrival-watch.js';
import { EXTRACTION_WORKFLOW_VERSION } from '../../src/ingestion/extraction-workflow-version.js';

class MemoryVaultSource implements VaultSource {
  private readonly binary = new Map<string, Uint8Array>();
  setBinary(path: VaultPath, bytes: Uint8Array): void {
    this.binary.set(path, bytes);
  }
  async list(_options: ListOptions = {}): Promise<readonly VaultPath[]> {
    return [...this.binary.keys()].sort();
  }
  async read(path: VaultPath): Promise<string> {
    throw new Error(`no text files (${path})`);
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const found = this.binary.get(path);
    if (!found) throw new Error(`not found: ${path}`);
    return found;
  }
  async write(): Promise<void> {
    throw new Error('not needed by these tests');
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.binary.has(path);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

class RecordingEnqueuer {
  readonly calls: EnqueueInput[] = [];
  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    this.calls.push(input);
    return { status: 'queued' };
  }
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('buildIngestionArrivalWatch — D-381 workflowVersion', () => {
  it('every enqueue for a raw source carries the current EXTRACTION_WORKFLOW_VERSION', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('lecture.pdf', new Uint8Array([1, 2, 3]));
    const enqueuer = new RecordingEnqueuer();
    let handler: (event: VaultEvent) => void = () => {};

    buildIngestionArrivalWatch({
      vault,
      enqueuer,
      tracker: createInMemoryLastChangedTracker(),
      watch: (h) => {
        handler = h;
        return () => {};
      },
    });

    handler({ kind: 'create', path: 'lecture.pdf' });
    await flushAsync();

    expect(enqueuer.calls).toHaveLength(1);
    expect((enqueuer.calls[0] as EnqueueInput & { workflowVersion?: string }).workflowVersion).toBe(
      EXTRACTION_WORKFLOW_VERSION,
    );
    // A real, non-empty composite — not an accidentally-empty string.
    expect(EXTRACTION_WORKFLOW_VERSION.length).toBeGreaterThan(0);
  });
});
