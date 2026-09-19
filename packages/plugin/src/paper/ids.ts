/**
 * The practice-paper command id (F4.11, `[D-250]`/`[D-252]`/`[D-262]`, `[PAPER-8]` /
 * `ol-egov.141.6.1`).
 *
 * Kept local to this module rather than folded into
 * `../commands/ids.ts`/`../commands/register-commands.ts` — this bead's owned path is
 * `packages/plugin/src/paper/` only (concurrent lanes hold `commands/`, `main.ts` and
 * `packages/core/src/oracle/` as of this bead). This is the same shape
 * `OLEA_COMMAND_REGISTRY_OPEN` and `OLEA_COMMAND_HOME_OPEN` document for their own history
 * (`commands/ids.ts`'s own doc comments): "registered directly on `Plugin`... not this module"
 * when the shared palette module was outside the shipping bead's owned paths, folded into the
 * shared module later by a Class A tidy. The student-facing name itself is still open
 * (`[D-250]` option 5, Class B, flagged for retroactive review) — "practice paper" is the
 * plain-language placeholder the contract uses throughout, never "the exam oracle" (`[D-157]`).
 */
export const OLEA_COMMAND_PRACTICE_PAPER_OPEN = 'olea-practice-paper-open';

/** `packages/plugin/src/main.ts`'s `registerView` key for `./view.js`'s `PaperView`. */
export const VIEW_TYPE_OLEA_PAPER = 'olea-paper';
