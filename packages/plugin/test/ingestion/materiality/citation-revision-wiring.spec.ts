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
 *
 * The second `describe` block below (`ol-0r92.46`) proves the `[D-214]`
 * split-home-note fix specifically: every outcome above, replayed against a
 * fixture where the instrument's home note and its cited material are
 * DIFFERENT files, `sourceProvenance.sourcePath` naming the real source.
 */
import {
  citationStorePath,
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

// `[D-179]`/`[D-214]` split-home-note fixtures (`ol-0r92.46`): the instrument
// lives in its own sibling home note (frontmatter + MCQ block only, no
// material), and the cited material lives in a SEPARATE authored note that
// carries no instrument block at all — exactly the shape
// `buildAuthoredNoteUnit` (`ingestion/process-now.ts`) produces once she
// writes in `SOURCE_NOTE_PATH` and Olea drafts beside it.
const SOURCE_NOTE_PATH = 'Zettel/Weathering rates.md';
const HOME_NOTE_PATH = 'Zettel/Weathering rates (Olea).md';

function homeNote(mcqId: string = MCQ_ID): string {
  return [
    '---',
    `topic: [${CONCEPT_TOPIC}]`,
    'course: GEO101',
    '---',
    '',
    mcqBlock(mcqId),
    '',
  ].join('\n');
}

/** `[D-181]` citation sidecar entry — what `enumerate.ts` reads back onto `sourceProvenance`. */
function citationSidecar(instrumentId: string, sourcePath: VaultPath): string {
  return `${JSON.stringify({ instrumentId, sourcePath, page: 1, schemaVersion: 1 }, null, 2)}\n`;
}

function splitHomeNoteVault(
  sourceText: string,
  overrides: Readonly<Record<string, string>> = {},
): MemoryVaultSource {
  return new MemoryVaultSource({
    [HOME_NOTE_PATH]: homeNote(),
    [SOURCE_NOTE_PATH]: sourceText,
    [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, SOURCE_NOTE_PATH),
    ...overrides,
  });
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

/**
 * `[D-214]` split-home-note revision (`ol-0r92.46`) — `features/F3-learn-
 * from-anything.md`'s "Feature: F3.3 / [D-214] revision" scenarios,
 * converted from `@manual` to `@auto` here for the four this fix closes
 * (unchanged / changed-claim / same-claim-reworded / never-writes-her-note).
 * "A genuinely new passage drafts" is generation/pipeline.ts's existing
 * per-concept cache, outside this file's own concern, and stays `@manual`.
 */
describe('CitationRevisionTrigger.tick — [D-214] split home note (ol-0r92.46)', () => {
  it('@auto:F3.3-D214-revision-unchanged — an unchanged authored-note passage produces nothing, diffed from the source note rather than the empty home-note stub', async () => {
    const vault = splitHomeNoteVault(PARAGRAPH_A);
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn() };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

    const baseline = await trigger.tick(vault, actions());
    expect(baseline.newlyBaselined).toBe(1);
    const baselined = await store.loadAll();
    // The tracked text is the SOURCE note's own words, not the home note's
    // (frontmatter-plus-MCQ-only) stub — proof the fix reads the right file.
    expect(baselined.get(MCQ_ID)?.sourcePath).toBe(SOURCE_NOTE_PATH);
    expect(baselined.get(MCQ_ID)?.text).toBe(PARAGRAPH_A);

    const act = actions();
    const second = await trigger.tick(vault, act);
    expect(second.revised).toBe(0);
    expect(second.refreshed).toBe(0);
    expect(judge.judge).not.toHaveBeenCalled();
    expect(act.suspend).not.toHaveBeenCalled();
    expect(act.enqueue).not.toHaveBeenCalled();
  });

  it('@auto:F3.3-D214-revision-changed — a meaningfully changed authored-note passage suspends the predecessor and enqueues a successor, never rewriting either note synchronously', async () => {
    const vault = splitHomeNoteVault(PARAGRAPH_A);
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = {
      judge: vi.fn(async () => ({ material: true, reason: 'different claim' })),
    };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1000) });
    await trigger.tick(vault, actions());

    // She edits HER note, not the home note — the exact edit a home-note-
    // keyed diff could never see.
    await vault.write(SOURCE_NOTE_PATH, PARAGRAPH_B);
    const homeNoteBefore = await vault.read(HOME_NOTE_PATH);
    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(report.revised).toBe(1);
    expect(act.suspend).toHaveBeenCalledWith(MCQ_ID, [expect.any(String)]);
    expect(act.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: 'instrument-revision',
          predecessorInstrumentId: MCQ_ID,
        }),
      }),
    );

    // Never an immediate rewrite: the predecessor's own home note (still
    // holding its block, physically unchanged) and her source note are
    // exactly as this tick left them — a successor is only ENQUEUED as a
    // job here, never materialized synchronously, which is what makes the
    // eventual replacement a paced proposal through the ordinary review/
    // accept surface rather than a rewrite at the moment of the edit.
    expect(await vault.read(HOME_NOTE_PATH)).toBe(homeNoteBefore);
    expect(await vault.read(SOURCE_NOTE_PATH)).toBe(PARAGRAPH_B);

    const stored = await store.loadAll();
    expect(stored.has(MCQ_ID)).toBe(false);
  });

  it('@auto:F3.3-D214-revision-reworded — the same claim reworded in the authored note refreshes the tracked baseline silently, never suspending', async () => {
    const vault = splitHomeNoteVault(PARAGRAPH_A);
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn(async () => ({ material: false })) };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });
    await trigger.tick(vault, actions());

    await vault.write(SOURCE_NOTE_PATH, PARAGRAPH_B);
    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(report.refreshed).toBe(1);
    expect(act.suspend).not.toHaveBeenCalled();
    expect(act.enqueue).not.toHaveBeenCalled();
    const stored = await store.loadAll();
    expect(stored.get(MCQ_ID)?.sourcePath).toBe(SOURCE_NOTE_PATH);
    expect(stored.get(MCQ_ID)?.text).toBe(PARAGRAPH_B);
  });

  it('@auto:F3.3-D214-revision-no-source-write — falls back to home-note-minus-spans, never reading a non-markdown source-provenance path as text', async () => {
    // A generated instrument cited from a real PDF (not an authored note):
    // `sourceProvenance.sourcePath` names a binary this module must never
    // try to diff as text. `MemoryVaultSource.read` throws for any path not
    // in its map, so if the fix wrongly preferred this path the baseline
    // write below would fail rather than silently misbehave.
    const PDF_PATH = 'Sources/Deck.pdf';
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, PDF_PATH),
    });
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn() };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

    const report = await trigger.tick(vault, actions());
    expect(report.newlyBaselined).toBe(1);
    const stored = await store.loadAll();
    expect(stored.get(MCQ_ID)?.sourcePath).toBe(NOTE_PATH);
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
