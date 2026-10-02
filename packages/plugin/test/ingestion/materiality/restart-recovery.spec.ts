/**
 * `[D-427]` (`ol-egov.141.89.5.31`): a file-level materiality check unfinished at restart is
 * recovered, including edits still waiting in memory.
 *
 * Every test here builds the trigger the way `buildMaterialityWiring` does in production: the
 * real `ObsidianMaterialityHashStore` and the real `ObsidianMaterialityPendingStore`, both over
 * ONE fake `data.json` host, so a "restart" is a brand-new `MaterialityTrigger` sharing only that
 * host and the vault — every in-memory map starts empty, exactly as after a real restart. The
 * consumers are counted through `tick`, a restatement of `main.ts`'s `drainPendingMaterialityEdits`
 * (recovery first, then the drain), checked against `main.ts`'s own source in the last block, the
 * same source-level method `test/main-wiring.spec.ts` uses because `main.ts` cannot be loaded here.
 *
 * Every text is invented and subject-neutral (a rope bridge); nothing here is vault material.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';
import { DEFAULT_MATERIALITY_CONSTANTS } from '../../../src/ingestion/materiality/constants.js';
import { ObsidianMaterialityHashStore } from '../../../src/ingestion/materiality/hash-store.js';
import { computeMaterialityHashes } from '../../../src/ingestion/materiality/hashes.js';
import {
  isMaterialityPendingCheck,
  MATERIALITY_PENDING_STORAGE_KEY,
  type MaterialityPendingCheck,
  ObsidianMaterialityPendingStore,
} from '../../../src/ingestion/materiality/pending-store.js';
import type {
  MaterialityJudge,
  MaterialityJudgeInput,
  MaterialityJudgeVerdict,
} from '../../../src/ingestion/materiality/types.js';
import {
  type MaterialityEvaluationResult,
  MaterialityTrigger,
} from '../../../src/ingestion/materiality/wiring.js';

const PATH = 'Notes/rope-bridge.md';
const R0 = 'A rope bridge holds four walkers at a time.';
/** Same length as R0 (four -> five): below the minimum-edit-size floor. */
const R0_SMALL = 'A rope bridge holds five walkers at a time.';
const R1 = 'A rope bridge holds four walkers at a time, but only two when the planks are wet.';
const R2 =
  'A rope bridge holds four walkers at a time, but only one when the planks are wet or icy.';
/** R0 laid out differently, same words: formatting-only against R0. */
const R0_REFLOWED = '# A rope bridge holds **four** walkers at a time.';

const { debounceMs, pendingDrainMs } = DEFAULT_MATERIALITY_CONSTANTS;
const T0 = debounceMs + 1;

interface Host {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
  blob(): Record<string, unknown>;
}

/** One fake `data.json`: both stores read and write it, as in production. */
function makeHost(): Host {
  let blob: unknown;
  return {
    loadData: async () => (blob === undefined ? undefined : structuredClone(blob)),
    saveData: async (data) => {
      blob = structuredClone(data);
    },
    blob: () => (blob ?? {}) as Record<string, unknown>,
  };
}

function steppedClock(initial: number) {
  let current = initial;
  return { now: () => current, set: (next: number) => (current = next) };
}

type JudgeCall = { previousText: string; currentText: string };

/** A judge double whose every call is answered by `answer`, with the calls recorded. */
function judgeOf(
  answer: (input: MaterialityJudgeInput, index: number) => Promise<MaterialityJudgeVerdict>,
): { judge: MaterialityJudge; calls: JudgeCall[] } {
  const calls: JudgeCall[] = [];
  const judge: MaterialityJudge = {
    judge: vi.fn(async (input: MaterialityJudgeInput) => {
      calls.push({ previousText: input.previousText, currentText: input.currentText });
      return answer(input, calls.length - 1);
    }),
  };
  return { judge, calls };
}
const answering = (material = true) => judgeOf(async () => ({ material, reason: 'test double' }));
const hanging = () => judgeOf(() => new Promise<MaterialityJudgeVerdict>(() => {}));
const failing = () =>
  judgeOf(async () => {
    throw new Error('simulated provider failure');
  });

