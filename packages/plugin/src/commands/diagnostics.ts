/**
 * Diagnostics report — F7.5 ("Error reporting and an in-app feedback path")
 * and Q6.3 ("Plugin conflicts are a support reality... Ship diagnostics
 * that identify the environment"), `ol-p6t02`.
 *
 * Pure, DOM-free and Obsidian-free on purpose: everything here is testable
 * in plain Vitest with plain data, following the split
 * `usage/aggregate.ts`/`usage/copy.ts` and `privacy/cache-purge.ts` already
 * use — the logic worth getting right (what counts as what, what the report
 * says) lives here; `diagnostics-clipboard.ts` is the thin, untestable glue
 * that pulls in `obsidian`'s `Notice`/`Platform`/`apiVersion` and the real
 * clipboard.
 *
 * ## D-005 discipline — what this deliberately never includes
 *
 * D-005 permits task id, token counts, cost, latency, model and prompt
 * version in diagnostic output — **never content, never concept or note
 * identifiers.** Checked against the two persisted shapes this report reads
 * before writing a line of it (`olea-core`'s `ingestion/types.ts` and
 * `keyword-index/types.ts`):
 *
 * - `PersistedJob.label` — "a vault-relative path or lecture title", by that
 *   field's own doc comment. Never read here. Only `PersistedJob.status` is
 *   read, to produce a count.
 * - `IndexedDocument.path` and `.courses` — a vault path and her course
 *   names. Never read here. Only `PersistedKeywordIndex.documents.length` is
 *   read, to produce a count.
 * - `IndexedDocument.contentHash` / `PersistedJob.contentHash` — a SHA-256 of
 *   her note content. Not reversible, but excluded anyway: a diagnostics
 *   report has no use for it, and "derived from her content" is exactly the
 *   category this report exists to stay clear of, not just the category that
 *   is technically unsafe.
 *
 * What's left is exactly what Q6.3 asks for: versions, a document count, a
 * queue-depth breakdown by status, and the last reported budget headroom —
 * enough to tell "Olea is broken" apart from "another plugin is fighting
 * Olea" or "the queue is just backed up", none of it naming what any of it
 * is *about*.
 */

import type { JobStatus, PersistedKeywordIndex, PersistedQueue } from 'olea-core';

/** Every status a job can be in, in report order — fixed here so the count always reports all five, even when a status has zero jobs. */
const JOB_STATUSES: readonly JobStatus[] = ['queued', 'in-flight', 'done', 'deferred', 'failed'];

export type QueueStatusCounts = Readonly<Record<JobStatus, number>>;

/** Counts jobs by status only — see the module doc for why nothing else about a job is read. `null` (nothing persisted yet) counts as an empty queue. */
export function summarizeQueueStatusCounts(queue: PersistedQueue | null): QueueStatusCounts {
  const counts: Record<JobStatus, number> = {
    queued: 0,
    'in-flight': 0,
    done: 0,
    deferred: 0,
    failed: 0,
  };
  for (const job of queue?.jobs ?? []) {
    counts[job.status] += 1;
  }
  return counts;
}

export interface DiagnosticsReportInput {
  /**
   * ISO-8601 instant, supplied by the caller rather than read from `Date.now()`
   * in here — keeps this function pure and its output deterministic under
   * test.
   */
  readonly generatedAt: string;
  readonly pluginVersion: string;
  readonly obsidianApiVersion: string;
  readonly platform: 'desktop' | 'mobile';
  readonly queue: PersistedQueue | null;
  readonly index: PersistedKeywordIndex | null;
}

/** Plain text, meant to be pasted into a bug report or GitHub issue — see `../settings/support-section-copy.ts` and `diagnostics-clipboard.ts`. */
export function buildDiagnosticsReport(input: DiagnosticsReportInput): string {
  const counts = summarizeQueueStatusCounts(input.queue);
  const documentCount = input.index?.documents.length ?? 0;
  const headroom = input.queue?.headroom ?? null;

  const queueLine = JOB_STATUSES.map((status) => `${counts[status]} ${status}`).join(', ');

  return [
    'Olea diagnostics',
    `Generated: ${input.generatedAt}`,
    `Plugin version: ${input.pluginVersion}`,
    `Obsidian API version: ${input.obsidianApiVersion}`,
    `Platform: ${input.platform}`,
    `Keyword index: ${documentCount} document(s) indexed`,
    `Ingestion queue: ${queueLine}`,
    `Budget headroom: ${headroom === null ? 'unknown (no submission reported yet this cycle)' : headroom}`,
    '',
    'Nothing above names a file, a note, a course or any vault content (F7.5, Q6.3, D-005).',
  ].join('\n');
}
