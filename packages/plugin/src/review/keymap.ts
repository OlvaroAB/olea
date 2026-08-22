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
 */

import type { Rating } from 'olea-contracts';

export type ReviewScreen =
  | { readonly kind: 'card-front' }
  | { readonly kind: 'card-reveal' }
  | { readonly kind: 'mcq-unanswered'; readonly optionCount: number }
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

/** Screens with an on-screen item to act on — where the "every item" global bindings (E, S, Esc, arrows) apply. `session-complete`, `empty` and `note-missing` each have no editable/suspendable item, so they opt out. */
function hasGlobalBindings(screen: ReviewScreen): boolean {
  return (
    screen.kind !== 'session-complete' && screen.kind !== 'empty' && screen.kind !== 'note-missing'
  );
}

export function resolveReviewKey(
  event: { readonly key: string },
  screen: ReviewScreen,
): ReviewAction | null {
  const key = event.key;

  if (hasGlobalBindings(screen)) {
    if (key === 'e' || key === 'E') return { kind: 'edit' };
    if (key === 's' || key === 'S') return { kind: 'suspend' };
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
  const global: HintEntry[] = hasGlobalBindings(screen)
    ? [
        { key: 'E', label: 'edit the note' },
        { key: 'S', label: 'suspend' },
        { key: 'Esc', label: 'end session' },
      ]
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