/** Counts what reaches row 1.4's two consumers, per settled text. */
class Consumers {
  readonly processed: string[] = [];
  readonly generation: string[] = [];
  private static observed(result: MaterialityEvaluationResult): boolean {
    return (
      result.kind === 'judge-unavailable' || (result.kind === 'verdict' && result.verdict.material)
    );
  }
  /** `main.ts`'s `evaluateMaterialityChange`, for a direct evaluation. */
  direct(path: string, text: string, result: MaterialityEvaluationResult): void {
    const processing =
      result.kind === 'verdict' ||
      result.kind === 'judge-unavailable' ||
      result.kind === 'call-judge';
    if (processing) this.processed.push(`${path}@${text}`);
    if (Consumers.observed(result)) this.generation.push(`${path}@${text}`);
  }
  /** `main.ts`'s `drainPendingMaterialityEdits`: recovery first, then the drain. */
  async tick(trigger: MaterialityTrigger, now: number): Promise<void> {
    for (const { path, currentText, result } of await trigger.recoverUnfinishedChecks(now)) {
      this.direct(path, currentText, result);
    }
    for (const { verdict, currentText } of await trigger.drainDuePendingEdits(now)) {
      this.processed.push(`${verdict.path}@${currentText}`);
      if (verdict.material) this.generation.push(`${verdict.path}@${currentText}`);
    }
  }
}

interface World {
  readonly host: Host;
  readonly hashStore: ObsidianMaterialityHashStore;
  readonly pendingStore: ObsidianMaterialityPendingStore;
  readonly vault: Map<string, string>;
  readonly clock: ReturnType<typeof steppedClock>;
  online: boolean;
  /** A fresh instance over the same persisted state: a restart. */
  start(judge: MaterialityJudge | null): MaterialityTrigger;
  pending(): Promise<MaterialityPendingCheck | null>;
}

async function world(): Promise<World> {
  const host = makeHost();
  const hashStore = new ObsidianMaterialityHashStore(host);
  const pendingStore = new ObsidianMaterialityPendingStore(host);
  const vault = new Map<string, string>([[PATH, R0]]);
  const clock = steppedClock(T0);
  // An established, settled baseline at revision 1 (not a legacy record).
  await hashStore.save({
    path: PATH,
    hashes: await computeMaterialityHashes(R0),
    canonicalLength: canonicalizeForMateriality(R0).length,
    lastChangedAt: 0,
    lastVerdictAt: 0,
    revision: 1,
  });
  const w: World = {
    host,
    hashStore,
    pendingStore,
    vault,
    clock,
    online: true,
    start: (judge) =>
      new MaterialityTrigger({
        store: hashStore,
        clock,
        judge,
        pendingStore,
        readCurrentText: async (path) => vault.get(path) ?? null,
        isOnline: () => w.online,
      }),
    pending: () => pendingStore.load(PATH),
  };
  return w;
}

/** A save the watch would see: the vault changes, then `evaluate` runs. */
function save(w: World, trigger: MaterialityTrigger, text: string, previous?: string) {
  w.vault.set(PATH, text);
  return trigger.evaluate(PATH, text, previous);
}

/** Marks the settled record as changed at `at`, so the next save falls inside the debounce window. */
async function changedAt(w: World, at: number): Promise<void> {
  const record = await w.hashStore.load(PATH);
  if (record === null) throw new Error('fixture: no settled record');
  await w.hashStore.save({ ...record, lastChangedAt: at });
}

