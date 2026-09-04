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
 * **Amended by `[D-223]` (F7.7, `ol-l5og.21` [HOME-2]): "open Olea" now
 * opens Home, not the Today panel.** `[D-033]`'s own argument was never
 * about which VIEW renders the answer — only that the product holds one
 * answer, singular. `[D-223]` moves the composed session (F6.4) onto Home
 * as its headline and rules Home the landing dashboard; ⌘⇧O follows that
 * move so it still lands on the one door, and ⌥1 is unchanged (it still
 * opens the Today panel, which now holds the session LIST rather than the
 * landing itself). `OLEA_COMMAND_OPEN`'s callback below reads
 * `handlers.openHome`, falling back to `handlers.openToday` only for a
 * caller that predates this amendment.
 *
 * **"Explain something back" now has a real destination (`[D-163]`,
 * `ol-12gs`).** The paragraph below described why it could not be given one
 * honestly before `[D-163]` named the surface — kept for the history, since
 * the same reasoning (never register a command whose click does nothing) is
 * exactly what made the wait correct rather than an oversight. The command
 * now opens `packages/plugin/src/explain-back/modal.ts`'s `ExplainBackModal`
 * in its free-form mode: she names the topic herself, since the command
 * palette carries no failing-instrument context the way F2.12's confusion
 * routing does. It is optional on the same `main.ts`-supplies-a-handler
 * terms `copyDiagnostics`/`openRegistry` below already use, since wiring the
 * modal's dependencies (grading, retrieval, the misconception store) lives
 * in `main.ts`, outside this module's owned paths.
 *
 * Historical: "Explain something back" had no destination and could not be
 * given one honestly. It was contextual AI (F2.7/F2.12/F5), and nothing
 * behind it was built — not even the Today panel was *its* destination,
 * since a command literally named "explain something back" that opens the
 * Today panel and explains nothing back is a more misleading palette entry
 * than an absent one, not a less. The ruling named the Today panel as the
 * settled front door so that *when* explain-back's own destination existed,
 * it would inherit that answer about where a session starts, rather than
 * manufacturing the destination early. `ol-12gs` is the bead that built it.
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
 * **`OLEA_COMMAND_BULK_REVIEW_OPEN` (`ol-jie3`) opens F3.3's bulk-review
 * triage path** — a listing surface over every still-pending cached draft,
 * grouped by document, resolved through the same `DraftAcceptPort`
 * first-presentation review uses. Not a new generation verb (see the
 * withdrawn-command note just below): it never asks Olea to draft anything,
 * only lets her resolve what is already drafted, at a second density.
 *
 * **`OLEA_COMMAND_DRAFT_CARDS` was withdrawn (David, wave-2 round-2
 * correction).** F4.5 rules out a student-invoked draft verb by name —
 * there is no "Draft 6?" because Olea is already drafting under unbounded
 * automatic generation (`[D-063]`). See `ids.ts`'s note at the id's old
 * location for the fuller citation; `draftQuizCardsForConcept` and its
 * supporting modules are unaffected, called instead by the F3.3 automatic
 * pipeline and the P3-T07a accept/triage flow.
 *
 * **`OLEA_COMMAND_REGISTRY_OPEN` (`ol-l5og.11`) is the same "handler supplied
 * from outside this bead's owned files" shape `OLEA_COMMAND_DIAGNOSTICS_COPY`
 * states just above, one paragraph up.** `ol-4v2l` registered
 * `'olea-registry-open'` directly on `Plugin` when it shipped (`registry/`,
 * `main.ts` and `packages/core/src/registry/` were that bead's owned paths,
 * not this module); this module offers the same id through the shared
 * palette, conditional on `handlers.openRegistry` the same way
 * `copyDiagnostics` is conditional. `main.ts`'s direct registration has
 * since been removed — `openRegistry` is the only door onto this id now.
 *
 * **`OLEA_COMMAND_HOME_OPEN`/`OLEA_COMMAND_GROVE_OPEN` (`ol-0r92.17`,
 * folded by `ol-2zfj.38`) are the same shape, completed the same way.**
 * `ol-0r92.17`'s owned paths were `home/`, `grove/` and `main.ts`'s own
 * view/command registration, not this module, so both were registered
 * directly there first; `main.ts`'s two direct registrations are removed in
 * the same commit that supplies `openHome`/`openGrove` here.
 */

