/**
 * `ol-egov.141.89.5.73` part 4 ([D-515], [D-508]): the citation pass compares a non-markdown
 * source's current bytes with the sidecar's `sourceRevision`, and withholds the question on a
 * change, before any judge call. Synthetic bytes only.
 */
import type {
  ListOptions,
  RevisionJudgePort,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { citationStorePath, hashContent } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianCitationHashStore } from '../../../src/ingestion/materiality/citation-hash-store.js';
import {
  CitationRevisionTrigger,
  SOURCE_REVISION_REASON,
} from '../../../src/ingestion/materiality/citation-revision-wiring.js';

class MemoryVaultSource implements VaultSource {
  readonly files = new Map<string, string>();
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const extensions = options.extensions?.map((e) => e.toLowerCase());
    return [...this.files.keys()]
      .filter(
        (p) =>
          extensions === undefined ||
          extensions.includes(p.slice(p.lastIndexOf('.') + 1).toLowerCase()),
      )
      .sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }
  readonly binaries = new Map<string, Uint8Array>();
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const bytes = this.binaries.get(path);
    if (bytes === undefined) throw new Error(`not found: ${path}`);
    return bytes;
  }
  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path) || this.binaries.has(path);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

const PDF = 'Synthetic/sample source.pdf';
const bytesV1 = new TextEncoder().encode('synthetic pdf bytes, version one');
const bytesV2 = new TextEncoder().encode('synthetic pdf bytes, version two');

async function seed(sidecarRevision: 'match' | 'missing'): Promise<MemoryVaultSource> {
  const vault = new MemoryVaultSource();
  vault.files.set('Synthetic/qa (Olea).md', homeNote('qa'));
  vault.binaries.set(PDF, bytesV1);
  vault.files.set(
    citationStorePath('qa'),
    `${JSON.stringify({
      instrumentId: 'qa',
      sourcePath: PDF,
      page: 3,
      schemaVersion: 2,
      ...(sidecarRevision === 'match' ? { sourceRevision: await hashContent(bytesV1) } : {}),
    })}\n`,
  );
  return vault;
}

function homeNote(id: string): string {
  return [
    '---',
    'topic: [Synthetic topic]',
    'course: SYN101',
    '---',
    '',
    '```olea-mcq',
    `id: ${id}`,
    'stem: Which mineral is named here?',
    'answer: Quartz',
    'distractor: Olivine',
    'distractor: Feldspar',
    'distractor: Biotite',
    'distractor: Calcite',
    '```',
    '',
  ].join('\n');
}

function setup() {
  const store = new ObsidianCitationHashStore(new FakeDataHost());
  const judge: RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } = {
    judge: vi.fn(async () => ({ material: true, reason: 'x' })),
  };
  const trigger = new CitationRevisionTrigger({ store, judge, clock: { now: () => 1_000 } });
  const actions = {
    enqueue: vi.fn(async () => undefined),
    suspend: vi.fn(async () => undefined),
  };
  return { store, judge, trigger, actions };
}

describe('a citation pass checks a non-markdown source by its bytes ([D-515])', () => {
  it('changed bytes: the pending fact is written in the same pass, no judge call, no rewrite yet', async () => {
    const vault = await seed('match');
    const { store, judge, trigger, actions } = setup();
    await trigger.tick(vault, actions);
    expect((await store.loadAll()).get('qa')?.pendingRevalidation).toBeUndefined();

    vault.binaries.set(PDF, bytesV2);
    const report = await trigger.tick(vault, actions);

    const fact = (await store.loadAll()).get('qa')?.pendingRevalidation;
    expect(fact?.reason).toBe(SOURCE_REVISION_REASON);
    expect(report.sourceBytesChanged).toBe(1);
    expect(judge.judge).not.toHaveBeenCalled();
    // No passage text exists for a binary: nothing is suspended or enqueued; the question stays withheld.
    expect(actions.suspend).not.toHaveBeenCalled();
    expect(actions.enqueue).not.toHaveBeenCalled();
  });

  it('unchanged bytes: nothing is written', async () => {
    const vault = await seed('match');
    const { store, judge, trigger, actions } = setup();
    await trigger.tick(vault, actions);
    const report = await trigger.tick(vault, actions);
    expect(report.sourceBytesChanged).toBe(0);
    expect((await store.loadAll()).get('qa')?.pendingRevalidation).toBeUndefined();
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('a sidecar with no sourceRevision is withheld, on the first sighting too', async () => {
    const vault = await seed('missing');
    const { store, trigger, actions } = setup();
    const report = await trigger.tick(vault, actions);
    expect(report.sourceBytesChanged).toBe(1);
    expect((await store.loadAll()).get('qa')?.pendingRevalidation?.reason).toBe(
      SOURCE_REVISION_REASON,
    );
  });

  it('an unreadable file is withheld', async () => {
    const vault = await seed('match');
    const { store, trigger, actions } = setup();
    await trigger.tick(vault, actions);
    vault.binaries.delete(PDF);
    await trigger.tick(vault, actions);
    expect((await store.loadAll()).get('qa')?.pendingRevalidation?.reason).toBe(
      SOURCE_REVISION_REASON,
    );
  });
});
