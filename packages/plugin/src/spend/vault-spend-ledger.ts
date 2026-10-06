/**
 * `createVaultSpendLedger` — the spend ledger in her vault (`[D-540]`, client half
 * `ol-egov.141.89.7.76`): the reservation every scope-reading and outcome-extraction call takes
 * before it is sent, the settlement after, and the refusal count that survives a restart.
 *
 * **Where it is.** `.olea/spend-ledger/<deviceId>.jsonl` (`olea-core`'s `spendLedgerPath`), one
 * append-only file per device, in Olea's own layer: registered with F7.4, so her export carries it
 * and the full delete removes it (`../privacy/log-discovery.ts`). The device id is the plugin's
 * existing one (`../device/device-id.ts`, stored in the plugin's `data.json`); this module takes it
 * as a function and mints nothing. The line format and the arithmetic are `olea-core`'s
 * (`spend/ledger.ts`, `spend/prices.ts`); this module reads, decides and appends.
 *
 * **Reserve.** One task on this device's file's queue (`withPathQueue`): read every file in the
 * folder, sum the period, admit or decline (`admitSpend`: the scope reads pause once the period plus
 * the hold would pass USD 9.60, extraction once it would pass USD 12), then append the hold and read
 * the file back to check the line landed. Two reservations on one install never both pass on the
 * same reading. A granted hold is what the adapter sends as `remainingAllowanceUsd`
 * (`./allowance.ts`), so the Worker never spends past it.
 *
 * **It fails closed.** No call is admitted when:
 * - the folder cannot be listed, or a file in it cannot be read;
 * - the listing does not show this device's own file although it exists (a host whose listing is
 *   blind to the folder, or whose walk swallowed an error, could equally be missing another device's
 *   file);
 * - the hold cannot be written, or the read-back does not find it (a write the full delete's seal
 *   dropped without an error, `../privacy/olea-layer-write-seal.ts`);
 * - a refusal could not be written earlier in this instance's life.
 * A refusal count that cannot be read reads as held back.
 *
 * **Settle.** A call is settled at the response's reported cost only when the response proves one
 * billable call: usage `reported` or `derived` (an upper bound) and an attempt count of exactly 1.
 * Anything else keeps the whole hold, and nothing is written: an open hold already counts at its
 * hold value, and a success after a retry may hide a thrown call's bill (paper section 9.4). The
 * attempt count travels in the Worker's `x-olea-attempts` header, which the plugin's transport does
 * not pass on today (paper precondition 5), so until it does every call keeps its whole hold. A
 * settle or release that fails to write leaves the hold counting: failing to write it never
 * under-counts.
 *
 * **Release** is for a call reserved and then never sent. A call whose transport threw is not
 * released: it may have reached the Worker.
 *
 * **Known limits, recorded rather than solved.**
 * - Two devices out of sync (`[D-540]` hub change 2): each sees the other's file only once the
 *   vault has synced, so together they can pass USD 12 by up to the holds each had in flight while
 *   apart.
 * - On a device's very first reservation, a host whose listing is blind to the folder cannot be
 *   told from an empty folder (there is no own file yet to check the listing against).
 * - The full delete removes the ledger with the rest of Olea's layer, so the period's spend starts
 *   again from nothing on that vault.
 * - A line with no readable time (a torn write) counts as a worst-case hold for as long as the file
 *   holds it.
 *
 * Logging is content-free (D-005): task ids, reasons and amounts only.
 */

import {
  admitSpend,
  holdUsdFor,
  isSpendTaskId,
  listFolder,
  SPEND_LEDGER_FOLDER,
  type SpendLedgerEntry,
  type SpendSummary,
  type SpendTaskId,
  serializeSpendLedgerEntry,
  spendLedgerPath,
  spendRefusalKey,
  summarizeSpendLedger,
  toMicroUsd,
  type VaultPath,
  type VaultSource,
  withPathQueue,
} from 'olea-core';

/** Why a reservation was declined. Each reaches an adapter as its over-budget signal. */
export type SpendDeclineReason =
  | 'scope-reading-paused'
  | 'limit-reached'
  | 'unknown-task'
  | 'ledger-unavailable';

