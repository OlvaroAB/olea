/**
 * Every user-facing string `GroveView` can render (F8.1, `ol-0r92.17`).
 *
 * One vocabulary site, same convention `today/copy.ts` and `gap/copy.ts`
 * hold for their own screens — `test/grove/copy.spec.ts` asserts over
 * `allGroveStrings()` so a string added here without adding it there is the
 * one way past the honesty test.
 *
 * **F8.3's ban is absolute here too, even though this view is not yet
 * F8.1's real grove** (see `provider.ts`'s module doc for the gap): no
 * percentage, ratio or single completion figure may ever appear, on this
 * screen or any other.
 */

export const GROVE_VIEW_TITLE = 'Grove';

export const GROVE_UNAVAILABLE = 'Olea could not read your vault just now.';

export const GROVE_EMPTY_COURSE = 'No concepts found here yet.';

/**
 * Renders on every course section, every time — never once and then
 * assumed. F8.1's own escape hatch for a scope Olea inferred alone: "must be
 * labelled one." This is that label. It deliberately never uses the word
 * "grove" for the count itself (`features/F8-concepts-scope.md`'s "a grove
 * Olea alone inferred is labelled a guess and never uses the word 'grove'"
 * scenario) — the heading above it names the screen, this line names the
 * count.
 */
export const GROVE_INFERRED_DISCLAIMER =
  'Built from what Olea has found in your notes for this course — not yet checked against a registered reading list or past paper.';

export const OPEN_RETROSPECTIVE_ACTION = 'Open';

export const DISMISS_OFFER_ACTION = 'Not now';

/** Every string this module can render, for `test/grove/copy.spec.ts`'s honesty checks. */
export function allGroveStrings(): readonly string[] {
  return [
    GROVE_VIEW_TITLE,
    GROVE_UNAVAILABLE,
    GROVE_EMPTY_COURSE,
    GROVE_INFERRED_DISCLAIMER,
    OPEN_RETROSPECTIVE_ACTION,
    DISMISS_OFFER_ACTION,
  ];
}
