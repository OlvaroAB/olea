/**
 * `ol-egov.141.89.2.39` ([D-626], [D-628]): a clearing row names the note its draft was drawn from,
 * and a draft drawn from several notes names them all.
 *
 * Scenarios (service repo, `features/F3-learn-from-anything.md`, "Feature: F3.3 / C5.3 — a drafted
 * item records every note it was drawn from, and each protects it"), written before this code:
 *  - "a draft drawn from several notes is never shown with one sole source": its origin is the
 *    "Sources" label (vocabulary registry §34), expanding to one link per input note showing each
 *    note's title, and neither the concept's note nor the note that supplied the most chunks is
 *    shown as its sole source;
 *  - "a clearing group shows a shared origin once, and differing origins per item".
 *
 * The view model is pinned through `buildBulkReviewGroups` and the controller; the DOM half
 * (`bulk-review-view.ts`, which needs Obsidian's runtime) is pinned at source level, as
 * `bulk-review-view-source.spec.ts` pins the rest of that file. Synthetic notes only.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type BulkReviewOrigin,
  buildBulkReviewGroups,
  createBulkReviewController,
} from '../../src/generation/bulk-review.js';
import { BULK_REVIEW_SOURCES_LABEL } from '../../src/generation/bulk-review-copy.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { SOURCE_LOCATIONS_HEADING } from '../../src/registry/copy.js';
import { MemoryVaultSource } from './fakes.js';

const HOME = '01 Courses/COURSEA/Week 1 (Olea).md';
const CONCEPT_NOTE = '01 Courses/COURSEA/Week 1.md';
const NOTE_A = '01 Courses/COURSEA/Week 2.md';
const NOTE_B = '01 Courses/COURSEA/Week 3.md';
const NOTE_C = '01 Courses/COURSEA/Reading 4.md';
const SLIDES = '01 Courses/COURSEA/Slides 5.pdf';

const note = (path: string) => ({ path, contentHash: `fingerprint-of-${path}` });

function draft(id: string, overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: id,
    status: 'pending',
    courseCode: 'COURSEA',
    conceptName: 'Invented layering',
    conceptIds: ['concept-key-1'],
    sourcePath: HOME,
    // The concept's own note: what the citation named before [D-626], kept for internal readers.
    sourceCitation: { sourcePath: CONCEPT_NOTE, page: 1 },
    createdAt: `2026-10-24T09:00:0${id.slice(-1)}-07:00`,
    question: {
      stem: `Which invented statement holds? (${id})`,
      correctAnswer: 'Alpha',
      distractors: ['Beta', 'Gamma', 'Delta'],
      feedback: 'See the invented notes.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '2.5.0', modelId: 'test-model' },
    firstServedAt: null,
    ...overrides,
  };
}

function originText(origin: BulkReviewOrigin | undefined): string {
  if (origin === undefined) return '';
  return origin.kind === 'line'
    ? origin.text
    : `${BULK_REVIEW_SOURCES_LABEL}: ${origin.notes.map((n) => n.title).join(' | ')}`;
}

describe('a draft drawn from several notes is never shown with one sole source', () => {
  it('its origin is the "Sources" list, one link per input note with its title, in the order recorded', () => {
    // NOTE_A supplied the most chunks (it would be first and heaviest), the concept's note is cited.
    const [group] = buildBulkReviewGroups([
      draft('d1', { inputNotes: [note(NOTE_A), note(NOTE_B), note(NOTE_C)] }),
    ]);
    expect(group?.origin).toEqual({
      kind: 'sources',
      notes: [
        { path: NOTE_A, title: 'Week 2' },
        { path: NOTE_B, title: 'Week 3' },
        { path: NOTE_C, title: 'Reading 4' },
      ],
    });
    // Nothing names one note as the source: not the concept's note, not the heaviest note.
    const shown = originText(group?.origin);
    expect(shown).not.toMatch(/^From /);
    expect(shown).not.toContain('Week 1');
  });

  it('the label is the registry’s plain label for an item’s sources (§34), imported, not restated', () => {
    expect(BULK_REVIEW_SOURCES_LABEL).toBe('Sources');
    expect(BULK_REVIEW_SOURCES_LABEL).toBe(SOURCE_LOCATIONS_HEADING);
  });

  it('a draft drawn from one note names that note, never the concept’s note its citation once named', () => {
    const [kept] = buildBulkReviewGroups([draft('d1', { inputNotes: [note(NOTE_B)] })]);
    expect(kept?.origin).toEqual({ kind: 'line', text: 'From your notes, Week 3.' });
    const [read] = buildBulkReviewGroups([draft('d1', { inputNotes: [note(SLIDES)] })]);
    expect(read?.origin).toEqual({ kind: 'line', text: 'From your reading on Slides 5.' });
    const [hers] = buildBulkReviewGroups([draft('d1', { inputNotes: [note(NOTE_B)] })], (path) =>
      path === NOTE_B ? 'me' : undefined,
    );
    expect(hers?.origin).toEqual({ kind: 'line', text: 'From a note you wrote, Week 3.' });
  });
});

describe('a clearing group shows a shared origin once, and differing origins per item', () => {
  it('every draft with the same input notes: the group carries the origin once and no row repeats it', () => {
    for (const notes of [[note(NOTE_B)], [note(NOTE_A), note(NOTE_B)]]) {
      const [group] = buildBulkReviewGroups([
        draft('d1', { inputNotes: notes }),
        // The same notes recorded in another order are the same origin.
        draft('d2', { inputNotes: [...notes].reverse() }),
      ]);
      expect(group?.items).toHaveLength(2);
      expect(group?.origin).toBeDefined();
      for (const item of group?.items ?? []) expect(item.origin).toBeUndefined();
    }
  });

  it('drafts drawn from different notes: each row shows its own, so none is shown a note it was not drawn from', () => {
    const [group] = buildBulkReviewGroups([
      draft('d1', { inputNotes: [note(NOTE_A)] }),
      draft('d2', { inputNotes: [note(NOTE_A), note(NOTE_C)] }),
      draft('d3', { inputNotes: [note(NOTE_B)] }),
    ]);
    expect(group?.origin).toBeUndefined();
    expect(group?.items.map((item) => originText(item.origin))).toEqual([
      'From your notes, Week 2.',
      'Sources: Week 2 | Reading 4',
      'From your notes, Week 3.',
    ]);
  });

  it('the controller lists only drafts whose notes still hold when it is told how to check them', async () => {
    const vault = new MemoryVaultSource({ [HOME]: '# Week 1 (Olea)\n' });
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(draft('d1', { inputNotes: [note(NOTE_A)] }));
    await cache.put(draft('d2', { inputNotes: [note(NOTE_B)] }));
    await cache.put(draft('d3'));
    const controller = createBulkReviewController({
      cache,
      acceptPort: { accept: async () => ({ instrumentId: 'x' }), reject: async () => {} },
      editPort: { edit: async () => {} },
      holds: async (record) => record.inputNotes?.[0]?.path === NOTE_A,
    });
    await controller.load();
    const items = controller.getViewModel().groups.flatMap((group) => group.items);
    expect(items.map((item) => item.draftId)).toEqual(['d1']);
  });
});

describe('the view renders the origin once per group, and the "Sources" disclosure with links (source level)', () => {
  const code = readFileSync(
    fileURLToPath(new URL('../../src/generation/bulk-review-view.ts', import.meta.url)),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('a shared origin is rendered once, above the group’s rows; a row renders only its own', () => {
    expect(code).toMatch(
      /if \(groupOrigin !== undefined && items\.length > 0\) \{\s*this\.renderOrigin\(section\.createDiv\(\{ cls: 'olea-bulk-review-group-source' \}\), groupOrigin\);/,
    );
    expect(code).toMatch(
      /if \(source !== null && item\.origin !== undefined\) this\.renderOrigin\(source, item\.origin\);/,
    );
  });

  it('several notes: a details element whose summary is the label, listing each title as a link to the note', () => {
    expect(code).toMatch(/createEl\('details', \{ cls: 'olea-bulk-review-sources' \}\)/);
    expect(code).toMatch(/createEl\('summary', \{ text: BULK_REVIEW_SOURCES_LABEL \}\)/);
    expect(code).toMatch(
      /createEl\('a', \{\s*cls: 'olea-bulk-review-source-link',\s*text: note\.title,/,
    );
    expect(code).toMatch(/open\(note\.path\);/);
  });
});
