// The `spend/` export block of the `olea-core` barrel (`ol-egov.141.89.7.76`, `[D-540]`): the
// plugin's spend ledger store and the three Worker adapters import these from the public entry
// point, so an omission here would read as `undefined` there. Dedicated to that one block.
import { describe, expect, it } from 'vitest';
import * as oleaCore from './index.js';

describe('olea-core barrel — spend/ re-exports', () => {
  it('exports the ledger format, the period arithmetic, the admission rule and the declared prices', () => {
    const functions = [
      oleaCore.admitSpend,
      oleaCore.alignmentRefusalMaterial,
      oleaCore.demandRefusalMaterial,
      oleaCore.deviceOfSpendLedgerPath,
      oleaCore.holdUsdFor,
      oleaCore.inputBoundTokens,
      oleaCore.isSpendTaskId,
      oleaCore.parseSpendLedgerLine,
      oleaCore.perCallCeilingUsd,
      oleaCore.serializeSpendLedgerEntry,
      oleaCore.spendLedgerPath,
      oleaCore.spendRefusalKey,
      oleaCore.summarizeSpendLedger,
      oleaCore.toMicroUsd,
    ];
    for (const exported of functions) expect(typeof exported).toBe('function');
    expect(oleaCore.SPEND_LEDGER_FOLDER).toBe('.olea/spend-ledger');
    expect(oleaCore.SPEND_LEDGER_VERSION).toBe(1);
    expect(oleaCore.SPEND_LIMIT_USD).toBe(12);
    expect(oleaCore.SCOPE_READING_PAUSE_FRACTION).toBe(0.8);
    expect(oleaCore.SPEND_PERIOD_DAYS).toBe(120);
    expect(oleaCore.STALE_HOLD_HOURS).toBe(24);
    expect(oleaCore.BILLABLE_CALLS_PER_REQUEST).toBe(2);
    expect(oleaCore.DECLARED_INPUT_OVERBOUND_TOKENS).toBe(20_000);
    expect(oleaCore.RESERVATION_TOKENS_PER_CHARACTER).toBeCloseTo(2 / 3, 12);
    expect(oleaCore.WORST_CASE_HOLD_USD).toBe(0.155168);
    expect(Object.keys(oleaCore.SPEND_TASK_PRICES).sort()).toEqual([
      'demand.classify.v1',
      'outcomes.align.v1',
      'outcomes.extract.v1',
    ]);
    expect([...oleaCore.SPEND_TASK_IDS].sort()).toEqual([
      'demand.classify.v1',
      'outcomes.align.v1',
      'outcomes.extract.v1',
    ]);
  });
});
