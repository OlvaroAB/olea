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

// `ol-ppxj.49`: the course-row quiet-line copy `home-scenarios.ts` needs —
// `HOME_SET_UP_WAITING` verbatim for the `'no-registered-source'` fixture row,
// `homeScopeGrewLine` (the real, pure function, called over fixture numbers
// rather than re-worded) for the "scope grew" row — see that file's own
// module doc.
export { HOME_SET_UP_WAITING, homeScopeGrewLine } from '../../plugin/src/home/copy.js';
export type {
  HomeAvoidanceQuestion,
  HomeCourseRow,
  HomeGroveMark,
  HomeQuietLine,
  HomeViewDeps,
  HomeViewState,
} from '../../plugin/src/home/view.js';
export { HomeView, VIEW_TYPE_OLEA_HOME } from '../../plugin/src/home/view.js';
