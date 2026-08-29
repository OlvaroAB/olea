/**
 * `discoverScheduleEvents` / `scanNoteForScheduleEvents` (RHY-3 §9, `ol-4chx`).
 *
 * These tests deliberately do not assume a hardcoded folder or filename for
 * the calendar-events note — the whole point of evidence-based discovery
 * (`[D-068]`) is that it is found by grammar, wherever it lives. One test
 * places it under a folder name that looks nothing like "Calendar" to prove
 * that.
 *
 * INV-3: every course code, note title, path and line of text in this file
 * is coined for the test. None of it comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type {
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from '../vault/types.js';
import { discoverScheduleEvents, scanNoteForScheduleEvents } from './discover.js';

function extensionOf(path: VaultPath): string | undefined {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? undefined : path.slice(dot + 1).toLowerCase();
}

class MemoryVault implements VaultSource {
  constructor(private readonly files: Record<string, string>) {}

  list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const { under, extensions } = options;
    return Promise.resolve(
      Object.keys(this.files)
        .filter((p) => under === undefined || p === under || p.startsWith(`${under}/`))
        .filter((p) => extensions === undefined || extensions.includes(extensionOf(p) ?? ''))
        .sort(),
    );
  }
  read(path: VaultPath): Promise<string> {
    const content = this.files[path];
    if (content === undefined) return Promise.reject(new Error(`no such file ${path}`));
    return Promise.resolve(content);
  }
  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.read(path).then((t) => new TextEncoder().encode(t));
  }
  write(): Promise<void> {
    return Promise.reject(new Error('read-only'));
  }
  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(path in this.files);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }
}

describe('scanNoteForScheduleEvents — one note, in isolation', () => {
  it('parses every well-formed event line', () => {
    const content = [
      '# This week',
      '- [ ] GEOL101 - Monday 10:00-11:00 📅 2026-01-12',
      '- [ ] PHIL220 - Wednesday 09:00-10:00 📅 2026-01-14',
      '## Completed',
    ].join('\n');

    const scan = scanNoteForScheduleEvents(content, 'Sync/Timetable.md');
    expect(scan.events).toHaveLength(2);
    expect(scan.events[0]).toMatchObject({
      sourcePath: 'Sync/Timetable.md',
      lineNumber: 2,
      label: 'GEOL101',
      date: '2026-01-12',
    });
    expect(scan.events[1]).toMatchObject({ label: 'PHIL220', date: '2026-01-14' });
    expect(scan.unparseableLineCount).toBe(0);
  });

  it('skips and counts malformed task-list lines without dropping the well-formed ones', () => {
    const content = [
      '- [ ] GEOL101 - Monday 10:00-11:00 📅 2026-01-12',
      '- [ ] no date at all here',
      '- [ ] DANCE310 - Friday 14:00-15:30 📅 2026-01-16',
      '- [ ] 📅 2026-01-17',
    ].join('\n');

    const scan = scanNoteForScheduleEvents(content, 'Sync/Timetable.md');
    expect(scan.events.map((e) => e.label)).toEqual(['GEOL101', 'DANCE310']);
    expect(scan.unparseableLineCount).toBe(2);
  });

  it('an empty note scans clean: no events, nothing unparseable', () => {
    const scan = scanNoteForScheduleEvents('', 'Sync/Empty.md');
    expect(scan.events).toEqual([]);
    expect(scan.unparseableLineCount).toBe(0);
  });

  it('a wrong-format note (ordinary task list, no calendar fields) yields no events and is not flagged as an error', () => {
    const content = ['# Groceries', '- [ ] milk', '- [ ] eggs', '- [x] bread'].join('\n');
    const scan = scanNoteForScheduleEvents(content, 'Daily/2026-01-10.md');
    expect(scan.events).toEqual([]);
    // These lines attempted the grammar (they are task-list items) and did
    // not fit — an honest count, never surfaced to her (RHY-3 §8 stop 2).
    expect(scan.unparseableLineCount).toBe(3);
  });

  it('non-task-list prose carrying calendar-shaped text is never counted as an attempt', () => {
    const content = 'GEOL101 meets Monday 10:00-11:00 📅 2026-01-12, same time every week.';
    const scan = scanNoteForScheduleEvents(content, 'Notes/Random.md');
    expect(scan.events).toEqual([]);
    expect(scan.unparseableLineCount).toBe(0);
  });
});

describe('discoverScheduleEvents — evidence-based discovery over the whole vault', () => {
  it('discovery hit: finds the calendar note by grammar, wherever it lives, ignoring unrelated notes', () => {
    const vault = new MemoryVault({
      // Deliberately not named or foldered like "Calendar" — discovery must
      // not depend on either.
      'Imports/synced-2026-01.md': [
        '- [ ] GEOL101 - Monday 10:00-11:00 📅 2026-01-12',
        '- [ ] PHIL220 - Wednesday 09:00-10:00 📅 2026-01-14',
      ].join('\n'),
      'Daily/2026-01-10.md': ['# Groceries', '- [ ] milk', '- [ ] eggs'].join('\n'),
      '01 Courses/Geol 101/lecture-1.md': '# Lecture 1\n\nSome unrelated prose.',
      'ignored.txt': '- [ ] GEOL101 - Monday 10:00-11:00 📅 2026-01-12',
    });

    return discoverScheduleEvents(vault).then((report) => {
      expect(report.notesScanned).toEqual([
        '01 Courses/Geol 101/lecture-1.md',
        'Daily/2026-01-10.md',
        'Imports/synced-2026-01.md',
      ]);
      expect(report.candidateNotes.map((c) => c.path)).toEqual(['Imports/synced-2026-01.md']);
      expect(report.events).toHaveLength(2);
      expect(report.events.map((e) => e.label)).toEqual(['GEOL101', 'PHIL220']);
      // The unrelated Daily note's two ordinary task-list lines are counted
      // as an internal diagnostic but never make it a candidate.
      expect(report.totalUnparseableLines).toBe(2);
    });
  });

  it('discovery miss: an unfamiliar overall format degrades to "no calendar signal" — empty, not an error', () => {
    const vault = new MemoryVault({
      'Daily/2026-01-10.md': ['# Groceries', '- [ ] milk', '- [ ] eggs'].join('\n'),
      '01 Courses/Geol 101/lecture-1.md': '# Lecture 1\n\nSome unrelated prose.',
    });

    return discoverScheduleEvents(vault).then((report) => {
      expect(report.candidateNotes).toEqual([]);
      expect(report.events).toEqual([]);
      // The report says so explicitly rather than the empty arrays alone
      // having to be trusted as "nothing went wrong."
      expect(report.notesScanned).toHaveLength(2);
    });
  });

  it('an empty vault (no markdown notes at all) also degrades to "no calendar signal", never throws', () => {
    const vault = new MemoryVault({});
    return discoverScheduleEvents(vault).then((report) => {
      expect(report.notesScanned).toEqual([]);
      expect(report.candidateNotes).toEqual([]);
      expect(report.events).toEqual([]);
      expect(report.totalUnparseableLines).toBe(0);
    });
  });

  it('only markdown notes are scanned', () => {
    const vault = new MemoryVault({
      'Imports/synced.csv': '- [ ] GEOL101 - Monday 10:00-11:00 📅 2026-01-12',
    });
    return discoverScheduleEvents(vault).then((report) => {
      expect(report.notesScanned).toEqual([]);
      expect(report.candidateNotes).toEqual([]);
    });
  });
});
