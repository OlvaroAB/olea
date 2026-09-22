/**
 * `[JEV-6]` (`ol-3ux7.89`) — the real-population case capture for Stage J1.
 *
 * **What it is for.** `olea-service/findings/jev-j1-preregistration.md` §3.3
 * needs 100 held-out cases drawn from the real operating population:
 * requests that actually reached the grounding judge from instrument
 * drafting, sampled uniformly at random from a capture window with a
 * recorded seed. Nothing captured them, and §10 of that document says
 * plainly what the study loses without them — no real-population part, no
 * gate-level figure at all. This module is that capture.
 *
 * ## Pointers, never passages
 *
 * **David's ruling, 2026-09-22.** On her machine this record holds the query
 * and a reference to which notes and which blocks were retrieved. **No
 * passage text is written here at any point.** The contexts are
 * reconstructed later, inside the private service repo, against the vault
 * snapshot that is already tracked and consented there — see
 * `./judge-case-reconstruction.ts`, which is the other half and is
 * deliberately a separate, pure module with no storage of its own.
 *
 * That is not a promise this module makes about its own behaviour; it is a
 * property of the type it is handed. `JudgeRequestRecord` (`olea-core`,
 * `retrieval/groundedContext.ts`) carries `refs: readonly GroundedChunkRef[]`
 * and `GroundedChunkRef` is `GroundedChunk` **with the text field removed**,
 * so there is no field a passage could arrive in. A reviewer checks the
 * claim by reading one interface rather than by auditing every write below.
 *
 * **The query is the honest asymmetry, and it is not hidden.** The query is
 * stored verbatim, because §2 of the pre-registration holds it byte-identical
 * across the three arms and — unlike a passage — it is not a span of any one
 * note, so no pointer reconstructs it. So this record does carry her words,
 * in one field, by necessity. It travels only into `.olea-harness/jev-j1/`,
 * which is home four on `CLAUDE.md`'s sanctioned-homes list, and the
 * reasoning is recorded beside the study at
 * `olea-service/.olea-harness/jev-j1/real-case-capture-permission-note.md`
 * rather than only here.
 *
 * ## Off by default, and no surface she can see
 *
 * `loadJudgeCaseCaptureConfig` returns `null` for an absent key, a malformed
 * key, and an `enabled` that is anything other than the boolean `true`.
 * There is no default that turns this on and no code path that writes the
 * config key, so enabling it is a hand-edit of `data.json` and nothing else
 * — which is what David ruled, and it is why this file registers no command,
 * adds no setting and touches nothing she can see. Adding any affordance she
 * could see is a stop, not a follow-up.
 *
 * ## Bounded three ways
 *
 * A `cap` on cases held (enforced by the reservoir below, so it is a hard
 * ceiling rather than a check someone remembers), an optional
 * `maxDurationMs` after which the window closes and every later request is
 * ignored, and `clear()`, which deletes everything captured in one call.
 *
 * ## The draw is the capture
 *
 * The pre-registration asks for a uniform random sample with a recorded
 * seed. Keeping the first `cap` cases and sampling afterwards would not be
 * that: it samples the start of the window, and her sessions are not
 * exchangeable across a window. So the capture IS the draw — **reservoir
 * sampling (Vitter's algorithm R)**, which holds a uniform sample of the
 * whole observed sequence at every moment, using a seeded generator.
 *
 * The generator is keyed on `(seed, observedIndex)` rather than being a
 * running stream, for one specific reason: the stream's state would have to
 * survive being persisted, reloaded and interleaved with application
 * restarts, and a reproducibility claim that depends on session boundaries
 * is not reproducible. Keyed this way, replaying the same observation
 * sequence under the same seed yields the same held set on any machine, in
 * any number of sessions — which is what "reproducible from the seed" has to
 * mean for it to be worth recording.
 *
 * ## Failing to capture can never change what she is shown
 *
 * `observe()` never throws, and the seam it is wired to swallows throws
 * anyway (`resolveGroundedContext`'s `onJudgeRequest`, the same fail-open
 * posture `onStage` already takes). Both halves are deliberate: the seam's
 * catch is what makes the property true for ANY recorder, and this module's
 * own catch is what keeps a fault here from being invisible to its own
 * tests. Persistence is fire-and-forget by the same argument as
 * `./gate-stage-store.ts` — a disk error degrades to "this session's cases
 * stayed in memory", never to a failed draft.
 */

