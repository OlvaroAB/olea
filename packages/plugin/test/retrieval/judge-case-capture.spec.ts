/**
 * `[JEV-6]` (`ol-3ux7.89`) — capture tests.
 *
 * **INV-3.** Every query string and every note path below is invented for
 * this file. Nothing here comes from her vault, and the tests are written so
 * that they would still be meaningful if the fixtures were random bytes,
 * because none of them depends on what the text says.
 */

import type { JudgeRequestRecord } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import {
  JUDGE_CASE_CAPTURE_CONFIG_KEY,
  JUDGE_CASE_CAPTURE_STORAGE_KEY,
  type JudgeCaseCaptureConfig,
  JudgeCaseCaptureRecorder,
  loadJudgeCaseCaptureConfig,
  MAX_JUDGE_CASE_CAP,
  ObsidianJudgeCaseCaptureStore,
} from '../../src/retrieval/judge-case-capture.js';

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

const CONFIG: JudgeCaseCaptureConfig = { enabled: true, seed: 20260922, cap: 5 };

function request(n: number): JudgeRequestRecord {
  return {
    query: `fixture question number ${n}`,
    refs: [
      { path: `fixtures/note-${n}.md`, blockIndex: 0 },
      { path: `fixtures/note-${n}.md`, blockIndex: 3 },
    ],
    intendedOperation: 'define',
  };
}

function at(n: number): string {
  return new Date(Date.UTC(2026, 8, 22, 0, 0, n)).toISOString();
}

describe('capture is off by default and inert', () => {
  it('returns null config for an absent key, a malformed key, and enabled that is not true', () => {
    expect(loadJudgeCaseCaptureConfig(null)).toBeNull();
    expect(loadJudgeCaseCaptureConfig({})).toBeNull();
    expect(loadJudgeCaseCaptureConfig({ [JUDGE_CASE_CAPTURE_CONFIG_KEY]: 'yes' })).toBeNull();
    // The near-miss that matters: truthy but not the boolean.
    expect(
      loadJudgeCaseCaptureConfig({
        [JUDGE_CASE_CAPTURE_CONFIG_KEY]: { enabled: 'true', seed: 1, cap: 5 },
      }),
    ).toBeNull();
    // Half-written config captures nothing rather than defaulting.
    expect(
      loadJudgeCaseCaptureConfig({ [JUDGE_CASE_CAPTURE_CONFIG_KEY]: { enabled: true, seed: 1 } }),
    ).toBeNull();
    expect(
      loadJudgeCaseCaptureConfig({
        [JUDGE_CASE_CAPTURE_CONFIG_KEY]: { enabled: true, seed: 1, cap: 0 },
      }),
    ).toBeNull();
  });

  it('accepts a deliberately written config and clamps an oversized cap', () => {
    const cfg = loadJudgeCaseCaptureConfig({
      [JUDGE_CASE_CAPTURE_CONFIG_KEY]: { enabled: true, seed: 7, cap: 10_000 },
    });
    expect(cfg).toEqual({ enabled: true, seed: 7, cap: MAX_JUDGE_CASE_CAP });
  });

  it('writes nothing to data.json when the config was never written', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherStore: { untouched: true } };
    const store = new ObsidianJudgeCaseCaptureStore(host);
    expect(await store.loadConfig()).toBeNull();
    expect(await store.load()).toBeNull();
    expect(host.blob).toEqual({ someOtherStore: { untouched: true } });
  });

  it('a disabled capture has no recorder to observe with, so nothing is ever assembled', () => {
    // The inertness is structural: with no config there is no recorder, and
    // `snapshot()` of a recorder that never observed is null, so there is
    // nothing a caller could persist even by mistake.
    const recorder = new JudgeCaseCaptureRecorder(CONFIG);
    expect(recorder.snapshot()).toBeNull();
  });
});

describe('the window and the cap hold', () => {
  it('never holds more than the cap, and records the full frame it sampled from', () => {
    const recorder = new JudgeCaseCaptureRecorder(CONFIG);
    for (let i = 0; i < 200; i += 1) recorder.observe(request(i), at(i));
    const snap = recorder.snapshot();
    expect(snap).not.toBeNull();
    expect(snap?.cases.length).toBe(5);
    expect(snap?.observedCount).toBe(200);
    expect(snap?.windowStartedAt).toBe(at(0));
    expect(snap?.lastObservedAt).toBe(at(199));
  });

  it('closes the window on maxDurationMs and ignores everything after it', () => {
    const recorder = new JudgeCaseCaptureRecorder({ ...CONFIG, maxDurationMs: 10_000 });
    recorder.observe(request(0), at(0));
    recorder.observe(request(1), at(5));
    recorder.observe(request(2), at(60)); // 60s in, past the 10s bound
    recorder.observe(request(3), at(61));
    const snap = recorder.snapshot();
    expect(snap?.observedCount).toBe(2);
    expect(snap?.windowClosedAt).toBe(at(60));
  });

  it('stop() ends recording and keeps what was already held', () => {
    const recorder = new JudgeCaseCaptureRecorder(CONFIG);
    recorder.observe(request(0), at(0));
    recorder.observe(request(1), at(1));
    recorder.stop(at(2));
    recorder.observe(request(2), at(3));
    const snap = recorder.snapshot();
    expect(snap?.observedCount).toBe(2);
    expect(snap?.cases.length).toBe(2);
    expect(snap?.windowClosedAt).toBe(at(2));
  });

  it('carries the window start across a restart rather than starting a new window', () => {
    const first = new JudgeCaseCaptureRecorder(CONFIG);
    for (let i = 0; i < 20; i += 1) first.observe(request(i), at(i));
    const persisted = first.snapshot();

    const second = new JudgeCaseCaptureRecorder(CONFIG);
    second.seed(persisted);
    second.observe(request(20), at(20));
    const snap = second.snapshot();
    expect(snap?.windowStartedAt).toBe(at(0));
    expect(snap?.observedCount).toBe(21);
  });
});