describe('[D-427] recovery before dispatch: an edit still waiting in memory at restart', () => {
  it('a below-floor edit held at restart is recorded, put back on recovery, and decided by the drain once', async () => {
    const w = await world();
    const consumers = new Consumers();
    const a = w.start(answering().judge);
    expect((await save(w, a, R0_SMALL, R0)).kind).toBe('below-floor');

    const recorded = await w.pending();
    expect(recorded).toMatchObject({
      baselineText: R0,
      revision: 1,
      since: T0,
      waiting: 'below-floor',
    });

    // Restart before the drain window elapses: the in-memory hold is gone.
    const { judge, calls } = answering();
    const b = w.start(judge);
    w.clock.set(T0 + pendingDrainMs);
    await consumers.tick(b, w.clock.now());

    expect(calls).toEqual([{ previousText: R0, currentText: R0_SMALL }]);
    expect(consumers.processed).toEqual([`${PATH}@${R0_SMALL}`]);
    expect(consumers.generation).toEqual([`${PATH}@${R0_SMALL}`]);
    expect((await w.hashStore.load(PATH))?.revision).toBe(2);
    expect(await w.pending()).toBeNull();

    // Further ticks find nothing: decided exactly once.
    await consumers.tick(b, w.clock.now() + pendingDrainMs);
    await consumers.tick(b, w.clock.now() + 2 * pendingDrainMs);
    expect(calls).toHaveLength(1);
    expect(consumers.generation).toHaveLength(1);
  });

  it('a debounced edit held at restart keeps its original time, so it is decided once its quiet window has passed', async () => {
    const w = await world();
    const consumers = new Consumers();
    await changedAt(w, T0);
    const a = w.start(answering().judge);
    w.clock.set(T0 + 1_000);
    expect((await save(w, a, R1, R0)).kind).toBe('debounced');
    expect(await w.pending()).toMatchObject({ waiting: 'debounced', since: T0 + 1_000 });

    const { judge, calls } = answering();
    const b = w.start(judge);
    w.clock.set(T0 + 1_000 + debounceMs - 1);
    await consumers.tick(b, w.clock.now());
    expect(calls).toHaveLength(0); // put back, not yet due

    w.clock.set(T0 + 1_000 + debounceMs);
    await consumers.tick(b, w.clock.now());
    expect(calls).toEqual([{ previousText: R0, currentText: R1 }]);
    expect(consumers.generation).toEqual([`${PATH}@${R1}`]);
    expect(await w.pending()).toBeNull();
  });
});

describe('[D-427] recovery during a call: a call in flight at restart gets its one retry', () => {
  it('the retry is recorded as spent before it is sent, is answered, and settles once', async () => {
    const w = await world();
    const consumers = new Consumers();
    const lost = hanging();
    const a = w.start(lost.judge);
    void save(w, a, R1, R0);
    await vi.waitFor(() => expect(lost.calls).toHaveLength(1));

    const inFlight = await w.pending();
    expect(inFlight).toMatchObject({
      baselineText: R0,
      revision: 1,
      waiting: 'judge',
      dispatchedHash: (await computeMaterialityHashes(R1)).rawHash,
      dispatchedAt: T0,
    });
    expect(inFlight?.retriedAt).toBeUndefined();

    // Restart. The retry's spend must already be on the record when the judge is called.
    let recordAtRetry: MaterialityPendingCheck | null = null;
    const retry = judgeOf(async () => {
      recordAtRetry = await w.pending();
      return { material: true };
    });
    const b = w.start(retry.judge);
    w.clock.set(T0 + 30_000);
    await consumers.tick(b, w.clock.now());

    expect(retry.calls).toEqual([{ previousText: R0, currentText: R1 }]);
    expect(recordAtRetry).toMatchObject({ waiting: 'judge', retriedAt: T0 + 30_000 });
    expect(consumers.processed).toEqual([`${PATH}@${R1}`]);
    expect(consumers.generation).toEqual([`${PATH}@${R1}`]);
    expect((await w.hashStore.load(PATH))?.revision).toBe(2);
    expect(await w.pending()).toBeNull();

    await consumers.tick(b, w.clock.now() + 30_000);
    expect(retry.calls).toHaveLength(1);
    expect(consumers.generation).toHaveLength(1);
  });

  it('while the Worker is unreachable nothing is sent and the retry is not spent; it goes once reachable', async () => {
    const w = await world();
    const consumers = new Consumers();
    const lost = hanging();
    void save(w, w.start(lost.judge), R1, R0);
    await vi.waitFor(() => expect(lost.calls).toHaveLength(1));

    const { judge, calls } = answering();
    const b = w.start(judge);
    w.online = false;
    await consumers.tick(b, T0 + 30_000);
    await consumers.tick(b, T0 + 60_000);
    expect(calls).toHaveLength(0);
    expect((await w.pending())?.retriedAt).toBeUndefined();

    w.online = true;
    await consumers.tick(b, T0 + 90_000);
    expect(calls).toHaveLength(1);
    expect(consumers.generation).toEqual([`${PATH}@${R1}`]);
    expect(await w.pending()).toBeNull();
  });

  it('with no judge configured after the restart, the lost call reads judge-unavailable and is cleared', async () => {
    const w = await world();
    const consumers = new Consumers();
    const lost = hanging();
    void save(w, w.start(lost.judge), R1, R0);
    await vi.waitFor(() => expect(lost.calls).toHaveLength(1));

    const b = w.start(null);
    await consumers.tick(b, T0 + 30_000);
    expect(consumers.generation).toEqual([`${PATH}@${R1}`]);
    expect(await w.pending()).toBeNull();
  });
});

