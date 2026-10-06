/**
 * `ol-egov.141.89.5.77` (full-path case FP-31): a confirmed rewrite whose suspend or enqueue failed
 * is retried on later passes WITHOUT a new judge call (so the `[D-400]` budget is never re-spent for
 * an answer already given), under a bounded rule, and a final failure is recorded (console.error and
 * the tick report's `successorEnqueueFailed`). Under `[D-508]` the question stays withheld meanwhile.
 * Every fixture string is invented.
 */
import {
  citationStorePath,
  enumerateVaultInstruments,
  type ListOptions,
  type RevisionJudgePort,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import type {
  CitationAnchorRecord,
  CitationHashStore,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
import {
  adaptMaterialityJudgeAsRevisionJudge,
  CitationRevisionTrigger,
} from '../../../src/ingestion/materiality/citation-revision-wiring.js';
import type { MaterialityJudge } from '../../../src/ingestion/materiality/types.js';

class MemoryVaultSource implements VaultSource {
  private readonly files = new Map<string, string>();
  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, content);
  }
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const extensions = options.extensions?.map((e) => e.toLowerCase());
    return [...this.files.keys()]
      .filter((p) => {
        if (extensions === undefined) return true;
        const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
        return extensions.includes(ext);
      })
      .sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`MemoryVaultSource.read: not found: ${path}`);
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

class FakeCitationHashStore implements CitationHashStore {
  readonly byId = new Map<string, CitationAnchorRecord>();
  async loadAll(): Promise<ReadonlyMap<string, CitationAnchorRecord>> {
    return new Map(this.byId);
  }
  async save(instrumentId: string, record: CitationAnchorRecord): Promise<void> {
    this.byId.set(instrumentId, record);
  }
  async remove(instrumentId: string): Promise<void> {
    this.byId.delete(instrumentId);
  }
  // [D-351]/[D-400] — same semantics as `ObsidianCitationHashStore`: a
  // no-op when nothing is tracked yet; a genuinely NEW hash supersedes with
  // fresh state, but the SAME hash already pending leaves dispatch/retry
  // state exactly as it was (real `recordPending` fires unconditionally
  // every tick, including ones this trigger's own [D-400] gate deliberately
  // does not re-dispatch for).
  async setPendingRevalidation(
    instrumentId: string,
    sourceContentHash: string,
    since: number,
  ): Promise<void> {
    const existing = this.byId.get(instrumentId);
    if (existing === undefined) return;
    const existingPending = existing.pendingRevalidation;
    this.byId.set(instrumentId, {
      ...existing,
      pendingRevalidation:
        existingPending?.sinceContentHash === sourceContentHash
          ? existingPending
          : { sinceContentHash: sourceContentHash, since },
    });
  }
  async isPendingRevalidationCurrent(
    instrumentId: string,
    expectedSourceContentHash: string,
  ): Promise<boolean> {
    return (
      this.byId.get(instrumentId)?.pendingRevalidation?.sinceContentHash ===
      expectedSourceContentHash
    );
  }
  // [D-400]
  async recordDispatch(
    instrumentId: string,
    sourceContentHash: string,
    dispatchedAt: number,
    retry: boolean,
  ): Promise<void> {
    const existing = this.byId.get(instrumentId);
    if (existing === undefined) return;
    const existingPending = existing.pendingRevalidation;
    const forSameDifference = existingPending?.sinceContentHash === sourceContentHash;
    const since = forSameDifference ? existingPending.since : dispatchedAt;
    const carriedRetriedAt = forSameDifference ? existingPending.retriedAt : undefined;
    this.byId.set(instrumentId, {
      ...existing,
      pendingRevalidation: {
        sinceContentHash: sourceContentHash,
        since,
        dispatchedAt,
        ...(retry
          ? { retriedAt: dispatchedAt }
          : carriedRetriedAt !== undefined
            ? { retriedAt: carriedRetriedAt }
            : {}),
      },
    });
  }
}

function fakeClock(now: number) {
  return { now: () => now };
}

