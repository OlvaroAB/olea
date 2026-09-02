/**
 * The review session's keyboard map (Q6.5, `Annotations.jsx`'s "Keyboard
 * map" table). Pure and obsidian-free by construction — `view.ts` is the
 * only place a real `KeyboardEvent` gets constructed or listened for; this
 * module resolves `{ key }` plus "what screen is showing" to an action, or
 * `null` if the key means nothing right now.
 *
 * Q6.5 requires two things at once: every action must have a keyboard path,
 * and "every hint shown on screen must be a real binding" — hints are never
 * allowed to promise a key this resolver doesn't accept. `render.ts` builds
 * its on-screen hint rows from `HINTS` below rather than hand-typing key
 * labels a second time, so the two cannot drift apart.
 *
 * **A still-pending draft item (`isNewDraft` on `ReviewScreen`, ol-uxk9)
 * repurposes E/S rather than adding new keys.** `view.ts`'s header already
 * swaps "Edit note"/"Suspend" for "Edit before saving"/"Reject" on a draft
 * item (F3.3, `[D-097]`) — same physical position, same two keys, different
 * meaning for something not yet in the vault. `isNewDraftScreen` below is
 * the one place that decides "is this screen a draft" for both
 * `resolveReviewKey` and `hintsFor`, so the resolver and the hint row can
 * never disagree about which pair of actions E/S currently mean.
 *
 * **And `[D-189]` (ol-0r92.36) narrows WHEN that pair is reachable at all.**
 * The edit affordance lives at the reveal, never before it: on a draft's
 * pre-reveal screen (`card-front`/`mcq-unanswered`) E and S are bound to
 * nothing, and the hint row shows neither — not the draft pair (she hasn't
 * seen the draft's own answer yet to weigh an edit against) and not the
 * ordinary pair either (nothing has landed to edit or suspend). `isRevealScreen`
 * below is the second predicate this needs, alongside `isNewDraftScreen`.
 */

import type { Rating } from 'olea-contracts';

/**
 * `isNewDraft` (ol-uxk9, Q6.5 completeness) marks a screen whose item is
 * still a cached, unaccepted draft (`instrument.draftId !== null`, F3.3,
 * `[D-097]`) — only the three item screens an unresolved draft can actually
 * be showing (`view.ts`'s `resolveDraftAt` runs on `rate`/`mcqAnswer`, so a
 * draft is always resolved before `mcq-answered` renders, and `note-missing`
 * has no draft path at all: nothing has landed in a note yet to go missing).
 * Optional rather than required, so the many call sites that build a plain
 * screen literal to probe a single keycap (`copy.ts`'s `ratingKeycap`,
 * `mcqOptionKeycap`) — none of which care about the header's E/S pair —
 * don't have to thread a value through; the safe default (`undefined` reads
 * as "not a draft") is also the conservative one; it never *invents* draft
 * behaviour, only omits it where nobody asked.
 */
export type ReviewScreen =
  | { readonly kind: 'card-front'; readonly isNewDraft?: boolean }
  | { readonly kind: 'card-reveal'; readonly isNewDraft?: boolean }
  | {
      readonly kind: 'mcq-unanswered';
      readonly optionCount: number;
      readonly isNewDraft?: boolean;
    }
  | { readonly kind: 'mcq-answered' }
  | { readonly kind: 'session-complete' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'note-missing' };

export type ReviewAction =
  | { readonly kind: 'reveal' }
  | { readonly kind: 'flip-back' }
  | { readonly kind: 'rate'; readonly rating: Rating }
  | { readonly kind: 'mcq-answer'; readonly optionIndex: number }
  | { readonly kind: 'mcq-toggle-guessed' }
  | { readonly kind: 'mcq-next' }
  | { readonly kind: 'edit' }
  | { readonly kind: 'suspend' }
  | { readonly kind: 'accept-edit-draft' }
  | { readonly kind: 'reject-draft' }
  | { readonly kind: 'end-session' }
  | { readonly kind: 'close-tab' }
  | { readonly kind: 'focus-move'; readonly direction: 'up' | 'down' }
  | { readonly kind: 'skip-missing-note' }
  | { readonly kind: 'remove-missing-note' };