describe('[D-427] recovery during the retry', () => {
  it('a retry that fails resolves the check as judge-unavailable: consumers once, record cleared, no third call', async () => {
    const w = await world();
    const consumers = new Consumers();
    const lost = hanging();
    void save(w, w.start(lost.judge), R1, R0);
    await vi.waitFor(() => expect(lost.calls).toHaveLength(1));

    const retry = failing();
    const b = w.start(retry.judge);
    const recovered = await b.recoverUnfinishedChecks(T0 + 30_000);
    expect(recovered).toEqual([
      { path: PATH, currentText: R1, result: { kind: 'judge-unavailable' } },
    ]);
    for (const { path, currentText, result } of recovered)
      consumers.direct(path, currentText, result);
    expect(retry.calls).toHaveLength(1);
    expect(await w.pending()).toBeNull();
    // Never a fabricated verdict: the settled baseline is untouched.
    expect((await w.hashStore.load(PATH))?.revision).toBe(1);

    await consumers.tick(b, T0 + 60_000);
    await consumers.tick(w.start(answering().judge), T0 + 90_000); // even across another restart
    expect(retry.calls).toHaveLength(1);
    expect(consumers.generation).toEqual([`${PATH}@${R1}`]);
  });

  it('a further edit while the retry is in flight is judged against the settled text; the late retry answer is dropped as stale', async () => {
    const w = await world();
    const consumers = new Consumers();
    const lost = hanging();
    void save(w, w.start(lost.judge), R1, R0);
    await vi.waitFor(() => expect(lost.calls).toHaveLength(1));

    let releaseRetry: (v: MaterialityJudgeVerdict) => void = () => {};
    const b2 = judgeOf((_input, index) =>
      index === 0
        ? new Promise<MaterialityJudgeVerdict>((resolve) => {
            releaseRetry = resolve;
          })
        : Promise.resolve({ material: true }),
    );
    const b = w.start(b2.judge);
    w.clock.set(T0 + 30_000);
    const tick = consumers.tick(b, w.clock.now());
    await vi.waitFor(() => expect(b2.calls).toHaveLength(1)); // the retry is in flight

    // Her first save after the restart: no previous text in this session's tracker.
    w.clock.set(T0 + 31_000);
    const direct = await save(w, b, R2, undefined);
    expect(direct.kind).toBe('verdict');
    consumers.direct(PATH, R2, direct);
    expect(b2.calls[1]).toEqual({ previousText: R0, currentText: R2 });

    releaseRetry({ material: true });
    await tick;

    expect(consumers.processed).toEqual([`${PATH}@${R2}`]);
    expect(consumers.generation).toEqual([`${PATH}@${R2}`]);
    expect((await w.hashStore.load(PATH))?.revision).toBe(2);
    expect(await w.pending()).toBeNull();
  });

  it('a second restart during the retry grants no further retry: judge-unavailable with no call', async () => {
    const w = await world();
    const consumers = new Consumers();
    const lostOriginal = hanging();
    void save(w, w.start(lostOriginal.judge), R1, R0);
    await vi.waitFor(() => expect(lostOriginal.calls).toHaveLength(1));

    // First restart: the retry is sent, and lost to a second restart.
    const lostRetry = hanging();
    const b = w.start(lostRetry.judge);
    void b.recoverUnfinishedChecks(T0 + 30_000);
    await vi.waitFor(() => expect(lostRetry.calls).toHaveLength(1));
    expect(await w.pending()).toMatchObject({ retriedAt: T0 + 30_000 });

    // Second restart.
    const third = answering();
    const c = w.start(third.judge);
    await consumers.tick(c, T0 + 60_000);
    await consumers.tick(c, T0 + 90_000);

    expect(third.calls).toHaveLength(0);
    expect(lostOriginal.calls.length + lostRetry.calls.length + third.calls.length).toBe(2);
    expect(consumers.generation).toEqual([`${PATH}@${R1}`]);
    expect(consumers.processed).toEqual([`${PATH}@${R1}`]);
    expect(await w.pending()).toBeNull();
  });
});

