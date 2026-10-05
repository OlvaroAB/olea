/**
 * Step two's material for the grove (`ol-egov.141.89.7.51`; F8.2 as amended by `[D-465]`, C3.6):
 * the course's slide decks and supplied lecture transcripts in her vault, as text, for
 * `olea-core#produceTaughtSignals`. The producer decides; this module only gathers.
 *
 * **What a deck and a transcript are.** The client's lecture-file rule
 * (`../ingestion/lecture-links.ts#lectureKindOf`), by extension and declared role, never by name:
 * a `.pptx` or `.pdf` is a deck; a `.txt`, or a `.md` whose frontmatter declares a transcript
 * role, is a transcript. Whether a deck is in fact a registered past paper or objectives document
 * is the producer's check, against the registered sources, never this module's.
 *
 * **Where the text comes from, and what it costs per grove load.**
 *  - **Decks: no second extraction.** `extractTier3Evidence` already extracts every non-markdown
 *    file a note of hers embeds and every registered file, on every grove load, to cite the
 *    examiner's documents. Asked with `includeDerivedUnits`, it hands back that same text with the
 *    courses it attributed (the embedding note's `course`, else its course folder; a registered
 *    file's own course) and each page's template-heading offset. `deckMaterialFrom` only regroups
 *    it. Added cost: holding that text until the load returns; no file is read twice. A deck that
 *    no note embeds and nobody registered is not read here, as tier 3 does not read it.
 *  - **Transcripts: one read per candidate file.** Tier 3 reads no transcript (`.txt` is not an
 *    extractor format), and the transcript job's units live only in memory for the session
 *    (`../ingestion/pending-indexing-sink.ts`), so there is no landed copy to reuse.
 *    `readTranscriptMaterial` lists the courses folder for `.txt` and `.md` and reads each once
 *    (a `.md` to see whether it declares a transcript role, as the concept read does), then splits
 *    a transcript into the reader's own parts (`readTranscriptText`). Only the courses folder is
 *    read because a transcript's course is its course folder, exactly as the concept read
 *    attributes one (`olea-core#notePathCourses` with no explicit course): a transcript outside
 *    it has no course, so it could open nothing.
 *
 * Nothing here reads a date, a file time or an arrival order (David, 2026-10-05: material shows up
 * when it shows up). A file that cannot be read contributes nothing, as an unreadable transcript
 * contributes no passage to the concept read.
 */

import {
  type DerivedTextUnit,
  declaresTranscript,
  notePathCourses,
  readTranscriptText,
  type StepTwoMaterial,
  type StepTwoTextUnit,
  type TranscriptFormat,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { lectureKindOf } from '../ingestion/lecture-links.js';

/** Regroups tier 3's derived units into one deck per file content, keeping only what the lecture-file rule calls a deck. */
export function deckMaterialFrom(units: readonly DerivedTextUnit[]): StepTwoMaterial[] {
  const decks = new Map<
    VaultPath,
    {
      readonly duplicatePaths: readonly VaultPath[];
      readonly courses: readonly string[];
      readonly units: StepTwoTextUnit[];
    }
  >();
  for (const unit of units) {
    if (lectureKindOf(unit.sourcePath, undefined) !== 'deck') continue;
    let deck = decks.get(unit.sourcePath);
    if (deck === undefined) {
      deck = {
        duplicatePaths: unit.duplicateSourcePaths,
        courses: unit.courses.filter((course): course is string => course !== undefined),
        units: [],
      };
      decks.set(unit.sourcePath, deck);
    }
    deck.units.push(
      unit.templateHeadEnd > 0
        ? { text: unit.text, matchFrom: unit.templateHeadEnd }
        : { text: unit.text },
    );
  }
  return [...decks]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, deck]) => ({
      path,
      ...(deck.duplicatePaths.length > 0 ? { duplicatePaths: deck.duplicatePaths } : {}),
      courses: deck.courses,
      kind: 'deck' as const,
      units: deck.units,
    }));
}

/** One transcript's parts as step-two units, or `null` when the reader cannot read it. */
function transcriptUnits(content: string, format: TranscriptFormat): StepTwoTextUnit[] | null {
  const result = readTranscriptText(content, format);
  if (!result.ok) return null;
  return result.parts.map((part) => ({ text: part.text }));
}

/** Every supplied lecture transcript under `coursesFolder`, as step-two material. See the module doc for the cost. */
export async function readTranscriptMaterial(
  vault: VaultSource,
  coursesFolder: VaultPath,
): Promise<StepTwoMaterial[]> {
  const [textPaths, notePaths] = await Promise.all([
    vault.list({ under: coursesFolder, extensions: ['txt'] }),
    vault.list({ under: coursesFolder, extensions: ['md'] }),
  ]);
  const candidates: { readonly path: VaultPath; readonly format: TranscriptFormat }[] = [
    ...textPaths.map((path) => ({ path, format: 'plain-text' as const })),
    ...notePaths.map((path) => ({ path, format: 'markdown' as const })),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const material: StepTwoMaterial[] = [];
  for (const { path, format } of candidates) {
    let content: string;
    try {
      content = await vault.read(path);
    } catch {
      continue;
    }
    // A `.md` is her note unless it declares itself a transcript (D-465): never read as one otherwise.
    if (format === 'markdown' && !declaresTranscript(content)) continue;
    const units = transcriptUnits(content, format);
    if (units === null || units.length === 0) continue;
    material.push({
      path,
      courses: notePathCourses(path, [], coursesFolder),
      kind: 'transcript',
      units,
    });
  }
  return material;
}
