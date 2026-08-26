/**
 * `diagnostics.ts` tests (F7.5/Q6.3, `ol-p6t02`). Pure functions, no
 * `obsidian` import — same posture `test/commands/register-commands.spec.ts`
 * takes for the same reason.
 */

import type { PersistedKeywordIndex, PersistedQueue } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildDiagnosticsReport,
  type DiagnosticsReportInput,
  summarizeQueueStatusCounts,
} from '../../src/commands/diagnostics.js';

function job(status: PersistedQueue['jobs'][number]['status']) {
  return {
    contentHash: 'deadbeef',
    label: 'some/vault/path.md',
    payload: null,
    enqueuedAt: 0,
    status,
    attempts: 0,
  };
}

function queueWith(
  statuses: PersistedQueue['jobs'][number]['status'][],
  headroom: number | null = null,
): PersistedQueue {
  return { version: 1, jobs: statuses.map(job), headroom };
}

function indexWithDocumentCount(count: number): PersistedKeywordIndex {
  return {
    version: 1,
    documents: Array.from({ length: count }, (_, i) => ({
      path: `note-${i}.md`,
      courses: ['some-course'],
      contentHash: 'deadbeef',
      blocks: [],
    })),
  };
}

const baseInput: Omit<DiagnosticsReportInput, 'queue' | 'index'> = {
  generatedAt: '2026-08-26T00:00:00.000Z',
  pluginVersion: '0.9.0-alpha.3',
  obsidianApiVersion: '1.13.1',
  platform: 'desktop',
};

describe('summarizeQueueStatusCounts', () => {
  it('a null queue (nothing persisted yet) counts as all zeros', () => {
    expect(summarizeQueueStatusCounts(null)).toEqual({
      queued: 0,
      'in-flight': 0,
      done: 0,
      deferred: 0,
      failed: 0,
    });
  });

  it('counts jobs by status only, across every status', () => {
    const queue = queueWith(['queued', 'queued', 'in-flight', 'done', 'deferred', 'failed']);
    expect(summarizeQueueStatusCounts(queue)).toEqual({
      queued: 2,
      'in-flight': 1,
      done: 1,
      deferred: 1,
      failed: 1,
    });
  });
});

describe('buildDiagnosticsReport', () => {
  it('reports versions, platform, index document count and queue counts', () => {
    const report = buildDiagnosticsReport({
      ...baseInput,
      queue: queueWith(['queued', 'queued', 'done'], 42),
      index: indexWithDocumentCount(7),
    });

    expect(report).toContain('Plugin version: 0.9.0-alpha.3');
    expect(report).toContain('Obsidian API version: 1.13.1');
    expect(report).toContain('Platform: desktop');
    expect(report).toContain('7 document(s) indexed');
    expect(report).toContain('2 queued');
    expect(report).toContain('1 done');
    expect(report).toContain('Budget headroom: 42');
  });

  it('a null queue and a null index report as empty, not as an error or an omission', () => {
    const report = buildDiagnosticsReport({ ...baseInput, queue: null, index: null });

    expect(report).toContain('0 document(s) indexed');
    expect(report).toContain('0 queued, 0 in-flight, 0 done, 0 deferred, 0 failed');
    expect(report).toContain('Budget headroom: unknown');
  });

  it('never contains a vault path, a job label, a course name or a content hash (D-005)', () => {
    const report = buildDiagnosticsReport({
      ...baseInput,
      queue: queueWith(['queued']),
      index: indexWithDocumentCount(3),
    });

    expect(report).not.toContain('some/vault/path.md');
    expect(report).not.toContain('note-0.md');
    expect(report).not.toContain('some-course');
    expect(report).not.toContain('deadbeef');
  });

  it('states plainly that it never names vault content', () => {
    const report = buildDiagnosticsReport({ ...baseInput, queue: null, index: null });
    expect(report).toMatch(/nothing above names a file, a note, a course or any vault content/i);
  });
});
