/**
 * `ol-egov.141.89.5.73` parts 1-2 ([D-515]): the landed-units hook hands core's byte hash of each extracted
 * source (standalone or embedded in a note) along with the units, and never reads the file's bytes again to get it. Synthetic only.
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
import { hashContent } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildIngestionRunner } from '../../src/ingestion/wiring.js';

const PDF = 'Lectures/week2.pdf';
const NOTE = 'Lectures/Week 2.md';

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
    return [PDF, NOTE];
  }
  async read(path: VaultPath): Promise<string> {
    if (path === NOTE) return 'Slides: ![[week2.pdf]]\n';
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
    return path === PDF || path === NOTE;
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
  payload: Record<string, unknown>,
  onUnitsLanded?: (units: readonly unknown[], revisions?: ReadonlyMap<string, string>) => void,
) {
  const vault = new CountingVault();
  const { engine } = await buildIngestionRunner({
    vault,
    queueStore: new MemoryQueueStore(),
    capability: { canDrain: true },
    ...(onUnitsLanded ? { onUnitsLanded } : {}),
  });
  await engine.enqueue({ contentHash: 'job-hash-1', label: 'week 2', payload });
  await engine.tick();
  return vault.reads;
}

const SOURCE_JOB = { kind: 'source', sourcePath: PDF, format: 'pdf' };
const NOTE_JOB = { kind: 'note', notePath: NOTE };

describe("[D-515] the landed-units hook passes core's byte hash of each source", () => {
  it('a standalone source hands { sourcePath -> its byte hash } (not the job key), read once', async () => {
    let seen: ReadonlyMap<string, string> | undefined;
    const reads = await drain(SOURCE_JOB, (_units, revisions) => {
      seen = revisions;
    });
    expect(seen?.get(PDF)).toBe(await hashContent(pdf('Stratigraphic succession')));
    expect(seen?.get(PDF)).not.toBe('job-hash-1');
    expect(reads).toBe(1);
  });

  it("a PDF embedded in a note hands that PDF's byte hash, not the note job's, read once", async () => {
    let seen: ReadonlyMap<string, string> | undefined;
    const reads = await drain(NOTE_JOB, (_units, revisions) => {
      seen = revisions;
    });
    expect(seen?.get(PDF)).toBe(await hashContent(pdf('Stratigraphic succession')));
    expect(reads).toBe(1);
  });
});
