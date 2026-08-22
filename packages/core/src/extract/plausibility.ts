/**
 * **Is what came out of a page actually text?** (ol-s3xa, ol-x1ch.)
 *
 * `threshold.ts` answers *how much* text a page yielded and routes on the
 * count. Nothing until now asked *what kind* of characters those were, or
 * whether a page that yielded none had a text layer to yield from. Both
 * questions have the same shape as the defect class this package keeps
 * meeting (N-013): a check that cannot fail reports green forever.
 *
 * ## The two signals, and why they are separate
 *
 * **1. Text plausibility (ol-s3xa).** A page can produce plenty of characters
 * and still be unreadable: NULs, C0 control codes, and the raw glyph indices
 * of a subset font that no CMap resolved (`pdf.ts`'s module doc names the
 * absent CMap resolution as a deliberate limitation, and those indices are
 * numbered from 1, so they land squarely in the control range when decoded as
 * Latin-1). The `charCount` on such a page is large, so the routing threshold
 * is satisfied, so the page claims a usable text layer and Slot G is handed
 * mojibake. That is bad enough while the consumer is a word-boundary matcher.
 * It is *worse* when the consumer is a **quote span** (F3.10/F3.11), which is
 * the one place the extractor's output is read by a human rather than by a
 * matcher — a correct citation carrying an unreadable passage destroys trust
 * in every other citation on the screen.
 *
 * **2. Text-layer reachability (ol-x1ch).** The opposite failure: a page whose
 * content streams were reached and produced *nothing*, reported identically to
 * a genuinely image-only page. The two are not the same claim. A scanned page
 * honestly has no text layer and belongs in the vision slot. A page whose text
 * layer we failed to decode also lands in the vision slot — at full price,
 * silently, on material that has perfectly good text in it. `PageTextLayer`
 * makes the two distinguishable, so "we could not read this" stops being
 * spelled the same way as "there was nothing here to read".
 *
 * ## Why the plausibility test counts C0 controls and nothing else
 *
 * It is deliberately the *narrowest* defensible test, because a page-quality
 * check that over-fires is worse than none: it would route real text to the
 * 6.5x-more-expensive vision slot (cost model §5.1) on material that never had
 * the defect.
 *
 *  - **Counted:** U+0000–U+001F except tab, newline and carriage return, plus
 *    U+007F. No text encoding maps a *character* into that range; every one of
 *    them in extracted output is either a control code a producer wrote into a
 *    string or an unresolved glyph index.
 *  - **Not counted:** U+0080–U+009F, even though Latin-1 calls them C1
 *    controls. `pdf.ts` decodes string bytes as Latin-1/WinAnsi, and in WinAnsi
 *    that range is ordinary punctuation — the curly apostrophes and dashes of
 *    perfectly good English prose. Counting them would fire on correct text.
 *  - **Counted:** U+FFFD, and only because `cmap.ts` is the only thing in this
 *    package that can produce one — see `isControlChar`. This is the ol-avvt
 *    addition: the CMap reader says "I could not resolve this code" in a
 *    character rather than by guessing, and this is where that admission is
 *    read.
 *  - **Not counted:** anything else above U+00FF. Mojibake that is *made of
 *    printable characters* is not detectable by this test and is not claimed
 *    to be; catching it needs the script-mapping signal ol-s3xa lists as the
 *    alternative, which is a larger instrument than this one. Note that
 *    ol-avvt narrowed the exposure at the source rather than here: the
 *    commonest generator of printable mojibake was a composite font's glyph
 *    indices read as Latin-1, and those are now `UNMAPPED_CHAR` instead.
 */

import { UNMAPPED_CHAR } from './cmap.js';
import type { PageExtraction, PageTextLayer } from './types.js';

