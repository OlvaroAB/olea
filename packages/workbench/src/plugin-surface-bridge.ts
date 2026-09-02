/**
 * The one file in this package that reaches into `packages/plugin` for the
 * F7 plugin-surface tranche (`ol-z6x2` [WB-2]) — same one-bridge-per-surface
 * discipline `registry-bridge.ts`/`bulk-review-bridge.ts` already use.
 *
 * `OleaSettingTab` (the DOM layer) imports `obsidian` (`Setting`,
 * `PluginSettingTab`); it is pulled in through the same `tsconfig.json`
 * `paths` + `build.mjs` esbuild alias every other bridged view uses. The
 * stores/copy modules it composes (`worker/config-store.ts`,
 * `settings/explain-back-audit-gate.ts`, `usage/log-store.ts`) are
 * Obsidian-free; re-exported here only where `plugin-surface-scenarios.ts`
 * needs their storage keys and shapes to seed a `data.json` fixture
 * directly, the same reason `registry-bridge.ts` re-exports `olea-core`
 * types its own scenarios file needs.
 */

export type { PersistedExplainBackAuditGate } from '../../plugin/src/settings/explain-back-audit-gate.js';
export {
  EXPLAIN_BACK_AUDIT_GATE_BODY,
  EXPLAIN_BACK_AUDIT_GATE_HEADING,
  EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY,
} from '../../plugin/src/settings/explain-back-audit-gate.js';
export { OleaSettingTab } from '../../plugin/src/settings/settings-tab.js';
export {
  USAGE_CACHED_INPUT_NOTE,
  USAGE_SECTION_EMPTY_STATE,
} from '../../plugin/src/usage/copy.js';
export { USAGE_LOG_STORAGE_KEY } from '../../plugin/src/usage/log-store.js';
export type { UsageLogEntry } from '../../plugin/src/usage/types.js';
export type {
  ObsidianDataHost,
  PersistedWorkerConfig,
} from '../../plugin/src/worker/config-store.js';
export { WORKER_CONFIG_STORAGE_KEY } from '../../plugin/src/worker/config-store.js';
export { TEST_CONNECTION_MESSAGES } from '../../plugin/src/worker/test-connection.js';
export type { WorkerConfig } from '../../plugin/src/worker/transport.js';
