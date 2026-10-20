/**
 * `[D-557]` / `ol-egov.141.89.7.89`: the grove's processing-pass token,
 * derived from the ingestion queue's own persisted state, with no new stored
 * field. Each submission attempt raises a job's `attempts`, and each finished
 * job stamps `doneAt`, so this token changes when the queue has processed
 * something and stays the same across any number of grove reads between two
 * passes. `null` (nothing persisted: no queue has ever run) means no token:
 * the caller keeps today's count-every-read behaviour.
 */
import type { PersistedQueue } from 'olea-core';

export function processingPassTokenFromQueue(queue: PersistedQueue | null): string | null {
  if (queue === null) return null;
  let attempts = 0;
  let lastDoneAt = 0;
  for (const job of queue.jobs) {
    attempts += job.attempts;
    if (job.doneAt !== undefined && job.doneAt > lastDoneAt) lastDoneAt = job.doneAt;
  }
  return `q1:${attempts}:${lastDoneAt}`;
}