describe('[D-427] recovery after a further edit', () => {
  it('a note edited elsewhere while the app was closed is judged from its settled text to its text now, as a new check', async () => {
    const w = await world();
    const consumers = new Consumers();
    const lost = hanging();
    void save(w, w.start(lost.judge), R1, R0);
    await vi.waitFor(() => expect(lost.calls).toHaveLength(1));

    w.vault.set(PATH, R2); // edited on another device while closed
    let recordAtCall: MaterialityPendingCheck | null = null;
    const b2 = judgeOf(async () => {
      recordAtCall = await w.pending();
      return { material: true };
    });
    const b = w.start(b2.judge);
    await consumers.tick(b, T0 + 30_000);

    expect(b2.calls).toEqual([{ previousText: R0, currentText: R2 }]);
    // A different text is a different check: an original call, its retry still unspent.
    expect(recordAtCall).toMatchObject({
      dispatchedHash: (await computeMaterialityHashes(R2)).rawHash,
    });
    expect(recordAtCall).not.toHaveProperty('retriedAt');
    expect(consumers.generation).toEqual([`${PATH}@${R2}`]);
    expect(await w.pending()).toBeNull();
  });

  it('a save after the restart, before any recovery pass, compares against the recorded settled text rather than reading as a first sighting', async () => {
    const w = await world();
    const consumers = new Consumers();
    expect((await save(w, w.start(answering().judge), R0_SMALL, R0)).kind).toBe('below-floor');

    const { judge, calls } = answering();
    const b = w.start(judge);
    w.clock.set(T0 + debounceMs + 1); // past the quiet window the held edit opened
    const direct = await save(w, b, R2, undefined);
    consumers.direct(PATH, R2, direct);

    expect(direct.kind).toBe('verdict');
    expect(calls).toEqual([{ previousText: R0, currentText: R2 }]);
    expect(await w.pending()).toBeNull();

    await consumers.tick(b, T0 + 2 * pendingDrainMs);
    expect(calls).toHaveLength(1);
    expect(consumers.generation).toEqual([`${PATH}@${R2}`]);
  });

  it('without a pending store the same first save is still judge-unavailable (unchanged behaviour)', async () => {
    const w = await world();
    const bare = new MaterialityTrigger({
      store: w.hashStore,
      clock: w.clock,
      judge: answering().judge,
    });
    expect((await bare.evaluate(PATH, R2, undefined)).kind).toBe('judge-unavailable');
    expect(await bare.recoverUnfinishedChecks(T0)).toEqual([]);
  });
});

