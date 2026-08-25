/**
 * Q6.5's two scenarios in `features/F2-review.md` ("an entire session is
 * completable without a pointer" and "focus is always visible") are
 * `@manual` — a real keyboard-and-screen check. What *is* automatable, and
 * what this file proves, is the part underneath both: every action has a
 * key binding, and every hint `hintsFor` renders is one `resolveReviewKey`
 * actually accepts — the two cannot drift because `hintsFor`'s labels and
 * `resolveReviewKey`'s cases are read from the same key literals below.
 */
import { PRESENTED_OPTIONS } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { hintsFor, type ReviewScreen, resolveReviewKey } from '../../src/review/keymap.js';

const SCREENS: readonly ReviewScreen[] = [
  { kind: 'card-front' },
  { kind: 'card-reveal' },
  // `PRESENTED_OPTIONS`, not a literal. This was `optionCount: 3` while every
  // real presentation had four options, which is precisely why the hint row
  // could promise `A–C` for a screen showing a working D and no test noticed.
  // The number an MCQ screen actually has belongs to core, so it is read from
  // core.
  { kind: 'mcq-unanswered', optionCount: PRESENTED_OPTIONS },
  { kind: 'mcq-answered' },
  { kind: 'session-complete' },
  { kind: 'empty' },
  { kind: 'note-missing' },
  // ol-uxk9: the same three item screens above, but with a still-pending
  // draft (`instrument.draftId !== null`, F3.3, `[D-097]`) — the converse
  // hint-row assertion below runs over these too, so a draft screen's E/S
  // hints get the same "promises nothing the resolver doesn't accept"
  // guarantee as every other screen.
  { kind: 'card-front', isNewDraft: true },
  { kind: 'card-reveal', isNewDraft: true },
  { kind: 'mcq-unanswered', optionCount: PRESENTED_OPTIONS, isNewDraft: true },
];

describe('resolveReviewKey — card front', () => {
  const screen: ReviewScreen = { kind: 'card-front' };

  it('Space reveals', () => {
    expect(resolveReviewKey({ key: ' ' }, screen)).toEqual({ kind: 'reveal' });
  });

  it('rating digits do nothing before reveal', () => {
    expect(resolveReviewKey({ key: '1' }, screen)).toBeNull();
  });

  it.each(['e', 'E'])('%s edits', (key) => {
    expect(resolveReviewKey({ key }, screen)).toEqual({ kind: 'edit' });
  });

  it.each(['s', 'S'])('%s suspends', (key) => {
    expect(resolveReviewKey({ key }, screen)).toEqual({ kind: 'suspend' });
  });

  it('Escape ends the session', () => {
    expect(resolveReviewKey({ key: 'Escape' }, screen)).toEqual({ kind: 'end-session' });
  });

  it('arrow keys move focus', () => {
    expect(resolveReviewKey({ key: 'ArrowUp' }, screen)).toEqual({
      kind: 'focus-move',
      direction: 'up',
    });
    expect(resolveReviewKey({ key: 'ArrowDown' }, screen)).toEqual({
      kind: 'focus-move',
      direction: 'down',
    });
  });
});

describe('resolveReviewKey — card reveal', () => {
  const screen: ReviewScreen = { kind: 'card-reveal' };

  it('Space flips back', () => {
    expect(resolveReviewKey({ key: ' ' }, screen)).toEqual({ kind: 'flip-back' });
  });

  it('1-4 rate Again/Hard/Good/Easy', () => {
    expect(resolveReviewKey({ key: '1' }, screen)).toEqual({ kind: 'rate', rating: 'again' });
    expect(resolveReviewKey({ key: '2' }, screen)).toEqual({ kind: 'rate', rating: 'hard' });
    expect(resolveReviewKey({ key: '3' }, screen)).toEqual({ kind: 'rate', rating: 'good' });
    expect(resolveReviewKey({ key: '4' }, screen)).toEqual({ kind: 'rate', rating: 'easy' });
  });

  it('a rating outside 1-4 does nothing', () => {
    expect(resolveReviewKey({ key: '5' }, screen)).toBeNull();
  });
});

