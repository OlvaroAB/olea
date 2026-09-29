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
  type PaperJournalPlanSlot,
  PaperJournalUnfinishedError,
  type PaperSlotGenerationOutcome,
  type PaperSlotGenerationRequest,
  paperJournalOwedSlotIds,
  runPaperJournal,
} from './paper-journal.js';
import {
  createPaper,
  listPaperRecords,
  PAPER_STORE_FOLDER,
  type PaperCompositionAccount,
} from './paper-store.js';
import type { PaperEmptySlot, PaperReuseFingerprint } from './paper-types.js';

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
