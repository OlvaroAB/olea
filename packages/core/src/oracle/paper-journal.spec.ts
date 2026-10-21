import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import type { PaperGeneratedItem } from './paper-items.js';
import {
  applyPaperJournalEvent,
  classifyPaperSlotWorkerResult,
  discardPaperJournal,
  finalizePaperFromJournal,
  isPaperJournalRecord,
  listPaperJournals,
  OPAQUE_PAPER_JOURNAL_ID_PREFIX,
  openPaperJournal,
  PAPER_JOURNAL_FOLDER,
  PAPER_JOURNAL_SCHEMA_VERSION,
  PAPER_JOURNAL_STRUCTURED_SCHEMA_VERSION,
  type PaperJournalPlanSlot,
  PaperJournalUnfinishedError,
  type PaperSlotGenerationOutcome,
  type PaperSlotGenerationRequest,
  paperJournalOwedSlotIds,
  paperJournalPath,
  runPaperJournal,
} from './paper-journal.js';
import {
  createPaper,
  listPaperRecords,
  PAPER_STORE_FOLDER,
  type PaperCompositionAccount,
} from './paper-store.js';
import {
  PAPER_STRUCTURE_FORMAT_VERSION,
  type PaperEmptySlot,
  type PaperReuseFingerprint,
  type PaperStructuredShape,
} from './paper-types.js';

// Scenarios: olea-service/features/F4-oracle.md, F4.11 (`[D-430]` part 3), filed as owed on the
// D-430 build bead. Synthetic ids only.

const ACCOUNT: PaperCompositionAccount = {
  formatVersion: 'paper-blueprint-v1',
  course: 'COURSEA',
  asOf: '2026-09-29',
  alpha: 0.5,
  formatClass: 'recall-style',
  intendedDemand: 'recall-a-fact',
  steering: {},
  structureSummary: null,
  eligibleCount: 3,
  unbuiltDemand: null,
  partial: false,
};

const FP: PaperReuseFingerprint = {
  sourceVersions: 'src-1',
  scope: 'scope-1',
  structure: 'struct-1',
  authoringSpec: 'spec-1',
};

const PLAN: readonly PaperJournalPlanSlot[] = [
  {
    slotId: 'slot-0',
    conceptKey: 'k0',
    conceptName: 'c0',
    taskId: 'quiz.generate.v1',
    dependsOnSlotIds: [],
  },
  {
    slotId: 'slot-1',
    conceptKey: 'k1',
    conceptName: 'c1',
    taskId: 'quiz.generate.v1',
    dependsOnSlotIds: ['slot-0'],
  },
  {
    slotId: 'slot-2',
    conceptKey: 'k2',
    conceptName: 'c2',
    taskId: 'quiz.generate.v1',
    dependsOnSlotIds: [],
  },
];

function item(slotId: string, promptVersion = 'v1'): PaperGeneratedItem {
  return {
    slotId,
    conceptKey: `k-${slotId}`,
    conceptName: `c-${slotId}`,
    taskId: 'quiz.generate.v1',
    promptVersion,
    intendedDemand: 'recall-a-fact',
    groundingTier: 'T2',
    groundingLabel: 'covered-by-her-material',
    heldSourceKind: 'notes',
    heldSourceId: 's1',
    response: { ok: true, stamp: { promptVersion }, result: { questions: [] } },
  };
}

/** A generator scripted per slot: each call to a slot takes the next scripted outcome (the last repeats). */
function scripted(script: Record<string, PaperSlotGenerationOutcome[]>) {
  const calls: PaperSlotGenerationRequest[] = [];
  const counts = new Map<string, number>();
  const generate = async (
    request: PaperSlotGenerationRequest,
  ): Promise<PaperSlotGenerationOutcome> => {
    calls.push(request);
    const steps = script[request.slot.slotId] ?? [
      { status: 'generated', item: item(request.slot.slotId) },
    ];
    const n = counts.get(request.slot.slotId) ?? 0;
    counts.set(request.slot.slotId, n + 1);
    const step = steps[Math.min(n, steps.length - 1)];
    if (step === undefined) throw new Error('empty script');
    return step;
  };
  return { generate, calls };
}

const OUTAGE: PaperSlotGenerationOutcome = { status: 'unavailable', reason: 'upstream-error' };

