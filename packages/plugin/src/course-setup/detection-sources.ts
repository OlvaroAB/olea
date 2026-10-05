/**
 * Which vault files count as course material when detection looks for a course
 * folder (`features/F1-sources.md`, "a course folder holding no Markdown notes
 * is still proposed"; F3.1, `[D-179]`: placing the file in a course folder is
 * the whole registration step, so a proposal never depends on a note).
 *
 * The format list is not a second one: PDF, slides, documents and images come
 * from `olea-core`'s `formatFromExtension` (the extraction registry, C3.1/C3.3),
 * and the two text formats Olea reads outside extraction, Markdown notes and
 * `.txt` transcripts, are named here. Everything else (a system file, an
 * audio file) is not material and proposes nothing.
 */
import { formatFromExtension, type VaultPath } from 'olea-core';

/** The text formats read outside the extraction registry: notes and plain-text transcripts. */
const TEXT_MATERIAL_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'txt']);

/** True when `path` is a file Olea reads as course material. */
export function isCourseMaterialPath(path: VaultPath): boolean {
  if (formatFromExtension(path) !== null) return true;
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/')) return false;
  return TEXT_MATERIAL_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/** Keeps only the paths that are course material, in their given order. */
export function courseMaterialPaths(paths: readonly VaultPath[]): readonly VaultPath[] {
  return paths.filter(isCourseMaterialPath);
}
