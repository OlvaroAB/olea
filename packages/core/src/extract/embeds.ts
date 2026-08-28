/**
 * Embedded-PDF-in-note source resolution (F1.6, C3, P3-T04).
 *
 * F1.6 requires a PDF embedded *inside* a note to be an ingestion source in
 * its own right, on the same footing as one that sits in the vault as a
 * standalone file, so that C3 can act on either. Supporting the embedded case
 * is a contract requirement, not an optimisation chosen here.
 *
 * (F1.6's own wording is a private-classified requirement, so it is
 * paraphrased here rather than quoted. This file is in the public repo; the
 * contract documents live in the private one for exactly that reason, and a
 * verbatim quote walks the content straight back across the boundary. Read the
 * original in olea-service/docs/Olea_alpha_functional_scope.md.)
 *
 * An embed is written
 * `![[Geol204-Week2-Slides.pdf]]` — Obsidian's embed syntax, indistinguishable
 * at the block-parser level from an embedded *note* (`![[Some Note]]`) except
 * by the target's extension, which is exactly the discriminator this module
 * uses. Uses `../block/parse.js` rather than regexing raw markdown directly
 * (per the task instructions): the block parser already knows how to find
 * text precisely and gives back `start`/`end` offsets for free, which is
 * exactly what `EmbeddedInNote.blockStart`/`blockEnd` need.
 *
 * **Link resolution is a deliberate simplification of Obsidian's real
 * graph.** Obsidian resolves `![[bare-filename.pdf]]` against its
 * `metadataCache` — a full vault-wide link graph this package cannot build
 * without importing `obsidian` (INV-1, A2.2). What's here instead: an exact
 * vault-relative path is used verbatim if it exists; otherwise every file in
 * the vault sharing the embed's basename is a candidate, and a single
 * same-folder-as-the-note candidate breaks a tie. This resolves the common
 * cases (a uniquely-named file, or duplicate names disambiguated by
 * proximity) correctly and is honest about the rest: genuine ambiguity is
 * reported as `'ambiguous'` with every candidate listed, not silently
 * guessed.
 */

import { parseDocument } from '../block/parse.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { formatFromExtension } from './registry.js';
import type { EmbeddedInNote, SourceFormat } from './types.js';

/** One embed whose target resolved to exactly one vault file of a supported format. */
export interface ResolvedEmbed {
  /** The link target exactly as written in the note (e.g. `Geol204-Week2-Slides.pdf`), before resolution — kept for diagnostics. */
  readonly rawTarget: string;
  readonly path: VaultPath;
  readonly format: SourceFormat;
  readonly embeddedIn: EmbeddedInNote;
}

/** One embed whose target could not be resolved to exactly one file. */
export interface UnresolvedEmbed {
  readonly rawTarget: string;
  readonly embeddedIn: EmbeddedInNote;
  /** `'not-found'` — no file in the vault matches. `'ambiguous'` — more than one does, and proximity to the note didn't break the tie. */
  readonly reason: 'not-found' | 'ambiguous';
  /** Every candidate found, for `'ambiguous'`; empty for `'not-found'`. */
  readonly candidates: readonly VaultPath[];
}

export interface DiscoverEmbeddedSourcesResult {
  readonly resolved: readonly ResolvedEmbed[];
  readonly unresolved: readonly UnresolvedEmbed[];
}

/** Matches `![[target]]`, `![[target#heading]]`, `![[target|alias]]` (and the combination), capturing only `target`. Constructed fresh per block scan rather than reused as a module-level global-flag regex, so no caller has to reason about `lastIndex` state carrying across calls. */
function embedPattern(): RegExp {
  return /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
}

function basename(path: VaultPath): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

function dirname(path: VaultPath): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** A `[start, end)` range within a block's raw text that is inline code and must not be scanned for embeds. */
type CodeSpanRange = readonly [start: number, end: number];

/**
 * Finds inline code spans in `text` (CommonMark-style: a run of N backticks
 * opens a span, closed by the *next* run of exactly N backticks — a run of a
 * different length inside the span is literal content, not a delimiter).
 *
 * An unterminated opening run — no closing run of the same length anywhere
 * after it — is treated conservatively as covering the rest of `text`. This
 * is a deliberate false-negative: real Markdown renders a dangling backtick
 * literally, so an embed after it would in fact be genuine. But this parser
 * cannot tell "genuinely unterminated" apart from "the closing backtick is
 * just further down than this block happened to be sliced", and the whole
 * point of this fix is to stop treating quoted embed syntax as a real embed
 * — so an ambiguous case is resolved toward *not* matching rather than
 * toward reintroducing the false positive this exists to remove.
 */
