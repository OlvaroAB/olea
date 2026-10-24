/**
 * A drafted item's input notes (`[D-626]`, `[D-628]`; `ol-egov.141.89.2.39`): every note its
 * drafting request was drawn from, each with a fingerprint of the material supplied from it.
 *
 * Functional scope C5.3 (as amended by `[D-626]` and `[D-628]`): "A drafted item records every note
 * its drafting request was drawn from, and each of them protects it. The draft and, once she keeps
 * it, its citation record list each input note with a fingerprint of the material actually supplied
 * when drafting. A content change to any input note that gets past the code's free exits, at any
 * point before the item is presented, withholds it as a change to its cited note does, at
 * whole-note grain." The one exception is a request that supplied exactly one chunk that is exactly
 * one passage of its note, which keeps passage grain for that note.
 *
 * ===========================================================================
 * THE FINGERPRINT, AND WHY IT DESCRIBES WHAT WAS SUPPLIED
 * ===========================================================================
 * For a markdown note (a declared-Markdown lecture transcript included), the fingerprint is the hash
 * of exactly what the whole-note materiality check compares: the whole note, its frontmatter
 * included, minus the question blocks (`stripQuestionBlocks`, the citation pass's own strip) and
 * minus the frontmatter writes Olea makes itself (`stripOleaFrontmatterWrites`: its `olea-*` stamps,
 * and a home note's `topic:` list; her own frontmatter stays in), in the existing canonical form
 * (`computeMaterialityHashes`'s `canonicalHash`, over `canonicalizeForMateriality`). So a
 * formatting-only edit, a question block added, or a stamp Olea writes leaves it equal — the code's
 * free exits, and Olea's own writes, which are not a change to her material — and any other content
 * change does not. For any other source (a
 * PDF, deck or document, a plain-text transcript), it is the hash of the file's raw bytes, the
 * revision `review/open-session.ts`'s `nonMarkdownSourceUnchanged` compares.
 *
 * The chunks a drafting request carries are cut from the keyword index, a cache that can trail the
 * vault. So before a request is sent ({@link inputNotesOfSuppliedChunks}, called by both drafting
 * functions), each note that supplied a chunk is read as it stands and compared with the content
 * hash the index recorded for it (`IndexedDocument.contentHash`: the raw text's hash for a note or
 * transcript, the bytes hash for a binary, decided by the index's own rule `indexedBinaryFormatOf`).
 * A note whose indexed text is not its current text means the chunks did not come from the note as
 * it stands: no request is sent, nothing is cached, and a later attempt drafts once the index has
 * caught up. Otherwise the fingerprint is taken from that same read, so it describes the material
 * the chunks were cut from.
 *
 * Nothing here sends anything anywhere: paths and fingerprints stay on her device (D-005); the
 * drafting request still carries chunk text only.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type {
  CitationInputNote,
  CitationRecord,
  InstrumentCitation,
  PersistedKeywordIndex,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  hashContent,
  hashText,
  indexedBinaryFormatOf,
  locatePassageByDigest,
  resolveTranscriptFormat,
} from 'olea-core';
import { stripQuestionBlocks } from '../ingestion/materiality/citation-material.js';
import { computeMaterialityHashes } from '../ingestion/materiality/hashes.js';
import { hasTranscriptExtension } from '../ingestion/materiality/transcript-grain.js';
import type { SuppliedChunkLocation } from '../retrieval/draft-quiz-cards.js';
import { withGroundingPassage } from './grounding-passage.js';
import { stripOleaFrontmatterWrites } from './strip-olea-frontmatter.js';
import type { DraftRecord } from './types.js';

/** One input note: the note's path and the fingerprint of the material supplied from it. */
export type InputNote = CitationInputNote;

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * The material a whole-note comparison reads from one markdown note's raw text: the note minus its
 * question blocks and minus the frontmatter writes Olea makes itself — see the module doc. The
 * cited note's whole-note check (`review/open-session.ts`, the citation pass) leaves out the same
 * writes with the same strip (`stripOleaFrontmatterWrites`), so the two comparisons cannot drift.
 */
function wholeNoteMaterial(raw: string): string {
  return stripQuestionBlocks(stripOleaFrontmatterWrites(raw));
}

/** The markdown fingerprint of one note's raw text — see the module doc. */
export async function markdownFingerprint(raw: string): Promise<string> {
  return (await computeMaterialityHashes(wholeNoteMaterial(raw))).canonicalHash;
}

