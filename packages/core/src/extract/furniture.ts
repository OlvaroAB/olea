/**
 * The running-head / page-number furniture detector (SCAN-1, ol-738i).
 *
 * `threshold.ts` answers *how much* text a page yielded; `plausibility.ts`
 * answers *whether the characters that came out are characters at all*.
 * Neither asks the question this module exists for: **is the text that
 * decoded fine and comfortably clears the threshold actually content, or is
 * it furniture the page carries on every copy** — a running head, a
 * page-number stamp — repeated verbatim because it is print layout, not
 * because two different pages happen to say the same thing?
 *
 * ## The failure mode this closes
 *
 * D-053 defers scans, camera photographs and handwritten pages post-v0.9
 * (see `olea-service/docs/Olea_alpha_functional_scope.md` C3.3 and
 * `olea-service/docs/Olea_ai_workload_and_cost_model.md` §5.1) — that ruling
 * says what Olea *promises*. This module is about what the pipeline *does*
 * when one arrives anyway. Measured and recorded in the cost model: a
 * scanned page run through a text extractor with no OCR does not typically
 * yield zero characters — it yields 30-60 characters of running-head and
 * page-number noise picked up from a thin, real text layer some scanners and
 * copiers stamp onto the image (a header, a footer, a folio number). That
 * clears `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD` (D-022, 10 chars/page), so the
 * page is routed as `'text-layer'` and handed downstream as though it were
 * her content. `threshold.ts`'s own phrase for this is "a quality failure
 * that looks like success."
 *
 * **`DEFAULT_TEXT_LAYER_CHAR_THRESHOLD` does not move.** D-022 is a Class C,
 * measured, ratified number and this module never re-derives it — see
 * `threshold.ts`. What this module adds is a *different, declared
 * discrimination*: not a lower bar, but a second question asked of the same
 * per-page text, on the same already-ratified bar — "once the furniture is
 * stripped out, is there still 10 chars/page of something else?" — which is
 * exactly the "second signal (text-per-page-area, or a repeated-header
 * filter)" the cost model names as what a scan re-measurement would need.
 *
 * ## The two declared signals, and why each is defensible without fitting
 *
 * **1. A page-number line** (`isPageNumberLine`). A line consisting only of
 * a number, optionally with "page"/"p." or an "N of M" / "N/M" folio form,
 * is a page-number stamp — never a sentence, a heading, or a bullet a real
 * document would contain on its own line. This is checked *regardless of
 * repetition*, because a folio's whole point is that it changes every page
 * ("1", "2", "3", ...) and so would never be caught by the repetition signal
 * below.
 *
 * **2. A running-head line** (`findRunningHeadLines`). A line that recurs,
 * verbatim after trimming/case-folding, on a **majority** of a document's
 * pages. "Majority" (`> pages.length / 2`) rather than "all" is deliberate —
 * a scanner or copier sometimes drops the stamp on a cover page or misses
 * one page in a batch, and the check should not be defeated by one clean
 * page. Requires at least `RUNNING_HEAD_MIN_PAGES` (2) pages: repetition is
 * not a property a single page can exhibit, and a one-page document is
 * `plausibility.ts`'s question, not this one.
 *
 * **A repeated line is deliberately not enough by itself.** A lecture deck
 * legitimately repeats its own title or running head on every slide — that
 * is usually the deck's real subject, and often its most citable concept,
 * not furniture (`tier3-evidence/build.spec.ts`'s "a running header repeated
 * across the pages of ONE deck is that deck's subject, and is never
 * suppressed" pins exactly this, at the layer above this module). What
 * distinguishes the measured scan shape from a repeated title is the
 * **second** half of the cost model's own description — "running-head
 * **and page-number** noise" — so `isFurnitureOnlyDocument` requires both: a
 * majority-repeated line, **and** every candidate page independently
 * carrying its own page-number line. A genuine scan or photocopy stamps a
 * folio on every page it produces; a deck that simply repeats its title has
 * no reason to also print an incrementing number nowhere else visible on
 * the slide. Requiring the folio on *every* page, not a majority, is the
 * stricter of the two counts on purpose — it is the conjunct doing the work
 * of telling the two shapes apart, so it should not be softened to match the
 * running head's own majority allowance.
 *
 * ## What this does not catch, on purpose
 *
 * A furniture line that is reworded or re-OCR'd slightly differently per
 * page (misread digits, inconsistent spacing the extractor didn't normalise
 * away) will not match verbatim and will not be caught — a check that
 * fuzzy-matches lines is a much larger, fuzzier instrument than this one,
 * and this module stays the narrowest defensible test in the same spirit
 * `plausibility.ts` does for control characters. A document with one
 * furniture-only page among many genuine ones is also not caught — see
 * `isFurnitureOnlyDocument`'s "every candidate page" conjunct below — because
 * that page's own `charCount`/`route` already report it honestly and a
 * check that reds on a single title page discriminates nothing. And a
 * repeated title with no accompanying folio anywhere — the ordinary deck
 * case above — is not caught, by design, regardless of how little else is
 * on the page.
 */