describe('paper journal ([D-430] part 3)', () => {
  let root: string;
  let vault: FolderSource;
  let tick = 0;
  const now = () => `2026-09-29T00:00:${String(tick++).padStart(2, '0')}.000Z`;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-paper-journal-'));
    vault = new FolderSource(root);
    tick = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function open(fingerprint: PaperReuseFingerprint = FP, course = 'COURSEA') {
    return openPaperJournal(vault, { course, fingerprint, plan: PLAN }, { now });
  }

  describe('opening: fresh, resumed, or discarded', () => {
    it('starts fresh when nothing is open, under the papers folder, and lists it', async () => {
      const opened = await open();
      expect(opened.decision).toBe('fresh');
      expect(opened.journal.status).toBe('open');
      expect(opened.journal.id.startsWith(`${OPAQUE_PAPER_JOURNAL_ID_PREFIX}:`)).toBe(true);
      expect(PAPER_JOURNAL_FOLDER.startsWith(`${PAPER_STORE_FOLDER}/`)).toBe(true);
      const listed = await listPaperJournals(vault);
      expect(listed).toHaveLength(1);
      expect(paperJournalOwedSlotIds(opened.journal)).toEqual(['slot-0', 'slot-1', 'slot-2']);
    });

    it('resumes the open journal when all four fingerprint components agree', async () => {
      const first = await open();
      const second = await open();
      expect(second.decision).toBe('resumed');
      expect(second.journal.id).toBe(first.journal.id);
      expect(await listPaperJournals(vault)).toHaveLength(1);
    });

    it('discards it, naming what changed, when any one component differs, and starts fresh', async () => {
      const first = await open();
      for (const component of ['sourceVersions', 'scope', 'structure', 'authoringSpec'] as const) {
        const before = (await open()).journal;
        const changed = await open({ ...FP, [component]: 'different' });
        expect(changed.decision).toBe('discarded-and-fresh');
        expect(changed.discarded).toEqual([{ journalId: before.id, changed: [component] }]);
        expect(changed.journal.id).not.toBe(before.id);
        // put the original fingerprint back for the next round
        await discardPaperJournal(vault, changed.journal.id, { reason: 'abandoned' }, { now });
      }
      expect(first.journal.id.length).toBeGreaterThan(0);
    });

    it('never mixes courses: a journal for another course is left alone', async () => {
      const other = await open(FP, 'COURSEB');
      const mine = await open(FP, 'COURSEA');
      expect(mine.decision).toBe('fresh');
      const journals = await listPaperJournals(vault);
      expect(journals.find((j) => j.record.id === other.journal.id)?.record.status).toBe('open');
    });

    it('refuses a plan that is not in dependency order, so resume order can never be wrong', async () => {
      const backwards: readonly PaperJournalPlanSlot[] = [
        {
          slotId: 'a',
          conceptKey: 'k',
          conceptName: 'c',
          taskId: 'quiz.generate.v1',
          dependsOnSlotIds: ['b'],
        },
        {
          slotId: 'b',
          conceptKey: 'k',
          conceptName: 'c',
          taskId: 'quiz.generate.v1',
          dependsOnSlotIds: [],
        },
      ];
      await expect(
        openPaperJournal(vault, { course: 'COURSEA', fingerprint: FP, plan: backwards }, { now }),
      ).rejects.toThrow(/dependency order/);
    });

    // `[D-548]` (`ol-egov.141.89.7.87`): "a reading that arrives after a paper started leaves that
    // paper on its recorded plan" — the journal records the length its plan was made at.
    it('records the length its plan was made at, reads it back, and records none when given none', async () => {
      const extent = {
        slotCount: 6,
        structureSummary: { sittingCount: 2, currentCount: 0, historicalCount: 0 },
      };
      const opened = await openPaperJournal(
        vault,
        { course: 'COURSEA', fingerprint: FP, plan: PLAN, extent },
        { now },
      );
      expect(opened.journal.extent).toEqual(extent);
      const listed = await listPaperJournals(vault);
      expect(listed[0]?.record.extent).toEqual(extent);
      const other = await open(FP, 'COURSEB');
      expect(other.journal).not.toHaveProperty('extent');
    });

    it('the recorded length is not part of the reuse check: the same fingerprint and plan resume whatever length is offered', async () => {
      const first = await openPaperJournal(
        vault,
        {
          course: 'COURSEA',
          fingerprint: FP,
          plan: PLAN,
          extent: { slotCount: 6, structureSummary: null },
        },
        { now },
      );
      const again = await openPaperJournal(
        vault,
        {
          course: 'COURSEA',
          fingerprint: FP,
          plan: PLAN,
          extent: {
            slotCount: 4,
            structureSummary: { sittingCount: 3, currentCount: 0, historicalCount: 0 },
          },
        },
        { now },
      );
      expect(again.decision).toBe('resumed');
      expect(again.journal.id).toBe(first.journal.id);
      expect(again.journal.extent).toEqual({ slotCount: 6, structureSummary: null });
    });
  });

  describe('running: an outage retains the unfinished paper', () => {
    it('lands every slot in plan order and is ready, giving a dependent its dependency item', async () => {
      const { journal } = await open();
      const g = scripted({});
      const result = await runPaperJournal(vault, journal.id, { generate: g.generate }, { now });
      expect(result.kind).toBe('ready');
      expect(g.calls.map((c) => c.slot.slotId)).toEqual(['slot-0', 'slot-1', 'slot-2']);
      expect(g.calls[1]?.dependencyItems.map((i) => i.slotId)).toEqual(['slot-0']);
      expect(g.calls[0]?.dependencyItems).toEqual([]);
    });

    it('retries an unavailable slot once, then lands it', async () => {
      const { journal } = await open();
      const g = scripted({ 'slot-0': [OUTAGE, { status: 'generated', item: item('slot-0') }] });
      const result = await runPaperJournal(vault, journal.id, { generate: g.generate }, { now });
      expect(result.kind).toBe('ready');
      expect(g.calls.filter((c) => c.slot.slotId === 'slot-0')).toHaveLength(2);
    });

    it('after one retry keeps the slot OWED, never empty: the run stops, nothing later is called, the paper is not created', async () => {
      const { journal } = await open();
      const g = scripted({ 'slot-1': [OUTAGE] });
      const result = await runPaperJournal(vault, journal.id, { generate: g.generate }, { now });
      expect(result.kind).toBe('unfinished');
      if (result.kind !== 'unfinished') return;
      expect(result.owedSlotIds).toEqual(['slot-1', 'slot-2']);
      // slot-0 landed; slot-1 tried twice (one retry); slot-2 never called (the outage stops the run).
      expect(g.calls.map((c) => c.slot.slotId)).toEqual(['slot-0', 'slot-1', 'slot-1']);
      expect(result.journal.outcomes['slot-0']?.status).toBe('landed');
      expect(result.journal.outcomes['slot-1']).toEqual({ status: 'owed', attempts: 2 });
      expect(result.journal.outcomes['slot-2']).toBeUndefined();
      expect(await listPaperRecords(vault)).toEqual([]);
      await expect(
        finalizePaperFromJournal(
          vault,
          journal.id,
          { asOf: '2026-09-29', compositionAccount: ACCOUNT, planTimeEmptySlots: [] },
          { now },
        ),
      ).rejects.toBeInstanceOf(PaperJournalUnfinishedError);
      expect(await listPaperRecords(vault)).toEqual([]);
    });

    it('a generator that throws is an outage, not a crash and not a refusal', async () => {
      const { journal } = await open();
      const result = await runPaperJournal(
        vault,
        journal.id,
        {
          generate: async () => {
            throw new Error('socket closed');
          },
        },
        { now },
      );
      expect(result.kind).toBe('unfinished');
      if (result.kind !== 'unfinished') return;
      expect(result.journal.outcomes['slot-0']).toEqual({ status: 'owed', attempts: 2 });
    });

    it('the next request drafts only the missing slots and finishes the paper (schema 2, journal linked)', async () => {
      const first = await open();
      const g1 = scripted({ 'slot-1': [OUTAGE] });
      await runPaperJournal(vault, first.journal.id, { generate: g1.generate }, { now });

      const resumed = await open();
      expect(resumed.decision).toBe('resumed');
      expect(paperJournalOwedSlotIds(resumed.journal)).toEqual(['slot-1', 'slot-2']);

      const g2 = scripted({});
      const done = await runPaperJournal(
        vault,
        resumed.journal.id,
        { generate: g2.generate },
        { now },
      );
      expect(done.kind).toBe('ready');
      // Only the missing slots were drafted; slot-0's landed item was reused, not regenerated.
      expect(g2.calls.map((c) => c.slot.slotId)).toEqual(['slot-1', 'slot-2']);
      expect(g2.calls[0]?.dependencyItems.map((i) => i.slotId)).toEqual(['slot-0']);

      const paper = await finalizePaperFromJournal(
        vault,
        resumed.journal.id,
        { asOf: '2026-09-29', compositionAccount: ACCOUNT, planTimeEmptySlots: [] },
        { now },
      );
      expect(paper.items.map((i) => i.slotId)).toEqual(['slot-0', 'slot-1', 'slot-2']);
      expect(paper.completion).toEqual({ status: 'complete' });
      expect(paper.journalId).toBe(resumed.journal.id);
      expect(paper.schemaVersion).toBe(2);
      const journals = await listPaperJournals(vault);
      expect(journals[0]?.record.status).toBe('completed');
      expect(journals[0]?.record.paperId).toBe(paper.id);
    });

    it('a changed fingerprint on the next request discards the journal: the paper is composed from the state when she asks', async () => {
      const first = await open();
      await runPaperJournal(
        vault,
        first.journal.id,
        { generate: scripted({ 'slot-1': [OUTAGE] }).generate },
        { now },
      );
      const next = await open({ ...FP, sourceVersions: 'src-2' });
      expect(next.decision).toBe('discarded-and-fresh');
      const g = scripted({});
      await runPaperJournal(vault, next.journal.id, { generate: g.generate }, { now });
      expect(g.calls.map((c) => c.slot.slotId)).toEqual(['slot-0', 'slot-1', 'slot-2']);
    });

    it('refuses to mix prompt versions inside one paper: a resumed call answering at another version discards the journal', async () => {
      const first = await open();
      await runPaperJournal(
        vault,
        first.journal.id,
        { generate: scripted({ 'slot-1': [OUTAGE] }).generate },
        { now },
      );
      const resumed = await open();
      const g = scripted({ 'slot-1': [{ status: 'generated', item: item('slot-1', 'v2') }] });
      const result = await runPaperJournal(
        vault,
        resumed.journal.id,
        { generate: g.generate },
        { now },
      );
      expect(result.kind).toBe('authoring-spec-changed');
      const journals = await listPaperJournals(vault);
      const stored = journals.find((j) => j.record.id === resumed.journal.id)?.record;
      expect(stored?.status).toBe('discarded');
      expect(stored?.discard).toEqual({ reason: 'authoring-spec-changed' });
      expect(stored?.outcomes['slot-1']?.status).not.toBe('landed');
    });
  });

  describe('a refusal and a dependency are facts about her material, recorded as such', () => {
    it('records a generator refusal as an empty slot and ends its stated dependents empty without calling for them', async () => {
      const { journal } = await open();
      const g = scripted({ 'slot-0': [{ status: 'refused', reason: 'grounding-refused' }] });
      const result = await runPaperJournal(vault, journal.id, { generate: g.generate }, { now });
      expect(result.kind).toBe('ready');
      if (result.kind !== 'ready') return;
      expect(result.journal.outcomes['slot-0']).toMatchObject({
        status: 'empty',
        reasonCode: 'generator-refused',
      });
      expect(result.journal.outcomes['slot-1']).toMatchObject({
        status: 'empty',
        reasonCode: 'depends-on-empty-part',
        causedBySlotId: 'slot-0',
      });
      expect(g.calls.map((c) => c.slot.slotId)).toEqual(['slot-0', 'slot-2']);
    });

    it('finishes as a qualified partial that names its gaps, merging plan-time empties, and keeps outage out of it', async () => {
      const { journal } = await open();
      const g = scripted({ 'slot-0': [{ status: 'refused', reason: 'grounding-refused' }] });
      await runPaperJournal(vault, journal.id, { generate: g.generate }, { now });
      const planTime: PaperEmptySlot = {
        slotId: 'slot-9',
        conceptKey: 'k9',
        conceptName: 'c9',
        reasonCode: 'demand-unsupported',
        reason: 'no generator serves the demand',
      };
      const paper = await finalizePaperFromJournal(
        vault,
        journal.id,
        { asOf: '2026-09-29', compositionAccount: ACCOUNT, planTimeEmptySlots: [planTime] },
        { now },
      );
      expect(paper.completion).toEqual({
        status: 'qualified-partial',
        gaps: ['capability', 'source'],
      });
      expect(paper.items.map((i) => i.slotId)).toEqual(['slot-2']);
      expect(paper.emptySlots.map((e) => [e.slotId, e.reasonCode])).toEqual([
        ['slot-9', 'demand-unsupported'],
        ['slot-0', 'generator-refused'],
        ['slot-1', 'depends-on-empty-part'],
      ]);
      expect(paper.emptySlots.find((e) => e.slotId === 'slot-1')?.causedBySlotId).toBe('slot-0');
      // No outage code exists to appear here.
      expect(paper.emptySlots.some((e) => (e.reasonCode as string).includes('unavailable'))).toBe(
        false,
      );
    });
  });

  describe('finishing is idempotent', () => {
    it('a second finish returns the same paper and mints no second one', async () => {
      const { journal } = await open();
      await runPaperJournal(vault, journal.id, { generate: scripted({}).generate }, { now });
      const input = { asOf: '2026-09-29', compositionAccount: ACCOUNT, planTimeEmptySlots: [] };
      const a = await finalizePaperFromJournal(vault, journal.id, input, { now });
      const b = await finalizePaperFromJournal(vault, journal.id, input, { now });
      expect(b.id).toBe(a.id);
      expect(await listPaperRecords(vault)).toHaveLength(1);
    });

    it('a paper written just before a crash is found by its journal link, not minted again', async () => {
      const { journal } = await open();
      await runPaperJournal(vault, journal.id, { generate: scripted({}).generate }, { now });
      const orphan = await createPaper(vault, {
        course: 'COURSEA',
        asOf: '2026-09-29',
        compositionAccount: ACCOUNT,
        items: [item('slot-0')],
        emptySlots: [],
        journalId: journal.id,
      });
      const paper = await finalizePaperFromJournal(
        vault,
        journal.id,
        { asOf: '2026-09-29', compositionAccount: ACCOUNT, planTimeEmptySlots: [] },
        { now },
      );
      expect(paper.id).toBe(orphan.id);
      expect(await listPaperRecords(vault)).toHaveLength(1);
      expect((await listPaperJournals(vault))[0]?.record.status).toBe('completed');
    });

    it('refuses to finish a discarded journal', async () => {
      const { journal } = await open();
      await discardPaperJournal(vault, journal.id, { reason: 'abandoned' }, { now });
      await expect(
        finalizePaperFromJournal(
          vault,
          journal.id,
          { asOf: '2026-09-29', compositionAccount: ACCOUNT, planTimeEmptySlots: [] },
          { now },
        ),
      ).rejects.toThrow(/discarded/);
    });
  });

  it('journal files are never read as papers, and papers are never read as journals', async () => {
    const { journal } = await open();
    await runPaperJournal(vault, journal.id, { generate: scripted({}).generate }, { now });
    expect(await listPaperRecords(vault)).toEqual([]);
    await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-29',
      compositionAccount: ACCOUNT,
      items: [],
      emptySlots: [],
    });
    expect(await listPaperJournals(vault)).toHaveLength(1);
  });
});

