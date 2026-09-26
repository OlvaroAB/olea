/**
 * `[ILB-CHG-4]` acceptance criterion (c) (`ol-egov.141.89.5.4`, `[D-351]`): "the pending-revalidation
 * and verdict-recording writes are idempotent under a retried write after a simulated failure, never
 * duplicated, never half-applied, never lost."
 *
 * Exercised through the REAL wiring, not only the store unit: `CitationRevisionTrigger.tick`
 * (`citation-revision-wiring.ts`) driving the real `ObsidianCitationHashStore`
 * (`citation-hash-store.ts`) against a `FlakyDataHost` that fails one specific `saveData` call and
 * then recovers — the same shape a real, transient Obsidian vault write failure takes. This is
 * distinct from `citation-hash-store.spec.ts` (that file proves the store's own read-modify-write
 * mechanics in isolation) and from `citation-revision-wiring.spec.ts`'s existing `[D-351]` tests
 * (those cover the STALE-RESPONSE race with a `FakeCitationHashStore` that never fails a write) --
 * this file is the first to combine the real store with a write that actually fails mid-flight,
 * driven by the production caller's own `tick()` loop.
 *
 * **Production callers** of both halves under test: `main.ts:2903`'s `tickCitationRevisions`
 * (wired at `main.ts:2197`, on the same periodic interval `main.ts:2080` constructs the store from).
 *
 * Two writes, per `chg.md` §3's own state-machine text:
 * - the SETTING half (`CitationHashStore.setPendingRevalidation`, called from
 *   `evaluateCitedPassageRevision`'s `pendingRecorder.recordPending`, `material-change.ts`'s own doc:
 *   "A failure here propagates rather than being swallowed") -- moves *current* -> *pending
 *   revalidation*;
 * - the RESOLVING half (`applyOutcome`'s `'refreshed'` arm's `store.save`, which both clears the
 *   pending fact AND advances the anchor's `text` in one write) -- moves *pending revalidation* ->
 *   *current*.
 *
 * Both are read-modify-write calls against the SAME underlying `data.json`-shaped blob
 * (`ObsidianCitationHashStore`'s own doc), so a failed `saveData` call is atomic at the point that
 * matters here: either the whole merged blob lands, or the store's prior state is entirely
 * untouched -- there is no way for this file's `FlakyDataHost` to observe a write "half apply." What
 * this file proves instead is the property `chg.md` §3 actually asks for: a failed write leaves the
 * PRIOR state in force (never silently treated as resolved, never silently lost), and a later retry
 * (the trigger's own next `tick()`, the real periodic-interval shape `main.ts` drives it with)
 * converges to exactly the correct state, exactly once -- never a duplicate entry, never a second,
 * redundant clearing write once the first one has already landed.
 */

