/**
 * `createLocalRetrospectiveProvider` — the production `RetrospectiveViewDeps`
 * (F8.8, `[POST-1]`/`ol-r68l`, mechanics ruled `[D-134]`).
 *
 * ## Which assessment she sees, and why this is a Class B default
 *
 * F8.8 is per-assessment; nothing ruled WHICH passed assessment a command-
 * palette open shows when several have passed. This provider picks, in
 * order: (1) the most recently-due assessment still in `'offered'` status
 * (an offer nobody has opened or dismissed yet — the natural "what's new"
 * answer), (2) failing that, the most recently-due passed assessment at
 * all, so the command is never a dead end. Reversible, and named here
 * rather than left implicit.
 *
 * ## The scope resolution D-134 Q6 rules, and the gap that remains (`ol-0r92.31`)
 *
 * `retrospective/types.ts`'s module doc explains why `buildRetrospective`
 * takes `scope` as an explicit input. D-134 Q6 rules two paths, never
 * blended: the assessment's own stated scope (F1.7) where recorded, else
 * the evidenced concept set. This provider resolves the first path via
 * `../../core/src/assessment/scope-concept-keys.ts`'s
 * `resolveAssessmentGroupingContext` — the same comma-split,
 * exact-normalized-name, course-scoped resolver `session-builder/
 * provider.ts` already uses for F2.19's grouping seam — applied to just the
 * chosen assessment. `scopeOrigin: 'assessment-stated'` is used whenever
 * `chosen.scope` carries any non-blank text, even if every comma-segment
 * fails to match a concept name (an honest empty stated scope, never
 * silently reinterpreted as "no scope" and blended into the evidenced set).
 * `scopeOrigin: 'evidenced'` — "every concept belonging to this course that
 * has at least one review-log entry" (D-134 Q6's second path) — fires only
 * when the assessment records no scope text at all.
 *
 * ## D-134 Q3's fallback, still the coarse evidenced set
 *
 * `finalAssessmentScope` is still the SAME evidenced set (every concept in
 * the course with review-log evidence) rather than the course's actual
 * final assessment's own resolved scope — `buildConceptAssessmentEdges`'s
 * course-level join still does not produce a per-assessment-other-than-
 * chosen concept list, so "the final assessment's concepts" still collapses
 * to "the course's concepts" for the same honest reason `retrospective/
 * types.ts` names. Out of this bead's scope: Q6 governs `scope`/
 * `scopeOrigin` above, not Q3's separate carry-forward fallback.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  type AssessmentRecord,
  buildRetrospective,
  type ConceptRecord,
  createFsrsScheduler,
  hasAssessmentPassed,
  type RetrospectiveConceptCoverage,
  type RetrospectiveOfferEvent,
  type RetrospectiveOfferStatus,
  type RetrospectiveReading,
  type RetrospectiveScopeOrigin,
  readAssessments,
  resolveAssessmentGroupingContext,
  resolveRetrospectiveOfferStatus,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { extractConceptsFromVault } from '../concept/wiring.js';
import type { ObsidianDataHost } from '../plan/settings-store.js';
import { ObsidianStudyPlanSettingsStore } from '../plan/settings-store.js';
import { localToday, readReviewHistory } from '../today/data-source.js';
import { writeRetrospectiveNote } from './note-writer.js';
import type { RetrospectiveOfferEventLog } from './offer-events.js';

/** How far back the review-log read spans — a whole academic year with margin, matching `today/data-source.ts`'s own `SCHEDULING_HISTORY_PROBE_DAYS` bound for the same reason: a term's worth of evidence, not the Today panel's shorter streak window. */
const RETROSPECTIVE_HISTORY_WINDOW_DAYS = 400;

/** `0.8` — the same DECLARED fallback shape `oracle/rank.ts`'s constants use: a plain-English default for when no derived, delivered value is available. Plain-English defense: a concept recalled with at least 4-in-5 probability is one the registry's own evidence table calls "recalled reliably" — this is a shape, not a corpus-fitted number, so it is safe to declare here rather than derive. Replace with a delivered artifact value the day one exists (`[D-110]`'s pattern), same follow-up gap `oracle/rank.ts` already names for its own weights. */
const DECLARED_FALLBACK_HOLDING_CUT = 0.8;