describe('applyPaperJournalEvent — the pure fold', () => {
  const opened = () =>
    applyPaperJournalEvent(undefined, {
      kind: 'opened',
      schemaVersion: 1,
      eventId: 'e0',
      timestamp: '2026-09-29T00:00:00.000Z',
      journalId: 'paper-journal-key1:j',
      course: 'COURSEA',
      fingerprint: FP,
      blueprintDigest: 'digest',
      plan: PLAN,
    });

  it('carries the length an opened event records, and adds none when it records none', () => {
    const extent = { slotCount: 4, structureSummary: null };
    const withLength = applyPaperJournalEvent(undefined, {
      kind: 'opened',
      schemaVersion: 1,
      eventId: 'e0',
      timestamp: '2026-09-29T00:00:00.000Z',
      journalId: 'paper-journal-key1:k',
      course: 'COURSEA',
      fingerprint: FP,
      blueprintDigest: 'digest',
      plan: PLAN,
      extent,
    });
    expect(withLength?.extent).toEqual(extent);
    expect(opened()).not.toHaveProperty('extent');
  });

  const at = (eventId: string) => ({
    schemaVersion: 1 as const,
    eventId,
    timestamp: '2026-09-29T00:00:01.000Z',
    journalId: 'paper-journal-key1:j',
  });

  it('drops an event against no journal, never inventing one', () => {
    expect(
      applyPaperJournalEvent(undefined, { kind: 'discarded', ...at('e'), reason: 'abandoned' }),
    ).toBeUndefined();
  });

  it('a landed or empty slot is final: a later owed or landed event changes nothing', () => {
    const j0 = opened();
    const j1 = applyPaperJournalEvent(j0, {
      kind: 'slot-landed',
      ...at('e1'),
      slotId: 'slot-0',
      item: item('slot-0'),
    });
    const j2 = applyPaperJournalEvent(j1, {
      kind: 'slot-owed',
      ...at('e2'),
      slotId: 'slot-0',
      attempts: 2,
    });
    const j3 = applyPaperJournalEvent(j2, {
      kind: 'slot-landed',
      ...at('e3'),
      slotId: 'slot-0',
      item: item('slot-0', 'v9'),
    });
    expect(j3?.outcomes['slot-0']).toEqual({ status: 'landed', item: item('slot-0') });
  });

  it('an owed slot is replaced by a later landed one', () => {
    const j1 = applyPaperJournalEvent(opened(), {
      kind: 'slot-owed',
      ...at('e1'),
      slotId: 'slot-0',
      attempts: 2,
    });
    const j2 = applyPaperJournalEvent(j1, {
      kind: 'slot-landed',
      ...at('e2'),
      slotId: 'slot-0',
      item: item('slot-0'),
    });
    expect(j2?.outcomes['slot-0']?.status).toBe('landed');
  });

  it('ignores a slot that is not in the plan, and every event once completed or discarded', () => {
    const j1 = applyPaperJournalEvent(opened(), {
      kind: 'slot-landed',
      ...at('e1'),
      slotId: 'nope',
      item: item('nope'),
    });
    expect(j1?.outcomes).toEqual({});
    const done = applyPaperJournalEvent(j1, {
      kind: 'completed',
      ...at('e2'),
      paperId: 'paper-key1:p',
    });
    const after = applyPaperJournalEvent(done, {
      kind: 'slot-landed',
      ...at('e3'),
      slotId: 'slot-0',
      item: item('slot-0'),
    });
    expect(after?.status).toBe('completed');
    expect(after?.outcomes).toEqual({});
    const gone = applyPaperJournalEvent(opened(), {
      kind: 'discarded',
      ...at('e4'),
      reason: 'reuse-incompatible',
      changed: ['scope'],
    });
    expect(
      applyPaperJournalEvent(gone, { kind: 'completed', ...at('e5'), paperId: 'p' })?.status,
    ).toBe('discarded');
  });
});