import type {
  ListOptions,
  RevisionJudgePort,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  CITATION_ANCHOR_STORAGE_KEY,
  ObsidianCitationHashStore,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../../src/ingestion/materiality/citation-revision-wiring.js';

/** Same fake vault pattern `citation-revision-wiring.spec.ts` already uses (no `obsidian` import). */
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

/**
 * A real `{ loadData, saveData }` host (`citation-hash-store.spec.ts`'s own `FakeDataHost` pattern)
 * whose `saveData` throws on specific, numbered calls (1-indexed, across THIS host's whole
 * lifetime) and behaves exactly like a normal in-memory `data.json` blob on every other call --
 * simulating a transient write failure a real Obsidian vault write can genuinely have (a full disk,
 * a sync conflict, a momentary I/O error), never a permanent one.
 */
class FlakyDataHost {
  blob: Record<string, unknown> = {};
  saveDataCallCount = 0;
  constructor(private readonly failOnCallNumbers: ReadonlySet<number>) {}
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.saveDataCallCount += 1;
    if (this.failOnCallNumbers.has(this.saveDataCallCount)) {
      throw new Error(`simulated write failure on saveData call #${this.saveDataCallCount}`);
    }
    this.blob = data as Record<string, unknown>;
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

function note(paragraph: string): string {
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
    mcqBlock(MCQ_ID),
    '',
  ].join('\n');
}

function actions() {
  return { enqueue: vi.fn(async () => undefined), suspend: vi.fn(async () => undefined) };
}

describe('[ILB-CHG-4](c) pending-revalidation write, real store + real trigger: retried after a simulated failure', () => {
  it('never marks a known difference as current when the SETTING write fails, and sets it exactly once once the retry succeeds', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: note(PARAGRAPH_A) });
    // Call #1 is the baseline `save` below (tick 1); call #2 would be the pending-revalidation
    // `setPendingRevalidation` write on tick 2 -- fail exactly that one.
    const host = new FlakyDataHost(new Set([2]));
    const store = new ObsidianCitationHashStore(host);
    const trigger = new CitationRevisionTrigger({ store, judge: null, clock: fakeClock(1_000) });

    // Tick 1: first sighting, baselines the MCQ (saveData call #1 -- not the one made to fail).
    const first = await trigger.tick(vault, actions());
    expect(first.newlyBaselined).toBe(1);
    expect(host.saveDataCallCount).toBe(1);

    // A real difference at the cited passage.
    await vault.write(NOTE_PATH, note(PARAGRAPH_B));

    // Tick 2: `evaluateCitedPassageRevision` confirms the difference and calls
    // `setPendingRevalidation` (saveData call #2) -- which this host is set up to fail. Per
    // `material-change.ts`'s own doc ("a failure here propagates rather than being swallowed"),
    // the failure propagates out of `evaluateCitedPassageRevision` and is caught by `tick`'s own
    // try/catch (`citation-revision-wiring.ts`'s per-instrument loop), logged, and this instrument
    // is simply retried next pass -- never a judge call in the meantime (judge is `null` here
    // anyway, but the point holds regardless: the write is attempted before any judge decision).
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = await trigger.tick(vault, actions());
    consoleError.mockRestore();
    expect(host.saveDataCallCount).toBe(2); // the failed attempt was made, and only once

    // Never lost, never silently resolved: the record must NOT read as "current" (no
    // pendingRevalidation would be indistinguishable from "nothing pending" -- but it must also not
    // have advanced `text` to the new content, since that write never landed either).
    const afterFailedWrite = await store.loadAll();
    expect(afterFailedWrite.get(MCQ_ID)?.pendingRevalidation).toBeUndefined();
    expect(afterFailedWrite.get(MCQ_ID)?.text).toContain('humid climates'); // still the OLD text
    expect(second.tracked).toBe(1); // the record is still there, untouched, ready to be retried

    // Tick 3 (the retry -- the SAME periodic tick main.ts already drives this from, nothing
    // special invoked): the same real difference is recognised again, and this time the write
    // succeeds.
    const third = await trigger.tick(vault, actions());
    expect(host.saveDataCallCount).toBe(3);
    const afterRetry = await store.loadAll();
    const record = afterRetry.get(MCQ_ID);
    expect(record?.pendingRevalidation?.since).toBe(1_000);
    expect(record?.pendingRevalidation?.sinceContentHash).toBeDefined();
    // Exactly one record for this instrument -- never duplicated by the failed-then-retried write.
    expect(afterRetry.size).toBe(1);
    expect(third.newlyBaselined).toBe(0); // not re-baselined as if it were a fresh sighting
  });

  it('never clears a pending fact when the RESOLVING write fails, and clears it exactly once once the retry succeeds — text and the cleared flag land together, never split', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: note(PARAGRAPH_A) });
    // Call #1: baseline (tick 1). `citation-revision-wiring.ts` has no floor or debounce at this
    // grain (`material-change.ts`'s own doc: "any hash difference... reaches the judge, once
    // relocation has been ruled out"), so the SETTING write (call #2) and the RESOLVING write
    // (call #3) both happen inside the SAME tick, one after the other -- fail exactly the second.
    const host = new FlakyDataHost(new Set([3]));
    const store = new ObsidianCitationHashStore(host);
    const judge: RevisionJudgePort = { judge: vi.fn(async () => ({ material: false })) }; // same claim -> 'refreshed'
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(2_000) });

    await trigger.tick(vault, actions()); // tick 1: baseline (call #1)
    await vault.write(NOTE_PATH, note(PARAGRAPH_B));

    // Tick 2: `setPendingRevalidation` (call #2, succeeds) is followed, in the same pass, by the
    // judge's answer and `applyOutcome`'s resolving `store.save` (call #3) -- the one set up to fail.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secondTick = await trigger.tick(vault, actions());
    consoleError.mockRestore();
    expect(judge.judge).toHaveBeenCalledOnce();
    expect(secondTick.refreshed).toBe(1); // the outcome was decided...
    expect(host.saveDataCallCount).toBe(3); // ...set (call #2) succeeded, resolve (call #3) failed

    // Never half-applied: the pending fact is untouched (never lost -- it is not silently read as
    // current) AND the anchor's `text` is untouched (never a split state where the flag clears but
    // the text does not, or vice versa -- both live in the one object this write replaces whole).
    const afterFailedResolve = await store.loadAll();
    const pendingHash = afterFailedResolve.get(MCQ_ID)?.pendingRevalidation?.sinceContentHash;
    expect(pendingHash).toBeDefined();
    expect(afterFailedResolve.get(MCQ_ID)?.text).toContain('humid climates'); // still the OLD text

    // Tick 3 (the retry -- the SAME periodic tick main.ts already drives this from): the same real
    // difference is still there (the failed write never advanced `text`), so it is recognised again
    // -- `setPendingRevalidation` re-sets the SAME hash (call #4, a no-op in effect: `[D-351]`'s "the
    // SETTING half always wins with the newest known real difference") -- the judge answers the same
    // way, and this time the resolving write (call #5) succeeds.
    const thirdTick = await trigger.tick(vault, actions());
    expect(host.saveDataCallCount).toBe(5);
    const afterRetry = await store.loadAll();
    const record = afterRetry.get(MCQ_ID);
    expect(record?.pendingRevalidation).toBeUndefined(); // resolved -- cleared exactly once
    expect(record?.text).toContain('cold, dry climates'); // and the text landed in the SAME write
    expect(afterRetry.size).toBe(1); // never duplicated
    expect(thirdTick.staleResultDiscarded).toBe(0); // a genuine retry, never mistaken for a stale one
  });

  it('sanity check: the store key this all lives under is exactly CITATION_ANCHOR_STORAGE_KEY, one entry per instrument, on the real host', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: note(PARAGRAPH_A) });
    const host = new FlakyDataHost(new Set());
    const store = new ObsidianCitationHashStore(host);
    const trigger = new CitationRevisionTrigger({ store, judge: null, clock: fakeClock(0) });
    await trigger.tick(vault, actions());
    const table = (host.blob[CITATION_ANCHOR_STORAGE_KEY] ?? {}) as Record<string, unknown>;
    expect(Object.keys(table)).toEqual([MCQ_ID]);
  });
});
