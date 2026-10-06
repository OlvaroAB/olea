/**
 * `scope-alignment-plan.ts` tests (`ol-egov.141.89.7.52`). Synthetic ids and wording only.
 * Scenarios: F4.1, "the batch plan puts every pair in exactly one call or in the omission ledger",
 * "aggregation keeps aligned, pending, cannot tell and not aligned apart", "a digest moves exactly
 * when what it covers moves".
 */

import { describe, expect, it } from 'vitest';
import {
  type AlignPair,
  AlignPlanError,
  aggregateAlignConcept,
  alignBatchPlanDigest,
  alignCoverageForCall,
  alignDigests,
  alignRevisionCoverage,
  assertAlignLedgerComplete,
  assignAlignHandles,
  type BatchPlan,
  chooseAlignDescription,
  cutAlignDescription,
  type FrozenConfigurationInput,
  planAlignBatches,
} from './scope-alignment-plan.js';

const concepts = (n: number, stableFrom = 0) =>
  Array.from({ length: n }, (_, i) => ({
    conceptId: `k${i + 1}`,
    handle: i >= stableFrom ? `c${String(i + 1).padStart(3, '0')}` : null,
  }));
const records = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ recordId: `r${i + 1}`, passageRefs: [`u${i}`] }));

describe('handles', () => {
  it('follow the sorted stable keys and skip an unstable one', () => {
    const map = assignAlignHandles([
      { conceptId: 'b', key: 'concept-key1:b', stableKey: true },
      { conceptId: 'a', key: 'concept-key1:a', stableKey: true },
      { conceptId: 'p', key: 'concept-prov1:p', stableKey: false },
    ]);
    expect(map.get('a')).toBe('c001');
    expect(map.get('b')).toBe('c002');
    expect(map.get('p')).toBeNull();
  });

  it('refuses two concepts sharing one key', () => {
    expect(() =>
      assignAlignHandles([
        { conceptId: 'a', key: 'k', stableKey: true },
        { conceptId: 'b', key: 'k', stableKey: true },
      ]),
    ).toThrow(AlignPlanError);
  });
});

describe('descriptions', () => {
  it('cuts at a sentence end inside the cap and reports the full length', () => {
    const full = 'One short. Two is longer than the cap allows here.';
    const cut = cutAlignDescription(full, 20);
    expect(cut.text).toBe('One short.');
    expect(cut.cutAt).toBe('sentence-end');
    expect(cut.truncated?.fullLength).toBe(full.length);
  });

  it('prefers her definition, then the passage, then none, and never a failed check', () => {
    expect(
      chooseAlignDescription({ definition: 'Mine.', definitionFoundInSource: true }, 400)
        .description?.source,
    ).toBe('her-definition');
    expect(
      chooseAlignDescription(
        {
          definition: 'Mine.',
          definitionSourceIsAssessment: true,
          anchor: { text: 'Seen.', sourceIsAssessment: false, foundInSource: true },
        },
        400,
      ).description?.source,
    ).toBe('introducing-passage');
    expect(chooseAlignDescription({}, 400).descriptionNone).toBe('no-source-recorded');
    expect(
      chooseAlignDescription({ definition: 'Mine.', definitionFoundInSource: false }, 400)
        .descriptionNone,
    ).toBe('source-failed-check');
  });
});

