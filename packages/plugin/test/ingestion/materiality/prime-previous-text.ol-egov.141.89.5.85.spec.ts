/**
 * `ol-egov.141.89.5.85` ([D-311]): a note changed while Obsidian was closed is marked "previous
 * unknown" so its first save is never judged against a wrong baseline; the priming gate makes an
 * evaluation wait for priming. Synthetic text.
 */
import { describe, expect, it, vi } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';
import { DEFAULT_MATERIALITY_CONSTANTS } from '../../../src/ingestion/materiality/constants.js';
import { ObsidianMaterialityHashStore } from '../../../src/ingestion/materiality/hash-store.js';
import { computeMaterialityHashes } from '../../../src/ingestion/materiality/hashes.js';
import { ObsidianMaterialityPendingStore } from '../../../src/ingestion/materiality/pending-store.js';
import { createInMemoryPreviousTextTracker } from '../../../src/ingestion/materiality/previous-text.js';
import { primePreviousTextFromVault } from '../../../src/ingestion/materiality/prime-previous-text.js';
import { createPrimingGate } from '../../../src/ingestion/materiality/priming-gate.js';
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

async function setup(lastChangedAt = 0, now = debounceMs + 1) {
  const host = makeHost();
  const store = new ObsidianMaterialityHashStore(host);
  await store.save({
    path: PATH,
    hashes: await computeMaterialityHashes(R0),
    canonicalLength: canonicalizeForMateriality(R0).length,
    lastChangedAt,
    lastVerdictAt: 0,
    revision: 1,
  });
  const calls: Array<{ previousText: string; currentText: string }> = [];
  let at = now;
  const trigger = new MaterialityTrigger({
    store,
    clock: { now: () => at },
    judge: {
      judge: vi.fn(async (i: MaterialityJudgeInput) => {
        calls.push({ previousText: i.previousText, currentText: i.currentText });
        return { material: true, reason: 'test double' };
      }),
    },
    pendingStore: new ObsidianMaterialityPendingStore(host),
    readCurrentText: async () => null,
    isOnline: () => true,
  });
  return { trigger, calls, advance: (ms: number) => (at += ms) };
}

describe('a note marked previous-unknown', () => {
  it('a: a below-floor first save resolves judge-unavailable, no judge call', async () => {
    const { trigger, calls } = await setup();
    trigger.markPreviousUnknown(PATH);
    const r = await trigger.evaluate(PATH, R0_SMALL, undefined);
    expect(r.kind).toBe('judge-unavailable');
    expect(calls).toHaveLength(0);
  });

  it('b: a debounced first save resolves judge-unavailable, no judge call', async () => {
    const { trigger, calls } = await setup(debounceMs + 1);
    const control = await setup(debounceMs + 1);
    expect((await control.trigger.evaluate(PATH, R0_SMALL, undefined)).kind).toBe('debounced');
    trigger.markPreviousUnknown(PATH);
    const r = await trigger.evaluate(PATH, R0_SMALL, undefined);
    expect(r.kind).toBe('judge-unavailable');
    expect(calls).toHaveLength(0);
  });

  it('c: a large first save resolves judge-unavailable, no judge call', async () => {
    const { trigger, calls } = await setup();
    trigger.markPreviousUnknown(PATH);
    const r = await trigger.evaluate(PATH, R1, undefined);
    expect(r.kind).toBe('judge-unavailable');
    expect(calls).toHaveLength(0);
  });

  it('d: control, unmarked with no previous text keeps today routing', async () => {
    const { trigger, calls } = await setup();
    expect((await trigger.evaluate(PATH, R0_SMALL, undefined)).kind).toBe('below-floor');
    expect(calls).toHaveLength(0);
  });

  it('e: back at its baseline resolves unchanged and spends the mark', async () => {
    const { trigger, calls } = await setup();
    trigger.markPreviousUnknown(PATH);
    expect((await trigger.evaluate(PATH, R0, undefined)).kind).toBe('unchanged');
    expect((await trigger.evaluate(PATH, R0_SMALL, undefined)).kind).toBe('below-floor');
    expect(calls).toHaveLength(0);
  });

  it('f: the second save is judged against the first save text', async () => {
    const { trigger, calls, advance } = await setup();
    trigger.markPreviousUnknown(PATH);
    expect((await trigger.evaluate(PATH, R0_SMALL, undefined)).kind).toBe('judge-unavailable');
    advance(debounceMs + 1);
    await trigger.evaluate(PATH, R1, R0_SMALL);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.previousText).toBe(R0_SMALL);
    expect(calls[0]?.currentText).toBe(R1);
  });
});

describe('priming marks', () => {
  it('g: markPreviousUnknown is called for mismatched notes only', async () => {
    const { host } = { host: makeHost() };
    const store = new ObsidianMaterialityHashStore(host);
    for (const p of ['Notes/same.md', 'Notes/changed.md']) {
      await store.save({
        path: p,
        hashes: await computeMaterialityHashes(R0),
        canonicalLength: canonicalizeForMateriality(R0).length,
        lastChangedAt: 0,
        lastVerdictAt: 0,
        revision: 1,
      });
    }
    const marked: string[] = [];
    const counts = await primePreviousTextFromVault({
      tracker: createInMemoryPreviousTextTracker(),
      store,
      recordedPaths: ['Notes/same.md', 'Notes/changed.md', 'Notes/gone.md'],
      readText: async (p) => (p === 'Notes/same.md' ? R0 : p === 'Notes/changed.md' ? R1 : null),
      markPreviousUnknown: (p) => marked.push(p),
    });
    expect(counts).toMatchObject({ primed: 1, mismatched: 1, unreadable: 1 });
    expect(marked).toEqual(['Notes/changed.md']);
  });
});

describe('priming gate', () => {
  it('h: an evaluation waits until priming settles, even when priming fails', async () => {
    const gate = createPrimingGate();
    let release: () => void = () => {};
    const running = gate.run(
      () =>
        new Promise<void>((_, reject) => {
          release = () => reject(new Error('boom'));
        }),
    );
    let waited = false;
    const waiter = gate.whenSettled.then(() => {
      waited = true;
    });
    await Promise.resolve();
    expect(waited).toBe(false);
    release();
    await running;
    await waiter;
    expect(waited).toBe(true);
  });

  it('i: the gate resolves for a task that completes', async () => {
    const gate = createPrimingGate();
    await gate.run(async () => {});
    await gate.whenSettled;
  });
});