const NOTE_PATH = 'Courses/GEO101/Weathering.md';
const CONCEPT_TOPIC = 'Weathering rates';
const PARAGRAPH_A = 'Basalt weathers quickly in humid climates.';
const PARAGRAPH_B = 'Basalt weathers slowly in cold, dry climates instead.';
const MCQ_ID = 'q1';

function mcqBlock(id: string): string {
  return [
    '```olea-mcq',
    `id: ${id}`,
    'stem: Which mineral is most weathering-resistant?',
    'answer: Quartz',
    'distractor: Olivine',
    'distractor: Feldspar',
    'distractor: Biotite',
    'distractor: Calcite',
    '```',
  ].join('\n');
}

function note(paragraph: string, mcqId: string = MCQ_ID): string {
  return [
    '---',
    `topic: [${CONCEPT_TOPIC}]`,
    'course: GEO101',
    '---',
    '',
    '## What resists weathering?',
    '',
    paragraph,
    '',
    mcqBlock(mcqId),
    '',
  ].join('\n');
}

function citationSidecar(instrumentId: string, sourcePath: VaultPath): string {
  return `${JSON.stringify({ instrumentId, sourcePath, page: 1, schemaVersion: 1 }, null, 2)}\n`;
}

function actions(overrides: Partial<Parameters<CitationRevisionTrigger['tick']>[1]> = {}) {
  return {
    enqueue: vi.fn(async () => undefined),
    suspend: vi.fn(async () => undefined),
    ...overrides,
  };
}

const SUCCESSOR_RETRY_BOUND = 5;

function setup() {
  const vault = new MemoryVaultSource({
    [NOTE_PATH]: note(PARAGRAPH_A),
    [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
  });
  const store = new FakeCitationHashStore();
  const judge: RevisionJudgePort = { judge: vi.fn(async () => ({ material: true })) };
  const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });
  return { vault, store, judge, trigger };
}

describe('CitationRevisionTrigger.tick: a confirmed rewrite is retried without the judge', () => {
  it('FP-31: enqueue fails twice then succeeds, and the successor is enqueued with no third judge call', async () => {
    const { vault, store, judge, trigger } = setup();
    await trigger.tick(vault, actions());
    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    let failures = 2;
    const flaky = actions({
      enqueue: vi.fn(async () => {
        if (failures-- > 0) throw new Error('queue down');
      }),
    });
    await trigger.tick(vault, flaky);
    await trigger.tick(vault, flaky);
    const third = await trigger.tick(vault, flaky);
    await trigger.tick(vault, flaky);

    expect(flaky.enqueue).toHaveBeenCalledTimes(3);
    expect(vi.mocked(judge.judge).mock.calls.length).toBeLessThanOrEqual(1);
    expect(third.revised + third.refreshed).toBe(0);
    // Tracking retired; any later entry is a fresh baseline of the new text, with no pending fact.
    expect((await store.loadAll()).get(MCQ_ID)?.pendingRevalidation).toBeUndefined();
  });

  it('a bounded final failure is recorded and stops retrying, still with no extra judge call', async () => {
    const { vault, store, judge, trigger } = setup();
    await trigger.tick(vault, actions());
    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const down = actions({
      enqueue: vi.fn(async () => {
        throw new Error('queue down');
      }),
    });
    let failedTotal = 0;
    for (let i = 0; i < SUCCESSOR_RETRY_BOUND + 4; i += 1) {
      failedTotal += (await trigger.tick(vault, down)).successorEnqueueFailed;
    }

    expect(down.enqueue).toHaveBeenCalledTimes(SUCCESSOR_RETRY_BOUND);
    expect(failedTotal).toBe(1);
    expect(vi.mocked(judge.judge)).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls.some((c) => String(c[0]).includes('successor enqueue gave up'))).toBe(
      true,
    );
    // Withheld, never restored: the anchor and its pending fact remain.
    expect((await store.loadAll()).get(MCQ_ID)?.pendingRevalidation).toBeDefined();
  });
});
