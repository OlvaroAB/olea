/**
 * The bulk-review triage list's keyboard map (`[D-216]` / `ol-egov.105`,
 * Q6.5). Same split `review/keymap.ts` draws for the review tab: pure and
 * obsidian-free by construction — `bulk-review-view.ts` is the only place a
 * real `KeyboardEvent` gets constructed or listened for; this module
 * resolves `{ key }` to an action, or `null` if the key means nothing here.
 *
 * **Four actions only, per the ruling.** `[D-216]`'s clause 4: "the four the
 * screen needs are move down the list, keep, fix and bin" — nothing else
 * gets a key. In particular the source peek (`REGISTRY_ENTRY_ACTION`,
 * imported and reused as-is in `bulk-review-view.ts`) is **not** a fifth
 * binding here: the ruling is explicit that it "stays click-only" because a
 * key living only on this list would teach a chord she cannot use anywhere
 * else. If that affordance later gains a key on the surface it actually
 * lives on (`review/keymap.ts`), this list inherits it at no cost — this
 * module invents nothing in the meantime.
 *
 * **This removes the `ol-uxk9` "click-only this round, disclosed" caveat**
 * `bulk-review.ts`/`bulk-review-view.ts` carried until now: every action but
 * the source peek is keyboard-reachable as of this module landing, and
 * `hintsFor`'s row (below) is what makes Q6.5's "every hint is a real
 * binding" promise true here rather than merely asserted in a comment.
 */

export type BulkReviewAction =
  | { readonly kind: 'focus-move-down' }
  | { readonly kind: 'keep' }
  | { readonly kind: 'fix' }
  | { readonly kind: 'bin' };

/**
 * Deliberately blind to which row is focused, the same posture
 * `resolveReviewKey`'s own doc asks of itself: this resolves `{ key }` to an
 * action and nothing else, never `event.target`. Which draft the action
 * applies to is `bulk-review-view.ts`'s job (DOM focus tracking), not this
 * module's — keeping that split is what lets this file, and its tests, stay
 * free of any real DOM.
 */
export function resolveBulkReviewKey(event: { readonly key: string }): BulkReviewAction | null {
  const key = event.key;
  if (key === 'ArrowDown') return { kind: 'focus-move-down' };
  if (key === 'k' || key === 'K') return { kind: 'keep' };
  if (key === 'f' || key === 'F') return { kind: 'fix' };
  if (key === 'b' || key === 'B') return { kind: 'bin' };
  return null;
}

export interface BulkReviewHintEntry {
  readonly key: string;
  readonly label: string;
}

/**
 * The exact hint row `bulk-review-view.ts` renders, generated from the same
 * key literals `resolveBulkReviewKey` accepts — see this module's doc for
 * why the two cannot drift apart. Unlike `review/keymap.ts`'s `hintsFor`,
 * this list does not vary by screen: the triage list has exactly one shape,
 * so there is exactly one hint row.
 */
export const BULK_REVIEW_HINTS: readonly BulkReviewHintEntry[] = [
  { key: '↓', label: 'move to the next item' },
  { key: 'K', label: 'keep' },
  { key: 'F', label: 'fix before saving' },
  { key: 'B', label: 'bin' },
];
