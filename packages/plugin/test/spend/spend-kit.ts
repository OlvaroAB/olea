/** Shared synthetic fixtures for the spend ledger specs (`ol-egov.141.89.7.76`, `[D-540]`). Invented ids only. */

import {
  holdUsdFor,
  parseSpendLedgerLine,
  type SpendLedgerEntry,
  serializeSpendLedgerEntry,
  spendLedgerPath,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { createVaultSpendLedger, type SpendLedger } from '../../src/spend/vault-spend-ledger.js';
import { type MemoryVault, memoryVault } from '../review/memory-vault.js';

export const THIS_DEVICE = 'olea-thisdevice01';
export const OTHER_DEVICE = 'olea-otherdevice2';
export const NOW = new Date('2026-10-06T12:00:00.000Z');

let seq = 0;
/** Deterministic, unique call ids. */
export const nextCallId = () => `call-${String(++seq).padStart(8, '0')}`;

export function ledgerOver(
  vault: VaultSource,
  options: { deviceId?: string; now?: () => Date } = {},
): SpendLedger {
  return createVaultSpendLedger({
    vault,
    deviceId: async () => options.deviceId ?? THIS_DEVICE,
    now: options.now ?? (() => NOW),
    newCallId: nextCallId,
  });
}

/** Another device's file whose holds sum to `usd` (one hold per call of at most USD 1, an hour old). */
export function otherDeviceFile(usd: number, deviceId = OTHER_DEVICE): Record<VaultPath, string> {
  const entries: SpendLedgerEntry[] = [];
  let left = Math.round(usd * 1e6);
  let n = 0;
  while (left > 0) {
    const micro = Math.min(left, 1_000_000);
    entries.push({
      v: 1,
      kind: 'hold',
      at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      callId: `seed-${deviceId}-${n++}`,
      taskId: 'outcomes.extract.v1',
      holdUsd: micro / 1e6,
    });
    left -= micro;
  }
  return {
    [spendLedgerPath(deviceId)]: `${entries.map((e) => serializeSpendLedgerEntry(e)).join('\n')}\n`,
  };
}

/** A memory vault holding another device's spend of `usd`. */
export function vaultSpentTo(usd: number, extra: Record<string, string> = {}): MemoryVault {
  return memoryVault({ ...otherDeviceFile(usd), ...extra });
}

/** This device's ledger lines, parsed. */
export async function ownEntries(vault: VaultSource, deviceId = THIS_DEVICE) {
  const path = spendLedgerPath(deviceId);
  if (!(await vault.exists(path))) return [];
  return (await vault.read(path))
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => parseSpendLedgerLine(line));
}

export const DEMAND_HOLD = holdUsdFor('demand.classify.v1');
export const ALIGN_HOLD = holdUsdFor('outcomes.align.v1');
export const EXTRACT_HOLD = holdUsdFor('outcomes.extract.v1');

/** Wraps a vault so one operation fails the way a broken disk or a blind host would. */
export function failing(
  vault: VaultSource,
  fail: {
    list?: boolean;
    readPath?: VaultPath;
    write?: boolean;
    dropWrites?: boolean;
    blindList?: boolean;
  },
): VaultSource {
  return {
    list: async (options) => {
      if (fail.list) throw new Error('listing failed');
      if (fail.blindList) return [];
      return vault.list(options);
    },
    read: async (path) => {
      if (fail.readPath === path) throw new Error('read failed');
      return vault.read(path);
    },
    readBinary: (path) => vault.readBinary(path),
    write: async (path, content) => {
      if (fail.write) throw new Error('write failed');
      if (fail.dropWrites) return;
      return vault.write(path, content);
    },
    exists: (path) => vault.exists(path),
    watch: (handler) => vault.watch(handler),
  };
}