function inlineCodeSpanRanges(text: string): readonly CodeSpanRange[] {
  const ranges: CodeSpanRange[] = [];
  const openRe = /`+/g;
  let open = openRe.exec(text);
  while (open !== null) {
    const openStart = open.index;
    const openLen = open[0].length;
    const closeRe = /`+/g;
    closeRe.lastIndex = openStart + openLen;
    let close = closeRe.exec(text);
    while (close !== null && close[0].length !== openLen) {
      close = closeRe.exec(text);
    }
    if (close === null) {
      ranges.push([openStart, text.length]);
      break;
    }
    const closeEnd = close.index + close[0].length;
    ranges.push([openStart, closeEnd]);
    openRe.lastIndex = closeEnd;
    open = openRe.exec(text);
  }
  return ranges;
}

/** Whether `[start, end)` overlaps any of `ranges`. */
function overlapsAnyRange(start: number, end: number, ranges: readonly CodeSpanRange[]): boolean {
  return ranges.some(([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart);
}

type ResolveOutcome = { readonly path: VaultPath } | { readonly candidates: readonly VaultPath[] };

async function resolveTarget(
  vault: VaultSource,
  notePath: VaultPath,
  rawTarget: string,
  allPaths: readonly VaultPath[],
): Promise<ResolveOutcome> {
  const trimmed = rawTarget.trim();

  // An exact vault-relative path, written out in full, wins outright.
  if (trimmed.includes('/') && (await vault.exists(trimmed))) {
    return { path: trimmed };
  }

  const targetBasename = basename(trimmed);
  const matches = allPaths.filter((p) => basename(p) === targetBasename);
  if (matches.length === 0) return { candidates: [] };
  if (matches.length === 1) {
    // biome-ignore lint/style/noNonNullAssertion: length checked above.
    return { path: matches[0]! };
  }

  const noteDir = dirname(notePath);
  const sameFolder = matches.filter((p) => dirname(p) === noteDir);
  if (sameFolder.length === 1) {
    // biome-ignore lint/style/noNonNullAssertion: length checked above.
    return { path: sameFolder[0]! };
  }
  return { candidates: matches };
}

/**
 * Scans `notePath`'s blocks for `![[...]]` embeds whose target is a
 * supported C3.1 format (pdf/pptx/docx/image — see
 * `registry.ts#formatFromExtension`; a plain note embed or an unsupported
 * extension is silently not a match, since it isn't a C3 ingestion source
 * at all), resolves each to a vault path, and returns both what resolved
 * and what didn't. Every returned embed — resolved or not — carries the
 * `EmbeddedInNote` provenance fragment (the note path and the exact block
 * range the `![[...]]` was found in) that downstream extraction threads
 * through to `Provenance.embeddedIn` on every unit it produces.
 */
export async function discoverEmbeddedSources(
  vault: VaultSource,
  notePath: VaultPath,
  knownPaths?: readonly VaultPath[],
): Promise<DiscoverEmbeddedSourcesResult> {
  const source = await vault.read(notePath);
  const doc = parseDocument(source);
  // `knownPaths` exists because link resolution needs the whole vault listing,
  // and a caller sweeping every note would otherwise pay for a full recursive
  // walk PER NOTE — O(notes x files), which is quadratic in the only dimension
  // that grows. Measured on the 50-file fixture vault: 48 notes x ~350ms per
  // walk = 16.8s, roughly 70% of a caller's total runtime — and a real vault
  // is not smaller than a fixture. Optional rather than required so the
  // single-note call site stays honest and correct by default.
  const allPaths = knownPaths ?? (await vault.list());

  const resolved: ResolvedEmbed[] = [];
  const unresolved: UnresolvedEmbed[] = [];

  for (const block of doc.blocks) {
    // A fenced code block (```...```/~~~...~~~) is never prose: anything
    // inside it — including something that looks like `![[embed]]` syntax —
    // is source-code-shaped example text, not a real embed.
    if (block.kind === 'code') continue;

    const codeSpans = inlineCodeSpanRanges(block.raw);
    const pattern = embedPattern();
    let match = pattern.exec(block.raw);
    while (match !== null) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      if (overlapsAnyRange(matchStart, matchEnd, codeSpans)) {
        // Quoted inside an inline code span (single or double backtick) —
        // e.g. a note explaining the syntax with `![[file.pdf]]`. Not a
        // real embed; skip without recording it as 'not-found' noise.
        match = pattern.exec(block.raw);
        continue;
      }
      const rawTarget = (match[1] ?? '').trim();
      const format = formatFromExtension(rawTarget);
      if (format !== null) {
        const embeddedIn: EmbeddedInNote = {
          notePath,
          blockStart: block.start,
          blockEnd: block.end,
        };
        const outcome = await resolveTarget(vault, notePath, rawTarget, allPaths);
        if ('path' in outcome) {
          resolved.push({ rawTarget, path: outcome.path, format, embeddedIn });
        } else {
          unresolved.push({
            rawTarget,
            embeddedIn,
            reason: outcome.candidates.length > 0 ? 'ambiguous' : 'not-found',
            candidates: outcome.candidates,
          });
        }
      }
      match = pattern.exec(block.raw);
    }
  }

  return { resolved, unresolved };
}
