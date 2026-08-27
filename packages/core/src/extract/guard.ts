/**
 * The standing check on the extractor interface: **an extractor may never
 * report success with zero yield** (N-013, ol-voen, ol-3vzn, ol-4gv).
 *
 * ## Why this file exists rather than a note in a doc comment
 *
 * Three separate defects in this package have now worn the same shape, and
 * every one of them was found by a human reading output, not by a test:
 *
 *  - **ol-voen** — real lecture PDFs whose page tree lived inside a PDF
 *    1.5+ object stream returned `pages: []`. The extractor threw nothing,
 *    the runner reported no extraction failures, and the report recorded that
 *    as coverage.
 *  - **ol-3vzn** — one `/ObjStm` failed to inflate because a real data byte
 *    had been trimmed as a delimiter, taking a run of leaf page dictionaries
 *    with it. A long document reported short, `outcome: 'extracted'`, no
 *    warning.
 *  - **ol-4gv** — the reporting half of the same story: `pages: []` cannot
 *    distinguish "this source genuinely has no pages" from "this source has
 *    pages and I could not reach them".
 *
 * The first two were established by measuring against a real-world vault; the
 * figures stay private, in `olea-service/findings/E4-corpus-and-zero-yield.md`.
 *
 * `ExtractionOutcome` (see `types.ts`) gave the *vocabulary* to tell those
 * apart. It did not give anyone a *reason to be correct*: an extractor is
 * still free to fill in `'extracted'` next to an empty page list, or to
 * route a page to Slot G while handing it nothing, and nothing in the type
 * system objects. That is the N-013 failure mode exactly — a check that
 * cannot fail is anti-evidence, and a discriminant nobody validates is a
 * check that cannot fail.
 *
 * So this module makes the invariants **executable**, at the one boundary
 * every production extraction crosses (`registry.ts#extractFromVault`, and
 * every entry in `EXTRACTORS`). It throws rather than warns, deliberately:
 * a warning is a silence with extra steps, and silence is the defect.
 *
 * ## The gap this file used to name, now closed
 *
 * This doc used to end by admitting that the guard could not see inside a
 * format: a PDF page whose content stream existed but failed to decode
 * reported `charCount: 0` and routed to vision, indistinguishable *at this
 * interface* from a genuinely image-only page, because `PageExtraction` had no
 * field for "content was present and unreadable". Two more defects then wore
 * exactly that shape — **ol-x1ch**, whole producer classes decoding to nothing
 * while `outcome` read `'extracted'` and every page was escalated to the
 * vision slot at full price, and **ol-s3xa**, pages of NULs and unresolved
 * glyph indices clearing the routing threshold and becoming eligible to be
 * quoted back to the user. `PageTextLayer` is the field that gap was waiting
 * for; R6–R9 below are the rules it made expressible.
 *
 * What is *still* outside this guard's reach is anything that requires knowing
 * what the page was supposed to say. Mojibake made entirely of printable
 * characters — a CID-keyed font read as Latin-1 — passes every rule here, and
 * is not claimed to be caught (see `plausibility.ts`).
 */

import { isReachedButUnreadable } from './plausibility.js';
import type { ExtractionResult, ExtractOptions, Extractor, ExtractorInput } from './types.js';

/**
 * Thrown when an `ExtractionResult` claims more than it delivered. Carries
 * every violation found rather than the first, so a failing extractor is
 * diagnosed in one pass.
 *
 * **Contains no extracted text** (D-005, INV-3): the message names the
 * source path, the page number, and the shape of the lie. A guard that
 * quoted the content it was checking would be a content log.
 */
export class SilentExtractionError extends Error {
  readonly violations: readonly string[];
  readonly sourcePath: string;

  constructor(sourcePath: string, violations: readonly string[]) {
    super(
      `extraction reported success it did not earn for ${JSON.stringify(sourcePath)}: ` +
        `${violations.join('; ')}. An extractor may never report success with zero yield ` +
        '(see extract/guard.ts).',
    );
    this.name = 'SilentExtractionError';
    this.sourcePath = sourcePath;
    this.violations = violations;
  }
}

