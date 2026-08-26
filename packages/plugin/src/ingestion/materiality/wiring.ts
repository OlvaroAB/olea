/**
 * `MaterialityTrigger` / `buildMaterialityWiring` — register row 1.4's
 * two-stage trigger (`TRG-1`, `ol-tqy3`), composed the same way every other
 * wiring root in this directory composes `olea-core` decision logic against
 * real Obsidian-backed ports (`wiring.ts` one level up, `grading/wiring.ts`,
 * `retrieval/wiring.ts`).
 *
 * ===========================================================================
 * WHAT IS, AND ISN'T, WIRED HERE — READ BEFORE CALLING FROM `main.ts`
 * ===========================================================================
 * `MaterialityTrigger.evaluate` is a genuine, non-test composition of the
 * free gate (`trigger.ts`) with real persistence (`hash-store.ts`) and a real
 * clock. Given a path's current text, it always resolves to one of:
 * `'unchanged'`, `'formatting-only'`, `'debounced'`, `'below-floor'`, or —
 * when every free gate is cleared — a call to whatever `MaterialityJudge`
 * `buildMaterialityWiring` was given.
 *
 * **No `MaterialityJudge` implementation exists yet, anywhere in this
 * codebase, and none is built by this bead.** The row's second stage is a
 * service call ("hashing client, judgement service"), and building one needs
 * a registered task id in the Worker's frozen catalogue (`[D-111]`'s
 * `<domain>.<verb>.v<N>` convention — the shape `concepts.classify.v1` and
 * `explainBack.judge.v1` already use) that does not exist for materiality
 * today. Registering that task, and its prompt, is `olea-service`-side work
 * this bead does not own. `buildMaterialityWiring` therefore accepts `judge:
 * MaterialityJudge | null` and, when `null`, `evaluate` reports
 * `'judge-unavailable'` for anything that clears the free gates rather than
 * silently skipping the file or fabricating a verdict — the same
 * "grey out, never half-work" contract `retrieval/wiring.ts` and
 * `grading/wiring.ts` use for an unconfigured Worker, applied to a task that
 * has no Worker route at all yet rather than one that merely isn't
 * configured.
 *
 * **Nothing in `packages/plugin` calls `buildMaterialityWiring` yet.** The
 * natural call site is `main.ts`'s `onload`, alongside
 * `buildKeywordIndexWiring`/`buildRetrievalWiring`/`buildGradingWiring` —
 * `vault.watch(handler)` (already used for the keyword index, see
 * `main.ts`'s existing `this.keywordIndex = await buildKeywordIndexWiring(...)`
 * call) is the exact mechanism row 1.4's `Boundary` ("hashing client") needs
 * to react to `C1.5`'s vault-change events. That file is a concurrently-owned
 * lane's (`ol-sn1q`, in progress) at the time of this bead, so the call is
 * not added here — this is the same reachability shape `grading/wiring.ts`'s
 * module doc already documents for `gradeExplainBackAttempt`/
 * `evaluateConfusionRouting`: real infrastructure, composed against real
 * ports, with the one remaining line — the call from `main.ts`'s `onload` —
 * left for whichever bead next has that file free, or for `main.ts`'s owning
 * lane to add once it lands. **What that line needs**: a `MaterialityTrigger`
 * built via `buildMaterialityWiring({ dataHost: this, clock: { now: () =>
 * Date.now() } })`, and a call to `.evaluate(path, currentText,
 * previousText)` from inside the handler `vault.watch(...)` already
 * receives, on `'modify'` events, with `previousText` sourced from wherever
 * the caller already holds a pre-edit copy (the keyword index's own stored
 * chunk text is the most likely source — this bead does not decide that,
 * since it owns no file able to read the keyword index's cache).
 */

import type { Clock } from 'olea-core';
import { canonicalizeForMateriality } from './canonical.js';
import type { MaterialityConstants } from './constants.js';
import { DEFAULT_MATERIALITY_CONSTANTS } from './constants.js';
import { ObsidianMaterialityHashStore } from './hash-store.js';
import { computeMaterialityHashes } from './hashes.js';
import { evaluateMaterialityGate } from './trigger.js';
import type {
  MaterialityGateOutcome,
  MaterialityHashStore,
  MaterialityJudge,
  MaterialityVerdictEvent,
} from './types.js';

export type MaterialityEvaluationResult =
  | MaterialityGateOutcome
  | { readonly kind: 'judge-unavailable' }
  | { readonly kind: 'verdict'; readonly verdict: MaterialityVerdictEvent };