describe('isPaperJournalRecord', () => {
  it('rejects junk and a paper record', () => {
    expect(isPaperJournalRecord(null)).toBe(false);
    expect(isPaperJournalRecord({})).toBe(false);
    expect(
      isPaperJournalRecord({
        id: 'x',
        course: 'c',
        items: [],
        compositionAccount: {},
        emptySlots: [],
        responses: [],
        handoffs: [],
        explanationResults: [],
        status: 'active',
        schemaVersion: 1,
      }),
    ).toBe(false);
  });

  it('accepts a journal with no recorded length or a well-formed one, and refuses a malformed one', () => {
    const journal = {
      id: 'paper-journal-key1:j',
      course: 'COURSEA',
      createdAt: '2026-09-29T00:00:00.000Z',
      updatedAt: '2026-09-29T00:00:00.000Z',
      fingerprint: FP,
      blueprintDigest: 'digest',
      plan: PLAN,
      outcomes: {},
      status: 'open',
      schemaVersion: 1,
    };
    expect(isPaperJournalRecord(journal)).toBe(true);
    expect(
      isPaperJournalRecord({ ...journal, extent: { slotCount: 6, structureSummary: null } }),
    ).toBe(true);
    expect(
      isPaperJournalRecord({
        ...journal,
        extent: {
          slotCount: 4,
          structureSummary: { sittingCount: 1, currentCount: 0, historicalCount: 0 },
        },
      }),
    ).toBe(true);
    for (const extent of [
      null,
      { slotCount: 0, structureSummary: null },
      { slotCount: 2.5, structureSummary: null },
      { slotCount: 4 },
      { slotCount: 4, structureSummary: { sittingCount: 1 } },
    ]) {
      expect(isPaperJournalRecord({ ...journal, extent })).toBe(false);
    }
  });
});

