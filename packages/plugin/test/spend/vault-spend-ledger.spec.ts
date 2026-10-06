/**
 * The vault spend ledger (`ol-egov.141.89.7.76`, `[D-540]`). Scenarios: F4.1, "every device's file is
 * counted", "a ledger that cannot be read allows no call", "no ledger line carries a path or her
 * content", "a call settles at its reported cost only when the response proves one billable call,
 * and otherwise keeps its whole hold", and the store half of "a refusal count survives a restart".
 * Synthetic ids only.
 */

import {
  alignmentRefusalMaterial,
  demandRefusalMaterial,
  holdUsdFor,
  SPEND_LEDGER_FOLDER,
  spendLedgerPath,
  WORST_CASE_HOLD_USD,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { memoryVault } from '../review/memory-vault.js';
import {
  ALIGN_HOLD,
  DEMAND_HOLD,
  EXTRACT_HOLD,
  failing,
  ledgerOver,
  NOW,
  OTHER_DEVICE,
  otherDeviceFile,
  ownEntries,
  THIS_DEVICE,
  vaultSpentTo,
} from './spend-kit.js';

const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const [error, info] = [console.error, console.info];
  console.error = () => undefined;
  console.info = () => undefined;
  try {
    return await f();
  } finally {
    console.error = error;
    console.info = info;
  }
};

const OWN = spendLedgerPath(THIS_DEVICE);

describe('reserving', () => {
  it('writes one hold to this device’s file at the task’s hold, and returns it', async () => {
    const vault = memoryVault();
    const ledger = ledgerOver(vault);
    const result = await ledger.reserve('demand.classify.v1', 1_000);
    expect(result).toMatchObject({
      granted: true,
      reservation: { taskId: 'demand.classify.v1', holdUsd: DEMAND_HOLD },
    });
    const entries = await ownEntries(vault);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      entry: {
        v: 1,
        kind: 'hold',
        at: NOW.toISOString(),
        callId: result.granted ? result.reservation.callId : '',
        taskId: 'demand.classify.v1',
        holdUsd: DEMAND_HOLD,
      },
    });
    expect(vault.writes).toEqual([OWN]);
    expect(OWN.startsWith(`${SPEND_LEDGER_FOLDER}/`)).toBe(true);
  });

  it('sizes a large request’s hold from its payload', async () => {
    const ledger = ledgerOver(memoryVault());
    const result = await ledger.reserve('outcomes.extract.v1', 600_000);
    expect(result).toMatchObject({
      granted: true,
      reservation: { holdUsd: holdUsdFor('outcomes.extract.v1', 600_000) },
    });
    expect(holdUsdFor('outcomes.extract.v1', 600_000)).toBeGreaterThan(EXTRACT_HOLD);
  });

  it('admits no task it has no price for, and writes nothing', async () => {
    const vault = memoryVault();
    const result = await quiet(() => ledgerOver(vault).reserve('cards.generate.v1', 10));
    expect(result).toEqual({ granted: false, reason: 'unknown-task' });
    expect(vault.writes).toEqual([]);
  });
});

describe('every device’s file is counted', () => {
  it('sums both files when deciding, and pauses the scope reads but not extraction past 80 percent', async () => {
    const vault = vaultSpentTo(9.58);
    const ledger = ledgerOver(vault);
    expect(await quiet(() => ledger.reserve('demand.classify.v1', 10))).toEqual({
      granted: false,
      reason: 'scope-reading-paused',
    });
    expect(await quiet(() => ledger.reserve('outcomes.align.v1', 10))).toEqual({
      granted: false,
      reason: 'scope-reading-paused',
    });
    const extract = await ledger.reserve('outcomes.extract.v1', 10);
    expect(extract.granted).toBe(true);
    expect((await ledger.summary()).spentMicroUsd).toBe(9_580_000 + Math.round(EXTRACT_HOLD * 1e6));
  });

  it('reads a third device’s file too', async () => {
    const vault = memoryVault({
      ...otherDeviceFile(5),
      ...otherDeviceFile(6.95, 'olea-thirddevice3'),
    });
    expect(await quiet(() => ledgerOver(vault).reserve('outcomes.extract.v1', 10))).toEqual({
      granted: false,
      reason: 'limit-reached',
    });
  });
});