describe('[D-427] in-session failures and the one retry', () => {
  it('a drained call that fails keeps its record, and the next pass sends the one retry: consumers once', async () => {
    const w = await world();
    const consumers = new Consumers();
    const flaky = judgeOf(async (_input, index) => {
      if (index === 0) throw new Error('simulated provider failure');
      return { material: true };
    });
    const t = w.start(flaky.judge);
    expect((await save(w, t, R0_SMALL, R0)).kind).toBe('below-floor');
    // The construction-time scan finds only this instance's own hold.
    await consumers.tick(t, T0 + 1);
    expect(flaky.calls).toHaveLength(0);

    await consumers.tick(t, T0 + pendingDrainMs);
    expect(flaky.calls).toHaveLength(1);
    expect(consumers.generation).toHaveLength(0);
    expect(await w.pending()).toMatchObject({ waiting: 'judge' });

    await consumers.tick(t, T0 + pendingDrainMs + 30_000);
    expect(flaky.calls).toHaveLength(2);
    expect(flaky.calls[1]).toEqual({ previousText: R0, currentText: R0_SMALL });
    expect(consumers.generation).toEqual([`${PATH}@${R0_SMALL}`]);
    expect(await w.pending()).toBeNull();
  });

  it('a direct call that fails is reported judge-unavailable at once (as before) and its record is cleared, never retried behind her back', async () => {
    const w = await world();
    const { judge, calls } = failing();
    const t = w.start(judge);
    expect((await save(w, t, R1, R0)).kind).toBe('judge-unavailable');
    expect(await w.pending()).toBeNull();
    await t.recoverUnfinishedChecks(T0 + 30_000);
    expect(calls).toHaveLength(1);
  });
});

