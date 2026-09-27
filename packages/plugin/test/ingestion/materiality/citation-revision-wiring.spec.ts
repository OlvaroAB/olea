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
 *
 * The third `describe` block (`[D-366]`, `ol-v7r5.68`) is the widening past
 * MCQ: a self-contained Q&A/cloze card (no citation naming a separate note)
 * is exempt — her own note's edit never suspends her own card — while a
 * Q&A/cloze card whose citation DOES name a separate, changed note is
 * suspended exactly like MCQ already was. A dedicated MCQ case proves that
 * path is untouched: a self-contained MCQ (the pre-existing, unchanged
 * behaviour) still suspends, unlike its Q&A/cloze counterpart now does not.
 *
 * The fourth `describe` block (`[D-400]`, ruled 2026-09-27, gate case
 * `CHG-57f55b30941e3290`) simulates an app restart by constructing a FRESH
 * `CitationRevisionTrigger` against the SAME persisted store between ticks —
 * a process that has actually closed and reopened has no more state than
 * that. Proves: exactly one automatic retry fires across any number of
 * restarts (never a fresh allowance per restart); a dispatch still inside
 * its recovery window is left to resolve, not duplicated; a successful retry
 * resolves normally through the ordinary outcome/write path; and a retry's
 * own late answer is discarded under the same D-311 obsolete-answer guard an
 * original dispatch's late answer already is.
 */