describe('the batch plan', () => {
  const plan = (over: Partial<Parameters<typeof planAlignBatches>[0]> = {}) =>
    planAlignBatches({
      records: records(3),
      concepts: concepts(5),
      passageBudget: 77,
      conceptBudget: 2,
      callCap: 8,
      batchPrefix: '',
      ...over,
    });

  it('splits concepts by budget, names calls b1.., and accounts for every pair', () => {
    const p = plan();
    expect(p.calls.map((c) => c.batchId)).toEqual(['b1', 'b2', 'b3']);
    expect(p.calls.map((c) => c.conceptIds.length)).toEqual([2, 2, 1]);
    expect(p.omitted).toEqual([]);
    expect(assertAlignLedgerComplete(p, records(3), concepts(5))).toBe(true);
  });

  it('omits pairs past the call cap as run-cap, and an unstable concept as no-stable-key', () => {
    const p = plan({ concepts: concepts(5, 1), callCap: 1 });
    const reasons = new Set(p.omitted.map((o) => o.reason));
    expect(reasons).toEqual(new Set(['run-cap', 'no-stable-key']));
    expect(p.calls).toHaveLength(1);
    expect(p.notMade.length).toBeGreaterThan(0);
  });

  it('never splits a group, and omits one over the budget as group-over-budget', () => {
    const recs = [
      { recordId: 'p1', groupId: 'g', passageRefs: ['u1', 'u2'] },
      { recordId: 'p2', groupId: 'g', passageRefs: ['u1', 'u3'] },
      { recordId: 'p3', groupId: 'h', passageRefs: ['u4', 'u5', 'u6', 'u7'] },
      { recordId: 'p4', passageRefs: ['u8', 'u9', 'u10', 'u11'] },
    ];
    const p = planAlignBatches({
      records: recs,
      concepts: concepts(1),
      passageBudget: 3,
      conceptBudget: 5,
      callCap: 8,
      batchPrefix: '',
    });
    expect(p.calls.map((c) => c.recordIds)).toEqual([['p1', 'p2']]);
    expect(p.omitted.find((o) => o.recordId === 'p3')?.reason).toBe('group-over-budget');
    expect(p.omitted.find((o) => o.recordId === 'p4')?.reason).toBe('over-call-budget');
  });

  it('fails before any call when a pair is in neither a call nor the ledger', () => {
    const p = plan();
    const broken: BatchPlan = { ...p, calls: p.calls.slice(1) };
    expect(() => assertAlignLedgerComplete(broken, records(3), concepts(5))).toThrow(/no call/);
  });

  it('refuses a non-positive constant', () => {
    expect(() => plan({ conceptBudget: 0 })).toThrow(AlignPlanError);
  });
});

describe('coverage', () => {
  it('puts every unit in exactly one set for a call', async () => {
    const cov = await alignRevisionCoverage('rev', [
      { ref: 'u0', unitIndex: 0, state: 'read' },
      { ref: 'u1', unitIndex: 1, state: 'read' },
      { ref: 'u2', unitIndex: 2, state: 'read' },
      { ref: 'u3', unitIndex: 3, state: 'not-read', reason: 'pending' },
    ]);
    const calls = [
      { batchId: 'b1', passageRefs: ['u0'] },
      { batchId: 'b2', passageRefs: ['u1'] },
    ];
    const view = alignCoverageForCall(cov, calls[0] as never, calls, new Set(['u0', 'u1']));
    expect(view.map((u) => u.state)).toEqual([
      'sent',
      'sent-in-other-call',
      'read-not-sent',
      'not-read',
    ]);
    expect(view[1]?.batchId).toBe('b2');
    expect(view[2]?.reason).toBe('no-record-anchored');
  });
});

describe('aggregation', () => {
  const cov = { units: [{ ref: 'u0', unitIndex: 0, state: 'read' as const }] };
  const within = (recordId: string, refs: number[]): AlignPair => ({
    recordId,
    verdict: { kind: 'within-scope', refs },
  });
  const no: AlignPair = { recordId: 'x', verdict: { kind: 'not-within-scope' } };
  const omitted: AlignPair = { recordId: 'y', verdict: { kind: 'omitted', reason: 'run-cap' } };
  const failed: AlignPair = { recordId: 'z', verdict: { kind: 'pending', reason: 'unavailable' } };
  const unsure: AlignPair = {
    recordId: 'w',
    verdict: { kind: 'cannot-tell', reason: 'ambiguous' },
  };
  const agg = (pairs: AlignPair[], recordCount = 3) =>
    aggregateAlignConcept(pairs, cov, { recordCount }).result;

  it('reads aligned over pending over cannot tell over not aligned', () => {
    expect(agg([no, omitted, unsure, within('b', [2]), within('a', [1, 2])])).toEqual({
      kind: 'aligned',
      recordIds: ['a', 'b'],
      refs: [1, 2],
    });
    expect(agg([no, unsure, omitted, failed])).toEqual({ kind: 'pending', reason: 'run-cap' });
    expect(agg([no, unsure])).toEqual({ kind: 'cannot-tell', reason: 'ambiguous' });
    expect(agg([no])).toEqual({ kind: 'not-aligned', reason: 'searched' });
  });

  it('reads a within-scope pair with no surviving ref as cannot tell, voided by check', () => {
    expect(agg([within('a', [])])).toEqual({ kind: 'cannot-tell', reason: 'voided-by-check' });
  });

  it('reads an unread unit as partly read and a document stating nothing as states-no-scope', () => {
    const partly = aggregateAlignConcept(
      [no],
      { units: [{ ref: 'u0', unitIndex: 0, state: 'not-read' }] },
      { recordCount: 1 },
    );
    expect(partly.result).toEqual({ kind: 'cannot-tell', reason: 'partly-read' });
    expect(partly.coverage.unitsNotRead).toEqual([{ unit: 'u0', reason: 'not-read' }]);
    expect(agg([], 0)).toEqual({ kind: 'not-aligned', reason: 'states-no-scope' });
  });

  it('is the same in any pair order, and counts the pairs not sent by reason', () => {
    const pairs = [no, omitted, failed, unsure, omitted];
    const a = aggregateAlignConcept(pairs, cov, { recordCount: 3 });
    const b = aggregateAlignConcept([...pairs].reverse(), cov, { recordCount: 3 });
    expect(a).toEqual(b);
    expect(a.coverage.pairsNotSent).toEqual([{ reason: 'run-cap', count: 2 }]);
  });
});

