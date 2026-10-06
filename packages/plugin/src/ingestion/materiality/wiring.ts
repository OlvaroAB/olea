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
 *
 * ===========================================================================
 * `ol-egov.141.89.5.29` / `ol-egov.141.89.5.30` (from the change-detection
 * development run, `findings/ilb-chg-benchmark.md`, olea-service): two
 * defects in how a verdict actually reaches row 1.4's two consumers, fixed
 * together.
 *
 * (1) `drainDuePendingEdits` was wired to production (the paragraph above)
 * but its RETURN VALUE was discarded at the call site — a same-length edit
 * or an autosave burst that only ever resolves through the drain (never a
 * second `evaluate()` call on that path) produced a real verdict that never
 * reached `recordMaterialArrivalIfObserved` or
 * `triggerAuthoredNoteGenerationIfObserved`. Fixed by returning
 * `DrainedMaterialityVerdict` (verdict + the text it is about) and having
 * `main.ts`'s `drainPendingMaterialityEdits` route each one through the SAME
 * two consumers `evaluateMaterialityChange` already uses, per `[D-293]`.
 *
 * (2) The `[DOS-C3]`/`[D-311]` stale-response guard in
 * `dispatchJudgeAndCommit` reported a dropped, superseded response as
 * `'judge-unavailable'` — a kind `observedMaterialChange` (`main.ts`) already
 * reads as a real change. A stale drop means a NEWER call already committed
 * its own verdict for this path; reading the drop itself as a second change
 * fired both consumers again, redundantly, on text she has already
 * superseded. Fixed by a distinct `'stale-response-dropped'` kind
 * (`MaterialityEvaluationResult`, above) that consumers read as no-op.
 * ===========================================================================
 *
 * ===========================================================================
 * `[D-427]` (ruled 2026-10-02, `ol-egov.141.89.5.31`): A CHECK UNFINISHED AT
 * RESTART IS RECOVERED, INCLUDING EDITS STILL WAITING IN MEMORY
 * ===========================================================================
 * Before this, an unfinished file-level check lived only in memory: a small
 * or debounced edit waiting in `pendingSmallEdit`/`pendingDebounced`, and the
 * previous text a judge call in flight compared against. A restart lost both
 * and the change was never decided. Now each unfinished check also has a
 * pending record (`pending-store.ts`: the last settled text, the `[D-311]`
 * revision it would settle, the retry state), written BEFORE the edit is held
 * back or the call is dispatched, and removed when the answer is committed,
 * when the check resolves as judge-unavailable, or when it turns out stale.
 *
 * `recoverUnfinishedChecks` is the restart half. It runs from the same
 * periodic tick as the drain (`main.ts`'s `drainPendingMaterialityEdits`),
 * reads each recorded path's current text, and reconciles it with the last
 * settled version: a stale record (the revision moved on), a missing file or
 * a file back at its settled version is cleared without a call; a held-back
 * edit is put back where the drain finds it, with its original timing; a call
 * that was in flight is sent again ONCE. The four `[D-400]` conditions hold
 * for the file grain: (1) one automatic retry per check, its spend recorded
 * on the pending record before the call, so a further restart never grants
 * another — an unanswered retry resolves the check as `'judge-unavailable'`;
 * (2) the retry is an ordinary judge call through the same recording
 * transport, so the usage log counts it like any other; (3) a late or
 * superseded answer is dropped by the `[D-311]` guard below exactly as
 * before; (4) a check whose retry fails is never left silently undecided: it
 * resolves as `'judge-unavailable'`, which both consumers read as changed.
 * While the Worker is unreachable (`deps.isOnline`) a recovery call is not
 * attempted and no budget is spent; the record waits for the next pass.
 *
 * A save that arrives after a restart and before the recovery pass reads the
 * pending record's text as its baseline (`evaluateUnderLock`), so a further
 * edit is judged against the last settled version rather than resolving as a
 * first sighting with nothing to compare against.
 * ===========================================================================
 */

import {
  type ChangedRegion,
  type ChangedRegionOptions,
  type ChangedRegionPurpose,
  type Clock,
  decisionFromRevisionJudge,
  extractChangedRegions,
  type MaterialityDecision,
  type ModelStamp,
} from 'olea-core';
import { canonicalizeForMateriality } from './canonical.js';
import type { MaterialityConstants } from './constants.js';
import { DEFAULT_MATERIALITY_CONSTANTS } from './constants.js';
import { ObsidianMaterialityHashStore } from './hash-store.js';
import { computeMaterialityHashes } from './hashes.js';
import {
  type MaterialityPendingCheck,
  type MaterialityPendingStore,
  type MaterialityPendingWait,
  ObsidianMaterialityPendingStore,
} from './pending-store.js';
import { evaluateMaterialityGate } from './trigger.js';
import type {
  MaterialityGateOutcome,
  MaterialityHashes,
  MaterialityHashStore,
  MaterialityJudge,
  MaterialityJudgeVerdict,
  MaterialityRecord,
  MaterialityVerdictEvent,
} from './types.js';
import { MATERIALITY_JUDGE_TASK_ID } from './workerJudge.js';

export type MaterialityEvaluationResult =
  | MaterialityGateOutcome
  | { readonly kind: 'judge-unavailable' }
  /**
   * `ol-egov.141.89.5.30`: a judge response that answered but was dropped by
   * the `[DOS-C3]`/`[D-311]` stale-response guard below (`dispatchJudgeAndCommit`)
   * because a newer dispatch for the same path already committed its own,
   * later verdict — the content this response is about has already been
   * superseded. Distinct from `'judge-unavailable'` (no judge configured, no
   * `previousText` to send, or the judge call itself failed operationally):
   * those are genuinely UNANSWERED, so every consumer treats them as changed,
   * conservatively. A stale drop is the opposite — a newer, more current
   * answer already exists and was already acted on — so `main.ts`'s
   * `observedMaterialChange` must NOT read this as a change: the superseded
   * older text driving this drop already had its say via the newer call's
   * own commit, and the newer call's own verdict (or ongoing pending
   * revalidation) is what consumers should trust. Before this bead, this was
   * reported as `'judge-unavailable'` and `observedMaterialChange` read it as
   * changed — firing both consumers a second, redundant time on text she has
   * already superseded.
   */
  | { readonly kind: 'stale-response-dropped' }
  | {
      readonly kind: 'verdict';
      readonly verdict: MaterialityVerdictEvent;
      /**
       * `ol-egov.141.89.39`: the same judge verdict read through
       * `olea-core`'s Decision contract
       * (`stage-contract/adapters/revision-judge.ts`'s
       * `decisionFromRevisionJudge`), carrying the Worker's D7.3 stamp
       * (`workerJudge.ts`'s `StampedMaterialityJudgeVerdict`) into the
       * adapted decision's provenance — see `readMaterialityJudgeStamp`'s
       * doc below for why it is read defensively rather than assumed.
       */
      readonly decision: MaterialityDecision;
    };

/**
 * `ol-egov.141.89.5.29`: `drainDuePendingEdits`'s own return element — the
 * verdict a drained below-floor/debounced edit produced, paired with the
 * `currentText` that verdict is ABOUT (cached on the pending entry when the
 * edit was first deferred; see `PendingBelowFloorEdit`'s own field doc). A
 * bare `MaterialityVerdictEvent` (`path`, `at`, `material`, `reason`) has
 * nothing a consumer could pass to `parseDocument`/`buildAuthoredNoteUnit` —
 * this is what `main.ts`'s `drainPendingMaterialityEdits` needed to route a
 * drained verdict through the SAME `recordMaterialArrivalIfObserved`/
 * `triggerAuthoredNoteGenerationIfObserved` consumers the direct
 * `evaluate()` path already uses (per `[D-293]`'s own consumer-parity
 * ruling).
 */
export interface DrainedMaterialityVerdict {
  readonly verdict: MaterialityVerdictEvent;
  readonly currentText: string;
}

/** The two results a settled check can hand row 1.4's consumers: an answer, or no answer to be had. */
export type SettledMaterialityResult =
  | Extract<MaterialityEvaluationResult, { readonly kind: 'verdict' }>
  | { readonly kind: 'judge-unavailable' };

/**
 * `[D-427]`: one check `recoverUnfinishedChecks` settled, with the current text it is about, for
 * `main.ts` to route through the SAME two consumers `evaluateMaterialityChange` uses, exactly once.
 * `result` is a `'verdict'` (the recovered call was answered) or `'judge-unavailable'` (the one
 * retry also went unanswered, or no judge is configured), which both consumers read as changed.
 */
export interface RecoveredMaterialityCheck {
  readonly path: string;
  readonly currentText: string;
  readonly result: SettledMaterialityResult;
}

/**
 * How a failed judge call settles. `'resolve-unavailable'`: the caller hands `'judge-unavailable'`
 * to the consumers now (the direct `evaluate` path, and the one recovery retry), so the pending
 * record is cleared. `'leave-for-retry'`: nobody has acted on the failure yet (a drained edit, or
 * a recovered check's first call), so the record stays for its one automatic retry.
 */
type FailureMode = 'resolve-unavailable' | 'leave-for-retry';

interface DispatchOutcome {
  readonly result: MaterialityEvaluationResult;
  /** True when the call failed and its pending record was kept for the one retry (`'leave-for-retry'`). */
  readonly leftForRetry: boolean;
}

/** `[D-427]`: one recovery step for a path, decided under its lock. */
type ReconcileStep =
  | { readonly kind: 'settled'; readonly recovered: RecoveredMaterialityCheck | null }
  | { readonly kind: 'later' }
  | {
      readonly kind: 'dispatch';
      readonly dispatch: JudgeDispatchParams;
      readonly isRetry: boolean;
    };

/** A content-free label for a caught error (D-005: an error message may name a path). */
function failureClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Reads `.stamp` off a `MaterialityJudge`'s verdict. The declared
 * `MaterialityJudgeVerdict` (`./types.ts`) has no `stamp` field, but the
 * production judge (`WorkerMaterialityJudge`, `./workerJudge.ts`) returns a
 * strict superset with one attached — see that file's own "THE D7.3 STAMP"
 * doc. Read here the same defensive way every other Worker-response stamp
 * reader in this plugin does: `null` for a judge that never attaches one (a
 * test stub) or a malformed value, never invented (D-005).
 */
function readMaterialityJudgeStamp(verdict: MaterialityJudgeVerdict): ModelStamp | null {
  const stamp = (verdict as { readonly stamp?: unknown }).stamp;
  if (typeof stamp !== 'object' || stamp === null) return null;
  const s = stamp as Record<string, unknown>;
  if (typeof s.promptVersion !== 'string' || s.promptVersion.length === 0) return null;
  if (typeof s.modelId !== 'string' || s.modelId.length === 0) return null;
  return { promptVersion: s.promptVersion, modelId: s.modelId };
}

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
  /**
   * `[D-427]`: where each unfinished check's pending record is kept (`pending-store.ts`). Absent,
   * the trigger keeps everything in memory exactly as before this ruling, and nothing survives a
   * restart; production always supplies one (`buildMaterialityWiring`).
   */
  readonly pendingStore?: MaterialityPendingStore | undefined;
  /**
   * `[D-427]`: reads a recorded path's current text for restart reconciliation, `null` when there
   * is nothing of hers there to reconcile (the file is gone). Absent, `recoverUnfinishedChecks`
   * does nothing.
   */
  readonly readCurrentText?: ((path: string) => Promise<string | null>) | undefined;
  /**
   * Reachability, read once per recovery pass. A recovery call is not attempted while this reads
   * false, so an outage never spends the one retry — the same rule and the same source the
   * citation grain uses (`citation-revision-wiring.ts`, "AN OUTAGE NEVER SPENDS THE `[D-400]`
   * BUDGET"). Defaults to always reachable.
   */
  readonly isOnline?: (() => boolean) | undefined;
}

