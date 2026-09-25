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
 *
 * ===========================================================================
 * `[DOS-3]` (ol-2zfj.159): `drainDuePendingEdits` is wired to production —
 * `main.ts`'s `drainPendingMaterialityEdits` calls it from the SAME periodic
 * interval that already drives `tickCitationRevisions`
 * (`INGESTION_TICK_INTERVAL_MS`, `main.ts:1714-1723`).
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
  MaterialityHashes,
  MaterialityHashStore,
  MaterialityJudge,
  MaterialityVerdictEvent,
} from './types.js';

export type MaterialityEvaluationResult =
  | MaterialityGateOutcome
  | { readonly kind: 'judge-unavailable' }
  | { readonly kind: 'verdict'; readonly verdict: MaterialityVerdictEvent };

/** One path's deferred below-floor edit — see `pendingSmallEdit`'s own field doc for why this caches text at all. */
interface PendingBelowFloorEdit {
  /** Epoch ms this edit was observed (and deferred), per the clock at that time — `[DOS-3]`'s drain uses this as the edit's own `lastChangedAt`, not the later drain time. */
  readonly since: number;
  /** `undefined` when `evaluate` had no `previousText` to cache for this edit — drainable only when present. */
  readonly texts: { readonly currentText: string; readonly previousText: string } | undefined;
}

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
   *
   * `[DOS-3]` (ol-2zfj.159): recurrence is not the only way out of pending.
   * If she never touches this path again, no second edit ever comes to
   * escalate on — the same violation of "never go undecided forever" this
   * class's own comment above already names, just for a path with no
   * recurrence rather than one whose recurrence check has a bug. `since` and
   * `texts` (when the caller had a `previousText` to give) are cached here,
   * in memory only, purely so `drainDuePendingEdits` can force this SPECIFIC
   * deferred edit to the judge without needing a fresh vault read — this
   * class holds no `VaultSource` (see this module's own doc) and never will
   * for this reason alone. `texts` is `undefined` when `evaluate` had no
   * `previousText` to cache (the same "no guess" posture `evaluate`'s own
   * `judge-unavailable` branch already takes for that gap) — such a path
   * still gets recurrence escalation, just never a time-based drain.
   */
  private readonly pendingSmallEdit = new Map<string, PendingBelowFloorEdit>();
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
    // `[D-311]`: this path's persisted revision as of the record this
    // evaluation loaded. A record saved before this field existed (or no
    // record at all) has none -- treated as revision 0, the starting point
    // for the STALE-RESPONSE GUARD specifically (see `dispatchJudgeAndCommit`
    // below). This is separate from `isLegacyRecord` below, which is about
    // whether the gate's own shortcuts apply, not about the guard's baseline.
    const persistedRevision = record?.revision ?? 0;

    let outcome = evaluateMaterialityGate({
      previous: record?.hashes ?? null,
      current,
      canonicalCharDelta,
      lastChangedAt: record?.lastChangedAt ?? null,
      now,
      constants: this.constants,
    });

    if (outcome.kind === 'unchanged') return outcome;

    // `[D-311]`, literally: "records without one [a revision] are treated as
    // unknown and re-judged at their next change." A record persisted before
    // this field existed cannot be trusted by the stale-response guard at
    // all -- rather than quietly defaulting it into that guard's bookkeeping,
    // the ruling's own words are implemented directly here: the very next
    // real change to such a path (raw hash differs -- `'unchanged'` already
    // returned above) goes straight to the judge, bypassing the
    // `'formatting-only'`/`'below-floor'` shortcuts that would otherwise
    // decide "no judge call needed" without ever establishing one. This does
    // NOT apply to `'debounced'`: that outcome is about call TIMING (an
    // edit still in progress), never a decision to skip the judge, so a
    // legacy record still waits out debounce like any other path. Once the
    // judge call this forces resolves, the saved record carries a revision
    // (`dispatchJudgeAndCommit` always writes one), so this path takes the
    // ordinary shortcuts from its very next change onward -- at most ONE
    // extra judge call per legacy path, on the first real change `evaluate`
    // sees for it WITH a `previousText` to send.
    //
    // Gated on `previousText !== undefined`: forcing `'call-judge'` when
    // there is nothing to send it would only immediately fall through to
    // `'judge-unavailable'` (same "never a guess" rule the ordinary
    // call-judge branch already applies) -- worse than the ordinary
    // shortcut, since it would also throw away `'below-floor'`'s own
    // pending-recurrence bookkeeping for no gain. `previousText` genuinely
    // absent here (as opposed to a caller simply not having one to give for
    // THIS call) does not happen in production -- `main.ts`'s
    // `materialityPreviousText` supplies one for every `'modify'` after the
    // first -- so this gate does not weaken the ruling in practice.
    const isLegacyRecord = record !== null && record.revision === undefined;
    if (
      isLegacyRecord &&
      previousText !== undefined &&
      (outcome.kind === 'formatting-only' || outcome.kind === 'below-floor')
    ) {
      outcome = { kind: 'call-judge' };
    }

    if (outcome.kind === 'below-floor') {
      if (this.pendingSmallEdit.has(path)) {
        // [DOS-C3]: a second sub-floor edit on this path since the last real
        // decision. The floor already deferred once — it must not defer
        // forever, so this recurrence escalates to the judge regardless of
        // this edit's own (possibly zero) length delta.
        this.pendingSmallEdit.delete(path);
        outcome = { kind: 'call-judge' };
      } else {
        // [DOS-3]: cache this edit's own text too, when there is any, so a
        // NON-recurring below-floor edit can still be drained later (see
        // `drainDuePendingEdits`) rather than only ever escalated by a
        // second edit that may never come.
        this.pendingSmallEdit.set(path, {
          since: now,
          texts: previousText === undefined ? undefined : { currentText, previousText },
        });
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
        // [D-311]: neither outcome dispatched a judge call, so the revision
        // this path is guarded at is unchanged.
        revision: persistedRevision,
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
        // [D-311]: deferred again, not decided -- the revision is unchanged.
        revision: persistedRevision,
      });
      return outcome;
    }

    // outcome.kind === 'call-judge'
    this.pendingSmallEdit.delete(path);
    if (this.deps.judge === null || previousText === undefined) {
      return { kind: 'judge-unavailable' };
    }
    return this.dispatchJudgeAndCommit({
      path,
      currentText,
      previousText,
      persistedRevision,
      canonicalLength,
      current,
      lastChangedAt: now,
      now,
    });
  }

  /**
   * `[DOS-3]` (ol-2zfj.159): forces a judge decision for any path whose
   * below-floor edit has been pending at least `constants.pendingDrainMs`
   * with nothing else having touched it since. Without this, a single small
   * edit that never recurs on its own path sits in `pendingSmallEdit`
   * forever — only a SECOND below-floor edit on the same path ever escalated
   * it (see that field's own doc), and if she never returns to this note,
   * that second edit never comes.
   *
   * Uses the text CACHED when the pending marker was set, never a fresh
   * vault read: this class holds no `VaultSource` (see this module's own
   * "WHAT IS, AND ISN'T, WIRED HERE" doc). That cache is safe to trust
   * unchanged here because anything that could make it stale — a second
   * below-floor edit (recurrence escalation), or any edit big enough to
   * clear the floor on its own — already deletes the pending entry in
   * `evaluate` before this could ever see it; JS's single-threaded,
   * await-only concurrency means that delete always finishes before this
   * method's own `await`s give it a chance to run.
   *
   * A path with no cached `texts` (evaluate had no `previousText` to give at
   * the time) is left pending rather than dropped — same as a path with no
   * configured judge — since dropping it would silently abandon exactly the
   * content change this bead exists to stop losing; nothing currently
   * revives it (no `previousText` will retroactively appear), which is the
   * same inherent, already-accepted limit `evaluate`'s own
   * `judge-unavailable` branch has for the same gap.
   *
   * **Production caller:** `main.ts:1784`'s `drainPendingMaterialityEdits`
   * (see that method's own doc), called from `main.ts:1721`, inside the SAME
   * periodic interval `main.ts` already drives `tickCitationRevisions` from
   * (`INGESTION_TICK_INTERVAL_MS`, `main.ts:1714-1723`).
   */
  async drainDuePendingEdits(now: number): Promise<readonly MaterialityVerdictEvent[]> {
    const verdicts: MaterialityVerdictEvent[] = [];
    for (const [path, pending] of [...this.pendingSmallEdit]) {
      if (now - pending.since < this.constants.pendingDrainMs) continue;
      if (pending.texts === undefined || this.deps.judge === null) continue;
      this.pendingSmallEdit.delete(path);
      const record = await this.deps.store.load(path);
      const persistedRevision = record?.revision ?? 0;
      const current = await computeMaterialityHashes(pending.texts.currentText);
      const canonicalLength = canonicalizeForMateriality(pending.texts.currentText).length;
      const result = await this.dispatchJudgeAndCommit({
        path,
        currentText: pending.texts.currentText,
        previousText: pending.texts.previousText,
        persistedRevision,
        canonicalLength,
        current,
        lastChangedAt: pending.since,
        now,
      });
      if (result.kind === 'verdict') verdicts.push(result.verdict);
    }
    return verdicts;
  }

  /**
   * The shared tail of a judge dispatch, used by both `evaluate`'s
   * `'call-judge'` branch and `drainDuePendingEdits` — one place for the
   * `[DOS-C3]`/`[D-311]` stale-response guard so the two callers cannot
   * drift apart on it. `lastChangedAt` is separate from `now` because
   * `drainDuePendingEdits` reports the edit's OWN observed time, not the
   * (much later) moment the drain happened to run.
   */
  private async dispatchJudgeAndCommit(params: {
    readonly path: string;
    readonly currentText: string;
    readonly previousText: string;
    readonly persistedRevision: number;
    readonly canonicalLength: number;
    readonly current: MaterialityHashes;
    readonly lastChangedAt: number;
    readonly now: number;
  }): Promise<MaterialityEvaluationResult> {
    const {
      path,
      currentText,
      previousText,
      persistedRevision,
      canonicalLength,
      current,
      lastChangedAt,
      now,
    } = params;
    if (this.deps.judge === null) return { kind: 'judge-unavailable' };
    // [DOS-C3]: the "stale response" race guard's FAST PATH — see the
    // `revisions` field doc above. Checked first because it is free (no
    // store I/O) and catches the common case: two dispatches racing on the
    // same still-running `MaterialityTrigger` instance.
    const inMemoryRevision = (this.revisions.get(path) ?? 0) + 1;
    this.revisions.set(path, inMemoryRevision);
    const judged = await this.deps.judge.judge({ path, previousText, currentText });
    if (this.revisions.get(path) !== inMemoryRevision) {
      // A newer dispatch for this path started while this judge call was in
      // flight, and will persist its own (newer) baseline. This response is
      // older than that call's request: it must never mark the newer
      // content as already processed, so it is dropped entirely — no store
      // write, no verdict, no `onVerdict`. The newer call is the one of
      // record for this path.
      return { kind: 'judge-unavailable' };
    }
    // `[D-311]`: the check above is scoped to `this` instance and starts
    // empty again after a restart — a response completing against a FRESH
    // `MaterialityTrigger` (a new instance, but the SAME persisted store)
    // would sail through it with nothing to compare against. Reload the
    // record and check its persisted revision too: if it no longer matches
    // what this call saw when it started, a genuinely newer evaluation (in
    // this process, or, surviving a restart, a later one reading the same
    // store) has already committed its own verdict here. Drop this response
    // the same way — no store write, no verdict, no `onVerdict`.
    const recordAfterJudge = await this.deps.store.load(path);
    if ((recordAfterJudge?.revision ?? 0) !== persistedRevision) {
      return { kind: 'judge-unavailable' };
    }
    await this.deps.store.save({
      path,
      hashes: current,
      canonicalLength,
      lastChangedAt,
      lastVerdictAt: now,
      revision: persistedRevision + 1,
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
