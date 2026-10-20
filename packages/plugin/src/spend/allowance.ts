/**
 * `sendWithinAllowance` — how each of the three Worker adapters sends a call under the spend ledger
 * (`[D-540]`, `ol-egov.141.89.7.76`): `WorkerDemandClassifyReader`, `WorkerOutcomesAlignReader` and
 * `WorkerOutcomesExtractReader` (`../ingestion/`), when their composition gives them a ledger.
 *
 * Reserve a hold sized from the request's payload (`./vault-spend-ledger.ts`); when the ledger
 * declines, send nothing and say why, so the adapter can raise its over-budget signal; otherwise send
 * the request with the hold as its `remainingAllowanceUsd` (the envelope's existing courtesy field,
 * `olea-core`'s `WorkerTaskRequest`), so the Worker bounds its attempts to the hold and refuses before
 * sending a call that does not fit it. After a response, settle from its usage; a transport that
 * throws keeps the hold (the request may have reached the Worker) and the error goes to the adapter
 * unchanged.
 *
 * **The attempt count.** Settlement at the reported cost needs the response to prove one billable
 * call. The Worker says how many it made in the `x-olea-attempts` header, which the plugin's
 * transport now surfaces (`ol-egov.141.89.7.88`, `attemptsOfWorkerBody`). `attemptsOf` is the seam;
 * left out it defaults to that reader. A count the response did not carry (header absent or
 * malformed, or a transport that does not record it) is unknown and the call keeps its whole hold.
 *
 * No `obsidian` import (INV-1). Nothing here logs content (D-005).
 */

import type { WorkerTaskRequest, WorkerTaskTransport } from 'olea-core';
import { attemptsOfWorkerBody } from '../worker/transport.js';
import type {
  SpendDeclineReason,
  SpendLedger,
  SpendReservation,
  SpendSettlement,
} from './vault-spend-ledger.js';

export type AllowanceSendResult =
  | { readonly kind: 'sent'; readonly body: unknown }
  | { readonly kind: 'declined'; readonly reason: SpendDeclineReason };

export interface AllowanceSendOptions {
  /** How many billable calls the response says the request made, when the transport can see it. Defaults to `attemptsOfWorkerBody`. */
  readonly attemptsOf?: (body: unknown) => number | undefined;
}

/** The characters the ledger sizes a hold from: the payload as the wire carries it. */
export function payloadCharsOf(payload: unknown): number {
  try {
    return JSON.stringify(payload ?? null).length;
  } catch {
    // A payload that cannot be serialised cannot be sent either; size it as nothing and let the
    // transport fail on it, holding the paper's floor.
    return 0;
  }
}

/** The usage figures a success envelope carries (`stamp.usage`), each only when well formed. */
export function settlementFromBody(body: unknown, attempts: number | undefined): SpendSettlement {
  if (typeof body !== 'object' || body === null) return {};
  const response = body as Record<string, unknown>;
  if (response.ok !== true) return {};
  const stamp = response.stamp;
  if (typeof stamp !== 'object' || stamp === null) return {};
  const usage = (stamp as Record<string, unknown>).usage;
  if (typeof usage !== 'object' || usage === null) return {};
  const { costUsd, inputTokensSource } = usage as Record<string, unknown>;
  return {
    ...(typeof costUsd === 'number' ? { costUsd } : {}),
    ...(typeof inputTokensSource === 'string' ? { usageSource: inputTokensSource } : {}),
    ...(attempts !== undefined ? { attempts } : {}),
  };
}

export async function sendWithinAllowance(
  spend: SpendLedger,
  transport: WorkerTaskTransport,
  request: WorkerTaskRequest,
  options: AllowanceSendOptions = {},
): Promise<AllowanceSendResult> {
  const reserved = await spend.reserve(request.taskId, payloadCharsOf(request.payload));
  if (!reserved.granted) return { kind: 'declined', reason: reserved.reason };
  const reservation: SpendReservation = reserved.reservation;

  let sending = false;
  let body: unknown;
  try {
    const wire: WorkerTaskRequest = { ...request, remainingAllowanceUsd: reservation.holdUsd };
    sending = true;
    body = await transport.send(wire);
  } catch (error) {
    // Never sent: nothing can have been spent. Sent or perhaps sent: the whole hold stays.
    if (!sending) await spend.release(reservation);
    throw error;
  }

  let attempts: number | undefined;
  try {
    attempts = (options.attemptsOf ?? attemptsOfWorkerBody)(body);
  } catch {
    attempts = undefined;
  }
  await spend.settle(reservation, settlementFromBody(body, attempts));
  return { kind: 'sent', body };
}