/** Rating key digits, in `QA_CLOZE_RATING_ORDER`'s order — '1' is Again, '4' is Easy, matching `Annotations.jsx`. */
const RATING_KEYS: Readonly<Record<string, Rating>> = {
  '1': 'again',
  '2': 'hard',
  '3': 'good',
  '4': 'easy',
};

/**
 * MCQ option letters, matching `ReviewStates.jsx`'s `McqOption` lettering
 * (A, B, C, ...). Also reachable via the number row.
 *
 * Corrected by P2-T04/P2-T05 (Lane F): this used to say "F2.15 caps the pool at
 * 3 shown options". It does not. F2.15 samples **3 distractors** from a pool of
 * ≥4 and presents them **plus the correct answer**, so a presentation is always
 * 4 options — see `olea-core`'s `PRESENTED_OPTIONS`. The digit range therefore
 * has to reach 4, which it does. No behaviour depended on the wrong number
 * (`resolveReviewKey` bounds on `screen.optionCount`), and the collision the
 * old comment worried about cannot arise at all: MCQ screens never show rating
 * buttons.
 */
const MCQ_LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const MCQ_NUMBERS = '123456789';

function normaliseSpace(key: string): boolean {
  return key === ' ' || key === 'Spacebar';
}

/**
 * Screens with an on-screen item to act on — where the "every item" global
 * bindings (E, S, Esc, arrows) apply. `session-complete`, `empty` and
 * `note-missing` each have no editable/suspendable item, so they opt out.
 *
 * Exported so `view.ts`'s header can gate the "Edit note"/"Suspend" **pointer**
 * affordances on the same predicate that already decides whether E/S do
 * anything (ol-63xn) — a second hand-typed screen-kind list in the DOM layer
 * is exactly the drift this bead was filed over: the keycaps stopped
 * advertising a dead shortcut on `note-missing` once they were derived from
 * this function, but the buttons themselves kept rendering because nothing
 * asked it the same question.
 */
export function hasGlobalBindings(screen: ReviewScreen): boolean {
  return (
    screen.kind !== 'session-complete' && screen.kind !== 'empty' && screen.kind !== 'note-missing'
  );
}

/**
 * Whether `screen` is currently showing an unresolved draft — the one thing
 * that changes what E/S mean within the global bindings above (`edit`/`suspend`
 * become `accept-edit-draft`/`reject-draft`, reusing the same physical keys
 * rather than adding new ones, because the header replaces the same two
 * buttons those keys already hint at — see `view.ts`'s `renderHeader` doc).
 *
 * Written as its own exhaustive switch over `ReviewScreen['kind']`, rather
 * than an inline `screen.kind === 'card-front' || ...` check, so that adding
 * a future screen kind is a compile error here until someone decides whether
 * a draft can ever show on it — the same reason `resolveReviewKey`'s and
 * `hintsFor`'s own switches are exhaustive with no `default`.
 */
function isNewDraftScreen(screen: ReviewScreen): boolean {
  switch (screen.kind) {
    case 'card-front':
    case 'card-reveal':
    case 'mcq-unanswered':
      return screen.isNewDraft === true;
    case 'mcq-answered':
    case 'session-complete':
    case 'empty':
    case 'note-missing':
      return false;
  }
}

/**
 * The two screens where "reveal" has happened — she has seen the draft's own
 * answer (Q&A/cloze) or the correct option (MCQ) — versus the two "front"
 * screens where she has been asked for hers but not yet shown the draft's
 * (`card-front`, `mcq-unanswered`). `[D-189]` (ol-0r92.36) is what this
 * predicate exists for: the edit/reject pair on a draft item is reachable
 * only where this returns `true` — see `resolveReviewKey` and `hintsFor`
 * below, and `view.ts`'s `renderHeader`, which gates the same pair on the
 * same two screen kinds.
 */
