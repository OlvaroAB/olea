/**
 * `ol-egov.141.89.5.66` (c): after a load, the previous-text tracker is primed from the vault for
 * every note whose text still matches its materiality record. Mirrors FP-43/FP-44. Synthetic text.
 */
import { describe, expect, it, vi } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';
import { DEFAULT_MATERIALITY_CONSTANTS } from '../../../src/ingestion/materiality/constants.js';
import { ObsidianMaterialityHashStore } from '../../../src/ingestion/materiality/hash-store.js';
import { computeMaterialityHashes } from '../../../src/ingestion/materiality/hashes.js';
import { ObsidianMaterialityPendingStore } from '../../../src/ingestion/materiality/pending-store.js';
import { createInMemoryPreviousTextTracker } from '../../../src/ingestion/materiality/previous-text.js';
import {
  listMaterialityRecordPaths,
  primePreviousTextFromVault,
} from '../../../src/ingestion/materiality/prime-previous-text.js';
import type { MaterialityJudgeInput } from '../../../src/ingestion/materiality/types.js';
import { MaterialityTrigger } from '../../../src/ingestion/materiality/wiring.js';

const PATH = 'Notes/rope-bridge.md';
const R0 = 'A rope bridge holds four walkers at a time.';
const R0_SMALL = 'A rope bridge holds five walkers at a time.';
const R1 = 'A rope bridge holds four walkers at a time, but only two when the planks are wet.';

const { debounceMs } = DEFAULT_MATERIALITY_CONSTANTS;

function makeHost() {
  let blob: unknown;
  return {
    loadData: async () => (blob === undefined ? undefined : structuredClone(blob)),
    saveData: async (data: unknown) => {
      blob = structuredClone(data);
    },
  };
}

async function setup(recorded: string = R0) {
  const host = makeHost();
  const store = new ObsidianMaterialityHashStore(host);
  await store.save({
    path: PATH,
    hashes: await computeMaterialityHashes(recorded),
    canonicalLength: canonicalizeForMateriality(recorded).length,
    lastChangedAt: 0,
    lastVerdictAt: 0,
    revision: 1,
  });
  return { host, store };
}

describe('primePreviousTextFromVault', () => {
  it('a-control: UNPRIMED (the defect), the escalating edit is judged against the intermediate save', async () => {
    const { host, store } = await setup();
    const vault = new Map([[PATH, R0]]);
    const tracker = createInMemoryPreviousTextTracker();
    await runSaves(host, store, vault, tracker, false);
  });

  it('a: primed from the vault, a small save then an escalating edit is judged from the original', async () => {
    const { host, store } = await setup();
    const vault = new Map([[PATH, R0]]);
    const tracker = createInMemoryPreviousTextTracker();
    const counts = await primePreviousTextFromVault({
      tracker,
      store,
      recordedPaths: await listMaterialityRecordPaths(() => host.loadData()),
      readText: async (p) => vault.get(p) ?? null,
    });
    expect(counts).toMatchObject({ primed: 1, mismatched: 0, unreadable: 0 });
    await runSaves(host, store, vault, tracker, true);
  });

  it('b: a note whose text no longer matches its record is not primed and is counted', async () => {
    const { store } = await setup();
    const tracker = createInMemoryPreviousTextTracker();
    const counts = await primePreviousTextFromVault({
      tracker,
      store,
      recordedPaths: [PATH],
      readText: async () => R1,
    });
    expect(counts).toMatchObject({ primed: 0, mismatched: 1, unreadable: 0 });
    expect(tracker.get(PATH)).toBeUndefined();
  });

  it('c: a path recorded by an observed edit before priming finishes is not overwritten', async () => {
    const { store } = await setup();
    const tracker = createInMemoryPreviousTextTracker();
    const counts = await primePreviousTextFromVault({
      tracker,
      store,
      recordedPaths: [PATH],
      readText: async () => {
        tracker.record(PATH, R1); // an edit observed while priming reads
        return R0;
      },
    });
    expect(counts.primed).toBe(0);
    expect(counts.alreadyKnown).toBe(1);
    expect(tracker.get(PATH)).toBe(R1);
  });

  it('d: an unreadable note is counted and priming never throws', async () => {
    const { store } = await setup();
    const tracker = createInMemoryPreviousTextTracker();
    const counts = await primePreviousTextFromVault({
      tracker,
      store,
      recordedPaths: [PATH, 'Notes/gone.md'],
      readText: async (p) => {
        if (p === PATH) throw new Error('read failed');
        return null;
      },
    });
    expect(counts).toMatchObject({ primed: 0, mismatched: 0, unreadable: 2 });
  });
});

async function runSaves(
  host: ReturnType<typeof makeHost>,
  store: ObsidianMaterialityHashStore,
  vault: Map<string, string>,
  tracker: ReturnType<typeof createInMemoryPreviousTextTracker>,
  primed: boolean,
): Promise<void> {
  const calls: JudgeCall[] = [];
  let at = debounceMs + 1;
  const clock = { now: () => at };
  const trigger = new MaterialityTrigger({
    store,
    clock,
    judge: {
      judge: vi.fn(async (i: MaterialityJudgeInput) => {
        calls.push({ previousText: i.previousText, currentText: i.currentText });
        return { material: true, reason: 'test double' };
      }),
    },
    pendingStore: new ObsidianMaterialityPendingStore(host),
    readCurrentText: async (p) => vault.get(p) ?? null,
    isOnline: () => true,
  });
  // The way main.ts feeds it: previous text from the tracker, recorded after each evaluate.
  for (const text of [R0_SMALL, R1]) {
    vault.set(PATH, text);
    const result = await trigger.evaluate(PATH, text, tracker.get(PATH));
    if (text === R0_SMALL) {
      expect(result.kind).toBe('below-floor');
      const pending = await new ObsidianMaterialityPendingStore(host).load(PATH);
      if (primed) expect(pending).toMatchObject({ baselineText: R0 });
      else expect(pending).toBeNull();
    }
    tracker.record(PATH, text);
    at += debounceMs + 1;
  }
  expect(calls).toHaveLength(1);
  expect(calls.at(-1)?.previousText).toBe(primed ? R0 : R0_SMALL);
  if (primed) expect(calls.at(-1)?.previousText).not.toBe(R0_SMALL);
  expect(calls.at(-1)?.currentText).toBe(R1);
}

type JudgeCall = { previousText: string; currentText: string };
