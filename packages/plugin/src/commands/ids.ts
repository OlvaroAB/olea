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
/**
 * F7.5/Q6.3 (`ol-p6t02`): dumps a content-free environment snapshot (plugin
 * and Obsidian versions, keyword-index document count, ingestion-queue
 * depth by status, last-reported budget headroom) to the clipboard — see
 * `diagnostics.ts`'s module doc for exactly what is and isn't in it. Exists
 * for the Q6.3 support reality: "Olea is broken" often means a conflict
 * with another plugin, and this is what she pastes into a bug report so
 * that can be told apart from an Olea defect.
 */
export const OLEA_COMMAND_DIAGNOSTICS_COPY = 'olea-diagnostics-copy';
/**
 * `[POST-1]`/`ol-r68l`, mechanics ruled `[D-134]`: opens F8.8's post-
 * assessment retrospective as its own dedicated view — David's ruling on
 * DSN-2's open question 10 ("which surface hosts it, mechanically"). The
 * standing offer card (`[D-134]` Q1: "offered from Home and the grove") is a
 * separate affordance this command does not itself provide — see
 * `packages/plugin/src/retrospective/offer-card.ts`'s module doc for why
 * neither host surface exists yet in this plugin, and this command is the
 * one honestly-reachable door onto the retrospective until they do.
 */
export const OLEA_COMMAND_RETROSPECTIVE_OPEN = 'olea-retrospective-open';
/**
 * `ol-4v2l` (F8.4, `[REG-1]`): opens the concept and instrument registry —
 * the browsable inventory over her concepts, their course associations,
 * their instrument mix, and their two-axis mastery. Registered directly on
 * `Plugin` at `main.ts` when `ol-4v2l` shipped it (that bead's owned paths
 * were `registry/`, `main.ts` and `packages/core/src/registry/`, not this
 * module) — `docs/dev/surface-register.md` named the fold into `ids.ts`/
 * `register-commands.ts` as the Class A follow-up this id and
 * `OLEA_COMMAND_REGISTRY_OPEN` complete (`ol-l5og.11`). **Done**: `main.ts`
 * no longer registers this id directly — it passes `openRegistry` to
 * `registerOleaCommands` instead, the same conditional-handler shape
 * `OLEA_COMMAND_HOME_OPEN`/`OLEA_COMMAND_GROVE_OPEN` below now follow too.
 */
export const OLEA_COMMAND_REGISTRY_OPEN = 'olea-registry-open';
/**
 * `ol-0r92.17` (F8.8, `[D-134]` Q1, F7.7): Home's own open command — opens
 * `HomeView` directly, independent of the standing retrospective offer card
 * Home also hosts. Registered directly on `Plugin` at `main.ts` when
 * `ol-0r92.17` shipped it (that bead's owned paths were `home/`, `grove/`
 * and `main.ts`'s view/command registration only, not this module) —
 * `docs/dev/surface-register.md` named the fold into `ids.ts`/
 * `register-commands.ts` as the same Class A follow-up
 * `OLEA_COMMAND_REGISTRY_OPEN` immediately above already completed for its
 * own command. This id and `OLEA_COMMAND_GROVE_OPEN` below are that tidy,
 * applied here (`ol-2zfj.38`'s round-27 batch-3 lane).
 */
export const OLEA_COMMAND_HOME_OPEN = 'olea-home-open';
/**
 * `ol-0r92.17` (F8.1, `[D-134]` Q1, F7.7): the course grove's own open
 * command — same direct-registration history, and the same fold, as
 * `OLEA_COMMAND_HOME_OPEN` immediately above.
 */
export const OLEA_COMMAND_GROVE_OPEN = 'olea-grove-open';
// `OLEA_COMMAND_DRAFT_CARDS` ('olea-draft-cards') was withdrawn (David, wave-2
// round-2 correction). F4.5 ("Olea alpha functional scope") rules out a
// student-invoked draft verb by name — "there is no 'Draft 6?' — because Olea
// is already drafting" (`[D-063]`, unbounded automatic generation). The
// command opened `DraftCardsModal`, deleted with it; `draftQuizCardsForConcept`
// and its supporting modules stay, as internals the F3.3 automatic-generation
// pipeline and the P3-T07a accept/triage flow call instead of a palette entry.
/**
 * `[D-152]` (F3.3, `ol-0r92.21`): the manual process-now TIMING OVERRIDE on a
 * single note — never a generation verb (unlike the withdrawn
 * `OLEA_COMMAND_DRAFT_CARDS` above, it asks Olea to run the SAME automatic
 * ingestion sooner, never to draft something new on request). **Fold done**
 * (`ol-s46v`): registered via the shared palette module's optional
 * `processNoteNowCheckCallback` handler — `checkCallback`, not `callback`,
 * because hiding the palette entry when no supported file is active is
 * load-bearing behaviour.
 * Also reachable from a note's context menu (`main.ts`'s `file-menu`
 * handler), invoking the identical `processNoteNow` method.
 */
export const OLEA_COMMAND_PROCESS_NOTE_NOW = 'olea-process-note-now';
/**
 * F5.1, `[D-163]` (`ol-12gs`): opens the "Explain it back" view on demand,
 * free-form — she names the topic herself rather than a failing instrument
 * supplying one. The SAME view (`packages/plugin/src/explain-back/modal.ts`)
 * is also opened from F2.12's confusion-routing banner, from the session
 * builder (F4.6) and from Today's suggestion (F6.4); this command is only
 * the fourth, on-demand door onto it — `[D-163]`'s ruling is one dedicated
 * view, never a fork per entry point. `register-commands.ts`'s module doc
 * used to record this destination as unbuilt ("waits for the bead that
 * builds it") — `ol-12gs` is that bead.
 */
export const OLEA_COMMAND_EXPLAIN_BACK = 'olea-explain-back';
