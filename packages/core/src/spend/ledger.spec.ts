/**
 * The spend ledger's line format, its period arithmetic and its admission rule (`[D-540]`,
 * `ol-egov.141.89.7.76`). Scenarios: F4.1, "the period's spend counts settled calls at their cost,
 * open and stale holds at their hold, and released calls at nothing", "an entry older than 120 days
 * no longer counts", "a line the reader cannot trust counts as a worst-case hold, never as nothing",
 * and the admission half of "at 80 percent of the limit the scope reads pause" and "at 100 percent
 * any call whose hold would pass the limit is refused". Synthetic ids only.
 */

import { describe, expect, it } from 'vitest';
import {
  admitSpend,
  alignmentRefusalMaterial,
  demandRefusalMaterial,
  deviceOfSpendLedgerPath,
  parseSpendLedgerLine,
  SPEND_LEDGER_FOLDER,
  SPEND_LEDGER_VERSION,
  type SpendLedgerEntry,
  serializeSpendLedgerEntry,
  spendLedgerPath,
  spendRefusalKey,
  summarizeSpendLedger,
} from './ledger.js';
import { holdUsdFor, WORST_CASE_HOLD_USD } from './prices.js';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const hold = (callId: string, at: string, holdUsd = 0.044576, taskId = 'demand.classify.v1') =>
  ({ v: 1, kind: 'hold', at, callId, taskId, holdUsd }) as const;
const settle = (callId: string, at: string, settledUsd: number, attempts: 1 | 2 = 1) =>
  ({ v: 1, kind: 'settle', at, callId, settledUsd, attempts }) as const;
const release = (callId: string, at: string) => ({ v: 1, kind: 'release', at, callId }) as const;
const refusal = (refusalKey: string, at: string, taskId = 'demand.classify.v1') =>
  ({ v: 1, kind: 'refusal', at, refusalKey, taskId }) as const;

const file = (...entries: SpendLedgerEntry[]) =>
  `${entries.map((entry) => serializeSpendLedgerEntry(entry)).join('\n')}\n`;
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('where the ledger lives', () => {
  it('one file per device under .olea/spend-ledger/', () => {
    expect(SPEND_LEDGER_FOLDER).toBe('.olea/spend-ledger');
    expect(SPEND_LEDGER_VERSION).toBe(1);
    expect(spendLedgerPath('olea-k3f9zq1m7x2p')).toBe('.olea/spend-ledger/olea-k3f9zq1m7x2p.jsonl');
    expect(deviceOfSpendLedgerPath('.olea/spend-ledger/olea-k3f9zq1m7x2p.jsonl')).toBe(
      'olea-k3f9zq1m7x2p',
    );
    expect(deviceOfSpendLedgerPath('.olea/outcomes/olea-k3f9zq1m7x2p.jsonl')).toBeNull();
    expect(() => spendLedgerPath('../escape')).toThrow();
  });
});

describe('the line format', () => {
  it('writes each kind as one JSON object with only its own fields, and reads it back', () => {
    const entries: SpendLedgerEntry[] = [
      hold('call-0001', ago(0)),
      settle('call-0001', ago(0), 0.0123),
      release('call-0002', ago(0)),
      refusal(KEY_A, ago(0)),
    ];
    for (const entry of entries) {
      const line = serializeSpendLedgerEntry(entry);
      expect(line).not.toContain('\n');
      expect(parseSpendLedgerLine(line)).toEqual({ entry });
    }
    expect(
      Object.keys(JSON.parse(serializeSpendLedgerEntry(entries[0] as SpendLedgerEntry))),
    ).toEqual(['v', 'kind', 'at', 'callId', 'taskId', 'holdUsd']);
  });

  it('refuses to write an entry that is not well formed', () => {
    const bad = [
      { ...hold('call-0001', ago(0)), holdUsd: Number.NaN },
      { ...hold('call-0001', ago(0)), holdUsd: 0 },
      { ...hold('call-0001', ago(0)), at: 'yesterday' },
      { ...hold('call-0001', ago(0)), path: '01 Courses/note.md' },
      { ...settle('call-0001', ago(0), 0.01), attempts: 3 },
      { ...refusal('not-a-digest', ago(0)) },
      { ...hold('a/b', ago(0)) },
    ];
    for (const entry of bad) {
      expect(() => serializeSpendLedgerEntry(entry as unknown as SpendLedgerEntry)).toThrow();
    }
  });

  it('tells a torn line, an unknown kind and a later version apart', () => {
    expect(parseSpendLedgerLine('{"v":1,"kind":"hold","at":"2026-10')).toEqual({
      problem: 'malformed',
    });
    expect(parseSpendLedgerLine(JSON.stringify({ v: 1, kind: 'grant', at: ago(0) }))).toMatchObject(
      { problem: 'unknown-kind' },
    );
    expect(
      parseSpendLedgerLine(JSON.stringify({ ...hold('call-0001', ago(0)), v: 2 })),
    ).toMatchObject({ problem: 'future-version' });
    expect(
      parseSpendLedgerLine(JSON.stringify({ ...hold('call-0001', ago(0)), extra: 1 })),
    ).toMatchObject({ problem: 'malformed' });
  });
});