import {
  citationStorePath,
  enumerateVaultInstruments,
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
  // [D-351]/[D-400] — same semantics as `ObsidianCitationHashStore`: a
  // no-op when nothing is tracked yet; a genuinely NEW hash supersedes with
  // fresh state, but the SAME hash already pending leaves dispatch/retry
  // state exactly as it was (real `recordPending` fires unconditionally
  // every tick, including ones this trigger's own [D-400] gate deliberately
  // does not re-dispatch for).
  async setPendingRevalidation(
    instrumentId: string,
    sourceContentHash: string,
    since: number,
  ): Promise<void> {
    const existing = this.byId.get(instrumentId);
    if (existing === undefined) return;
    const existingPending = existing.pendingRevalidation;
    this.byId.set(instrumentId, {
      ...existing,
      pendingRevalidation:
        existingPending?.sinceContentHash === sourceContentHash
          ? existingPending
          : { sinceContentHash: sourceContentHash, since },
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
  // [D-400]
  async recordDispatch(
    instrumentId: string,
    sourceContentHash: string,
    dispatchedAt: number,
    retry: boolean,
  ): Promise<void> {
    const existing = this.byId.get(instrumentId);
    if (existing === undefined) return;
    const existingPending = existing.pendingRevalidation;
    const forSameDifference = existingPending?.sinceContentHash === sourceContentHash;
    const since = forSameDifference ? existingPending.since : dispatchedAt;
    const carriedRetriedAt = forSameDifference ? existingPending.retriedAt : undefined;
    this.byId.set(instrumentId, {
      ...existing,
      pendingRevalidation: {
        sinceContentHash: sourceContentHash,
        since,
        dispatchedAt,
        ...(retry
          ? { retriedAt: dispatchedAt }
          : carriedRetriedAt !== undefined
            ? { retriedAt: carriedRetriedAt }
            : {}),
      },
    });
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
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
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
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
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
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
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
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
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
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
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

    const vaultBefore = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
    await trigger.tick(vaultBefore, actions());

    // Note A is gone; note C carries a PARAPHRASE of its material (enough
    // shared words to clear `RELOCATION_NEAR_MATCH_FLOOR`, not an exact
    // whitespace-normalised match) beside its own, differently-id'd MCQ.
    const NEAR_PARAGRAPH = 'Basalt weathers slowly in humid regions typically.';
    const OTHER_PATH = 'Courses/GEO101/Paraphrased.md';
    const vaultAfter = new MemoryVaultSource({
      [OTHER_PATH]: note(NEAR_PARAGRAPH, 'q3'),
      // [D-398]: tracked, same reasoning as vaultBefore above -- this
      // instrument must be a relocation CANDIDATE, which only draws from
      // `trackedRecords`.
      [citationStorePath('q3')]: citationSidecar('q3', OTHER_PATH),
    });

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

  it('defect 5 (ol-egov.141.89.5.7): a formatting-only change to the cited passage exits free, no judge call and no invalidation', async () => {
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn() };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });
    await trigger.tick(vault, actions());

    // Reformat the material around the MCQ block — heading level, bold
    // emphasis — the words she wrote do not change at all.
    const reformatted = [
      '---',
      `topic: [${CONCEPT_TOPIC}]`,
      'course: GEO101',
      '---',
      '',
      '### What resists weathering?',
      '',
      `**${PARAGRAPH_A}**`,
      '',
      mcqBlock(MCQ_ID),
      '',
    ].join('\n');
    await vault.write(NOTE_PATH, reformatted);

    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(report.formattingOnly).toBe(1);
    expect(report.revised).toBe(0);
    expect(report.refreshed).toBe(0);
    expect(judge.judge).not.toHaveBeenCalled();
    expect(act.suspend).not.toHaveBeenCalled();
    expect(act.enqueue).not.toHaveBeenCalled();

    // Baseline advanced to the new raw text — a further identical pass
    // reports nothing further.
    const third = await trigger.tick(vault, actions());
    expect(third.formattingOnly).toBe(0);
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('[D-351] sets pendingRevalidation the moment a real difference is seen, even with no judge configured', async () => {
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
    const store = new FakeCitationHashStore();
    const trigger = new CitationRevisionTrigger({ store, judge: null, clock: fakeClock(1_000) });
    await trigger.tick(vault, actions());

    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    await trigger.tick(vault, actions());

    const stored = await store.loadAll();
    const record = stored.get(MCQ_ID);
    expect(record?.pendingRevalidation?.since).toBe(1_000);
    expect(record?.pendingRevalidation?.sinceContentHash).toBeDefined();
    // The stored `text` never advanced (grey-out) but the pending fact is
    // recorded regardless — [D-343]'s recognition is unconditional, unlike
    // the judge call itself.
    expect(record?.text).toContain('humid climates');
  });

  it('[D-351] clears pendingRevalidation on a same-claim (refreshed) resolution', async () => {
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn(async () => ({ material: false })) };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });
    await trigger.tick(vault, actions());

    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    await trigger.tick(vault, actions());

    const stored = await store.loadAll();
    expect(stored.get(MCQ_ID)?.pendingRevalidation).toBeUndefined();
  });

  it('[D-351] a late refreshed result for an earlier edit is discarded once a newer edit has raised its own pending state — no restore, no stale clear', async () => {
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
    const store = new FakeCitationHashStore();
    // The judge call is slow: WHILE it is in flight, simulate a second,
    // overlapping tick's own pass raising its OWN pending state for a newer
    // edit (`main.ts`'s `tickCitationRevisions` fires on a plain interval
    // with no overlap guard — see this trigger's own report doc). The
    // outcome `evaluateCitedPassageRevision` returns is still computed
    // against the ORIGINAL (now-stale) hash.
    const judge: RevisionJudgePort = {
      judge: vi.fn(async () => {
        await store.setPendingRevalidation(MCQ_ID, 'a-newer-hash-from-an-overlapping-tick', 999);
        return { material: false };
      }),
    };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });
    await trigger.tick(vault, actions());

    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(report.refreshed).toBe(1);
    expect(report.staleResultDiscarded).toBe(1);
    // Discarded: no restore-to-current write, no suspend, no enqueue.
    expect(act.suspend).not.toHaveBeenCalled();
    expect(act.enqueue).not.toHaveBeenCalled();
    // The newer pending state is left completely untouched.
    const stored = await store.loadAll();
    expect(stored.get(MCQ_ID)?.pendingRevalidation?.sinceContentHash).toBe(
      'a-newer-hash-from-an-overlapping-tick',
    );
  });

  it('[D-351] a late revised result for an earlier edit is discarded — no suspend, no enqueue, tracking stays', async () => {
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = {
      judge: vi.fn(async () => {
        await store.setPendingRevalidation(MCQ_ID, 'a-newer-hash-from-an-overlapping-tick', 999);
        return { material: true, reason: 'different claim' };
      }),
    };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1000) });
    await trigger.tick(vault, actions());

    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    const act = actions();
    const report = await trigger.tick(vault, act);

    expect(report.revised).toBe(1);
    expect(report.staleResultDiscarded).toBe(1);
    expect(act.suspend).not.toHaveBeenCalled();
    expect(act.enqueue).not.toHaveBeenCalled();
    // Tracking is NOT retired -- the newer pending state (from the
    // overlapping tick) is exactly what remains, untouched.
    const stored = await store.loadAll();
    expect(stored.has(MCQ_ID)).toBe(true);
    expect(stored.get(MCQ_ID)?.pendingRevalidation?.sinceContentHash).toBe(
      'a-newer-hash-from-an-overlapping-tick',
    );
  });

  it('heals a stranded citation silently when its old material reappears verbatim elsewhere', async () => {
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = { judge: vi.fn() };
    const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

    const vaultBefore = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
    await trigger.tick(vaultBefore, actions());

    // Note A is gone; note B is a different note carrying the SAME material
    // paragraph (exact, whitespace-normalised) beside its own MCQ.
    const DECOY_PATH = 'Courses/GEO101/Elsewhere.md';
    const vaultAfter = new MemoryVaultSource({
      [DECOY_PATH]: note(PARAGRAPH_A, 'q2'),
      // [D-398]: tracked, same reasoning as vaultBefore above -- this
      // instrument must be a relocation CANDIDATE, which only draws from
      // `trackedRecords`.
      [citationStorePath('q2')]: citationSidecar('q2', DECOY_PATH),
    });

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

/**
 * `[D-366]` (David, 2026-09-25, ruled on `ol-v7r5.83`) — the widening past
 * MCQ, and the exemption ruling carries. `[D-398]` (ruled 2026-09-27 on
 * `ol-v7r5.97`) extends the same exemption to MCQ itself — see the
 * `describe` block below this one for MCQ's own self-contained and
 * generated-with-real-source cases, and the bug fix for a citation that
 * names its own note (`[D-398]`'s binding condition 2).
 */
describe('CitationRevisionTrigger.tick — [D-366] Q&A/cloze widening', () => {
  const QA_HAND_NOTE_PATH = 'Courses/GEO101/HandAuthoredQa.md';
  const CLOZE_HAND_NOTE_PATH = 'Courses/GEO101/HandAuthoredCloze.md';
  const QA_GENERATED_HOME_PATH = 'Zettel/Weathering QA (Olea).md';
  const CLOZE_GENERATED_HOME_PATH = 'Zettel/Weathering Cloze (Olea).md';
  const GENERATED_SOURCE_PATH = 'Zettel/Weathering rates for cards.md';

  function handAuthoredQaNote(paragraph: string): string {
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
      'Which mineral is most weathering-resistant?::Quartz',
      '',
    ].join('\n');
  }

  function handAuthoredClozeNote(paragraph: string): string {
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
      'The most weathering-resistant mineral is ==quartz==.',
      '',
    ].join('\n');
  }

  function generatedQaHomeNote(): string {
    return [
      '---',
      `topic: [${CONCEPT_TOPIC}]`,
      'course: GEO101',
      '---',
      '',
      'Which mineral is most weathering-resistant?::Quartz',
      '',
    ].join('\n');
  }

  function generatedClozeHomeNote(): string {
    return [
      '---',
      `topic: [${CONCEPT_TOPIC}]`,
      'course: GEO101',
      '---',
      '',
      'The most weathering-resistant mineral is ==quartz==.',
      '',
    ].join('\n');
  }

  /** Discovers the one instrument's real, enumerate.ts-derived id — never hand-rolled — so the citation sidecar below is keyed exactly as production would key it. */
  async function soleInstrumentId(vault: MemoryVaultSource): Promise<string> {
    const enumeration = await enumerateVaultInstruments(vault, {});
    expect(enumeration.records).toHaveLength(1);
    const [record] = enumeration.records;
    if (record === undefined) throw new Error('expected exactly one record');
    return record.instrumentId;
  }

  describe('a self-contained, hand-authored card (no citation naming a separate source)', () => {
    it('Q&A: editing her own note never suspends her own card — never tracked, never judged', async () => {
      const vault = new MemoryVaultSource({ [QA_HAND_NOTE_PATH]: handAuthoredQaNote(PARAGRAPH_A) });
      const store = new FakeCitationHashStore();
      const judge: RevisionJudgePort = {
        judge: vi.fn(async () => ({ material: true, reason: 'would suspend if ever called' })),
      };
      const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

      const baseline = await trigger.tick(vault, actions());
      expect(baseline.exemptSelfContained).toBe(1);
      expect(baseline.newlyBaselined).toBe(0);
      expect(baseline.tracked).toBe(0);

      // She edits her own note — the surrounding material this trigger
      // would otherwise diff for a tracked instrument.
      await vault.write(QA_HAND_NOTE_PATH, handAuthoredQaNote(PARAGRAPH_B));
      const act = actions();
      const report = await trigger.tick(vault, act);

      expect(report.exemptSelfContained).toBe(1);
      expect(judge.judge).not.toHaveBeenCalled();
      expect(act.suspend).not.toHaveBeenCalled();
      expect(act.enqueue).not.toHaveBeenCalled();
      const stored = await store.loadAll();
      expect(stored.size).toBe(0);
    });

    it('cloze: editing her own note never suspends her own card — never tracked, never judged', async () => {
      const vault = new MemoryVaultSource({
        [CLOZE_HAND_NOTE_PATH]: handAuthoredClozeNote(PARAGRAPH_A),
      });
      const store = new FakeCitationHashStore();
      const judge: RevisionJudgePort = {
        judge: vi.fn(async () => ({ material: true, reason: 'would suspend if ever called' })),
      };
      const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

      const baseline = await trigger.tick(vault, actions());
      expect(baseline.exemptSelfContained).toBe(1);
      expect(baseline.newlyBaselined).toBe(0);

      await vault.write(CLOZE_HAND_NOTE_PATH, handAuthoredClozeNote(PARAGRAPH_B));
      const act = actions();
      const report = await trigger.tick(vault, act);

      expect(report.exemptSelfContained).toBe(1);
      expect(judge.judge).not.toHaveBeenCalled();
      expect(act.suspend).not.toHaveBeenCalled();
      expect(act.enqueue).not.toHaveBeenCalled();
      const stored = await store.loadAll();
      expect(stored.size).toBe(0);
    });

    it('[D-398] MCQ path is now widened too: a self-contained hand-authored MCQ is exempt, never tracked or suspended — the deab181-era pinning behaviour this rewrites', async () => {
      const vault = new MemoryVaultSource({ [NOTE_PATH]: note(PARAGRAPH_A) });
      const store = new FakeCitationHashStore();
      const judge: RevisionJudgePort = {
        judge: vi.fn(async () => ({ material: true, reason: 'would suspend if ever called' })),
      };
      const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1000) });

      const baseline = await trigger.tick(vault, actions());
      expect(baseline.newlyBaselined).toBe(0);
      expect(baseline.tracked).toBe(0);
      expect(baseline.exemptSelfContained).toBe(0);
      // Not a verified authored signal for MCQ (materialize-mcq.ts's own
      // conditional citation write) — counted, not silently folded into
      // exemptSelfContained. See CitationRevisionTickReport's own doc.
      expect(baseline.authorshipUnverified).toBe(1);

      // She edits her own note — the surrounding material this trigger
      // would otherwise diff for a tracked instrument.
      await vault.write(NOTE_PATH, note(PARAGRAPH_B));
      const act = actions();
      const report = await trigger.tick(vault, act);

      expect(report.authorshipUnverified).toBe(1);
      expect(report.revised).toBe(0);
      expect(judge.judge).not.toHaveBeenCalled();
      expect(act.suspend).not.toHaveBeenCalled();
      expect(act.enqueue).not.toHaveBeenCalled();
      const stored = await store.loadAll();
      expect(stored.size).toBe(0);
    });
  });

  describe('[D-398] a self-contained, hand-authored MCQ, and the generated/self-referential citation bug fix — every format alike', () => {
    const MCQ_GENERATED_HOME_PATH = 'Zettel/Weathering MCQ (Olea).md';

    function generatedMcqHomeNote(mcqId: string = MCQ_ID): string {
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

    it('an MCQ whose citation names a genuinely separate, real source is tracked and suspends exactly like the pre-existing MCQ path', async () => {
      const vault = new MemoryVaultSource({
        [MCQ_GENERATED_HOME_PATH]: generatedMcqHomeNote(),
        [GENERATED_SOURCE_PATH]: PARAGRAPH_A,
        [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, GENERATED_SOURCE_PATH),
      });
      const store = new FakeCitationHashStore();
      const judge: RevisionJudgePort = { judge: vi.fn() };
      const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1000) });

      const baseline = await trigger.tick(vault, actions());
      expect(baseline.newlyBaselined).toBe(1);
      expect(baseline.exemptSelfContained).toBe(0);
      expect(baseline.authorshipUnverified).toBe(0);
      const baselined = await store.loadAll();
      expect(baselined.get(MCQ_ID)?.sourcePath).toBe(GENERATED_SOURCE_PATH);

      await vault.write(GENERATED_SOURCE_PATH, PARAGRAPH_B);
      const materialJudge: RevisionJudgePort = {
        judge: vi.fn(async () => ({ material: true, reason: 'different claim' })),
      };
      const trigger2 = new CitationRevisionTrigger({
        store,
        judge: materialJudge,
        clock: fakeClock(1000),
      });
      const act = actions();
      const report = await trigger2.tick(vault, act);

      expect(report.revised).toBe(1);
      expect(act.suspend).toHaveBeenCalledWith(MCQ_ID, [expect.any(String)]);
      expect(act.enqueue).toHaveBeenCalledTimes(1);
    });

    it('[D-398 binding condition 2] a generated MCQ whose citation is self-referential (names its own note) stays tracked — never exempt merely for sharing a note with its source', async () => {
      const vault = new MemoryVaultSource({
        [NOTE_PATH]: note(PARAGRAPH_A),
        // Self-referential citation — exactly what `materialize-card.ts`'s
        // `[D-366]` Class B write mints for a Q&A/cloze card when the
        // pipeline had no separate passage to cite; here proving the SAME
        // shape for MCQ names its own note and must not be read as
        // self-contained.
        [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
      });
      const store = new FakeCitationHashStore();
      const judge: RevisionJudgePort = {
        judge: vi.fn(async () => ({ material: true, reason: 'different claim' })),
      };
      const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1000) });

      const baseline = await trigger.tick(vault, actions());
      expect(baseline.newlyBaselined).toBe(1);
      expect(baseline.exemptSelfContained).toBe(0);
      expect(baseline.authorshipUnverified).toBe(0);

      await vault.write(NOTE_PATH, note(PARAGRAPH_B));
      const act = actions();
      const report = await trigger.tick(vault, act);

      expect(report.revised).toBe(1);
      expect(act.suspend).toHaveBeenCalledWith(MCQ_ID, [expect.any(String)]);
      expect(act.enqueue).toHaveBeenCalledTimes(1);
    });

    it('[D-398 binding condition 2] a generated Q&A card whose citation is self-referential (names its own note) stays tracked — the same bug fix for the format [D-366] already covered', async () => {
      const QA_SELF_REFERENTIAL_NOTE_PATH = 'Courses/GEO101/SelfReferentialQa.md';
      function selfReferentialQaNote(paragraph: string): string {
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
          'Which mineral is most weathering-resistant?::Quartz',
          '',
        ].join('\n');
      }
      const vault = new MemoryVaultSource({
        [QA_SELF_REFERENTIAL_NOTE_PATH]: selfReferentialQaNote(PARAGRAPH_A),
      });
      const instrumentId = await soleInstrumentId(vault);
      // Self-referential citation, same shape `materialize-card.ts` mints
      // when the pipeline had no separate passage to record.
      await vault.write(
        citationStorePath(instrumentId),
        citationSidecar(instrumentId, QA_SELF_REFERENTIAL_NOTE_PATH),
      );

      const store = new FakeCitationHashStore();
      const judge: RevisionJudgePort = {
        judge: vi.fn(async () => ({ material: true, reason: 'different claim' })),
      };
      const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1000) });

      const baseline = await trigger.tick(vault, actions());
      expect(baseline.newlyBaselined).toBe(1);
      expect(baseline.exemptSelfContained).toBe(0);

      await vault.write(QA_SELF_REFERENTIAL_NOTE_PATH, selfReferentialQaNote(PARAGRAPH_B));
      const act = actions();
      const report = await trigger.tick(vault, act);

      expect(report.revised).toBe(1);
      expect(act.suspend).toHaveBeenCalledWith(instrumentId, [expect.any(String)]);
      expect(act.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('[D-398 binding condition 3 / D-334] structural withholding still applies to an exempt item', () => {
    it('a self-contained, hand-authored MCQ with a duplicate distractor is never enumerated as an instrument at all — invisible to this trigger, still withheld at parse time', async () => {
      const duplicateOptionMcq = [
        '```olea-mcq',
        `id: ${MCQ_ID}`,
        'stem: Which mineral is most weathering-resistant?',
        'answer: Quartz',
        'distractor: Olivine',
        'distractor: Quartz',
        'distractor: Feldspar',
        'distractor: Biotite',
        '```',
      ].join('\n');
      const noteWithDuplicateOption = [
        '---',
        `topic: [${CONCEPT_TOPIC}]`,
        'course: GEO101',
        '---',
        '',
        '## What resists weathering?',
        '',
        PARAGRAPH_A,
        '',
        duplicateOptionMcq,
        '',
      ].join('\n');
      const vault = new MemoryVaultSource({ [NOTE_PATH]: noteWithDuplicateOption });
      const store = new FakeCitationHashStore();
      const judge: RevisionJudgePort = { judge: vi.fn() };
      const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });

      // Confirms the fixture is actually invalid, not merely absent from
      // the report for some unrelated reason.
      const enumeration = await enumerateVaultInstruments(vault, {});
      expect(enumeration.records).toHaveLength(0);
      expect(enumeration.invalidMcqBlocks).toHaveLength(1);

      const report = await trigger.tick(vault, actions());
      expect(report.newlyBaselined).toBe(0);
      expect(report.tracked).toBe(0);
      expect(report.exemptSelfContained).toBe(0);
      expect(report.authorshipUnverified).toBe(0);
      const stored = await store.loadAll();
      expect(stored.size).toBe(0);
    });
  });

  describe('a generated card whose citation names a separate, real source', () => {
    it('Q&A: a changed-claim revision suspends the predecessor and enqueues a successor, exactly like the MCQ path', async () => {
      const vault = new MemoryVaultSource({
        [QA_GENERATED_HOME_PATH]: generatedQaHomeNote(),
        [GENERATED_SOURCE_PATH]: PARAGRAPH_A,
      });
      const instrumentId = await soleInstrumentId(vault);
      await vault.write(
        citationStorePath(instrumentId),
        citationSidecar(instrumentId, GENERATED_SOURCE_PATH),
      );

      const store = new FakeCitationHashStore();
      const judge: RevisionJudgePort = { judge: vi.fn() };
      const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1000) });

      const baseline = await trigger.tick(vault, actions());
      expect(baseline.newlyBaselined).toBe(1);
      expect(baseline.exemptSelfContained).toBe(0);
      const baselined = await store.loadAll();
      expect(baselined.get(instrumentId)?.sourcePath).toBe(GENERATED_SOURCE_PATH);

      await vault.write(GENERATED_SOURCE_PATH, PARAGRAPH_B);
      const materialJudge: RevisionJudgePort = {
        judge: vi.fn(async () => ({ material: true, reason: 'different claim' })),
      };
      const trigger2 = new CitationRevisionTrigger({
        store,
        judge: materialJudge,
        clock: fakeClock(1000),
      });
      const act = actions();
      const report = await trigger2.tick(vault, act);

      expect(report.revised).toBe(1);
      expect(act.suspend).toHaveBeenCalledWith(instrumentId, [expect.any(String)]);
      expect(act.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            kind: 'instrument-revision',
            predecessorInstrumentId: instrumentId,
          }),
        }),
      );
      const stored = await store.loadAll();
      expect(stored.has(instrumentId)).toBe(false);
    });

    it('cloze: a changed-claim revision suspends the predecessor and enqueues a successor, exactly like the MCQ path', async () => {
      const vault = new MemoryVaultSource({
        [CLOZE_GENERATED_HOME_PATH]: generatedClozeHomeNote(),
        [GENERATED_SOURCE_PATH]: PARAGRAPH_A,
      });
      const instrumentId = await soleInstrumentId(vault);
      await vault.write(
        citationStorePath(instrumentId),
        citationSidecar(instrumentId, GENERATED_SOURCE_PATH),
      );

      const store = new FakeCitationHashStore();
      const judge: RevisionJudgePort = { judge: vi.fn() };
      const trigger = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1000) });

      const baseline = await trigger.tick(vault, actions());
      expect(baseline.newlyBaselined).toBe(1);
      expect(baseline.exemptSelfContained).toBe(0);

      await vault.write(GENERATED_SOURCE_PATH, PARAGRAPH_B);
      const materialJudge: RevisionJudgePort = {
        judge: vi.fn(async () => ({ material: true, reason: 'different claim' })),
      };
      const trigger2 = new CitationRevisionTrigger({
        store,
        judge: materialJudge,
        clock: fakeClock(1000),
      });
      const act = actions();
      const report = await trigger2.tick(vault, act);

      expect(report.revised).toBe(1);
      expect(act.suspend).toHaveBeenCalledWith(instrumentId, [expect.any(String)]);
      expect(act.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            kind: 'instrument-revision',
            predecessorInstrumentId: instrumentId,
          }),
        }),
      );
    });
  });
});