/**
 * The params `dispatchJudgeAndCommit` needs, factored out so `evaluate`'s
 * locked phase (`evaluateUnderLock`) can hand them to its caller without
 * itself calling the judge — see `evaluate`'s own doc for why that split
 * exists. `[D-427]`: `persistedRevision`, `current.rawHash` and `now` are also the identity of
 * the pending record this dispatch wrote, so its settle only ever clears its own record.
 */
interface JudgeDispatchParams {
  readonly path: string;
  readonly currentText: string;
  readonly previousText: string;
  readonly persistedRevision: number;
  readonly canonicalLength: number;
  readonly current: MaterialityHashes;
  readonly lastChangedAt: number;
  readonly now: number;
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
   * Same shape as `pendingSmallEdit`, tracking a path whose most recent save
   * came back `'debounced'` rather than `'below-floor'` (`ol-egov.141.89.5.7`,
   * defect 1). Kept as a SEPARATE map, not a shared "kind" flag, because the
   * two have different drain timings (`constants.debounceMs` here,
   * `constants.pendingDrainMs` for `pendingSmallEdit`) — but a path's history
   * can cross from one into the other (a below-floor edit followed by a
   * debounced one, or the reverse), so every place that SETS either map
   * first reads and clears the OTHER, carrying its cached baseline forward
   * rather than letting two independent pending entries for the same path
   * ever coexist (which would risk two judge calls, and calling the second
   * with a baseline that is itself only a pending, undecided save).
   */
  private readonly pendingDebounced = new Map<string, PendingBelowFloorEdit>();
  /**
   * The text of the last revision this trigger actually processed (a
   * committed verdict, or a `'formatting-only'` exit) for a path, seeded
   * from the first `previousText` this instance ever sees for it.
   * `ol-egov.141.89.5.7`, defect 2: a judge call must compare against the
   * last revision it actually judged, not against whatever `previousText`
   * the caller happens to pass on THIS call — which is only "the text
   * before this particular save" and can be stale once an earlier edit was
   * deferred (below-floor/debounced) or an earlier judge call for this path
   * is still in flight when a newer save arrives. Session-scoped only, the
   * same posture `previous-text.ts`'s own tracker takes for the same reason:
   * a restart loses it, and the next real change is handled by the existing
   * `[D-311]`/legacy-record machinery instead, never a guess. `[D-427]`: when
   * the path has a pending record (an unfinished check), its stored baseline
   * seeds this instead, so a restart no longer loses it for those paths.
   */
  private readonly lastProcessedText = new Map<string, string>();
  /**
   * `ol-egov.141.89.5.85` ([D-311]): paths whose text changed while Obsidian was closed (marked
   * by priming). Session-only; a mark is spent on the path's first evaluation.
   */
  private readonly previousUnknown = new Set<string>();
  /**
   * `[D-427]`: judge calls this instance has dispatched and not yet settled,
   * per path. Raised under the path lock, in the same step that writes the
   * call's pending record, so a recovery pass (which takes the same lock)
   * never mistakes a live call's record for one a restart left behind.
   */
  private readonly inFlight = new Map<string, number>();
  /**
   * `[D-427]`: whether the pending store may hold a record no part of this
   * instance is working on. True at construction (a restart may have left
   * some), and again whenever a call fails and leaves its record for the one
   * retry, or a recovery pass had to leave a record for later (unreachable,
   * unreadable). `recoverUnfinishedChecks` only lists the store while true.
   */
  private recoveryScanDue = true;
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
  /**
   * `[ol-dpzz]`: the tail of the in-flight `evaluateUnderLock` chain for a
   * path, so a new `evaluate()` call is queued behind whatever is already
   * running for the SAME path rather than racing it. In memory only, never
   * persisted — a restart clears it, same as `pendingSmallEdit`,
   * `pendingDebounced`, `lastProcessedText` and `revisions` above. See
   * `evaluate`'s own doc for the failure this closes and why the lock
   * deliberately stops short of the judge dispatch.
   */
  private readonly pathLocks = new Map<string, Promise<unknown>>();

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
   *
   * `[ol-dpzz]`: the record load, gate decision and any non-judge write
   * below (`evaluateUnderLock`) must never interleave with another
   * `evaluate()` call for the SAME path. Before this fix, `now` was captured
   * and the free-gate decision made against whatever `store.load(path)`
   * happened to return WHENEVER its own await settled — with two genuinely
   * overlapping calls (two rapid vault `'modify'` events, each awaiting its
   * own `vault.read()` before calling `evaluate()`), that could resolve in
   * either order relative to the other call's own load and write. An older
   * call's `now` could end up compared against an already-advanced
   * `lastChangedAt` from a newer call's write (misreading a real, still-fresh
   * change as debounced) — and separately, whichever call's OWN
   * `store.save()` simply happened to settle last would win, even if that
   * call had read its `record` before the other call wrote: a plain
   * read-then-write race that could revert the store's cached
   * hashes/canonicalLength/revision back to pre-edit content, silently
   * erasing a newer call's already-committed advance.
   *
   * Two fixes were possible: moving `now`'s capture to AFTER the load, or
   * per-path serialisation (`withPathLock` below). Moving `now` alone would
   * fix the `now`-vs-`lastChangedAt` comparison (both values would then come
   * from a mutually consistent moment), but does nothing for the SEPARATE
   * stale-hash-revert failure, which is an ordinary read-then-write race on
   * `record` itself, unrelated to which line reads the clock — the
   * store-mediated equivalent of two threads doing `x = x + 1` without a
   * lock. Serialising the whole load-decide-write window fixes both: with
   * it, two overlapping calls for the same path can no longer observe or
   * write over each other's state at all, restoring exactly today's
   * single-call behaviour for the common (non-overlapping) case, since an
   * uncontended lock never delays anything.
   *
   * The lock deliberately stops short of `dispatchJudgeAndCommit`: that
   * method already carries its own stale-response guard for a judge call in
   * flight (the `revisions` field's own doc, `[DOS-C3]`), and
   * `wiring.spec.ts`'s existing "a newer evaluation completes before an
   * older one's judge call resolves" test depends on two overlapping
   * `evaluate()` calls for the same path being able to run concurrently once
   * one of them is only waiting on the judge. Holding this lock across a
   * judge network round trip would also serialise unrelated concurrent edits
   * on the same path behind a paid call, which nothing about this bug calls
   * for.
   */
  async evaluate(
    path: string,
    currentText: string,
    previousText?: string,
  ): Promise<MaterialityEvaluationResult> {
    const phase = await this.withPathLock(path, () =>
      this.evaluateUnderLock(path, currentText, previousText),
    );
    if (phase.kind === 'resolved') return phase.result;
    // A failure here is handed to the caller as `'judge-unavailable'` now, so its record is cleared.
    return (await this.dispatchJudgeAndCommit(phase.dispatch, 'resolve-unavailable')).result;
  }

  /**
   * Chains `run` after whatever is already queued for `path`, so at most one
   * `evaluateUnderLock` call is ever in flight per path at a time — see
   * `evaluate`'s own doc for why. The queued continuation always resolves
   * (never rejects) regardless of `run`'s own outcome, so a failed call never
   * wedges the path for whatever calls it next; the promise actually
   * returned to `evaluate`'s caller is `run`'s own, untouched — a rejection
   * still propagates to that caller exactly as it would without the lock.
   */
  private async withPathLock<T>(path: string, run: () => Promise<T>): Promise<T> {
    const priorTurn = this.pathLocks.get(path) ?? Promise.resolve();
    const settledPriorTurn = priorTurn.then(
      () => undefined,
      () => undefined,
    );
    const thisTurn = settledPriorTurn.then(run);
    this.pathLocks.set(
      path,
      thisTurn.then(
        () => undefined,
        () => undefined,
      ),
    );
    return thisTurn;
  }

  /** Marks `path` as having no trustworthy previous text for its first evaluation this session. */
  markPreviousUnknown(path: string): void {
    this.previousUnknown.add(path);
  }

  /**
   * The locked portion of `evaluate` — see that method's doc for the race it
   * closes. Returns either a terminal result (every outcome the free gates
   * settle without a judge call) or the params for a judge dispatch, left to
   * `evaluate` to run only AFTER this path's lock has been released.
   */
  private async evaluateUnderLock(
    path: string,
    currentText: string,
    previousText: string | undefined,
  ): Promise<
    | { readonly kind: 'resolved'; readonly result: MaterialityEvaluationResult }
    | { readonly kind: 'dispatch'; readonly dispatch: JudgeDispatchParams }
  > {
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
    // `[D-427]`: this path's pending record, when it can matter — the first
    // save of this path this session, or one with no `previousText` (after a
    // restart, the record is the only baseline there is). Every other save
    // already has a baseline in memory, and is spared the extra `data.json`
    // read; the call-judge branch below loads it on its own if it was not
    // loaded here. Only a LIVE record (still on the record's current
    // revision) is ever read as a baseline; a stale one is cleared by
    // whichever write below replaces it, or by the next recovery pass.
    const isLive = (pending: MaterialityPendingCheck | null): MaterialityPendingCheck | null =>
      pending !== null && pending.revision === persistedRevision ? pending : null;
    const loadedPending =
      !this.lastProcessedText.has(path) || previousText === undefined
        ? await this.loadPending(path)
        : undefined;
    const livePending = isLive(loadedPending ?? null);
    // Defect 2 (ol-egov.141.89.5.7): seed the "last processed" baseline from
    // the FIRST `previousText` this instance ever sees for `path` — the only
    // trustworthy baseline available without a fresh vault read. Never
    // reseeded once set: a later call's OWN `previousText` argument is only
    // "the text before THIS save," and must never overwrite a baseline this
    // trigger has not yet actually processed (a pending defer, or a judge
    // call still in flight for an earlier revision of this path).
    // `[D-427]`: a live pending record's baseline is the last SETTLED text,
    // truer than "the text before this save", so it seeds first — after a
    // restart it is the only baseline there is.
    if (!this.lastProcessedText.has(path)) {
      const seed = livePending?.baselineText ?? previousText;
      if (seed !== undefined) this.lastProcessedText.set(path, seed);
    }
    // `[D-427]`: what this evaluation can compare against. `previousText`
    // when the caller has one; otherwise (the first save after a restart) a
    // live pending record's settled text — a further edit to a note whose
    // check was unfinished is judged against its last settled version, not
    // resolved as a first sighting. With no pending store this is exactly
    // `previousText`, as before.
    const knownPrevious = previousText ?? livePending?.baselineText;

    let outcome = evaluateMaterialityGate({
      previous: record?.hashes ?? null,
      current,
      canonicalCharDelta,
      lastChangedAt: record?.lastChangedAt ?? null,
      now,
      constants: this.constants,
      currentCanonicalLength: canonicalLength,
    });

    // `ol-egov.141.89.5.85`: the mark is spent here, on the path's first evaluation, whatever
    // the outcome (routing below).
    const wasMarkedUnknown = this.previousUnknown.delete(path);

    if (outcome.kind === 'unchanged') {
      // The note is back at exactly the bytes its baseline was taken from. An
      // edit this instance still holds for the path (below the floor, or
      // debounced), or a judge call still in flight for it, is about text the
      // note no longer holds: it is cleared exactly as the formatting-only
      // exit clears it (same settle below), and an in-flight answer is made
      // stale by bumping the in-memory revision, so it is dropped and never
      // committed as baseline. With nothing held, nothing is written.
      if (this.ownsPath(path)) {
        if (this.inFlight.has(path)) {
          this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
        }
        await this.settleFreeExit(
          path,
          current,
          canonicalLength,
          currentText,
          now,
          record,
          persistedRevision,
        );
      }
      return { kind: 'resolved', result: outcome };
    }

    // `ol-egov.141.89.5.85` ([D-311]): a note marked previous-unknown (changed while Obsidian was
    // closed) has no baseline to judge this first save against, and the record's hashes say only
    // that it differs. With no known previous, a below-floor, debounced or call-judge outcome
    // resolves as unavailable, exactly as the call-judge branch below does, instead of deferring
    // against a wrong baseline. The mark itself was spent above.
    if (
      wasMarkedUnknown &&
      knownPrevious === undefined &&
      (outcome.kind === 'below-floor' ||
        outcome.kind === 'debounced' ||
        outcome.kind === 'call-judge')
    ) {
      this.pendingSmallEdit.delete(path);
      this.pendingDebounced.delete(path);
      await this.clearPending(path);
      return { kind: 'resolved', result: { kind: 'judge-unavailable' } };
    }

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
      knownPrevious !== undefined &&
      (outcome.kind === 'formatting-only' || outcome.kind === 'below-floor')
    ) {
      outcome = { kind: 'call-judge' };
    }

    if (outcome.kind === 'below-floor') {
      if (this.pendingSmallEdit.has(path)) {
        // [DOS-C3]: a second sub-floor edit on this path since the last real
        // decision. The floor already deferred once — it must not defer
        // forever, so this recurrence escalates to the judge regardless of
        // this edit's own (possibly zero) length delta. Leave the entry in
        // place — the unified 'call-judge' handling below reads its cached
        // baseline before clearing it.
        outcome = { kind: 'call-judge' };
      } else {
        // [DOS-3] / defect 1 (ol-egov.141.89.5.7): carry forward any
        // baseline already established by a preceding, still-undecided
        // DEBOUNCED save on this path (a below-floor edit can follow a
        // debounced one in the same burst), so the eventual judge call
        // still compares against the TRUE last-processed text, never an
        // intervening, not-yet-decided one.
        const baseline =
          this.pendingDebounced.get(path)?.texts?.previousText ??
          this.lastProcessedText.get(path) ??
          knownPrevious;
        this.pendingDebounced.delete(path);
        const texts =
          knownPrevious === undefined || baseline === undefined
            ? undefined
            : { currentText, previousText: baseline };
        this.pendingSmallEdit.set(path, { since: now, texts });
        // `[D-427]`: held in memory AND recorded, before the store write below.
        await this.writeDeferredPending(
          path,
          texts?.previousText,
          persistedRevision,
          now,
          'below-floor',
        );
      }
    }

    if (outcome.kind === 'debounced') {
      // Carry forward any baseline already pending on this path (a debounced
      // save can follow a below-floor one, or another debounced one, in the
      // same burst) before it is overwritten below.
      const baseline =
        this.pendingDebounced.get(path)?.texts?.previousText ??
        this.pendingSmallEdit.get(path)?.texts?.previousText ??
        this.lastProcessedText.get(path) ??
        knownPrevious;
      this.pendingSmallEdit.delete(path);
      const texts =
        knownPrevious === undefined || baseline === undefined
          ? undefined
          : { currentText, previousText: baseline };
      this.pendingDebounced.set(path, { since: now, texts });
      // `[D-427]`: held in memory AND recorded, before the store write below.
      // Rewritten only when what it holds changes, not on every autosave of a
      // typing burst (the stored `since` then stays at the burst's first save,
      // which only ever makes a recovered drain due sooner).
      await this.writeDeferredPending(
        path,
        texts?.previousText,
        persistedRevision,
        now,
        'debounced',
      );
      // Defect 1 (ol-egov.141.89.5.7): a save inside the debounce window
      // must NOT replace the stored comparison point — only `lastChangedAt`
      // advances (extending the quiet-period clock so the window keeps
      // resetting while she keeps typing); `hashes`/`canonicalLength` stay
      // at the last real baseline, so a later save's delta is still
      // measured against it, never against this undecided intermediate
      // save. Without this, a burst of debounced autosaves silently moves
      // the baseline forward with no judgment ever produced, and nothing
      // re-checks once the window finally closes — the `pendingDebounced`
      // entry above, drained by `drainDuePendingEdits`, is that re-check.
      await this.deps.store.save({
        path,
        hashes: record?.hashes ?? current,
        canonicalLength: record?.canonicalLength ?? canonicalLength,
        lastChangedAt: now,
        lastVerdictAt: record?.lastVerdictAt ?? null,
        revision: persistedRevision,
      });
      return { kind: 'resolved', result: outcome };
    }

    if (outcome.kind === 'formatting-only') {
      // A genuine free exit: canonical content matches the stored baseline,
      // so nothing is left pending on this path, and THIS raw text becomes
      // the fresher comparison point (defect 2, ol-egov.141.89.5.7) for
      // whatever real change comes next.
      await this.settleFreeExit(
        path,
        current,
        canonicalLength,
        currentText,
        now,
        record,
        persistedRevision,
      );
      return { kind: 'resolved', result: outcome };
    }

    if (outcome.kind === 'no-groundable-content') {
      // Defect 4 (ol-egov.141.89.5.7): an empty new note — record the
      // baseline (zero-length canonical content) so a LATER real edit is
      // measured as an ordinary change against it, rather than being read
      // as another first sighting.
      await this.deps.store.save({
        path,
        hashes: current,
        canonicalLength,
        lastChangedAt: now,
        lastVerdictAt: record?.lastVerdictAt ?? null,
        revision: persistedRevision,
      });
      return { kind: 'resolved', result: outcome };
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
      return { kind: 'resolved', result: outcome };
    }

    // outcome.kind === 'call-judge'
    // Defect 2 (ol-egov.141.89.5.7): compare against the last revision this
    // trigger actually processed — a pending below-floor/debounced defer's
    // own cached baseline (recurrence escalation reads it here, before it is
    // cleared), or the running `lastProcessedText` cache — never against
    // `previousText` alone, which is only "the previous SAVE" and can be
    // stale once an edit was deferred, or an earlier judge call for this
    // path is still in flight when a newer save arrives.
    const carriedEntry = this.pendingSmallEdit.get(path) ?? this.pendingDebounced.get(path);
    const carriedBaseline =
      this.pendingSmallEdit.get(path)?.texts?.previousText ??
      this.pendingDebounced.get(path)?.texts?.previousText;
    this.pendingSmallEdit.delete(path);
    this.pendingDebounced.delete(path);
    if (this.deps.judge === null || knownPrevious === undefined) {
      // `[D-427]`: resolved as unavailable here and now (the caller acts on
      // it), so nothing is left unfinished and no pending record survives it.
      await this.clearPending(path);
      return { kind: 'resolved', result: { kind: 'judge-unavailable' } };
    }
    const dispatch: JudgeDispatchParams = {
      path,
      currentText,
      previousText: carriedBaseline ?? this.lastProcessedText.get(path) ?? knownPrevious,
      persistedRevision,
      canonicalLength,
      current,
      lastChangedAt: now,
      now,
    };
    // `[D-427]`: the pending record is written BEFORE the call, under this
    // path's lock. A live record for this SAME text whose retry is already
    // spent keeps that fact: an observed save never hands a check a second
    // automatic retry. Otherwise this is an original call with its own one.
    const priorPending =
      loadedPending !== undefined ? livePending : isLive(await this.loadPending(path));
    const spentRetry =
      priorPending?.waiting === 'judge' && priorPending.dispatchedHash === current.rawHash
        ? priorPending.retriedAt
        : undefined;
    await this.recordDispatch(dispatch, {
      since: carriedEntry?.since ?? priorPending?.since ?? now,
      retriedAt: spentRetry,
      mustPersist: false,
    });
    return { kind: 'dispatch', dispatch };
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
   *
   * `ol-egov.141.89.5.29`: the returned verdicts carry `currentText`
   * alongside each `MaterialityVerdictEvent` (`DrainedMaterialityVerdict`,
   * below) — before this bead, the caller had no committed text to hand row
   * 1.4's two consumers (`recordMaterialArrivalIfObserved`,
   * `triggerAuthoredNoteGenerationIfObserved`), which is exactly why the
   * drained verdict reached neither: `main.ts` had nothing to route it
   * through with. `evaluate()`'s own `'call-judge'` path never had this
   * problem — its caller (`evaluateMaterialityChange`) already holds the
   * fresh `currentText` it just read from the vault.
   */
  async drainDuePendingEdits(now: number): Promise<readonly DrainedMaterialityVerdict[]> {
    const verdicts: DrainedMaterialityVerdict[] = [];
    for (const [path, pending] of [...this.pendingSmallEdit]) {
      if (now - pending.since < this.constants.pendingDrainMs) continue;
      const drained = await this.drainOne(this.pendingSmallEdit, path, pending, now);
      if (drained !== null) verdicts.push(drained);
    }
    // Defect 1 (ol-egov.141.89.5.7): the debounced-save counterpart of the
    // drain above. Quiet threshold is `constants.debounceMs` here, not
    // `pendingDrainMs` — a debounced save's own outcome already means "wait
    // out the debounce window," so once that same window has elapsed with
    // nothing else touching the path, the accumulated edit (against the
    // TRUE baseline `pending.texts.previousText` cached at defer time, never
    // the intervening save) is owed a judgment. Without this, a burst of
    // debounced autosaves that ends the session (she closes the note and
    // never returns) sits in `pendingDebounced` forever.
    for (const [path, pending] of [...this.pendingDebounced]) {
      if (now - pending.since < this.constants.debounceMs) continue;
      const drained = await this.drainOne(this.pendingDebounced, path, pending, now);
      if (drained !== null) verdicts.push(drained);
    }
    return verdicts;
  }

  /**
   * One due entry of either drain map, sent to the judge. `[D-427]`: the
   * entry is taken and its pending record rewritten as a dispatched call
   * under the path's lock — the same lock `evaluate` and recovery hold — so a
   * save that replaced or escalated the entry since the drain's snapshot
   * wins (the entry is no longer the same object, and its new owner decides
   * it). A failed call keeps its record for the one automatic retry
   * (`'leave-for-retry'`): nothing has acted on the failure yet, since the
   * drain only ever hands its caller verdicts.
   */
  private async drainOne(
    map: Map<string, PendingBelowFloorEdit>,
    path: string,
    pending: PendingBelowFloorEdit,
    now: number,
  ): Promise<DrainedMaterialityVerdict | null> {
    const texts = pending.texts;
    if (texts === undefined || this.deps.judge === null) return null;
    const dispatch = await this.withPathLock(path, async () => {
      if (map.get(path) !== pending) return null;
      map.delete(path);
      const record = await this.deps.store.load(path);
      const params: JudgeDispatchParams = {
        path,
        currentText: texts.currentText,
        previousText: texts.previousText,
        persistedRevision: record?.revision ?? 0,
        canonicalLength: canonicalizeForMateriality(texts.currentText).length,
        current: await computeMaterialityHashes(texts.currentText),
        lastChangedAt: pending.since,
        now,
      };
      await this.recordDispatch(params, {
        since: pending.since,
        retriedAt: undefined,
        mustPersist: false,
      });
      return params;
    });
    if (dispatch === null) return null;
    const { result } = await this.dispatchJudgeAndCommit(dispatch, 'leave-for-retry');
    return result.kind === 'verdict'
      ? { verdict: result.verdict, currentText: texts.currentText }
      : null;
  }

  /**
   * `[D-427]`: the restart half of the pending record — see this module's own
   * `[D-427]` doc section. Lists the pending store (only while a record may be
   * left that nothing in this instance is working on: after construction, a
   * failed call left for its retry, or a pass that had to wait), reconciles
   * each recorded path's current text with its last settled version, and
   * returns every check it settled, for `main.ts` to route through both
   * consumers exactly once. A held-back edit it puts back is NOT returned:
   * the drain decides it on its own timing, and returns that verdict itself.
   *
   * Never throws: a path that fails is logged (content-free) and left for the
   * next pass.
   *
   * **Production caller:** `main.ts`'s `drainPendingMaterialityEdits`, from
   * the same periodic interval as `drainDuePendingEdits`, run just before it.
   */
  async recoverUnfinishedChecks(now: number): Promise<readonly RecoveredMaterialityCheck[]> {
    const { pendingStore, readCurrentText } = this.deps;
    if (pendingStore === undefined || readCurrentText === undefined) return [];
    if (!this.recoveryScanDue) return [];
    this.recoveryScanDue = false;
    let stored: readonly MaterialityPendingCheck[];
    try {
      stored = await pendingStore.list();
    } catch (error) {
      console.error(
        `Olea: the materiality pending records could not be listed; retried next pass (${failureClass(error)})`,
      );
      this.recoveryScanDue = true;
      return [];
    }
    const online = (this.deps.isOnline ?? (() => true))();
    const recovered: RecoveredMaterialityCheck[] = [];
    for (const { path } of stored) {
      try {
        const step = await this.withPathLock(path, () =>
          this.reconcileUnderLock(path, now, online, pendingStore, readCurrentText),
        );
        if (step.kind === 'later') {
          this.recoveryScanDue = true;
          continue;
        }
        if (step.kind === 'settled') {
          if (step.recovered !== null) recovered.push(step.recovered);
          continue;
        }
        // The one retry settles now whatever happens; an original call that
        // fails keeps its record for that retry.
        const { result, leftForRetry } = await this.dispatchJudgeAndCommit(
          step.dispatch,
          step.isRetry ? 'resolve-unavailable' : 'leave-for-retry',
        );
        if (result.kind === 'verdict' || (result.kind === 'judge-unavailable' && !leftForRetry)) {
          recovered.push({ path, currentText: step.dispatch.currentText, result });
        }
      } catch (error) {
        console.error(
          `Olea: a materiality check could not be recovered; left for the next pass (${failureClass(error)})`,
        );
        this.recoveryScanDue = true;
      }
    }
    return recovered;
  }

  /**
   * `[D-427]`: one recorded path, reconciled under its lock. In order:
   *  - a path this instance is already working on (held back in memory, or a
   *    call in flight) is its owner's to settle — skipped;
   *  - a record whose `[D-311]` revision no longer matches is stale (a newer
   *    answer was committed): cleared, no call;
   *  - a file that is gone, or whose text is back at its settled version, has
   *    nothing to decide: cleared, no call; one that differs only in
   *    formatting takes the formatting-only exit `evaluate` would take;
   *  - a held-back edit (below the floor, or debounced) goes back into its
   *    drain map with its original time and the CURRENT text — a further edit
   *    made while the app was closed is folded in, still against the settled
   *    baseline — and the drain decides it;
   *  - a call that was in flight: for the same text, the one retry (recorded
   *    on the pending record before it is sent), or, once that retry is
   *    spent, `'judge-unavailable'` with no call; for a different text (her
   *    further edit), an original call with its own retry. While unreachable,
   *    nothing is sent and nothing is spent: left for a later pass.
   */
  private async reconcileUnderLock(
    path: string,
    now: number,
    online: boolean,
    pendingStore: MaterialityPendingStore,
    readCurrentText: (path: string) => Promise<string | null>,
  ): Promise<ReconcileStep> {
    const nothing: ReconcileStep = { kind: 'settled', recovered: null };
    if (this.ownsPath(path)) return nothing;
    const pending = await pendingStore.load(path);
    if (pending === null) return nothing;
    const record = await this.deps.store.load(path);
    const persistedRevision = record?.revision ?? 0;
    if (pending.revision !== persistedRevision) {
      await this.clearPending(path);
      return nothing;
    }
    let currentText: string | null;
    try {
      currentText = await readCurrentText(path);
    } catch (error) {
      console.error(
        `Olea: a note with an unfinished materiality check could not be read; retried next pass (${failureClass(error)})`,
      );
      return { kind: 'later' };
    }
    if (currentText === null) {
      await this.clearPending(path);
      return nothing;
    }
    const current = await computeMaterialityHashes(currentText);
    if (
      currentText === pending.baselineText ||
      (record !== null && current.rawHash === record.hashes.rawHash)
    ) {
      await this.clearPending(path);
      return nothing;
    }
    const canonicalLength = canonicalizeForMateriality(currentText).length;
    if (record !== null && current.canonicalHash === record.hashes.canonicalHash) {
      await this.deps.store.save({
        path,
        hashes: current,
        canonicalLength,
        lastChangedAt: now,
        lastVerdictAt: record.lastVerdictAt,
        revision: persistedRevision,
      });
      this.lastProcessedText.set(path, currentText);
      await this.clearPending(path);
      return nothing;
    }
    if (!this.lastProcessedText.has(path)) this.lastProcessedText.set(path, pending.baselineText);
    if (pending.waiting !== 'judge') {
      const entry: PendingBelowFloorEdit = {
        since: pending.since,
        texts: { currentText, previousText: pending.baselineText },
      };
      if (pending.waiting === 'below-floor') this.pendingSmallEdit.set(path, entry);
      else this.pendingDebounced.set(path, entry);
      return nothing;
    }
    const unavailable: ReconcileStep = {
      kind: 'settled',
      recovered: { path, currentText, result: { kind: 'judge-unavailable' } },
    };
    if (this.deps.judge === null) {
      await this.clearPending(path);
      return unavailable;
    }
    const sameCheck = pending.dispatchedHash === current.rawHash;
    if (sameCheck && pending.retriedAt !== undefined) {
      // `[D-400]` conditions 1 and 4: the one retry is spent and was never
      // answered — no further call, ever; the check resolves as unavailable.
      await this.clearPending(path);
      return unavailable;
    }
    if (!online) return { kind: 'later' };
    const isRetry = sameCheck && pending.dispatchedAt !== undefined;
    const dispatch: JudgeDispatchParams = {
      path,
      currentText,
      previousText: pending.baselineText,
      persistedRevision,
      canonicalLength,
      current,
      lastChangedAt: pending.since,
      now,
    };
    // Recorded before the call, and refused rather than sent if it cannot
    // be: a retry whose spend is not durably recorded could be granted again.
    await this.recordDispatch(dispatch, {
      since: pending.since,
      retriedAt: isRetry ? now : undefined,
      mustPersist: true,
    });
    return { kind: 'dispatch', dispatch, isRetry };
  }

  /**
   * The shared tail of a judge dispatch, used by both `evaluate`'s
   * `'call-judge'` branch and `drainDuePendingEdits` — one place for the
   * `[DOS-C3]`/`[D-311]` stale-response guard so the two callers cannot
   * drift apart on it. `lastChangedAt` is separate from `now` because
   * `drainDuePendingEdits` reports the edit's OWN observed time, not the
   * (much later) moment the drain happened to run.
   *
   * `[D-427]`: every caller has already run `recordDispatch` for `params`
   * under the path's lock; this releases that in-flight mark however the
   * call ends. An unexpected failure (a store write) leaves the call's
   * pending record behind, so the next recovery pass is asked to look.
   */
  private async dispatchJudgeAndCommit(
    params: JudgeDispatchParams,
    failureMode: FailureMode,
  ): Promise<DispatchOutcome> {
    try {
      return await this.judgeAndCommit(params, failureMode);
    } catch (error) {
      this.recoveryScanDue = true;
      throw error;
    } finally {
      this.releaseInFlight(params.path);
    }
  }

  private async judgeAndCommit(
    params: JudgeDispatchParams,
    failureMode: FailureMode,
  ): Promise<DispatchOutcome> {
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
    const settled = (result: MaterialityEvaluationResult): DispatchOutcome => ({
      result,
      leftForRetry: false,
    });
    if (this.deps.judge === null) {
      await this.clearOwnPending(params);
      return settled({ kind: 'judge-unavailable' });
    }
    // [DOS-C3]: the "stale response" race guard's FAST PATH — see the
    // `revisions` field doc above. Checked first because it is free (no
    // store I/O) and catches the common case: two dispatches racing on the
    // same still-running `MaterialityTrigger` instance.
    const inMemoryRevision = (this.revisions.get(path) ?? 0) + 1;
    this.revisions.set(path, inMemoryRevision);
    let judged: MaterialityJudgeVerdict;
    try {
      judged = await this.deps.judge.judge({ path, previousText, currentText });
    } catch (error) {
      // Defect 3 (ol-egov.141.89.5.7): an operational failure of the judge
      // call must never be silently dropped. Before this guard, a throw here
      // propagated straight out of `evaluate`/`drainDuePendingEdits` — past
      // `main.ts`'s own try/catch (`evaluateMaterialityChange`), which logs
      // and swallows it, so NEITHER of row 1.4's consumers ever ran and the
      // change was invalidated nowhere. `'judge-unavailable'` is already
      // read as "changed" by both consumers (`observedMaterialChange`,
      // `main.ts`) and by `citation-revision-wiring.ts`'s own arm — the same
      // "grey out, never half-work, never a guess at a verdict" contract an
      // unconfigured judge already gets, extended to one that answered and
      // failed. No store write: the same delta is retried once the judge
      // answers (or a later real edit supersedes it).
      console.error(
        'Olea: materiality judge call failed; treated as unavailable, never a verdict',
        error,
      );
      // `[D-427]` / `[D-400]`: a call nobody has acted on yet keeps its
      // pending record for the one automatic retry, which the next recovery
      // pass sends; a call whose caller reads this result now as
      // `'judge-unavailable'` (and fires both consumers on it) is settled,
      // so its record is cleared.
      if (failureMode === 'leave-for-retry' && this.deps.pendingStore !== undefined) {
        this.recoveryScanDue = true;
        return { result: { kind: 'judge-unavailable' }, leftForRetry: true };
      }
      await this.clearOwnPending(params);
      return settled({ kind: 'judge-unavailable' });
    }
    // `ol-egov.141.89.39`: read `judged` through the Decision contract right
    // where it is obtained — `decisionFromRevisionJudge` needs the judge's
    // OWN settled result, not a value reconstructed later from `verdict`
    // below (which drops the Worker's stamp entirely). Computed here, ahead
    // of the stale-response guards below, and carried into the final
    // `'verdict'` return only — a response the guards below drop was never
    // committed as this path's answer, so it is not reported as one here
    // either (unchanged from `judge-unavailable`'s existing meaning on those
    // paths).
    const decision = decisionFromRevisionJudge(
      { status: 'fulfilled', value: judged },
      {
        seat: 'candidate',
        taskId: MATERIALITY_JUDGE_TASK_ID,
        stamp: readMaterialityJudgeStamp(judged),
        evidenceDigests: [],
      },
    );
    if (this.revisions.get(path) !== inMemoryRevision) {
      // A newer dispatch for this path started while this judge call was in
      // flight, and will persist its own (newer) baseline. This response is
      // older than that call's request: it must never mark the newer
      // content as already processed, so it is dropped entirely — no store
      // write, no verdict, no `onVerdict`.
      //
      // `ol-egov.141.89.5.30`: reported as `'stale-response-dropped'`, never
      // `'judge-unavailable'` — the newer call is the one of record for this
      // path and has already (or will already) commit its own verdict, so
      // `main.ts`'s `observedMaterialChange` must not read this drop as a
      // second, independent change on top of it.
      // `[D-427]`: the newer dispatch replaced this call's pending record
      // with its own, so this clears nothing unless the record is still ours.
      await this.clearOwnPending(params);
      return settled({ kind: 'stale-response-dropped' });
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
      // `ol-egov.141.89.5.30`: same reasoning as the in-memory guard above —
      // a genuinely newer evaluation (this process, or a later one after a
      // restart) already committed its own verdict for this path, so this is
      // a stale drop, never an unanswered `'judge-unavailable'`.
      // `[D-427]`: if the record is still this call's, it is stale with it.
      await this.clearOwnPending(params);
      return settled({ kind: 'stale-response-dropped' });
    }
    // `ol-egov.141.89.5.17`: a free-gate write (debounced/formatting-only/
    // below-floor/no-groundable-content, all in `evaluateUnderLock`) on this
    // SAME path never bumps `revision` -- every one of those `store.save`
    // calls carries `revision: persistedRevision` forward unchanged. Such a
    // write can therefore land between this call's dispatch and this commit
    // without tripping the guard just above, yet it is a REAL, later
    // observation of `lastChangedAt` (every free-gate branch advances it to
    // that call's own `now`). `recordAfterJudge` was just reloaded to check
    // the guard -- reuse it here rather than overwrite its `lastChangedAt`
    // outright: take whichever is later, this call's own capture or
    // whatever is now persisted. When no such write happened, the reloaded
    // record's `lastChangedAt` is this call's own (nothing else touched the
    // path since it was loaded), so the merge is a no-op.
    const mergedLastChangedAt = Math.max(lastChangedAt, recordAfterJudge?.lastChangedAt ?? 0);
    await this.deps.store.save({
      path,
      hashes: current,
      canonicalLength,
      lastChangedAt: mergedLastChangedAt,
      lastVerdictAt: now,
      revision: persistedRevision + 1,
    });
    // Defect 2 (ol-egov.141.89.5.7): this text is now the baseline every
    // later call on this path should chain from, whatever the verdict was.
    this.lastProcessedText.set(path, currentText);
    // `[D-427]`: an edit held back while this call was in flight was waiting
    // against the OLD baseline; it now waits against this committed text —
    // in memory, and on its pending record — so the drain, or a recovery
    // after a restart, judges only what is left. This call's own record is
    // settled: committed first, then cleared.
    this.rebaseHeldEditsOnCommit(path, currentText);
    await this.settlePendingAfterCommit(params);
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
    return settled({ kind: 'verdict', verdict, decision });
  }

  /**
   * A genuine free exit: this raw text becomes the fresher comparison point
   * (defect 2, ol-egov.141.89.5.7), nothing is left held or recorded on the
   * path. Shared by the formatting-only exit and the identical-bytes exit
   * when an edit is still held (ol-egov.141.89.5.82).
   */
  private async settleFreeExit(
    path: string,
    current: MaterialityHashes,
    canonicalLength: number,
    currentText: string,
    now: number,
    record: MaterialityRecord | null,
    persistedRevision: number,
  ): Promise<void> {
    await this.deps.store.save({
      path,
      hashes: current,
      canonicalLength,
      lastChangedAt: now,
      lastVerdictAt: record?.lastVerdictAt ?? null,
      // [D-311]: no judge call dispatched, so the revision is unchanged.
      revision: persistedRevision,
    });
    this.pendingSmallEdit.delete(path);
    this.pendingDebounced.delete(path);
    this.lastProcessedText.set(path, currentText);
    // `[D-427]`: nothing is left unfinished on this path, so no pending record either.
    await this.clearPending(path);
  }

  /** `[D-427]`: true while this instance holds an edit back for `path` or has a call in flight for it. */
  private ownsPath(path: string): boolean {
    return (
      this.pendingSmallEdit.has(path) || this.pendingDebounced.has(path) || this.inFlight.has(path)
    );
  }

  private releaseInFlight(path: string): void {
    const count = (this.inFlight.get(path) ?? 0) - 1;
    if (count > 0) this.inFlight.set(path, count);
    else this.inFlight.delete(path);
  }

  /** `[D-427]`: this path's stored pending record, `null` when none, or when the store cannot be read (logged). */
  private async loadPending(path: string): Promise<MaterialityPendingCheck | null> {
    if (this.deps.pendingStore === undefined) return null;
    try {
      return await this.deps.pendingStore.load(path);
    } catch (error) {
      console.error(
        `Olea: a materiality pending record could not be read (${failureClass(error)})`,
      );
      return null;
    }
  }

  /**
   * `[D-427]`: one write to the pending store. A failure is logged
   * (content-free) and swallowed unless `mustPersist`: losing a record only
   * loses restart protection for that check, never the check itself.
   */
  private async writePending(
    path: string,
    next: (current: MaterialityPendingCheck | null) => MaterialityPendingCheck | null,
    mustPersist = false,
  ): Promise<void> {
    if (this.deps.pendingStore === undefined) return;
    try {
      await this.deps.pendingStore.update(path, next);
    } catch (error) {
      if (mustPersist) throw error;
      console.error(
        `Olea: a materiality pending record could not be written (${failureClass(error)})`,
      );
    }
  }

  private async clearPending(path: string): Promise<void> {
    await this.writePending(path, () => null);
  }

  /**
   * `[D-427]`: records an edit held back by the floor or the debounce window.
   * Without a baseline to compare against there is nothing a restart could
   * finish, so nothing is recorded (and any stale record is cleared). Not
   * rewritten when the stored record already says the same thing.
   */
  private async writeDeferredPending(
    path: string,
    baselineText: string | undefined,
    revision: number,
    since: number,
    waiting: Exclude<MaterialityPendingWait, 'judge'>,
  ): Promise<void> {
    if (baselineText === undefined) {
      await this.clearPending(path);
      return;
    }
    await this.writePending(path, (stored) =>
      stored !== null &&
      stored.waiting === waiting &&
      stored.revision === revision &&
      stored.baselineText === baselineText
        ? stored
        : { path, baselineText, revision, since, waiting },
    );
  }

  /**
   * `[D-427]`: writes `params`' pending record as a dispatched call, then
   * marks the call in flight. Called under the path's lock, immediately
   * before `dispatchJudgeAndCommit`. `mustPersist` (recovery's calls) refuses
   * the call when the record cannot be written, so a retry is never sent
   * without its spend recorded first.
   */
  private async recordDispatch(
    params: JudgeDispatchParams,
    options: {
      readonly since: number;
      readonly retriedAt: number | undefined;
      readonly mustPersist: boolean;
    },
  ): Promise<void> {
    await this.writePending(
      params.path,
      () => ({
        path: params.path,
        baselineText: params.previousText,
        revision: params.persistedRevision,
        since: options.since,
        waiting: 'judge',
        dispatchedHash: params.current.rawHash,
        dispatchedAt: params.now,
        ...(options.retriedAt !== undefined ? { retriedAt: options.retriedAt } : {}),
      }),
      options.mustPersist,
    );
    this.inFlight.set(params.path, (this.inFlight.get(params.path) ?? 0) + 1);
  }

  private static isOwnPending(
    pending: MaterialityPendingCheck,
    params: JudgeDispatchParams,
  ): boolean {
    return (
      pending.waiting === 'judge' &&
      pending.revision === params.persistedRevision &&
      pending.dispatchedHash === params.current.rawHash &&
      pending.dispatchedAt === params.now
    );
  }

  /** `[D-427]`: clears `params`' pending record if it is still this call's own (never a newer call's). */
  private async clearOwnPending(params: JudgeDispatchParams): Promise<void> {
    await this.writePending(params.path, (current) =>
      current !== null && MaterialityTrigger.isOwnPending(current, params) ? null : current,
    );
  }

  /**
   * `[D-427]`: after `params`' answer was committed. Its own record is
   * cleared. A held-back edit recorded against the revision this commit just
   * settled is rebased onto the committed text and the next revision, so a
   * restart still finds it live — or cleared, when the edit turned out to be
   * the committed text itself (`rebaseHeldEditsOnCommit` then dropped it from
   * memory too). Anything else (a newer call's record) is left alone.
   */
  private async settlePendingAfterCommit(params: JudgeDispatchParams): Promise<void> {
    const stillHeld =
      this.pendingSmallEdit.has(params.path) || this.pendingDebounced.has(params.path);
    await this.writePending(params.path, (current) => {
      if (current === null) return null;
      if (MaterialityTrigger.isOwnPending(current, params)) return null;
      if (current.waiting !== 'judge' && current.revision === params.persistedRevision) {
        if (!stillHeld) return null;
        return {
          ...current,
          baselineText: params.currentText,
          revision: params.persistedRevision + 1,
        };
      }
      return current;
    });
  }

  /** `[D-427]`: the in-memory half of `settlePendingAfterCommit`'s rebase. */
  private rebaseHeldEditsOnCommit(path: string, committedText: string): void {
    for (const map of [this.pendingSmallEdit, this.pendingDebounced]) {
      const entry = map.get(path);
      if (entry?.texts === undefined) continue;
      if (entry.texts.currentText === committedText) {
        map.delete(path);
      } else {
        map.set(path, {
          since: entry.since,
          texts: { currentText: entry.texts.currentText, previousText: committedText },
        });
      }
    }
  }
}