import { DEFAULT_TEXT_LAYER_CHAR_THRESHOLD } from './threshold.js';
import type { PageExtraction } from './types.js';

/**
 * A line that is nothing but a page number, in the handful of forms a
 * folio actually takes: a bare number, "Page 3", "p. 3", "3 of 24", "3/24".
 * Anchored start-to-end (after trimming) so it cannot match a number that is
 * merely *part of* a real line of text — see `isPageNumberLine`.
 */
const PAGE_NUMBER_LINE = /^(page\s*|p\.?\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?\.?$/i;

/** True for a line that is a page-number stamp and nothing else. See the module doc for the forms recognised and why they need no repetition to count. */
export function isPageNumberLine(line: string): boolean {
  return PAGE_NUMBER_LINE.test(line.trim());
}

/**
 * The fewest pages a document must have before repetition is even a
 * meaningful question. Structural, not fitted: a single page cannot exhibit
 * "the same line recurring across pages" by definition, so below this count
 * `findRunningHeadLines` reports nothing rather than guessing.
 */
export const RUNNING_HEAD_MIN_PAGES = 2;

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ').toLowerCase();
}

function splitLines(text: string): readonly string[] {
  return text.split(/\r?\n/);
}

/**
 * Every distinct normalised line that recurs on a strict majority of
 * `pageTexts` (`> pageTexts.length / 2`) — see the module doc for why
 * majority, not unanimity, is the declared bar. Page-number lines are
 * excluded from this count on purpose: they are furniture too, but they are
 * caught by `isPageNumberLine` precisely *because* they don't repeat
 * verbatim, so counting them here would only dilute the majority threshold
 * against the lines that actually do.
 */
export function findRunningHeadLines(pageTexts: readonly string[]): ReadonlySet<string> {
  if (pageTexts.length < RUNNING_HEAD_MIN_PAGES) return new Set();

  const pagesContaining = new Map<string, number>();
  for (const text of pageTexts) {
    const distinctLinesOnPage = new Set(
      splitLines(text)
        .map(normalizeLine)
        .filter((line) => line.length > 0 && !isPageNumberLine(line)),
    );
    for (const line of distinctLinesOnPage) {
      pagesContaining.set(line, (pagesContaining.get(line) ?? 0) + 1);
    }
  }

  const majority = Math.floor(pageTexts.length / 2) + 1;
  const runningHead = new Set<string>();
  for (const [line, count] of pagesContaining) {
    if (count >= majority) runningHead.add(line);
  }
  return runningHead;
}

