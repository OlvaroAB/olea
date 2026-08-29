/**
 * Every user-facing string `HomeView` can render (F8.8, `[D-134]` Q1,
 * `ol-0r92.17`).
 *
 * One vocabulary site, same convention every other screen in this plugin
 * holds — `test/home/copy.spec.ts` asserts over `allHomeStrings()`.
 *
 * F8.3's ban applies here too: no percentage, ratio or single completion
 * figure. This screen's whole content is F8.8's already-tested offer-card
 * line (`retrospective/offer-card.ts`'s own `offerCardLine`) plus two
 * button labels and two status lines — there is no room here to invent a
 * scalar, and this test is a tripwire against a future edit adding one.
 */

export const HOME_VIEW_TITLE = 'Home';

export const HOME_UNAVAILABLE = 'Olea could not read your vault just now.';

/**
 * D-134 Q1's "does not chase her" the other way round: an empty standing-
 * offer list is a plain fact, not an apology and not a claim that
 * everything else is fine (`today/view.ts` is where due counts and mastery
 * already live — this screen never repeats them).
 */
export const HOME_NOTHING_STANDING = 'Nothing is waiting right now.';

export const OPEN_RETROSPECTIVE_ACTION = 'Open';

export const DISMISS_OFFER_ACTION = 'Not now';

/** Every string this module can render, for `test/home/copy.spec.ts`'s honesty checks. */
export function allHomeStrings(): readonly string[] {
  return [
    HOME_VIEW_TITLE,
    HOME_UNAVAILABLE,
    HOME_NOTHING_STANDING,
    OPEN_RETROSPECTIVE_ACTION,
    DISMISS_OFFER_ACTION,
  ];
}
