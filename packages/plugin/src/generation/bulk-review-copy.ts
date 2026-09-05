/**
 * Copy for the bulk-review clearing row's source marker (F3.3, `[D-216]` /
 * `ol-egov.105`; authored-note branch `[D-214]` / `ol-egov.101` / `ol-ymew`).
 *
 * `[D-216]`'s ruling: the claim on a clearing row is the tool's, not hers,
 * so the one thing she can bring to it is a check against where it came
 * from. The floor of a row is therefore a **named origin in ordinary
 * words, always visible** — a plain pointer, never citation punctuation
 * (no brackets, no footnote marks, no "Source:" label) and never a
 * technical term. This module holds that one sentence so `bulk-review-view.ts`
 * never hand-builds it twice and a future tweak has one place to land.
 *
 * **The marker names; it does not vouch (`[D-216]` clause 5).** "From your
 * reading on X" says where the draft came from. It never says the draft is
 * *supported by* X — a citation reads as vouching, and `[D-216]`'s whole
 * point is that a visible source should make "keep" a checkable decision,
 * not a rubber stamp.
 *
 * **`[D-214]` clause 3 (`ol-egov.101`): a note she wrote is not a reading.**
 * "From your reading on X" is honest for a lecture, a PDF, a slide deck —
 * something she consulted. It is the wrong register for a drafted instrument
 * whose material IS a note she wrote herself: nothing was "read", she wrote
 * it. `[D-214]`'s own ruling text: "the instrument's source line states that
 * it came from a note she wrote, because authorship is the one fact Olea
 * already knows for certain about that file." `sourceMarkerOrigin` below
 * decides which register applies; `sourceMarkerText` renders it.
 */

/**
 * A clearing row's source marker has exactly two registers today:
 * `'reading'` — `[D-216]`'s original case, something ingested (a PDF,
 * lecture, slide deck) — and `'authored-note'` — `[D-214]`'s case, a note
 * she wrote herself. Exported so `bulk-review.ts`'s view model can carry the
 * decision `sourceMarkerOrigin` makes without re-deriving it, and so this
 * module stays the one place that knows both wordings exist.
 */
export type SourceMarkerOrigin = 'reading' | 'authored-note';

/**
 * The honest signal, not a filename guess (`ol-ymew`'s own brief). This is a
 * structural fact about the ingestion pipeline's own routing, not an
 * inference from what a `.md` extension might mean in general:
 * `ingestion/process-now.ts`'s `isProcessNowSupported` (and the
 * `[AUTH-1b]`/`[D-152]` debounce path it mirrors) route a markdown note
 * through `buildAuthoredNoteUnit` exclusively — `formatFromExtension`'s
 * `KNOWN_FORMATS` (PDF/PPTX/DOCX/image) never includes markdown, so no other
 * ingestion path in this codebase can ever produce an `ExtractedUnit` — and
 * therefore a `DraftRecord.sourceCitation` — whose `sourcePath` ends in
 * `.md`. A markdown citation path IS an authored-note draft, by
 * construction, not by coincidence.
 *
 * `undefined` (no citation minted — `pipeline.ts` had no unit to draft from)
 * reads as `'reading'`, the pre-`[D-214]` default: absence is not evidence
 * of authorship, and every real `[D-216]` scenario before this bead already
 * assumed a reading.
 *
 * **What this does not catch.** `[D-214]`'s home note (`generation/home-note.ts`,
 * `HOME_NOTE_MARKER_KEY`) is itself markdown; if Olea's own home note were
 * ever re-observed by the arrival watch as if it were an authored note (a
 * gap in `main.ts`'s trigger, not something this module can see or fix from
 * a citation path alone), this signal would call it `'authored-note'` too.
 * Closing that gap needs a vault read against `isOleaHomeNote`, which this
 * module — deliberately vault-free, like the rest of `bulk-review.ts`'s
 * grouping logic — does not have. Disclosed, not hidden; not exercised in
 * production today because nothing currently re-triggers the authored-note
 * path against a note Olea itself created.
 */
