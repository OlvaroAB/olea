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

/**
 * The command id `revealTodayView`'s door (`register-commands.ts`) is
 * registered under — the simulator's whole-plugin mount invokes it once
 * right after mount so the pane shows the Today panel rather than an empty
 * workspace, the same first screen the single-view mount always gave.
 */
export { OLEA_COMMAND_TODAY_OPEN } from '../../plugin/src/commands/ids.js';
/**
 * The real per-install device id (`ol-3ux7.64.10` [WBX-1b]). `device-id.ts`
 * has no `obsidian` import — only `olea-core` and a local `{ loadData,
 * saveData }` mirror structurally identical to `simulator/plugin-data-host.ts`'s
 * own `ObsidianDataHost` — so there is nothing INV-1 needs redirected here.
 * `simulator/device-id.ts`'s own local copy (WBX-1, written before this
 * export existed) is retired in favour of this one; see that file's doc.
 */
export { ensureDeviceId, resetDeviceId } from '../../plugin/src/device/device-id.js';
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
  pastPaperChips,
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
export type { HeadingOfferAcceptOutcome } from '../../plugin/src/review/heading-offer.js';
// F2.10's heading-offer banner (`[D-170]`, `ol-z6x2` [WB-2] this tranche) — the two files
// `renderHeadingOfferBannerIfAny` (`review/view.ts`) actually consumes. Neither imports
// `obsidian`, so this is a plain type/logic bridge, same posture `queue-adapter.ts`'s own
// export just above already has.
export {
  HEADING_OFFER_ACCEPT_LABEL,
  HEADING_OFFER_DISMISS_LABEL,
  HEADING_OFFER_PROMPT_TEXT,
} from '../../plugin/src/review/heading-offer.js';
export type {
  HeadingOfferBannerState,
  HeadingOfferBannerTracker,
} from '../../plugin/src/review/heading-offer-wiring.js';
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
/**
 * Whole-plugin mount (`ol-3ux7.64.3` [WBX-2],
 * `docs/dev/simulator-design.md` §4 in olea-service). Every export above
 * this point mounts one view against a hand-built `leaf`/`app`; this is the
 * one export that constructs the REAL `packages/plugin/src/main.ts` default
 * export (`OleaPlugin`) over the shim and awaits its own `onload()` — F9.S3's
 * "the simulator route mounted `OleaPlugin` and awaited `onload`."
 *
 * Deliberately generic over `PluginClass` rather than importing `OleaPlugin`
 * by name: this file's own module doc says its ownership is "which real
 * views does the workbench mount, and what does it need from the plugin" —
 * `mountPlugin` is a MECHANISM (construct, seed the vault, await onload,
 * hand back a teardown), and naming the one production plugin class is a
 * one-line call at the actual mount site (`packages/workbench/src/main.ts` /
 * `simulator/`, WBX-1's owned paths — not this file's).
 *
 * **The exact call WBX-1's `simulator/`+`main.ts` code makes:**
 *
 * ```ts
 * import OleaPlugin from '../../plugin/src/main.js';
 * import { mountPlugin } from '../plugin-bridge.js';
 *
 * const mounted = await mountPlugin(OleaPlugin, {
 *   vault: persistedVaultSource,   // §3's persisted VaultSource, or undefined for an empty vault
 *   pluginData: persistedPluginDataStore, // §3's IndexedDB `plugin-data` store, or undefined for in-memory
 * });
 * hostFrame.appendChild(mounted.hostEl); // the plugin's whole chrome: palette + workspace + settings route
 * // ... later, on day-advance (§3) or teardown:
 * await mounted.unmount();
 * ```
 *
 * `vault`/`pluginData` are optional — omitting both mounts the plugin over
 * an empty in-memory vault, which is enough for a smoke test with nothing
 * persisted.
 */
export type {
  MountedPlugin,
  MountPluginDeps,
  PluginConstructor,
} from './obsidian-shim/mount-plugin.js';
export { mountPlugin } from './obsidian-shim/mount-plugin.js';