function isRevealScreen(screen: ReviewScreen): boolean {
  return screen.kind === 'card-reveal' || screen.kind === 'mcq-answered';
}

/**
 * Deliberately blind to focus. This resolves `{ key, screen }` to an action
 * and nothing else — it never sees `event.target`, because that is real DOM
 * and this module's own doc reserves real `KeyboardEvent`s to `view.ts`
 * alone. That means this function must never be the place that decides "a
 * focused button already owns this key" — it structurally cannot, since it
 * has no target to check.
 *
 * ol-l5og.13 (bare Space/Enter firing the screen-wide action instead of
 * activating a focused `<button>`) is exactly that decision, and it belongs
 * in `view.ts`'s `handleKeydown`, next to the existing INPUT/TEXTAREA/
 * `isContentEditable` guard that already exempts real text fields the same
 * way before ever calling `resolveReviewKey`. Every review control is a real
 * `<button>` wired to its own click handler (`renderHeader`, rating rows,
 * MCQ options, …), so extending that guard to BUTTON/anchor/`role="button"`
 * for Space and Enter is sufficient — nothing here needs a wider signature.
 */
export function resolveReviewKey(
  event: { readonly key: string },
  screen: ReviewScreen,
): ReviewAction | null {
  const key = event.key;

  if (hasGlobalBindings(screen)) {
    const isDraft = isNewDraftScreen(screen);
    // `[D-189]` (ol-0r92.36): the edit/reject pair — draft or ordinary —
    // lives at the reveal, never before it. A draft's pre-reveal screen
    // (`card-front`/`mcq-unanswered`) has nothing to bind E/S to: not the
    // draft pair (too early — see `view.ts`'s `renderHeader` doc) and not
    // the ordinary pair either (nothing has landed to edit or suspend yet).
    // Escape and the arrow keys below are untouched by this — ending the
    // session or moving focus means the same thing on every screen.
    if (isDraft ? isRevealScreen(screen) : true) {
      if (key === 'e' || key === 'E') {
        return isDraft ? { kind: 'accept-edit-draft' } : { kind: 'edit' };
      }
      if (key === 's' || key === 'S') {
        return isDraft ? { kind: 'reject-draft' } : { kind: 'suspend' };
      }
    }
    if (key === 'Escape') return { kind: 'end-session' };
    if (key === 'ArrowUp') return { kind: 'focus-move', direction: 'up' };
    if (key === 'ArrowDown') return { kind: 'focus-move', direction: 'down' };
  }

  switch (screen.kind) {
    case 'card-front':
      return normaliseSpace(key) ? { kind: 'reveal' } : null;

    case 'card-reveal': {
      if (normaliseSpace(key)) return { kind: 'flip-back' };
      const rating = RATING_KEYS[key];
      return rating !== undefined ? { kind: 'rate', rating } : null;
    }

    case 'mcq-unanswered': {
      const letterIndex = MCQ_LETTERS.indexOf(key.toLowerCase());
      const numberIndex = MCQ_NUMBERS.indexOf(key);
      const index = key.length === 1 && letterIndex !== -1 ? letterIndex : numberIndex;
      return index !== -1 && index < screen.optionCount
        ? { kind: 'mcq-answer', optionIndex: index }
        : null;
    }

    case 'mcq-answered':
      if (key === 'g' || key === 'G') return { kind: 'mcq-toggle-guessed' };
      if (normaliseSpace(key)) return { kind: 'mcq-next' };
      return null;

    case 'session-complete':
      return key === 'Escape' || key === 'Enter' ? { kind: 'close-tab' } : null;

    case 'note-missing':
      if (key === 'Enter' || key === 'ArrowRight') return { kind: 'skip-missing-note' };
      if (key === 'Delete' || key === 'Backspace') return { kind: 'remove-missing-note' };
      // Nothing to edit or suspend when the note is gone, but Q6.5 still
      // promises a keyboard path out of every screen — Escape ends the
      // session from here exactly like it does from any item screen.
      if (key === 'Escape') return { kind: 'end-session' };
      return null;

    case 'empty':
      // No item, so nothing to reveal/rate/edit/suspend — but Q6.5's "exit"
      // action must still reach every screen, this one included.
      return key === 'Escape' || key === 'Enter' ? { kind: 'close-tab' } : null;
  }
}