describe('resolveReviewKey — MCQ unanswered', () => {
  const screen: ReviewScreen = { kind: 'mcq-unanswered', optionCount: 3 };

  it('letters A-C answer by index', () => {
    expect(resolveReviewKey({ key: 'a' }, screen)).toEqual({ kind: 'mcq-answer', optionIndex: 0 });
    expect(resolveReviewKey({ key: 'B' }, screen)).toEqual({ kind: 'mcq-answer', optionIndex: 1 });
    expect(resolveReviewKey({ key: 'c' }, screen)).toEqual({ kind: 'mcq-answer', optionIndex: 2 });
  });

  it('the number row 1-3 answers the same three options', () => {
    expect(resolveReviewKey({ key: '1' }, screen)).toEqual({ kind: 'mcq-answer', optionIndex: 0 });
    expect(resolveReviewKey({ key: '3' }, screen)).toEqual({ kind: 'mcq-answer', optionIndex: 2 });
  });

  it('a letter or digit beyond optionCount does nothing', () => {
    expect(resolveReviewKey({ key: 'd' }, screen)).toBeNull();
    expect(resolveReviewKey({ key: '4' }, screen)).toBeNull();
  });

  it('respects a narrower optionCount', () => {
    const twoOptions: ReviewScreen = { kind: 'mcq-unanswered', optionCount: 2 };
    expect(resolveReviewKey({ key: 'c' }, twoOptions)).toBeNull();
  });
});

describe('resolveReviewKey — MCQ answered', () => {
  const screen: ReviewScreen = { kind: 'mcq-answered' };

  it('G toggles "wasn\'t sure / guessed"', () => {
    expect(resolveReviewKey({ key: 'g' }, screen)).toEqual({ kind: 'mcq-toggle-guessed' });
    expect(resolveReviewKey({ key: 'G' }, screen)).toEqual({ kind: 'mcq-toggle-guessed' });
  });

  it('Space advances to the next item', () => {
    expect(resolveReviewKey({ key: ' ' }, screen)).toEqual({ kind: 'mcq-next' });
  });

  it('answer keys do nothing once already answered', () => {
    expect(resolveReviewKey({ key: 'a' }, screen)).toBeNull();
  });
});

describe('resolveReviewKey — a still-pending draft item (ol-uxk9, Q6.5 completeness)', () => {
  // The three item screens a draft can actually be showing when unresolved
  // (`view.ts`'s `currentScreen` computes `isNewDraft` from
  // `instrument.draftId !== null` on exactly these three — `mcqAnswer`/`rate`
  // resolve any pending draft before `mcq-answered` can render again, and
  // `note-missing` has no draft path at all).
  const draftScreens: readonly ReviewScreen[] = [
    { kind: 'card-front', isNewDraft: true },
    { kind: 'card-reveal', isNewDraft: true },
    { kind: 'mcq-unanswered', optionCount: PRESENTED_OPTIONS, isNewDraft: true },
  ];

  it.each(draftScreens)(
    '%j: E accepts-and-edits the draft instead of editing the note',
    (screen) => {
      expect(resolveReviewKey({ key: 'e' }, screen)).toEqual({ kind: 'accept-edit-draft' });
      expect(resolveReviewKey({ key: 'E' }, screen)).toEqual({ kind: 'accept-edit-draft' });
    },
  );

  it.each(draftScreens)('%j: S rejects the draft instead of suspending', (screen) => {
    expect(resolveReviewKey({ key: 's' }, screen)).toEqual({ kind: 'reject-draft' });
    expect(resolveReviewKey({ key: 'S' }, screen)).toEqual({ kind: 'reject-draft' });
  });

  it.each(draftScreens)(
    '%j: Escape and the arrow keys are unaffected by draft status',
    (screen) => {
      expect(resolveReviewKey({ key: 'Escape' }, screen)).toEqual({ kind: 'end-session' });
      expect(resolveReviewKey({ key: 'ArrowUp' }, screen)).toEqual({
        kind: 'focus-move',
        direction: 'up',
      });
    },
  );

  it('isNewDraft: false behaves identically to an ordinary (unmarked) screen', () => {
    const marked: ReviewScreen = { kind: 'card-front', isNewDraft: false };
    const unmarked: ReviewScreen = { kind: 'card-front' };
    expect(resolveReviewKey({ key: 'e' }, marked)).toEqual({ kind: 'edit' });
    expect(resolveReviewKey({ key: 'e' }, marked)).toEqual(
      resolveReviewKey({ key: 'e' }, unmarked),
    );
    expect(resolveReviewKey({ key: 's' }, marked)).toEqual({ kind: 'suspend' });
  });

  it('mcq-answered has no isNewDraft field at all — resolveDraftAt already resolved the draft before this screen can render — so E/S stay the ordinary edit/suspend pair, never accept-edit-draft/reject-draft', () => {
    const screen: ReviewScreen = { kind: 'mcq-answered' };
    expect(resolveReviewKey({ key: 'e' }, screen)).toEqual({ kind: 'edit' });
    expect(resolveReviewKey({ key: 's' }, screen)).toEqual({ kind: 'suspend' });
  });
});

