/**
 * `resolveAssessments` — F1.2's choice between the Base and the manual fallback
 * (ol-egov.141.8.10). This is the ONE seam that decides which source an
 * assessment-consuming caller sees; every caller that wants F1.2's fallback
 * behaviour calls this instead of `./read.ts`'s `readAssessments` directly.
 *
 * **The rule, in full (F1.2): manual entry only where no base exists or it cannot be read — never
 * the default path.** Concretely: `readAssessments` is attempted whenever `basePath` is
 * non-blank; a readable Base always wins, whatever it contains (even zero records, even
 * `configErrors` from a malformed `.base` file — a Base that exists and was read without the read
 * itself throwing is a Base "that exists", per this module's reading of F1.2, and correcting it is
 * a settings-and-Bases-file problem, not a trigger for a parallel manual list). Manual entries are
 * read ONLY when `basePath` is blank (the ordinary unconfigured state,
 * `plan/settings-store.ts`'s `isStudyPlanConfigured`'s own definition) or when `readAssessments`
 * itself throws (the file does not exist, or the host cannot read it) — the same single signal
 * every existing caller's own `safeReadAssessments`/`safeAssessmentRecords` wrapper already
 * catches (`packages/plugin/src/retrospective/provider.ts`, `packages/plugin/src/grove/
 * provider.ts`). This function is that catch, generalized and given the fallback F1.2 asks for
 * instead of an empty report.
 *
 * **The result is the SAME `AssessmentReadReport` shape either way** — `records` is a plain
 * `AssessmentRecord[]` regardless of source, so a caller that already reads `.records` (every
 * production caller today — `oracle/rank.ts`, `study-session/build.ts`, `allocation/
 * resolve-inputs.ts`, ...) needs no new branch to "read them exactly as it reads the base"
 * (this bead's acceptance criterion). `source` is added purely for a caller that wants to say
 * *which* it read from (the settings pane's own "hide the manual entry surface" decision,
 * `hasReadableAssessmentsBase` below) — optional, so no existing `AssessmentReadReport` literal
 * anywhere in this workspace (e.g. `packages/plugin/src/retrospective/provider.ts`'s own
 * `safeReadAssessments` fallback) is broken by its addition.
 *
 * **Reachability.** This bead's `owns` is `packages/core/src/assessment/` and
 * `packages/plugin/src/settings/` only; `main.ts`, `plan/provider.ts`, `grove/provider.ts`,
 * `retrospective/provider.ts` and `paper/provider.ts` each call `readAssessments` (or a local
 * safe-wrapper around it) directly today and are NOT switched over by this bead — see this bead's
 * report for the exact file:line each one needs.
 */

import type { VaultPath, VaultSource } from '../vault/types.js';
import { readManualAssessments } from './manual.js';
import { readAssessments } from './read.js';
import { type AssessmentReadReport, REQUIRED_ASSESSMENT_FIELDS } from './types.js';

/** True once a non-blank path has been entered — mirrors `plan/settings-store.ts`'s `isStudyPlanConfigured` exactly (blank means "not configured"), without this package depending on that plugin-side module. */
function isConfiguredBasePath(basePath: VaultPath): boolean {
  return basePath.trim().length > 0;
}

/**
 * True when `basePath` is configured AND `readAssessments` does not throw reading it — the same
 * "readable" this module's `resolveAssessments` uses to decide whether the Base wins. Exposed
 * separately for a caller (the settings pane) that needs the yes/no answer without needing the
 * full report — e.g. deciding whether to render the manual-entry surface at all.
 */
export async function hasReadableAssessmentsBase(
  vault: VaultSource,
  basePath: VaultPath,
): Promise<boolean> {
  if (!isConfiguredBasePath(basePath)) return false;
  try {
    await readAssessments(vault, basePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * F1.2's choice, made once so every caller need not re-implement it: a readable Base's report,
 * unchanged but for `source: 'base'`; otherwise every manual entry, wrapped in the same report
 * shape with `source: 'manual'`.
 *
 * The manual branch's `unresolvedFields`/`configErrors` are always empty — unlike the Base
 * reader, there is no "which frontmatter key means `weight`" column-matching step to fail here:
 * the five fields are the schema, always known, so an empty `records` here is always the honest
 * "she hasn't entered any yet," never a config problem to report (matching the Base reader's own
 * "genuinely empty folder" case, `./types.ts`'s `AssessmentReadReport` doc).
 */
export async function resolveAssessments(
  vault: VaultSource,
  basePath: VaultPath,
): Promise<AssessmentReadReport> {
  if (isConfiguredBasePath(basePath)) {
    try {
      const report = await readAssessments(vault, basePath);
      return { ...report, source: 'base' };
    } catch {
      // Configured but unreadable — F1.2's "or it cannot be read": fall through to the manual
      // fallback exactly as if no base had been configured, never surfaced as a read failure here.
    }
  }

  const records = await readManualAssessments(vault);
  return {
    records,
    sourceFolders: [],
    notesScanned: records.map((r) => r.path),
    notesWithoutFrontmatter: [],
    columns: [],
    unresolvedFields: [],
    unrecognizedColumns: [],
    configErrors: [],
    source: 'manual',
  };
}

// Re-exported so a caller importing only `./resolve.js` can still name every required field
// without a second import from `./types.js` — mirrors `./read.ts`'s own local use of the same
// constant.
export { REQUIRED_ASSESSMENT_FIELDS };
