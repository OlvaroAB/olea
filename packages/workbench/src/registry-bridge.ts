/**
 * The one file in this package that reaches into `packages/plugin` and
 * `olea-core` for the F8.4 registry surface (`ol-z6x2` [WB-2], follow-up to
 * `ol-4v2l`'s `[D-171]` source-provenance landing) — same one-bridge-per-
 * surface discipline `bulk-review-bridge.ts`, `plugin-bridge.ts`,
 * `oracle-bridge.ts` and `session-bridge.ts` already use.
 *
 * `RegistryView` (the DOM layer) imports `obsidian`; it is pulled in through
 * the same `tsconfig.json` `paths` + `build.mjs` esbuild alias every other
 * bridged view uses. `buildRegistryModel` and `registry/overrides.ts` are
 * both Obsidian-free `olea-core` functions, re-exported here so
 * `registry-scenarios.ts` never has to reach past this one file.
 */

export type {
  BuildRegistryModelInput,
  RegistryConceptEntry,
  RegistryInstrumentSummary,
  RegistryModel,
  RegistryOverrides,
  RegistrySourceLocation,
} from 'olea-core';
export {
  buildRegistryModel,
  EMPTY_REGISTRY_OVERRIDES,
  pruneConcept,
  renameConcept,
  unpruneConcept,
} from 'olea-core';
export type { RegistryViewDeps, RegistryViewState } from '../../plugin/src/registry/view.js';
export { RegistryView, VIEW_TYPE_OLEA_REGISTRY } from '../../plugin/src/registry/view.js';
