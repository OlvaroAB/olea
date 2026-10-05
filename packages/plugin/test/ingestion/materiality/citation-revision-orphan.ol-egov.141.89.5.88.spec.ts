/**
 * `ol-egov.141.89.5.88` ([D-508], [D-518]): the shared rewrite step enqueues the successor FIRST and
 * suspends the predecessor second, so no orphan (suspended, no successor) can arise. A failed
 * enqueue suspends nothing and the hold stands across a restart; a failed suspend is retried
 * with the same input (the queue answers 'duplicate'); a question the student suspended herself
 * is never rewritten. Synthetic text only.
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

type Result = { status: 'duplicate'; existingStatus: string } | undefined;

function setup(
  vault: MemoryVaultSource,
  host: FakeDataHost,
  calls: string[],
  opts: { failEnqueue?: () => boolean; failSuspend?: () => boolean; seen?: Set<string> } = {},
) {
  const now = () => new Date('2026-10-05T10:00:00Z');
  const seen = opts.seen ?? new Set<string>();
  const enqueue = vi.fn(async (input: unknown): Promise<Result> => {
    calls.push('enqueue');
    if (opts.failEnqueue?.() === true) throw new Error('enqueue down');
    const key = JSON.stringify(input);
    if (seen.has(key)) return { status: 'duplicate', existingStatus: 'queued' };
    seen.add(key);
    return undefined;
  });
  const suspend = vi.fn(async (instrumentId: string, conceptIds: readonly string[]) => {
    calls.push('suspend');
    if (opts.failSuspend?.() === true) throw new Error('suspend down');
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
  const store = new ObsidianCitationHashStore(host);
  const judge: RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } = {
    judge: vi.fn(async () => ({ material: true, reason: 'x' })),
  };
  const trigger = new CitationRevisionTrigger({ store, judge, clock: { now: () => 1_000 } });
  return { store, judge, trigger, actions: { enqueue, suspend } };
}

function unit(page: number, text: string): ExtractedUnit {
  return { text, provenance: { sourcePath: PDF, location: { page } } };
}

function passageVault(): MemoryVaultSource {
  const vault = new MemoryVaultSource();
  vault.files.set('Synthetic/qa (Olea).md', homeNote('qa'));
  vault.files.set(NOTE, 'Quartz is a hard mineral.\n');
  vault.files.set(citationStorePath('qa'), sidecar({ sourcePath: NOTE, page: 1 }));
  return vault;
}

async function binaryVault(): Promise<MemoryVaultSource> {
  const vault = new MemoryVaultSource();
  vault.files.set('Synthetic/qa (Olea).md', homeNote('qa'));
  vault.binaries.set(PDF, bytesV1);
  vault.files.set(
    citationStorePath('qa'),
    sidecar({ sourcePath: PDF, page: 3, sourceRevision: await hashContent(bytesV1) }),
  );
  return vault;
}

const EDITED = 'Quartz is a hard mineral, and feldspar is softer.\n';

async function land(
  t: ReturnType<typeof setup>,
  vault: MemoryVaultSource,
): Promise<{ rewritten: number }> {
  return t.trigger.onSourceUnitsLanded(
    vault,
    t.actions,
    [unit(3, 'New line.')],
    new Map([[PDF, await hashContent(bytesV2)]]),
  );
}

/** Baseline, then the bytes change and the hold is raised. */
async function heldBinary(t: ReturnType<typeof setup>, vault: MemoryVaultSource): Promise<void> {
  await t.trigger.tick(vault, t.actions);
  vault.binaries.set(PDF, bytesV2);
  await t.trigger.tick(vault, t.actions);
}

