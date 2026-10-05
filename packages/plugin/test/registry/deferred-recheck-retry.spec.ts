/**
 * `[D-420]` (`ol-egov.141.89.5.28`) — the registry's explicit, bounded "check again" action on a
 * deferred source-change row. Scenarios: olea-service `features/F2-review.md`, F2.23's `[D-420]`
 * block, tagged `@auto:plugin/registry/deferred-recheck-retry.spec`.
 *
 * The end-to-end half runs the REAL `CitationRevisionTrigger` (the `[D-400]` retry gate this action
 * reuses), the REAL `ObsidianCitationHashStore` persisted shape — including its own
 * `grantExplicitRetry` (`[D-420]`'s store-side compare-and-set; unit-tested directly in
 * `test/ingestion/materiality/citation-hash-store.spec.ts`) — and the REAL
 * `createLocalRegistryProvider`, with a fake judge counting calls — zero spend.
 *
 * Every fixture string is INVENTED (INV-3).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { citationStorePath, type RevisionJudgePort, type VaultPath } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  type CitationAnchorRecord,
  type CitationHashStore,
  ObsidianCitationHashStore,
  type ObsidianDataHost,
} from '../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../src/ingestion/materiality/citation-revision-wiring.js';
import {
  SUSPECT_DEFERRED_LINE,
  SUSPECT_DEFERRED_RECHECK_ACTION,
  SUSPECT_DEFERRED_RECHECK_OFFLINE_NOTE,
  SUSPECT_DEFERRED_WITH_ACTION_LINE,
  suspectDeferredRowCopy,
} from '../../src/registry/copy.js';
import {
  CHECK_AGAIN_JUDGE_CALLS_PER_PRESS,
  deferredRecheckActionAvailability,
  rearmSpentRetry,
  retryDeferredRecheck,
} from '../../src/registry/deferred-recheck-retry.js';
import { createLocalRegistryProvider } from '../../src/registry/provider.js';
import type { RegistryViewState } from '../../src/registry/view.js';
import { memoryVault } from '../review/memory-vault.js';

const NOW = new Date('2026-02-01T12:00:00Z');
const NOTE_PATH: VaultPath = 'Fixtures/Sample note one.md';
const MCQ_ID = 'sample-q1';
const PASSAGE_A = 'Sample passage, first wording of an invented claim.';
const PASSAGE_B = 'Sample passage, second wording that changes the invented claim.';
const PASSAGE_C = 'Sample passage, third wording that changes it once more.';

function note(passage: string): string {
  return [
    '---',
    'topic: [Sample concept alpha]',
    'course: TESTC101',
    '---',
    '',
    '## An invented heading',
    '',
    passage,
    '',
    '```olea-mcq',
    `id: ${MCQ_ID}`,
    'stem: Which invented option is the keyed one?',
    'answer: Option keyed',
    'distractor: Option two',
    'distractor: Option three',
    'distractor: Option four',
    'distractor: Option five',
    '```',
    '',
  ].join('\n');
}

/** Self-referential citation sidecar, so the MCQ stays tracked under `[D-398]`. */
function citationSidecar(): string {
  return `${JSON.stringify({ instrumentId: MCQ_ID, sourcePath: NOTE_PATH, page: 1, schemaVersion: 1 }, null, 2)}\n`;
}

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob === null ? null : structuredClone(this.blob);
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = structuredClone(data);
  }
}

function actions() {
  return { enqueue: vi.fn(async () => undefined), suspend: vi.fn(async () => undefined) };
}

function throwingJudge(): RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } {
  return {
    judge: vi.fn(async () => {
      throw new Error('provider unavailable');
    }),
  };
}

async function suspectOf(state: RegistryViewState) {
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  return state;
}

/**
 * Builds a vault, the rearmable store, and a trigger against a judge that never answers, then
 * drives the item to deferred: baseline, edit, original check lost, one automatic retry lost.
 */
