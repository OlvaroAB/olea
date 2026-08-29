/**
 * The persisted dispute record — `[D-046]` clause 4's "recorded either way",
 * shaped by `[D-095]` (`ol-egov.19`). Originally built for `ol-fgba`
 * [DISP-1]; moved into `packages/contracts/src/review-log.ts` by `ol-qs72`,
 * per this file's own former header (still readable in git history for the
 * full move argument).
 *
 * ==========================================================================
 * WHY THIS FILE IS NOW A THIN RE-EXPORT LAYER
 * ==========================================================================
 * A new persisted review-log event kind is a Class C move: it changes a
 * persisted schema. `disputeLogRecordV5` now lives beside `review`,
 * `suspend`/`unsuspend`, `verdict` and `succession` in `packages/contracts/
 * src/review-log.ts`, additive to `reviewLogEntryV5` — a fifth `kind`
 * literal, no version bump, the same argument `successionLogRecordV5`'s own
 * doc gives ("a new literal `kind` value is what additive means here").
 *
 * **Nothing about the wire shape changed when it moved.** Every name below
 * is exactly the name this module exported before the move, so `./write.ts`,
 * `./parse.ts`, `./contest.ts`, `packages/core/src/today/contest.spec.ts`
 * and this module's own `contest.spec.ts` needed no import-path changes at
 * all. `safeParseDisputeLogRecord` still mirrors zod's `safeParse` shape —
 * trivially now, since it IS zod's `safeParse`.
 *
 * **Why the record still routes through `./parse.ts`'s separate `disputes`
 * field rather than `ReviewLogEntry.records`, even though the schema is now
 * a full union member.** `./parse.ts`'s own doc states the reason and it did
 * not change with the move: "every review event" and "every dispute about a
 * claim" are different questions, and no consumer that switches exhaustively
 * over `ReviewLogEntry['kind']` outside this module family has to grow a
 * `'dispute'` arm it has nothing to say about.
 */

import {
  type ContestEffect,
  type ContestedClaimKind,
  type ContestedClaimRendering,
  contestEffect,
  contestedClaimKind,
  contestedClaimRendering,
  type DisputeLogRecord,
  disputeLogRecordV5,
} from 'olea-contracts';

export type {
  ContestEffect,
  ContestedClaimKind,
  ContestedClaimRendering,
  DisputeLogRecord,
} from 'olea-contracts';
export { disputeLogRecordV5 } from 'olea-contracts';

/** `[D-095]`'s three kinds, as a plain array — same values `contestedClaimKind.options` carries. */
export const CONTESTED_CLAIM_KINDS: readonly ContestedClaimKind[] = [...contestedClaimKind.options];

/** The three effects `[D-095]` names, as a plain array. */
export const CONTEST_EFFECTS: readonly ContestEffect[] = [...contestEffect.options];

/** The six routed renderings, matching `./contest.ts`'s `CLAIM_ROUTING`. */
export const CONTESTED_CLAIM_RENDERINGS: readonly ContestedClaimRendering[] = [
  ...contestedClaimRendering.options,
];

/** Alias kept so the file family's `*V5` naming reads consistently. */
export type DisputeLogRecordV5 = DisputeLogRecord;

/** What a caller supplies; the writer stamps `schemaVersion`, `kind` and `eventId`. */
export type DisputeLogRecordInput = Omit<DisputeLogRecord, 'schemaVersion' | 'kind' | 'eventId'>;

/** Mirrors zod's `safeParse` return, so callers written against the pre-move shape need no change. */
export type SafeParseDisputeResult =
  | { readonly success: true; readonly data: DisputeLogRecord }
  | { readonly success: false; readonly error: { readonly message: string } };

/**
 * Validates one candidate dispute record against the contracts schema.
 * Fails closed on every way of not knowing, exactly as the hand-written
 * validator this replaced did — an unrecognised enum value, a missing id, a
 * timestamp without an offset, an empty concept list, or a half-formed
 * resolution.
 */
export function safeParseDisputeLogRecord(input: unknown): SafeParseDisputeResult {
  return disputeLogRecordV5.safeParse(input);
}