export interface RetrospectiveLoadResult {
  readonly reading: RetrospectiveReading;
  readonly status: RetrospectiveOfferStatus;
  /** F1.7's stated scope text, display-only — see this module's doc for why it never becomes `reading`'s concept list. */
  readonly assessmentScopeText: string | undefined;
}

export interface RetrospectiveProviderDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  /**
   * Reads/writes offer/open/dismiss review-log events (`[D-134]` Q5,
   * `ol-0r92.16`) — `./offer-events.ts`'s `createRetrospectiveOfferEventLog`
   * in production. Replaces the interim `ObsidianRetrospectiveOfferStore`
   * (`./offer-store.ts`, deleted by that same bead); the field name is kept
   * so callers built against the old shape change only their constructor
   * call, not this interface's shape.
   */
  readonly offerStore: RetrospectiveOfferEventLog;
  /**
   * Same store `gap/provider.ts`/`session-builder/provider.ts` read from on
   * every `load()` — a settings change she makes between two opens must not
   * need a reload to take, matching those providers' own rule.
   */
  readonly settingsHost: ObsidianDataHost;
  readonly now: () => Date;
  readonly holdingCut?: number;
}

/** Every course concept with at least one review-log entry — D-134 Q6's "evidenced concept set, drawn from her review history". */
function evidencedCourseScope(
  concepts: readonly ConceptRecord[],
  course: string,
  entries: readonly ReviewLogEntry[],
): readonly RetrospectiveConceptCoverage[] {
  const reviewedConceptIds = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    for (const id of entry.conceptIds) reviewedConceptIds.add(id);
  }
  return concepts
    .filter((c) => c.courses.includes(course) && reviewedConceptIds.has(c.key))
    .map((c) => ({ conceptId: c.key, conceptName: c.name }))
    .sort((a, b) => (a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0));
}

/**
 * D-134 Q6's `'assessment-stated'` path: resolves `assessment.scope`'s F1.7
 * prose into a concept-key set via `resolveAssessmentGroupingContext`
 * (course-scoped, exact-normalized-name match, no fuzzy matching — see that
 * module's own doc), then maps each resolved key back to the display name
 * `RetrospectiveConceptCoverage` needs. A comma-segment matching no concept
 * name is silently dropped by the resolver (counted in
 * `unresolvedScopeSegmentCount`, not surfaced here) — this function's
 * caller only runs this path once `hasStatedScope` has already confirmed
 * the assessment records scope text at all, so an empty result here is an
 * honest "stated but unresolved", never reinterpreted as "no scope".
 */
function assessmentStatedScope(
  assessment: AssessmentRecord,
  concepts: readonly ConceptRecord[],
): readonly RetrospectiveConceptCoverage[] {
  const { assessmentContext } = resolveAssessmentGroupingContext([assessment], concepts);
  const scopeConceptKeys =
    assessmentContext.get(assessment.path)?.scopeConceptKeys ?? new Set<string>();
  const nameByKey = new Map(concepts.map((c) => [c.key, c.name] as const));
  return [...scopeConceptKeys]
    .map((key) => ({ conceptId: key, conceptName: nameByKey.get(key) ?? key }))
    .sort((a, b) => (a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0));
}

/** D-134 Q6: a stated scope is used whenever the assessment records ANY non-blank scope text, regardless of whether every segment resolves to a concept — "where recorded" is about the text existing, not about match success. */
function hasStatedScope(assessment: AssessmentRecord): boolean {
  return assessment.scope !== undefined && assessment.scope.trim() !== '';
}

function compareByDueDescending(a: AssessmentRecord, b: AssessmentRecord): number {
  const aDue = a.due ?? '';
  const bDue = b.due ?? '';
  return bDue < aDue ? -1 : bDue > aDue ? 1 : 0;
}

/**
 * Picks which passed assessment to show — see this module's doc for the
 * two-step Class B rule. Returns `null` when nothing has passed yet.
 */
