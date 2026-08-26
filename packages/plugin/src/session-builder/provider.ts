/**
 * `createLocalSessionBuilderProvider` — the production `SessionBuilderViewDeps`
 * (`ol-p5t06b` [P5-T06b], F4.6/F4.7/F4.8; SESS-2/`ol-4a78` for the composition
 * layer below).
 *
 * The gap view's twin, one layer on. `gap/provider.ts` composes the oracle
 * chain into a `GapViewModel`; this composes the same chain and then hands it
 * to `buildComposedStudySession` (`study-session/compose.ts`), which decides
 * which concepts are eligible and in what order (obligation class,
 * cross-course allocation, F2.18 blocking) before selecting a time-bounded
 * prefix of it. The four extra things it needs, and where each comes from:
 *
 *  - **the instruments themselves** — `enumerateVaultInstruments`, which
 *    `gap/provider.ts` already walks for its per-note counts. Here the records
 *    are indexed by concept (`buildConceptInstrumentIndex`) instead of counted
 *    by note.
 *  - **the assessments** — `composeOracleRanking`'s own
 *    `edges.assessmentsRead.records`, passed through unmodified. This is what
 *    turns `GapRow.targetAssessmentPath` into a date, which is F4.7's countdown.
 *  - **her review history** — already read here for the mastery join, and now
 *    read for two new things: `durationMs`, and a `Scheduler` replay
 *    (`replaySchedulerStates`) that SESS-2's obligation classifier reads for
 *    each concept's last-retrieved day and FSRS due day. The plugin has been
 *    writing `durationMs` since `review/session.ts` landed and nothing has
 *    ever read it (`study-session/duration.ts`'s module doc) — this is its
 *    first production reader.
 *
 * ## The history window, and why the durations use a longer one
 *
 * `gap/provider.ts` probes `SCHEDULING_HISTORY_PROBE_DAYS` of review-log files
 * because that is the window scheduling state needs. Duration estimates want as
 * much history as is cheaply available and are indifferent to its recency — the
 * question is "how long does a cloze take her", not "what is due". They are
 * computed from the same `readReviewLogHistory` result rather than from a
 * second, wider read: a second walk of the log for a cold-start estimate would
 * pay real I/O for a number that is about to be superseded by the first few
 * days of use anyway. Named here rather than left for someone to discover —
 * with a short probe window the model reads `'assumed'` for longer than it
 * strictly must, and the surface says so.
 *
 * ## No cache, for the reason `gap/provider.ts` gives
 *
 * `load()` recomputes on every call. Caching the model would be a new persisted
 * blob with nothing in the contract naming it — a Class C stop (C6; D-002,
 * D-004, D-005 and D-008 already decide every case where the convenience
 * tempts).
 */

import type {
  CalendarDay,
  ConceptMaterialPresence,
  Scheduler,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  allGapRows,
  buildComposedStudySession,
  buildConceptInstrumentIndex,
  buildGapView,
  buildMaterialPresence,
  calendarDaysEndingOn,
  composeOracleRanking,
  enumerateVaultInstruments,
  estimateInstrumentDurations,
  readReviewLogHistory,
  replaySchedulerStates,
  reviewLogPath,
} from 'olea-core';
import {
  isStudyPlanConfigured,
  type ObsidianDataHost,
  ObsidianStudyPlanSettingsStore,
} from '../plan/settings-store.js';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import type { SessionBuilderRequest, SessionBuilderState, SessionBuilderViewDeps } from './view.js';

export interface CreateLocalSessionBuilderProviderDeps {
  readonly vault: VaultSource;
  /** Names this device's own review-log files for the probe — same discipline as `gap/provider.ts` (C5.2). */
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /**
   * The same `Scheduler` `main.ts` builds once for the Today panel's replay
   * — "one `Scheduler`... is what makes that literally the same computation
   * rather than two that match" (`main.ts`'s own module doc). SESS-2's
   * obligation classifier replays the log through it to read each concept's
   * last-retrieved day and FSRS due day.
   */
  readonly scheduler: Scheduler;
  readonly probeDays?: number;
}

/** `buildMaterialPresence`'s second argument — a tally of instruments per note. Identical to `gap/provider.ts`'s, because it is the same question. */
function instrumentCountsByNotePath(
  records: readonly { readonly notePath: VaultPath }[],
): ReadonlyMap<VaultPath, number> {
  const counts = new Map<VaultPath, number>();
  for (const record of records) {
    counts.set(record.notePath, (counts.get(record.notePath) ?? 0) + 1);
  }
  return counts;
}

/**
 * ARRIVE-2 (`ol-epi9`): each concept's arrival day — the local calendar day
 * of the EARLIEST `firstSeen` across its notes — keyed by `conceptKey`, for
 * `buildComposedStudySession`'s `arrivalDays` input. `firstSeen` is optional
 * on `VaultSource`, and a host that cannot say (or a fake without the
 * accessor) yields an absent entry, which `classifyObligation` treats as the
 * pre-ARRIVE-1 `overdueDays: 0` — never Infinity. Local zone deliberately
 * (`localToday`'s own doc): the question is the day the file appeared on the
 * device she works at.
 */
