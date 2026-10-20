import { describe, expect, it } from 'vitest';
import type { AssessSupportOutcome } from '../retrieval/groundedContext.js';
import {
  checkPaperBlueprintSupport,
  checkPaperSlotSupport,
  type PaperSlotSupportPort,
  supportRefusedEmptySlot,
} from './paper-support.js';
import { PAPER_DEMANDS, type PaperBlueprintSlot, type PaperDemand } from './paper-types.js';

// Scenarios: olea-service/features/F4-oracle.md, F4.11 (`[D-438]`), the support-check block, tagged
// `@auto:core/oracle/paper-support.spec` (T14, T15). Synthetic ids only.

function slot(
  slotId: string,
  intendedDemand: PaperDemand = 'recall-a-fact',
  sourceChunks: readonly string[] = ['grounding text'],
): PaperBlueprintSlot {
  return {
    slotId,
    conceptKey: `key-${slotId}`,
    conceptName: `Concept ${slotId}`,
    formatClass: 'recall-style',
    intendedDemand,
    taskId: 'quiz.generate.v1',
    groundingTier: 'T2',
    groundingLabel: 'covered-by-her-material',
    heldSourceKind: 'notes',
    heldSourceId: 's1',
    sourceChunks,
    weight: 1,
    emphasised: false,
  };
}

const assessed = (
  verdict: 'sufficient' | 'partial' | 'insufficient' | 'conflicting',
): AssessSupportOutcome => ({
  status: 'assessed',
  supported: verdict === 'sufficient',
  reason: 'r',
  verdict,
});

function scripted(...outcomes: (AssessSupportOutcome | 'throw')[]) {
  const calls: unknown[] = [];
  const port: PaperSlotSupportPort = async (request) => {
    calls.push(request);
    const next = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    if (next === 'throw' || next === undefined) throw new Error('down');
    return next;
  };
  return { port, calls };
}

describe('T14 the per-slot support check', () => {
  it.each([
    ['sufficient', { kind: 'supported' }],
    ['partial', { kind: 'refused', supportRefusal: 'not-enough-in-notes', judged: true }],
    ['insufficient', { kind: 'refused', supportRefusal: 'not-enough-in-notes', judged: true }],
    ['conflicting', { kind: 'refused', supportRefusal: 'notes-disagree', judged: true }],
  ] as const)('a %s verdict lands in its own row', async (verdict, expected) => {
    const { port, calls } = scripted(assessed(verdict));
    expect(await checkPaperSlotSupport(slot('a'), port)).toEqual(expected);
    expect(calls).toHaveLength(1);
  });

  it('a judge that abstained is could-not-decide, one call, no retry', async () => {
    const { port, calls } = scripted({ status: 'could-not-decide' });
    expect(await checkPaperSlotSupport(slot('a'), port)).toEqual({
      kind: 'refused',
      supportRefusal: 'could-not-decide',
      judged: true,
    });
    expect(calls).toHaveLength(1);
  });

  it('the empty package is decided by code: nothing-retrieved, no port call', async () => {
    for (const chunks of [[], ['', '   ']]) {
      const { port, calls } = scripted(assessed('sufficient'));
      expect(await checkPaperSlotSupport(slot('a', 'recall-a-fact', chunks), port)).toEqual({
        kind: 'refused',
        supportRefusal: 'nothing-retrieved',
        judged: false,
      });
      expect(calls).toHaveLength(0);
    }
  });

  it('a port that reports an empty package is nothing-retrieved, not judged', async () => {
    const { port } = scripted({ status: 'insufficient-evidence' });
    expect(await checkPaperSlotSupport(slot('a'), port)).toEqual({
      kind: 'refused',
      supportRefusal: 'nothing-retrieved',
      judged: false,
    });
  });

  it('a service failure is retried once, and a recovery on the retry is read normally', async () => {
    const { port, calls } = scripted({ status: 'unavailable' }, assessed('sufficient'));
    expect(await checkPaperSlotSupport(slot('a'), port)).toEqual({ kind: 'supported' });
    expect(calls).toHaveLength(2);
  });

  it.each([[{ status: 'unavailable' } as const], ['throw' as const]])(
    'a service failure twice (%s) is owed after exactly two calls, never a refusal',
    async (failure) => {
      const { port, calls } = scripted(failure);
      expect(await checkPaperSlotSupport(slot('a'), port)).toEqual({ kind: 'owed', attempts: 2 });
      expect(calls).toHaveLength(2);
    },
  );

  it('the request carries the slot demand and chunks and nothing else', async () => {
    const { port, calls } = scripted(assessed('sufficient'));
    await checkPaperSlotSupport(slot('a', 'calculate'), port);
    expect(calls[0]).toEqual({
      slotId: 'a',
      conceptName: 'Concept a',
      intendedDemand: 'calculate',
      sourceChunks: ['grounding text'],
    });
  });

  it('a blueprint is split into supported, refused and owed, in order, with owed never an empty slot', async () => {
    const outcomes: Record<string, AssessSupportOutcome | 'throw'> = {
      a: assessed('sufficient'),
      b: assessed('conflicting'),
      c: 'throw',
      d: { status: 'could-not-decide' },
    };
    const port: PaperSlotSupportPort = async (r) => {
      const o = outcomes[r.slotId];
      if (o === 'throw' || o === undefined) throw new Error('down');
      return o;
    };
    const result = await checkPaperBlueprintSupport(
      { slots: [slot('a'), slot('b'), slot('c'), slot('d'), slot('e', 'recall-a-fact', [])] },
      port,
    );
    expect(result.supported.map((s) => s.slotId)).toEqual(['a']);
    expect(result.refused.map((e) => [e.slotId, e.supportRefusal])).toEqual([
      ['b', 'notes-disagree'],
      ['d', 'could-not-decide'],
      ['e', 'nothing-retrieved'],
    ]);
    expect(result.owed).toEqual([{ slotId: 'c', attempts: 2 }]);
    expect(result.refused.some((e) => e.slotId === 'c')).toBe(false);
  });
});

describe('T15 a refused slot keeps its original demand', () => {
  const refusals = [
    assessed('partial'),
    assessed('insufficient'),
    assessed('conflicting'),
    { status: 'could-not-decide' } as const,
    { status: 'insufficient-evidence' } as const,
  ];

  it.each(PAPER_DEMANDS)('every refusal of a %s slot keeps %s', async (demand) => {
    for (const outcome of refusals) {
      const { port } = scripted(outcome);
      const result = await checkPaperBlueprintSupport({ slots: [slot('x', demand)] }, port);
      expect(result.refused).toHaveLength(1);
      const empty = result.refused[0];
      expect(empty?.intendedDemand).toBe(demand);
      expect(empty?.reasonCode).toBe('source-support-refused');
      expect(empty?.supportRefusal).toBeDefined();
    }
  });

  it('the empty package keeps the demand too, and a refusal never reads recall unless it was recall', async () => {
    const { port } = scripted(assessed('sufficient'));
    const result = await checkPaperBlueprintSupport(
      { slots: PAPER_DEMANDS.map((d) => slot(d, d, [])) },
      port,
    );
    expect(result.refused.map((e) => e.intendedDemand)).toEqual([...PAPER_DEMANDS]);
  });

  it('builds the empty slot with its detail and no free content', () => {
    const e = supportRefusedEmptySlot(slot('x', 'calculate'), 'notes-disagree');
    expect(e).toMatchObject({
      reasonCode: 'source-support-refused',
      supportRefusal: 'notes-disagree',
      intendedDemand: 'calculate',
    });
  });
});
