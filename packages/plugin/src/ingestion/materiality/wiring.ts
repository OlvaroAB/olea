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
 * ===========================================================================
 * RETRACTED (`[DOS-C3]`, ol-2zfj.152): the paragraph below this one used to
 * say `main.ts` passes `judge: null` and that no `MaterialityJudge`
 * implementation exists. Both are stale. `ol-2zfj.18` closed the D-072 gap
 * this paragraph described: it reserved `materiality.judge.v1` in the frozen
 * catalogue, built the real `WorkerTaskTransport`-backed implementation
 * (`workerJudge.ts`'s `WorkerMaterialityJudge`), and `main.ts`'s `onload`
 * now constructs one and passes it as `buildMaterialityWiring`'s `judge`
 * (`main.ts:1476-1479`, a file this bead does not own — see that file for
 * the exact wiring). The paid second stage is reachable end to end; a
 * `'judge-unavailable'` result now means an unconfigured Worker (no token
 * pasted yet) or a genuinely missing `previousText`, never "nothing was ever
 * built."
 * ===========================================================================
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
  /**
   * Paths that have already had one `'below-floor'` edit deferred since
   * their last real decision (a verdict, or a fresh `'unchanged'`/
   * `'formatting-only'` baseline). `[DOS-C3]`: the length floor may defer or
   * batch a small edit, but it may never let a real content change (the
   * canonical hash differs — this is not formatting) go undecided forever.
   * A second below-floor edit on the same path escalates straight to the
   * judge regardless of ITS OWN length delta — which is what catches a
   * same-length substitution (a sign, a digit, a negation word) that would
   * otherwise never accumulate a length delta at all.
   */
  private readonly pendingSmallEdit = new Map<string, boolean>();
  /**
   * Per-path counter bumped on every judge call this instance starts.
   * `[DOS-C3]`: guards the "stale response" race — if a second `evaluate()`
   * call for the same path starts (and will persist its own, newer,
   * baseline) while an earlier call is still awaiting the judge, the earlier
   * call's response must never be allowed to mark the newer content as
   * already processed. Each call captures the counter's value before
   * awaiting the judge and checks it again after; a mismatch means a newer
   * call is now the one of record for this path, so the older response is
   * dropped (no store write, no verdict) rather than committed over it.
   */
  private readonly revisions = new Map<string, number>();

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

    let outcome = evaluateMaterialityGate({
      previous: record?.hashes ?? null,
      current,
      canonicalCharDelta,
      lastChangedAt: record?.lastChangedAt ?? null,
      now,
      constants: this.constants,
    });

    if (outcome.kind === 'unchanged') return outcome;

    if (outcome.kind === 'below-floor') {
      if (this.pendingSmallEdit.get(path) === true) {
        // [DOS-C3]: a second sub-floor edit on this path since the last real
        // decision. The floor already deferred once — it must not defer
        // forever, so this recurrence escalates to the judge regardless of
        // this edit's own (possibly zero) length delta.
        this.pendingSmallEdit.delete(path);
        outcome = { kind: 'call-judge' };
      } else {
        this.pendingSmallEdit.set(path, true);
      }
    }

    if (outcome.kind === 'formatting-only' || outcome.kind === 'debounced') {
      // Neither outcome produced a decision — record the raw/canonical
      // change so the store's `unchanged`/`formatting-only` checks compare
      // against the freshest content next time, but keep `lastVerdictAt`
      // untouched: no verdict was produced.
      await this.deps.store.save({
        path,
        hashes: current,
        canonicalLength,
        lastChangedAt: now,
        lastVerdictAt: record?.lastVerdictAt ?? null,
      });
      return outcome;
    }

    if (outcome.kind === 'below-floor') {
      // [DOS-C3]: deliberately DO NOT advance `hashes`/`canonicalLength` to
      // `current` here — only `lastChangedAt` advances. A run of sub-floor
      // edits must keep comparing against the last successfully-processed
      // baseline, not the immediately preceding save; resetting the
      // baseline on every below-floor save is exactly what let a slow
      // accumulation of small edits cross real materiality without any
      // single step tripping the floor (the limitation this bead closes).
      // `record` is guaranteed non-null here (the gate only returns
      // `below-floor` when `previous !== null`); the `??` fallback is a
      // defensive no-op, never expected to fire.
      await this.deps.store.save({
        path,
        hashes: record?.hashes ?? current,
        canonicalLength: record?.canonicalLength ?? canonicalLength,
        lastChangedAt: now,
        lastVerdictAt: record?.lastVerdictAt ?? null,
      });
      return outcome;
    }

    // outcome.kind === 'call-judge'
    this.pendingSmallEdit.delete(path);
    if (this.deps.judge === null || previousText === undefined) {
      return { kind: 'judge-unavailable' };
    }
    // [DOS-C3]: the "stale response" race guard — see the `revisions` field
    // doc above. Captured before the await, checked after.
    const revision = (this.revisions.get(path) ?? 0) + 1;
    this.revisions.set(path, revision);
    const judged = await this.deps.judge.judge({ path, previousText, currentText });
    if (this.revisions.get(path) !== revision) {
      // A newer `evaluate()` call for this path started while this judge
      // call was in flight, and will persist its own (newer) baseline. This
      // response is older than that call's request: it must never mark the
      // newer content as already processed, so it is dropped entirely — no
      // store write, no verdict, no `onVerdict`. The newer call is the one
      // of record for this path.
      return { kind: 'judge-unavailable' };
    }
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
