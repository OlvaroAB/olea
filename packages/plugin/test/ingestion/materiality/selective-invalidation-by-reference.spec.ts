/**
 * `[ILB-CHG-4]` acceptance criterion (a) (`ol-egov.141.89.5.4`, `[IL-D2]`/`ol-2zfj.146`): "a
 * source-revision change invalidates and regenerates only the dependants whose recorded reference
 * (citation digest or revision number) it touches, shown by a unit test on the invalidate and
 * regenerate steps."
 *
 * `citation-revision-wiring.spec.ts` already proves invalidate-and-regenerate (suspend + enqueue) for
 * ONE tracked instrument at a time, and `wiring.spec.ts`/`revision-guard.spec.ts` prove the same for
 * the file-level trigger's own single-path bookkeeping. Neither exercises the SELECTIVITY this
 * criterion names: with more than one instrument tracked, does a change to ONE citation's own
 * material leave every OTHER instrument's recorded reference untouched — never suspended, never
 * enqueued, never re-baselined as if it had changed too?
 *
 * `CitationRevisionTrigger.tick` is structurally per-instrument (`CitationHashStore` is keyed by
 * `instrumentId`, and the per-instrument loop in `citation-revision-wiring.ts` diffs each tracked
 * anchor's own `sourcePath`/`text` independently) — this file is the first to prove that structural
 * claim behaviourally, with two real, independently-tracked instruments in the same tick.
 *
 * Production caller: `main.ts:2903`'s `tickCitationRevisions` (wired at `main.ts:2197`).
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
import type {
  CitationAnchorRecord,
  CitationHashStore,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../../src/ingestion/materiality/citation-revision-wiring.js';

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
  async setPendingRevalidation(
    instrumentId: string,
    sourceContentHash: string,
    since: number,
  ): Promise<void> {
    const existing = this.byId.get(instrumentId);
    if (existing === undefined) return;
    this.byId.set(instrumentId, {
      ...existing,
      pendingRevalidation: { sinceContentHash: sourceContentHash, since },
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
}

function fakeClock(now: number) {
  return { now: () => now };
}

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

function note(topic: string, course: string, paragraph: string, mcqId: string): string {
  return [
    '---',
    `topic: [${topic}]`,
    `course: ${course}`,
    '---',
    '',
    paragraph,
    '',
    mcqBlock(mcqId),
    '',
  ].join('\n');
}

const PATH_A = 'Courses/GEO101/Weathering.md';
const PATH_B = 'Courses/GEO101/Erosion.md';
const MCQ_A = 'q-weathering';
const MCQ_B = 'q-erosion';
const PARAGRAPH_A_BEFORE = 'Basalt weathers quickly in humid climates.';
const PARAGRAPH_A_AFTER = 'Basalt weathers slowly in cold, dry climates instead.';
const PARAGRAPH_B_TEXT = 'Sheet erosion removes soil evenly across a slope.';

function actions() {
  return { enqueue: vi.fn(async () => undefined), suspend: vi.fn(async () => undefined) };
}

describe('[ILB-CHG-4](a) CitationRevisionTrigger.tick: invalidation is selective per tracked reference', () => {
  it('a changed-claim revision on ONE instrument suspends and enqueues only that one, leaving an unrelated tracked instrument entirely untouched', async () => {
    const vault = new MemoryVaultSource({
      [PATH_A]: note('Weathering rates', 'GEO101', PARAGRAPH_A_BEFORE, MCQ_A),
      [PATH_B]: note('Erosion patterns', 'GEO101', PARAGRAPH_B_TEXT, MCQ_B),
    });
    const store = new FakeCitationHashStore();
    // Answers "material" for the A pair only -- if B were ever (wrongly) sent to the judge with a
    // real difference, this stub still has to answer SOMETHING, but B's own material never changes,
    // so B should never even reach a judge call.
    const judge: RevisionJudgePort = {
      judge: vi.fn(async () => ({ material: true, reason: 'different claim' })),
    };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

    const baseline = await trigger.tick(vault, actions());
    expect(baseline.newlyBaselined).toBe(2);
    const baselined = await store.loadAll();
    expect(baselined.get(MCQ_A)?.text).toContain(PARAGRAPH_A_BEFORE);
    expect(baselined.get(MCQ_B)?.text).toContain(PARAGRAPH_B_TEXT);

    // Only A's cited passage changes; B's note is untouched.
    await vault.write(PATH_A, note('Weathering rates', 'GEO101', PARAGRAPH_A_AFTER, MCQ_A));
    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(report.revised).toBe(1);
    expect(report.refreshed).toBe(0);
    expect(judge.judge).toHaveBeenCalledOnce(); // exactly once — never asked about B at all
    const judgeCallArgs = vi.mocked(judge.judge).mock.calls[0]?.[0];
    expect(judgeCallArgs?.previousText).toContain(PARAGRAPH_A_BEFORE);
    expect(judgeCallArgs?.currentText).toContain(PARAGRAPH_A_AFTER);

    // Invalidation and regeneration touched ONLY the instrument whose own recorded reference (its
    // cited passage's text/hash) actually changed.
    expect(act.suspend).toHaveBeenCalledOnce();
    expect(act.suspend).toHaveBeenCalledWith(MCQ_A, expect.any(Array));
    expect(act.enqueue).toHaveBeenCalledOnce();
    expect(act.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ predecessorInstrumentId: MCQ_A }),
      }),
    );

    // A's tracking is retired (suspended, no longer watched); B's is untouched — same store entry,
    // same text, same "current" state, never re-baselined and never marked pending.
    const after = await store.loadAll();
    expect(after.has(MCQ_A)).toBe(false);
    expect(after.get(MCQ_B)).toEqual(baselined.get(MCQ_B));
  });

  it('a same-claim (refreshed) revision on ONE instrument advances only its own baseline, never touching an unrelated instrument’s recorded reference', async () => {
    const vault = new MemoryVaultSource({
      [PATH_A]: note('Weathering rates', 'GEO101', PARAGRAPH_A_BEFORE, MCQ_A),
      [PATH_B]: note('Erosion patterns', 'GEO101', PARAGRAPH_B_TEXT, MCQ_B),
    });
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn(async () => ({ material: false })) }; // same claim
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });
    await trigger.tick(vault, actions());

    const reworded = 'Basalt weathers quickly, in humid climates.'; // same claim, punctuation only
    await vault.write(PATH_A, note('Weathering rates', 'GEO101', reworded, MCQ_A));
    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(report.refreshed).toBe(1);
    expect(act.suspend).not.toHaveBeenCalled();
    expect(act.enqueue).not.toHaveBeenCalled();

    const after = await store.loadAll();
    expect(after.get(MCQ_A)?.text).toContain(reworded); // A's own baseline advanced
    expect(after.get(MCQ_B)?.text).toContain(PARAGRAPH_B_TEXT); // B's reference is exactly as it was
    expect(after.has(MCQ_B)).toBe(true); // still tracked, never retired
  });
});
