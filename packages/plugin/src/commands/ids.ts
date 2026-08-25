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
/**
 * `ol-jie3`: F3.3's bulk-review triage path — "a bulk-review path remains
 * available for a student who would rather clear a document's drafts in one
 * sitting; it is the same action at a second density, never a second mental
 * model." Opens a listing surface over every still-pending cached draft
 * (`generation/cache-store.ts`'s `DraftCacheStore.listPending()`), grouped
 * by source document, resolved through the exact same
 * `generation/accept.ts` `DraftAcceptPort` first-presentation review already
 * calls — no forked verdict machinery, no new generation verb (F4.5 stays
 * honoured: this asks her to resolve drafts Olea already made, never to make
 * new ones).
 */
export const OLEA_COMMAND_BULK_REVIEW_OPEN = 'olea-bulk-review-open';
// `OLEA_COMMAND_DRAFT_CARDS` ('olea-draft-cards') was withdrawn (David, wave-2
// round-2 correction). F4.5 ("Olea alpha functional scope") rules out a
// student-invoked draft verb by name — "there is no 'Draft 6?' — because Olea
// is already drafting" (`[D-063]`, unbounded automatic generation). The
// command opened `DraftCardsModal`, deleted with it; `draftQuizCardsForConcept`
// and its supporting modules stay, as internals the F3.3 automatic-generation
// pipeline and the P3-T07a accept/triage flow call instead of a palette entry.
