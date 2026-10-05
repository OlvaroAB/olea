/**
 * `ol-egov.141.89.5.81` ([D-518], [D-508]): the batch pass leaves a SUSPENDED instrument alone. A
 * rewritten predecessor lost its store record on purpose; the next pass must not re-seed it, re-raise
 * its hold or suspend and enqueue it again. The suspend action here writes the real review-log
 * record, so the pass reads suspension the way the presentation path does. Synthetic text only.
 */
import type {
  ExtractedUnit,
  ListOptions,
  RevisionJudgePort,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { appendSuspendRecord, citationStorePath, hashContent } from 'olea-core';
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
const NOTE = 'Synthetic/Source note.md';
const bytesV1 = new TextEncoder().encode('synthetic pdf bytes, version one');
const bytesV2 = new TextEncoder().encode('synthetic pdf bytes, version two');

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

function sidecar(extra: Record<string, unknown>): string {
  return `${JSON.stringify({ instrumentId: 'qa', schemaVersion: 2, ...extra })}\n`;
}

function setup(vault: MemoryVaultSource, now: () => Date) {
  const enqueue = vi.fn(async (_input: unknown): Promise<undefined> => undefined);
  const suspend = vi.fn(async (instrumentId: string, conceptIds: readonly string[]) => {
    await appendSuspendRecord(
      vault,
      {
        kind: 'suspend',
        timestamp: now().toISOString(),
        instrumentId,
        conceptIds: [...conceptIds],
      },
      { deviceId: 'dev-synthetic' },
    );
  });
  const store = new ObsidianCitationHashStore(new FakeDataHost());
  const judge: RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } = {
    judge: vi.fn(async () => ({ material: true, reason: 'x' })),
  };
  const trigger = new CitationRevisionTrigger({ store, judge, clock: { now: () => 1_000 } });
  return { store, judge, trigger, actions: { enqueue, suspend } };
}

function unit(page: number, text: string): ExtractedUnit {
  return { text, provenance: { sourcePath: PDF, location: { page } } };
}

describe('a suspended predecessor is not seen again ([D-518])', () => {
  it('a binary-source question rewritten by landed units is suspended and enqueued once, however many passes follow', async () => {
    const vault = new MemoryVaultSource();
    vault.files.set('Synthetic/qa (Olea).md', homeNote('qa'));
    vault.binaries.set(PDF, bytesV1);
    vault.files.set(
      citationStorePath('qa'),
      sidecar({ sourcePath: PDF, page: 3, sourceRevision: await hashContent(bytesV1) }),
    );
    const { store, judge, trigger, actions } = setup(vault, () => new Date('2026-10-05T10:00:00Z'));
    await trigger.tick(vault, actions);
    vault.binaries.set(PDF, bytesV2);
    await trigger.tick(vault, actions);
    const result = await trigger.onSourceUnitsLanded(
      vault,
      actions,
      [unit(3, 'New line.')],
      new Map([[PDF, await hashContent(bytesV2)]]),
    );
    expect(result.rewritten).toBe(1);
    await trigger.tick(vault, actions);
    await trigger.tick(vault, actions);
    expect(actions.suspend).toHaveBeenCalledTimes(1);
    expect(actions.enqueue).toHaveBeenCalledTimes(1);
    expect((await store.loadAll()).has('qa')).toBe(false);
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('a markdown question rewritten through the judge path is not re-seeded by the next pass', async () => {
    const vault = new MemoryVaultSource();
    vault.files.set('Synthetic/qa (Olea).md', homeNote('qa'));
    vault.files.set(NOTE, 'Quartz is a hard mineral.\n');
    vault.files.set(citationStorePath('qa'), sidecar({ sourcePath: NOTE, page: 1 }));
    const { store, judge, trigger, actions } = setup(vault, () => new Date('2026-10-05T10:00:00Z'));
    await trigger.tick(vault, actions);
    vault.files.set(NOTE, 'Quartz is a hard mineral, and feldspar is softer.\n');
    await trigger.tick(vault, actions);
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(actions.suspend).toHaveBeenCalledTimes(1);
    expect((await store.loadAll()).has('qa')).toBe(false);
    await trigger.tick(vault, actions);
    await trigger.tick(vault, actions);
    expect((await store.loadAll()).has('qa')).toBe(false);
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(actions.suspend).toHaveBeenCalledTimes(1);
    expect(actions.enqueue).toHaveBeenCalledTimes(1);
  });

  it('an instrument that is not suspended is tracked as before, and an unsuspend lifts the skip', async () => {
    const vault = new MemoryVaultSource();
    vault.files.set('Synthetic/qa (Olea).md', homeNote('qa'));
    vault.files.set(NOTE, 'Quartz is a hard mineral.\n');
    vault.files.set(citationStorePath('qa'), sidecar({ sourcePath: NOTE, page: 1 }));
    const { store, trigger, actions } = setup(vault, () => new Date('2026-10-05T10:00:00Z'));
    await trigger.tick(vault, actions);
    expect((await store.loadAll()).has('qa')).toBe(true);
    await store.remove('qa');
    await appendSuspendRecord(
      vault,
      {
        kind: 'suspend',
        timestamp: '2026-10-05T10:00:00Z',
        instrumentId: 'qa',
        conceptIds: ['syn-concept'],
      },
      { deviceId: 'dev-synthetic' },
    );
    await trigger.tick(vault, actions);
    expect((await store.loadAll()).has('qa')).toBe(false);
    await appendSuspendRecord(
      vault,
      {
        kind: 'unsuspend',
        timestamp: '2026-10-05T11:00:00Z',
        instrumentId: 'qa',
        conceptIds: ['syn-concept'],
      },
      { deviceId: 'dev-synthetic' },
    );
    await trigger.tick(vault, actions);
    expect((await store.loadAll()).has('qa')).toBe(true);
  });
});
