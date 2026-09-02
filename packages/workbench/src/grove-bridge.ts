/**
 * The one file in this package that reaches into `packages/plugin` for the
 * F1/F8.1 grove surface (`ol-z6x2` [WB-2], `olea-service`'s
 * `features/F1-sources.md`) — same one-bridge-per-surface discipline
 * `registry-bridge.ts`/`bulk-review-bridge.ts`/`plugin-surface-bridge.ts`
 * already use.
 *
 * `GroveView` (the DOM layer) imports `obsidian`; it is pulled in through the
 * same `tsconfig.json` `paths` + `build.mjs` esbuild alias every other
 * bridged view uses. The `olea-core` grove types are re-exported here too,
 * following `registry-bridge.ts`'s own convention, so `grove-scenarios.ts`
 * never has to reach past this one file for either half of the surface.
 */

export type {
  GroveCell,
  GroveCourseModel,
  GroveCourseSummary,
  GroveMaterialGapCell,
  GroveVolunteerCell,
} from 'olea-core';
export type {
  GroveCourseSection,
  GroveViewDeps,
  GroveViewState,
} from '../../plugin/src/grove/view.js';
export { GroveView, VIEW_TYPE_OLEA_GROVE } from '../../plugin/src/grove/view.js';
