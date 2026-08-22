/**
 * The one file in this package that reaches into `packages/plugin` for the
 * session-builder surface (F4.6, F4.7, F4.8, F4.9; `ol-p5t06b` [P5-T06b]) —
 * same discipline as `plugin-bridge.ts` and `oracle-bridge.ts`, and a
 * separate file rather than an addition to either of them for the same
 * reason `oracle-bridge.ts` gives for itself: "which real views does the
 * workbench mount, and what does it need from the plugin to do it" should be
 * answerable by reading one short file per surface, not by grepping across
 * one that has grown to cover three.
 *
 * `session-scenarios.ts` (a build lane's file, not this one's) already
 * imports `SessionBuilderRequest`/`SessionBuilderState`/`SessionBuilderViewDeps`
 * directly from plugin source as TYPES ONLY — "nothing at runtime, so this
 * file never pulls `obsidian` (even through the shim) into a Node test
 * process," per its own module doc. This file is the one that reaches in for
 * the RUNTIME class `main.ts` mounts, the same split `plugin-bridge.ts` holds
 * between its `import type` and `export {}` lines throughout.
 *
 * INV-1 note: `session-builder/view.ts` imports `obsidian`, exactly as
 * `gap/view.ts` and `today/view.ts` do. `tsconfig.json`'s `paths` and
 * `build.mjs`'s esbuild alias redirect that specifier to
 * `src/obsidian-shim/index.ts` for this package's compilation and bundle
 * only, same as every other bridge file's own INV-1 note.
 */

export type {
  SessionBuilderRequest,
  SessionBuilderState,
  SessionBuilderViewDeps,
} from '../../plugin/src/session-builder/view.js';
export {
  SessionBuilderView,
  VIEW_TYPE_OLEA_SESSION,
} from '../../plugin/src/session-builder/view.js';