export interface HintEntry {
  readonly key: string;
  readonly label: string;
}

/** The exact hint rows each screen renders (`PluginHintRow` in the mocks), generated from the same bindings `resolveReviewKey` accepts — see this module's doc. */
export function hintsFor(screen: ReviewScreen): readonly HintEntry[] {
  const isDraft = isNewDraftScreen(screen);
  // `[D-189]`: no E/S hint at all on a draft's pre-reveal screen — a hint
  // promising a key `resolveReviewKey` now refuses there would itself
  // violate Q6.5 ("every hint shown on screen must be a real binding").
  // `Esc` (end session) is unaffected and still shown.
  const editSuspendHints: HintEntry[] =
    isDraft && !isRevealScreen(screen)
      ? []
      : [
          isDraft
            ? { key: 'E', label: 'edit before saving' }
            : { key: 'E', label: 'edit the note' },
          isDraft ? { key: 'S', label: 'reject' } : { key: 'S', label: 'suspend' },
        ];
  const global: HintEntry[] = hasGlobalBindings(screen)
    ? [...editSuspendHints, { key: 'Esc', label: 'end session' }]
    : [];

  switch (screen.kind) {
    case 'card-front':
      return [{ key: 'Space', label: 'reveal the answer' }, ...global];
    case 'card-reveal':
      return [
        { key: '1–4', label: 'rate what just happened' },
        { key: 'Space', label: 'flip back' },
        ...global,
      ];
    case 'mcq-unanswered': {
      // Derived from `optionCount`, never written down. This row used to read
      // `A–C` / `1–3`, which was the same off-by-one `MCQ_LETTERS`' doc above
      // was already corrected for once: F2.15 samples three *distractors* and
      // presents them **plus the correct answer**, so a presentation is four
      // options and `resolveReviewKey` binds all four. The constant's comment
      // was fixed and this row was missed, so the shipped hint hid a key that
      // was on screen, lettered, and working. `keymap.spec.ts` only asserted
      // that every hinted key resolves — which a too-narrow hint passes — so
      // nothing failed; that suite now asserts the converse too.
      const last = Math.min(screen.optionCount, MCQ_LETTERS.length, MCQ_NUMBERS.length);
      const letters = last <= 1 ? 'A' : `A–${(MCQ_LETTERS[last - 1] ?? 'a').toUpperCase()}`;
      const numbers = last <= 1 ? '1' : `1–${MCQ_NUMBERS[last - 1] ?? '1'}`;
      return [
        { key: letters, label: 'answer' },
        { key: numbers, label: 'the same options, for the number row' },
        ...global,
      ];
    }
    case 'mcq-answered':
      return [
        { key: 'G', label: "wasn't sure · guessed (optional)" },
        { key: 'Space', label: 'next item' },
        ...global,
      ];
    case 'session-complete':
      return [
        { key: 'Esc', label: 'close the tab' },
        { key: '⏎', label: 'close the tab' },
      ];
    case 'note-missing':
      return [
        { key: '↵', label: 'skip this item' },
        { key: 'Delete', label: 'remove it from the queue' },
        { key: 'Esc', label: 'end session' },
      ];
    case 'empty':
      return [
        { key: 'Esc', label: 'close' },
        { key: '⏎', label: 'close' },
      ];
  }
}