import type { GroundedChunkRef, JudgeRequestRecord } from 'olea-core';
import type { ObsidianDataHost } from '../plan/settings-store.js';
import type { AtomicDataHost } from './gate-stage-store.js';

export const JUDGE_CASE_CAPTURE_STORAGE_KEY = 'jevJudgeCaseCapture';
/** Hand-edited, never written by this plugin — see the module doc. */
export const JUDGE_CASE_CAPTURE_CONFIG_KEY = 'jevJudgeCaseCaptureConfig';

/** Hard ceiling on `cap`, so a mistyped config cannot grow `data.json` without bound. */
export const MAX_JUDGE_CASE_CAP = 1000;

const INTENDED_OPERATIONS = ['define', 'explain', 'calculate', 'apply', 'compare'] as const;
type IntendedOperation = (typeof INTENDED_OPERATIONS)[number];

/**
 * One captured case. Deliberately the smallest record the study can be run
 * from: there is no verdict, no score, no band signal, no note title and no
 * concept key here. A note reference is still information about her, so the
 * record carries what §3.3 needs to reconstruct a case and stops.
 */
export interface CapturedJudgeCase {
  /** Opaque and window-local (`case-0001`). Assigned from the observation counter, never derived from anything of hers. */
  readonly caseId: string;
  /** Its 0-based position in the observation sequence — what makes the reservoir replayable (see module doc). */
  readonly observedIndex: number;
  readonly capturedAt: string;
  /** Verbatim, by necessity — see the module doc's asymmetry note. */
  readonly query: string;
  /** In assembly order, which is what makes the reconstructed context byte-identical. */
  readonly refs: readonly GroundedChunkRef[];
  readonly intendedOperation?: IntendedOperation;
}

export interface PersistedJudgeCaseCapture {
  readonly version: 1;
  /** The recorded seed the pre-registration requires. */
  readonly seed: number;
  readonly cap: number;
  /** Set once, on the first observation ever recorded, and carried forward unchanged afterwards. */
  readonly windowStartedAt: string;
  readonly lastObservedAt: string;
  /** ISO timestamp the window closed on `maxDurationMs`, or `null` while it is open. */
  readonly windowClosedAt: string | null;
  /** Every request seen in the window, including ones the reservoir did not keep. The sampling frame, without which the held set is a sample of nothing stated. */
  readonly observedCount: number;
  readonly cases: readonly CapturedJudgeCase[];
}

export interface JudgeCaseCaptureConfig {
  readonly enabled: true;
  readonly seed: number;
  readonly cap: number;
  /** Absent means the window is bounded by `cap` and by `clear()` alone. */
  readonly maxDurationMs?: number;
}

/**
 * A deterministic generator keyed on `(seed, index)` — see the module doc for
 * why this is keyed rather than streaming. Any well-mixed integer hash does;
 * this is the widely-used `mulberry32` finaliser applied to `seed + index`
 * mixed by a 32-bit odd constant, which is adequate for a sampling draw and
 * carries no distributional claim beyond that.
 */
function keyedUnitRandom(seed: number, index: number): number {
  let t = (Math.imul(seed | 0, 0x9e3779b1) + Math.imul(index | 0, 0x85ebca6b)) | 0;
  t = (t + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

function isIntendedOperation(value: unknown): value is IntendedOperation {
  return INTENDED_OPERATIONS.includes(value as IntendedOperation);
}

function isChunkRef(value: unknown): value is GroundedChunkRef {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.path === 'string' && typeof c.blockIndex === 'number' && Number.isInteger(c.blockIndex)
  );
}

function isCapturedCase(value: unknown): value is CapturedJudgeCase {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.caseId !== 'string') return false;
  if (typeof c.observedIndex !== 'number' || !Number.isInteger(c.observedIndex)) return false;
  if (typeof c.capturedAt !== 'string') return false;
  if (typeof c.query !== 'string') return false;
  if (c.intendedOperation !== undefined && !isIntendedOperation(c.intendedOperation)) return false;
  return Array.isArray(c.refs) && c.refs.every(isChunkRef);
}

