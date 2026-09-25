/**
 * Register row 1.4's own two constants (`TRG-1`, `ol-tqy3`) — "a materiality
 * floor and a debounce or minimum-edit-size floor before the model is called
 * at all — the cost model flags 'on every save' as unbounded."
 *
 * **The register lists both as `derived` (fitted against a corpus).** They
 * ship here as **declared** reversible defaults instead, each argued in
 * plain English below, per the run charter's Class B posture ("proceed with
 * the reversible default, flag for retroactive review") and per `TRG-1`'s
 * own text, which recommends exactly this: "a quiet period on the order of a
 * few minutes, as a Class B reversible threshold, recorded with its
 * rationale and tuned from real use rather than guessed precisely now."
 * Neither value has been fitted against the real vault or any eval set —
 * doing so would need a labelled corpus of edits marked material/not-material
 * that does not exist yet. **Flagged for retroactive review; revisit when
 * real editing sessions produce enough trigger history to derive them
 * properly** (the same "measured baseline, named revisit condition" shape
 * row 1.5's `confidenceFloor` and row 3.1's retrievability level already
 * use).
 */

export interface MaterialityConstants {
  /**
   * Milliseconds of quiet since a path was last observed changing before its
   * change is even considered for a judge call.
   */
  readonly debounceMs: number;
  /**
   * Minimum canonicalised-character delta a change must clear, on top of
   * having survived debounce, before a judge call is considered.
   */
  readonly minEditChars: number;
  /**
   * Milliseconds a below-floor edit may sit pending, with nothing else
   * touching its path, before `wiring.ts`'s `drainDuePendingEdits` forces it
   * to the judge anyway. `[DOS-3]` (ol-2zfj.159).
   */
  readonly pendingDrainMs: number;
}

/**
 * Three minutes. Argued: long enough that an in-progress sentence — a save
 * fired by Obsidian's autosave or a manual Ctrl+S mid-paragraph — never
 * reaches the judge, since a real editing burst on one file rarely settles
 * faster than that; short enough that a finished editing session (she closes
 * the laptop, moves to the next task) is still picked up within the same
 * sitting rather than sitting stale until the next unrelated save elsewhere
 * nudges a batch boundary. `TRG-1`'s own recommendation names "a few
 * minutes" without picking one; this is the number chosen from that range.
 */
export const MATERIALITY_DEBOUNCE_MS = 3 * 60 * 1000;

/**
 * Eight characters. Argued: shorter than any edit that plausibly changes a
 * claim — even the minimal-meaning edits `[D-093]` names by example (a
 * negation insert, a number swap) touch a word or a digit sequence, not a
 * single character — while comfortably covering the artifacts this floor
 * exists to catch for free: a stray keystroke undone, a single punctuation
 * fix, autosave re-serialising a line ending. **This floor is deliberately
 * generous rather than aggressive**, because `[D-093]` rules that "every
 * changed cited passage gets the model read at the next batch pass... no
 * distance gate can [see a minimal-edit, maximal-meaning change]" — this
 * gate must therefore only ever remove edits too small to carry content,
 * never trade a real (if small) edit for a cheaper trigger count. A value
 * here that turned out to swallow real edits would be a defect in this
 * constant, not licence for `[D-093]`'s downstream reader to re-check it.
 */
export const MATERIALITY_MIN_EDIT_CHARS = 8;

/**
 * Thirty minutes (ten times `MATERIALITY_DEBOUNCE_MS`). **Declared, not
 * derived** — a plain-English choice, never fitted against a corpus, same
 * Class B "reversible default, flagged for retroactive review" posture the
 * other two constants in this file take.
 *
 * Argued: `[DOS-3]` (ol-2zfj.159) closes a gap the length floor's own
 * recurrence-based escalation (see `wiring.ts`'s `pendingSmallEdit` field
 * doc) cannot — a below-floor edit that never recurs on its own path has no
 * second edit to escalate on, so without a time-based drain it stays pending
 * forever. Ten times the debounce window is comfortably longer than any
 * pause a single editing session's own autosave/manual-save cadence
 * produces (the debounce already absorbs those), so the drain never fires
 * mid-session on a note she is still actively working in; short enough that
 * a genuinely one-off edit still reaches a decision the same day, not "the
 * next time something unrelated nudges this path." Revisit once real
 * editing-session data shows whether 30 minutes fires too eagerly (cutting
 * into one long sitting on the same note) or too slowly (a one-off edit
 * sitting unreviewed for a while) — the same "measured baseline, named
 * revisit condition" shape `debounceMs`/`minEditChars` above already use.
 */
export const MATERIALITY_PENDING_DRAIN_MS = 30 * 60 * 1000;

/** The reversible defaults above, bundled for callers that want one object. */
export const DEFAULT_MATERIALITY_CONSTANTS: MaterialityConstants = {
  debounceMs: MATERIALITY_DEBOUNCE_MS,
  minEditChars: MATERIALITY_MIN_EDIT_CHARS,
  pendingDrainMs: MATERIALITY_PENDING_DRAIN_MS,
};