/**
 * The fingerprint of `path` as it stands now, or `undefined` when it is missing or cannot be read.
 * Never throws. See the module doc for the two kinds.
 */
export async function inputNoteFingerprint(
  vault: VaultSource,
  path: VaultPath,
): Promise<string | undefined> {
  try {
    if (!(await vault.exists(path))) return undefined;
    if (isMarkdownPath(path)) return await markdownFingerprint(await vault.read(path));
    return await hashContent(await vault.readBinary(path));
  } catch {
    return undefined;
  }
}

/**
 * What {@link inputNotesOfSuppliedChunks} found: every note that supplied a chunk is current, with
 * its fingerprint (`current`), or at least one is not (`changed`: the index has not caught up with
 * it, it is gone, or it cannot be read).
 */
export type SuppliedInputNotes =
  | { readonly kind: 'current'; readonly inputNotes: readonly InputNote[] }
  | { readonly kind: 'changed' };

/**
 * The fingerprint of `path` when its current content is the content the index recorded
 * (`indexedHash`), otherwise `undefined`. One read of the file decides both, so the fingerprint is of
 * the very content the index's chunks were cut from.
 */
async function fingerprintIfIndexedContent(
  vault: VaultSource,
  path: VaultPath,
  indexedHash: string,
): Promise<string | undefined> {
  try {
    if (!(await vault.exists(path))) return undefined;
    if (indexedBinaryFormatOf(path) !== null) {
      const bytesHash = await hashContent(await vault.readBinary(path));
      return bytesHash === indexedHash ? bytesHash : undefined;
    }
    const raw = await vault.read(path);
    if ((await hashText(raw)) !== indexedHash) return undefined;
    if (isMarkdownPath(path)) return await markdownFingerprint(raw);
    // A plain-text source (a `.txt`/`.vtt`/`.srt` transcript): indexed by its text, protected by
    // its bytes, as the presentation check reads it.
    return await hashContent(await vault.readBinary(path));
  } catch {
    return undefined;
  }
}

/**
 * The input notes of one drafting request, read before it is sent: one entry per distinct path in
 * `chunkPaths` (the chunks' own paths, aligned with the request's `sourceChunks`), in the order each
 * first appears (retrieval rank). `changed` when any of them is not in `index`, or its current
 * content is not the content `index` recorded for it — the request must then not be sent. Never
 * throws.
 */
export async function inputNotesOfSuppliedChunks(
  vault: VaultSource,
  index: PersistedKeywordIndex,
  chunkPaths: readonly VaultPath[],
): Promise<SuppliedInputNotes> {
  const paths = distinctInOrder(chunkPaths);
  if (paths.length === 0) return { kind: 'changed' };
  const inputNotes: InputNote[] = [];
  for (const path of paths) {
    const indexed = index.documents.find((document) => document.path === path);
    if (indexed === undefined) return { kind: 'changed' };
    const contentHash = await fingerprintIfIndexedContent(vault, path, indexed.contentHash);
    if (contentHash === undefined) return { kind: 'changed' };
    inputNotes.push({ path, contentHash });
  }
  return { kind: 'current', inputNotes };
}

function distinctInOrder(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * `lists` merged into one, one entry per path, the first entry for a path kept. Used where a
 * request's material comes from more than one place (a rewrite's passage and its retrieved chunks).
 */
export function mergeInputNotes(...lists: readonly (readonly InputNote[])[]): readonly InputNote[] {
  const seen = new Set<string>();
  const out: InputNote[] = [];
  for (const list of lists) {
    for (const note of list) {
      if (seen.has(note.path)) continue;
      seen.add(note.path);
      out.push({ path: note.path, contentHash: note.contentHash });
    }
  }
  return out;
}

/**
 * The C5.3 exception (`[D-626]`): the note whose passage grain an item keeps, or `undefined`. Only
 * an item whose request supplied exactly one chunk that is exactly one passage of its note carries a
 * passage digest at all (nothing else mints one for an item with input notes: the drafting writers,
 * and `materialize-mcq.ts`/`materialize-card.ts`, which never mint at accept for such an item); its
 * input notes are then that one note, and its citation names it with the digest.
 */
