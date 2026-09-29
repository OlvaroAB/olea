/**
 * What the vault holds now, as the processed-revision store's rebuild reads it
 * (`ol-egov.141.89.11.24`, `[D-426]`, row 25 of the 2026-09-29 rulings): "current content can be
 * reread, but its historical first-processed day cannot generally be reconstructed from today's
 * vault". This module is the rereading. It recovers each course file's **fingerprint** and
 * **state**, and by construction nothing else: a listing has no day in it, so the rebuild
 * (`./store.ts`'s `applyRebuild`) records every version it had no row for with an unknown day.
 *
 * ## Where each fact is read from
 *
 *  - **Notes** (markdown): read from the vault. The fingerprint is the SHA-256 of the text
 *    (`hashText`); the state is `read` (a note is read by the block parser, never by an extractor, and
 *    a read that fails rejects the listing rather than guessing). The courses are the note's own
 *    `course` list when it has one, else the course its folder names (`notePathCourses`, F1.3), the
 *    same derivation the verdict-gated arrival path used. A note with no course, no text, or that is
 *    one of Olea's own home notes (`isOleaHomeNote`: her authored notes only, INV-6's other half) is
 *    not a course file and is not listed. "No text" is a Class A approximation of the materiality
 *    free gate's "no groundable content", which needs the text's canonical form.
 *  - **Embedded sources** (pdf, pptx, docx, image, under the courses folder): read from the source
 *    reading, `manifestsFor`, the reader boundary of the durable unit manifest
 *    (`grove/unit-manifest-store.ts`, `[D-445]`), which enumerates a source before answering. The
 *    fingerprint is the manifest's revision digest, the same `hashContent` a queue job is keyed by, so
 *    a version recorded when its job finished and the same version found here are one fingerprint. The
 *    state folds the manifest by `readRecordOf` (the fold the coverage screen uses): read if any page
 *    has material, unreadable if a page failed or was not legible, **and unreadable if every page was
 *    blank or held no text** (`[D-426]`: an empty or image-only source is counted unreadable), pending
 *    if pages are still unread. A source the reading could not enumerate is unreadable, fingerprinted
 *    from its own bytes; a source nothing has read yet (the unknown reading, digest `unverified`) is
 *    pending, fingerprinted the same way; with no source reading supplied every source is pending.
 *
 * ## Only whole listings
 *
 * The listing rejects when a course file cannot be read. A rebuild marks the store rebuilt, and a
 * store that is rebuilt says what it holds, so a partial listing would leave a course reading as if
 * nothing had arrived. Rejecting leaves the store as it was; the next start tries again.
 *
 * **Never writes.** It reads the vault and the manifest reader only (INV-6). **D-005:** no logging.
 */

import {
  courseFromPath,
  DEFAULT_COURSES_FOLDER,
  formatFromExtension,
  hashContent,
  hashText,
  notePathCourses,
  parseDocument,
  parseFrontmatter,
  readList,
  readRecordOf,
  type UnitManifest,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { UNVERIFIED_REVISION_DIGEST } from '../../../../core/src/ingestion/unit-manifest/projection.js';
import { isOleaHomeNote } from '../../generation/home-note.js';
import type { ProcessedRevisionInput, ProcessingState } from './store.js';

export interface CurrentRevisionsDeps {
  readonly vault: VaultSource;
  /**
   * The source reading's reader boundary: each supported path's manifest, or the unknown one, and
   * a path it cannot enumerate left out. Omitted, every embedded source lists as pending.
   */
  readonly manifestsFor?: (
    paths: readonly VaultPath[],
  ) => Promise<ReadonlyMap<VaultPath, UnitManifest>>;
  /** Defaults to F1.3's `DEFAULT_COURSES_FOLDER`. */
  readonly coursesFolder?: VaultPath;
}

/** True for a path with a dot-prefixed segment: Olea's own layer, Obsidian's config, the trash. Never her material. */
function isHidden(path: VaultPath): boolean {
  return path.split('/').some((segment) => segment.startsWith('.'));
}

function isMarkdown(path: VaultPath): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * The store's input for one note as it reads now, or `null` when it is not a course file (no
 * course, no text, or one of Olea's own home notes). The one derivation both the rebuild and a
 * processing moment use, so a note recorded when it was processed and the same note found later are
 * one fingerprint with the same courses.
 */
export async function processedNoteRevision(
  path: VaultPath,
  text: string,
  state: ProcessingState,
  coursesFolder: VaultPath = DEFAULT_COURSES_FOLDER,
): Promise<ProcessedRevisionInput | null> {
  if (text.trim().length === 0) return null;
  if (isOleaHomeNote(text)) return null;
  const first = parseDocument(text).blocks[0];
  const frontmatter = first?.kind === 'frontmatter' ? parseFrontmatter(first.inner) : null;
  const courses = notePathCourses(
    path,
    frontmatter === null ? [] : readList(frontmatter, 'course').items,
    coursesFolder,
  );
  if (courses.length === 0) return null;
  return { path, courses, fingerprint: await hashText(text), state };
}

/** A manifest's processing state, by the fold the coverage screen uses. `[D-426]`: empty or image-only counts unreadable. */
function stateOfManifest(manifest: UnitManifest): ProcessingState {
  const record = readRecordOf(manifest);
  if (record === null) return 'pending';
  switch (record.readState) {
    case 'read':
      return 'read';
    case 'not-attempted':
      return 'pending';
    case 'unreadable':
    case 'read-yielded-nothing':
      return 'unreadable';
  }
}

/** Every course file the vault holds now, with its fingerprint and state. Rejects if any could not be read. */
export async function listCurrentRevisions(
  deps: CurrentRevisionsDeps,
): Promise<readonly ProcessedRevisionInput[]> {
  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;
  const paths = (await deps.vault.list()).filter((path) => !isHidden(path));
  const out: ProcessedRevisionInput[] = [];

  for (const path of paths.filter(isMarkdown)) {
    const revision = await processedNoteRevision(
      path,
      await deps.vault.read(path),
      'read',
      coursesFolder,
    );
    if (revision !== null) out.push(revision);
  }

  const sources = paths.filter(
    (path) =>
      !isMarkdown(path) &&
      formatFromExtension(path) !== null &&
      courseFromPath(path, coursesFolder) !== undefined,
  );
  const manifests =
    sources.length > 0 && deps.manifestsFor !== undefined
      ? await deps.manifestsFor(sources)
      : undefined;
  for (const path of sources) {
    const course = courseFromPath(path, coursesFolder);
    if (course === undefined) continue;
    const manifest = manifests?.get(path);
    if (manifest !== undefined && manifest.revisionDigest !== UNVERIFIED_REVISION_DIGEST) {
      out.push({
        path,
        courses: [course],
        fingerprint: manifest.revisionDigest,
        state: stateOfManifest(manifest),
      });
      continue;
    }
    // No verified reading of these bytes: fingerprint them here. Pending when a reading exists but
    // has not settled on this revision (or none was supplied); unreadable when the reading was asked
    // and could not enumerate the source.
    out.push({
      path,
      courses: [course],
      fingerprint: await hashContent(await deps.vault.readBinary(path)),
      state: manifests !== undefined && manifest === undefined ? 'unreadable' : 'pending',
    });
  }
  return out;
}
