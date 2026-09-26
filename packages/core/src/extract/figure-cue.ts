/**
 * The figure cue (D-324, `[ILB-PER-4]`, `docs/dev/intelligence-build/per.md`
 * §7 decision 1, §8 "Pure logic first").
 *
 * `threshold.ts` decides whether a page's own text is enough on its own.
 * This module answers a different question, asked only of a page that
 * already passed that test: does the page *also* paint a picture worth
 * reading, one the text layer would otherwise leave silently unread? A
 * diagram laid out beside a full column of real prose clears
 * `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD` easily and would never reach Slot V
 * without this cue.
 *
 * ## The rule, verbatim (D-324, David, 2026-09-25)
 *
 * "Build image-reading using a 5 percent (one-twentieth) page-area trigger
 * for a non-recurring image: read a page's image content whenever a
 * qualifying image covers at least that share of the page. Treat the number
 * as a plain, named, easily-revisited constant — a provisional baseline, not
 * proof that images below 5 percent carry no information. Where a budget
 * limit prevents reading image content this rule requires, report the page
 * as pending or partially read; never report it as fully read or complete
 * when required image content was skipped for budget reasons." Smaller
 * images are not thereby proven irrelevant (David's clarification on the
 * ruling) — `FIGURE_CUE_MIN_SHARE` is a floor for *this* cue, not a claim
 * about what matters below it.
 *
 * **`FIGURE_CUE_MIN_SHARE` is DECLARED, not derived** (`docs/design/
 * component-baseline.md`'s declared-vs-derived line), unlike
 * `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD` (D-022, measured and ratified). David's
 * own words rule it a "plain, named, easily-revisited constant" — so, unlike
 * D-022's threshold, this one is **not** served through the vision-route
 * envelope (`src/visionRoute.ts`, `[ILB-PER-4]` §8 item 2, service repo):
 * that mechanism exists for a number the client must not itself hold the
 * only copy of, and this is the opposite case by ruling.
 *
 * ## "Non-recurring", mirrored from `furniture.ts`
 *
 * The same majority rule `furniture.ts` uses for a running head: an image is
 * *recurring* when it is painted on more than half of the document's pages
 * (`RUNNING_HEAD_MIN_PAGES` pages needed before "more than half" is even a
 * meaningful question — a one-page document cannot exhibit recurrence by
 * definition, so no image on it is ever counted recurring). A recurring
 * image is furniture in exactly the sense a running head is: a logo, a
 * template background, a slide-master watermark repeated because it is
 * layout, not because this page in particular chose to show it.
 *
 * **Identity is the PDF object number**, not image content. Two pages
 * `Do`-ing the *same* `/XObject` (the common case for a logo embedded once
 * and referenced from every slide) are correctly seen as one recurring
 * image. A producer that instead re-embeds pixel-identical bytes as a fresh
 * object per page is not caught — each copy reads non-recurring on its own
 * page — which biases this cue toward reading *more* pages as images, never
 * fewer, the same direction `vision-painted-share-sweep.mjs`'s own
 * over-approximations lean and the direction D-324's own ruling calls safe.
 *
 * ## What `areaShare` already reflects, and what it doesn't
 *
 * `pdf.ts` computes `areaShare` only for an image `Do`'d directly from a
 * page's own top-level content stream (recursion depth 0) — never one
 * reached through a Form XObject. `pdf.ts`'s own CTM tracking is
 * *level-relative* inside a form (see that file's `walkContentTokens` doc),
 * so a form-nested image's true page-space area is not something this parser
 * can currently derive without inventing an absolute-CTM composition it does
 * not otherwise need. Rather than guess, such an image simply contributes no
 * paint record at all — the same "layout cannot be inspected" case §7's own
 * onFail clause names, which routes on text yield alone. This is a **known,
 * documented under-count**, never an over-count: a figure wrapped in a Form
 * XObject (common for soft-masked or transparency-grouped images) is missed
 * by this cue today, filed as a follow-up rather than guessed at here.
 *
 * Likewise, when a page's own `/MediaBox`/`/CropBox` cannot be resolved (an
 * indirect reference this parser's minimal dictionary reader does not
 * follow, or no box declared or inherited at all), no share can be computed
 * for that page at all — the whole page is "layout cannot be inspected",
 * and `applyFigureCue` leaves its route untouched.
 */