async function arrivalDaysByConceptKey(
  vault: VaultSource,
  rows: readonly { readonly conceptKey: string; readonly notePaths: readonly VaultPath[] }[],
): Promise<ReadonlyMap<string, CalendarDay>> {
  const firstSeen = vault.firstSeen?.bind(vault);
  if (firstSeen === undefined) return new Map();

  const days = new Map<string, CalendarDay>();
  await Promise.all(
    rows.map(async (row) => {
      const stats = await Promise.all(row.notePaths.map((path) => firstSeen(path)));
      const known = stats.filter((ms): ms is number => ms !== null);
      if (known.length === 0) return;
      days.set(row.conceptKey, localToday(new Date(Math.min(...known))));
    }),
  );
  return days;
}

/**
 * A `SessionBuilderViewDeps` whose `load` composes a fresh session from the
 * vault and the review log, entirely on-device, no Worker call.
 */
export function createLocalSessionBuilderProvider(
  deps: CreateLocalSessionBuilderProviderDeps,
): SessionBuilderViewDeps {
  const settingsStore = new ObsidianStudyPlanSettingsStore(deps.settingsHost);

  return {
    async load(request: SessionBuilderRequest): Promise<SessionBuilderState> {
      try {
        const config = await settingsStore.load();
        if (!isStudyPlanConfigured(config)) return { kind: 'unavailable' };

        const now = deps.now();
        const today = localToday(now);
        const probeDays = deps.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
        const additionalPaths = calendarDaysEndingOn(today, probeDays).map((day) =>
          reviewLogPath(day, deps.deviceId),
        );

        // Neither walk depends on the other's result and both read the same
        // read-only vault — the same concurrency `gap/provider.ts` uses, for
        // the same reason.
        const [{ entries }, enumeration] = await Promise.all([
          readReviewLogHistory(deps.vault, { additionalPaths }),
          enumerateVaultInstruments(deps.vault),
        ]);

        const { ranking, edges, mastery } = await composeOracleRanking({
          vault: deps.vault,
          basePath: config.assignmentsBasePath,
          reviewLog: entries,
          asOf: today,
          // The name→opaque-key source for `ConceptAssessmentEdge.conceptKey`
          // (`ol-63e1`) — already extracted by the instrument walk above, so
          // this pays no second walk.
          concepts: enumeration.concepts,
          // `[D-087]`/`ol-95vv.1` (RANK-3, `ol-v7r5.4`): the first production
          // caller to thread real FSRS retrievability into the blend.
          // `deps.scheduler` and `now` are both already held above for the
          // SESS-2 replay at `replaySchedulerStates(entries, deps.scheduler)`
          // below — the same scheduler, the same instant, never a second
          // instance or a fresh clock read (`ComposeRetrievabilityInput`'s own
          // doc, `oracle/compose.ts`).
          retrievability: { scheduler: deps.scheduler, now },
        });

        const materialPresence: ReadonlyMap<string, ConceptMaterialPresence> =
          buildMaterialPresence(
            enumeration.concepts,
            instrumentCountsByNotePath(enumeration.records),
          );

        const gap = buildGapView({
          ranking,
          assessments: edges.assessmentsRead.records,
          mastery,
          materialPresence,
          sourceCoverage: edges.tier3.sourceCoverage,
        });

        // SESS-2 (`ol-4a78`): the same replay `main.ts`'s Today panel builds
        // its due-state from, over the same `entries` this call already read
        // for the mastery join — a second fold over data already in hand,
        // never a second read of the vault.
        const replay = replaySchedulerStates(entries, deps.scheduler);

        // `composed.overflow`/`courseShares`/`forcedCourses` are deliberately
        // dropped here rather than threaded into `SessionBuilderState`: F6.7
        // forbids a standing counter of unmet material, and nothing on this
        // surface has a clause authorising one (`study-session/compose.ts`'s
        // module doc).
        // ARRIVE-2 (`ol-epi9`): resolved here, after the gap view names the
        // rows, so only concepts actually in play cost a stat call.
        const gapRows = allGapRows(gap);
        const arrivalDays = await arrivalDaysByConceptKey(deps.vault, gapRows);

        const composed = buildComposedStudySession({
          rows: gapRows,
          arrivalDays,
          instruments: buildConceptInstrumentIndex(enumeration.records),
          replay,
          budgetMinutes: request.budgetMinutes,
          // The first production read of the review log's `durationMs` (INV-4:
          // the discipline went in ahead of the feature, and this is the
          // feature).
          durations: estimateInstrumentDurations(entries),
          asOf: today,
          // Unmodified — the countdown (F4.7) is only as honest as this
          // pass-through, and re-reading the Base separately would let the
          // ranking and the countdown disagree about the same assessment.
          assessments: edges.assessmentsRead.records,
          ...(request.focusConceptName !== undefined
            ? { focusConceptName: request.focusConceptName }
            : {}),
        });

        return { kind: 'model', model: composed.model };
      } catch (error) {
        console.error('Olea: could not build a study session', error);
        return { kind: 'unavailable' };
      }
    },
  };
}
