/**
 * The single file in this package that reaches into `packages/plugin`.
 *
 * Confined to one module on purpose: "which real views does the workbench
 * mount, and what does it need from the plugin to do it" should be answerable by
 * reading one short file, not by grepping. The import paths are relative into
 * the plugin's SOURCE rather than its built `main.js` — that bundle is CJS with
 * `obsidian` marked external and is built for Obsidian's runtime, not a browser.
 *
 * INV-1 note: none of these specifiers is `obsidian`. The plugin sources
 * themselves import it, and `tsconfig.json`'s `paths` plus `build.mjs`'s esbuild
 * alias redirect that specifier to `src/obsidian-shim/index.ts` for this
 * package's compilation and bundle only. `packages/plugin` keeps compiling
 * against the real typings under its own tsconfig.
 */

// The gap surface's copy layer (`ol-opmb.5` [TB-4]'s response-function and
// feedback-point suites need to assert the REAL sentences the view renders,
// not just the raw model fields they are derived from — `readinessNote` and
// `coverageClosingLine` are the two whose firing/silence this bead's
// feedback-point inventory checks directly). `gap/copy.ts`'s own module doc:
// "no obsidian import here — this module is unit-tested", so re-exporting it
// adds nothing to the INV-1 surface already carried by `GapView` above.
// `ol-mxw3` (WBF-1) widens this list: `test/no-synthetic-ids-rendered.spec.ts`
// reconstructs the actual sentences `GapView` draws (not just the raw model
// fields) for every synthetic-corpus oracle/timeline state, so it needs the
// rest of this module's render functions too.
export {
  abstainedCourseSentence,
  affordanceLabel,
  coverageClosingLine,
  coverageScreenCopy,
  gapRowLine,
  rankedCourseFraming,
  readinessNote,
  scopeSourceLine,
} from '../../plugin/src/gap/copy.js';
// The gap/coverage pane (F4.3, F4.5, F4.9, F4.10; P5-T06a). Thin the same way
// `review/view.ts` and `today/view.ts` are: everything it decides lives in
// `olea-core`'s `gap/`, everything it says lives in `./copy.ts`, and this file
// is the one Obsidian-hosted DOM layer over both — see `oracle-bridge.ts` for
// what the workbench's own oracle driver takes from `olea-core` to feed it.
export type { GapViewDeps, GapViewState } from '../../plugin/src/gap/view.js';
export { GapView, VIEW_TYPE_OLEA_GAP } from '../../plugin/src/gap/view.js';
// `QA_CLOZE_RATING_ORDER` moved here from `review/rating.ts`, which is gone:
// its MCQ mapping was a documented provisional duplicate of `olea-core`'s
// `mapMcqRating`, and the plugin now calls core's directly. Anything in this
// package wanting the mapping should import it from `olea-core`, not through
// this bridge — the bridge exists for what only `packages/plugin` has.
export { previewSingleInterval, QA_CLOZE_RATING_ORDER } from '../../plugin/src/review/interval.js';
export { adaptReviewQueue } from '../../plugin/src/review/queue-adapter.js';
export type { ReviewSessionDeps, ReviewViewModel } from '../../plugin/src/review/session.js';
export { ReviewSession } from '../../plugin/src/review/session.js';
export type {
  ClozeCard,
  McqItem,
  McqOption,
  QaCard,
  ReviewInstrument,
  ReviewQueueItem,
} from '../../plugin/src/review/types.js';
export { ReviewView, VIEW_TYPE_OLEA_REVIEW } from '../../plugin/src/review/view.js';
// The Today pane's copy layer — `newCountSentence` is the feedback-point
// suite's third assertion (`ol-opmb.5` [TB-4]): whether "N of them are new"
// fires or stays silent given a due count. Same "no obsidian import here"
// property as `gap/copy.ts` above.
export { DUE_UNAVAILABLE, NOTHING_DUE, newCountSentence } from '../../plugin/src/today/copy.js';
// The Today pane (F6.1, P2-T09). `data-source.ts` is Obsidian-free by the same
// split as `review/ports.ts` vs `review/obsidian-ports.ts` (see its own module
// doc), so it bridges exactly like the review exports above; `view.ts` is the
// one file in that folder that needs a real Obsidian host, same as
// `review/view.ts`.
export type {
  ReadReviewHistoryOptions,
  ReviewHistory,
  TodayInstrumentSource,
  TodayPanelDeps,
  VaultInstrumentSourceDeps,
} from '../../plugin/src/today/data-source.js';
export {
  createVaultInstrumentSource,
  DEFAULT_STREAK_WINDOW_DAYS,
  endOfLocalDay,
  loadTodayPanel,
  localToday,
  readReviewHistory,
  SCHEDULING_HISTORY_PROBE_DAYS,
  unavailableInstrumentSource,
} from '../../plugin/src/today/data-source.js';
export type { TodayViewDeps } from '../../plugin/src/today/view.js';
export { TodayView, VIEW_TYPE_OLEA_TODAY } from '../../plugin/src/today/view.js';
