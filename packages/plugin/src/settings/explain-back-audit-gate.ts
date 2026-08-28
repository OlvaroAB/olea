/**
 * `ObsidianExplainBackAuditGateStore` — the E2b calibration kill-switch
 * (`ol-g3a0.1`), F7.8 as amended by `[D-127]`
 * (`../../../../olea-service/docs/Olea_alpha_functional_scope.md:1642`).
 *
 * ===========================================================================
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ===========================================================================
 * `../grading/wiring.ts` already greys explain-back for one honest reason:
 * the Worker isn't configured (`judgeCaller === null`). `[D-127]` adds a
 * SECOND, independent reason for the identical greyed state, carrying a
 * DIFFERENT message: E2b's trailing live-calibration audit (`ol-g3a0`, in
 * the private `olea-service` repo) may observe sustained grading failure,
 * and when it does, explaining back pauses rather than keeps grading badly
 * in silence — "grading is not reliable enough right now" is a materially
 * different claim from "AI is unavailable," and she can tell the two apart.
 *
 * This file is the CONSUMER side only: a persisted flag, read the same way
 * every other per-user setting in this plugin is read (`data.json`, this
 * store's own top-level key, following `../worker/config-store.ts`'s exact
 * shape), plus the wording shown when it is set. **The PRODUCER — the audit
 * itself, deciding when failure counts as "sustained" — does not exist yet.**
 * `ol-g3a0` is that trailing bead; `E2B-K1` in `olea-service`'s
 * `scripts/harness/e2b-audit.mjs` `OPEN_CONSTANTS` is the rate-and-window
 * trigger it has not yet derived (unfittable on the ~10 cases the first real
 * audit will have). Naming the producer here is `[D-072]`'s reachability
 * escape hatch, used deliberately: this flag has a real consumer
 * (`../grading/wiring.ts`'s `buildGradingWiring`) but, honestly, no
 * production writer yet. `setSustainedFailure` below is that write path
 * stood up early and made independently testable, exactly so the switch can
 * be proven to work — per `ol-g3a0`'s own acceptance criterion, "a simulated
 * sustained-failure signal must actually grey the feature ... proven by a
 * test" — before the thing that will eventually flip it in production
 * exists.
 *
 * ===========================================================================
 * WHY A KV FLAG, NEVER A NEW ENDPOINT
 * ===========================================================================
 * The audit runs offline, in the private repo, against her real early
 * explain-back answers (`eval/e2b/`, gitignored case store). Nothing here
 * computes the signal at runtime, and nothing may: `C6.4`/`D-014` keep
 * per-user config in KV precisely so the Worker never becomes a database of
 * anything derived from her content. So the only honest delivery path is the
 * one this store uses — an operator-set value reaching the client through
 * the config channel that already exists (this plugin's own `data.json`,
 * the same shape `ObsidianWorkerConfigStore` already establishes) — never a
 * new endpoint, and never a server-side quality store that would itself
 * breach C6.
 *
 * ===========================================================================
 * WORDING
 * ===========================================================================
 * `EXPLAIN_BACK_AUDIT_GATE_HEADING`/`_BODY` are the product's wording of the
 * D-127 promise, the same relationship `degradation-statement.ts`'s module
 * doc draws between its own two strings and F7.8's text: honest about what
 * is true (grading calibration failed its audit; explaining back is
 * paused), without blame and without exposing the audit's own vocabulary
 * ("calibration," "cross-grader," "false praise") to her. Flagged in this
 * bead's report for David's wording review, same as any other new
 * student-visible string.
 */

import type { ObsidianDataHost } from '../worker/config-store.js';

export const EXPLAIN_BACK_AUDIT_GATE_HEADING = 'Explaining back is paused';

export const EXPLAIN_BACK_AUDIT_GATE_BODY =
  "Olea grades explain-back answers, then checks that grading against a second opinion — and that check hasn't been agreeing enough lately to trust the result. Explaining back is paused until it does; cards, review, scheduling and the Today panel keep working exactly as before.";

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY = 'explainBackAuditGate';

export interface PersistedExplainBackAuditGate {
  readonly version: 1;
  /**
   * `true` once E2b's live audit (`ol-g3a0`) has observed sustained grading
   * failure. `false` — never absent, never `null` — is the default and the
   * only value a fresh install or an install that predates this bead has.
   */
  readonly sustainedFailure: boolean;
}

/** Nothing set yet — a fresh install, or an install that predates this bead. */
export const EXPLAIN_BACK_AUDIT_GATE_CLEAR: PersistedExplainBackAuditGate = {
  version: 1,
  sustainedFailure: false,
};

function isPersistedExplainBackAuditGate(value: unknown): value is PersistedExplainBackAuditGate {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && typeof candidate.sustainedFailure === 'boolean';
}

/** `true` when explaining back should grey out for THIS (calibration) reason — distinct from `judgeCaller === null`. */
export function isExplainBackKilled(gate: PersistedExplainBackAuditGate): boolean {
  return gate.sustainedFailure;
}

export class ObsidianExplainBackAuditGateStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns `EXPLAIN_BACK_AUDIT_GATE_CLEAR` — never `null`, never a throw — for a fresh, absent or corrupted value, same posture `ObsidianWorkerConfigStore.load` takes. */
  async load(): Promise<PersistedExplainBackAuditGate> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return EXPLAIN_BACK_AUDIT_GATE_CLEAR;
    const candidate = (blob as Record<string, unknown>)[EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY];
    return isPersistedExplainBackAuditGate(candidate) ? candidate : EXPLAIN_BACK_AUDIT_GATE_CLEAR;
  }

  /**
   * The write path `ol-g3a0.1`'s acceptance criterion needs: a real setter,
   * exercised by a test, standing in for the operator-set flag E2b's audit
   * will eventually write once it exists. Read-modify-write, same reason
   * `ObsidianWorkerConfigStore.save` gives: this plugin keeps several stores
   * under sibling keys in one `data.json` blob and none may clobber another.
   */
  async setSustainedFailure(value: boolean): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    const gate: PersistedExplainBackAuditGate = { version: 1, sustainedFailure: value };
    blob[EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY] = gate;
    await this.host.saveData(blob);
  }
}