export function sourceMarkerOrigin(citationSourcePath: string | undefined): SourceMarkerOrigin {
  return citationSourcePath?.toLowerCase().endsWith('.md') === true ? 'authored-note' : 'reading';
}

/**
 * `noteTitle` is the title to point at in ordinary words — never the raw
 * path, which would read as a file path rather than "ordinary words". For
 * `origin: 'reading'` (the default, unchanged from `[D-216]`) this is the
 * group's own destination-note title (`bulk-review.ts`'s
 * `buildBulkReviewGroups`, the same basename convention `review-adapter.ts`
 * uses). For `origin: 'authored-note'`, the caller passes HER note's own
 * title (`sourceMarkerNoteTitle` on the group view model) rather than the
 * Olea-created sibling home note's title — the whole point of clause 3 is
 * to point at the note she actually wrote, never at Olea's own internal
 * "(Olea)"-suffixed bookkeeping note.
 */
export function sourceMarkerText(
  noteTitle: string,
  origin: SourceMarkerOrigin = 'reading',
): string {
  return origin === 'authored-note'
    ? `From a note you wrote, ${noteTitle}.`
    : `From your reading on ${noteTitle}.`;
}

/**
 * `[STY-0e]` (`ol-l5og.18.5`) — the two remaining strings this view owns.
 *
 * **The empty state names what is here, never what is "waiting"
 * (`bulk-review-view.ts`'s own module doc).** Shown whenever nothing is
 * pending and nothing was resolved this sitting — the state the
 * `bulk-review-empty` scenario captures before she has touched anything.
 */
export const BULK_REVIEW_EMPTY_TEXT = 'Nothing here to review right now.';

/**
 * **The completion state is a receipt, not a badge (F6.7).** F6.7 bans a
 * standalone count of material she has *not yet met* — a debt with an
 * implied target of zero. A tally of what she just decided is the opposite
 * fact: material already met and already resolved, the same category F6.1
 * permits for due work already hers. `ol-2x4`'s ruling on this exact screen
 * (Pass 2's own completion state) rejected the kit's *"They first come up in
 * tomorrow's review"* as a scheduling promise the queue (unbuilt) cannot
 * back, and rejected *"Review the N you rejected"* as a pure kit addition
 * absent from the brief — leaving, in the brief's own words, "the tally plus
 * 'Factual, brief, done.'" This function is exactly that: only the
 * non-zero outcomes, nothing else.
 */
export function bulkReviewCompletionTally(counts: {
  readonly accepted: number;
  readonly edited: number;
  readonly rejected: number;
}): string {
  const parts: string[] = [];
  if (counts.accepted > 0) parts.push(`${counts.accepted} accepted`);
  if (counts.edited > 0) parts.push(`${counts.edited} edited`);
  if (counts.rejected > 0) parts.push(`${counts.rejected} rejected`);
  return `${parts.join(' · ')}.`;
}

export const BULK_REVIEW_COMPLETION_HEADING = 'Done.';

/**
 * The one item shape `draftQuizCardsForConcept` currently produces
 * (`types.ts`'s own doc on `DraftQuestion`) — Q&A and cloze never reach this
 * cache, so a type mark for either would be unreachable by real data.
 * Kept as its own constant rather than a literal in the view so a second
 * generator, when one exists, has one place to add its own label.
 */
export const BULK_REVIEW_ITEM_TYPE_LABEL = 'MCQ';

/**
 * `[STY-6]` (`ol-l5og.18.15`) — the document header's right slot when nothing
 * in this document has been resolved this sitting.
 *
 * The kit's own header carries this sentence (`TriageStates.jsx`'s
 * `TriageHeader` right slot) and BRIEF.md calls it the surface's central
 * promise. It is not an invention of the styling lane: F3.3 states the same
 * fact as a guarantee — drafts "are held in the cache and enter the deck and
 * **her notes** only on acceptance" — so this string is that clause read back
 * to her at the one screen where a whole document's drafts are in front of
 * her at once. It is a statement, never a control.
 */
export const BULK_REVIEW_DECK_REASSURANCE = 'Nothing is in your deck yet.';
