/**
 * `findUnreadableFiles` — the unreadable-file census (`[D-196]`, F1.5(b),
 * F8.1, `ol-2zfj.56`).
 *
 * `[D-196]`'s ruling (brief 36, "Does the tool open by telling a new vault
 * what it cannot read?") settles that a file the extraction pipeline reached
 * but could not turn into text surfaces beside F1.5(b)'s evidenced ask and
 * F8.1's grove, never on a standing page of its own, with **exactly three**
 * structural reasons — never a fourth:
 *
 *  - `'no-reader-for-format'` — no `Extractor` claims this extension at all
 *    (`../extract/registry.js#formatFromExtension` returns `null`). Her
 *    lever: convert the file to a format one of `pdf`/`pptx`/`docx`/`image`
 *    covers.
 *  - `'image-only-no-text'` — a reader exists and ran, and no usable text
 *    came out. Her lever: re-save the file with a real text layer (OCR a
 *    scan, re-export a corrupted PDF from its source program).
 *  - `'not-linked'` — a reader exists, but nothing in the pipeline has ever
 *    tried it on this file: no note embeds it (`../extract/embeds.js`) and
 *    it has not been registered under F1.5 (`./register.js`). Her lever is
 *    registration itself, which is why the ask and the list share one
 *    surface (brief 36, "Where I land, and where I differ").
 *
 * This module owns only the CLASSIFICATION — given a course's files, which
 * of them the pipeline could use and how each failure is characterised. It
 * does not decide which files belong to which course (F7.9's `03 Research`
 * is a single, flat, vault-wide folder — `./register.ts`'s own module doc:
 * "its own folder is flat and carries no course structure to read" — so a
 * caller that already knows a file's course, e.g. because a registered
 * `Source` carries `course` explicitly, hands this module an already-scoped
 * file list rather than asking it to derive one), and it performs no I/O
 * beyond reading the bytes needed to attempt extraction.
 *
 * **A reason describes the reader, never the file (`[D-196]`'s own words).**
 * Nothing here inspects, quotes or paraphrases a file's content; `path` and
 * `reason` are the whole report, matching D-005's "counts and paths only."
 * **Never PDF document metadata** (`ol-pdfmeta`): this module never reads
 * `Author`/`Title`/`Producer`/etc. off a PDF, because those fields carry
 * identifying strings this project treats as content, not structure.
 *
 * ## Why several distinct `ExtractionOutcome` values collapse into one reason
 *
 * `../extract/types.ts#ExtractionOutcome` names six things that can happen to
 * a source: `'extracted'`, `'empty-document'`, `'no-pages-found'`,
 * `'unreadable'`, `'reached-but-unreadable'`, `'furniture-only'`. `[D-196]`
 * permits exactly three STUDENT-FACING reasons, so this module has to fold
 * six engineering outcomes into three honest sentences without inventing a
 * fourth. It follows the fold `../gap/coverage.ts#readStateOfOutcome`
 * already established for the identical problem on the coverage screen,
 * rather than drawing a second, competing line:
 *
 *  - `'empty-document'` and `'furniture-only'` are **not** reported as
 *    unreadable at all. Both mean the read genuinely succeeded and there was
 *    nothing (or nothing but a running head) to find — `coverage.ts`'s own
 *    words, "nothing is wrong; there was nothing there." Reporting these as
 *    a structural failure would tell her to fix a file that isn't broken.
 *  - `'extracted'` with at least one real extracted unit is readable — the
 *    common, unremarkable case — and is excluded from this census's output
 *    entirely (an omission, not a fourth reason).
 *  - `'extracted'` with zero units (every page routed to vision because its
 *    text layer was genuinely `'absent'`), `'no-pages-found'`,
 *    `'unreadable'` and `'reached-but-unreadable'` all become
 *    `'image-only-no-text'`. The first is the literal case the name
 *    describes; the other three are engineering distinctions — a structural
 *    parse failure vs. a decode failure vs. a page tree that would not
 *    enumerate — that share the one fact `[D-196]` allows this module to
 *    state: no usable text came out, and the lever available to her is the
 *    same in every case (produce a cleaner version of the file). Naming the
 *    parser's internal reason for any of the three would describe the
 *    reader in more detail than a student surface may, not less.
 *
 * A file that throws during extraction (malformed bytes past whatever the
 * parser tolerates) is treated the same way, for the same reason: whatever
 * broke, no text came out, and that is the whole of what may be said about
 * it here.
 *
 * ## INV-1 / §7.1
 *
 * `reasonForExtractionOutcome` is pure. `findUnreadableFiles` reads through
 * `VaultSource` only (A2.1/A2.2) and holds no state between calls — the same
 * "recomputed fresh every time" posture `../scope/grove.ts` documents for
 * its own denominator, which is what lets a file becoming readable (she
 * fixed it) or newly unreadable (she dropped a bad scan) show up on the very
 * next read with no cache to invalidate.
 */

