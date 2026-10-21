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
  hashContent,
  isTranscriptRole,
  type LectureBundle,
  type LectureFileKind,
  type LinkedFile,
  type TeachingEventResolver,
  type VaultPath,
  type VaultSource,
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
 * Byte-identical transcript copies (`ol-egov.141.89.5.101`, D-565). Reads every transcript-kind
 * file's bytes and groups equal bytes, whatever the names or folders. Only groups of two or more
 * are returned, as path -> group id (a hash of the bytes, computed here in memory). Nothing is
 * stored or written; a file that differs in any byte is never grouped, and identical passages
 * inside otherwise different files are never compared. Called fresh on every read.
 */
export async function readTranscriptCopyGroups(
  port: ResolvedLinksPort,
  vault: Pick<VaultSource, 'list' | 'readBinary'>,
): Promise<ReadonlyMap<VaultPath, string>> {
  const paths = await vault.list({ extensions: ['txt', 'md'] });
  const byHash = new Map<string, VaultPath[]>();
  for (const path of paths) {
    if (lectureKindOf(path, port.frontmatterFor(path)) !== 'transcript') continue;
    let hash: string;
    try {
      hash = await hashContent(await vault.readBinary(path));
    } catch {
      continue; // unreadable now: it stays its own event, as before
    }
    const group = byHash.get(hash);
    if (group === undefined) byHash.set(hash, [path]);
    else group.push(path);
  }
  const out = new Map<VaultPath, string>();
  for (const [hash, group] of byHash) {
    if (group.length < 2) continue;
    for (const path of group) out.set(path, hash);
  }
  return out;
}

/**
 * The repetition guard's lookup (`ol-egov.141.89.3.43`, D-465): a path's teaching event is its
 * lecture bundle, so the slides, the transcript and the note that linked them are ONE event in
 * concept size. A bundle is named by its first member; a path in no bundle has no event. Pure.
 *
 * `copyGroups` (`ol-egov.141.89.5.101`, D-565, from `readTranscriptCopyGroups`): byte-identical
 * transcripts are one event. A copy already in a bundle keeps that bundle's event; an unbundled
 * copy joins the event of the first (sorted) bundled member of its group, else all of them share
 * one `copy:` event. Two bundled copies in different bundles stay in their own bundles (her links
 * are never merged here). A re-cut or corrected export differs in bytes and needs her links.
 */
export function teachingEventResolverFrom(
  bundles: readonly LectureBundle[],
  copyGroups?: ReadonlyMap<VaultPath, string>,
): TeachingEventResolver {
  const eventOf = new Map<VaultPath, string>();
  for (const bundle of bundles) {
    const id = bundle.members[0];
    if (id === undefined) continue;
    for (const path of [...bundle.members, ...bundle.via]) {
      if (!eventOf.has(path)) eventOf.set(path, id);
    }
  }
  if (copyGroups !== undefined && copyGroups.size > 0) {
    const groups = new Map<string, VaultPath[]>();
    for (const [path, hash] of copyGroups) {
      const g = groups.get(hash);
      if (g === undefined) groups.set(hash, [path]);
      else g.push(path);
    }
    for (const [hash, members] of groups) {
      const sorted = [...members].sort();
      const bundled = sorted.find((p) => eventOf.has(p));
      const shared = bundled !== undefined ? eventOf.get(bundled) : `copy:${hash}`;
      if (shared === undefined) continue;
      for (const path of sorted) if (!eventOf.has(path)) eventOf.set(path, shared);
    }
  }
  return (path) => eventOf.get(path);
}