export function isPersistedJudgeCaseCapture(value: unknown): value is PersistedJudgeCaseCapture {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c.version !== 1) return false;
  if (typeof c.seed !== 'number' || !Number.isInteger(c.seed)) return false;
  if (typeof c.cap !== 'number' || !Number.isInteger(c.cap) || c.cap <= 0) return false;
  if (typeof c.windowStartedAt !== 'string') return false;
  if (typeof c.lastObservedAt !== 'string') return false;
  if (c.windowClosedAt !== null && typeof c.windowClosedAt !== 'string') return false;
  if (
    typeof c.observedCount !== 'number' ||
    !Number.isInteger(c.observedCount) ||
    c.observedCount < 0
  ) {
    return false;
  }
  return Array.isArray(c.cases) && c.cases.every(isCapturedCase);
}

/**
 * Reads the hand-edited config key. **Returns `null` for every way of not
 * being deliberately switched on** — key absent, not an object, `enabled`
 * not exactly `true`, seed or cap missing or not a positive integer. There
 * is no partial-default path: a half-written config does not capture
 * anything, because the alternative is capturing her material under a
 * setting nobody meant to write.
 */
export function loadJudgeCaseCaptureConfig(blob: unknown): JudgeCaseCaptureConfig | null {
  if (typeof blob !== 'object' || blob === null) return null;
  const candidate = (blob as Record<string, unknown>)[JUDGE_CASE_CAPTURE_CONFIG_KEY];
  if (typeof candidate !== 'object' || candidate === null) return null;
  const c = candidate as Record<string, unknown>;
  if (c.enabled !== true) return null;
  if (typeof c.seed !== 'number' || !Number.isInteger(c.seed)) return null;
  if (typeof c.cap !== 'number' || !Number.isInteger(c.cap) || c.cap <= 0) return null;
  const cap = Math.min(c.cap, MAX_JUDGE_CASE_CAP);
  const duration = c.maxDurationMs;
  if (duration !== undefined && (typeof duration !== 'number' || !(duration > 0))) return null;
  return {
    enabled: true,
    seed: c.seed,
    cap,
    ...(typeof duration === 'number' ? { maxDurationMs: duration } : {}),
  };
}

/**
 * The in-memory half. Holds the reservoir, counts the frame, and closes the
 * window. Knows nothing about `data.json` — `ObsidianJudgeCaseCaptureStore`
 * below does that, the same split the gate-stage pair uses.
 */
export class JudgeCaseCaptureRecorder {
  private cases: CapturedJudgeCase[] = [];
  private observedCount = 0;
  private windowStartedAt: string | null = null;
  private lastObservedAt: string | null = null;
  private windowClosedAt: string | null = null;
  private stopped = false;

  constructor(private readonly config: JudgeCaseCaptureConfig) {}

  /** Re-seeds from a persisted window so a restart continues one window rather than starting a fresh one. */
  seed(persisted: PersistedJudgeCaseCapture | null): void {
    if (persisted === null) return;
    this.cases = [...persisted.cases];
    this.observedCount = persisted.observedCount;
    this.windowStartedAt = persisted.windowStartedAt;
    this.lastObservedAt = persisted.lastObservedAt;
    this.windowClosedAt = persisted.windowClosedAt;
  }

  /**
   * Records one request that reached the judge. **Never throws** — see the
   * module doc. Returns `true` when this call changed the held set, purely
   * so a caller can decide whether a save is worth doing; nothing about the
   * gate depends on the value.
   */
  observe(record: JudgeRequestRecord, nowIso: string): boolean {
    try {
      return this.observeUnsafe(record, nowIso);
    } catch {
      return false;
    }
  }

