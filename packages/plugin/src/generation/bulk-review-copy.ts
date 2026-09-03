/**
 * Copy for the bulk-review clearing row's source marker (F3.3, `[D-216]` /
 * `ol-egov.105`).
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
 */

/**
 * `noteTitle` is the group's own note title (`bulk-review.ts`'s
 * `buildBulkReviewGroups`, the same basename convention `review-adapter.ts`
 * uses) — never the raw `sourcePath`, which would read as a file path
 * rather than "ordinary words".
 */
export function sourceMarkerText(noteTitle: string): string {
  return `From your reading on ${noteTitle}.`;
}
