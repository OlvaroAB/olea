/**
 * Placeholder handlers for the P2-T10 commands whose real destination does
 * not exist yet. **One is left: card creation (P2-T04).**
 *
 * **Two placeholders are now gone, which is what the swap looks like.**
 * P2-T09 built the Today panel, so `main.ts` wires `openToday` to
 * `revealTodayView`. Run 9's Lane 3 registered and wired the review view, so
 * `startReview` opens a real, vault-composed session and `startReviewPlaceholder`
 * has been deleted with it. A placeholder left standing beside a built feature
 * is a live hazard, not harmless dead code: it is exported, it is plausible,
 * and the next rewiring can reach it.
 *
 * The Notice below is deliberately honest rather than silent or misleading: it
 * says the feature isn't built yet, not that something went wrong. That's
 * the same "dark, not broken-looking" principle the settings pane's token
 * field applies (see `settings/token-field-copy.ts`) — a skeleton command
 * that does nothing without saying so reads as a bug to whoever clicks it.
 *
 * No test file: `obsidian` has no runtime (its `package.json` `main` is
 * `""` — see `vault/obsidian-source.ts`'s doc for the same point), so
 * importing `Notice` here means this module can only run inside a real
 * Obsidian host, not Vitest. `register-commands.ts` tests everything about
 * *wiring* (each command's callback is exactly the handler passed in) with
 * fake no-op handlers, which is the part of this file that logic bugs could
 * hide in; the Notice text itself is exercised by `@manual` scenarios in
 * `features/F7-plugin-surface.md`.
 */

import { Notice } from 'obsidian';

const NOT_YET_BUILT_SUFFIX = "isn't built yet — it's coming in a later update.";

export function createCardPlaceholder(): void {
  new Notice(`Olea: card creation ${NOT_YET_BUILT_SUFFIX}`);
}
