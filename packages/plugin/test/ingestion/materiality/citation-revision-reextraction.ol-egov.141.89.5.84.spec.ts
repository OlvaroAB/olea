/**
 * `ol-egov.141.89.5.84` ([D-518]): after a plugin restart, or a change made while Obsidian was
 * closed, a question withheld for a changed non-markdown source asks the host once for a
 * re-extraction, and the landing rewrites it. Synthetic bytes only.
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
  readonly binaries = new Map<string, Uint8Array>();
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

async function seed(): Promise<MemoryVaultSource> {
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
      sourceRevision: await hashContent(bytesV1),
    })}\n`,
  );
  return vault;
}

function build(store: ObsidianCitationHashStore, request?: (path: string) => Promise<void>) {
  const judge: RevisionJudgePort = { judge: vi.fn(async () => ({ material: true, reason: 'x' })) };
  const trigger = new CitationRevisionTrigger({
    store,
    judge,
    clock: { now: () => 1_000 },
    ...(request === undefined ? {} : { requestSourceReextraction: request }),
  });
  const actions = {
    enqueue: vi.fn(async (_i: unknown): Promise<undefined> => undefined),
    suspend: vi.fn(async (_id: string, _c: readonly string[]): Promise<void> => undefined),
  };
  return { trigger, actions };
}

describe('catch-up re-extraction request ([D-518])', () => {
  it('after a restart with a hold standing and no landed text, the pass asks once, and the landing rewrites', async () => {
    const vault = await seed();
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    const first = build(store);
    await first.trigger.tick(vault, first.actions);
    vault.binaries.set(PDF, bytesV2);
    await first.trigger.tick(vault, first.actions);
    expect((await store.loadAll()).get('qa')?.pendingRevalidation?.reason).toBe(
      SOURCE_REVISION_REASON,
    );

    const request = vi.fn(async (_p: string): Promise<void> => undefined);
    const restarted = build(store, request);
    await restarted.trigger.tick(vault, restarted.actions);
    await restarted.trigger.tick(vault, restarted.actions);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(PDF);

    const result = await restarted.trigger.onSourceUnitsLanded(
      vault,
      restarted.actions,
      [{ text: 'Landed line.', provenance: { sourcePath: PDF, location: { page: 3 } } }],
      new Map([[PDF, await hashContent(bytesV2)]]),
    );
    expect(result.rewritten).toBe(1);
    expect(restarted.actions.enqueue).toHaveBeenCalledTimes(1);
  });

  it('after an offline change the first pass raises the hold and asks', async () => {
    const vault = await seed();
    vault.binaries.set(PDF, bytesV2);
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    const request = vi.fn(async (_p: string): Promise<void> => undefined);
    const { trigger, actions } = build(store, request);
    await trigger.tick(vault, actions);
    expect((await store.loadAll()).get('qa')?.pendingRevalidation?.reason).toBe(
      SOURCE_REVISION_REASON,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('asks again only for different bytes', async () => {
    const vault = await seed();
    vault.binaries.set(PDF, bytesV2);
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    const request = vi.fn(async (_p: string): Promise<void> => undefined);
    const { trigger, actions } = build(store, request);
    await trigger.tick(vault, actions);
    await trigger.tick(vault, actions);
    expect(request).toHaveBeenCalledTimes(1);
    vault.binaries.set(PDF, new TextEncoder().encode('a third edition'));
    await trigger.tick(vault, actions);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not ask when landed text for those bytes is already held', async () => {
    const vault = await seed();
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    const request = vi.fn(async (_p: string): Promise<void> => undefined);
    const { trigger, actions } = build(store, request);
    await trigger.tick(vault, actions);
    vault.binaries.set(PDF, bytesV2);
    await trigger.onSourceUnitsLanded(
      vault,
      actions,
      [{ text: 'Landed first.', provenance: { sourcePath: PDF, location: { page: 3 } } }],
      new Map([[PDF, await hashContent(bytesV2)]]),
    );
    await trigger.tick(vault, actions);
    expect(request).not.toHaveBeenCalled();
  });

  it('a failing request is logged without a path and the hold stands', async () => {
    const vault = await seed();
    vault.binaries.set(PDF, bytesV2);
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    const { trigger, actions } = build(store, async () => {
      throw new TypeError('boom');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await trigger.tick(vault, actions);
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain(PDF);
    expect((await store.loadAll()).get('qa')?.pendingRevalidation?.reason).toBe(
      SOURCE_REVISION_REASON,
    );
  });

  it('the bytes returning to the recorded revision still lift the hold and ask nothing', async () => {
    const vault = await seed();
    vault.binaries.set(PDF, bytesV2);
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    const request = vi.fn(async (_p: string): Promise<void> => undefined);
    const { trigger, actions } = build(store, request);
    await trigger.tick(vault, actions);
    request.mockClear();
    vault.binaries.set(PDF, bytesV1);
    await trigger.tick(vault, actions);
    expect((await store.loadAll()).get('qa')?.pendingRevalidation).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });
});
