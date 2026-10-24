/**
 * `ol-egov.141.89.2.39` ([D-626], [D-628]): input-note fixtures for tests whose drafting call is a
 * test double.
 *
 * In production every drafted result carries the notes its request was drawn from, each with the
 * fingerprint of the material supplied (`src/retrieval/draft-quiz-cards.ts`,
 * `inputNotesOfSuppliedChunks`), and every writer records them on the draft. A draft with none is
 * one recorded before input notes were: the sweep drafts it again, and it is withheld before
 * presentation. A test double that stands in for the drafting call therefore reports input notes
 * too: {@link SYNTHETIC_INPUT_NOTES} for a test whose drafts are never presented or accepted, and
 * {@link currentInputNotes} (the notes' real fingerprints, as they stand) for one that presents or
 * accepts them. Synthetic paths and content only.
 */
import type { VaultPath, VaultSource } from 'olea-core';
import { type InputNote, inputNoteFingerprint } from '../../src/generation/input-notes.js';

/** One synthetic input note, for a draft that is cached and deduped but never presented or kept. */
export const SYNTHETIC_INPUT_NOTES: readonly InputNote[] = Object.freeze([
  Object.freeze({ path: 'Courses/synthetic/input.md', contentHash: 'synthetic-fingerprint' }),
]);

/** The input notes `paths` give as they stand in `vault`: each path with its current fingerprint. */
export async function currentInputNotes(
  vault: VaultSource,
  ...paths: readonly VaultPath[]
): Promise<readonly InputNote[]> {
  const notes: InputNote[] = [];
  for (const path of paths) {
    const contentHash = await inputNoteFingerprint(vault, path);
    if (contentHash === undefined) {
      throw new Error(`currentInputNotes: ${path} cannot be read in the test vault`);
    }
    notes.push({ path, contentHash });
  }
  return notes;
}