import {
  OLEA_COMMAND_BULK_REVIEW_OPEN,
  OLEA_COMMAND_CREATE_CARD,
  OLEA_COMMAND_DIAGNOSTICS_COPY,
  OLEA_COMMAND_EXPLAIN_BACK,
  OLEA_COMMAND_GAP_OPEN,
  OLEA_COMMAND_GROVE_OPEN,
  OLEA_COMMAND_HOME_OPEN,
  OLEA_COMMAND_OPEN,
  OLEA_COMMAND_PROCESS_NOTE_NOW,
  OLEA_COMMAND_REGISTRY_OPEN,
  OLEA_COMMAND_RETROSPECTIVE_OPEN,
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
  /** `ol-jie3`: opens F3.3's bulk-review triage path — the same accept/edit/reject resolution as first-presentation review, at list density, grouped by document. */
  readonly openBulkReview: () => void;
  /** `ol-r68l` (F8.8, `[D-134]`): opens the post-assessment retrospective's dedicated view. */
  readonly openRetrospective: () => void;
  /**
   * `ol-p6t02` (F7.5/Q6.3): gathers and copies the content-free diagnostics
   * report to the clipboard. Async internally (`diagnostics-clipboard.ts`);
   * the handler itself stays a synchronous `() => void`, matching every
   * other command callback.
   *
   * **Optional, on the same terms `ol-p2t10`'s module doc states for "open
   * Olea"/"explain something back" above: `main.ts`'s `registerOleaCommands`
   * call is outside this bead's owned paths (`commands/`, `settings/`) and
   * has live concurrent lane activity on it as of this bead — supplying a
   * real handler there is a one-line addition this bead's report names by
   * file:line, not something this bead can do itself.** Until that lands,
   * `buildOleaCommands` below leaves the command out of the palette
   * entirely rather than registering one whose click does nothing — the
   * same choice this file already made for "open Olea" and "explain
   * something back" while they had no destination.
   */
  readonly copyDiagnostics?: () => void;
  /**
   * `ol-4v2l` (F8.4, `[REG-1]`): opens the concept and instrument registry.
   * Optional on the same terms `copyDiagnostics` states just above —
   * `main.ts`'s own `this.addCommand({ id: 'olea-registry-open', ... })` is
   * outside this bead's owned paths (`commands/`) and has to be removed by
   * whoever edits `main.ts` at the same time this handler is supplied there,
   * or the id registers twice. Until that lands, `buildOleaCommands` leaves
   * this entry out of the palette it builds — `main.ts`'s own direct
   * registration is what actually serves the command in the meantime.
   */
  readonly openRegistry?: () => void;
  /**
   * `ol-0r92.17` (F8.8, `[D-134]` Q1): opens `HomeView` directly. Optional on
   * the same terms `openRegistry` states just above, and folded in by the
   * same lane that fixed `openRegistry`'s own hand-back (`ol-2zfj.38`'s
   * round-27 batch-3 tidy): `main.ts`'s two direct `this.addCommand({ id:
   * 'olea-home-open', ... })`/`'olea-grove-open'` registrations are removed
   * in the SAME commit that adds these handlers there, so the ids never
   * register twice.
   */
  readonly openHome?: () => void;
  /** `ol-0r92.17` (F8.1, `[D-134]` Q1): opens `GroveView` directly — same fold as `openHome` immediately above. */
  readonly openGrove?: () => void;
  /**
   * `ol-s46v` (`[D-152]`, F3.3): the manual process-now timing override's
   * palette door, folded here from `main.ts`'s own direct
   * `this.addCommand({ id: OLEA_COMMAND_PROCESS_NOTE_NOW, ... })`
   * (`ol-0r92.21`) — same optional-handler shape `openRegistry`/`openHome`/
   * `openGrove` above use, so `buildOleaCommands` below leaves the command
   * out of the palette entirely rather than registering a broken one when
   * no handler is supplied.
   *
   * **This is the full `checkCallback`, not a plain callback** — `main.ts`
   * is where `this.app.workspace.getActiveFile()` and
   * `isProcessNowSupported` are reachable, so it builds the whole function
   * (identical to the one the direct registration used to inline) and hands
   * it through, rather than this module reaching for either dependency
   * itself. See `types.ts`'s `OleaCommandSpec.checkCallback` doc for what
   * `checking` means and why returning `false` hides the palette entry.
   */
  readonly processNoteNowCheckCallback?: (checking: boolean) => boolean;
  /**
   * F5.1, `[D-163]` (`ol-12gs`): opens the "Explain it back" view in its
   * free-form mode. Optional on the same `main.ts`-supplies-a-handler terms
   * `openRegistry`/`openHome`/`openGrove` above state — this module never
   * imports `explain-back/modal.ts` or any grading/retrieval wiring itself.
   */
  readonly openExplainBack?: () => void;
}