export interface SpendReservation {
  readonly callId: string;
  readonly taskId: SpendTaskId;
  /** The hold written, and the request's `remainingAllowanceUsd`. */
  readonly holdUsd: number;
}

export type SpendReserveResult =
  | { readonly granted: true; readonly reservation: SpendReservation }
  | { readonly granted: false; readonly reason: SpendDeclineReason };

/** What a response says about its cost. Every field optional: an absent figure is never read as zero. */
export interface SpendSettlement {
  readonly costUsd?: number;
  readonly usageSource?: string;
  /** Billable calls the request made, when the transport can see it. */
  readonly attempts?: number;
}

/** The ledger port the three adapters and the scope-reading drivers take. */
export interface SpendLedger {
  /** Reserve one call of `taskId` whose payload is `payloadChars` characters long. Never throws. */
  reserve(taskId: string, payloadChars: number): Promise<SpendReserveResult>;
  /** Settle a reserved call from its response. Never throws. */
  settle(reservation: SpendReservation, settlement: SpendSettlement): Promise<void>;
  /** Release a reserved call that was never sent. Never throws. */
  release(reservation: SpendReservation): Promise<void>;
  /** Refusals in the period for the part or batch `material` names; `Infinity` when unreadable (held back). */
  refusalCount(material: string): Promise<number>;
  /** Record one refusal of the part or batch `material` names. Never throws. */
  recordRefusal(material: string, taskId: string): Promise<void>;
  /** The period's spend over every device's file. Throws when the ledger cannot be read. */
  summary(): Promise<SpendSummary>;
}

export interface VaultSpendLedgerOptions {
  /** The vault every store writes through (in production, the sealed source `main.ts` builds). */
  readonly vault: VaultSource;
  /** This install's stable device id (`ensureDeviceId`). */
  readonly deviceId: () => Promise<string>;
  /** Injectable for tests. */
  readonly now?: () => Date;
  /** Injectable for tests. Defaults to a random UUID. */
  readonly newCallId?: () => string;
}

class LedgerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerUnavailableError';
  }
}