describe('[D-427] the pending record: its shape and its cleanup', () => {
  it('holds only the ruled fields, one record per path, replaced rather than appended', async () => {
    const w = await world();
    await changedAt(w, T0);
    const t = w.start(hanging().judge);
    w.clock.set(T0 + 1_000);
    await save(w, t, R1, R0); // debounced
    w.clock.set(T0 + 2_000);
    await save(w, t, R2, R1); // debounced again
    const table = w.host.blob()[MATERIALITY_PENDING_STORAGE_KEY] as Record<string, unknown>;
    expect(Object.keys(table)).toEqual([PATH]);
    expect(Object.keys(table[PATH] as object).sort()).toEqual(
      ['baselineText', 'path', 'revision', 'since', 'waiting'].sort(),
    );
    expect((table[PATH] as MaterialityPendingCheck).baselineText).toBe(R0);

    w.clock.set(T0 + 2_000 + debounceMs);
    void t.drainDuePendingEdits(w.clock.now()); // dispatched, and never answered
    await vi.waitFor(async () => expect((await w.pending())?.waiting).toBe('judge'));
    const dispatched =
      (w.host.blob()[MATERIALITY_PENDING_STORAGE_KEY] as Record<string, object>)[PATH] ?? {};
    expect(Object.keys(dispatched).sort()).toEqual(
      [
        'baselineText',
        'dispatchedAt',
        'dispatchedHash',
        'path',
        'revision',
        'since',
        'waiting',
      ].sort(),
    );
  });

  it('is removed once the answer is committed, and the key leaves data.json while the other stores keep theirs', async () => {
    const w = await world();
    const t = w.start(answering().judge);
    expect((await save(w, t, R1, R0)).kind).toBe('verdict');
    expect(await w.pending()).toBeNull();
    expect(MATERIALITY_PENDING_STORAGE_KEY in w.host.blob()).toBe(false);
    expect('materialityHashes' in w.host.blob()).toBe(true);
  });

  it('a stale record (a newer answer already committed) is cleared on recovery with no call', async () => {
    const w = await world();
    await w.pendingStore.update(PATH, () => ({
      path: PATH,
      baselineText: R0,
      revision: 0, // the record is at revision 1
      since: 0,
      waiting: 'judge',
      dispatchedHash: 'h',
      dispatchedAt: 0,
    }));
    w.vault.set(PATH, R1);
    const consumers = new Consumers();
    const { judge, calls } = answering();
    await consumers.tick(w.start(judge), T0);
    expect(calls).toHaveLength(0);
    expect(consumers.processed).toHaveLength(0);
    expect(await w.pending()).toBeNull();
  });

  it('a file that is gone, or back at its settled version, is cleared on recovery with no call', async () => {
    for (const vaultText of [null, R0]) {
      const w = await world();
      const lost = hanging();
      void save(w, w.start(lost.judge), R1, R0);
      await vi.waitFor(() => expect(lost.calls).toHaveLength(1));
      if (vaultText === null) w.vault.delete(PATH);
      else w.vault.set(PATH, vaultText);

      const consumers = new Consumers();
      const { judge, calls } = answering();
      await consumers.tick(w.start(judge), T0 + 30_000);
      expect(calls).toHaveLength(0);
      expect(consumers.processed).toHaveLength(0);
      expect(await w.pending()).toBeNull();
    }
  });

  it('a file that differs from its settled version only in layout takes the formatting-only exit on recovery', async () => {
    const w = await world();
    // A call on R1 is lost; by the restart the note is back to R0's words, laid out differently.
    const lost = hanging();
    void save(w, w.start(lost.judge), R1, R0);
    await vi.waitFor(() => expect(lost.calls).toHaveLength(1));
    w.vault.set(PATH, R0_REFLOWED);

    const { judge, calls } = answering();
    const consumers = new Consumers();
    await consumers.tick(w.start(judge), T0 + 30_000);
    expect(calls).toHaveLength(0);
    expect(consumers.processed).toHaveLength(0);
    expect(await w.pending()).toBeNull();
    const record = await w.hashStore.load(PATH);
    expect(record?.hashes).toEqual(await computeMaterialityHashes(R0_REFLOWED));
    expect(record?.revision).toBe(1);
  });

  it('an edit held back while a call was in flight is rebased onto the committed text, so a restart judges only what is left', async () => {
    const w = await world();
    let release: (v: MaterialityJudgeVerdict) => void = () => {};
    const first = judgeOf(
      () =>
        new Promise<MaterialityJudgeVerdict>((resolve) => {
          release = resolve;
        }),
    );
    const t = w.start(first.judge);
    const call = save(w, t, R1, R0);
    await vi.waitFor(() => expect(first.calls).toHaveLength(1));
    // A same-length variant of R0 arrives while the call is in flight: below the floor against R0.
    w.clock.set(T0 + 1);
    expect((await save(w, t, R0_SMALL, R1)).kind).toBe('below-floor');
    release({ material: true });
    expect((await call).kind).toBe('verdict');

    expect(await w.pending()).toMatchObject({
      waiting: 'below-floor',
      baselineText: R1,
      revision: 2,
    });

    // Restart: the held edit is judged from the committed R1, not the older R0.
    const { judge, calls } = answering();
    await new Consumers().tick(w.start(judge), T0 + 1 + pendingDrainMs);
    expect(calls).toEqual([{ previousText: R1, currentText: R0_SMALL }]);
    expect(await w.pending()).toBeNull();
  });

  it('the same held edit, with no restart, is drained against the committed text too (memory and record agree)', async () => {
    const w = await world();
    let release: (v: MaterialityJudgeVerdict) => void = () => {};
    const judged = judgeOf((_input, index) =>
      index === 0
        ? new Promise<MaterialityJudgeVerdict>((resolve) => {
            release = resolve;
          })
        : Promise.resolve({ material: true }),
    );
    const t = w.start(judged.judge);
    const call = save(w, t, R1, R0);
    await vi.waitFor(() => expect(judged.calls).toHaveLength(1));
    w.clock.set(T0 + 1);
    expect((await save(w, t, R0_SMALL, R1)).kind).toBe('below-floor');
    release({ material: true });
    await call;

    await new Consumers().tick(t, T0 + 1 + pendingDrainMs);
    expect(judged.calls[1]).toEqual({ previousText: R1, currentText: R0_SMALL });
    expect(await w.pending()).toBeNull();
  });
});