/** Pure — builds the command specs without touching any registrar, so ids/names/hotkeys are assertable in isolation. */
export function buildOleaCommands(handlers: OleaCommandHandlers): readonly OleaCommandSpec[] {
  const specs: OleaCommandSpec[] = [
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
      // `[D-223]` (F7.7, `ol-l5og.21` [HOME-2]) repoints "open Olea" at
      // Home rather than the Today panel — Home is now the landing screen
      // `[D-033]`'s front-door ruling attaches to (the ruling itself was
      // never about which VIEW answers, only that the answer is singular;
      // see `home/view.ts`'s own module doc). `handlers.openHome` falls
      // back to `handlers.openToday` only for a caller that predates this
      // amendment and supplies no `openHome` handler at all — every real
      // caller (`main.ts`) supplies both.
      name: 'Olea: Open Olea',
      callback: handlers.openHome ?? handlers.openToday,
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
    {
      id: OLEA_COMMAND_BULK_REVIEW_OPEN,
      // F3.3's own phrasing: clearing "a document's drafts in one sitting".
      name: 'Olea: Review drafts in bulk',
      callback: handlers.openBulkReview,
      // No chord named anywhere in the contract for this one, matching the
      // gap/session-builder commands above. Click-only this round —
      // `ol-uxk9` is the keyboard-bindings follow-up.
    },
    {
      id: OLEA_COMMAND_RETROSPECTIVE_OPEN,
      // F8.8's own words ("what held, what faded, what carries") rather than
      // "post-assessment" — the palette entry names what she will see, same
      // convention as "Build a study session" above.
      name: 'Olea: Open assessment retrospective',
      callback: handlers.openRetrospective,
      // No chord named anywhere in the contract for this one, same as the
      // other unbound commands above.
    },
  ];

  // F7.5/Q6.3 (`ol-p6t02`): only registered once `main.ts` supplies a real
  // handler — see this field's doc comment above for why it's conditional
  // rather than always present. Named "Copy diagnostics", not
  // "Diagnostics", since running it has exactly one visible effect — the
  // clipboard. No chord named anywhere in the contract for this one, same
  // as the three unbound commands above.
  if (handlers.copyDiagnostics) {
    specs.push({
      id: OLEA_COMMAND_DIAGNOSTICS_COPY,
      name: 'Olea: Copy diagnostics',
      callback: handlers.copyDiagnostics,
    });
  }

  // `ol-l5og.11`: only registered once `main.ts` supplies a real handler AND
  // removes its own direct `addCommand` for the same id — see this field's
  // doc comment on `OleaCommandHandlers.openRegistry` above for why this is
  // conditional rather than always present, same shape as `copyDiagnostics`
  // just above. Named for F8.4's own destination, matching the palette name
  // `ol-4v2l` already shipped.
  if (handlers.openRegistry) {
    specs.push({
      id: OLEA_COMMAND_REGISTRY_OPEN,
      name: 'Olea: Open concept and instrument registry',
      callback: handlers.openRegistry,
    });
  }

  // `ol-2zfj.38` (round-27 batch-3 tidy): folds `main.ts`'s two direct
  // `this.addCommand` registrations for Home and the grove into this shared
  // module, same conditional shape and same reason `openRegistry` above
  // states — no behaviour change, same ids, same palette names.
  if (handlers.openHome) {
    specs.push({
      id: OLEA_COMMAND_HOME_OPEN,
      name: 'Olea: Open Home',
      callback: handlers.openHome,
    });
  }
  if (handlers.openGrove) {
    specs.push({
      id: OLEA_COMMAND_GROVE_OPEN,
      name: 'Olea: Open course grove',
      callback: handlers.openGrove,
    });
  }

  // `ol-s46v`: folds `main.ts`'s direct process-now `addCommand` call into
  // this shared module, same conditional shape and same reason `openHome`/
  // `openGrove` above state — no behaviour change, same id, same palette
  // name, same `checkCallback` semantics (hidden with no active/supported
  // file). `checkCallback` rather than `callback` is the one difference from
  // every entry above it.
  if (handlers.processNoteNowCheckCallback) {
    specs.push({
      id: OLEA_COMMAND_PROCESS_NOTE_NOW,
      name: 'Olea: Process this note now',
      checkCallback: handlers.processNoteNowCheckCallback,
    });
  }

  // `ol-12gs` (F5.1, `[D-163]`): only registered once `main.ts` supplies a
  // real handler — same conditional shape and same reason `openHome`/
  // `openGrove` above state. Named for what she does, matching the
  // convention "Build a study session"/"Open assessment retrospective"
  // already set.
  if (handlers.openExplainBack) {
    specs.push({
      id: OLEA_COMMAND_EXPLAIN_BACK,
      name: 'Olea: Explain something back',
      callback: handlers.openExplainBack,
    });
  }

  return specs;
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