/**
 * `[D-400]` (ruled 2026-09-27) — recovering a check lost to an app restart,
 * bounded to one automatic retry per original check. Gate case
 * `CHG-57f55b30941e3290` ("restart with an escalation pending").
 *
 * A restart is simulated by building a FRESH `CitationRevisionTrigger`
 * against the SAME `FakeCitationHashStore` instance between ticks — a real
 * restart leaves nothing else behind either. A dispatch "lost" to that
 * restart is modelled with a judge that throws (a real crash mid-`await`
 * and a swallowed provider failure are indistinguishable from this trigger's
 * own vantage point — both leave the persisted dispatch fact unresolved, per
 * this module's own `[D-400]` doc section: no age/timeout check gates the
 * retry, since every step here is fully `await`ed before the next tick can
 * even start).
 */
describe('CitationRevisionTrigger.tick — [D-400] restart recovery', () => {
  it('gate case CHG-57f55b30941e3290: fires exactly one automatic retry across two restarts, never a fresh allowance per restart', async () => {
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
    const store = new FakeCitationHashStore();
    const judge: RevisionJudgePort = {
      judge: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };

    // Baseline (t=0) — no judge call yet.
    const trigger0 = new CitationRevisionTrigger({ store, judge, clock: fakeClock(0) });
    await trigger0.tick(vault, actions());
    expect(judge.judge).not.toHaveBeenCalled();

    // She edits the cited passage — a real difference, escalation pending.
    await vault.write(NOTE_PATH, note(PARAGRAPH_B));

    // Original check: dispatched, lost (the process closes mid-call).
    const original = await trigger0.tick(vault, actions());
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(original.retryExhausted).toBe(0);
    const afterOriginal = await store.loadAll();
    expect(afterOriginal.get(MCQ_ID)?.pendingRevalidation?.dispatchedAt).toBe(0);
    expect(afterOriginal.get(MCQ_ID)?.pendingRevalidation?.retriedAt).toBeUndefined();

    // Restart 1: a FRESH trigger instance (as a real restart would
    // produce), same store. The one permitted retry fires.
    const trigger1 = new CitationRevisionTrigger({ store, judge, clock: fakeClock(1_000) });
    const retry = await trigger1.tick(vault, actions());
    expect(judge.judge).toHaveBeenCalledTimes(2);
    expect(retry.retryExhausted).toBe(0);
    const afterRetry = await store.loadAll();
    expect(afterRetry.get(MCQ_ID)?.pendingRevalidation?.dispatchedAt).toBe(1_000);
    expect(afterRetry.get(MCQ_ID)?.pendingRevalidation?.retriedAt).toBe(1_000);

    // Restart 2: the retry ALSO went unanswered. Never a further automatic
    // dispatch — the item reports a recoverable deferred state instead.
    const trigger2 = new CitationRevisionTrigger({ store, judge, clock: fakeClock(5_000) });
    const secondRestart = await trigger2.tick(vault, actions());
    expect(judge.judge).toHaveBeenCalledTimes(2); // unchanged — no third call
    expect(secondRestart.retryExhausted).toBe(1);

    // A third restart changes nothing further — the retry budget stays
    // spent, permanently, for this exact difference.
    const trigger3 = new CitationRevisionTrigger({ store, judge, clock: fakeClock(50_000) });
    const thirdRestart = await trigger3.tick(vault, actions());
    expect(judge.judge).toHaveBeenCalledTimes(2);
    expect(thirdRestart.retryExhausted).toBe(1);
  });

  it("a successful retry resolves normally — the same real judge call any original check would make, so its spend is logged wherever every other call's already is", async () => {
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
    const store = new FakeCitationHashStore();
    const failingJudge: RevisionJudgePort = {
      judge: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };
    const trigger0 = new CitationRevisionTrigger({
      store,
      judge: failingJudge,
      clock: fakeClock(0),
    });
    await trigger0.tick(vault, actions());
    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    await trigger0.tick(vault, actions()); // original dispatch, lost

    // Restart with a working judge — the retry itself goes through the
    // identical `judge.judge()` seam any other check uses.
    const workingJudge: RevisionJudgePort = { judge: vi.fn(async () => ({ material: false })) };
    const trigger1 = new CitationRevisionTrigger({
      store,
      judge: workingJudge,
      clock: fakeClock(1_000),
    });
    const act = actions();
    const report = await trigger1.tick(vault, act);

    expect(workingJudge.judge).toHaveBeenCalledTimes(1);
    expect(report.refreshed).toBe(1);
    expect(report.retryExhausted).toBe(0);
    expect(act.suspend).not.toHaveBeenCalled();
    expect(act.enqueue).not.toHaveBeenCalled();
    const stored = await store.loadAll();
    expect(stored.get(MCQ_ID)?.pendingRevalidation).toBeUndefined();
  });

  it("[D-311] a retry's own answer is discarded once a newer edit has raised its own pending state — the same obsolete-answer guard an original dispatch already gets", async () => {
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
    const store = new FakeCitationHashStore();
    const failingJudge: RevisionJudgePort = {
      judge: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };
    const trigger0 = new CitationRevisionTrigger({
      store,
      judge: failingJudge,
      clock: fakeClock(0),
    });
    await trigger0.tick(vault, actions());
    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    await trigger0.tick(vault, actions()); // original dispatch, lost

    // The retry's own call is slow: WHILE it is in flight, an overlapping
    // tick raises its own, newer pending state (same modelling the
    // pre-existing [D-351] "late result" tests already use).
    const overlappingJudge: RevisionJudgePort = {
      judge: vi.fn(async () => {
        await store.setPendingRevalidation(MCQ_ID, 'a-newer-hash-from-an-overlapping-tick', 9_000);
        return { material: false };
      }),
    };
    const trigger1 = new CitationRevisionTrigger({
      store,
      judge: overlappingJudge,
      clock: fakeClock(1_000),
    });
    const act = actions();
    const report = await trigger1.tick(vault, act);

    expect(overlappingJudge.judge).toHaveBeenCalledTimes(1); // the retry itself fired
    expect(report.refreshed).toBe(1);
    expect(report.staleResultDiscarded).toBe(1);
    expect(act.suspend).not.toHaveBeenCalled();
    expect(act.enqueue).not.toHaveBeenCalled();
    // The newer pending state is left completely untouched by the retry's
    // own, now-obsolete answer.
    const stored = await store.loadAll();
    expect(stored.get(MCQ_ID)?.pendingRevalidation?.sinceContentHash).toBe(
      'a-newer-hash-from-an-overlapping-tick',
    );
  });

  it('a genuinely new edit gets its own fresh retry budget, never blocked by an older, already-spent one', async () => {
    const vault = new MemoryVaultSource({
      [NOTE_PATH]: note(PARAGRAPH_A),
      // [D-398]: a self-referential citation keeps this MCQ tracked under the
      // new authorship-based rule -- this fixture tests batch-pass revision
      // mechanics (D-093/D-351/D-400), never the D-366/D-398 exemption itself.
      [citationStorePath(MCQ_ID)]: citationSidecar(MCQ_ID, NOTE_PATH),
    });
    const store = new FakeCitationHashStore();
    const failingJudge: RevisionJudgePort = {
      judge: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };
    const t0 = new CitationRevisionTrigger({ store, judge: failingJudge, clock: fakeClock(0) });
    await t0.tick(vault, actions());
    await vault.write(NOTE_PATH, note(PARAGRAPH_B));
    await t0.tick(vault, actions()); // original dispatch for PARAGRAPH_B, lost
    const t1 = new CitationRevisionTrigger({ store, judge: failingJudge, clock: fakeClock(1_000) });
    await t1.tick(vault, actions()); // the one retry for PARAGRAPH_B, also lost
    expect(failingJudge.judge).toHaveBeenCalledTimes(2);

    // A further, genuinely different edit — its own difference, its own
    // budget, even though the OLD difference's retry is already spent.
    const PARAGRAPH_C = 'Basalt weathers at a moderate rate in temperate climates.';
    await vault.write(NOTE_PATH, note(PARAGRAPH_C));
    const workingJudge: RevisionJudgePort = { judge: vi.fn(async () => ({ material: false })) };
    const t2 = new CitationRevisionTrigger({ store, judge: workingJudge, clock: fakeClock(2_000) });
    const report = await t2.tick(vault, actions());

    expect(workingJudge.judge).toHaveBeenCalledTimes(1);
    expect(report.refreshed).toBe(1);
    expect(report.retryExhausted).toBe(0);
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