describe('[D-427] ObsidianMaterialityPendingStore', () => {
  it('reads a malformed entry as absent, and leaves every other key of data.json alone', async () => {
    const host = makeHost();
    await host.saveData({
      other: { kept: true },
      [MATERIALITY_PENDING_STORAGE_KEY]: {
        [PATH]: { path: PATH, baselineText: 7 },
        'Notes/b.md': {
          path: 'Notes/b.md',
          baselineText: R0,
          revision: 1,
          since: 0,
          waiting: 'sideways',
        },
      },
    });
    const store = new ObsidianMaterialityPendingStore(host);
    expect(await store.load(PATH)).toBeNull();
    expect(await store.list()).toEqual([]);
    await store.update(PATH, (current) => {
      expect(current).toBeNull();
      return { path: PATH, baselineText: R0, revision: 1, since: 5, waiting: 'debounced' };
    });
    expect(await store.list()).toHaveLength(1);
    expect(isMaterialityPendingCheck(await store.load(PATH))).toBe(true);
    expect(host.blob().other).toEqual({ kept: true });
  });

  it('writes nothing when the update would change nothing', async () => {
    const host = makeHost();
    const saveData = vi.spyOn(host, 'saveData');
    const store = new ObsidianMaterialityPendingStore(host);
    await store.update(PATH, () => null);
    expect(saveData).not.toHaveBeenCalled();
  });
});

describe('[D-427] main.ts routes recovered checks through both consumers, before the drain', () => {
  const main = readFileSync(
    fileURLToPath(new URL('../../../src/main.ts', import.meta.url)),
    'utf8',
  );

  it('drainPendingMaterialityEdits recovers first and hands each settled check to both consumers, as a direct evaluation is', () => {
    expect(main).toMatch(
      /const recovered = await this\.materiality\.recoverUnfinishedChecks\(this\.now\(\)\.getTime\(\)\);\s*for \(const \{ path, currentText, result \} of recovered\) \{\s*void this\.processedRevisionFeed\?\.noteEvaluated\(path, currentText, result\);\s*await this\.triggerAuthoredNoteGenerationIfObserved\(\s*path,\s*currentText,\s*this\.observedMaterialChange\(result\),\s*\);\s*\}\s*const drained = await this\.materiality\.drainDuePendingEdits\(/,
    );
  });

  it('the production wiring is given the vault reader and the reachability signal', () => {
    expect(main).toMatch(
      /judge: this\.buildMaterialityJudge\(\),[\s\S]{0,600}?readCurrentText: async \(path\) => \{\s*if \(!\(await vault\.exists\(path\)\)\) return null;\s*const text = await vault\.read\(path\);\s*return isOleaHomeNote\(text\) \? null : text;\s*\},[\s\S]{0,200}?isOnline: \(\) => navigator\.onLine,/,
    );
  });

  it('the own-write ledger still runs before the materiality gate, untouched', () => {
    expect(main).toMatch(
      /if \(this\.ownStampWrites\.consumeIfOleaOnly\(path, currentText\)\) \{\s*this\.materialityPreviousText\.record\(path, currentText\);\s*return;\s*\}\s*const previousText = this\.materialityPreviousText\.get\(path\);/,
    );
  });
});
