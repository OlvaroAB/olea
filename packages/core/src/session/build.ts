/**
 * The session pipeline's one entry point (F2.5, F2.6, F2.14, F2.17, F6.1).
 *
 * ```
 *   VaultSource ──enumerate.ts──▶ VaultInstrumentRecord[]  ─┐
 *                                                            ├─▶ QueueCandidate[] ──composeQueue──▶ ComposedQueue
 *   review log ──history.ts──▶ entries ──replay.ts──▶ states ┘        (suspension.ts excludes)
 * ```
 *
 * Four modules, each testable alone, joined here and nowhere else. What this
 * function adds beyond wiring is the one thing a caller cannot do afterwards:
 * it returns **both** the composed queue and the enumerated records, so
 * rendering what the queue chose does not mean walking the vault a second time
 * with a second enumeration that can disagree about what exists.
 *
 * ## What it does not do
 *
 * It does not order, prioritise, dedupe or filter — `composeQueue` does all
 * four and this passes its arguments through untouched. It does not read a
 * clock: `now` is the caller's, same discipline as `ScheduleInput.now` and
 * `ComposeQueueInput.now`, so a composed session is deterministic and a replay
 * of it is trustworthy. And it writes nothing at all, into the vault or beside
 * it.
 *
 * ## Suspension comes from the whole log, deliberately
 *
 * `suspendedInstrumentIds` is folded over every entry this read produced, not
 * over a window. `today/data-source.ts` explains the asymmetry from the other
 * side: a suspend from last term is outside any trailing window, and a
 * projection that forgot it would put an instrument she stopped studying back
 * in front of her. This is the component F2.6's scenarios mean when they say
 * "the queue reads the full history".
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import { composeQueue } from '../queue/compose.js';
import type { ComposedQueue, QueueCandidate, QueueFilter } from '../queue/types.js';
import { suspendedInstrumentIds } from '../review-log/suspension.js';
import type { Scheduler } from '../scheduler/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { EnumerateVaultInstrumentsOptions } from './enumerate.js';
import { enumerateVaultInstruments } from './enumerate.js';
import type { ReadReviewLogHistoryOptions } from './history.js';
import { readReviewLogHistory } from './history.js';
import type { ReplayResult } from './replay.js';
import { replaySchedulerStates } from './replay.js';
import type { VaultInstrumentEnumeration, VaultInstrumentRecord } from './types.js';

export interface BuildReviewSessionInput {
  readonly vault: VaultSource;
  /** Replays the log. Its purity is what makes rebuilt state trustworthy — see `replay.ts`. */
  readonly scheduler: Scheduler;
  /** The instant the session is composed. Always the caller's, never a clock read here. */
  readonly now: Date;
  /** F2.5. Omitted means no filter. */
  readonly filter?: QueueFilter;
  /**
   * Review-log entries the caller already holds. When given, **no log is
   * read** — the whole function becomes pure apart from reading notes.
   *
   * This is the seam a harness uses to compose against a history that lives
   * somewhere other than `.olea/reviews/`: it reads that history itself and
   * hands the parsed records over, so core never learns another namespace
   * exists and no writer is pointed anywhere new.
   */
  readonly entries?: readonly ReviewLogEntry[];
  /** Passed to `readReviewLogHistory` when `entries` is not given. */
  readonly reviewLog?: ReadReviewLogHistoryOptions;
  /** Restrict the vault walk to a subtree. */
  readonly under?: VaultPath;
  /** Passed straight to `enumerateVaultInstruments` — including the D-030 id seam. */
  readonly instruments?: Omit<EnumerateVaultInstrumentsOptions, 'under'>;
  /** F2.17's format preference, injected. Omitted means none — see `ComposeQueueInput`. */
  readonly formatPreference?: readonly SchedulableInstrumentType[];
  /** F2.17's per-session dedupe. Defaults to `true`, as `composeQueue` does. */
  readonly dedupeByConcept?: boolean;
}

export interface ReviewSession {
  /** What is offered and what was due and deferred (F2.17). */
  readonly queue: ComposedQueue;
  /** Everything the walk found, including what it refused and why. */
  readonly instruments: VaultInstrumentEnumeration;
  /** The candidates handed to `composeQueue`, in enumeration order. Exposed for diagnostics and for the Today panel's count. */
  readonly candidates: readonly QueueCandidate[];
  /** Replayed scheduling state, by instrument id. Absent means never reviewed. */
  readonly replay: ReplayResult;
  /** F2.6's projection over the whole log. */
  readonly suspended: ReadonlySet<string>;
  /** The entries the replay and the projection were built from. */
  readonly entries: readonly ReviewLogEntry[];
  /** `instrumentId` -> record, so a caller rendering `queue.items` does not re-scan. */
  readonly recordsById: ReadonlyMap<string, VaultInstrumentRecord>;
}

/** The queue's half of a record. The renderer's half stays on the record and never reaches composition. */
export function toQueueCandidate(
  record: VaultInstrumentRecord,
  replay: ReplayResult,
): QueueCandidate {
  return {
    instrumentId: record.instrumentId,
    instrumentType: record.instrumentType,
    conceptIds: record.conceptIds,
    courses: record.courses,
    state: replay.states.get(record.instrumentId)?.state ?? null,
  };
}

/**
 * Walk the vault, replay the log, compose today's session.
 *
 * The single call a plugin, a panel or a harness makes. Everything it returns
 * is plain data.
 */
export async function buildReviewSession(input: BuildReviewSessionInput): Promise<ReviewSession> {
  const instruments = await enumerateVaultInstruments(input.vault, {
    ...(input.instruments ?? {}),
    ...(input.under !== undefined ? { under: input.under } : {}),
  });

  const entries =
    input.entries ?? (await readReviewLogHistory(input.vault, input.reviewLog ?? {})).entries;

  const replay = replaySchedulerStates(entries, input.scheduler);
  const suspended = suspendedInstrumentIds(entries);

  const candidates = instruments.records.map((record) => toQueueCandidate(record, replay));

  const queue = composeQueue({
    candidates,
    now: input.now,
    suspended,
    ...(input.filter !== undefined ? { filter: input.filter } : {}),
    ...(input.formatPreference !== undefined ? { formatPreference: input.formatPreference } : {}),
    ...(input.dedupeByConcept !== undefined ? { dedupeByConcept: input.dedupeByConcept } : {}),
  });

  const recordsById = new Map(instruments.records.map((record) => [record.instrumentId, record]));

  return { queue, instruments, candidates, replay, suspended, entries, recordsById };
}
