/**
 * David's follow-up on the concept-key ruling (`[D-357]`, `ol-egov.141.89.9.29`) asked for more
 * than the two narrow pinned unit specs `ol-egov.141.89.9.30`'s migration flips to passing: ONE
 * genuine review, composed and logged through this package's own `openReviewSession` (never a
 * hand-built `ReviewLogEntry`), read back through every reader the ruling names — Today's
 * mastery/insights source, the attainment reader, the readiness reader and the study plan's
 * ranking join — in a single run, on the real production readers:
 *
 *  - `today/data-source.ts`'s `createVaultTrendsSource` (F6.2 mastery overview / F6.5 insights)
 *  - `mastery/rollup.ts`'s `computeAllConceptMastery` (attainment)
 *  - `mastery/attainment.ts`'s `readAllConceptReadiness` (readiness, `[D-264]`)
 *  - `oracle/rank.ts`'s `rankOracle` and `plan/build.ts`'s `buildStudyPlan` (the study-plan /
 *    ranking join — `ConceptPriority.conceptKey` is, in the migration lane's own words, "what a
 *    review-log conceptIds entry, GapRow, and a study plan's PlannedConcept.conceptId all key
 *    on")
 *
 * `ol-egov.141.89.9.30`'s own notes (`S/lanes/ol-egov.141.89.9.30-report.md`) name the honest
 * complication this file has to cover rather than paper over: the support-level chooser
 * (`study-session/support-level-chooser.ts#chooseSupportLevel`) shows a cold-start review as
 * `'prompted'` ([D-094]), and readiness counts only an unaided (`'independent'`) success
 * ([D-264]) — so a first, cold-start review reaches Today and attainment but correctly reads no
 * readiness yet. This file drives that review too, and shows it correctly excluded.
 *
 * The support level a review is shown at is never something this file asserts onto the item —
 * `openReviewSession` (`open-session.ts:546`) always recomputes it itself, from the vault's REAL
 * review-log history, via `queue-adapter.ts`'s `buildSupportLevelHistoryLookup` (which clusters
 * entries into sessions, C5.5's 45-minute gap rule) and `chooseSupportLevel`
 * (`support-level-chooser.ts`) — a caller-supplied `StudySessionItem.supportLevel` on a hand-built
 * fixture item, as this file's sibling `test/review/concept-key-join.spec.ts` builds one, is
 * simply not read on this path. So the "unaided" suite below runs three REAL sessions of the
 * same instrument, each over 45 minutes apart (C5.5), rated 'good': the first is the honest,
 * unaided-by-nothing cold start (`[D-094]`'s `'prompted'`); the third is where the real ladder
 * (`support-level/ladder.ts`, `RECESSION_CLEAN_STREAK_THRESHOLD = 2`) recedes to `'independent'`
 * after two clean, unhinted prior sessions — never a hand-asserted string.
 *
 * The study-plan surface needs one evidence edge (`ConceptAssessmentEdge`) and one assessment
 * record to rank against — `rankOracle`'s real input shape (P5-T03's own result), hand-built here
 * exactly as `session/build.ts`'s item is hand-built above, rather than running the full tier-3
 * past-paper extraction a `composeOracleRanking` call would need; the join itself
 * (`rankOracle` → `buildStudyPlan`) is the real production code, unmodified.
 *
 * Every course code and concept name below is invented (INV-3).
 */

