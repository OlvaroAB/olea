/**
 * `ObsidianGateStageStore` — persists `[JEV-11]`'s (`ol-3ux7.96`) gate-stage
 * counts across desktop sessions, so the judge-consulted share can be read
 * over a real collection period rather than one session's worth of it.
 *
 * **Why this exists.** A per-session, in-memory-only `GateStageRecorder`
 * (`olea-core`) answers nothing about a share once she restarts the
 * application, which she does routinely inside any real collection window —
 * a single console read would sample one session and be reported as though
 * it covered the whole window, exactly the quietly-wrong number the
 * pre-registration exists to prevent. This store is the missing
 * persistence, following the same shape two sibling stores already use for
 * the identical reason (no event-sourced home in `olea-core`, and this bead
 * owns neither `packages/contracts` nor `packages/core/src/review-log/`):
 * `../grove/ground-streak-store.ts`'s `ObsidianGroveGroundStreakStore` (an
 * integer count keyed by concept, `data.json` read-modify-write, replace on
 * save) and `../plan/settings-store.ts`'s `ObsidianStudyPlanSettingsStore`
 * (the `ObsidianDataHost` port itself, defined there and reused verbatim
 * here rather than redeclared).
 *
 * **Never her content (INV-6, D-005, `[JEV-11]`).** The only values this
 * store ever holds are integer counts keyed by a fixed `GateStage` name and
 * two ISO timestamps. There is no query, no path, no concept key, nothing
 * derived from her vault — `data.json` is plugin configuration under
 * `.obsidian/plugins/<id>/`, never a vault note, and this key inside it
 * carries even less than the ground-streak key beside it (that one at least
 * names a concept; this one does not).
 *
 * **The period, and what resets it.** `periodStartedAt` is set once, the
 * first time this store is ever written, and never rewritten afterward by
 * this module — every subsequent save carries it forward unchanged, only
 * updating `counts` and `lastRecordedAt`. Nothing in production code resets
 * it: the count accumulates across every session indefinitely. The only
 * things that reset it are outside this module's control — her clearing
 * `data.json`, uninstalling and reinstalling the plugin, or a future,
 * deliberately-built developer action — never a silent timer or an
 * automatic rollover. `clear()` exists for exactly that "deliberate developer
 * action" case and is never called from production wiring.
 *
 * **Failing to read or write must never touch the gate's own decision** —
 * same posture `groundedContext.ts`'s `onStage` already takes toward a
 * throwing callback. `load` never throws (empty period on any trouble);
 * `save` is meant to be called fire-and-forget from `main.ts`, and a
 * rejected save is caught there, not here, so a disk error degrades to
 * "this session's counts stay in memory only" rather than to a failed draft.
 */

import type { GateStage, GateStageSummary } from 'olea-core';
import type { ObsidianDataHost } from '../plan/settings-store.js';

/**
 * The host `save()` actually needs to be RACE-FREE against every other
 * writer of the same `data.json` — `readModifyWrite`
 * (`./serializing-data-host.ts`) makes the whole load-then-merge-then-save
 * ONE atomic queue entry, closing the two-call interleaving
 * `ObsidianDataHost` alone cannot (see that module's doc). Optional so this
 * store still works, honestly non-atomically, with a bare `ObsidianDataHost`
 * (every existing test, and any future caller that has not wired the
 * atomic host) — `save()` below falls back to the plain two-call sequence
 * when it is absent.
 */
export interface AtomicDataHost extends ObsidianDataHost {
  readModifyWrite(mutate: (current: unknown) => unknown | Promise<unknown>): Promise<void>;
}

function hasReadModifyWrite(host: ObsidianDataHost): host is AtomicDataHost {
  return typeof (host as Partial<AtomicDataHost>).readModifyWrite === 'function';
}

export const GATE_STAGE_STORAGE_KEY = 'gateStagePeriod';

const ALL_STAGES: readonly GateStage[] = [
  'no-hits',
  'composite-unavailable',
  'composite-veto',
  'below-band',
  'above-band',
  'relevance-empty',
  'escalated-to-judge',
];