/**
 * `text`'s character count once every page-number line and every detected
 * running-head line is removed — the same "characters of genuine content"
 * question `charCount` answers, asked a second time after furniture is
 * stripped out. Deliberately reuses the definition of "a line" and "a
 * character count" `charCount` already uses (line-split, trimmed) so the
 * result is comparable to `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD` on the same
 * terms, rather than a differently-shaped number that happens to share a
 * name.
 */
export function furnitureStrippedCharCount(
  text: string,
  runningHeadLines: ReadonlySet<string>,
): number {
  let total = 0;
  for (const rawLine of splitLines(text)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    if (isPageNumberLine(trimmed)) continue;
    if (runningHeadLines.has(normalizeLine(trimmed))) continue;
    total += trimmed.length;
  }
  return total;
}

function pageText(page: PageExtraction): string {
  return page.units.map((unit) => unit.text).join('\n');
}

/** True if `text` carries at least one line that is nothing but a page-number stamp — see `isPageNumberLine`. */
function hasPageNumberLine(text: string): boolean {
  return splitLines(text).some((line) => isPageNumberLine(line));
}

/**
 * Runs the furniture check over a fully-built page list and returns an
 * equivalent list with `PageExtraction.furniture` filled in — `true`, with
 * `route` overridden to `'vision'` and `units` cleared, for every
 * `'text-layer'` page of a document this check calls furniture-only;
 * `false`, unchanged otherwise, for every page of every other document.
 *
 * **All three conjuncts of "furniture-only" matter, the same way both of
 * `isReachedButUnreadable`'s do.**
 *
 *  - A detected running head (rather than firing on low residual content
 *    alone) keeps a genuinely terse multi-page document — each page a
 *    distinct short heading, nothing repeated — from being caught: with no
 *    running head found, every page's residual count equals its original
 *    `charCount`, which was already `>= DEFAULT_TEXT_LAYER_CHAR_THRESHOLD`
 *    for it to be a `'text-layer'` candidate in the first place, so the
 *    residual conjunct below can never fire on it.
 *  - **Every candidate page carrying its own page-number line** (not most,
 *    not one) is what tells a genuine scan's furniture from a lecture deck
 *    that simply repeats its own title on every slide — see the module doc.
 *    Without it, this function would wrongly flag exactly that deck.
 *  - **Every** candidate page's residual clearing the bar (not most, not
 *    one) keeps a document with one furniture-heavy page among many genuine
 *    ones — a scanned cover sheet stapled ahead of a real, digitally-produced
 *    deck — from having its real pages swept away by one bad one.
 *
 * Only ever called on the `'text-layer'`-routed subset a page mapping
 * already produced honestly (see `pdf.ts`/`pptx.ts`): it never looks at
 * pages already routed to vision for an unrelated reason, and it never
 * touches `charCount` — the yield measurement every routing figure and
 * threshold sweep reads must keep reporting what actually came out (the same
 * discipline `pdf.ts` states for its own `textLayer === 'unreadable'`
 * override).
 */
export function applyFurnitureDetection(
  pages: readonly PageExtraction[],
): readonly PageExtraction[] {
  const candidates = pages.filter((page) => page.route === 'text-layer');

  if (candidates.length < RUNNING_HEAD_MIN_PAGES) {
    return pages.map((page): PageExtraction => ({ ...page, furniture: false }));
  }

  const texts = candidates.map(pageText);
  const runningHead = findRunningHeadLines(texts);
  const isFurnitureOnlyDocument =
    runningHead.size > 0 &&
    texts.every(hasPageNumberLine) &&
    texts.every(
      (text) => furnitureStrippedCharCount(text, runningHead) < DEFAULT_TEXT_LAYER_CHAR_THRESHOLD,
    );

  if (!isFurnitureOnlyDocument) {
    return pages.map((page): PageExtraction => ({ ...page, furniture: false }));
  }

  return pages.map((page): PageExtraction => {
    if (page.route !== 'text-layer') return { ...page, furniture: false };
    return { ...page, furniture: true, route: 'vision', units: [] };
  });
}