export function singlePassageNote(
  citation: InstrumentCitation | undefined,
  inputNotes: readonly InputNote[] | undefined,
): VaultPath | undefined {
  if (citation?.passageDigest === undefined || inputNotes?.length !== 1) return undefined;
  const [only] = inputNotes;
  return only !== undefined && only.path === citation.sourcePath ? only.path : undefined;
}

/**
 * `ol-egov.141.89.2.39` (finding F): where a note stands now, given a rename Olea saw that its
 * records have not caught up with yet (`CitationRevisionTrigger.renamedPathOf`). Identity when no
 * rename is in flight for `path`. A rename alone never changes a fingerprint, so a check that reads
 * a note through this reads the renamed note, never a missing one.
 */
export type PathNow = (path: VaultPath) => VaultPath;

const samePath: PathNow = (path) => path;

/**
 * Whether every input note still reads as it did when the item was drafted: each read afresh and
 * compared by fingerprint; a missing or unreadable note is a change. `skipPath` is a note checked at
 * its own passage grain elsewhere ({@link singlePassageNote}). Never throws.
 */
export async function inputNotesUnchanged(
  vault: VaultSource,
  inputNotes: readonly InputNote[],
  skipPath?: VaultPath,
  pathNow: PathNow = samePath,
): Promise<boolean> {
  for (const note of inputNotes) {
    if (note.path === skipPath) continue;
    if ((await inputNoteFingerprint(vault, pathNow(note.path))) !== note.contentHash) return false;
  }
  return true;
}

/**
 * The input notes, of `inputNotes`, that no longer read as they did when the item was drafted
 * (missing and unreadable included), less any in `exclude`. `fingerprintOf` reads one note's
 * fingerprint as it stands (a caller checking many items in one pass supplies a memoised one, so
 * a note shared by many items is read once). Never throws.
 */
export async function changedInputNotes(
  vault: VaultSource,
  inputNotes: readonly InputNote[],
  exclude: ReadonlySet<string> = new Set(),
  fingerprintOf: (path: VaultPath) => Promise<string | undefined> = (path) =>
    inputNoteFingerprint(vault, path),
): Promise<readonly InputNote[]> {
  const changed: InputNote[] = [];
  for (const note of inputNotes) {
    if (exclude.has(note.path)) continue;
    if ((await fingerprintOf(note.path)) !== note.contentHash) changed.push(note);
  }
  return changed;
}

/**
 * The single-passage note's own check for an item with no passage anchor to read it by (a pending
 * draft, and a kept item before the citation pass first anchors it): `true` when the note still
 * reads as drafted, or, failing that, when its digest still names exactly one passage of it. The
 * note's fingerprint is read first, so a formatting-only edit anywhere in it, the passage included
 * (the fingerprint's canonical form leaves it equal), never reaches the digest lookup, and a change
 * elsewhere in the note keeps the item while its passage stands (passage grain). A lecture
 * transcript's digest names a part, checked at its own grain by the transcript checks that read it,
 * never by the note segmentation here. Never throws.
 */
async function singlePassageStands(
  vault: VaultSource,
  note: InputNote,
  passageDigest: string,
  pathNow: PathNow,
): Promise<boolean> {
  const path = pathNow(note.path);
  try {
    if ((await inputNoteFingerprint(vault, path)) === note.contentHash) return true;
    if (!(await vault.exists(path))) return false;
    const text = await vault.read(path);
    const transcript =
      hasTranscriptExtension(path) || resolveTranscriptFormat(path, text).kind === 'transcript';
    if (transcript) return true;
    const located = await locatePassageByDigest(stripQuestionBlocks(text), passageDigest);
    return located.status === 'unique';
  } catch {
    return false;
  }
}

/**
 * A pending draft's protection at presentation and at accept (`[D-626]`, `[D-628]`), and a kept
 * item's before the citation pass has anchored it: `true` when every input note reads as it did when
 * drafted. The single-passage case keeps passage grain for its note ({@link singlePassageStands}). A
 * draft with no input notes is not established and reads `false` (the caller decides what that
 * means for a draft recorded before input notes were). `pathNow` reads a note a rename in flight is
 * moving at its new path. Never throws.
 */
