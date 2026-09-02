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

// F8.8 free text (Sep 2026, `[D-190]`): "on acceptance she may add an
// optional line of her own ... written beneath a heading of her own in the
// same note — read by nothing ... the note stays immutable after acceptance
// exactly as now."
describe('the optional own-words line (`[D-190]`)', () => {
  it('accepting with a line adds it under its own heading, in the same note', () => {
    const content = buildRetrospectiveNoteContent(
      reading(),
      '2026-09-02T10:00:00.000Z',
      'I rushed the last section and it showed.',
    );
    expect(content).toContain('## In your own words');
    expect(content).toContain('I rushed the last section and it showed.');
    // Same note, not a second file — the computed sections are still present.
    expect(content).toContain('What held');
  });

  it('accepting without a line adds nothing — no heading, no empty section', () => {
    const content = buildRetrospectiveNoteContent(reading(), '2026-09-02T10:00:00.000Z');
    expect(content).not.toContain('In your own words');
  });

  it('a whitespace-only line is treated the same as no line at all', () => {
    const content = buildRetrospectiveNoteContent(reading(), '2026-09-02T10:00:00.000Z', '   ');
    expect(content).not.toContain('In your own words');
  });

  it('writeRetrospectiveNote passes the line through end to end', async () => {
    const { vault, written } = fakeVault();
    const path = await writeRetrospectiveNote(
      vault,
      reading(),
      () => new Date('2026-09-02T10:00:00.000Z'),
      'This one is mine.',
    );
    expect(written.get(path)).toContain('This one is mine.');
  });

  it('writeRetrospectiveNote with no line supplied writes no heading for it', async () => {
    const { vault, written } = fakeVault();
    const path = await writeRetrospectiveNote(
      vault,
      reading(),
      () => new Date('2026-09-02T10:00:00.000Z'),
    );
    expect(written.get(path)).not.toContain('In your own words');
  });

  it('the note stays immutable after acceptance — this module exports no way to update or rewrite an existing note', async () => {
    const module = await import('../../src/retrospective/note-writer.js');
    const exportNames = Object.keys(module);
    expect(exportNames).toEqual(
      expect.arrayContaining([
        'RETROSPECTIVE_NOTES_FOLDER',
        'retrospectiveNotePath',
        'buildRetrospectiveNoteContent',
        'writeRetrospectiveNote',
      ]),
    );
    // No `update*`/`rewrite*`/`append*` export exists — the only way to add
    // words to a kept retrospective is a fresh `writeRetrospectiveNote` call,
    // which `retrospectiveNotePath`'s per-acceptance timestamp always turns
    // into a NEW file (asserted above, "never collides").
    expect(exportNames.some((name) => /^(update|rewrite|append|edit)/i.test(name))).toBe(false);
  });

  it('accepting the SAME reading twice with different lines never overwrites the earlier note', async () => {
    const { vault, written } = fakeVault();
    const first = await writeRetrospectiveNote(
      vault,
      reading(),
      () => new Date('2026-09-02T10:00:00.000Z'),
      'First pass.',
    );
    const second = await writeRetrospectiveNote(
      vault,
      reading(),
      () => new Date('2026-09-05T10:00:00.000Z'),
      'Second pass.',
    );
    expect(first).not.toBe(second);
    expect(written.get(first)).toContain('First pass.');
    expect(written.get(first)).not.toContain('Second pass.');
    expect(written.get(second)).toContain('Second pass.');
    expect(written.get(second)).not.toContain('First pass.');
  });
});