/**
 * The share of a page's characters that may be control codes before the page
 * is called unreadable.
 *
 * **How the value was decided.** By measuring extractor output against poppler
 * `pdftotext` over a real-world delivery, stratified by PDF producer — see
 * `olea-service/findings/H-past-papers-inventory-and-text-layer.md` §5.2 and
 * `olea-service/findings/G1-concept-review.md` §(b), which stay private. The
 * distribution across producer classes is strongly bimodal: producers whose
 * fonts resolve correctly emit a control-character share indistinguishable
 * from zero, and the producers with the decode defect emit shares that are a
 * large *fraction of the whole page*. There is a wide empty band between the
 * two, and this value sits inside it — roughly an order of magnitude above
 * anything the correct producers emit and several times below anything the
 * broken ones do. Neither figure is restated here (INV-3).
 *
 * **This is therefore a threshold set from real measurement, not a synthetic
 * one** — the same footing as `WORD_GAP_KERN_THOUSANDTHS` in `pdf.ts`, and
 * flagged the same way: the specs in this package assert the *rule* and the
 * boundary, and the private findings carry the evidence for the *number*.
 */
export const MAX_CONTROL_CHAR_SHARE = 0.1;

/**
 * True for a character that cannot be part of decoded text at all — see the
 * module doc for why the test stops where it does. Tab, newline and carriage
 * return are excluded because this extractor emits newlines itself and real
 * strings do carry tabs.
 *
 * **U+FFFD counts** (ol-avvt). `cmap.ts` emits it, and only it, for a code no
 * `/ToUnicode` CMap resolved on a composite font — a glyph index with no
 * character meaning to fall back on. It cannot arrive any other way: the
 * extractor's other decoding path is Latin-1, which is total over bytes 0-255
 * and never produces a replacement character. Counting it is what keeps the
 * ol-avvt fix from trading an honest `'unreadable'` for plausible garbage: a
 * page whose codes we still cannot resolve reports exactly as it did before,
 * rather than passing on a page of question marks.
 */
function isControlChar(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  if (code === UNMAPPED_CHAR.charCodeAt(0)) return true;
  return code < 0x20 || code === 0x7f;
}

/**
 * The fraction of `text` made of control codes, in `[0, 1]`. Empty text has a
 * share of 0 — "nothing came out" is a different report (`PageTextLayer`),
 * and conflating the two would make the plausibility signal fire on every
 * scanned page.
 *
 * Exported so a harness can *measure* the distribution over a corpus without
 * having to re-derive the definition of "control character" and get a
 * different answer from the one the shipped check uses.
 */
export function controlCharShare(text: string): number {
  if (text.length === 0) return 0;
  let controls = 0;
  for (let i = 0; i < text.length; i++) {
    if (isControlChar(text.charCodeAt(i))) controls++;
  }
  return controls / text.length;
}

/**
 * Whether a page's extracted text is plausibly text. Strictly-greater-than, so
 * `MAX_CONTROL_CHAR_SHARE` names the highest *acceptable* share rather than
 * the lowest rejected one — the same convention `routePage` uses for its own
 * threshold.
 */
export function isPlausiblePageText(text: string): boolean {
  return controlCharShare(text) <= MAX_CONTROL_CHAR_SHARE;
}

/**
 * The honest one-word answer to "what happened to this page's text layer".
 *
 * `textLayerReached` is the extractor's own claim that there *was* something
 * to read — a content stream that declared text-showing operators, a stream it
 * could not decode, a construct it does not walk. It is the half of this that
 * only the format's parser can know; everything else here is a property of the
 * characters.
 */
export function classifyPageText(text: string, textLayerReached: boolean): PageTextLayer {
  if (text.length === 0) return textLayerReached ? 'unreadable' : 'absent';
  return isPlausiblePageText(text) ? 'readable' : 'unreadable';
}

/**
 * Whether a whole source deserves `outcome: 'reached-but-unreadable'` rather
 * than `'extracted'` (ol-x1ch).
 *
 * **Both conjuncts matter.** Requiring that *no* page was readable keeps a
 * document with one bad page among forty from being reported as a failure —
 * that page already says so itself, via its own `textLayer`. Requiring that at
 * least one page was `'unreadable'` keeps a genuine scan, every page of which
 * is honestly `'absent'`, reporting `'extracted'`: it was extracted, it simply
 * has no text layer, and routing it to vision is the correct answer rather
 * than a defect.
 */
export function isReachedButUnreadable(pages: readonly PageExtraction[]): boolean {
  if (pages.length === 0) return false;
  return (
    pages.every((page) => page.textLayer !== 'readable') &&
    pages.some((page) => page.textLayer === 'unreadable')
  );
}