import { extractFromVault, formatFromExtension } from '../extract/registry.js';
import type { ExtractionOutcome } from '../extract/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';

/** One of exactly three structural reasons a file could not be read (`[D-196]`). Never a fourth. */
export type UnreadableReason = 'no-reader-for-format' | 'image-only-no-text' | 'not-linked';

/** One file the pipeline reached but could not read — path and structural reason, nothing else (D-005). */
export interface UnreadableFile {
  readonly path: VaultPath;
  readonly reason: UnreadableReason;
}

export interface FindUnreadableFilesOptions {
  /**
   * Every file to consider, already scoped to whatever "the course's source
   * location" means for the caller (F1.5(b)/F8.1 both name F7.9's folder).
   * A markdown path is always skipped — see the module doc: markdown is read
   * by the block parser, never by an `Extractor`, so none of the three
   * reasons can honestly apply to it.
   */
  readonly files: readonly VaultPath[];
  /**
   * Paths the pipeline actually reaches today: resolved by an embed
   * (`../extract/embeds.js#discoverEmbeddedSources`) or registered as a
   * `Source` (`./register.js#registerSources`, F1.5/F3.1). Computed once by
   * the caller and handed in, rather than re-derived here, matching
   * `../../../plugin/src/grove/provider.ts`'s "compose once, read here"
   * discipline for its own independent vault reads.
   */
  readonly linkedPaths: ReadonlySet<VaultPath>;
}

function isMarkdown(path: VaultPath): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * The pure fold from an extraction verdict to one of the three reasons, or
 * `null` when the file is readable and therefore not part of this census —
 * see the module doc's "why several outcomes collapse into one reason" for
 * the full argument. Exported so the fold is checkable on its own, the same
 * reason `../gap/coverage.ts#readStateOf` exports its own mapping.
 */
export function reasonForExtractionOutcome(
  outcome: ExtractionOutcome,
  unitCount: number,
): UnreadableReason | null {
  switch (outcome) {
    case 'empty-document':
    case 'furniture-only':
      // Nothing is wrong; there was nothing there (or nothing but running-
      // head furniture). Not a structural failure — excluded.
      return null;
    case 'extracted':
      return unitCount > 0 ? null : 'image-only-no-text';
    case 'no-pages-found':
    case 'unreadable':
    case 'reached-but-unreadable':
      return 'image-only-no-text';
  }
}

/**
 * Classifies every file in `options.files` that the pipeline could not read,
 * into exactly one of the three `[D-196]` reasons. A file this function does
 * not return is either markdown (never a candidate) or was read
 * successfully — the omission itself is the "readable" report, matching
 * `SourceRegistrationReport`'s own convention of reporting drops rather than
 * silences.
 */
export async function findUnreadableFiles(
  vault: VaultSource,
  options: FindUnreadableFilesOptions,
): Promise<readonly UnreadableFile[]> {
  const results: UnreadableFile[] = [];

  for (const path of options.files) {
    if (isMarkdown(path)) continue;

    const format = formatFromExtension(path);
    if (format === null) {
      results.push({ path, reason: 'no-reader-for-format' });
      continue;
    }

    if (!options.linkedPaths.has(path)) {
      results.push({ path, reason: 'not-linked' });
      continue;
    }

    let reason: UnreadableReason | null;
    try {
      const result = await extractFromVault(vault, path, format);
      const unitCount = result.pages.reduce((sum, page) => sum + page.units.length, 0);
      reason = reasonForExtractionOutcome(result.outcome, unitCount);
    } catch {
      // Whatever broke, no text came out — the same fact `'unreadable'`
      // reports, so it is folded into the same reason rather than a fourth
      // one for "the extractor threw" (see module doc).
      reason = 'image-only-no-text';
    }
    if (reason !== null) results.push({ path, reason });
  }

  return results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