describe('a ledger that cannot be read allows no call', () => {
  it('declines when the folder cannot be listed, and writes nothing', async () => {
    const inner = vaultSpentTo(1);
    const ledger = ledgerOver(failing(inner, { list: true }));
    expect(await quiet(() => ledger.reserve('outcomes.extract.v1', 10))).toEqual({
      granted: false,
      reason: 'ledger-unavailable',
    });
    expect(await inner.exists(OWN)).toBe(false);
  });

  it('declines when one listed file cannot be read', async () => {
    const inner = vaultSpentTo(1);
    const ledger = ledgerOver(failing(inner, { readPath: spendLedgerPath(OTHER_DEVICE) }));
    expect(await quiet(() => ledger.reserve('demand.classify.v1', 10))).toEqual({
      granted: false,
      reason: 'ledger-unavailable',
    });
  });

  it('declines when the listing cannot see this device’s own file, so it cannot be trusted to see another’s', async () => {
    const inner = memoryVault();
    await ledgerOver(inner).reserve('demand.classify.v1', 10);
    const blind = ledgerOver(failing(inner, { blindList: true }));
    expect(await quiet(() => blind.reserve('demand.classify.v1', 10))).toEqual({
      granted: false,
      reason: 'ledger-unavailable',
    });
  });

  it('declines when the hold cannot be written, or a write is dropped without an error', async () => {
    for (const fail of [{ write: true }, { dropWrites: true }]) {
      const inner = memoryVault();
      const ledger = ledgerOver(failing(inner, fail));
      expect(await quiet(() => ledger.reserve('demand.classify.v1', 10))).toEqual({
        granted: false,
        reason: 'ledger-unavailable',
      });
    }
  });

  it('reports the summary as unreadable rather than as nothing spent', async () => {
    const ledger = ledgerOver(failing(vaultSpentTo(1), { list: true }));
    await expect(ledger.summary()).rejects.toThrow();
  });
});

describe('settling, keeping and releasing a hold', () => {
  it('settles at the reported cost only when the response proves one billable call', async () => {
    const vault = memoryVault();
    const ledger = ledgerOver(vault);
    const one = await ledger.reserve('outcomes.align.v1', 10);
    if (!one.granted) throw new Error('expected a grant');
    await ledger.settle(one.reservation, { costUsd: 0.0123, usageSource: 'reported', attempts: 1 });
    const two = await ledger.reserve('outcomes.align.v1', 10);
    if (!two.granted) throw new Error('expected a grant');
    await ledger.settle(two.reservation, { costUsd: 0.02, usageSource: 'derived', attempts: 1 });
    expect((await ledger.summary()).spentMicroUsd).toBe(12_300 + 20_000);
    const kinds = (await ownEntries(vault)).map((e) => ('entry' in e ? e.entry.kind : e.problem));
    expect(kinds).toEqual(['hold', 'settle', 'hold', 'settle']);
  });

  it('keeps the whole hold when the attempts are unknown or two, or the usage is unreported or missing', async () => {
    const cases = [
      { costUsd: 0.0123, usageSource: 'reported' },
      { costUsd: 0.0123, usageSource: 'reported', attempts: 2 },
      { costUsd: 0, usageSource: 'unreported', attempts: 1 },
      { attempts: 1 },
      {},
    ];
    for (const settlement of cases) {
      const vault = memoryVault();
      const ledger = ledgerOver(vault);
      const result = await ledger.reserve('outcomes.align.v1', 10);
      if (!result.granted) throw new Error('expected a grant');
      await ledger.settle(result.reservation, settlement);
      expect((await ledger.summary()).spentMicroUsd, JSON.stringify(settlement)).toBe(
        Math.round(ALIGN_HOLD * 1e6),
      );
      expect(await ownEntries(vault)).toHaveLength(1);
    }
  });

  it('a released call counts nothing', async () => {
    const vault = memoryVault();
    const ledger = ledgerOver(vault);
    const result = await ledger.reserve('demand.classify.v1', 10);
    if (!result.granted) throw new Error('expected a grant');
    await ledger.release(result.reservation);
    expect((await ledger.summary()).spentMicroUsd).toBe(0);
  });

  it('two overlapping reservations near the limit: only the one that fits is granted', async () => {
    const vault = vaultSpentTo(9.6 - 1.5 * DEMAND_HOLD);
    const ledger = ledgerOver(vault);
    const results = await quiet(() =>
      Promise.all([
        ledger.reserve('demand.classify.v1', 10),
        ledger.reserve('demand.classify.v1', 10),
      ]),
    );
    expect(results.filter((r) => r.granted)).toHaveLength(1);
    expect(results.filter((r) => !r.granted)).toEqual([
      { granted: false, reason: 'scope-reading-paused' },
    ]);
  });

  it('a torn last line is closed off by the next write and counts as a worst-case hold', async () => {
    const vault = memoryVault({ [OWN]: '{"v":1,"kind":"hold","at":"2026-10-0' });
    const ledger = ledgerOver(vault);
    expect((await ledger.reserve('demand.classify.v1', 10)).granted).toBe(true);
    const summary = await ledger.summary();
    expect(summary.diagnostics.malformed).toBe(1);
    expect(summary.spentMicroUsd).toBe(
      Math.round(WORST_CASE_HOLD_USD * 1e6) + Math.round(DEMAND_HOLD * 1e6),
    );
  });
});

