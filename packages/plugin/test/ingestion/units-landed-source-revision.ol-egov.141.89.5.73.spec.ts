/**
 * `ol-egov.141.89.5.73` part 1 ([D-515]): the landed-units hook hands the drained job's content
 * hash along with the units, and never reads the file's bytes again to get it. Synthetic only.
 */
import type {
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

const PDF = 'Lectures/week2.pdf';

function pdf(text: string): Uint8Array {
  const raw = `BT /F1 12 Tf 20 150 Td (${text}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n',
    `5 0 obj\n<< /Length ${raw.length} >>\nstream\n${raw}\nendstream\nendobj\n`,
  ];
  const s = `%PDF-1.4\n${objects.join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF`;
  return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
}

class CountingVault implements VaultSource {
  reads = 0;
  async list(_o: ListOptions = {}): Promise<readonly VaultPath[]> {
    return [PDF];
  }
  async read(path: VaultPath): Promise<string> {
    throw new Error(`no text: ${path}`);
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    this.reads += 1;
    if (path !== PDF) throw new Error('not found');
    return pdf('Stratigraphic succession');
  }
  async write(): Promise<void> {
    throw new Error('unused');
  }
  async exists(path: VaultPath): Promise<boolean> {
    return path === PDF;
  }
  watch(_h: (e: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

class MemoryQueueStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(q: PersistedQueue): Promise<void> {
    this.state = q;
  }
}

async function drain(
  onUnitsLanded?: (units: readonly unknown[], revisions?: ReadonlyMap<string, string>) => void,
) {
  const vault = new CountingVault();
  const { engine } = await buildIngestionRunner({
    vault,
    queueStore: new MemoryQueueStore(),
    capability: { canDrain: true },
    ...(onUnitsLanded ? { onUnitsLanded } : {}),
  });
  await engine.enqueue({
    contentHash: 'job-hash-1',
    label: 'week 2',
    payload: { kind: 'source', sourcePath: PDF, format: 'pdf' },
  });
  await engine.tick();
  return vault.reads;
}

describe('[D-515] withUnitsLandedHook passes the drained job hash', () => {
  it('a source job hands { sourcePath -> job contentHash } to the hook, with no extra file read', async () => {
    const baseline = await drain();
    let seen: ReadonlyMap<string, string> | undefined;
    const reads = await drain((_units, revisions) => {
      seen = revisions;
    });
    expect(seen?.get(PDF)).toBe('job-hash-1');
    expect(reads).toBe(baseline);
  });
});
