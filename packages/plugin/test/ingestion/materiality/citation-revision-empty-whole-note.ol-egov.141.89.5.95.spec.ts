/**
 * `ol-egov.141.89.5.95` (C5.3 as amended by [D-508], [D-543]): a citation with no passage digest is
 * tracked at whole-note grain. When the cited note is emptied to no groundable content there is no
 * current passage to rewrite from, so the item is withheld as a missing passage (no judge call,
 * nothing suspended, no successor, no baseline adopted), and once the note has content again the
 * next pass takes the ordinary route. Synthetic text only.
 */
import type {
  ListOptions,
  RevisionJudgePort,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { appendSuspendRecord, citationStorePath } from 'olea-core';
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

const NOTE = 'Synthetic/Source note.md';

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

function passageVault(): MemoryVaultSource {
  const vault = new MemoryVaultSource();
  vault.files.set('Synthetic/qa (Olea).md', homeNote('qa'));
  vault.files.set(NOTE, 'Quartz is a hard mineral.\n');
  vault.files.set(citationStorePath('qa'), sidecar({ sourcePath: NOTE, page: 1 }));
  return vault;
}

const EDITED = 'Quartz is a hard mineral, and feldspar is softer.\n';
const REFILLED = 'Calcite fizzes in weak acid, unlike quartz.\n';

async function baselined(): Promise<{
  vault: MemoryVaultSource;
  t: ReturnType<typeof setup>;
  calls: string[];
}> {
  const vault = passageVault();
  const calls: string[] = [];
  const t = setup(vault, new FakeDataHost(), calls);
  await t.trigger.tick(vault, t.actions);
  return { vault, t, calls };
}

describe('an emptied whole cited note is withheld, never rewritten from nothing ([D-543])', () => {
  it.each([
    ['empty', ''],
    ['whitespace only', '  \n\t \n\n'],
    ['heading marker only', '#\n\n##  \n'],
  ])(
    '%s: withheld as a missing passage, no judge call, nothing suspended or enqueued',
    async (_label, emptied) => {
      const { vault, t, calls } = await baselined();
      const baseline = (await t.store.loadAll()).get('qa');
      vault.files.set(NOTE, emptied);
      const report = await t.trigger.tick(vault, t.actions);
      expect(t.judge.judge).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
      expect(t.actions.suspend).not.toHaveBeenCalled();
      expect(t.actions.enqueue).not.toHaveBeenCalled();
      expect(report.stranded).toBe(1);
      const kept = (await t.store.loadAll()).get('qa');
      expect(kept?.pendingRevalidation?.reason).toBe('passage-missing');
      expect(kept?.text).toBe(baseline?.text);
      // Re-ticking the same state is a no-op: still no call, no successor.
      await t.trigger.tick(vault, t.actions);
      expect(calls).toEqual([]);
      expect((await t.store.loadAll()).get('qa')?.pendingRevalidation?.reason).toBe(
        'passage-missing',
      );
    },
  );

  it('refill: once the note has content again the judge is called and the successor carries the refilled text', async () => {
    const { vault, t, calls } = await baselined();
    vault.files.set(NOTE, '');
    await t.trigger.tick(vault, t.actions);
    expect(calls).toEqual([]);
    vault.files.set(NOTE, REFILLED);
    await t.trigger.tick(vault, t.actions);
    expect(t.judge.judge).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['enqueue', 'suspend']);
    expect(JSON.stringify(t.actions.enqueue.mock.calls[0]?.[0])).toContain('Calcite');
  });

  it('refill with an immaterial verdict still takes the rewrite route from the refilled text', async () => {
    const { vault, t, calls } = await baselined();
    t.judge.judge.mockImplementation(async () => ({ material: false, reason: 'x' }));
    vault.files.set(NOTE, '   \n');
    await t.trigger.tick(vault, t.actions);
    vault.files.set(NOTE, EDITED);
    await t.trigger.tick(vault, t.actions);
    expect(t.judge.judge).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['enqueue', 'suspend']);
    expect(JSON.stringify(t.actions.enqueue.mock.calls[0]?.[0])).toContain('feldspar');
  });

  it('a note with real content still takes the ordinary route (a frontmatter-only note counts as content)', async () => {
    const { vault, t, calls } = await baselined();
    vault.files.set(NOTE, '---\ntopic: x\n---\n');
    await t.trigger.tick(vault, t.actions);
    expect(t.judge.judge).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['enqueue', 'suspend']);
  });
});
