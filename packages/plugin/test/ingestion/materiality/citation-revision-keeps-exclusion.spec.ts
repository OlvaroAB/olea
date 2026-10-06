/**
 * `ol-egov.141.89.9.98` ([D-522], [D-536]): the rewrite path keeps the old question's entry and
 * pending fact in the existing store, the persisted exclusion of its evidence from current
 * readings, until a successful revalidation. Queuing the successor and suspending the old question
 * close the rewrite, and an accepted successor closes the workflow, but neither clears the fact.
 * The pass then leaves a suspended question with a check owed alone, so nothing is judged,
 * suspended or queued again, across passes and restarts. Scenarios: `features/F4-oracle.md`'s
 * changed-passage section. Synthetic text only (INV-3).
 */
import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';
import { appendSuccessionRecord, appendSuspendRecord, citationStorePath } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { readPendingPassageChanges } from '../../../src/attainment/passage-changes.js';
import { ObsidianCitationHashStore } from '../../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../../src/ingestion/materiality/citation-revision-wiring.js';

class MemoryVaultSource implements VaultSource {
  readonly files = new Map<string, string>();
  /** When set, reading a review-log file fails, as a vault that cannot be read would. */
  failLogReads = false;
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
    if (this.failLogReads && path.startsWith('.olea/reviews/')) throw new Error('read failed');
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    throw new Error(`not found: ${path}`);
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

/** The plugin's `data.json`, as text, so a second store over a copy of it is a restart. */
class JsonDataHost {
  constructor(public json = 'null') {}
  async loadData(): Promise<unknown> {
    return JSON.parse(this.json);
  }
  async saveData(data: unknown): Promise<void> {
    this.json = JSON.stringify(data);
  }
}

const NOTE = 'Synthetic/Source note.md';
const NOW = new Date('2026-10-05T12:00:00Z');
const DEVICE = 'dev-synthetic';

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

function world() {
  const vault = new MemoryVaultSource();
  vault.files.set('Synthetic/qa (Olea).md', homeNote('qa'));
  vault.files.set(NOTE, 'Quartz is a hard mineral.\n');
  vault.files.set(
    citationStorePath('qa'),
    `${JSON.stringify({ instrumentId: 'qa', schemaVersion: 2, sourcePath: NOTE, page: 1 })}\n`,
  );
  return vault;
}

async function logged(
  vault: VaultSource,
  kind: 'suspend' | 'unsuspend',
  timestamp: string,
  conceptIds: readonly string[] = ['syn-concept'],
): Promise<void> {
  await appendSuspendRecord(
    vault,
    { kind, timestamp, instrumentId: 'qa', conceptIds: [...conceptIds] },
    { deviceId: DEVICE },
  );
}

function setup(vault: MemoryVaultSource, host: JsonDataHost) {
  const actions = {
    enqueue: vi.fn(async (_input: unknown): Promise<undefined> => undefined),
    // The record the production suspend port writes (`review/ports.ts`'s `createVaultSuspendPort`).
    suspend: vi.fn(async (_instrumentId: string, conceptIds: readonly string[]) =>
      logged(vault, 'suspend', '2026-10-05T10:00:00Z', conceptIds),
    ),
  };
  const store = new ObsidianCitationHashStore(host);
  const judge = { judge: vi.fn(async () => ({ material: true, reason: 'changed claim' })) };
  const trigger = new CitationRevisionTrigger({ store, judge, clock: { now: () => 1_000 } });
  return { store, judge, trigger, actions };
}

/** Baseline, then the cited note changes and the judge finds the claim changed: the rewrite. */
async function rewrite(vault: MemoryVaultSource, host: JsonDataHost) {
  const t = setup(vault, host);
  await t.trigger.tick(vault, t.actions);
  vault.files.set(NOTE, 'Quartz is a hard mineral, and feldspar is softer.\n');
  const report = await t.trigger.tick(vault, t.actions);
  expect(report.revised).toBe(1);
  expect(t.actions.enqueue).toHaveBeenCalledTimes(1);
  expect(t.actions.suspend).toHaveBeenCalledTimes(1);
  return t;
}

describe('the rewrite path keeps the exclusion until a successful revalidation ([D-522], [D-536])', () => {
  it('REGRESSION (fails pre-fix): the entry and its pending fact stay, and current readings still leave the old question out', async () => {
    const vault = world();
    const host = new JsonDataHost();
    const { store } = await rewrite(vault, host);
    const kept = (await store.loadAll()).get('qa');
    // Pre-fix: the entry was removed here, and the store kept no trace of the change.
    expect(kept?.pendingRevalidation).toBeDefined();
    // The old baseline, never the changed text: nothing certifies the old question.
    expect(kept?.text).toBe('Quartz is a hard mineral.\n');
    const read = await readPendingPassageChanges(store, NOW);
    expect(read).toEqual({
      kind: 'read',
      changes: [{ instrumentIds: ['qa'], changedAt: expect.any(String), revalidation: [] }],
    });
  });

  it('later passes, and a restart, leave the suspended old question alone: no judge call, suspension or successor, the fact unchanged', async () => {
    const vault = world();
    const host = new JsonDataHost();
    const first = await rewrite(vault, host);
    const kept = (await first.store.loadAll()).get('qa');
    await first.trigger.tick(vault, first.actions);
    await first.trigger.tick(vault, first.actions);

    // The restart: a new trigger and a new store over the same persisted data.
    const second = setup(vault, new JsonDataHost(host.json));
    await second.trigger.tick(vault, second.actions);
    await second.trigger.tick(vault, second.actions);

    expect(first.judge.judge).toHaveBeenCalledTimes(1);
    expect(first.actions.suspend).toHaveBeenCalledTimes(1);
    expect(first.actions.enqueue).toHaveBeenCalledTimes(1);
    expect(second.judge.judge).not.toHaveBeenCalled();
    expect(second.actions.suspend).not.toHaveBeenCalled();
    expect(second.actions.enqueue).not.toHaveBeenCalled();
    expect((await second.store.loadAll()).get('qa')).toEqual(kept);
  });

  it('an accepted successor closes the workflow but clears nothing: the fact stands and the pass still leaves the old question alone', async () => {
    const vault = world();
    const host = new JsonDataHost();
    const t = await rewrite(vault, host);
    const kept = (await t.store.loadAll()).get('qa');
    await appendSuccessionRecord(
      vault,
      {
        timestamp: '2026-10-05T11:00:00Z',
        predecessorInstrumentId: 'qa',
        successorInstrumentId: 'qa-successor',
      },
      { deviceId: DEVICE },
    );
    await t.trigger.tick(vault, t.actions);
    await t.trigger.tick(vault, t.actions);
    expect(t.judge.judge).toHaveBeenCalledTimes(1);
    expect(t.actions.suspend).toHaveBeenCalledTimes(1);
    expect(t.actions.enqueue).toHaveBeenCalledTimes(1);
    expect((await t.store.loadAll()).get('qa')).toEqual(kept);
    const read = await readPendingPassageChanges(t.store, NOW);
    expect(read.kind === 'read' ? read.changes.map((c) => c.instrumentIds) : read).toEqual([
      ['qa'],
    ]);
  });

  it('her own suspension of a question with a check owed waits for her unsuspend; the unsuspend resumes the check as for any held item', async () => {
    const vault = world();
    const host = new JsonDataHost();
    const t = setup(vault, host);
    // No judge reachable: the change is recorded as a check owed, and nothing else happens.
    const offline = new CitationRevisionTrigger({
      store: t.store,
      judge: null,
      clock: { now: () => 1_000 },
    });
    await offline.tick(vault, t.actions);
    vault.files.set(NOTE, 'Quartz is a hard mineral, and feldspar is softer.\n');
    await offline.tick(vault, t.actions);
    const owed = (await t.store.loadAll()).get('qa')?.pendingRevalidation;
    expect(owed).toBeDefined();

    await logged(vault, 'suspend', '2026-10-05T09:00:00Z');
    await t.trigger.tick(vault, t.actions);
    expect(t.judge.judge).not.toHaveBeenCalled();
    expect((await t.store.loadAll()).get('qa')?.pendingRevalidation).toEqual(owed);

    await logged(vault, 'unsuspend', '2026-10-05T09:30:00Z');
    await t.trigger.tick(vault, t.actions);
    expect(t.judge.judge).toHaveBeenCalledTimes(1);
  });

  it('a review log that cannot be read leaves a question with a check owed waiting, never taken as unsuspended', async () => {
    const vault = world();
    const host = new JsonDataHost();
    const t = await rewrite(vault, host);
    const kept = (await t.store.loadAll()).get('qa');
    vault.failLogReads = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await t.trigger.tick(vault, t.actions);
      await t.trigger.tick(vault, t.actions);
    } finally {
      spy.mockRestore();
    }
    expect(t.judge.judge).toHaveBeenCalledTimes(1);
    expect(t.actions.suspend).toHaveBeenCalledTimes(1);
    expect(t.actions.enqueue).toHaveBeenCalledTimes(1);
    expect((await t.store.loadAll()).get('qa')).toEqual(kept);
  });
});
