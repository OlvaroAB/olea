/**
 * `CitationRevisionTrigger` tests (`[CORP-3b]`, `ol-2zfj.35`).
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`VaultSource`, `RevisionJudgePort`, `CitationHashStore`) — no `obsidian`
 * import, matching `ingestion/wiring.spec.ts`'s own posture. Proves the full
 * chain a real tick drives: baseline-on-first-sighting, `'unchanged'`
 * short-circuit, `'judge-unavailable'` grey-out (baseline untouched),
 * `'refreshed'` (baseline advances, no vault write), `'revised'` (suspend +
 * enqueue called, tracking retired), and `'not-found'` → `'relocated'`
 * (silent heal to the new location).
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

function actions(overrides: Partial<Parameters<CitationRevisionTrigger['tick']>[1]> = {}) {
  return {
    enqueue: vi.fn(async () => undefined),
    suspend: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('CitationRevisionTrigger.tick', () => {
  it('baselines a newly-seen MCQ instrument without calling the judge', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: note(PARAGRAPH_A) });
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn() };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

    const report = await trigger.tick(vault, actions());

    expect(report.newlyBaselined).toBe(1);
    expect(report.tracked).toBe(0);
    expect(judge.judge).not.toHaveBeenCalled();
    const stored = await store.loadAll();
    expect(stored.get(MCQ_ID)?.sourcePath).toBe(NOTE_PATH);
  });

  it('reports unchanged and never calls the judge on a second identical pass', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: note(PARAGRAPH_A) });
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn() };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

    await trigger.tick(vault, actions());
    const report = await trigger.tick(vault, actions());

    expect(report.tracked).toBe(1);
    expect(report.revised).toBe(0);
    expect(report.refreshed).toBe(0);
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('reports judge-unavailable and leaves the baseline untouched when no judge is configured', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: note(PARAGRAPH_A) });
    const store = new FakeCitationHashStore();
    const trigger = new CitationRevisionTrigger({ store, judge: null, clock: fakeClock(0) });
    await trigger.tick(vault, actions());

    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    const first = await trigger.tick(vault, actions());
    expect(first.judgeUnavailable).toBe(1);

    // Baseline was never advanced, so the SAME delta is reported again next
    // pass rather than settling into 'unchanged' — the grey-out contract
    // `MaterialityTrigger.evaluate` also holds for its own `call-judge` arm.
    const second = await trigger.tick(vault, actions());
    expect(second.judgeUnavailable).toBe(1);
  });

  it('advances the baseline on a same-claim (refreshed) verdict, without suspending or enqueuing', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: note(PARAGRAPH_A) });
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn(async () => ({ material: false })) };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });
    await trigger.tick(vault, actions());

    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(report.refreshed).toBe(1);
    expect(act.suspend).not.toHaveBeenCalled();
    expect(act.enqueue).not.toHaveBeenCalled();
    const stored = await store.loadAll();
    expect(stored.get(MCQ_ID)?.text).toContain('cold, dry climates');

    // Baseline advanced — a third, identical pass reports unchanged.
    const third = await trigger.tick(vault, actions());
    expect(third.refreshed).toBe(0);
  });

  it('suspends the predecessor and enqueues a successor on a changed-claim (revised) verdict, then retires tracking', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: note(PARAGRAPH_A) });
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = {
      judge: vi.fn(async () => ({ material: true, reason: 'different claim' })),
    };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1000) });
    await trigger.tick(vault, actions());

    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(report.revised).toBe(1);
    expect(act.suspend).toHaveBeenCalledWith(MCQ_ID, [expect.any(String)]);
    expect(act.enqueue).toHaveBeenCalledTimes(1);
    expect(act.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: 'instrument-revision',
          predecessorInstrumentId: MCQ_ID,
        }),
      }),
    );

    // Tracking retired: the predecessor is suspended, so the SAME id is
    // treated as a fresh first-sighting next pass (the MCQ block itself is
    // untouched in the vault — only the material around it changed).
    const stored = await store.loadAll();
    expect(stored.has(MCQ_ID)).toBe(false);
    const next = await trigger.tick(vault, actions());
    expect(next.newlyBaselined).toBe(1);
  });

  it('never re-points a citation on its own authority — a near-only match surfaces via the hook, never heals silently', async () => {
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn() };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

    const vaultBefore = new MemoryVaultSource({ [NOTE_PATH]: note(PARAGRAPH_A) });
    await trigger.tick(vaultBefore, actions());

    // Note A is gone; note C carries a PARAPHRASE of its material (enough
    // shared words to clear `RELOCATION_NEAR_MATCH_FLOOR`, not an exact
    // whitespace-normalised match) beside its own, differently-id'd MCQ.
    const NEAR_PARAGRAPH = 'Basalt weathers slowly in humid regions typically.';
    const OTHER_PATH = 'Courses/GEO101/Paraphrased.md';
    const vaultAfter = new MemoryVaultSource({ [OTHER_PATH]: note(NEAR_PARAGRAPH, 'q3') });

    const onRelocationProposed = vi.fn();
    const report = await trigger.tick(vaultAfter, actions({ onRelocationProposed }));

    expect(report.relocationProposed).toBe(1);
    expect(report.relocated).toBe(0);
    expect(judge.judge).not.toHaveBeenCalled();
    expect(onRelocationProposed).toHaveBeenCalledWith(
      MCQ_ID,
      expect.objectContaining({ anchor: expect.objectContaining({ sourcePath: OTHER_PATH }) }),
    );

    // Never healed: the old id stays tracked against its OLD text, waiting
    // for her confirmation rather than being silently re-pointed.
    const stored = await store.loadAll();
    expect(stored.get(MCQ_ID)?.sourcePath).toBe(NOTE_PATH);
  });

  it('heals a stranded citation silently when its old material reappears verbatim elsewhere', async () => {
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn() };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

    const vaultBefore = new MemoryVaultSource({ [NOTE_PATH]: note(PARAGRAPH_A) });
    await trigger.tick(vaultBefore, actions());

    // Note A is gone; note B is a different note carrying the SAME material
    // paragraph (exact, whitespace-normalised) beside its own MCQ.
    const DECOY_PATH = 'Courses/GEO101/Elsewhere.md';
    const vaultAfter = new MemoryVaultSource({ [DECOY_PATH]: note(PARAGRAPH_A, 'q2') });

    const report = await trigger.tick(vaultAfter, actions());
    expect(report.relocated).toBe(1);
    expect(judge.judge).not.toHaveBeenCalled();

    const stored = await store.loadAll();
    expect(stored.get(MCQ_ID)?.sourcePath).toBe(DECOY_PATH);
  });
});

describe('adaptMaterialityJudgeAsRevisionJudge', () => {
  it('returns null unchanged', () => {
    expect(adaptMaterialityJudgeAsRevisionJudge(null)).toBeNull();
  });

  it('supplies a placeholder path and forwards previous/current text verbatim', async () => {
    const inner: MaterialityJudge = {
      judge: vi.fn(async () => ({ material: true, reason: 'r' })),
    };
    const adapted = adaptMaterialityJudgeAsRevisionJudge(inner);
    const verdict = await adapted?.judge({ previousText: 'old', currentText: 'new' });

    expect(verdict).toEqual({ material: true, reason: 'r' });
    expect(inner.judge).toHaveBeenCalledWith({
      path: 'citation-revision',
      previousText: 'old',
      currentText: 'new',
    });
  });
});
