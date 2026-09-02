/**
 * `ensureHomeNoteForConcept` unit tests (F3.1/F3.3, `[D-179]` / `[SRC-2]`,
 * `ol-ho93`, INV-6). `pipeline.spec.ts`'s "a bare drop with no embedding
 * note" suite covers the sweep-level integration (course derivation,
 * dedupe against `MAX_CONCEPTS_PER_SWEEP` etc.); this file is the direct,
 * unit-level proof of naming, creation, idempotent reuse, topic growth and
 * the collision guard.
 */
import { parseDocument, parseFrontmatter, readList } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  ensureHomeNoteForConcept,
  HOME_NOTE_MARKER_KEY,
  homeNotePathForSource,
  isOleaHomeNote,
} from '../../src/generation/home-note.js';
import { MemoryVaultSource } from './fakes.js';

function frontmatterOf(content: string): ReturnType<typeof parseFrontmatter> {
  const first = parseDocument(content).blocks[0];
  if (first?.kind !== 'frontmatter') throw new Error('no frontmatter block found in test content');
  return parseFrontmatter(first.inner);
}

describe('homeNotePathForSource', () => {
  it('names the note from the source file stem, beside it, with a .md extension', () => {
    expect(homeNotePathForSource('01 Courses/GEOL204/Lecture 4.pdf')).toBe(
      '01 Courses/GEOL204/Lecture 4.md',
    );
  });

  it('handles a source sitting loose at vault root', () => {
    expect(homeNotePathForSource('Lecture 4.pdf')).toBe('Lecture 4.md');
  });

  it('handles a source with no extension by using the whole file name as the stem', () => {
    expect(homeNotePathForSource('01 Courses/GEOL204/README')).toBe('01 Courses/GEOL204/README.md');
  });
});

describe('isOleaHomeNote', () => {
  it('is false for a note with no frontmatter at all', () => {
    expect(isOleaHomeNote('# Her note\n\nJust prose.\n')).toBe(false);
  });

  it('is false for a note whose frontmatter carries no marker key', () => {
    expect(isOleaHomeNote('---\ntopic: [[Something]]\n---\n\nHer prose.\n')).toBe(false);
  });

  it('is true for a note carrying the marker key', () => {
    expect(isOleaHomeNote(`---\ntopic:\n${HOME_NOTE_MARKER_KEY}: true\n---\n`)).toBe(true);
  });
});

describe('ensureHomeNoteForConcept', () => {
  const SOURCE_PATH = '01 Courses/GEOL204/Lecture 4.pdf';
  const NOTE_PATH = homeNotePathForSource(SOURCE_PATH);

  it("creates the note beside the source, marked as Olea's own, with no course: key (F3.1/F3.3: course is folder-derived, never from this note)", async () => {
    const vault = new MemoryVaultSource();

    const result = await ensureHomeNoteForConcept(vault, SOURCE_PATH, 'Stratigraphy');

    expect(result).toBe(NOTE_PATH);
    const content = vault.raw(NOTE_PATH) ?? '';
    expect(content).not.toBe('');
    expect(isOleaHomeNote(content)).toBe(true);
    expect(content).not.toMatch(/^course:/m);

    const fm = frontmatterOf(content);
    expect(readList(fm, 'topic').items).toEqual(['Stratigraphy']);
  });

  it('is idempotent: calling it again for the same concept does not rewrite the note', async () => {
    const vault = new MemoryVaultSource();
    await ensureHomeNoteForConcept(vault, SOURCE_PATH, 'Stratigraphy');
    const firstWrite = vault.raw(NOTE_PATH);

    const result = await ensureHomeNoteForConcept(vault, SOURCE_PATH, 'Stratigraphy');

    expect(result).toBe(NOTE_PATH);
    expect(vault.raw(NOTE_PATH)).toBe(firstWrite);
  });

  it('reuses the same note across concepts, growing topic: rather than duplicating the note', async () => {
    const vault = new MemoryVaultSource();
    await ensureHomeNoteForConcept(vault, SOURCE_PATH, 'Stratigraphy');
    await ensureHomeNoteForConcept(vault, SOURCE_PATH, 'Cross-bedding');

    const allPaths = await vault.list();
    expect(allPaths.filter((p) => p === NOTE_PATH)).toHaveLength(1);

    const fm = frontmatterOf(vault.raw(NOTE_PATH) ?? '');
    expect(readList(fm, 'topic').items).toEqual(['Stratigraphy', 'Cross-bedding']);
  });

  it('never touches an existing file at the same path that carries no Olea marker (INV-6)', async () => {
    const herNote = '# Lecture 4\n\nHer own notes, coincidentally sharing this file name.\n';
    const vault = new MemoryVaultSource({ [NOTE_PATH]: herNote });

    const result = await ensureHomeNoteForConcept(vault, SOURCE_PATH, 'Stratigraphy');

    expect(result).toBeNull();
    expect(vault.raw(NOTE_PATH)).toBe(herNote);
  });
});