export async function draftInputNotesHold(
  vault: VaultSource,
  citation: InstrumentCitation | undefined,
  inputNotes: readonly InputNote[] | undefined,
  pathNow: PathNow = samePath,
): Promise<boolean> {
  if (inputNotes === undefined || inputNotes.length === 0) return false;
  const passageNote = singlePassageNote(citation, inputNotes);
  const only = inputNotes[0];
  if (passageNote !== undefined && citation?.passageDigest !== undefined && only !== undefined) {
    if (!(await singlePassageStands(vault, only, citation.passageDigest, pathNow))) return false;
  }
  return inputNotesUnchanged(vault, inputNotes, passageNote, pathNow);
}

/**
 * A kept item's protection by its input notes at presentation (`[D-626]`, `[D-628]`; functional
 * scope C5.3), given its citation record's list.
 *
 * `followedByAnchor` is the set of notes the item's citation anchor already follows (its anchored
 * note, its cited note and its cited source: `citation-revision-wiring.ts`'s
 * `notesFollowedByAnchor`), supplied only when the anchor's own checks were read for this
 * presentation. Those notes are judged by the anchor at their own grain and free exits — a
 * single-passage note at passage grain, which a formatting-only edit or a move of the passage passes
 * (`[D-446]`), a lecture transcript at its part or whole-transcript grain — and never a second time
 * here; every other input note is compared by fingerprint. This is the same split the citation pass
 * makes (`routeIfInputNotesChanged`), so an item the pass leaves standing is never withheld here for
 * good. With no anchor read, every note is checked as a pending draft's are
 * ({@link draftInputNotesHold}), as the pass compares every note at first sighting. Never throws.
 */
export async function keptInputNotesHold(
  vault: VaultSource,
  record: CitationRecord,
  inputNotes: readonly InputNote[],
  followedByAnchor: ReadonlySet<string> | undefined,
  pathNow: PathNow = samePath,
): Promise<boolean> {
  if (followedByAnchor === undefined) {
    return draftInputNotesHold(vault, record, inputNotes, pathNow);
  }
  const changed = await changedInputNotes(vault, inputNotes, followedByAnchor, (path) =>
    inputNoteFingerprint(vault, pathNow(path)),
  );
  return changed.length === 0;
}

/**
 * `ol-egov.141.89.2.39` (finding J; `[D-628]`'s citation rule): the input note a draft drawn from
 * several notes cites internally — always one it was drawn from: the concept's note when that is
 * one of them, otherwise the note that supplied the most chunks, ties broken by retrieval rank (the
 * order `inputNotes` holds them in, each note's first chunk's place). A draft drawn from one note
 * cites that note. `chunkPaths` is the request's chunk alignment (`DraftQuizCardsResult.chunkPaths`);
 * without it the first note by retrieval rank. `undefined` for no input notes. The citation is
 * internal: no surface shows it as the draft's sole source (the clearing list reads the list).
 */
export function internalCitationNote(
  inputNotes: readonly InputNote[] | undefined,
  chunkPaths: readonly string[] | undefined,
  conceptNotePath: string | undefined,
): InputNote | undefined {
  if (inputNotes === undefined || inputNotes.length === 0) return undefined;
  if (inputNotes.length === 1) return inputNotes[0];
  const conceptNote = inputNotes.find((note) => note.path === conceptNotePath);
  if (conceptNote !== undefined) return conceptNote;
  let best: InputNote | undefined;
  let bestCount = -1;
  for (const note of inputNotes) {
    const count = chunkPaths?.filter((path) => path === note.path).length ?? 0;
    if (count > bestCount) {
      best = note;
      bestCount = count;
    }
  }
  return best;
}

/**
 * `ol-egov.141.89.2.39` (finding E; `[D-628]`): the kept items Olea drafted through a draft record,
 * from provenance that survives a purge of the draft cache (`[D-006]`, `purgeDraftCache`) and a lost
 * index entry: every accept or edit of a draft appends a verdict to her review log naming the
 * instrument it became and the call that drafted it (`accept.ts`; the contract requires
 * `artifactProvenance` on an accept or an edit, `verdictLogRecordV6`), and nothing else writes one —
 * a restore of her own rejected block carries `restores` and no provenance, a practice paper's item
 * and her own blocks carry none. The draft cache's accepted and edited records are added (a verdict
 * whose append failed after the cache flipped), never subtracted.
 */