describe('refusal counts', () => {
  const material = demandRefusalMaterial('structure-x1', 'p1');

  it('are recorded under an opaque key and read back after a restart', async () => {
    const vault = memoryVault();
    const first = ledgerOver(vault);
    await first.recordRefusal(material, 'demand.classify.v1');
    await first.recordRefusal(material, 'demand.classify.v1');
    expect(await first.refusalCount(material)).toBe(2);
    const restarted = ledgerOver(vault);
    expect(await restarted.refusalCount(material)).toBe(2);
    expect(await restarted.refusalCount(demandRefusalMaterial('structure-x1', 'p2'))).toBe(0);
  });

  it('age out with the period', async () => {
    const vault = memoryVault();
    await ledgerOver(vault).recordRefusal(material, 'demand.classify.v1');
    const later = ledgerOver(vault, { now: () => new Date(NOW.getTime() + 121 * 86_400_000) });
    expect(await later.refusalCount(material)).toBe(0);
  });

  it('read as held back when the ledger cannot be read', async () => {
    const ledger = ledgerOver(failing(memoryVault(), { list: true }));
    expect(await quiet(() => ledger.refusalCount(material))).toBe(Number.POSITIVE_INFINITY);
  });

  it('a refusal that cannot be written still counts this session, and the ledger then allows no call', async () => {
    const ledger = ledgerOver(failing(memoryVault(), { write: true }));
    await quiet(() => ledger.recordRefusal(material, 'demand.classify.v1'));
    expect(await quiet(() => ledger.refusalCount(material))).toBeGreaterThanOrEqual(1);
    expect(await quiet(() => ledger.reserve('outcomes.extract.v1', 10))).toEqual({
      granted: false,
      reason: 'ledger-unavailable',
    });
  });
});

describe('no ledger line carries a path or her content', () => {
  it('holds only the version, kind, time, call id, task id, amounts, attempts or an opaque key', async () => {
    const vault = memoryVault();
    const ledger = ledgerOver(vault);
    const secrets = [
      'structure-secret-41',
      'part-secret-7',
      'COURSE-SECRET-9',
      'plan-digest-secret',
      'batch-secret-3',
      '01 Courses',
      '.md',
    ];
    for (const taskId of ['demand.classify.v1', 'outcomes.align.v1', 'outcomes.extract.v1']) {
      const result = await ledger.reserve(taskId, 5_000);
      if (!result.granted) throw new Error('expected a grant');
      await ledger.settle(result.reservation, {
        costUsd: 0.001,
        usageSource: 'reported',
        attempts: 1,
      });
      const again = await ledger.reserve(taskId, 5_000);
      if (!again.granted) throw new Error('expected a grant');
      await ledger.release(again.reservation);
    }
    await ledger.recordRefusal(
      demandRefusalMaterial('structure-secret-41', 'part-secret-7'),
      'demand.classify.v1',
    );
    await ledger.recordRefusal(
      alignmentRefusalMaterial('COURSE-SECRET-9', 'plan-digest-secret', 'batch-secret-3'),
      'outcomes.align.v1',
    );
    const bytes = await vault.read(OWN);
    for (const secret of secrets) expect(bytes).not.toContain(secret);
    const allowed = new Set([
      'v',
      'kind',
      'at',
      'callId',
      'taskId',
      'holdUsd',
      'settledUsd',
      'attempts',
      'refusalKey',
    ]);
    const lines = bytes.split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(14);
    for (const line of lines) {
      for (const key of Object.keys(JSON.parse(line))) expect(allowed.has(key), key).toBe(true);
      expect(line).not.toMatch(/\//);
    }
    expect(vault.writes.every((path) => path === OWN)).toBe(true);
  });
});
