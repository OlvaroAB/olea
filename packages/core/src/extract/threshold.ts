/**
 * Text-layer-first routing policy (cost model §5.1, §6.4, C3, P3-T04).
 *
 * The cost model is blunt about what this file is. It asks C3 to make vision
 * escalation a *routing decision* — attempt text extraction, measure
 * character yield per page, and escalate to Slot V only below a threshold —
 * and it identifies the assumed vision-routing rate that this threshold
 * determines as both the single largest lever on its own spend projection and
 * the number in it that it trusts least. That combination — biggest lever,
 * shakiest input — is why this constant exists in its own tiny module rather
 * than buried as a magic number in `pdf.ts`: it needs one clearly-labelled
 * place to be found, argued with, and eventually replaced by real measurement
 * (E4/P3-T06 — cost model §6, question 4). The routing requirement, the
 * assumed rate and the spend figures behind that judgement all live in
 * `olea-service/docs/Olea_ai_workload_and_cost_model.md` §5.1 and §6.4, which
 * is private-classified and so is cited by path rather than quoted.
 *
 * **What the threshold is actually distinguishing.** Not "substantial
 * content" vs "sparse content" — a legitimate title slide might carry as
 * few as 20-40 characters of real text (see the fixture PDF's single page,
 * "GEOL204 Week 2 - Deposition", 44 characters) and must not be
 * misrouted to the 6.5x-more-expensive vision slot for being terse. It is
 * distinguishing "this page's extraction yielded genuine text, however
 * little" from "this page's extraction yielded nothing but incidental
 * artifacts" — a stray watermark, a template footer, a page-number stamp —
 * which is what an image-only slide or a scanned page actually produces
 * when run through a text extractor with no OCR: not a *low* character
 * count, but a near-*zero* one, because there are no text-showing operators
 * in the content stream at all.
 *
 * **`DEFAULT_TEXT_LAYER_CHAR_THRESHOLD = 10` is an adopted value, not this
 * file's own invention.** It was set from a measurement; the measurement
 * itself is private and does not ship — only the number below is public.
 * Treat it as *derived*, not *declared*: it moves only via a decision bead,
 * never by local judgement about what "feels" thin enough. As a sanity
 * check on the shipped number, not an argument for it: ten characters per
 * page is comfortably below any plausible genuine slide or document page
 * (even a bare section-divider slide with just a number on it clears this),
 * while still catching the near-zero yield a true image-only or scanned
 * page produces. Getting it wrong in either direction is expensive in a
 * specific, asymmetric way: too high routes legitimate thin-but-real pages
 * to Slot V for no quality gain; too low fails to catch genuinely scanned
 * pages, silently handing near-empty or garbage text to Slot G instead of
 * routing to vision, which is worse than a cost mistake — it's a quality
 * failure that looks like success.
 */

import type { RouteDecision } from './types.js';

/**
 * Characters-per-page below which a page routes to Slot V instead of Slot
 * G. Provisional — see the module doc. Configurable per call via
 * `ExtractOptions.textLayerCharThreshold`; this is only the seed default.
 */
export const DEFAULT_TEXT_LAYER_CHAR_THRESHOLD = 10;

/**
 * The routing decision itself, factored out as a pure function so the
 * boundary (at / just below / just above the threshold) is directly
 * testable without needing a real document of any format — see
 * `threshold.spec.ts`. `charCount` strictly below `threshold` routes to
 * Slot V; `charCount === threshold` stays on the text layer (the threshold
 * names the lowest *acceptable* yield, not the highest *rejected* one).
 */
export function routePage(
  charCount: number,
  threshold: number = DEFAULT_TEXT_LAYER_CHAR_THRESHOLD,
): RouteDecision {
  return charCount < threshold ? 'vision' : 'text-layer';
}
