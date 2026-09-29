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
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import {
  ensureHomeNoteForConcept,
  HOME_NOTE_MARKER_KEY,
  hashSourceRevision,
  homeNotePathForSource,
  isOleaHomeNote,
} from '../../src/generation/home-note.js';
import { StaleSourceRevisionError } from '../../src/generation/materialize-mcq.js';
import type { DraftRecord } from '../../src/generation/types.js';
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

  it('[D-214] never returns the source itself: a source that is already .md gets a distinguishing suffix, not a self-collision', () => {
    // The naive rule (strip extension, re-add `.md`) is a no-op for a
    // source that is already markdown — an authored note, `ol-0r92.45`'s
    // caller. Returning the source unchanged would make
    // `ensureHomeNoteForConcept` read HER note back, find no Olea marker,
    // and return `null` — silently drafting nothing for every authored
    // note, forever. This is the one collision `[D-179]`'s original rule
    // never had to consider (no PDF/PPTX/DOCX/image source ends in `.md`).
    const sourcePath = 'Zettelkasten/My Thoughts.md';
    const homeNotePath = homeNotePathForSource(sourcePath);
    expect(homeNotePath).not.toBe(sourcePath);
    expect(homeNotePath).toBe('Zettelkasten/My Thoughts (Olea).md');
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

  it('[D-214] an authored note as the source gets a sibling home note beside it, and her note is never read as reusable or written into', async () => {
    const authoredNotePath = 'Zettelkasten/My Thoughts.md';
    const herProse = '# My Thoughts\n\nSomething she actually wrote.\n';
    const vault = new MemoryVaultSource({ [authoredNotePath]: herProse });

    const result = await ensureHomeNoteForConcept(vault, authoredNotePath, 'Osmosis');

    const expectedHomeNotePath = homeNotePathForSource(authoredNotePath);
    expect(expectedHomeNotePath).not.toBe(authoredNotePath);
    expect(result).toBe(expectedHomeNotePath);

    // Her note is byte-identical to before — this module never opened it
    // for writing, let alone wrote into it (INV-6, `[D-214]`).
    expect(vault.raw(authoredNotePath)).toBe(herProse);

    const homeContent = vault.raw(expectedHomeNotePath) ?? '';
    expect(isOleaHomeNote(homeContent)).toBe(true);
    const fm = frontmatterOf(homeContent);
    expect(readList(fm, 'topic').items).toEqual(['Osmosis']);
  });
});

describe('ol-egov.141.6.27 — several concepts drafted into one home note stay answerable', () => {
  const SOURCE = '01 Courses/GEOL204/Lecture 4.pdf';
  const CONCEPTS = ['Osmosis', 'Diffusion', 'Tonicity'];

  function draftFor(name: string, hash: string, index: number): DraftRecord {
    return {
      draftId: `draft-${index}`,
      status: 'pending',
      courseCode: 'GEOL204',
      conceptName: name,
      conceptIds: [`key-${index}`],
      sourcePath: homeNotePathForSource(SOURCE),
      sourceContentHash: hash,
      createdAt: '2026-09-29T09:00:00-07:00',
      question: {
        stem: `Question about ${name}?`,
        correctAnswer: 'Right',
        distractors: ['A', 'B', 'C', 'D'],
        feedback: 'See the source.',
      },
      provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
      firstServedAt: null,
    };
  }

  async function draftAll() {
    const vault = new MemoryVaultSource();
    const cache = createVaultDraftCacheStore(vault);
    let e = 0;
    const port = createDraftAcceptPort({
      vault,
      cache,
      deviceId: 'device-a',
      now: () => new Date('2026-09-29T10:00:00-07:00'),
      generateEventId: () => `event-${++e}`,
    });
    // Exactly the pipeline's order per concept: ensure the note, hash it, cache the draft.
    for (const [i, name] of CONCEPTS.entries()) {
      const notePath = await ensureHomeNoteForConcept(vault, SOURCE, name);
      if (notePath === null) throw new Error('home note unexpectedly refused');
      const hash = await hashSourceRevision(await vault.read(notePath));
      await cache.put(draftFor(name, hash, i));
    }
    return { vault, port };
  }

  it('answering the FIRST concept after the later ones grew the note accepts, not StaleSourceRevisionError', async () => {
    const { port } = await draftAll();
    await expect(port.accept('draft-0', 'accepted')).resolves.toMatchObject({
      instrumentId: expect.any(String),
    });
  });

  it('every draft is accepted in turn even though each accept inserts an item into the shared note', async () => {
    const { vault, port } = await draftAll();
    for (const i of [0, 1, 2]) {
      await expect(port.accept(`draft-${i}`, 'accepted')).resolves.toBeDefined();
    }
    expect(vault.raw(homeNotePathForSource(SOURCE))).toContain('Question about Tonicity?');
  });

  it('a real change to a note she wrote is still refused (the guard is not weakened)', async () => {
    const { vault, port } = await draftAll();
    const path = homeNotePathForSource(SOURCE);
    const note = vault.raw(path) ?? '';
    await vault.write(path, note.replace('Olea created this note', 'Someone rewrote this note'));
    await expect(port.accept('draft-0', 'accepted')).rejects.toThrow(StaleSourceRevisionError);
  });
});
