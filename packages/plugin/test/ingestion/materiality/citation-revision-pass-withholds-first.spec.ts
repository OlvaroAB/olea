/**
 * `ol-egov.141.89.5.71` ([D-514] item b): one citation pass records every affected instrument's
 * pending-revalidation fact before any judge call is awaited. Synthetic text only.
 */
import type {
  ListOptions,
  RevisionJudgePort,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { citationStorePath } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianCitationHashStore } from '../../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../../src/ingestion/materiality/citation-revision-wiring.js';

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
  async readBinary(): Promise<Uint8Array> {
    throw new Error('not needed');
  }
  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
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

const IDS = ['qa', 'qb', 'qc'] as const;

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

function seed(): MemoryVaultSource {
  const vault = new MemoryVaultSource();
  for (const id of IDS) {
    vault.files.set(`Synthetic/${id} (Olea).md`, homeNote(id));
    vault.files.set(`Synthetic/${id} source.md`, `# ${id}\n\nOriginal sentence for ${id}.\n`);
    vault.files.set(
      citationStorePath(id),
      `${JSON.stringify({ instrumentId: id, sourcePath: `Synthetic/${id} source.md`, page: 1, schemaVersion: 2 })}\n`,
    );
  }
  return vault;
}

describe('a citation pass withholds every affected question before any judge call returns', () => {
  it('three changed instruments, a judge that never resolves: all three pending facts are written first', async () => {
    const vault = seed();
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    const unresolved = new Promise<{ material: boolean; reason: string }>(() => {});
    let factsWhenFirstCallStarted = -1;
    const judge: RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } = {
      judge: vi.fn(async () => {
        if (factsWhenFirstCallStarted < 0) {
          const records = await store.loadAll();
          factsWhenFirstCallStarted = [...records.values()].filter(
            (r) => r.pendingRevalidation !== undefined,
          ).length;
        }
        return unresolved;
      }),
    };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: { now: () => 1_000 } });
    const actions = {
      enqueue: vi.fn(async () => undefined),
      suspend: vi.fn(async () => undefined),
    };
    await trigger.tick(vault, actions);
    expect((await store.loadAll()).size).toBe(3);

    for (const id of IDS)
      vault.files.set(`Synthetic/${id} source.md`, `# ${id}\n\nA rewritten sentence for ${id}.\n`);
    void trigger.tick(vault, actions);
    await vi.waitFor(() => expect(judge.judge).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(factsWhenFirstCallStarted).toBe(3);
    const records = await store.loadAll();
    for (const id of IDS) expect(records.get(id)?.pendingRevalidation).toBeDefined();
    expect(judge.judge).toHaveBeenCalledTimes(1);
  });
});