describe('classifyPaperSlotWorkerResult — read from the real Worker envelope (olea-contracts)', () => {
  it('a success with a stamped prompt version is generated, response kept whole', () => {
    const body = {
      ok: true,
      stamp: { contractVersion: 2, promptVersion: 'v3', modelId: 'm' },
      result: { questions: [] },
    };
    expect(classifyPaperSlotWorkerResult(body)).toEqual({
      status: 'generated',
      promptVersion: 'v3',
      response: body,
    });
  });

  it('only a grounding refusal is a refusal (a fact about her material)', () => {
    expect(
      classifyPaperSlotWorkerResult({ ok: false, code: 'grounding-refused', message: 'm' }),
    ).toEqual({
      status: 'refused',
      reason: 'grounding-refused',
    });
  });

  it('every other error is an outage, never a verdict about her material', () => {
    for (const code of [
      'upstream-error',
      'internal-error',
      'quota-exceeded',
      'unauthenticated',
      'update-required',
      'invalid-request',
    ]) {
      expect(classifyPaperSlotWorkerResult({ ok: false, code, message: 'm' })).toEqual({
        status: 'unavailable',
        reason: code,
      });
    }
  });

  it('a malformed body, a success with no stamp, and the retired success/error shape are all outages', () => {
    expect(classifyPaperSlotWorkerResult(null).status).toBe('unavailable');
    expect(classifyPaperSlotWorkerResult('x').status).toBe('unavailable');
    expect(classifyPaperSlotWorkerResult({ ok: true, result: {} })).toEqual({
      status: 'unavailable',
      reason: 'no-stamp',
    });
    expect(
      classifyPaperSlotWorkerResult({ ok: true, stamp: { promptVersion: '' }, result: {} }).status,
    ).toBe('unavailable');
    // The shape today's paper item port reads is not the contract's envelope; it must never classify as a refusal.
    expect(
      classifyPaperSlotWorkerResult({ success: false, error: { code: 'grounding-refused' } })
        .status,
    ).toBe('unavailable');
  });
});