async function deferredWorld() {
  const vault = memoryVault({
    [NOTE_PATH]: note(PASSAGE_A),
    [citationStorePath(MCQ_ID)]: citationSidecar(),
  });
  const host = new FakeDataHost();
  const store = new ObsidianCitationHashStore(host);
  const judge = throwingJudge();
  let clock = 0;
  const trigger = new CitationRevisionTrigger({ store, judge, clock: { now: () => clock } });
  const pass = async () => {
    clock += 1_000;
    return trigger.tick(vault, actions());
  };
  await pass(); // baseline
  await vault.write(NOTE_PATH, note(PASSAGE_B));
  await pass(); // original check, lost
  await pass(); // the one automatic retry, lost
  const exhausted = await pass();
  expect(exhausted.retryExhausted).toBe(1);
  expect(judge.judge).toHaveBeenCalledTimes(2);
  let online = true;
  const provider = (wired = true) =>
    createLocalRegistryProvider({
      vault,
      deviceId: 'olea-testdevice1',
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      editPort: { edit: async () => undefined },
      citationHashStore: store,
      ...(wired ? { deferredRecheckRearm: store } : {}),
      isOnline: () => online,
    });
  return {
    vault,
    host,
    store,
    judge,
    pass,
    provider,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

describe('[D-420] rearmSpentRetry — the pure half of the store-side compare-and-set', () => {
  const spent = { sinceContentHash: 'h1', since: 5, dispatchedAt: 7, retriedAt: 7 };

  it('re-arms a spent retry for the same source revision: keeps since and dispatchedAt, drops retriedAt', () => {
    expect(rearmSpentRetry(spent, 'h1')).toEqual({
      sinceContentHash: 'h1',
      since: 5,
      dispatchedAt: 7,
    });
  });

  it('keeps a dispatch recorded even for a fact with no dispatchedAt, so the next pass takes the RETRY branch', () => {
    expect(rearmSpentRetry({ sinceContentHash: 'h1', since: 5, retriedAt: 9 }, 'h1')).toEqual({
      sinceContentHash: 'h1',
      since: 5,
      dispatchedAt: 9,
    });
  });

  it('re-arms nothing when nothing is pending, the revision differs, or the retry is not spent', () => {
    expect(rearmSpentRetry(undefined, 'h1')).toBeNull();
    expect(rearmSpentRetry(spent, 'h2')).toBeNull();
    expect(rearmSpentRetry({ sinceContentHash: 'h1', since: 5, dispatchedAt: 7 }, 'h1')).toBeNull();
  });
});

describe('[D-420] deferredRecheckActionAvailability and the row presentation', () => {
  it('offers no action unless wired; available online; needs-connection offline', () => {
    expect(deferredRecheckActionAvailability({ wired: false, online: true })).toBeUndefined();
    expect(deferredRecheckActionAvailability({ wired: true, online: true })).toBe('available');
    expect(deferredRecheckActionAvailability({ wired: true, online: false })).toBe(
      'needs-connection',
    );
  });

  it('not wired: the [D-400] sentence naming the edit route, and no action', () => {
    expect(suspectDeferredRowCopy(undefined)).toEqual({ line: SUSPECT_DEFERRED_LINE });
  });

  it('wired and online: the action-era sentence with "check again" enabled beside it', () => {
    expect(suspectDeferredRowCopy('available')).toEqual({
      line: SUSPECT_DEFERRED_WITH_ACTION_LINE,
      action: { label: SUSPECT_DEFERRED_RECHECK_ACTION, enabled: true },
    });
  });

  it('wired and offline: the action shown unavailable, with the needs-a-connection note', () => {
    expect(suspectDeferredRowCopy('needs-connection')).toEqual({
      line: SUSPECT_DEFERRED_WITH_ACTION_LINE,
      action: {
        label: SUSPECT_DEFERRED_RECHECK_ACTION,
        enabled: false,
        note: SUSPECT_DEFERRED_RECHECK_OFFLINE_NOTE,
      },
    });
  });
});

describe('[D-420] retryDeferredRecheck — the controller, against counting fakes', () => {
  function countingStore(record: CitationAnchorRecord | undefined) {
    const loadAll = vi.fn(async () => new Map(record === undefined ? [] : [['i1', record]]));
    const store = { loadAll } as unknown as CitationHashStore;
    return { store, loadAll };
  }
  const deferredRecord: CitationAnchorRecord = {
    sourcePath: 'Fixtures/x.md',
    text: 'invented',
    conceptIds: [],
    pendingRevalidation: { sinceContentHash: 'h1', since: 1, dispatchedAt: 2, retriedAt: 2 },
  };

  it('not wired: nothing read, nothing written', async () => {
    const { store, loadAll } = countingStore(deferredRecord);
    expect(
      await retryDeferredRecheck({
        instrumentId: 'i1',
        store,
        rearm: undefined,
        isOnline: () => true,
      }),
    ).toBe('not-wired');
    expect(loadAll).not.toHaveBeenCalled();
  });

  it('offline: refused before any read or write', async () => {
    const { store, loadAll } = countingStore(deferredRecord);
    const rearm = { grantExplicitRetry: vi.fn(async () => true) };
    expect(
      await retryDeferredRecheck({ instrumentId: 'i1', store, rearm, isOnline: () => false }),
    ).toBe('offline');
    expect(loadAll).not.toHaveBeenCalled();
    expect(rearm.grantExplicitRetry).not.toHaveBeenCalled();
  });

  it('a row that is not deferred (no spent retry) re-arms nothing', async () => {
    const { store } = countingStore({
      ...deferredRecord,
      pendingRevalidation: { sinceContentHash: 'h1', since: 1, dispatchedAt: 2 },
    });
    const rearm = { grantExplicitRetry: vi.fn(async () => true) };
    expect(
      await retryDeferredRecheck({ instrumentId: 'i1', store, rearm, isOnline: () => true }),
    ).toBe('not-deferred');
    expect(rearm.grantExplicitRetry).not.toHaveBeenCalled();
  });

  it('hands the FRESH persisted revision to the compare-and-set, and reports its answer', async () => {
    const { store } = countingStore(deferredRecord);
    const granted = { grantExplicitRetry: vi.fn(async () => true) };
    expect(
      await retryDeferredRecheck({
        instrumentId: 'i1',
        store,
        rearm: granted,
        isOnline: () => true,
      }),
    ).toBe('rearmed');
    expect(granted.grantExplicitRetry).toHaveBeenCalledWith('i1', 'h1');
    const refused = { grantExplicitRetry: vi.fn(async () => false) };
    expect(
      await retryDeferredRecheck({
        instrumentId: 'i1',
        store,
        rearm: refused,
        isOnline: () => true,
      }),
    ).toBe('not-deferred');
  });
});

describe('[D-420] end to end — the real [D-400] gate, the real store shape, the real provider', () => {
  it('a deferred row offers "check again" (wired, online), in the same pending-revalidation list', async () => {
    const world = await deferredWorld();
    const state = await suspectOf(await world.provider().load());
    expect(state.suspectInstruments.pendingRevalidation).toEqual([
      { instrumentId: MCQ_ID, deferred: true },
    ]);
    expect(state.deferredRecheckAction).toBe('available');
  });

  it('not wired: no action field, and a press writes nothing', async () => {
    const world = await deferredWorld();
    const provider = world.provider(false);
    const state = await suspectOf(await provider.load());
    expect(state.deferredRecheckAction).toBeUndefined();
    const before = structuredClone(world.host.blob);
    expect(await provider.retryDeferredRecheck?.(MCQ_ID)).toBe('not-wired');
    expect(world.host.blob).toEqual(before);
  });

  it(`one press = exactly ${CHECK_AGAIN_JUDGE_CALLS_PER_PRESS} further judge call through the existing gate; unanswered, deferred again, and no call without another press`, async () => {
    const world = await deferredWorld();
    const provider = world.provider();

    expect(await provider.retryDeferredRecheck?.(MCQ_ID)).toBe('rearmed');
    // Pressing makes no call itself.
    expect(world.judge.judge).toHaveBeenCalledTimes(2);
    // Until the next pass concludes, the row reads the ordinary being-checked sentence.
    const rearmed = await suspectOf(await provider.load());
    expect(rearmed.suspectInstruments.pendingRevalidation).toEqual([{ instrumentId: MCQ_ID }]);

    await world.pass();
    expect(world.judge.judge).toHaveBeenCalledTimes(2 + CHECK_AGAIN_JUDGE_CALLS_PER_PRESS);

    // That call also went unanswered: deferred again, and further passes make no call.
    const again = await suspectOf(await provider.load());
    expect(again.suspectInstruments.pendingRevalidation).toEqual([
      { instrumentId: MCQ_ID, deferred: true },
    ]);
    for (let i = 0; i < 5; i += 1) {
      const report = await world.pass();
      expect(report.retryExhausted).toBe(1);
    }
    expect(world.judge.judge).toHaveBeenCalledTimes(3);
  });

  it('a double press re-arms once: the second finds nothing to re-arm, and the next pass makes one call', async () => {
    const world = await deferredWorld();
    const provider = world.provider();
    expect(await provider.retryDeferredRecheck?.(MCQ_ID)).toBe('rearmed');
    expect(await provider.retryDeferredRecheck?.(MCQ_ID)).toBe('not-deferred');
    await world.pass();
    await world.pass();
    expect(world.judge.judge).toHaveBeenCalledTimes(3);
  });

  it('a pressed check that is answered resolves through the ordinary outcome path', async () => {
    const world = await deferredWorld();
    const provider = world.provider();
    expect(await provider.retryDeferredRecheck?.(MCQ_ID)).toBe('rearmed');
    world.judge.judge.mockImplementationOnce(async () => ({ material: false }));
    const report = await world.pass();
    expect(report.refreshed).toBe(1);
    expect((await world.store.loadAll()).get(MCQ_ID)?.pendingRevalidation).toBeUndefined();
    const state = await suspectOf(await provider.load());
    expect(state.suspectInstruments.pendingRevalidation).toEqual([]);
  });

  it('offline: shown unavailable, a press writes nothing, the next pass makes no call, and the row stays deferred', async () => {
    const world = await deferredWorld();
    world.setOnline(false);
    const provider = world.provider();
    const state = await suspectOf(await provider.load());
    expect(state.deferredRecheckAction).toBe('needs-connection');
    const before = structuredClone(world.host.blob);
    expect(await provider.retryDeferredRecheck?.(MCQ_ID)).toBe('offline');
    expect(world.host.blob).toEqual(before);
    await world.pass();
    expect(world.judge.judge).toHaveBeenCalledTimes(2);
    const after = await suspectOf(await provider.load());
    expect(after.suspectInstruments.pendingRevalidation).toEqual([
      { instrumentId: MCQ_ID, deferred: true },
    ]);
  });

  it('a stale press, after a newer edit raised its own check, re-arms nothing and grants no extra call', async () => {
    const world = await deferredWorld();
    const provider = world.provider();
    const staleHash = (await world.store.loadAll()).get(MCQ_ID)?.pendingRevalidation
      ?.sinceContentHash as string;
    await world.vault.write(NOTE_PATH, note(PASSAGE_C));
    await world.pass(); // the newer revision's own original check (lost)
    expect(world.judge.judge).toHaveBeenCalledTimes(3);

    expect(await provider.retryDeferredRecheck?.(MCQ_ID)).toBe('not-deferred');
    expect(await world.store.grantExplicitRetry(MCQ_ID, staleHash)).toBe(false);
  });

  it('editing the cited passage still opens a fresh check with its own budget, no press needed', async () => {
    const world = await deferredWorld();
    await world.vault.write(NOTE_PATH, note(PASSAGE_C));
    await world.pass();
    expect(world.judge.judge).toHaveBeenCalledTimes(3);
    const state = await suspectOf(await world.provider().load());
    expect(state.suspectInstruments.pendingRevalidation).toEqual([{ instrumentId: MCQ_ID }]);
  });
});

/**
 * Row 13 of the 2026-09-29 rulings (`ol-egov.141.89.5.36`): the ruled sentence says Olea could not
 * check, so it is for a failed check only. A completed finding resolves the pending fact the row
 * is read from, so it can never reach the sentence; and no code outside the copy module draws it.
 */
describe('row 13 — the "couldn\'t check" sentence is for a failed check, never a completed finding', () => {
  it('a check that never answered reads the ruled sentence; an answer that arrives leaves no deferred row at all', async () => {
    const world = await deferredWorld();
    const provider = world.provider();
    const failed = await suspectOf(await provider.load());
    expect(failed.suspectInstruments.pendingRevalidation).toEqual([
      { instrumentId: MCQ_ID, deferred: true },
    ]);
    expect(suspectDeferredRowCopy(failed.deferredRecheckAction).line).toBe(
      SUSPECT_DEFERRED_WITH_ACTION_LINE,
    );

    // A completed finding that the passage's claim changed: the item is suspended and tracking
    // ends, so there is no pending fact for the row to be read from.
    expect(await provider.retryDeferredRecheck?.(MCQ_ID)).toBe('rearmed');
    world.judge.judge.mockImplementationOnce(async () => ({ material: true, reason: 'changed' }));
    const report = await world.pass();
    expect(report.revised).toBe(1);
    expect((await world.store.loadAll()).get(MCQ_ID)).toBeUndefined();
    const finding = await suspectOf(await provider.load());
    expect(finding.suspectInstruments.pendingRevalidation).toEqual([]);
    expect(finding.suspectInstruments.flagged).toEqual([]);
  });

  it('a check still waiting for its first retry is the ordinary being-checked row, never the sentence', async () => {
    const vault = memoryVault({
      [NOTE_PATH]: note(PASSAGE_A),
      [citationStorePath(MCQ_ID)]: citationSidecar(),
    });
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    const judge = throwingJudge();
    let clock = 0;
    const trigger = new CitationRevisionTrigger({ store, judge, clock: { now: () => clock } });
    await trigger.tick(vault, actions());
    await vault.write(NOTE_PATH, note(PASSAGE_B));
    clock += 1_000;
    await trigger.tick(vault, actions()); // the original check, lost: one call so far
    const state = await suspectOf(
      await createLocalRegistryProvider({
        vault,
        deviceId: 'olea-testdevice1',
        settingsHost: new FakeDataHost(),
        now: () => NOW,
        editPort: { edit: async () => undefined },
        citationHashStore: store,
        deferredRecheckRearm: store,
        isOnline: () => true,
      }).load(),
    );
    expect(state.suspectInstruments.pendingRevalidation).toEqual([{ instrumentId: MCQ_ID }]);
  });

  it('only the copy module draws the sentence, and only for a deferred row with the action wired', () => {
    const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
    const consumers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(srcDir + dir, { withFileTypes: true })) {
        const path = dir + entry.name;
        if (entry.isDirectory()) walk(`${path}/`);
        else if (entry.name.endsWith('.ts')) {
          const code = readFileSync(srcDir + path, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
          if (code.includes('SUSPECT_DEFERRED_WITH_ACTION_LINE')) consumers.push(path);
        }
      }
    };
    walk('');
    // The registry view reaches it only through suspectDeferredRowCopy (copy.ts), which returns it
    // only when the check-again action is wired.
    expect(consumers).toEqual(['registry/copy.ts']);
    expect(suspectDeferredRowCopy(undefined).line).toBe(SUSPECT_DEFERRED_LINE);
  });
});

describe('re-arming carries the withholding reason ([D-473], ol-egov.141.89.5.52)', () => {
  const spent = { sinceContentHash: 'h-sample', since: 100, dispatchedAt: 200, retriedAt: 300 };
  it('keeps a known reason', () => {
    expect(rearmSpentRetry({ ...spent, reason: 'passage-missing' }, 'h-sample')?.reason).toBe(
      'passage-missing',
    );
  });
  it('keeps an unrecognised reason', () => {
    const reason = 'passage-future-reason';
    expect(rearmSpentRetry({ ...spent, reason }, 'h-sample')?.reason).toBe(reason);
  });
  it('adds no reason when there was none', () => {
    expect(rearmSpentRetry(spent, 'h-sample')).not.toHaveProperty('reason');
  });
});
