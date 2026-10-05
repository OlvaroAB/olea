/**
 * `ol-egov.141.89.5.81` ([D-518], [D-508]): a question held for a changed non-markdown source is
 * held under a typed reason, lifts only on a byte match (no judge call), and, when the changed
 * file's re-extracted units land, takes the rewrite path from the cited page's new text.
 * Synthetic bytes only.
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
import { citationStorePath, hashContent } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  ObsidianCitationHashStore,
  type PendingReason,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
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
  const enqueue = vi.fn(async (_input: unknown): Promise<undefined> => undefined);
  const suspend = vi.fn(
    async (_id: string, _concepts: readonly string[]): Promise<void> => undefined,
  );
  const store = new ObsidianCitationHashStore(new FakeDataHost());
  const judge: RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } = {
    judge: vi.fn(async () => ({ material: true, reason: 'x' })),
  };
  const trigger = new CitationRevisionTrigger({ store, judge, clock: { now: () => 1_000 } });
  const actions = { enqueue, suspend };
  return { store, judge, trigger, actions };
}

const REASON_IS_TYPED: PendingReason = 'source-revision-changed';

function unit(page: number, text: string): ExtractedUnit {
  return { text, provenance: { sourcePath: PDF, location: { page } } };
}

async function held() {
  const vault = await seed('match');
  const ctx = setup();
  await ctx.trigger.tick(vault, ctx.actions);
  vault.binaries.set(PDF, bytesV2);
  await ctx.trigger.tick(vault, ctx.actions);
  return { vault, ...ctx };
}

describe('a held changed-source question ([D-518])', () => {
  it('the reason is a typed PendingReason', () => {
    expect(REASON_IS_TYPED).toBe(SOURCE_REVISION_REASON);
  });

  it('the bytes returning to the recorded revision lift the hold, with no judge call', async () => {
    const { vault, store, judge, trigger, actions } = await held();
    expect((await store.loadAll()).get('qa')?.pendingRevalidation?.reason).toBe(
      SOURCE_REVISION_REASON,
    );
    vault.binaries.set(PDF, bytesV1);
    await trigger.tick(vault, actions);
    expect((await store.loadAll()).get('qa')?.pendingRevalidation).toBeUndefined();
    expect(judge.judge).not.toHaveBeenCalled();
    expect(actions.suspend).not.toHaveBeenCalled();
    expect(actions.enqueue).not.toHaveBeenCalled();
  });

  it('still-changed bytes keep the hold', async () => {
    const { vault, store, trigger, actions } = await held();
    await trigger.tick(vault, actions);
    expect((await store.loadAll()).get('qa')?.pendingRevalidation?.reason).toBe(
      SOURCE_REVISION_REASON,
    );
  });

  it('re-extracted units landing suspend the predecessor and enqueue a successor from the cited page', async () => {
    const { vault, store, judge, trigger, actions } = await held();
    const result = await trigger.onSourceUnitsLanded(
      vault,
      actions,
      [unit(2, 'Other page text.'), unit(3, 'First new line.'), unit(3, 'Second new line.')],
      new Map([[PDF, await hashContent(bytesV2)]]),
    );
    expect(result.rewritten).toBe(1);
    expect(actions.suspend).toHaveBeenCalledTimes(1);
    expect(actions.suspend.mock.calls[0]?.[0]).toBe('qa');
    expect(actions.enqueue).toHaveBeenCalledTimes(1);
    const input = actions.enqueue.mock.calls[0]?.[0] as unknown as {
      contentHash: string;
      payload: { kind: string; predecessorInstrumentId: string; newPassageText: string };
    };
    expect(input.payload.kind).toBe('instrument-revision');
    expect(input.payload.predecessorInstrumentId).toBe('qa');
    expect(input.payload.newPassageText).toBe('First new line.\n\nSecond new line.');
    expect((await store.loadAll()).has('qa')).toBe(false);
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('units that landed before the pass saw the new bytes are rewritten by that pass', async () => {
    const vault = await seed('match');
    const { trigger, actions, store } = setup();
    await trigger.tick(vault, actions);
    vault.binaries.set(PDF, bytesV2);
    await trigger.onSourceUnitsLanded(
      vault,
      actions,
      [unit(3, 'Landed first.')],
      new Map([[PDF, await hashContent(bytesV2)]]),
    );
    expect(actions.enqueue).not.toHaveBeenCalled();
    await trigger.tick(vault, actions);
    expect(actions.suspend).toHaveBeenCalledTimes(1);
    expect(actions.enqueue).toHaveBeenCalledTimes(1);
    expect((await store.loadAll()).has('qa')).toBe(false);
  });

  it('units for bytes other than the held ones are not used', async () => {
    const { vault, trigger, actions } = await held();
    const result = await trigger.onSourceUnitsLanded(
      vault,
      actions,
      [unit(3, 'Stale text.')],
      new Map([[PDF, await hashContent(new TextEncoder().encode('some third edition'))]]),
    );
    expect(result.rewritten).toBe(0);
    expect(actions.suspend).not.toHaveBeenCalled();
  });

  it('a cited page with no text stays held, and is counted', async () => {
    const { vault, store, trigger, actions } = await held();
    const result = await trigger.onSourceUnitsLanded(
      vault,
      actions,
      [unit(2, 'Only another page.'), unit(3, '   ')],
      new Map([[PDF, await hashContent(bytesV2)]]),
    );
    expect(result.rewritten).toBe(0);
    expect(result.heldNoText).toBe(1);
    expect(actions.suspend).not.toHaveBeenCalled();
    expect(actions.enqueue).not.toHaveBeenCalled();
    expect((await store.loadAll()).get('qa')?.pendingRevalidation?.reason).toBe(
      SOURCE_REVISION_REASON,
    );
  });

  it('a failed enqueue leaves the question held and the next pass retries without a judge call', async () => {
    const { vault, store, judge, trigger, actions } = await held();
    actions.enqueue.mockRejectedValueOnce(new Error('queue down'));
    const revisions = new Map([[PDF, await hashContent(bytesV2)]]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await trigger.onSourceUnitsLanded(vault, actions, [unit(3, 'Retry text.')], revisions);
    spy.mockRestore();
    expect((await store.loadAll()).has('qa')).toBe(true);
    await trigger.tick(vault, actions);
    expect(actions.enqueue).toHaveBeenCalledTimes(2);
    expect((await store.loadAll()).has('qa')).toBe(false);
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('the rewrite payload carries the landed hash, and the successor built from it is not held or rewritten again', async () => {
    const { vault, trigger, actions } = await held();
    const landedHash = await hashContent(bytesV2);
    await trigger.onSourceUnitsLanded(
      vault,
      actions,
      [unit(3, 'New line.')],
      new Map([[PDF, landedHash]]),
    );
    expect(actions.enqueue).toHaveBeenCalledTimes(1);
    const input = actions.enqueue.mock.calls[0]?.[0] as unknown as {
      payload: { sourceRevision?: string };
    };
    expect(input.payload.sourceRevision).toBe(landedHash);

    // The accepted successor: a new question whose citation records the payload's revision.
    vault.files.delete('Synthetic/qa (Olea).md');
    vault.files.delete(citationStorePath('qa'));
    vault.files.set('Synthetic/qa2 (Olea).md', homeNote('qa2'));
    vault.files.set(
      citationStorePath('qa2'),
      `${JSON.stringify({
        instrumentId: 'qa2',
        sourcePath: PDF,
        page: 3,
        schemaVersion: 2,
        sourceRevision: input.payload.sourceRevision,
      })}\n`,
    );
    await trigger.tick(vault, actions);
    await trigger.tick(vault, actions);
    expect(actions.enqueue).toHaveBeenCalledTimes(1);
    expect(actions.suspend).toHaveBeenCalledTimes(1);
  });
});
