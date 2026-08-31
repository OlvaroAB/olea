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
 * ## F2.19's two resolvers (`ol-v7r5.11`), closing `ol-v7r5.10`'s two named gaps
 *
 * `study-session/compose.ts`'s within-block grouping seam reads two
 * caller-resolved, optional maps; this is where both are built, from data
 * this `load()` already has in hand:
 *
 *  - **`relatedConceptKeys`** — `concept/related-concept-keys.ts`'s
 *    `resolveRelatedConceptKeys`, joining `deps.relations`' name-keyed
 *    `ConceptRelation`s (the same served fold `main.ts`'s
 *    `servedRelationEdges()` already hands to `composeReviewSession` and the
 *    Today panel's instrument source, `[D-070]`'s abstention gate applied)
 *    against `enumeration.concepts` — the same `ConceptRecord[]` this call
 *    already extracts for `composeOracleRanking`'s own name→key join
 *    (`ol-63e1`), so this pays no second extraction pass.
 *  - **`assessmentContext`** — `assessment/scope-concept-keys.ts`'s
 *    `resolveAssessmentGroupingContext`, over the identical
 *    `edges.assessmentsRead.records` already read above for F4.7's countdown
 *    and the same `enumeration.concepts`.
 *
 * Both resolvers are pure and their misses are honest-but-silent by design
 * (see each module's own doc) — nothing here surfaces the miss counts, since
 * no clause names a surface for them; a future caller wanting them reads the
 * resolvers' own return values directly.
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
 *
 * ## F6.6 — re-entry composition after an absence (`ol-v7r5.18`, discovered
 * from `ol-blwb` / `[BKLG-1]`)
 *
 * `composeReentrySession` (`olea-core`'s `study-session/reentry.ts`) is now
 * this file's ONE call for building a session — never `buildComposedStudySession`
 * directly — because `reentry.ts`'s own reachability note names this exact
 * call site as the missing wiring: "the one place an ordinary session is
 * composed today ... has no notion of 'days since her last review' to decide
 * whether to call this module instead." `composeReentrySession` itself
 * decides whether this is a re-entry (`isReentryDue`, `REENTRY_ABSENCE_
 * THRESHOLD_DAYS`) and, when it is not, runs `ordinaryBudgetMinutes`
 * unmodified — so this is not a branch this file has to take, only a call it
 * has to make.
 *
 * Two things this file supplies that `reentry.ts` deliberately does not:
 *
 *  - **`daysSinceLastReview`** (`./absence.js` in `olea-core`) — the same
 *    `entries` this call already reads in full for the mastery join and the
 *    SESS-2 replay above, never a second, narrower read. `entries` is the
 *    WHOLE log (`readReviewLogHistory`'s own doc: "reads every log file it can
 *    see"), not the `probeDays` window, so a real multi-week absence is never
 *    misread as "never reviewed" the way a windowed read would.
 *  - **The candidate re-entry budget** — `reentryCandidateBudgetMinutes`
 *    below. SESS-1's modelling found the whole 0.25x-1.0x range of an ordinary
 *    budget statistically indistinguishable (`reentry.ts`'s own doc: "the
 *    widest plateau in the whole document"), so this is a declared, plain-
 *    English choice, never a fitted one — see that function's own doc.
 *
 * The result carries `isReentry` and a `view` that structurally omits the two
 * counts F6.6 forbids (`ReentryStudySessionView`) — `load()` returns
 * `{ kind: 'reentry', view }` rather than `{ kind: 'model', model }` exactly
 * when `isReentry` is true, so `SessionBuilderView` (`./view.js`) can never
 * render an ordinary session's `leftOutInstrumentCount`/`consideredRowCount`
 * on a re-entry screen by forgetting to check a flag.
 */

import type {
  CalendarDay,
  ConceptMaterialPresence,
  ConceptRelation,
  Scheduler,
  VaultPath,
  VaultSource,
} from 'olea-core';
import {
  allGapRows,
  buildConceptInstrumentIndex,
  buildGapView,
  buildMaterialPresence,
  calendarDaysEndingOn,
  composeOracleRanking,
  composeReentrySession,
  daysSinceLastReview,
  enumerateVaultInstruments,
  estimateInstrumentDurations,
  readReviewLogHistory,
  replaySchedulerStates,
  resolveAssessmentGroupingContext,
  resolveRelatedConceptKeys,
  reviewLogPath,
} from 'olea-core';
import {
  isStudyPlanConfigured,
  type ObsidianDataHost,
  ObsidianStudyPlanSettingsStore,
} from '../plan/settings-store.js';
// Row 3.9's chooser input ([SUPP-3], `ol-lpl4`): the same history-lookup
// builder the live review queue needs (`queue-adapter.ts`'s module doc
// explains why it lives there rather than in `packages/core`), reused here so
// the F4.6 preview session gets the identical fold over the identical
// `entries` read below rather than a second, possibly-disagreeing one.
import { buildSupportLevelHistoryLookup } from '../review/queue-adapter.js';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import type { SessionBuilderRequest, SessionBuilderState, SessionBuilderViewDeps } from './view.js';

/**
 * DECLARED (never fitted). What fraction of the ordinary requested budget
 * this file offers `composeReentrySession` as the re-entry candidate, before
 * that module's own `REENTRY_SIZE_FLOOR_MINUTES` floor applies.
 *
 * SESS-1's modelling (`findings/SESS-1-session-composition-model.md` §3.3,
 * olea-service; cited in full by `olea-core`'s `reentry.ts`) swept this ratio
 * from 0.25x to 1.0x and found "the widest plateau in the whole document" —
 * baseline share and recall probability barely move anywhere in that range,
 * so the number is "a product judgement about how a return should feel, not
 * a load-bearing constant" (`reentry.ts`'s own words). One half is the
 * plain-English reading of F6.6's "deliberately small" — noticeably shorter
 * than what she asked for, without being a token session — and it sits
 * comfortably inside the plateau SESS-1 measured, so there is nothing here to
 * fit against data: any value in that range reads the same to the model.
 */
export const REENTRY_CANDIDATE_BUDGET_RATIO = 0.5;

/**
 * The candidate re-entry budget this file offers `composeReentrySession` —
 * see {@link REENTRY_CANDIDATE_BUDGET_RATIO}'s own doc for where the ratio
 * comes from. `composeReentrySession` only uses this when its own
 * `isReentryDue` check fires; otherwise `ordinaryBudgetMinutes` is used
 * unmodified, so a wrong candidate here can only ever affect a genuine
 * re-entry, never an ordinary session.
 */
export function reentryCandidateBudgetMinutes(ordinaryBudgetMinutes: number): number {
  return ordinaryBudgetMinutes * REENTRY_CANDIDATE_BUDGET_RATIO;
}

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
  /**
   * F2.19 (`ol-v7r5.11`): the served C7.10 relation fold — same shape and
   * same `[D-093]` abstention gate as `main.ts`'s `servedRelationEdges()`,
   * which already hands this to `composeReviewSession` and the Today panel's
   * instrument source. **A thunk, not a value** — same reason `now` is one:
   * `createLocalSessionBuilderProvider` is called once per leaf, but `load()`
   * recomputes on every call (this file's own module doc), so a captured
   * array would go stale the moment an ingestion tick folds in a new relation
   * batch after the leaf opened. Optional and safe to omit:
   * `resolveRelatedConceptKeys` reads an absent/empty list as "no relations
   * known" and produces an empty adjacency map, which `study-session/
   * compose.ts` already proves is a no-op.
   */
  readonly relations?: () => readonly ConceptRelation[];
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

        // F2.19 (`ol-v7r5.11`): both resolvers are pure and synchronous, over
        // data this call already holds — `enumeration.concepts` is the same
        // extraction `composeOracleRanking` used for its own name→key join
        // above, and `edges.assessmentsRead.records` is the same read the
        // `assessments` field below passes through for F4.7's countdown. See
        // this file's own module doc, "F2.19's two resolvers".
        const { relatedConceptKeys } = resolveRelatedConceptKeys(
          deps.relations?.() ?? [],
          enumeration.concepts,
        );
        const { assessmentContext } = resolveAssessmentGroupingContext(
          edges.assessmentsRead.records,
          enumeration.concepts,
        );

        // F6.6 (`ol-v7r5.18`): `entries` is the WHOLE log (this file's own
        // module doc, `readReviewLogHistory`), so a real multi-week absence
        // is measured correctly regardless of `probeDays`.
        const composed = composeReentrySession({
          rows: gapRows,
          arrivalDays,
          relatedConceptKeys,
          assessmentContext,
          instruments: buildConceptInstrumentIndex(enumeration.records),
          replay,
          daysSinceLastReview: daysSinceLastReview(entries, now),
          candidateBudgetMinutes: reentryCandidateBudgetMinutes(request.budgetMinutes),
          ordinaryBudgetMinutes: request.budgetMinutes,
          // The first production read of the review log's `durationMs` (INV-4:
          // the discipline went in ahead of the feature, and this is the
          // feature).
          durations: estimateInstrumentDurations(entries),
          asOf: today,
          // Unmodified — the countdown (F4.7) is only as honest as this
          // pass-through, and re-reading the Base separately would let the
          // ranking and the countdown disagree about the same assessment.
          assessments: edges.assessmentsRead.records,
          // Row 3.9's chooser input ([SUPP-3], `ol-lpl4`): built from the same
          // `entries` read above for the mastery join and the SESS-2 replay —
          // a fold over data already in hand, never a second log read. No
          // self-assessment input exists on this surface yet (`request` names
          // no such field), so the fill scores the evidence-derived level with
          // none to adjust it, same as any caller that omits it.
          supportHistory: buildSupportLevelHistoryLookup(entries),
          ...(request.focusConceptName !== undefined
            ? { focusConceptName: request.focusConceptName }
            : {}),
        });

        // F6.6: a re-entry composition returns the narrower, count-free
        // `view` (`ReentryStudySessionView`) rather than the ordinary
        // `model` — see this file's own module doc and `SessionBuilderState`'s
        // doc (`./view.js`) for why that is a type, not a flag a renderer has
        // to remember to check.
        return composed.isReentry
          ? { kind: 'reentry', view: composed.view }
          : { kind: 'model', model: composed.full.model };
      } catch (error) {
        console.error('Olea: could not build a study session', error);
        return { kind: 'unavailable' };
      }
    },
  };
}