describe('the successor is enqueued before the predecessor is suspended ([D-508])', () => {
  it('binary path: a failed enqueue suspends nothing, keeps the hold, and a restart then enqueues once and suspends', async () => {
    const vault = await binaryVault();
    const host = new FakeDataHost();
    const calls: string[] = [];
    const first = setup(vault, host, calls, { failEnqueue: () => true });
    await heldBinary(first, vault);
    await land(first, vault);
    expect(calls).toEqual(['enqueue']);
    expect(first.actions.suspend).not.toHaveBeenCalled();
    const kept = (await first.store.loadAll()).get('qa');
    expect(kept?.pendingRevalidation?.reason).toBe(SOURCE_REVISION_REASON);

    const seen = new Set<string>();
    const restartCalls: string[] = [];
    const second = setup(vault, host, restartCalls, { seen });
    await second.trigger.tick(vault, second.actions);
    const result = await land(second, vault);
    expect(result.rewritten).toBe(1);
    expect(restartCalls).toEqual(['enqueue', 'suspend']);
    expect(seen.size).toBe(1);
    expect((await second.store.loadAll()).has('qa')).toBe(false);
  });

  it('passage path: enqueue comes first, and a failed enqueue leaves it unsuspended and tracked', async () => {
    const okVault = passageVault();
    const okCalls: string[] = [];
    const ok = setup(okVault, new FakeDataHost(), okCalls);
    await ok.trigger.tick(okVault, ok.actions);
    okVault.files.set(NOTE, EDITED);
    await ok.trigger.tick(okVault, ok.actions);
    expect(okCalls).toEqual(['enqueue', 'suspend']);

    const vault = passageVault();
    const calls: string[] = [];
    const bad = setup(vault, new FakeDataHost(), calls, { failEnqueue: () => true });
    await bad.trigger.tick(vault, bad.actions);
    vault.files.set(NOTE, EDITED);
    await bad.trigger.tick(vault, bad.actions);
    expect(calls).toEqual(['enqueue']);
    expect(bad.actions.suspend).not.toHaveBeenCalled();
    expect((await bad.store.loadAll()).has('qa')).toBe(true);
  });

  it('enqueue succeeds and suspend fails once: the retry sees duplicate, suspends, and only then drops the anchor', async () => {
    const vault = passageVault();
    const calls: string[] = [];
    let suspendFails = 1;
    const t = setup(vault, new FakeDataHost(), calls, { failSuspend: () => suspendFails-- > 0 });
    await t.trigger.tick(vault, t.actions);
    vault.files.set(NOTE, EDITED);
    await t.trigger.tick(vault, t.actions);
    expect(calls).toEqual(['enqueue', 'suspend']);
    expect((await t.store.loadAll()).has('qa')).toBe(true);
    await t.trigger.tick(vault, t.actions);
    expect(calls).toEqual(['enqueue', 'suspend', 'enqueue', 'suspend']);
    expect(await t.actions.enqueue.mock.results[1]?.value).toEqual({
      status: 'duplicate',
      existingStatus: 'queued',
    });
    expect((await t.store.loadAll()).has('qa')).toBe(false);
    expect(t.judge.judge).toHaveBeenCalledTimes(1);
  });

  it('a question she suspended herself, whose cited file then changes and lands, is never rewritten', async () => {
    const vault = await binaryVault();
    const calls: string[] = [];
    const t = setup(vault, new FakeDataHost(), calls);
    await heldBinary(t, vault);
    await appendSuspendRecord(
      vault,
      {
        kind: 'suspend',
        timestamp: '2026-10-05T09:00:00Z',
        instrumentId: 'qa',
        conceptIds: ['syn-concept'],
      },
      { deviceId: 'dev-synthetic' },
    );
    const result = await land(t, vault);
    await t.trigger.tick(vault, t.actions);
    expect(result.rewritten).toBe(0);
    expect(calls).toEqual([]);
  });

  it('the bounded retry still caps attempts', async () => {
    const vault = passageVault();
    const calls: string[] = [];
    const t = setup(vault, new FakeDataHost(), calls, { failEnqueue: () => true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await t.trigger.tick(vault, t.actions);
    vault.files.set(NOTE, EDITED);
    let gaveUp = 0;
    for (let i = 0; i < 12; i += 1)
      gaveUp += (await t.trigger.tick(vault, t.actions)).successorEnqueueFailed;
    expect(gaveUp).toBe(1);
    expect(calls.length).toBeLessThanOrEqual(5);
    expect(calls.every((c) => c === 'enqueue')).toBe(true);
  });
});