describe('hintsFor — a still-pending draft item swaps the E/S hint labels (ol-uxk9)', () => {
  it('card-front names "edit before saving" / "reject" instead of the ordinary pair', () => {
    const hints = hintsFor({ kind: 'card-front', isNewDraft: true });
    expect(hints).toContainEqual({ key: 'E', label: 'edit before saving' });
    expect(hints).toContainEqual({ key: 'S', label: 'reject' });
    expect(hints).not.toContainEqual({ key: 'E', label: 'edit the note' });
    expect(hints).not.toContainEqual({ key: 'S', label: 'suspend' });
  });

  it('an ordinary (non-draft) card-front keeps the ordinary pair', () => {
    const hints = hintsFor({ kind: 'card-front' });
    expect(hints).toContainEqual({ key: 'E', label: 'edit the note' });
    expect(hints).toContainEqual({ key: 'S', label: 'suspend' });
  });

  it('every draft hint still resolves — the converse (Q6.5) — for all three draft screens', () => {
    const draftScreens: readonly ReviewScreen[] = [
      { kind: 'card-front', isNewDraft: true },
      { kind: 'card-reveal', isNewDraft: true },
      { kind: 'mcq-unanswered', optionCount: PRESENTED_OPTIONS, isNewDraft: true },
    ];
    for (const screen of draftScreens) {
      for (const hint of hintsFor(screen)) {
        for (const key of keysForHint(hint.key)) {
          expect(
            resolveReviewKey({ key }, screen),
            `hint promised "${key}" on ${screen.kind}`,
          ).not.toBeNull();
        }
      }
    }
  });
});

describe('resolveReviewKey — session complete', () => {
  const screen: ReviewScreen = { kind: 'session-complete' };

  it('Escape and Enter both close the tab', () => {
    expect(resolveReviewKey({ key: 'Escape' }, screen)).toEqual({ kind: 'close-tab' });
    expect(resolveReviewKey({ key: 'Enter' }, screen)).toEqual({ kind: 'close-tab' });
  });

  it('the global item bindings (E, S) do not apply — there is no current item', () => {
    expect(resolveReviewKey({ key: 'e' }, screen)).toBeNull();
    expect(resolveReviewKey({ key: 's' }, screen)).toBeNull();
  });
});

describe('resolveReviewKey — note missing', () => {
  const screen: ReviewScreen = { kind: 'note-missing' };

  it('Enter or ArrowRight skips it', () => {
    expect(resolveReviewKey({ key: 'Enter' }, screen)).toEqual({ kind: 'skip-missing-note' });
    expect(resolveReviewKey({ key: 'ArrowRight' }, screen)).toEqual({ kind: 'skip-missing-note' });
  });

  it('Delete or Backspace removes it from the queue', () => {
    expect(resolveReviewKey({ key: 'Delete' }, screen)).toEqual({ kind: 'remove-missing-note' });
    expect(resolveReviewKey({ key: 'Backspace' }, screen)).toEqual({ kind: 'remove-missing-note' });
  });

  it('edit/suspend do not apply — nothing to edit or suspend', () => {
    expect(resolveReviewKey({ key: 'e' }, screen)).toBeNull();
    expect(resolveReviewKey({ key: 's' }, screen)).toBeNull();
  });
});

