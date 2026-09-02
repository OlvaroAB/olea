/**
 * The one file in this package that reaches into `packages/plugin` and
 * `olea-core` for the F5.1 "Explain it back" surface (`ol-z6x2` [WB-2] F5
 * tranche, `[D-163]`'s `ExplainBackModal`) — same one-bridge-per-surface
 * discipline `registry-bridge.ts`, `bulk-review-bridge.ts`, `plugin-bridge.ts`,
 * `oracle-bridge.ts` and `session-bridge.ts` already use.
 *
 * `ExplainBackModal` is a `Modal`, not an `ItemView` — the one surface this
 * package mounts that renders as an app-wide overlay rather than into a
 * workspace tab (`obsidian-shim/index.ts`'s `Modal` doc). It imports
 * `obsidian` (`Modal`, `App`); it is pulled in through the same
 * `tsconfig.json` `paths` + `build.mjs` esbuild alias every other bridged
 * view uses. `App`/`Modal`/`Workspace` are the shim's own types, re-exported
 * here so `explain-back-scenarios.ts` never has to import the shim module by
 * a second path.
 */

export type {
  AcceptedExplainBackGrading,
  CitedIssue,
  ExplainBackGradingWireResponse,
  GradeExplainBackInput,
  MisconceptionCandidate,
  PendingExplainBackGrading,
  SourceBlockRef,
} from 'olea-core';
export { UnusableGradingInputError } from 'olea-core';
export type { ExplainBackModalDeps, ExplainBackSeed } from '../../plugin/src/explain-back/modal.js';
export { ExplainBackModal } from '../../plugin/src/explain-back/modal.js';
export type { ExplainBackSourceBlock } from '../../plugin/src/explain-back/request.js';
export type {
  AcceptExplainBackGradingWithObservationContext,
  AcceptExplainBackGradingWithObservationResult,
} from '../../plugin/src/grading/wiring.js';
export type { ReviewInstrument } from '../../plugin/src/review/types.js';
export { App, Modal, Workspace, type WorkspaceLeaf } from './obsidian-shim/index.js';