import type { Rating } from 'olea-contracts';
import type {
  AssessmentReadReport,
  AssessmentRecord,
  ComposedStudySession,
  ConceptAssessmentEdge,
  EvidenceQuestionCitation,
  RankOracleResult,
  StudySessionItem,
} from 'olea-core';
import {
  buildStudyPlan,
  computeAllConceptMastery,
  createFsrsScheduler,
  enumerateVaultInstruments,
  OPAQUE_CONCEPT_KEY_PREFIX,
  projectInstrumentValidity,
  rankOracle,
  readAllConceptReadiness,
  readReviewLogHistory,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { extractConceptsFromVault } from '../../src/concept/wiring.js';
import {
  type OpenReviewSessionInput,
  openReviewSession,
  type ReviewSessionPorts,
} from '../../src/review/open-session.js';
import {
  type Clock,
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
  type EditPort,
} from '../../src/review/ports.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { createVaultTrendsSource } from '../../src/today/data-source.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const COURSE = 'TESTC1';
const CONCEPT_NAME = 'Widget theory';
const ASSESSMENT_PATH = 'Courses/TESTC1/Past papers/Midterm.md';
const NOW = new Date('2026-09-26T14:00:00-04:00');

function fixedClock(now: Date = NOW): Clock {
  return { now: () => now };
}

/** One course, one topic-derived (tier 2, unbound) concept, one Q&A card — matching concept-key-join.spec.ts's fixture. */
function fixtureVault() {
  return memoryVault({
    'Courses/TESTC1/Week one.md': [
      '---',
      `topic: [${CONCEPT_NAME}]`,
      `course: ${COURSE}`,
      '---',
      '',
      '## A question?',
      '',
      'The front::The back ^blk1',
      '',
    ].join('\n'),
  });
}

/** The real ports over the real (in-memory) vault, matching concept-key-join.spec.ts's own `ports()`. */
function ports(
  vault: ReturnType<typeof memoryVault>,
  clock: Clock = fixedClock(),
): ReviewSessionPorts {
  const editPort: EditPort = {
    async edit() {
      // no-op — this suite never edits a note
    },
  };
  return {
    // The clock passed through explicitly (`ol-3ux7.64.9` [WBX-8]'s clock seam) — both ports
    // default to the real wall clock otherwise, which would stamp every review-log entry at
    // real "now" regardless of `clock`, collapsing this suite's separately-timed sessions into
    // one cluster (C5.5).
    reviewLog: createVaultReviewLogPort(vault, DEVICE, () => clock.now()),
    suspendPort: createVaultSuspendPort(vault, DEVICE, () => clock.now()),
    editPort,
    noteExists: createVaultNoteExistsPort(vault),
    clock,
    draftAcceptPort: {
      accept() {
        throw new Error('permanent-key-consumers.spec: no draft item in this suite should call accept');
      },
      reject() {
        throw new Error('permanent-key-consumers.spec: no draft item in this suite should call reject');
      },
    },
  };
}

/**
 * A `ComposedStudySession` naming the one enumerated instrument the fixture vault has —
 * matching `test/review/concept-key-join.spec.ts`'s own `composeOneItemSession` (the identical
 * "drive everything downstream of a composition" posture `open-session.spec.ts
 * #composedSessionFixture` documents). No `supportLevel` field is set here: `openReviewSession`
 * ignores it and recomputes the real one from vault history (see this file's module doc).
 */
async function composeOneItemSession(vault: ReturnType<typeof memoryVault>): Promise<{
  readonly composed: ComposedStudySession;
  readonly instrumentId: string;
}> {
  const enumeration = await enumerateVaultInstruments(vault);
  const record = enumeration.records[0];
  if (record === undefined) throw new Error('fixture vault enumerated no instrument');
  const item: StudySessionItem = {
    position: 1,
    instrumentId: record.instrumentId,
    instrumentType: record.instrumentType,
    notePath: record.notePath,
    noteTitle: record.noteTitle,
    conceptName: CONCEPT_NAME,
    course: COURSE,
    gapClass: 'coverage-gap',
    gapRank: 1,
    gapScore: 1,
    estimatedSeconds: 60,
    durationSource: 'assumed',
    formatMatch: 'no-preference',
  };
  return {
    instrumentId: record.instrumentId,
    composed: {
      model: {
        asOf: '2026-09-26',
        budgetMinutes: 20,
        budgetSeconds: 1200,
        plannedSeconds: 60,
        items: [item],
        leftOut: [],
        leftOutInstrumentCount: 0,
        consideredRowCount: 1,
        formatPreference: 'unknown',
        nextAssessment: null,
        durationBasis: 'assumed',
        focusConcept: null,
      },
      overflow: [],
      courseShares: new Map(),
      forcedCourses: [],
      obligationClasses: new Map(),
      citationRecheckQueued: new Set(),
      citationRevalidationPending: new Set(),
    },
  };
}

/**
 * Opens the one-item session as of `now` and rates it 'good', through the real ports. Calling
 * this more than once against the same vault, with `now` more than 45 minutes apart each time
 * (C5.5's `SESSION_CLUSTERING_GAP_SECONDS`), is what lets the real support-level history fold
 * (see this file's module doc) see each call as its own session boundary.
 */
async function openAndRateOneItem(vault: ReturnType<typeof memoryVault>, now: Date): Promise<void> {
  const { composed } = await composeOneItemSession(vault);
  const holder = createStudySessionHolder();
  holder.enter(now, composed);

  const input: OpenReviewSessionInput = {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: ports(vault, fixedClock(now)),
    probeDays: 30,
    studySessionHolder: holder,
    composeDefaultStudySession: async () => {
      throw new Error(
        'permanent-key-consumers.spec: composeDefaultStudySession should not be reachable — the holder is pre-seeded',
      );
    },
  };
  const outcome = await openReviewSession(input);
  if (!outcome.ok) throw new Error(`openReviewSession failed: ${String(outcome.error)}`);
  await outcome.session.start();
  outcome.session.reveal();
  await outcome.session.rate('good' satisfies Rating);
}

/**
 * Hand-built exactly like `session/build.ts`'s item above: `rankOracle`'s real input shape
 * (P5-T03's own `ConceptAssessmentEdge`/`AssessmentReadReport` result), for one concept cited by
 * one past paper — enough for the real `rankOracle` → `buildStudyPlan` join to place this
 * concept's permanent key into a study plan, without running the tier-3 extraction pass a full
 * `composeOracleRanking` call would need.
 */
function oneEdgeRankingInput(conceptKey: string): {
  readonly edges: readonly ConceptAssessmentEdge[];
  readonly assessmentsRead: AssessmentReadReport;
} {
  const citation: EvidenceQuestionCitation = {
    sourcePath: ASSESSMENT_PATH,
    questionLabel: 'Q1',
    questionText: 'Explain widget theory.',
    provenance: { sourcePath: ASSESSMENT_PATH, location: { page: 1 } },
  };
  const record: AssessmentRecord = {
    path: ASSESSMENT_PATH,
    course: COURSE,
    type: 'past-paper',
    weight: undefined,
    weightRaw: undefined,
    due: '2026-10-15',
    status: undefined,
  };
  const edge: ConceptAssessmentEdge = {
    conceptName: CONCEPT_NAME,
    conceptKey,
    assessmentPath: ASSESSMENT_PATH,
    course: COURSE,
    yieldRank: 1,
    confidence: 1,
    citations: [citation],
  };
  return {
    edges: [edge],
    assessmentsRead: {
      records: [record],
      sourceFolders: [],
      notesScanned: [],
      notesWithoutFrontmatter: [],
      columns: [],
      unresolvedFields: [],
      unrecognizedColumns: [],
      configErrors: [],
    },
  };
}

describe('one real review under the permanent key reaches every consumer, in one run (D-357 follow-up, ol-egov.141.89.9.53)', () => {
  it("an unaided review reaches Today's mastery/insights source, attainment, readiness and the study plan", async () => {
    const vault = fixtureVault();

    // Three REAL sessions of the same instrument, each over 45 minutes apart (C5.5's
    // `SESSION_CLUSTERING_GAP_SECONDS`), each rated 'good'. `openReviewSession` recomputes the
    // support level shown from the vault's real history every time (see this file's module
    // doc): session 1 is the honest cold start (`'prompted'`, `[D-094]`); by session 3 the real
    // ladder (`support-level/ladder.ts`) has folded two clean, unhinted prior sessions and
    // recedes to `'independent'` — never a hand-asserted string.
    const T0 = new Date('2026-09-26T09:00:00-04:00');
    const GAP_MS = 46 * 60 * 1000;
    await openAndRateOneItem(vault, T0);
    await openAndRateOneItem(vault, new Date(T0.getTime() + GAP_MS));
    await openAndRateOneItem(vault, new Date(T0.getTime() + 2 * GAP_MS));

    const { entries } = await readReviewLogHistory(vault, {});
    const reviewEntries = entries.filter((entry) => entry.kind === 'review');
    expect(reviewEntries).toHaveLength(3);
    expect(reviewEntries[0]?.supportLevelShown).toBe('prompted');
    expect(reviewEntries[2]?.supportLevelShown).toBe('independent');
    const conceptId = reviewEntries[2]?.conceptIds[0];
    expect(conceptId).toBeDefined();
    expect(conceptId?.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);
    const key = conceptId as string;

    // Surface 1: Today's mastery overview / insights trends source (today/data-source.ts:732).
    const trends = createVaultTrendsSource({ vault });
    const concepts = await trends.listConceptCourses();
    if (concepts === null) throw new Error('fixture vault should enumerate cleanly');
    expect(concepts.find((c) => c.displayName === CONCEPT_NAME)?.conceptId).toBe(key);

    // Surface 2: the attainment reader (mastery/rollup.ts:982) — all three scored reviews fold
    // under the one permanent key.
    const mastery = computeAllConceptMastery(entries, [key]);
    expect(mastery.get(key)?.evidence.scoredEventCount).toBe(3);

    // Surface 3: the readiness reader (mastery/attainment.ts:545) — the third review's unaided
    // success is real readiness evidence (D-264).
    const dayAfter = new Date(Date.parse(reviewEntries[2]?.timestamp as string) + 86_400_000);
    const readiness = readAllConceptReadiness(
      entries,
      [key],
      createFsrsScheduler(),
      dayAfter,
      projectInstrumentValidity(entries),
    );
    expect(readiness.get(key)?.weakest).not.toBeNull();

    // Surface 4: the study plan / ranking join (oracle/rank.ts:874, plan/build.ts:292) — the
    // same `conceptKey` reaches `PlannedConcept.conceptId`.
    const { edges, assessmentsRead } = oneEdgeRankingInput(key);
    const ranking: RankOracleResult = rankOracle({
      evidence: { edges, assessmentsRead, assessmentsWithNoEvidence: [] },
      mastery,
      asOf: '2026-09-26',
    });
    const rankedCourse = ranking.courses.find((c) => c.course === COURSE);
    if (rankedCourse === undefined || rankedCourse.status !== 'ranked') {
      throw new Error('expected the fixture course to rank, not abstain');
    }
    expect(rankedCourse.ranked.find((entry) => entry.conceptKey === key)).toBeDefined();

    const plan = await buildStudyPlan({ ranking, computedAt: '2026-09-26T09:00:00-04:00' });
    const plannedCourse = plan.body.courses.find((c) => c.course === COURSE);
    if (plannedCourse === undefined || plannedCourse.status !== 'ranked') {
      throw new Error('expected the study plan to rank the fixture course, not abstain');
    }
    expect(plannedCourse.concepts.some((concept) => concept.conceptId === key)).toBe(true);
  });

  it('a prompted cold-start review reaches Today and attainment, and correctly not readiness (D-264)', async () => {
    const vault = fixtureVault();

    // ONE real session, on a fresh vault with no prior history — the honest cold start.
    // `openReviewSession` reads that empty history itself (see this file's module doc) and
    // shows `'prompted'` ([D-094]); never a hand-asserted string.
    await openAndRateOneItem(vault, NOW);

    const { entries } = await readReviewLogHistory(vault, {});
    const reviewEntries = entries.filter((entry) => entry.kind === 'review');
    expect(reviewEntries).toHaveLength(1);
    expect(reviewEntries[0]?.supportLevelShown).toBe('prompted');
    const conceptId = reviewEntries[0]?.conceptIds[0];
    expect(conceptId).toBeDefined();
    expect(conceptId?.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);
    const key = conceptId as string;

    // Today's mastery overview / insights trends source still finds it under the permanent key.
    const trends = createVaultTrendsSource({ vault });
    const concepts = await trends.listConceptCourses();
    if (concepts === null) throw new Error('fixture vault should enumerate cleanly');
    expect(concepts.find((c) => c.displayName === CONCEPT_NAME)?.conceptId).toBe(key);

    // The attainment reader still folds the scored event.
    const mastery = computeAllConceptMastery(entries, [key]);
    expect(mastery.get(key)?.evidence.scoredEventCount).toBe(1);

    // Readiness correctly reads no weakest recall estimate: a prompted review is not an unaided
    // success (D-264), so it is honestly absent, never folded in as a measured zero.
    const dayAfter = new Date(Date.parse(reviewEntries[0]?.timestamp as string) + 86_400_000);
    const readiness = readAllConceptReadiness(
      entries,
      [key],
      createFsrsScheduler(),
      dayAfter,
      projectInstrumentValidity(entries),
    );
    expect(readiness.get(key)?.weakest).toBeNull();
  });
});