export interface PersistedGateStagePeriod {
  readonly version: 1;
  /** ISO timestamp of the first stage this store ever recorded — the period's start, set once and carried forward on every later save. */
  readonly periodStartedAt: string;
  /** ISO timestamp of the most recent stage recorded. */
  readonly lastRecordedAt: string;
  /** Counts only, keyed by a fixed `GateStage` name — see module doc. */
  readonly counts: Readonly<Record<GateStage, number>>;
}

/** `GateStageSummary` plus the period bounds a reader needs to say what window a share covers, rather than guessing (`[JEV-11]` requirement 1). */
export interface GateStagePeriodSummary extends GateStageSummary {
  /** `null` only when nothing has ever been recorded in this store. */
  readonly periodStartedAt: string | null;
  readonly lastRecordedAt: string | null;
}

function isPersistedGateStagePeriod(value: unknown): value is PersistedGateStagePeriod {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return false;
  if (typeof candidate.periodStartedAt !== 'string') return false;
  if (typeof candidate.lastRecordedAt !== 'string') return false;
  if (typeof candidate.counts !== 'object' || candidate.counts === null) return false;
  const counts = candidate.counts as Record<string, unknown>;
  return ALL_STAGES.every(
    (stage) => typeof counts[stage] === 'number' && Number.isInteger(counts[stage]) && (counts[stage] as number) >= 0,
  );
}

function zeroCounts(): Record<GateStage, number> {
  return Object.fromEntries(ALL_STAGES.map((s) => [s, 0])) as Record<GateStage, number>;
}

export class ObsidianGateStageStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns `null` — never throws — when nothing usable is stored yet. */
  async load(): Promise<PersistedGateStagePeriod | null> {
    const blob = await this.host.loadData().catch(() => null);
    if (typeof blob !== 'object' || blob === null) return null;
    const candidate = (blob as Record<string, unknown>)[GATE_STAGE_STORAGE_KEY];
    if (!isPersistedGateStagePeriod(candidate)) return null;
    return candidate;
  }

  /**
   * Merges `counts` into whatever period is already persisted: `counts`
   * REPLACES the stored counts wholesale (the caller already holds the
   * authoritative running total via `GateStageRecorder.summary()`, seeded
   * from this same store at load — see `main.ts` — so there is nothing to
   * add on top of, unlike a merge). `periodStartedAt` is read from the
   * existing record when one exists and left untouched; only a genuinely
   * first-ever save sets it to `now`.
   *
   * **Atomic when `this.host` supports it, non-atomic otherwise.** See
   * `AtomicDataHost`'s own doc for exactly what that difference means —
   * `main.ts` wires this store with a host that supports it, so production
   * gets the atomic path; a bare `ObsidianDataHost` (every test here, and
   * any other caller) still works, honestly reproducing the same
   * read-then-write race this module's own doc names.
   */
  async save(counts: Readonly<Record<GateStage, number>>, now: string): Promise<void> {
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      const priorCandidate = blob[GATE_STAGE_STORAGE_KEY];
      const periodStartedAt = isPersistedGateStagePeriod(priorCandidate)
        ? priorCandidate.periodStartedAt
        : now;
      const value: PersistedGateStagePeriod = {
        version: 1,
        periodStartedAt,
        lastRecordedAt: now,
        counts,
      };
      blob[GATE_STAGE_STORAGE_KEY] = value;
      return blob;
    };

    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(merge);
      return;
    }
    const existing = await this.host.loadData().catch(() => null);
    await this.host.saveData(merge(existing));
  }

  /** Deliberate developer action only (see module doc) — never called from production wiring. */
  async clear(): Promise<void> {
    const existing = await this.host.loadData().catch(() => null);
    if (typeof existing !== 'object' || existing === null) return;
    const blob = { ...(existing as Record<string, unknown>) };
    delete blob[GATE_STAGE_STORAGE_KEY];
    await this.host.saveData(blob);
  }
}

/** `zeroCounts` exported for the seed case (`main.ts`, nothing persisted yet). */
export { zeroCounts as zeroGateStageCounts };
