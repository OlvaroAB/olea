/**
 * Lecture bundles from her explicit links (D-465, C3.6 "Association is explicit";
 * `ol-egov.141.89.8.57`, discovered from `ol-egov.141.89.8.55`).
 *
 * `associateLectures` (core, `ol-egov.141.89.3.42`) is pure and reads `LinkedFile` lists; this module
 * is the producer that builds them from the vault's RESOLVED links, behind a port so the logic stays
 * free of `obsidian` (INV-1). Nothing is stored: `readLectureBundles` rebuilds from the port on every
 * call, so a removed link dissolves its bundle on the next read.
 *
 * EXPLICIT ONLY. The only edges are the ones the port reports (a note's link or embed, a
 * transcript's own link, including a frontmatter link as Obsidian resolves it). A file name or folder
 * is never compared. A path's kind comes from its extension and, for Markdown, from its cached
 * frontmatter `role` (the same declaration the transcript reader uses), never from its name.
 *
 * Kinds: `.txt`, or a `.md` declaring a transcript role, is a transcript; `.pptx` and `.pdf` are
 * decks (a deck PDF is exactly what she would link beside a transcript, and a bundle still needs a
 * transcript to form); everything else is `other`.
 */

import {
  associateLectures,
  isTranscriptRole,
  type LectureBundle,
  type LectureFileKind,
  type LinkedFile,
  type TeachingEventResolver,
  type VaultPath,
} from 'olea-core';

/** The vault's resolved links, as one read. A port: Obsidian's metadata cache is the implementation. */
export interface ResolvedLinksPort {
  /** Every file that has outgoing links, mapped to the vault paths those links resolve to. Unresolved links are absent. */
  resolvedLinks(): ReadonlyMap<VaultPath, readonly VaultPath[]>;
  /** The cached frontmatter of a file, when it has any. Used only to see a declared transcript role. */
  frontmatterFor(path: VaultPath): Record<string, unknown> | undefined;
}

/** What a path is, from its extension and (for Markdown) its declared role. Never from its name. */
export function lectureKindOf(
  path: VaultPath,
  frontmatter: Record<string, unknown> | undefined,
): LectureFileKind {
  const lower = path.toLowerCase();
  if (lower.endsWith('.txt')) return 'transcript';
  if (lower.endsWith('.md')) {
    const role = frontmatter?.role;
    return typeof role === 'string' && isTranscriptRole(role) ? 'transcript' : 'other';
  }
  if (lower.endsWith('.pptx') || lower.endsWith('.pdf')) return 'deck';
  return 'other';
}

/** The `LinkedFile` list for the current vault state: every linking file, plus every link target. */
export function buildLinkedFiles(port: ResolvedLinksPort): LinkedFile[] {
  const links = port.resolvedLinks();
  const paths = new Set<VaultPath>();
  for (const [source, targets] of links) {
    paths.add(source);
    for (const t of targets) paths.add(t);
  }
  return [...paths].sort().map((path) => ({
    path,
    kind: lectureKindOf(path, port.frontmatterFor(path)),
    links: [...(links.get(path) ?? [])],
  }));
}

/** Lecture bundles right now, rebuilt from her links on every call. Stores nothing. */
export function readLectureBundles(port: ResolvedLinksPort): LectureBundle[] {
  return associateLectures(buildLinkedFiles(port));
}

/**
 * The repetition guard's lookup (`ol-egov.141.89.3.43`, D-465): a path's teaching event is its
 * lecture bundle, so the slides, the transcript and the note that linked them are ONE event in
 * concept size. A bundle is named by its first member; a path in no bundle has no event. Pure.
 */
export function teachingEventResolverFrom(
  bundles: readonly LectureBundle[],
): TeachingEventResolver {
  const eventOf = new Map<VaultPath, string>();
  for (const bundle of bundles) {
    const id = bundle.members[0];
    if (id === undefined) continue;
    for (const path of [...bundle.members, ...bundle.via]) {
      if (!eventOf.has(path)) eventOf.set(path, id);
    }
  }
  return (path) => eventOf.get(path);
}