// ol-egov.141.89.7.93 ([D-560], David 2026-10-21: "The journal stores the paper's structure in a
// new version. An unfinished paper always resumes on its own structure, even if her past-paper
// reading changes. An old journal reads as flat and resumes flat."). Scenarios: features/F4-oracle.md,
// "an unfinished structured paper resumes on its own structure after her reading changes", "a
// journal written before the structure was recorded reads as flat" and "an unfinished flat paper
// resumes on its flat plan after this change", tagged `@auto:core/oracle/paper-journal.spec`.
// Synthetic ids and labels only.
const STRUCTURE: PaperStructuredShape = {
  formatVersion: PAPER_STRUCTURE_FORMAT_VERSION,
  structureBasis: 'current-or-transitional',
  structureSlotCount: 3,
  sections: [],
  groups: [
    {
      groupId: 'q1',
      kind: 'parent-question',
      sectionId: null,
      label: 'Question 1',
      slotIds: ['slot-0', 'slot-1'],
      stimulusNeed: { status: 'not-needed' },
      heldStimulus: null,
    },
    {
      groupId: 'q2',
      kind: 'shared-stimulus',
      sectionId: null,
      label: 'Question 2',
      slotIds: ['slot-2'],
      stimulusNeed: { status: 'needed', form: 'table' },
      heldStimulus: null,
    },
  ],
  parts: [
    {
      slotId: 'slot-0',
      groupId: 'q1',
      label: '1(a)',
      questionForm: 'short answer',
      marks: { status: 'stated', value: 2 },
      dependsOn: { status: 'unknown' },
      demand: { status: 'not-read' },
    },
    {
      slotId: 'slot-1',
      groupId: 'q1',
      label: '1(b)',
      questionForm: 'short answer',
      marks: { status: 'unknown' },
      dependsOn: { status: 'stated', onSlotIds: ['slot-0'] },
      demand: { status: 'not-read' },
    },
    {
      slotId: 'slot-2',
      groupId: 'q2',
      label: '2',
      questionForm: 'short answer',
      marks: { status: 'stated', value: 3 },
      dependsOn: { status: 'unknown' },
      demand: { status: 'not-read' },
    },
  ],
  totalMarks: { status: 'unknown' },
  timeAllowance: { status: 'unknown' },
};