export interface MaterialityTriggerDeps {
  readonly store: MaterialityHashStore;
  readonly clock: Clock;
  readonly judge: MaterialityJudge | null;
  readonly constants?: MaterialityConstants | undefined;
  /**
   * Best-effort notification of a produced verdict — never awaited by
   * anything that could fail the evaluation it rode in on, same
   * `onUnitsLanded` shape `../wiring.ts` uses for the same reason: a
   * downstream consumer's failure must never make row 1.4 itself look like
   * it misfired.
   */
  readonly onVerdict?: ((event: MaterialityVerdictEvent) => Promise<void> | void) | undefined;
}

export class MaterialityTrigger {
  private readonly constants: MaterialityConstants;

  constructor(private readonly deps: MaterialityTriggerDeps) {
    this.constants = deps.constants ?? DEFAULT_MATERIALITY_CONSTANTS;
  }

  /**
   * Evaluates one observed version of `path`'s text against whatever was
   * last recorded for it. `previousText` is needed only if every free gate
   * is cleared and a real judge call follows — pass `undefined` when the
   * caller has no pre-edit copy to hand (the result is then
   * `'judge-unavailable'` rather than a call the judge cannot answer
   * honestly, even when a judge is configured).
   */
  async evaluate(
    path: string,
    currentText: string,
    previousText?: string,
  ): Promise<MaterialityEvaluationResult> {
    const now = this.deps.clock.now();
    const current = await computeMaterialityHashes(currentText);
    const record = await this.deps.store.load(path);
    const canonicalLength = canonicalizeForMateriality(currentText).length;
    const canonicalCharDelta =
      record === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(canonicalLength - record.canonicalLength);

    const outcome = evaluateMaterialityGate({
      previous: record?.hashes ?? null,
      current,
      canonicalCharDelta,
      lastChangedAt: record?.lastChangedAt ?? null,
      now,
      constants: this.constants,
    });

    if (outcome.kind === 'unchanged') return outcome;

    if (
      outcome.kind === 'formatting-only' ||
      outcome.kind === 'debounced' ||
      outcome.kind === 'below-floor'
    ) {
      // A raw change was observed even where the gate declines to act on it
      // yet — record it, resetting `lastChangedAt` to `now` in every case,
      // so the next evaluation's debounce math counts quiet time from THIS
      // edit, not a stale earlier one. This is what makes a continuous
      // editing burst settle into one eventual pass rather than firing the
      // moment a fixed window from the *first* keystroke elapses, even while
      // she is still typing (the `debounced` case) — and what keeps the
      // floor's next comparison against the freshest content rather than an
      // increasingly stale baseline (the `below-floor` case). **Known
      // limitation, left for the bead that derives these constants for
      // real**: several below-floor edits in a row each compare only against
      // the immediately preceding save, so a slow accumulation of small
      // edits can cross real materiality without any single step tripping
      // the floor. `lastVerdictAt` is untouched: none of these outcomes
      // produced a verdict.
      await this.deps.store.save({
        path,
        hashes: current,
        canonicalLength,
        lastChangedAt: now,
        lastVerdictAt: record?.lastVerdictAt ?? null,
      });
      return outcome;
    }

    // outcome.kind === 'call-judge'
    if (this.deps.judge === null || previousText === undefined) {
      return { kind: 'judge-unavailable' };
    }
    const judged = await this.deps.judge.judge({ path, previousText, currentText });
    await this.deps.store.save({
      path,
      hashes: current,
      canonicalLength,
      lastChangedAt: now,
      lastVerdictAt: now,
    });
    const verdict: MaterialityVerdictEvent = {
      path,
      at: now,
      material: judged.material,
      reason: judged.reason,
    };
    if (this.deps.onVerdict) {
      try {
        await this.deps.onVerdict(verdict);
      } catch (error) {
        console.error('Olea: materiality-verdict hook failed (trigger unaffected)', error);
      }
    }
    return { kind: 'verdict', verdict };
  }
}

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern every store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export interface MaterialityWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly clock: Clock;
  /** `null` when no Worker task exists for this judgement yet — see this module's doc. */
  readonly judge: MaterialityJudge | null;
  readonly constants?: MaterialityConstants | undefined;
  readonly onVerdict?: ((event: MaterialityVerdictEvent) => Promise<void> | void) | undefined;
}

export function buildMaterialityWiring(deps: MaterialityWiringDeps): MaterialityTrigger {
  const store = new ObsidianMaterialityHashStore(deps.dataHost);
  return new MaterialityTrigger({
    store,
    clock: deps.clock,
    judge: deps.judge,
    constants: deps.constants,
    onVerdict: deps.onVerdict,
  });
}