/**
 * `[D-293]`'s decision-input shape: the changed regions of a revision, with
 * surrounding context (`olea-core`'s `extractChangedRegions`, this
 * function's own module — `changed-region.ts` — carries the full
 * "why not two whole documents" argument), plus which dependant is asking
 * (`purpose`).
 */
export interface RegionAwareMaterialityRequest {
  readonly path: string;
  readonly purpose: ChangedRegionPurpose;
  readonly regions: readonly ChangedRegion[];
}

export interface BuildRegionAwareMaterialityRequestInput {
  readonly path: string;
  readonly previousText: string;
  readonly currentText: string;
  /** Which dependant is asking — a note's concepts (the file-level trigger), or an instrument's own cited passage (`citation-revision-wiring.ts`). */
  readonly purpose: ChangedRegionPurpose;
  readonly options?: ChangedRegionOptions | undefined;
}

/**
 * Builds `[D-293]`'s target request shape — changed regions with context,
 * plus the asking dependant's purpose — from a revision's previous and
 * current text. Pure; never calls a judge, never reads a store.
 *
 * **Not called from `dispatchJudgeAndCommit` above, and not yet the live
 * judge request.** `dispatchJudgeAndCommit` still sends
 * `this.deps.judge.judge({ path, previousText, currentText })` — the
 * INCUMBENT whole-document shape `MaterialityJudgeInput` (`./types.ts`)
 * declares — because switching the live call is `[ILB-CHG-5]`'s job, not
 * this bead's (`[ILB-CHG-4]`): `[D-293]`'s own close reason reads "approved
 * as proposed on this bead, with the wiring still waiting on the chain's
 * benchmark report (the benchmark-and-wire bead runs the benchmark before
 * it wires anything)," and `docs/dev/intelligence-build/chg.md` §7 names
 * `[ILB-CHG-5]` as the bead that gates on it; §8's own build scope is "the
 * changed-region extractor with context (core)... Then the harness runner"
 * — pure logic first, the switch after the benchmark. It would also need a
 * new `materiality.judge` task version (`olea-service`'s
 * `prompts/materiality.judge/VERSION` is `1.0.0`, a whole-document
 * contract), which this bead has no standing to bump unprompted.
 *
 * This function exists so that benchmark has something concrete to score:
 * `chg.md` §8's "prepare renders the incumbent request and the target
 * request" — this is the target-request half, for `scripts/harness/ilb-chg/`
 * (a different lane's owns) to call once it runs. See this bead's close
 * notes for the before/after token-count estimate measured against a
 * fixture.
 */
