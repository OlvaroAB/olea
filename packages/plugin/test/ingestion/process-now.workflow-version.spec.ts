/**
 * D-381 (`ol-egov.141.89.5.18`; chg.md §11's cache-key audit, row 1) —
 * `createProcessNowAction`'s source-file branch now enqueues with a
 * `workflowVersion` (`extraction-workflow-version.ts`), the same value
 * `arrival-watch.ts` supplies for the identical reason (both paths feed the
 * same idempotent `enqueue`). Kept separate from `process-now.spec.ts` so
 * that suite's existing assertions (still exercised there, unchanged) stay
 * a clean signal of everything else.
 */
import type {
  EnqueueInput,
  EnqueueResult,
  ListOptions,
  TickResult,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createProcessNowAction } from '../../src/ingestion/process-now.js';
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
    throw new Error('process-now must never write to the vault (INV-6)');
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

describe('createProcessNowAction — D-381 workflowVersion', () => {
  it('a source-file override enqueue carries the current EXTRACTION_WORKFLOW_VERSION — the same value arrival-watch.ts supplies', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/week2.pdf', new Uint8Array([1, 2, 3]));
    const enqueuer = new RecordingEnqueuer();
    const scriptedTick: () => Promise<TickResult> = async () => ({
      kind: 'idle',
      reason: 'nothing-eligible',
    });

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: scriptedTick,
      onAuthoredNoteUnits: () => {
        throw new Error('a source file never reaches the authored-note hook');
      },
    });

    await action.processNow('Lectures/week2.pdf');

    expect(enqueuer.calls).toHaveLength(1);
    expect((enqueuer.calls[0] as EnqueueInput & { workflowVersion?: string }).workflowVersion).toBe(
      EXTRACTION_WORKFLOW_VERSION,
    );
  });
});