describe('digests', () => {
  const config: FrozenConfigurationInput = {
    documentKind: 'objectives',
    descriptionCap: 400,
    conceptBudget: 34,
    passageBudget: 77,
    runCallCap: 8,
    promptVersion: 'p1',
    modelId: 'm1',
    membership: 'course-only',
  };
  const list = [
    { key: 'a', name: 'Alpha', attribution: 'course-a', descriptionSha256: null },
    { key: 'b', name: 'Beta', attribution: 'course-a', descriptionSha256: 'ff' },
  ];
  const units = [
    { ref: 'u0', unitIndex: 0, state: 'read' as const },
    { ref: 'u1', unitIndex: 1, state: 'read' as const },
  ];
  const build = async (
    over: {
      list?: typeof list;
      units?: readonly { ref: string; unitIndex: number; state: 'read' | 'not-read' }[];
      config?: FrozenConfigurationInput;
      budget?: number;
      structureId?: string;
    } = {},
  ) => {
    const plan = planAlignBatches({
      records: records(2),
      concepts: concepts(2),
      passageBudget: 77,
      conceptBudget: over.budget ?? 34,
      callCap: 8,
      batchPrefix: '',
    });
    return alignDigests({
      closedList: over.list ?? list,
      coverage: await alignRevisionCoverage('rev', over.units ?? units),
      plan,
      ...(over.structureId !== undefined ? { structureId: over.structureId } : {}),
      configuration: over.config ?? config,
    });
  };

  it('is equal when rebuilt from the same inputs', async () => {
    expect(await build()).toEqual(await build());
    expect((await build()).closedList).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('moves only the digest that covers the changed input', async () => {
    const base = await build();
    const moved = (a: Awaited<ReturnType<typeof build>>) =>
      (Object.keys(base) as (keyof typeof base)[]).filter((k) => a[k] !== base[k]);
    expect(
      moved(
        await build({
          list: [{ ...(list[0] as (typeof list)[0]), name: 'Alpha2' }, list[1] as (typeof list)[0]],
        }),
      ),
    ).toEqual(['closedList']);
    expect(
      moved(
        await build({
          units: [
            units[0] as (typeof units)[0],
            { ...(units[1] as (typeof units)[0]), state: 'not-read' },
          ],
        }),
      ),
    ).toEqual(['coverage']);
    expect(moved(await build({ budget: 1 }))).toEqual(['batchPlan']);
    expect(moved(await build({ structureId: 'S1' }))).toEqual(['batchPlan']);
    expect(moved(await build({ config: { ...config, promptVersion: 'p2' } }))).toEqual([
      'frozenConfiguration',
    ]);
    expect(moved(await build({ config: { ...config, modelId: 'm2' } }))).toEqual([
      'frozenConfiguration',
    ]);
  });

  it('digests a plan with the same text on any device', async () => {
    const plan = planAlignBatches({
      records: records(1),
      concepts: concepts(1),
      passageBudget: 77,
      conceptBudget: 34,
      callCap: 8,
      batchPrefix: '',
    });
    expect(await alignBatchPlanDigest(plan)).toBe(await alignBatchPlanDigest({ ...plan }));
  });
});