import { RUNNING_HEAD_MIN_PAGES } from './furniture.js';
import type { PageExtraction } from './types.js';

/**
 * The declared floor, D-324: a non-recurring image covering at least this
 * share of its own page's area earns that page a `'both'` route. See the
 * module doc for why this is declared rather than derived, and therefore not
 * served through `vision-route-envelope.v1`.
 */
export const FIGURE_CUE_MIN_SHARE = 0.05;

/** One image painted directly on a page's own top-level content stream (never inside a Form XObject — see the module doc). */
export interface PageImagePaint {
  /** The PDF indirect object number of the Image XObject — this cue's identity key for recurrence (see the module doc). */
  readonly objectNum: number;
  /** The image's painted area (the CTM's linear determinant) as a share of the page's own `/MediaBox`/`/CropBox` area, `[0, 1]` in the ordinary case. */
  readonly areaShare: number;
}

/**
 * Every object number painted, with `areaShare > 0`, on more than half of
 * the pages this cue could actually inspect (`RUNNING_HEAD_MIN_PAGES` or
 * more such pages required — see the module doc's "non-recurring" section).
 * A page whose `imagePaints` is `undefined` (layout could not be inspected)
 * contributes to neither the numerator nor the denominator: it is simply
 * silent on the question, exactly as an uninspectable page is silent on
 * every other cue in this package.
 */
function findRecurringImages(
  imagePaints: readonly (readonly PageImagePaint[] | undefined)[],
): ReadonlySet<number> {
  const inspectable = imagePaints.filter(
    (paints): paints is readonly PageImagePaint[] => paints !== undefined,
  );
  if (inspectable.length < RUNNING_HEAD_MIN_PAGES) return new Set();

  const pagesContaining = new Map<number, number>();
  for (const paints of inspectable) {
    const onThisPage = new Set(paints.filter((p) => p.areaShare > 0).map((p) => p.objectNum));
    for (const objectNum of onThisPage) {
      pagesContaining.set(objectNum, (pagesContaining.get(objectNum) ?? 0) + 1);
    }
  }

  const majority = Math.floor(inspectable.length / 2) + 1;
  const recurring = new Set<number>();
  for (const [objectNum, count] of pagesContaining) {
    if (count >= majority) recurring.add(objectNum);
  }
  return recurring;
}

/**
 * Upgrades every already-`'text-layer'` page (post `furniture.ts` — a page
 * furniture already demoted to `'vision'` has nothing left for this cue to
 * add) whose `imagePaints` names a non-recurring image at or above
 * `minShare` to `'both'`. `units` is left exactly as it was: a `'both'` page
 * keeps the same text-layer units a `'text-layer'` page would have carried
 * (see `types.ts`'s `RouteDecision` doc) — this function only ever widens
 * the route, never touches what was extracted.
 *
 * `pageImagePaints` must be the same length and order as `pages` — one entry
 * per page, `undefined` where that page's layout could not be inspected
 * (see the module doc).
 */
export function applyFigureCue(
  pages: readonly PageExtraction[],
  pageImagePaints: readonly (readonly PageImagePaint[] | undefined)[],
  minShare: number = FIGURE_CUE_MIN_SHARE,
): readonly PageExtraction[] {
  const recurring = findRecurringImages(pageImagePaints);

  return pages.map((page, index): PageExtraction => {
    if (page.route !== 'text-layer') return page;
    const paints = pageImagePaints[index];
    if (paints === undefined) return page;

    const qualifies = paints.some((p) => !recurring.has(p.objectNum) && p.areaShare >= minShare);
    if (!qualifies) return page;

    return { ...page, route: 'both' };
  });
}
