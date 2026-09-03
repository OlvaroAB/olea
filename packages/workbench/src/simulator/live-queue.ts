/**
 * `loadLiveDueQueue` — composes the real due queue at a LIVE instant, over a
 * LIVE (persisted) vault, for the simulator's "rate one item" affordance
 * (F9.S2's "a review written today is there after a reload").
 *
 * This is deliberately not `packages/workbench/src/queue/derive.ts`'s
 * `deriveWorkbenchQueue`: that module composes at a fixed, deterministic
 * instant (`WORKBENCH_NOW`, or a synthetic persona's latest due date) for
 * reproducible screenshots — exactly right for the scripted `#/today/*` and
 * `#/review/*` states, and exactly wrong for a lived term, where "what is due
 * right now" has to be computed at whatever instant the simulator's clock
 * currently reads. This module calls the SAME real core functions
 * (`buildReviewSession`, `composeQueue`) and the SAME real adapter
 * (`adaptReviewQueue`) `deriveWorkbenchQueue` does — no scheduling logic is
 * re-implemented — just at a caller-supplied `now` instead of a baked-in one.
 */

import type { ComposedQueue, ReviewSession, Scheduler, VaultSource } from 'olea-core';
import { buildReviewSession, composeQueue } from 'olea-core';
import { createDeterministicRandom } from '../deterministic-random.js';
import { adaptReviewQueue, type ReviewQueueItem } from '../plugin-bridge.js';

/** Documentation ABOUT the vault's card format, never a card itself — excluded the same way every other workbench composer excludes it. */
const EXCLUDE_PATHS = ['README.md'];

export interface LiveDueQueue {
  readonly session: ReviewSession;
  readonly offered: ComposedQueue;
  /** Every offered item, adapted to the real `ReviewQueueItem` shape a write needs. */
  readonly items: readonly ReviewQueueItem[];
}

export interface LoadLiveDueQueueOptions {
  readonly vault: VaultSource;
  readonly scheduler: Scheduler;
  readonly now: Date;
}

export async function loadLiveDueQueue(options: LoadLiveDueQueueOptions): Promise<LiveDueQueue> {
  const session = await buildReviewSession({
    vault: options.vault,
    scheduler: options.scheduler,
    now: options.now,
    instruments: { excludePaths: EXCLUDE_PATHS },
  });
  const offered = composeQueue({
    candidates: session.candidates,
    now: options.now,
    suspended: session.suspended,
    formatPreference: [],
  });
  const items = adaptReviewQueue({
    queue: offered,
    recordsById: session.recordsById,
    random: createDeterministicRandom(),
  });
  return { session, offered, items };
}
