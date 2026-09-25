// Scenarios: olea-service/features/F3-learn-from-anything.md, "Feature: C5.3 /
// `[D-090]` — Duplicate item-ids, and when a repair may be silent" — the four
// scenarios tagged `@auto:core/instrument/duplication.spec`:
//   - "on a duplicate id, the copy where Olea last observed it keeps the id"
//   - "the losing copy is never silently minted as a live item"
//   - "a whole-file sync-conflict copy is handled wholesale, the same way"
//   - "one scheduling history is never fed by two physical items"
import { describe, expect, it } from 'vitest';
import type { QueueCandidate } from '../queue/types.js';
import type { DuplicateInstrumentIdReport } from '../session/build.js';
import type { QaInstrumentRecord } from '../session/types.js';
import type { VaultPath } from '../vault/types.js';
import { resolveInstrumentDuplications } from './duplication.js';

const NOW = new Date('2026-09-25T12:00:00Z').getTime();

/** A minimal Q&A record at `notePath`, mirroring `study-session/build.spec.ts`'s own `qa()` fixture. */
function qa(
  instrumentId: string,
  notePath: VaultPath,
  conceptIds: readonly string[] = ['concept-1'],
): QaInstrumentRecord {
  return {
    instrumentId,
    instrumentType: 'qa',
    conceptIds,
    courses: ['CRS101'],
    notePath,
    noteTitle: notePath,
    noteUid: null,
    blockId: null,
    heading: null,
    ordinal: 1,
    card: {
      type: 'qa',
      style: 'single-line',
      front: 'Front?',
      back: 'Back.',
      reversed: false,
      raw: 'Front?::Back.',
      span: { start: 0, end: 13 },
      blockId: null,
      foreignScheduling: null,
    },
  };
}

function candidate(instrumentId: string): QueueCandidate {
  return {
    instrumentId,
    instrumentType: 'qa',
    conceptIds: ['concept-1'],
    courses: ['CRS101'],
    state: null,
    targetAssessmentPath: null,
  };
}

/** Builds the `DuplicateInstrumentIdReport` the same walk `session/build.ts` would produce for `records`. */
function duplicateReportFor(
  records: readonly QaInstrumentRecord[],
): readonly DuplicateInstrumentIdReport[] {
  const notePathsById = new Map<string, VaultPath[]>();
  for (const record of records) {
    const existing = notePathsById.get(record.instrumentId);
    if (existing === undefined) notePathsById.set(record.instrumentId, [record.notePath]);
    else existing.push(record.notePath);
  }
  const reports: DuplicateInstrumentIdReport[] = [];
  for (const [instrumentId, notePaths] of notePathsById) {
    if (notePaths.length < 2) continue;
    reports.push({
      instrumentId,
      notePaths,
      keptNotePath: notePaths[notePaths.length - 1] as VaultPath,
    });
  }
  return reports;
}

describe('on a duplicate id, the copy where Olea last observed it keeps the id', () => {
  it('recordsById keeps the last-enumerated copy, never "the original path"', () => {
    const records = [
      qa('dup-1', 'Courses/GEO/original.md' as VaultPath),
      qa('dup-1', 'Courses/GEO/sync-conflict.md' as VaultPath),
    ];

    const result = resolveInstrumentDuplications({
      records,
      duplicateInstrumentIds: duplicateReportFor(records),
      candidates: records.map((r) => candidate(r.instrumentId)),
      now: NOW,
    });

    expect(result.recordsById.size).toBe(1);
    expect(result.recordsById.get('dup-1')?.notePath).toBe('Courses/GEO/sync-conflict.md');
  });

  it('reports and withholds nothing when every id is unique', () => {
    const records = [qa('solo-1', 'Courses/GEO/one.md' as VaultPath)];
    const result = resolveInstrumentDuplications({
      records,
      duplicateInstrumentIds: duplicateReportFor(records),
      candidates: [candidate('solo-1')],
      now: NOW,
    });
    expect(result.confirmationQueueEntries).toEqual([]);
    expect(result.candidates).toHaveLength(1);
  });
});