export function createVaultSpendLedger(options: VaultSpendLedgerOptions): SpendLedger {
  const { vault } = options;
  const now = options.now ?? (() => new Date());
  const newCallId = options.newCallId ?? (() => globalThis.crypto.randomUUID());
  /** Refusals this instance recorded but could not write; counted on top of the file's. */
  const unwrittenRefusals = new Map<string, number>();
  /** Set once a refusal could not be written: from then on no call is admitted. */
  let broken = false;

  async function ownPath(): Promise<VaultPath> {
    return spendLedgerPath(await options.deviceId());
  }

  /** Every ledger file's text, or a throw when any part cannot be trusted (see the module doc). */
  async function readAll(own: VaultPath): Promise<string[]> {
    let listed: readonly VaultPath[];
    try {
      listed = await listFolder(vault, SPEND_LEDGER_FOLDER);
    } catch {
      throw new LedgerUnavailableError('the spend ledger folder could not be listed');
    }
    const paths = new Set(listed.filter((path) => path.startsWith(`${SPEND_LEDGER_FOLDER}/`)));
    let ownExists: boolean;
    try {
      ownExists = await vault.exists(own);
    } catch {
      throw new LedgerUnavailableError('this device’s spend ledger file could not be probed');
    }
    if (ownExists && !paths.has(own)) {
      throw new LedgerUnavailableError('the spend ledger listing does not show this device’s file');
    }
    const texts: string[] = [];
    for (const path of [...paths].sort()) {
      try {
        texts.push(await vault.read(path));
      } catch {
        throw new LedgerUnavailableError('a spend ledger file could not be read');
      }
    }
    return texts;
  }

  /** Appends one line to this device's file and reads it back. Run inside the file's queue. */
  async function appendUnderQueue(own: VaultPath, entry: SpendLedgerEntry): Promise<void> {
    const line = serializeSpendLedgerEntry(entry);
    const previous = (await vault.exists(own)) ? await vault.read(own) : '';
    const prefix = previous.length > 0 && !previous.endsWith('\n') ? `${previous}\n` : previous;
    const next = `${prefix}${line}\n`;
    await vault.write(own, next);
    const after = await vault.read(own).catch(() => '');
    if (after !== next) throw new LedgerUnavailableError('the spend ledger line did not land');
  }

  const at = () => now().toISOString();

  return {
    async reserve(taskId, payloadChars) {
      if (!isSpendTaskId(taskId)) {
        console.info('Olea: a model call was not reserved: the task has no declared price', {
          taskId,
        });
        return { granted: false, reason: 'unknown-task' };
      }
      if (broken) return { granted: false, reason: 'ledger-unavailable' };
      try {
        const own = await ownPath();
        return await withPathQueue(own, async (): Promise<SpendReserveResult> => {
          const summary = summarizeSpendLedger(await readAll(own), now());
          const holdUsd = holdUsdFor(taskId, payloadChars);
          const admission = admitSpend(summary, taskId, holdUsd);
          if (!admission.admitted) {
            console.info('Olea: a model call was not sent: the spending limit', {
              taskId,
              reason: admission.reason,
              spentUsd: summary.spentUsd,
              holdUsd,
            });
            return { granted: false, reason: admission.reason };
          }
          const callId = newCallId();
          await appendUnderQueue(own, { v: 1, kind: 'hold', at: at(), callId, taskId, holdUsd });
          return { granted: true, reservation: { callId, taskId, holdUsd } };
        });
      } catch (error) {
        console.error('Olea: a model call was not sent: the spend ledger could not be used', {
          taskId,
          error: error instanceof LedgerUnavailableError ? error.message : 'unexpected',
        });
        return { granted: false, reason: 'ledger-unavailable' };
      }
    },

    async settle(reservation, settlement) {
      const { costUsd, usageSource, attempts } = settlement;
      const proven =
        attempts === 1 &&
        (usageSource === 'reported' || usageSource === 'derived') &&
        typeof costUsd === 'number' &&
        Number.isFinite(costUsd) &&
        costUsd >= 0;
      // Anything short of proof keeps the whole hold, which an open hold already counts.
      if (!proven) return;
      try {
        const own = await ownPath();
        await withPathQueue(own, () =>
          appendUnderQueue(own, {
            v: 1,
            kind: 'settle',
            at: at(),
            callId: reservation.callId,
            settledUsd: toMicroUsd(costUsd) / 1e6,
            attempts: 1,
          }),
        );
      } catch (error) {
        console.error('Olea: a call’s cost was not recorded; its whole hold still counts', {
          taskId: reservation.taskId,
          error: error instanceof LedgerUnavailableError ? error.message : 'unexpected',
        });
      }
    },

    async release(reservation) {
      try {
        const own = await ownPath();
        await withPathQueue(own, () =>
          appendUnderQueue(own, { v: 1, kind: 'release', at: at(), callId: reservation.callId }),
        );
      } catch (error) {
        console.error('Olea: an unsent call’s hold was not released; it still counts', {
          taskId: reservation.taskId,
          error: error instanceof LedgerUnavailableError ? error.message : 'unexpected',
        });
      }
    },

    async refusalCount(material) {
      const key = await spendRefusalKey(material);
      const unwritten = unwrittenRefusals.get(key) ?? 0;
      try {
        const own = await ownPath();
        const summary = summarizeSpendLedger(await readAll(own), now());
        return (summary.refusalCounts.get(key) ?? 0) + unwritten;
      } catch (error) {
        console.error('Olea: a refusal count could not be read; the part is held back', {
          error: error instanceof LedgerUnavailableError ? error.message : 'unexpected',
        });
        return Number.POSITIVE_INFINITY;
      }
    },

    async recordRefusal(material, taskId) {
      const refusalKey = await spendRefusalKey(material);
      try {
        const own = await ownPath();
        await withPathQueue(own, () =>
          appendUnderQueue(own, { v: 1, kind: 'refusal', at: at(), refusalKey, taskId }),
        );
      } catch (error) {
        unwrittenRefusals.set(refusalKey, (unwrittenRefusals.get(refusalKey) ?? 0) + 1);
        broken = true;
        console.error('Olea: a refusal was not recorded; no further call is sent this session', {
          taskId,
          error: error instanceof LedgerUnavailableError ? error.message : 'unexpected',
        });
      }
    },

    async summary() {
      const own = await ownPath();
      return summarizeSpendLedger(await readAll(own), now());
    },
  };
}
