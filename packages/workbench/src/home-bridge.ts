/**
 * The one file in this package that reaches into `packages/plugin` for the
 * F6.10/`[D-243]` Home surface (`ol-qq61`, follow-up to `ol-z6x2` [WB-2]) —
 * same one-bridge-per-surface discipline `session-bridge.ts`,
 * `registry-bridge.ts`, `grove-bridge.ts`, `plugin-bridge.ts` and
 * `oracle-bridge.ts` already use.
 *
 * `HomeView` (the DOM layer) imports `obsidian`; it is pulled in through the
 * same `tsconfig.json` `paths` + `build.mjs` esbuild alias every other
 * bridged view uses.
 */

export type { HomeCourseRow, HomeViewDeps, HomeViewState } from '../../plugin/src/home/view.js';
export { HomeView, VIEW_TYPE_OLEA_HOME } from '../../plugin/src/home/view.js';