describe('the losing copy is never silently minted as a live item', () => {
  it('withholds the loser from candidates and queues it, inert, never given a fresh id', () => {
    const records = [
      qa('dup-1', 'Courses/GEO/original.md' as VaultPath),
      qa('dup-1', 'Courses/GEO/sync-conflict.md' as VaultPath),
    ];
    const duplicateInstrumentIds = duplicateReportFor(records);

    const result = resolveInstrumentDuplications({
      records,
      duplicateInstrumentIds,
      // Both copies produced a (content-identical) candidate, exactly as
      // `session/build.ts`'s own `enumeratedCandidates` does today —
      // `toQueueCandidate` maps every record, deduped or not.
      candidates: records.map((r) => candidate(r.instrumentId)),
      now: NOW,
    });

    // Not scheduled, not offered: only one candidate for the id survives.
    expect(result.candidates.filter((c) => c.instrumentId === 'dup-1')).toHaveLength(1);

    // Queued for her confirmation, inert.
    expect(result.confirmationQueueEntries).toHaveLength(1);
    const [entry] = result.confirmationQueueEntries;
    expect(entry?.losingNotePath).toBe('Courses/GEO/original.md');
    expect(entry?.status).toBe('proposed');
    expect(entry?.proposedAt).toBe(NOW);

    // Never given a fresh id on Olea's authority: the queued collision names
    // the SAME id the collision was found under.
    expect(entry?.collisions).toEqual([
      { instrumentId: 'dup-1', keptNotePath: 'Courses/GEO/sync-conflict.md' },
    ]);
  });
});

describe('a whole-file sync-conflict copy is handled wholesale, the same way', () => {
  it('groups every id a losing note carries into ONE confirmation-queue entry', () => {
    const records = [
      qa('dup-1', 'Courses/GEO/original.md' as VaultPath),
      qa('dup-1', 'Courses/GEO/sync-conflict.md' as VaultPath),
      qa('dup-2', 'Courses/GEO/original.md' as VaultPath),
      qa('dup-2', 'Courses/GEO/sync-conflict.md' as VaultPath),
    ];
    const duplicateInstrumentIds = duplicateReportFor(records);

    const result = resolveInstrumentDuplications({
      records,
      duplicateInstrumentIds,
      candidates: records.map((r) => candidate(r.instrumentId)),
      now: NOW,
    });

    // One wholesale case for the whole file — not a stream of two
    // independent per-item duplications.
    expect(result.confirmationQueueEntries).toHaveLength(1);
    const [entry] = result.confirmationQueueEntries;
    expect(entry?.losingNotePath).toBe('Courses/GEO/original.md');
    expect(entry?.collisions).toEqual([
      { instrumentId: 'dup-1', keptNotePath: 'Courses/GEO/sync-conflict.md' },
      { instrumentId: 'dup-2', keptNotePath: 'Courses/GEO/sync-conflict.md' },
    ]);

    // Both ids' losing copies are withheld from candidates.
    expect(result.candidates.filter((c) => c.instrumentId === 'dup-1')).toHaveLength(1);
    expect(result.candidates.filter((c) => c.instrumentId === 'dup-2')).toHaveLength(1);
  });
});

describe('one scheduling history is never fed by two physical items', () => {
  it('exactly one candidate per duplicated id survives while the loser waits in the queue', () => {
    const records = [
      qa('dup-1', 'Courses/GEO/a.md' as VaultPath),
      qa('dup-1', 'Courses/GEO/b.md' as VaultPath),
      qa('dup-1', 'Courses/GEO/c.md' as VaultPath),
    ];
    const duplicateInstrumentIds = duplicateReportFor(records);

    const result = resolveInstrumentDuplications({
      records,
      duplicateInstrumentIds,
      candidates: records.map((r) => candidate(r.instrumentId)),
      now: NOW,
    });

    // Three physical copies of the same id, still exactly one candidate:
    // whichever physical item writes to `dup-1`'s scheduling history next,
    // it can only ever be the one candidate offered.
    expect(result.candidates.filter((c) => c.instrumentId === 'dup-1')).toHaveLength(1);

    // Every losing copy (two of the three) is queued, none silently dropped.
    const queuedIds = result.confirmationQueueEntries.flatMap((e) =>
      e.collisions.map((c) => c.instrumentId),
    );
    expect(queuedIds).toEqual(['dup-1', 'dup-1']);
    expect(result.confirmationQueueEntries.map((e) => e.losingNotePath)).toEqual([
      'Courses/GEO/a.md',
      'Courses/GEO/b.md',
    ]);
  });
});