  private observeUnsafe(record: JudgeRequestRecord, nowIso: string): boolean {
    if (this.stopped || this.windowClosedAt !== null) return false;
    const now = Date.parse(nowIso);
    if (this.windowStartedAt === null) {
      this.windowStartedAt = nowIso;
    } else if (this.config.maxDurationMs !== undefined) {
      const started = Date.parse(this.windowStartedAt);
      if (
        Number.isFinite(started) &&
        Number.isFinite(now) &&
        now - started > this.config.maxDurationMs
      ) {
        // The window is bounded in time as well as in size. Closing it here,
        // on the first request past the bound, is what makes the bound real
        // without a timer that could fire while nothing is happening.
        this.windowClosedAt = nowIso;
        return false;
      }
    }

    const observedIndex = this.observedCount;
    this.observedCount = observedIndex + 1;
    this.lastObservedAt = nowIso;

    const captured: CapturedJudgeCase = {
      caseId: `case-${String(observedIndex + 1).padStart(4, '0')}`,
      observedIndex,
      capturedAt: nowIso,
      query: record.query,
      refs: record.refs.map((ref) => ({ path: ref.path, blockIndex: ref.blockIndex })),
      ...(record.intendedOperation !== undefined
        ? { intendedOperation: record.intendedOperation }
        : {}),
    };

    // Algorithm R. Below the cap everything is held; at or above it, the new
    // case displaces an existing one with probability cap/(i+1), which is
    // exactly what keeps the held set a uniform sample of everything seen.
    if (this.cases.length < this.config.cap) {
      this.cases.push(captured);
      return true;
    }
    const j = Math.floor(keyedUnitRandom(this.config.seed, observedIndex) * (observedIndex + 1));
    if (j < this.config.cap) {
      this.cases[j] = captured;
      return true;
    }
    return false;
  }

  /** The single obvious way to stop: later requests are ignored, and what is held stays held until `clear()`. */
  stop(nowIso: string): void {
    this.stopped = true;
    if (this.windowClosedAt === null) this.windowClosedAt = nowIso;
  }

  snapshot(): PersistedJudgeCaseCapture | null {
    if (this.windowStartedAt === null || this.lastObservedAt === null) return null;
    return {
      version: 1,
      seed: this.config.seed,
      cap: this.config.cap,
      windowStartedAt: this.windowStartedAt,
      lastObservedAt: this.lastObservedAt,
      windowClosedAt: this.windowClosedAt,
      observedCount: this.observedCount,
      cases: [...this.cases],
    };
  }
}

function hasReadModifyWrite(host: ObsidianDataHost): host is AtomicDataHost {
  return typeof (host as Partial<AtomicDataHost>).readModifyWrite === 'function';
}

/**
 * Persistence, modelled on `./gate-stage-store.ts` down to the atomic-host
 * fallback, for the same reason it gives: `data.json` has many independent
 * writers and a bare load-then-save interleaves with them.
 */
export class ObsidianJudgeCaseCaptureStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns `null` — never throws — when nothing usable is stored yet. */
  async load(): Promise<PersistedJudgeCaseCapture | null> {
    const blob = await this.host.loadData().catch(() => null);
    if (typeof blob !== 'object' || blob === null) return null;
    const candidate = (blob as Record<string, unknown>)[JUDGE_CASE_CAPTURE_STORAGE_KEY];
    return isPersistedJudgeCaseCapture(candidate) ? candidate : null;
  }

  async loadConfig(): Promise<JudgeCaseCaptureConfig | null> {
    const blob = await this.host.loadData().catch(() => null);
    return loadJudgeCaseCaptureConfig(blob);
  }

  async save(snapshot: PersistedJudgeCaseCapture): Promise<void> {
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      blob[JUDGE_CASE_CAPTURE_STORAGE_KEY] = snapshot;
      return blob;
    };
    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(merge);
      return;
    }
    const existing = await this.host.loadData().catch(() => null);
    await this.host.saveData(merge(existing));
  }

  /**
   * Deletes everything captured, in one call — the "single obvious way to
   * delete" the brief requires. It removes the capture key and **leaves the
   * config key alone**: deleting the data is a different act from turning
   * the capture off, and a `clear()` that silently also disabled would make
   * "I cleared it" and "I stopped it" indistinguishable afterwards.
   */
  async clear(): Promise<void> {
    const existing = await this.host.loadData().catch(() => null);
    if (typeof existing !== 'object' || existing === null) return;
    const blob = { ...(existing as Record<string, unknown>) };
    delete blob[JUDGE_CASE_CAPTURE_STORAGE_KEY];
    await this.host.saveData(blob);
  }
}
