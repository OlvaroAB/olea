/**
 * The settings pane's graceful-degradation statement (F7.8, P2-T10). See
 * `../../../../olea-service/docs/Olea_alpha_functional_scope.md` for the
 * clause itself.
 *
 * F7.8 requires four things of this build, and the two strings below are
 * written to satisfy all four: that the smart half can be turned off
 * outright; that four capabilities — cards, review, scheduling, the Today
 * panel — go on working with no AI whatever; that the guarantee is put to the
 * user in settings rather than left implicit; and that the same guarantee
 * doubles as the answer when the proxy cannot be reached.
 *
 * **These are the product's wording of that promise, not the contract's.** The
 * clause is a spec sentence and reads like one; what ships here is written for
 * a person opening a settings pane, and it says one thing the clause does not,
 * namely that the no-AI case is the present state of this build rather than a
 * hypothetical. Kept in this module rather than paraphrased ad hoc in
 * `settings-tab.ts` so that one wording is reviewable and testable in one
 * place. It exists to prevent the exact failure mode the bead brief calls out:
 * without it, a person who loses the AI connection (or never had one — true
 * for the whole of P2, since no AI exists yet) has no way to tell "the AI half
 * is unreachable, everything else still works" from "the plugin is broken."
 * Kept as two plain strings, not JSX/markup, because `settings-tab.ts` renders
 * them with Obsidian's own `Setting`/`createEl` calls.
 */

export const DEGRADATION_STATEMENT_HEADING = 'Olea works without AI';

export const DEGRADATION_STATEMENT_BODY =
  'Cards, review, scheduling, and the Today panel are the core of Olea, and all of them always work with no AI connection at all — that includes right now, since AI features are not yet available in this build. AI is an optional layer on top for things like generating cards or explaining a topic; switching it off, or losing the connection to it, never stops the rest of Olea from working.';
