import { describe, expect, it, vi } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';
import { DEFAULT_MATERIALITY_CONSTANTS } from '../../../src/ingestion/materiality/constants.js';
import { computeMaterialityHashes } from '../../../src/ingestion/materiality/hashes.js';
import type {
  MaterialityHashStore,
  MaterialityJudge,
  MaterialityRecord,
  MaterialityVerdictEvent,
} from '../../../src/ingestion/materiality/types.js';
import { MaterialityTrigger } from '../../../src/ingestion/materiality/wiring.js';

class FakeStore implements MaterialityHashStore {
  private readonly byPath = new Map<string, MaterialityRecord>();
  async load(path: string): Promise<MaterialityRecord | null> {
    return this.byPath.get(path) ?? null;
  }
  async save(record: MaterialityRecord): Promise<void> {
    this.byPath.set(record.path, record);
  }
}

function fakeClock(now: number) {
  return { now: () => now };
}

const PATH = 'Courses/GEO101/Lecture 3.md';

async function seed(store: FakeStore, text: string, lastChangedAt: number): Promise<void> {
  const hashes = await computeMaterialityHashes(text);
  await store.save({
    path: PATH,
    hashes,
    canonicalLength: canonicalizeForMateriality(text).length,
    lastChangedAt,
    lastVerdictAt: null,
  });
}

describe('MaterialityTrigger.evaluate', () => {
  it('reports unchanged and never calls the judge when the text is identical', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn() };
    const trigger = new MaterialityTrigger({ store, clock: fakeClock(1000), judge });

    const result = await trigger.evaluate(
      PATH,
      'Basalt weathers quickly.',
      'Basalt weathers quickly.',
    );

    expect(result).toEqual({ kind: 'unchanged' });
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('reports formatting-only and never calls the judge for a pure reflow', async () => {
    const store = new FakeStore();
    await seed(store, '# Weathering\n\nBasalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn() };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    const result = await trigger.evaluate(PATH, '## Weathering\n\nBasalt weathers quickly.');

    expect(result).toEqual({ kind: 'formatting-only' });
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('reports debounced immediately after a change, and does not call the judge', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn() };
    const trigger = new MaterialityTrigger({ store, clock: fakeClock(1), judge });

    const result = await trigger.evaluate(PATH, 'Basalt weathers slowly in cold climates.');

    expect(result.kind).toBe('debounced');
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('reports below-floor for a tiny edit past the debounce window, and does not call the judge', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn() };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    // One character added — a typo fix, well under the floor.
    const result = await trigger.evaluate(PATH, 'Basalt weathers quickly!');

    expect(result.kind).toBe('below-floor');
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('reports judge-unavailable when every free gate clears but no judge is configured', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge: null,
    });

    const result = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
      'Basalt weathers quickly.',
    );

    expect(result).toEqual({ kind: 'judge-unavailable' });
  });

  it('reports judge-unavailable when a judge exists but no previousText was supplied', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    const result = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
    );

    expect(result).toEqual({ kind: 'judge-unavailable' });
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('calls the judge and surfaces its verdict unchanged when every gate clears and previousText is supplied', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = {
      judge: vi.fn(async () => ({ material: true, reason: 'claim reversed' })),
    };
    const now = DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1;
    const onVerdict = vi.fn();
    const trigger = new MaterialityTrigger({ store, clock: fakeClock(now), judge, onVerdict });

    const result = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
      'Basalt weathers quickly.',
    );

    const expectedVerdict: MaterialityVerdictEvent = {
      path: PATH,
      at: now,
      material: true,
      reason: 'claim reversed',
    };
    expect(result).toEqual({ kind: 'verdict', verdict: expectedVerdict });
    expect(judge.judge).toHaveBeenCalledWith({
      path: PATH,
      previousText: 'Basalt weathers quickly.',
      currentText: 'Basalt does not weather at all in cold, dry climates.',
    });
    expect(onVerdict).toHaveBeenCalledWith(expectedVerdict);
  });

  it('surfaces a not-material judge verdict unchanged too — the cheap gates never override the judge', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: false })) };
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
    });

    const result = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
      'Basalt weathers quickly.',
    );

    expect(result.kind).toBe('verdict');
    if (result.kind === 'verdict') {
      expect(result.verdict.material).toBe(false);
    }
  });

  it('an onVerdict hook that throws never fails the evaluation it rode in on', async () => {
    const store = new FakeStore();
    await seed(store, 'Basalt weathers quickly.', 0);
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const onVerdict = vi.fn(() => {
      throw new Error('downstream consumer exploded');
    });
    const trigger = new MaterialityTrigger({
      store,
      clock: fakeClock(DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1),
      judge,
      onVerdict,
    });

    const result = await trigger.evaluate(
      PATH,
      'Basalt does not weather at all in cold, dry climates.',
      'Basalt weathers quickly.',
    );

    expect(result.kind).toBe('verdict');
  });

  it('a first sighting (no prior record) always calls the judge when one is configured and previousText is given', async () => {
    const store = new FakeStore();
    const judge: MaterialityJudge = { judge: vi.fn(async () => ({ material: true })) };
    const trigger = new MaterialityTrigger({ store, clock: fakeClock(0), judge });

    const result = await trigger.evaluate(PATH, 'Basalt weathers quickly.', '');

    expect(result.kind).toBe('verdict');
    expect(judge.judge).toHaveBeenCalledOnce();
  });
});