describe('the seeded draw is reproducible', () => {
  it('replaying the same sequence under the same seed yields the identical held set', () => {
    const run = (): readonly string[] => {
      const recorder = new JudgeCaseCaptureRecorder(CONFIG);
      for (let i = 0; i < 137; i += 1) recorder.observe(request(i), at(i));
      return (recorder.snapshot()?.cases ?? []).map((c) => c.caseId);
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.length).toBe(5);
  });

  it('is reproducible ACROSS a restart, which a streaming generator would not be', () => {
    const whole = new JudgeCaseCaptureRecorder(CONFIG);
    for (let i = 0; i < 137; i += 1) whole.observe(request(i), at(i));

    // The same 137 observations, split over three sessions with a
    // persist/reload between each.
    let carried = null as ReturnType<JudgeCaseCaptureRecorder['snapshot']>;
    for (const [from, to] of [
      [0, 40],
      [40, 91],
      [91, 137],
    ] as const) {
      const session = new JudgeCaseCaptureRecorder(CONFIG);
      session.seed(carried);
      for (let i = from; i < to; i += 1) session.observe(request(i), at(i));
      carried = session.snapshot();
    }

    expect(carried?.cases.map((c) => c.caseId)).toEqual(
      whole.snapshot()?.cases.map((c) => c.caseId),
    );
  });

  it('a different seed selects a different set, so the seed is doing the work', () => {
    const idsFor = (seed: number): readonly string[] => {
      const recorder = new JudgeCaseCaptureRecorder({ ...CONFIG, seed });
      for (let i = 0; i < 137; i += 1) recorder.observe(request(i), at(i));
      return (recorder.snapshot()?.cases ?? []).map((c) => c.caseId);
    };
    expect(idsFor(20260922)).not.toEqual(idsFor(11111));
  });
});

describe('what the record carries, and stopping deletes', () => {
  it('holds the query, the refs and nothing else about the request', () => {
    const recorder = new JudgeCaseCaptureRecorder(CONFIG);
    recorder.observe(request(1), at(0));
    const held = recorder.snapshot()?.cases[0];
    expect(Object.keys(held ?? {}).sort()).toEqual([
      'capturedAt',
      'caseId',
      'intendedOperation',
      'observedIndex',
      'query',
      'refs',
    ]);
    // Pointers only: a ref has a path and a block index, and no text field.
    for (const ref of held?.refs ?? []) {
      expect(Object.keys(ref).sort()).toEqual(['blockIndex', 'path']);
    }
  });

  it('round-trips through data.json and clear() deletes every captured case', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianJudgeCaseCaptureStore(host);
    const recorder = new JudgeCaseCaptureRecorder(CONFIG);
    for (let i = 0; i < 12; i += 1) recorder.observe(request(i), at(i));
    const snap = recorder.snapshot();
    if (snap === null) throw new Error('expected a snapshot');
    await store.save(snap);

    expect(await store.load()).toEqual(snap);
    expect(JSON.stringify(host.blob)).toContain('fixture question number');

    await store.clear();
    expect(await store.load()).toBeNull();
    // Deleted, not merely emptied: no captured text survives anywhere in the blob.
    expect(JSON.stringify(host.blob)).not.toContain('fixture question number');
    expect((host.blob as Record<string, unknown>)[JUDGE_CASE_CAPTURE_STORAGE_KEY]).toBeUndefined();
  });

  it('clear() leaves the config key alone, so clearing and stopping stay distinguishable', async () => {
    const host = new FakeDataHost();
    host.blob = {
      [JUDGE_CASE_CAPTURE_CONFIG_KEY]: { enabled: true, seed: 1, cap: 3 },
      [JUDGE_CASE_CAPTURE_STORAGE_KEY]: { anything: true },
    };
    await new ObsidianJudgeCaseCaptureStore(host).clear();
    const blob = host.blob as Record<string, unknown>;
    expect(blob[JUDGE_CASE_CAPTURE_STORAGE_KEY]).toBeUndefined();
    expect(blob[JUDGE_CASE_CAPTURE_CONFIG_KEY]).toEqual({ enabled: true, seed: 1, cap: 3 });
  });

  it('rejects a corrupted stored record rather than loading half of it', async () => {
    const host = new FakeDataHost();
    host.blob = {
      [JUDGE_CASE_CAPTURE_STORAGE_KEY]: { version: 1, seed: 1, cap: 3, cases: 'not an array' },
    };
    expect(await new ObsidianJudgeCaseCaptureStore(host).load()).toBeNull();
  });
});

describe('a failure in capture cannot affect anything', () => {
  it('observe() never throws on a malformed record', () => {
    const recorder = new JudgeCaseCaptureRecorder(CONFIG);
    const broken = {
      query: 'fixture question',
      get refs(): never {
        throw new Error('boom');
      },
    } as unknown as JudgeRequestRecord;
    expect(() => recorder.observe(broken, at(0))).not.toThrow();
    expect(recorder.observe(broken, at(0))).toBe(false);
  });

  it('load() and loadConfig() never throw when the host itself fails', async () => {
    const failing: ObsidianDataHost = {
      loadData: () => Promise.reject(new Error('disk')),
      saveData: () => Promise.resolve(),
    };
    const store = new ObsidianJudgeCaseCaptureStore(failing);
    expect(await store.load()).toBeNull();
    expect(await store.loadConfig()).toBeNull();
  });
});
