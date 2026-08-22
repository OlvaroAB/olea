/**
 * Command ids for Olea's command-palette entries (F7.7, ol-p2t10 / P2-T10;
 * `OLEA_COMMAND_OPEN` added by ol-f77commands). Kept as named constants —
 * rather than inline string literals in `register-commands.ts` and
 * `main.ts` — so a test can assert on the exact registered id set without
 * duplicating the string, and so a later bead wiring the real view can
 * import the id instead of retyping it.
 *
 * Obsidian namespaces commands by plugin id automatically (the palette shows
 * `Olea: …`), so these ids stay short and un-prefixed.
 */

export const OLEA_COMMAND_REVIEW_START = 'olea-review-start';
export const OLEA_COMMAND_CREATE_CARD = 'olea-create-card';
export const OLEA_COMMAND_TODAY_OPEN = 'olea-today-open';
/**
 * F7.7's "open Olea" (⌘⇧O). `ol-f77commands` left this unregistered because
 * it had no ruled destination; David's ruling settles it as another door to
 * the Today panel — see `register-commands.ts`'s module doc for the
 * reasoning. Kept as its own id, distinct from `OLEA_COMMAND_TODAY_OPEN`,
 * because it is a separate palette entry and a separate hotkey even though
 * both resolve to the same view.
 */
export const OLEA_COMMAND_OPEN = 'olea-open';
/** `ol-2tyj`: opens the gap/coverage screen (F4.3, F4.5, F4.9, F4.10) — the first command-palette entry reaching `GapView`. */
export const OLEA_COMMAND_GAP_OPEN = 'olea-gap-open';
/**
 * `ol-p5t06b`: builds a time-bounded study session (F4.6, F4.7, F4.8).
 *
 * A second door onto the same view the gap screen's `'build-session'`
 * affordance opens, and deliberately its own palette entry rather than a
 * variant of `OLEA_COMMAND_GAP_OPEN`: F4.6's own phrasing is "Build a
 * 20-minute session", which is a thing she asks for directly and not only a
 * follow-on from reading the gap view.
 */
export const OLEA_COMMAND_SESSION_BUILD = 'olea-session-build';