describe('the journal records the structure its plan was made on ([D-560])', () => {
  let root: string;
  let vault: FolderSource;
  let tick = 0;
  const now = () => `2026-10-21T00:00:${String(tick++).padStart(2, '0')}.000Z`;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-paper-journal-structure-'));
    vault = new FolderSource(root);
    tick = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const openWith = (structure?: PaperStructuredShape) =>
    openPaperJournal(
      vault,
      { course: 'COURSEA', fingerprint: FP, plan: PLAN, ...(structure ? { structure } : {}) },
      { now },
    );

  it('records the structure at version 2 and reads it back whole; a flat journal stays version 1 with none', async () => {
    const structured = await openWith(STRUCTURE);
    expect(structured.journal.schemaVersion).toBe(PAPER_JOURNAL_STRUCTURED_SCHEMA_VERSION);
    const listed = await listPaperJournals(vault);
    expect(listed[0]?.record.structure).toEqual(STRUCTURE);
    await discardPaperJournal(vault, structured.journal.id, { reason: 'abandoned' }, { now });

    const flat = await openWith();
    expect(flat.journal.schemaVersion).toBe(PAPER_JOURNAL_SCHEMA_VERSION);
    expect(flat.journal).not.toHaveProperty('structure');
  });

  it('resumes only on the structure it recorded: the same fingerprint over another structure, or none, is named a structure change', async () => {
    const first = await openWith(STRUCTURE);
    const again = await openWith(STRUCTURE);
    expect(again.decision).toBe('resumed');
    expect(again.journal.id).toBe(first.journal.id);

    const flat = await openWith();
    expect(flat.decision).toBe('discarded-and-fresh');
    expect(flat.discarded).toEqual([{ journalId: first.journal.id, changed: ['structure'] }]);

    const other = await openWith({
      ...STRUCTURE,
      groups: STRUCTURE.groups.map((g) => ({ ...g, label: `${g.label}, another sitting` })),
    });
    expect(other.decision).toBe('discarded-and-fresh');
    expect(other.discarded).toEqual([{ journalId: flat.journal.id, changed: ['structure'] }]);
  });

  it('a journal written by the earlier version, with no recorded structure, reads as flat and resumes flat', async () => {
    const id = `${OPAQUE_PAPER_JOURNAL_ID_PREFIX}:earlier`;
    const earlier = {
      id,
      course: 'COURSEA',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      fingerprint: FP,
      blueprintDigest: 'digest',
      plan: PLAN,
      outcomes: { 'slot-0': { status: 'landed', item: item('slot-0') } },
      status: 'open',
      schemaVersion: 1,
    };
    await vault.write(paperJournalPath(id), `${JSON.stringify(earlier, null, 2)}\n`);
    const listed = await listPaperJournals(vault);
    expect(listed.map((entry) => entry.record.id)).toEqual([id]);
    expect(listed[0]?.record.structure).toBeUndefined();

    const resumed = await openWith();
    expect(resumed.decision).toBe('resumed');
    expect(resumed.journal.id).toBe(id);
    expect(paperJournalOwedSlotIds(resumed.journal)).toEqual(['slot-1', 'slot-2']);
  });

  it('finishes into a structured paper record carrying the structure the journal recorded', async () => {
    const opened = await openWith(STRUCTURE);
    const g = scripted({});
    const run = await runPaperJournal(vault, opened.journal.id, { generate: g.generate }, { now });
    expect(run.kind).toBe('ready');
    expect(g.calls[1]?.dependencyItems.map((i) => i.slotId)).toEqual(['slot-0']);
    const paper = await finalizePaperFromJournal(
      vault,
      opened.journal.id,
      { asOf: '2026-10-21', compositionAccount: ACCOUNT, planTimeEmptySlots: [] },
      { now },
    );
    expect(paper.structure).toEqual(STRUCTURE);
    expect(paper.schemaVersion).toBe(2);
    expect(paper.completion).toEqual({ status: 'complete' });
  });

  it('refuses a journal whose recorded structure is not the shape it claims, or disagrees with its own plan', async () => {
    const base = {
      id: `${OPAQUE_PAPER_JOURNAL_ID_PREFIX}:j`,
      course: 'COURSEA',
      createdAt: '2026-10-21T00:00:00.000Z',
      updatedAt: '2026-10-21T00:00:00.000Z',
      fingerprint: FP,
      blueprintDigest: 'digest',
      plan: PLAN,
      outcomes: {},
      status: 'open',
      schemaVersion: 2,
      structure: STRUCTURE,
    };
    expect(isPaperJournalRecord(base)).toBe(true);
    const { structure: _structure, ...withoutStructure } = base;
    const refused: unknown[] = [
      withoutStructure,
      { ...base, schemaVersion: 1 },
      { ...base, structure: { ...STRUCTURE, formatVersion: 'paper-structure-v9' } },
      { ...base, structure: { ...STRUCTURE, groups: STRUCTURE.groups.slice(1) } },
      {
        ...base,
        structure: { ...STRUCTURE, parts: STRUCTURE.parts.map((p) => ({ ...p, demand: {} })) },
      },
      {
        ...base,
        plan: PLAN.map((slot) =>
          slot.slotId === 'slot-1' ? { ...slot, dependsOnSlotIds: [] } : slot,
        ),
      },
      { ...base, plan: [...PLAN, { ...PLAN[0], slotId: 'slot-9' }] },
    ];
    for (const value of refused) expect(isPaperJournalRecord(value)).toBe(false);

    // On disk, a refused journal is never resumed: the next request opens a fresh one.
    await vault.write(paperJournalPath(base.id), JSON.stringify(withoutStructure));
    expect(await listPaperJournals(vault)).toEqual([]);
    expect((await openWith(STRUCTURE)).decision).toBe('fresh');
  });
});
