/**
 * Lecture association (D-465, PROPOSAL 4.3; `ol-egov.141.89.3.42`).
 *
 * EXPLICIT ONLY: a transcript and a deck belong to one lecture bundle when a note links both, or
 * when the transcript's own link names the deck. Filename or folder similarity does nothing - this
 * module never reads a name, only link edges the caller has already resolved to vault paths.
 *
 * NO STORE: the function is pure and is meant to run on every read from her files.
 * BUNDLE MEMBERSHIP ONLY: a bundle has members and the notes that link them, nothing else - two
 * transcripts in one bundle never replace each other.
 */

import type { VaultPath } from '../vault/types.js';

export type LectureFileKind = 'transcript' | 'deck' | 'other';

export interface LinkedFile {
  readonly path: VaultPath;
  /** What the file is, as classified elsewhere (never from its name here). */
  readonly kind: LectureFileKind;
  /** Link targets this file contains, already resolved to vault paths. */
  readonly links: readonly VaultPath[];
}

export interface LectureBundle {
  /** Transcripts and decks in the bundle, sorted. */
  readonly members: readonly VaultPath[];
  /** The files whose links established it, sorted. */
  readonly via: readonly VaultPath[];
}

export function associateLectures(files: readonly LinkedFile[]): LectureBundle[] {
  const kindOf = new Map<VaultPath, LectureFileKind>();
  for (const f of files) kindOf.set(f.path, f.kind);
  const isLecture = (p: VaultPath): boolean => {
    const k = kindOf.get(p);
    return k === 'transcript' || k === 'deck';
  };

  const parent = new Map<VaultPath, VaultPath>();
  const find = (x: VaultPath): VaultPath => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as VaultPath;
    parent.set(x, r);
    return r;
  };
  const union = (a: VaultPath, b: VaultPath): void => {
    for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x);
    parent.set(find(a), find(b));
  };

  const edges: { readonly via: VaultPath; readonly group: readonly VaultPath[] }[] = [];
  for (const f of files) {
    const targets = [...new Set(f.links.filter(isLecture))];
    // The file's own membership counts when it is itself a transcript or deck (its own link).
    const group = isLecture(f.path) ? [...new Set([f.path, ...targets])] : targets;
    if (group.length < 2) continue;
    // A note (or a transcript's own link) must reach at least one transcript to form a bundle.
    if (!group.some((p) => kindOf.get(p) === 'transcript')) continue;
    for (let i = 1; i < group.length; i++) union(group[0] as VaultPath, group[i] as VaultPath);
    edges.push({ via: f.path, group });
  }

  const byRoot = new Map<VaultPath, { members: Set<VaultPath>; via: Set<VaultPath> }>();
  for (const e of edges) {
    const root = find(e.group[0] as VaultPath);
    const entry = byRoot.get(root) ?? { members: new Set(), via: new Set() };
    for (const p of e.group) entry.members.add(p);
    entry.via.add(e.via);
    byRoot.set(root, entry);
  }
  // Merge entries whose roots collapsed after later unions.
  const merged = new Map<VaultPath, { members: Set<VaultPath>; via: Set<VaultPath> }>();
  for (const entry of byRoot.values()) {
    const first = [...entry.members][0] as VaultPath;
    const root = find(first);
    const into = merged.get(root) ?? { members: new Set(), via: new Set() };
    for (const m of entry.members) into.members.add(m);
    for (const v of entry.via) into.via.add(v);
    merged.set(root, into);
  }
  return [...merged.values()]
    .map((e) => ({ members: [...e.members].sort(), via: [...e.via].sort() }))
    .sort((a, b) => (a.members[0] as string).localeCompare(b.members[0] as string));
}