describe('resolveReviewKey — empty', () => {
  const screen: ReviewScreen = { kind: 'empty' };

  it('Escape and Enter both close the tab — Q6.5\'s "exit" path reaches the empty state too', () => {
    expect(resolveReviewKey({ key: 'Escape' }, screen)).toEqual({ kind: 'close-tab' });
    expect(resolveReviewKey({ key: 'Enter' }, screen)).toEqual({ kind: 'close-tab' });
  });

  it('nothing else does anything — there is no item to reveal, rate, edit or suspend', () => {
    for (const key of ['e', 's', ' ', '1', 'a']) {
      expect(resolveReviewKey({ key }, screen)).toBeNull();
    }
  });
});

describe('hintsFor — every hint on screen is a real binding (Q6.5)', () => {
  it.each(SCREENS)('every hint key on %j resolves to a non-null action', (screen) => {
    for (const hint of hintsFor(screen)) {
      const probeKeys = keysForHint(hint.key);
      expect(probeKeys.length).toBeGreaterThan(0);
      for (const key of probeKeys) {
        expect(resolveReviewKey({ key }, screen), `hint promised "${key}"`).not.toBeNull();
      }
    }
  });

  // The converse, and the assertion whose absence let the defect ship.
  //
  // "Every hint is a real binding" is satisfied by a hint that names too few
  // keys, so `A–C` passed for years on a screen where D was drawn, lettered and
  // bound. A hint that is narrower than the keyboard is the same failure as one
  // that is wider — she reads the row to find out what she can press, and the
  // row was wrong. This walks the resolver instead of the labels.
  it('the MCQ hint row names every option key the resolver accepts', () => {
    for (const optionCount of [2, 3, 4, 5, 9]) {
      const screen: ReviewScreen = { kind: 'mcq-unanswered', optionCount };
      const hinted = new Set(hintsFor(screen).flatMap((hint) => keysForHint(hint.key)));

      for (const key of 'abcdefghi'.slice(0, optionCount)) {
        expect(resolveReviewKey({ key }, screen)).not.toBeNull();
        expect(hinted.has(key), `option key "${key}" is bound but not hinted`).toBe(true);
      }
      for (const key of '123456789'.slice(0, optionCount)) {
        expect(resolveReviewKey({ key }, screen)).not.toBeNull();
        expect(hinted.has(key), `option key "${key}" is bound but not hinted`).toBe(true);
      }
      // …and never promises one past the end.
      const past = 'abcdefghi'[optionCount];
      if (past !== undefined) expect(hinted.has(past)).toBe(false);
    }
  });
});

/**
 * Expands a hint's display label into the concrete `KeyboardEvent.key` values it
 * promises.
 *
 * Ranges are **parsed**, not table-mapped. The table this replaced had one entry
 * per literal the source happened to contain (`'A–C'`, `'1–3'`), so a wrong range
 * in the source and a matching wrong entry here agreed with each other and the
 * suite reported green.
 */
function keysForHint(hintKey: string): string[] {
  const range = /^(.)–(.)$/.exec(hintKey);
  if (range !== null) {
    const [from, to] = [range[1] ?? '', range[2] ?? ''];
    const start = from.toLowerCase().charCodeAt(0);
    const end = to.toLowerCase().charCodeAt(0);
    if (end < start) return [];
    return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i));
  }
  switch (hintKey) {
    case 'Space':
      return [' '];
    case 'Esc':
      return ['Escape'];
    case '⏎':
    case '↵':
      return ['Enter'];
    case 'Delete':
      return ['Delete'];
    default:
      return [hintKey];
  }
}
