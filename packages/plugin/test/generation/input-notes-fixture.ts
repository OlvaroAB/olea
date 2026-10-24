/**
 * `ol-egov.141.89.2.39` ([D-626], [D-628]): input-note fixtures for tests whose drafting call is a
 * test double.
 *
 * In production every drafted result carries the notes its request was drawn from, each with the
 * fingerprint of the material supplied (`src/retrieval/draft-quiz-cards.ts`,
 * `inputNotesOfSuppliedChunks`), and every writer records them on the draft. A draft with none is
 * one recorded before input notes were: the sweep drafts it again, and it is withheld before
 * presentation. A pending draft whose input notes no longer read as recorded (a note changed, gone
 * or unreadable) is stale the same way (finding G): the sweep drafts the concept again rather than
 * counting it a duplicate. A test double that stands in for the drafting call therefore reports
 * input notes that stand in the test's vault: {@link SYNTHETIC_INPUT_NOTES}, whose one note a test
 * seeds by spreading {@link SYNTHETIC_INPUT_FILES} into its vault's files, for a test that only
 * caches and dedupes; {@link currentInputNotes} (the notes' real fingerprints, as they stand) for one
 * that presents or accepts them. Synthetic paths and content only.
 */
import type { VaultPath, VaultSource } from 'olea-core';
import {
  type InputNote,
  inputNoteFingerprint,
  markdownFingerprint,
} from '../../src/generation/input-notes.js';

/** The one synthetic input note's path: outside every course folder, so no sweep or walk scopes it. */
export const SYNTHETIC_INPUT_NOTE_PATH: VaultPath = 'Synthetic/input.md';
const SYNTHETIC_INPUT_NOTE_TEXT =
  '# Synthetic input\n\nAn invented sentence a drafting double reports drafting from.\n';

/** Spread into a test vault's initial files, so {@link SYNTHETIC_INPUT_NOTES} reads as it was drafted. */
export const SYNTHETIC_INPUT_FILES: Readonly<Record<string, string>> = Object.freeze({
  [SYNTHETIC_INPUT_NOTE_PATH]: SYNTHETIC_INPUT_NOTE_TEXT,
});

/** One synthetic input note, with its real fingerprint, for a draft that is cached and deduped. */
export const SYNTHETIC_INPUT_NOTES: readonly InputNote[] = Object.freeze([
  Object.freeze({
    path: SYNTHETIC_INPUT_NOTE_PATH,
    contentHash: await markdownFingerprint(SYNTHETIC_INPUT_NOTE_TEXT),
  }),
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