/**
 * Every way `result` claims success it did not earn, as human-readable
 * strings. Empty means the result is honest.
 *
 * Exported separately from the assertion so a caller that genuinely wants to
 * *report* rather than *throw* — an eval harness sweeping a corpus, say —
 * can do so without catching, and so the rules themselves are directly
 * testable one at a time.
 */
export function extractionYieldViolations(result: ExtractionResult): readonly string[] {
  const violations: string[] = [];

  // R1 — the ol-voen shape. `'extracted'` means "at least one page record was
  // produced" (types.ts: "'extracted' iff pages.length > 0"). Saying it over
  // an empty page list is the original silent success.
  if (result.outcome === 'extracted' && result.pages.length === 0) {
    violations.push(
      "outcome 'extracted' with zero pages — the silent-empty shape ol-voen exists to prevent",
    );
  }

  // R2 — the converse, which is a different lie with the same root: pages
  // were produced and the discriminant denies it, so a caller branching on
  // `outcome` discards real work. `'reached-but-unreadable'` and
  // `'furniture-only'` are the two non-`'extracted'` outcomes that *do*
  // assert page records, which is the whole of what each means (ol-x1ch;
  // SCAN-1/ol-738i).
  if (
    result.outcome !== 'extracted' &&
    result.outcome !== 'reached-but-unreadable' &&
    result.outcome !== 'furniture-only' &&
    result.pages.length > 0
  ) {
    violations.push(
      `outcome '${result.outcome}' with ${result.pages.length} page record(s) — pages were produced and the outcome denies it`,
    );
  }

  // R6 — ol-x1ch, the rule this bead was filed to make executable. Pages were
  // reached, every one of them had a text layer we could not read, and the
  // result still says `'extracted'`. That is ol-voen's shape one level down:
  // the old `pages.length > 0` discriminant was satisfied, the honesty guard
  // was silent, and every page went to the vision slot at full price with
  // nobody told why. Note what this does *not* fire on: a genuine scan, whose
  // pages are `'absent'` rather than `'unreadable'` — see `isReachedButUnreadable`.
  if (result.outcome === 'extracted' && isReachedButUnreadable(result.pages)) {
    violations.push(
      `outcome 'extracted' over ${result.pages.length} page(s) whose text layer was reached and yielded nothing readable — the silent-decode-failure shape ol-x1ch exists to prevent`,
    );
  }

  // R7 — the converse again, so the new outcome cannot be over-claimed: a
  // document with a readable page in it is not a document that could not be
  // read, and reporting one as a failure would train callers to ignore the
  // field.
  if (result.outcome === 'reached-but-unreadable' && !isReachedButUnreadable(result.pages)) {
    violations.push(
      "outcome 'reached-but-unreadable' over pages that do not support it — either no page was unreadable, at least one was readable, or there are no pages at all",
    );
  }

  for (const page of result.pages) {
    const unitChars = page.units.reduce((sum, unit) => sum + unit.text.length, 0);

    // R3 — the page-level version, and the one the standing check is named
    // for. `'text-layer'` is a claim: *this page's own text is good enough
    // to feed Slot G directly* (types.ts, `RouteDecision`). A page making
    // that claim while carrying nothing is a page reporting success with
    // zero yield. The honest report for a page with nothing on it is
    // `'vision'`, which is what `routePage` produces for any yield below
    // the threshold — including zero.
    if (page.route === 'text-layer' && unitChars === 0) {
      violations.push(
        `page ${page.page} routed to the text layer with no extracted text (charCount ${page.charCount}, ${page.units.length} unit(s)) — a page claiming a usable text layer must carry one`,
      );
    }

    // R4 — a unit of empty text is zero yield wearing a unit's clothes: it
    // survives `units.length > 0` checks downstream and cites nothing.
    for (const [index, unit] of page.units.entries()) {
      if (unit.text.length === 0) {
        violations.push(`page ${page.page} unit ${index} carries empty text`);
      }
    }

    // R5 — the other direction of the same inconsistency. `charCount` is
    // what the cost model's routing and every yield measurement read; units
    // present alongside a zero count means one of the two is fiction.
    if (page.charCount === 0 && page.units.length > 0) {
      violations.push(
        `page ${page.page} reports charCount 0 alongside ${page.units.length} unit(s) — the count and the units disagree`,
      );
    }

    // R8 — ol-s3xa. `'text-layer'` claims *this page's own text is good enough
    // to feed Slot G directly*, and a page whose characters are not characters
    // cannot make that claim however many of them it produced. This is the one
    // rule here that the char-count discriminant structurally could not
    // express: the affected pages have a large `charCount`, clear the routing
    // threshold comfortably, and are wrong anyway. The consumer that makes it
    // urgent is the quote span (F3.10/F3.11) — a correct citation carrying an
    // unreadable passage is worse than no citation.
    if (page.route === 'text-layer' && page.textLayer === 'unreadable') {
      violations.push(
        `page ${page.page} routed to the text layer with an unreadable text layer (charCount ${page.charCount}) — a page whose characters are not characters must not be offered to Slot G or quoted`,
      );
    }

    // R9 — the count-vs-quality version of R5: a page that says it has no text
    // layer at all cannot also have produced characters.
    if (page.textLayer === 'absent' && page.charCount > 0) {
      violations.push(
        `page ${page.page} reports textLayer 'absent' alongside charCount ${page.charCount} — the quality signal and the count disagree`,
      );
    }

    // R10 — SCAN-1/ol-738i. A page marked furniture has nothing to offer
    // Slot G, the same posture R8 holds for a page whose characters are not
    // characters, so it must not claim the text-layer route.
    if (page.furniture && page.route === 'text-layer') {
      violations.push(
        `page ${page.page} is marked furniture but routed to the text layer — a page that is furniture must not be offered to Slot G or quoted`,
      );
    }

    // R11 — the R5 shape applied to furniture: a page with nothing to offer
    // (furniture, by definition) cannot also carry units.
    if (page.furniture && page.units.length > 0) {
      violations.push(
        `page ${page.page} is marked furniture but carries ${page.units.length} unit(s) — a furniture page has nothing to hand to Slot G`,
      );
    }
  }

  // R12 — the R2 shape for the new outcome, checked against the per-page
  // signal directly (this is a self-consistency check between two fields the
  // same extractor sets, in the family of R5/R9, not an independent
  // recomputation like R6/R7: `applyFurnitureDetection` clears `units` on a
  // furniture page, which is exactly the evidence a from-scratch recompute
  // would need, so this only asserts the two claims the extractor already
  // made agree with each other).
  const anyPageFurniture = result.pages.some((page) => page.furniture);
  if (result.outcome === 'extracted' && anyPageFurniture) {
    violations.push(
      "outcome 'extracted' with a page marked furniture — SCAN-1's discriminator fired and the outcome does not say so",
    );
  }
  if (result.outcome === 'furniture-only' && !anyPageFurniture) {
    violations.push(
      "outcome 'furniture-only' with no page marked furniture — either no page supports it or the outcome over-claims",
    );
  }

  return violations;
}

/**
 * Throws `SilentExtractionError` if `result` claims success it did not earn;
 * returns it unchanged otherwise, so it composes as
 * `return assertHonestExtraction(await extractor.extract(...))`.
 */
export function assertHonestExtraction(result: ExtractionResult): ExtractionResult {
  const violations = extractionYieldViolations(result);
  if (violations.length > 0) throw new SilentExtractionError(result.sourcePath, violations);
  return result;
}

/**
 * Wraps an `Extractor` so every result it produces is checked before any
 * caller sees it. `registry.ts` applies this to all four registered
 * extractors, which is what makes the check *standing* rather than
 * advisory — a fifth format added to `EXTRACTORS` inherits it without
 * anyone remembering to.
 *
 * The raw extractors stay exported from their own modules unwrapped, so a
 * format's own unit tests can still assert its literal output (including
 * output this guard would reject under a pathological threshold override).
 */
export function guardExtractor(extractor: Extractor): Extractor {
  return {
    format: extractor.format,
    async extract(input: ExtractorInput, options?: ExtractOptions): Promise<ExtractionResult> {
      return assertHonestExtraction(await extractor.extract(input, options));
    },
  };
}