describe('the period sum', () => {
  it('counts a settled call at its cost, open and stale holds at their hold, a released call at nothing', () => {
    const text = file(
      hold('call-settled', ago(3 * DAY), 0.155168, 'outcomes.align.v1'),
      settle('call-settled', ago(3 * DAY), 0.0123),
      hold('call-open', ago(60 * 60 * 1000)),
      hold('call-stale', ago(2 * DAY)),
      hold('call-released', ago(5 * DAY)),
      release('call-released', ago(5 * DAY)),
    );
    const summary = summarizeSpendLedger([text], NOW);
    expect(summary.spentMicroUsd).toBe(12_300 + 44_576 + 44_576);
    expect(summary.spentUsd).toBeCloseTo(0.101452, 9);
    expect(summary.diagnostics).toMatchObject({
      openHolds: 1,
      staleHolds: 1,
      settled: 1,
      released: 1,
      malformed: 0,
      unknownKind: 0,
      futureVersion: 0,
    });
  });

  it('drops an entry once it is more than 120 days old', () => {
    const text = file(
      hold('call-old', ago(121 * DAY)),
      settle('call-old', ago(121 * DAY), 1),
      hold('call-young', ago(119 * DAY)),
      settle('call-young', ago(119 * DAY), 2),
      hold('call-edge', ago(120 * DAY)),
      settle('call-edge', ago(120 * DAY), 4),
    );
    expect(summarizeSpendLedger([text], NOW).spentMicroUsd).toBe(6_000_000);
  });

  it('counts a torn line, an unknown kind and a later version each as one worst-case hold', () => {
    const text = [
      serializeSpendLedgerEntry(hold('call-0001', ago(DAY / 2))),
      '{"v":1,"kind":"hold","at":"2026-10-0',
      JSON.stringify({ v: 1, kind: 'grant', at: ago(DAY) }),
      JSON.stringify({ ...hold('call-0002', ago(DAY)), v: 2 }),
      'not json at all',
      '',
    ].join('\n');
    const summary = summarizeSpendLedger([text], NOW);
    expect(summary.spentMicroUsd).toBe(44_576 + 4 * Math.round(WORST_CASE_HOLD_USD * 1e6));
    expect(summary.diagnostics).toMatchObject({ malformed: 2, unknownKind: 1, futureVersion: 1 });
  });

  it('still lets a readable but untrusted line age out by its own time', () => {
    const text = file(hold('call-0001', ago(DAY)));
    const old = JSON.stringify({ ...hold('call-0002', ago(200 * DAY)), v: 2 });
    const summary = summarizeSpendLedger([`${text}${old}\n`], NOW);
    expect(summary.spentMicroUsd).toBe(44_576);
    expect(summary.diagnostics.futureVersion).toBe(1);
  });

  it('unions every file, and a line copied into a second file counts once', () => {
    const one = file(hold('call-0001', ago(DAY)), hold('call-0002', ago(DAY)));
    const two = file(hold('call-0003', ago(DAY), 0.155168, 'outcomes.align.v1'));
    const conflictCopy = file(hold('call-0001', ago(DAY)));
    expect(summarizeSpendLedger([one, two, conflictCopy], NOW).spentMicroUsd).toBe(
      2 * 44_576 + 155_168,
    );
  });

  it('counts a settle whose hold line is missing at its cost, and a release alone at nothing', () => {
    const text = file(settle('call-0001', ago(DAY), 0.5), release('call-0002', ago(DAY)));
    expect(summarizeSpendLedger([text], NOW).spentMicroUsd).toBe(500_000);
  });

  it('counts each refusal key inside the period; a copied line counts again (held back sooner, never later)', () => {
    const text = file(
      refusal(KEY_A, ago(DAY)),
      refusal(KEY_A, ago(2 * DAY)),
      refusal(KEY_B, ago(130 * DAY)),
      refusal(KEY_B, ago(3 * DAY)),
    );
    const copy = file(refusal(KEY_A, ago(DAY)));
    const summary = summarizeSpendLedger([text, copy], NOW);
    expect(summary.refusalCounts.get(KEY_A)).toBe(3);
    expect(summary.refusalCounts.get(KEY_B)).toBe(1);
    expect(summary.diagnostics.refusals).toBe(4);
    expect(summary.spentMicroUsd).toBe(0);
  });

  it('an empty ledger has spent nothing', () => {
    const summary = summarizeSpendLedger([], NOW);
    expect(summary.spentMicroUsd).toBe(0);
    expect(summary.refusalCounts.size).toBe(0);
  });
});

