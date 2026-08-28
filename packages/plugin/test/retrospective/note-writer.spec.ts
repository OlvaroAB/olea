import type { RetrospectiveReading, VaultPath, VaultSource } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildRetrospectiveNoteContent,
  RETROSPECTIVE_NOTES_FOLDER,
  retrospectiveNotePath,
  writeRetrospectiveNote,
} from '../../src/retrospective/note-writer.js';

function reading(overrides: Partial<RetrospectiveReading> = {}): RetrospectiveReading {
  return {
    assessmentPath: 'Courses/C1/Final.md',
    course: 'C1',
    scopeOrigin: 'evidenced',
    scopeCount: 2,
    held: [
      { conceptId: 'c-held', conceptName: 'Held concept', stage: 'sapling', vitality: 'holding' },
    ],
    faded: [],
    tooEarlyCount: 1,
    carries: [],
    ...overrides,
  };
}

function fakeVault(): { vault: VaultSource; written: Map<VaultPath, string> } {
  const written = new Map<VaultPath, string>();
  const vault: VaultSource = {
    list: async () => [],
    read: async (path) => written.get(path) ?? '',
    readBinary: async () => new Uint8Array(),
    write: async (path, content) => {
      written.set(path, content);
    },
    exists: async (path) => written.has(path),
    delete: async (path) => {
      written.delete(path);
    },
    watch: () => () => {},
  };
  return { vault, written };
}

describe('retrospectiveNotePath', () => {
  it('lives under .olea/retrospectives — Olea-owned, never her authored notes (INV-6)', () => {
    expect(retrospectiveNotePath('Courses/C1/Final.md', '2026-09-02T10:00:00.000Z')).toContain(
      RETROSPECTIVE_NOTES_FOLDER,
    );
  });

  it('never collides across two acceptances of the same assessment', () => {
    const a = retrospectiveNotePath('Courses/C1/Final.md', '2026-09-02T10:00:00.000Z');
    const b = retrospectiveNotePath('Courses/C1/Final.md', '2026-09-05T10:00:00.000Z');
    expect(a).not.toBe(b);
  });
});

describe('buildRetrospectiveNoteContent', () => {
  it('renders all three groupings plus the stated too-early count, and no verdict', () => {
    const content = buildRetrospectiveNoteContent(reading(), '2026-09-02T10:00:00.000Z');
    expect(content).toContain('What held');
    expect(content).toContain('What faded');
    expect(content).toContain('too early to say');
    expect(content).not.toMatch(/%|\bpercent\b|\bwell done\b|\bgood job\b/i);
  });

  it('never claims to know how the assessment went', () => {
    const content = buildRetrospectiveNoteContent(reading(), '2026-09-02T10:00:00.000Z');
    expect(content).toMatch(/never saw the assessment/i);
  });
});

describe('writeRetrospectiveNote', () => {
  it('writes exactly one file under .olea/retrospectives/, returning its path', async () => {
    const { vault, written } = fakeVault();
    const path = await writeRetrospectiveNote(
      vault,
      reading(),
      () => new Date('2026-09-02T10:00:00.000Z'),
    );
    expect(path.startsWith(`${RETROSPECTIVE_NOTES_FOLDER}/`)).toBe(true);
    expect(written.size).toBe(1);
    expect(written.get(path)).toContain('What held');
  });
});
