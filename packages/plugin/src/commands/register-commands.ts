/**
 * Olea's command-palette surface (F7.7, ol-p2t10 / P2-T10).
 *
 * P2-T10's acceptance criterion is exactly three commands: review, create,
 * today. F7.7 itself lists a fourth and fifth — "open Olea (⌘⇧O)" and
 * "explain something back" — and `ol-p2t10` deliberately left both
 * unregistered, since neither had a ruled destination yet. `ol-f77commands`
 * held that gap open; what follows is its resolution.
 *
 * **David's ruling (`ol-f77commands`, 2026-08-14): the Today panel is Olea's
 * front door.** It answers "what should I do now," which is the product's
 * promise, and the review view is reached *through* it rather than around
 * it. "Open Olea" now resolves cleanly: it is another door onto the same
 * room `OLEA_COMMAND_TODAY_OPEN` already opens, not a rival to it — the
 * "two chords, one action" shape this module used to flag as the open
 * question is exactly what the ruling settles, not a defect in it. Recorded
 * as a product decision (decision log, house numbering) so later surfaces
 * that need a front door — the oracle, explain-back — inherit a settled
 * answer instead of re-litigating it.
 *
 * **"Explain something back" still has no destination and still cannot be
 * given one honestly.** It is contextual AI (F2.7/F2.12/F5), and nothing
 * behind it is built — not even the Today panel is *its* destination, since
 * a command literally named "explain something back" that opens the Today
 * panel and explains nothing back is a more misleading palette entry than
 * an absent one, not a less. The ruling names the Today panel as the
 * settled front door so that *when* explain-back's own destination exists
 * (Phase 3+), it inherits that answer about where a session starts — it
 * does not manufacture the destination early. It waits for the bead that
 * builds it.
 *
 * The command ids in `ids.ts` are deliberately stable, so registering
 * "explain something back" later is an addition here and nothing else.
 *
 * Hotkeys: Obsidian's own convention, and this bead's brief, is to leave
 * hotkeys unbound by default so a plugin never silently claims a chord that
 * collides with the user's existing bindings — Obsidian shows every
 * unbound command in Settings → Hotkeys ready for her to assign. The
 * exceptions are the two commands F7.7 names an explicit chord for: the
 * Today command ships ⌥1, and "Open Olea" ships ⌘⇧O (`['Mod', 'Shift']` +
 * `'O'` — `Mod` is Obsidian's cross-platform primary modifier, Cmd on
 * macOS and Ctrl elsewhere, which is what F7.7's Mac-spelled "⌘⇧O" means
 * off-Mac). "Start today's review" and "Create card" have no chord named
 * anywhere in the contract, so both stay unbound.
 *
 * **`OLEA_COMMAND_DRAFT_CARDS` was withdrawn (David, wave-2 round-2
 * correction).** F4.5 rules out a student-invoked draft verb by name —
 * there is no "Draft 6?" because Olea is already drafting under unbounded
 * automatic generation (`[D-063]`). See `ids.ts`'s note at the id's old
 * location for the fuller citation; `draftQuizCardsForConcept` and its
 * supporting modules are unaffected, called instead by the F3.3 automatic
 * pipeline and the P3-T07a accept/triage flow.
 */

import {
  OLEA_COMMAND_CREATE_CARD,
  OLEA_COMMAND_GAP_OPEN,
  OLEA_COMMAND_OPEN,
  OLEA_COMMAND_REVIEW_START,
  OLEA_COMMAND_SESSION_BUILD,
  OLEA_COMMAND_TODAY_OPEN,
} from './ids.js';
import type { CommandRegistrar, OleaCommandSpec } from './types.js';

export interface OleaCommandHandlers {
  readonly startReview: () => void;
  readonly createCard: () => void;
  readonly openToday: () => void;
  /** `ol-2tyj`: opens the gap/coverage screen (F4.3, F4.5, F4.9, F4.10). */
  readonly openGap: () => void;
  /** `ol-p5t06b`: opens the session builder (F4.6, F4.7, F4.8), unfocused — built from the whole ranking. */
  readonly buildSession: () => void;
}

/** Pure — builds the command specs without touching any registrar, so ids/names/hotkeys are assertable in isolation. */
export function buildOleaCommands(handlers: OleaCommandHandlers): readonly OleaCommandSpec[] {
  return [
    {
      id: OLEA_COMMAND_REVIEW_START,
      name: "Olea: Start today's review",
      callback: handlers.startReview,
    },
    {
      id: OLEA_COMMAND_CREATE_CARD,
      name: 'Olea: Create card',
      callback: handlers.createCard,
    },
    {
      id: OLEA_COMMAND_TODAY_OPEN,
      name: 'Olea: Open Today panel',
      callback: handlers.openToday,
      hotkeys: [{ modifiers: ['Alt'], key: '1' }],
    },
    {
      id: OLEA_COMMAND_OPEN,
      // Deliberately the same callback as OLEA_COMMAND_TODAY_OPEN, not a
      // parallel handler: David's ruling makes "open Olea" and "open the
      // Today panel" the same action reached by two doors, so the two
      // commands share one destination rather than one drifting from the
      // other over time.
      name: 'Olea: Open Olea',
      callback: handlers.openToday,
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'O' }],
    },
    {
      id: OLEA_COMMAND_GAP_OPEN,
      name: 'Olea: Open worth-studying panel',
      callback: handlers.openGap,
      // No chord named anywhere in the contract for this one, matching
      // "Start today's review" and "Create card" above — she assigns one
      // in Settings → Hotkeys if she wants it.
    },
    {
      id: OLEA_COMMAND_SESSION_BUILD,
      // Named for the budget the view opens on, which is F4.6's own example.
      // The other budgets are one tap away inside the view rather than three
      // more palette entries — a command per duration is a palette she has to
      // read rather than use.
      name: 'Olea: Build a study session',
      callback: handlers.buildSession,
      // Unbound, same as the three above.
    },
  ];
}

/** Registers every Olea command on `registrar` (a real `Plugin` in production, a fake in tests). */
export function registerOleaCommands(
  registrar: CommandRegistrar,
  handlers: OleaCommandHandlers,
): void {
  for (const command of buildOleaCommands(handlers)) {
    registrar.addCommand(command);
  }
}
