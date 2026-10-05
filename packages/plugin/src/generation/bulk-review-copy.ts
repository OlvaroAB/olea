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

import type { DeclaredMadeBy } from 'olea-core';

export type { DeclaredMadeBy };

/**
 * A clearing row's source marker has three registers: `'reading'` (`[D-216]`, something ingested:
 * a PDF, lecture, slide deck), `'authored-note'` (a note she has declared her own, `made-by: me`)
 * and `'kept-note'` (any other note she keeps). `[D-489]`: who produced a note is not a fact Olea
 * knows unless she says so, so only her declaration earns "a note you wrote". Exported so
 * `bulk-review.ts`'s view model can carry the decision without re-deriving it.
 */
export type SourceMarkerOrigin = 'reading' | 'authored-note' | 'kept-note';

/**
 * A Markdown citation path is a note she keeps by construction (`ingestion/process-now.ts` routes
 * markdown through `buildAuthoredNoteUnit` alone), so it is never a `'reading'`. Whether it is a
 * note she WROTE is only her declaration: `declaredMadeBy` is core's `parseMadeBy` result for the
 * note's `made-by` key; `'me'` gives `'authored-note'`, and `'assistant'`, `'mixed'`, an invalid
 * value (parsed to `undefined`) and no declaration all give `'kept-note'`. No citation, or a
 * non-Markdown one, reads as `'reading'` whatever the declaration.
 */
export function sourceMarkerOrigin(
  citationSourcePath: string | undefined,
  declaredMadeBy?: DeclaredMadeBy,
): SourceMarkerOrigin {
  if (citationSourcePath?.toLowerCase().endsWith('.md') !== true) return 'reading';
  return declaredMadeBy === 'me' ? 'authored-note' : 'kept-note';
}

/**
 * `noteTitle` is the title to point at in ordinary words, never the raw path. For the two note
 * origins the caller passes HER note's own title (`sourceMarkerNoteTitle`), never the
 * Olea-created sibling home note's.
 */
export function sourceMarkerText(
  noteTitle: string,
  origin: SourceMarkerOrigin = 'reading',
): string {
  switch (origin) {
    case 'authored-note':
      return `From a note you wrote, ${noteTitle}.`;
    case 'kept-note':
      return `From your notes, ${noteTitle}.`;
    case 'reading':
      return `From your reading on ${noteTitle}.`;
  }
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