async function pickAssessment(
  passed: readonly AssessmentRecord[],
  offerEvents: readonly RetrospectiveOfferEvent[],
): Promise<AssessmentRecord | null> {
  if (passed.length === 0) return null;
  const withStatus = passed.map((record) => ({
    record,
    status: resolveRetrospectiveOfferStatus(offerEvents, record.path, true),
  }));
  const stillOffered = withStatus.filter((r) => r.status === 'offered');
  const pool = stillOffered.length > 0 ? stillOffered : withStatus;
  return pool.map((r) => r.record).sort(compareByDueDescending)[0] ?? null;
}

export interface RetrospectiveProvider {
  /** `null` when no assessment has passed yet — the retrospective has nothing to show. */
  load(): Promise<RetrospectiveLoadResult | null>;
  /** Records that she opened the retrospective — ends the standing offer for this assessment (F8.8: "offered once"). */
  markOpened(assessmentPath: VaultPath): Promise<void>;
  /** Records a dismissal without opening — the offer-card's other ending (D-134 Q1). Exposed for a future Home/grove host; see `offer-card.ts`. */
  markDismissed(assessmentPath: VaultPath): Promise<void>;
  /** D-134 Q7: writes the accepted retrospective into her vault as an Olea-owned note. */
  acceptToVault(reading: RetrospectiveReading): Promise<VaultPath>;
}

export function createLocalRetrospectiveProvider(
  deps: RetrospectiveProviderDeps,
): RetrospectiveProvider {
  const holdingCut = deps.holdingCut ?? DECLARED_FALLBACK_HOLDING_CUT;
  const scheduler = createFsrsScheduler();
  const settingsStore = new ObsidianStudyPlanSettingsStore(deps.settingsHost);

  return {
    async load() {
      const now = deps.now();
      const { assignmentsBasePath } = await settingsStore.load();
      const [assessmentsRead, history, offerEvents] = await Promise.all([
        readAssessments(deps.vault, assignmentsBasePath),
        readReviewHistory(deps.vault, deps.deviceId, {
          today: localToday(now),
          windowDays: RETROSPECTIVE_HISTORY_WINDOW_DAYS,
        }),
        deps.offerStore.load(),
      ]);

      const passed = assessmentsRead.records.filter((r) => hasAssessmentPassed(r.due, now));
      const chosen = await pickAssessment(passed, offerEvents);
      if (chosen === null) return null;

      const course = chosen.course ?? 'Unassigned';
      const entries = history.entries;
      const conceptRecords = await extractConceptsFromVault(deps.vault, {});
      const conceptCourses = conceptRecords.map((c) => ({ conceptId: c.key, courses: c.courses }));

      const scopeOrigin: RetrospectiveScopeOrigin = hasStatedScope(chosen)
        ? 'assessment-stated'
        : 'evidenced';
      const scope =
        scopeOrigin === 'assessment-stated'
          ? assessmentStatedScope(chosen, conceptRecords)
          : evidencedCourseScope(conceptRecords, course, entries);

      const isLastAssessment =
        assessmentsRead.records.filter((r) => r.course === course).sort(compareByDueDescending)[0]
          ?.path === chosen.path;

      const reading = buildRetrospective({
        assessmentPath: chosen.path,
        course,
        scope,
        scopeOrigin,
        entries,
        scheduler,
        now,
        holdingCut,
        conceptCourses,
        // D-134 Q3's fallback is still the coarse course-wide evidenced set
        // (this module's doc, "D-134 Q3's fallback") — deliberately NOT
        // `scope` above, which as of this bead can be the narrower
        // assessment-stated set for `chosen` itself and would be the wrong
        // stand-in for a DIFFERENT (later) assessment's own scope.
        ...(isLastAssessment
          ? {}
          : { finalAssessmentScope: evidencedCourseScope(conceptRecords, course, entries) }),
      });

      const status = resolveRetrospectiveOfferStatus(offerEvents, chosen.path, true);
      return { reading, status, assessmentScopeText: chosen.scope };
    },

    async markOpened(assessmentPath) {
      await deps.offerStore.append({
        kind: 'retrospective-opened',
        assessmentPath,
        timestamp: deps.now().toISOString(),
      });
    },

    async markDismissed(assessmentPath) {
      await deps.offerStore.append({
        kind: 'retrospective-dismissed',
        assessmentPath,
        timestamp: deps.now().toISOString(),
      });
    },

    async acceptToVault(reading) {
      return writeRetrospectiveNote(deps.vault, reading, deps.now);
    },
  };
}