export function buildRegionAwareMaterialityRequest(
  input: BuildRegionAwareMaterialityRequestInput,
): RegionAwareMaterialityRequest {
  return {
    path: input.path,
    purpose: input.purpose,
    regions: extractChangedRegions({
      previousText: input.previousText,
      currentText: input.currentText,
      options: input.options,
    }),
  };
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
  /** `[D-427]`: see `MaterialityTriggerDeps.readCurrentText`. Without it, pending records are kept but never recovered. */
  readonly readCurrentText?: ((path: string) => Promise<string | null>) | undefined;
  /** See `MaterialityTriggerDeps.isOnline`. */
  readonly isOnline?: (() => boolean) | undefined;
}

export function buildMaterialityWiring(deps: MaterialityWiringDeps): MaterialityTrigger {
  const store = new ObsidianMaterialityHashStore(deps.dataHost);
  return new MaterialityTrigger({
    store,
    clock: deps.clock,
    judge: deps.judge,
    constants: deps.constants,
    onVerdict: deps.onVerdict,
    // `[D-427]`: the pending records live in the same local `data.json`, under their own key.
    pendingStore: new ObsidianMaterialityPendingStore(deps.dataHost),
    readCurrentText: deps.readCurrentText,
    isOnline: deps.isOnline,
  });
}