describe('admission', () => {
  const spentTo = (usd: number) =>
    summarizeSpendLedger([file(hold('call-base', ago(DAY), usd))], NOW);

  it('admits a scope read whose hold keeps the period at or under USD 9.60, and pauses it past that', () => {
    const demand = holdUsdFor('demand.classify.v1');
    expect(admitSpend(spentTo(9.6 - demand), 'demand.classify.v1', demand)).toEqual({
      admitted: true,
    });
    expect(admitSpend(spentTo(9.6 - demand + 0.000001), 'demand.classify.v1', demand)).toEqual({
      admitted: false,
      reason: 'scope-reading-paused',
    });
    expect(admitSpend(spentTo(9.59), 'outcomes.align.v1', holdUsdFor('outcomes.align.v1'))).toEqual(
      { admitted: false, reason: 'scope-reading-paused' },
    );
  });

  it('keeps outcome extraction running to USD 12 and refuses any call whose hold would pass it', () => {
    const extract = holdUsdFor('outcomes.extract.v1');
    expect(admitSpend(spentTo(11), 'outcomes.extract.v1', extract)).toEqual({ admitted: true });
    expect(admitSpend(spentTo(12 - extract), 'outcomes.extract.v1', extract)).toEqual({
      admitted: true,
    });
    expect(admitSpend(spentTo(11.95), 'outcomes.extract.v1', extract)).toEqual({
      admitted: false,
      reason: 'limit-reached',
    });
    expect(
      admitSpend(spentTo(11.98), 'demand.classify.v1', holdUsdFor('demand.classify.v1')),
    ).toEqual({ admitted: false, reason: 'limit-reached' });
  });

  it('admits no task it has no declared price for', () => {
    expect(admitSpend(spentTo(0.01), 'cards.generate.v1', 0.01)).toEqual({
      admitted: false,
      reason: 'unknown-task',
    });
  });
});

describe('refusal keys', () => {
  it('are an opaque SHA-256 of the tuple, stable, and never contain the ids', async () => {
    const demand = await spendRefusalKey(demandRefusalMaterial('structure-1', 'p1'));
    const again = await spendRefusalKey(demandRefusalMaterial('structure-1', 'p1'));
    const align = await spendRefusalKey(alignmentRefusalMaterial('TESTC1', 'plan-d1', 'b1'));
    expect(demand).toMatch(/^[0-9a-f]{64}$/);
    expect(align).toMatch(/^[0-9a-f]{64}$/);
    expect(again).toBe(demand);
    expect(align).not.toBe(demand);
    for (const id of ['structure-1', 'p1', 'TESTC1', 'plan-d1', 'b1']) {
      expect(demand).not.toContain(id);
      expect(align).not.toContain(id);
    }
  });

  it('keep tuples apart whatever characters the ids hold', async () => {
    const one = await spendRefusalKey(demandRefusalMaterial('a|b', 'c'));
    const two = await spendRefusalKey(demandRefusalMaterial('a', 'b|c'));
    const three = await spendRefusalKey(alignmentRefusalMaterial('a', 'b', 'c'));
    expect(new Set([one, two, three]).size).toBe(3);
  });
});