export function draftedInstrumentIdsOf(
  entries: readonly ReviewLogEntry[],
  drafts: readonly DraftRecord[] = [],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== 'verdict') continue;
    if (entry.verdict !== 'accepted' && entry.verdict !== 'edited') continue;
    if (entry.restores !== undefined || entry.artifactProvenance === undefined) continue;
    ids.add(entry.instrumentId);
  }
  for (const record of drafts) {
    if ((record.status === 'accepted' || record.status === 'edited') && record.instrumentId) {
      ids.add(record.instrumentId);
    }
  }
  return ids;
}

/**
 * A kept item's input notes as its citation record holds them, for the protection checks: the list,
 * or `undefined` when the record carries none (a record from before version 3, or an item no draft
 * stood behind).
 */
export function inputNotesOfRecord(
  record: CitationRecord | undefined,
): readonly InputNote[] | undefined {
  return record?.inputNotes;
}

/** Whether two input-note lists name the same notes, in any order (fingerprints aside). */
export function sameInputNotePaths(
  a: readonly InputNote[] | undefined,
  b: readonly InputNote[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  const paths = new Set(a.map((note) => note.path));
  return b.every((note) => paths.has(note.path));
}

/** The smallest of `values`, or `undefined` for none. */
function smallest(values: readonly (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length === 0 ? undefined : Math.min(...present);
}

/**
 * `[D-626]`: the citation of a draft drawn from one note, built as a citation of that note's kind
 * is when no landed unit of it is in hand (the sweep cites from a landed unit when it has one):
 *  - an ordinary markdown note: as an authored note is cited (`page: 1`, an authored note's own
 *    page, `ingestion/process-now.ts`'s `buildAuthoredNoteUnit`), with the passage digest the
 *    sole-chunk rule gives (`withGroundingPassage`: exactly one chunk, exactly one passage);
 *  - a lecture transcript (by its extension, or a chunk the request carried as one): the whole
 *    transcript at the version drafted from (its bytes revision; no part is named, since the parts
 *    of that version are not in hand), page the smallest part ordinal its chunks carry;
 *  - any other file (a PDF, deck or document): the smallest page its chunks carry, its section when
 *    every chunk shares one, and its bytes revision, which is its fingerprint.
 * The page is a locator only; the note is protected whole, by its fingerprint. A page is always
 * set: a citation with none reads as no source at all to the vault walk (`enumerate.ts`), which
 * would leave the item untracked. `destinationPath` is the note the item will be written into: a
 * citation naming it carries no revision and no digest, as everywhere else.
 */
export async function citationOfInputNote(
  vault: VaultSource,
  note: InputNote,
  destinationPath: string,
  result: {
    readonly request: {
      readonly sourceChunks: readonly string[];
      readonly sourceChunkOrigins?: readonly unknown[];
    };
    readonly chunkPaths?: readonly string[];
    readonly chunkLocations?: readonly SuppliedChunkLocation[];
  },
): Promise<InstrumentCitation> {
  const { sourceChunks, sourceChunkOrigins } = result.request;
  const chunkPaths = result.chunkPaths ?? sourceChunks.map(() => note.path);
  const positions = chunkPaths.flatMap((path, position) => (path === note.path ? [position] : []));
  const locations = positions.map((position) => result.chunkLocations?.[position] ?? {});
  const markdown = isMarkdownPath(note.path);
  const ownNote = note.path === destinationPath;
  const transcript =
    hasTranscriptExtension(note.path) ||
    positions.some(
      (position) =>
        sourceChunkOrigins?.[position] !== undefined && sourceChunkOrigins[position] !== null,
    );
  if (transcript) {
    let revision: string | undefined = markdown ? undefined : note.contentHash;
    if (revision === undefined && !ownNote) {
      try {
        revision = await hashContent(await vault.readBinary(note.path));
      } catch {
        revision = undefined;
      }
    }
    return {
      sourcePath: note.path,
      page: smallest(locations.map((location) => location.part)) ?? 1,
      ...(revision !== undefined && !ownNote ? { sourceRevision: revision } : {}),
    };
  }
  if (markdown) {
    return withGroundingPassage(
      vault,
      { sourcePath: note.path, page: 1 },
      destinationPath,
      sourceChunks,
    );
  }
  const sections = new Set(locations.map((location) => location.section));
  const [section] = sections;
  return {
    sourcePath: note.path,
    page: smallest(locations.map((location) => location.page)) ?? 1,
    ...(sections.size === 1 && section !== undefined ? { section } : {}),
    ...(ownNote ? {} : { sourceRevision: note.contentHash }),
  };
}
