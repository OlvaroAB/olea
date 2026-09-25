/**
 * A real review's `ReviewLogEntry.conceptIds` carry the same key every
 * concept reader joins on — the permanent `.olea/concepts/` key (`[D-357]`,
 * `ol-egov.141.89.9.30`).
 *
 * Found by `ol-egov.141.89.10.59` (discovered from `ol-egov.141.89.10.52`
 * item 5), and pinned here as two expected failures until `[D-357]` landed:
 * `open-session.ts`'s `buildReviewSession` call enumerated her vault with
 * `stampConceptKeys` unset, so `session/enumerate.ts` logged every review
 * under the content-derived stand-in key (`concept-prov1:...`), while
 * `today/data-source.ts`'s `createVaultTrendsSource` and the four readers
 * behind `extractConceptsFromVault` (`retrospective/provider.ts`,
 * `generation/wiring.ts`, `plan/provider.ts`,
 * `course-setup/recognition-source.ts`) read the permanent key
 * (`concept-key1:...`). A review she had just rated folded to zero scored
 * events on Today's mastery overview and to a null weakest readiness behind
 * `oracle/compose.ts`'s attainment/readiness fold (and, through
 * `plan/build.ts`'s `conceptId: entry.conceptKey`, the plan join).
 *
 * `[D-357]` (David, 2026-09-25, option A) moved every path that composes a
 * review or lists concepts onto the permanent key before the first
 * installable release. No build was ever installed on her real vault, so no
 * read-time bridge for old stand-in entries exists: a stand-in entry in a test
 * or simulator vault simply reads as unreviewed, and nothing already written
 * is rewritten.
 *
 * This file drives a REAL review through `openReviewSession` (this package's
 * own composition, not a hand-built `ReviewLogEntry`) and reads it back
 * through the two stamped readers named above.
 *
 * Every course code and concept name below is invented (INV-3).
 */

import type { Rating } from 'olea-contracts';
import type { ComposedStudySession, StudySessionItem } from 'olea-core';
import {
  appendReviewLogRecord,
  computeAllConceptMastery,
  createFsrsScheduler,
  enumerateVaultInstruments,
  OPAQUE_CONCEPT_KEY_PREFIX,
  PROVISIONAL_CONCEPT_KEY_PREFIX,
  projectInstrumentValidity,
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
import { memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const COURSE = 'TESTC1';
const CONCEPT_NAME = 'Widget theory';
const NOW = new Date('2026-09-25T14:00:00-04:00');

function fixedClock(now: Date = NOW): Clock {
  return { now: () => now };
}

/** One course, one topic-derived (tier 2, unbound) concept, one Q&A card. */
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

/** The real ports over the real (in-memory) vault, matching `open-session.spec.ts`'s own `ports()`. */
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
    reviewLog: createVaultReviewLogPort(vault, DEVICE),
    suspendPort: createVaultSuspendPort(vault, DEVICE),
    editPort,
    noteExists: createVaultNoteExistsPort(vault),
    clock,
    draftAcceptPort: {
      accept() {
        throw new Error('concept-key-join.spec: no draft item in this suite should call accept');
      },
      reject() {
        throw new Error('concept-key-join.spec: no draft item in this suite should call reject');
      },
    },
  };
}

/**
 * A `ComposedStudySession` naming the one enumerated instrument the fixture
 * vault has, so `openReviewSession` finds an already-active holder and never
 * needs the real study-session composer — the identical "drive everything
 * downstream of a composition" posture `open-session.spec.ts#composedSessionFixture`
 * documents; trimmed here to the single item this suite rates.
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
        asOf: '2026-09-25',
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

/** Opens the one-item session and rates it 'good', through the real ports. */
async function openAndRateOneItem(vault: ReturnType<typeof memoryVault>) {
  const { composed } = await composeOneItemSession(vault);
  const holder = createStudySessionHolder();
  holder.enter(NOW, composed);

  const input: OpenReviewSessionInput = {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: ports(vault),
    probeDays: 30,
    studySessionHolder: holder,
    composeDefaultStudySession: async () => {
      throw new Error(
        'concept-key-join.spec: composeDefaultStudySession should not be reachable — the holder is pre-seeded',
      );
    },
  };
  const outcome = await openReviewSession(input);
  if (!outcome.ok) throw new Error(`openReviewSession failed: ${String(outcome.error)}`);
  await outcome.session.start();
  outcome.session.reveal();
  await outcome.session.rate('good' satisfies Rating);
}

describe('a real review, read back through the permanent key it is logged under ([D-357])', () => {
  it('the review-log record names the permanent key, never the stand-in, and the log folds against it', async () => {
    const vault = fixtureVault();
    await openAndRateOneItem(vault);

    const { entries } = await readReviewLogHistory(vault, {});
    const reviewEntries = entries.filter((entry) => entry.kind === 'review');
    expect(reviewEntries).toHaveLength(1);
    const loggedConceptId = reviewEntries[0]?.conceptIds[0];
    expect(loggedConceptId).toBeDefined();
    expect(loggedConceptId?.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);
    expect(loggedConceptId?.startsWith(`${PROVISIONAL_CONCEPT_KEY_PREFIX}:`)).toBe(false);

    // The write path itself is sound: folding the log against the key it was
    // written under finds the review.
    const mastery = computeAllConceptMastery(entries, [loggedConceptId as string]);
    expect(mastery.get(loggedConceptId as string)?.evidence.scoredEventCount).toBe(1);
  });

  it("Today's mastery-overview reader finds the review it just logged", async () => {
    const vault = fixtureVault();
    await openAndRateOneItem(vault);
    const { entries } = await readReviewLogHistory(vault, {});

    // `today/data-source.ts`'s `createVaultTrendsSource` — the exact call
    // `loadTodayPanel`'s F6.2 mastery overview / F6.5 insights fold uses.
    const trends = createVaultTrendsSource({ vault });
    const concepts = await trends.listConceptCourses();
    if (concepts === null) throw new Error('fixture vault should enumerate cleanly');
    const stampedConceptId = concepts.find((c) => c.displayName === CONCEPT_NAME)?.conceptId;
    expect(stampedConceptId).toBeDefined();
    expect(stampedConceptId?.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);

    // Same fold `buildTodayPanel`'s mastery overview runs, keyed by the id
    // Today actually reads.
    const mastery = computeAllConceptMastery(entries, [stampedConceptId as string]);
    expect(mastery.get(stampedConceptId as string)?.evidence.scoredEventCount).toBe(1);
  });

  it('the attainment/readiness fold behind oracle/compose.ts finds the review it just logged', async () => {
    const vault = fixtureVault();
    await openAndRateOneItem(vault);
    const { entries } = await readReviewLogHistory(vault, {});

    // `plan/provider.ts` (and `generation/wiring.ts`,
    // `course-setup/recognition-source.ts`, `retrospective/provider.ts`) all
    // source their `concepts` this exact way, which is what
    // `oracle/compose.ts`'s `conceptKeys` (attainment's
    // `computeAllConceptMastery` input and readiness's
    // `readAllConceptReadiness` input alike) is built from.
    const records = await extractConceptsFromVault(vault, {});
    const stampedConceptId = records.find((r) => r.name === CONCEPT_NAME)?.key;
    expect(stampedConceptId).toBeDefined();
    expect(stampedConceptId?.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);

    const mastery = computeAllConceptMastery(entries, [stampedConceptId as string]);
    expect(mastery.get(stampedConceptId as string)?.evidence.scoredEventCount).toBe(1);

    // Readiness joins by the same key. Which successes it counts is `[D-264]`'s
    // rule, not the key's: only an unaided success is readiness evidence, and
    // the support-level chooser shows a cold-start first review with support
    // (`[D-094]`), so that review alone honestly reads as no readiness yet.
    // The same review, shown unaided, enters the reading under the permanent
    // key — and would enter no reading under any other.
    const unaided = entries.map((entry) =>
      entry.kind === 'review' ? { ...entry, supportLevelShown: 'independent' as const } : entry,
    );
    const reviewedAt = unaided.find((entry) => entry.kind === 'review')?.timestamp;
    if (reviewedAt === undefined) throw new Error('no review entry was logged');
    const dayAfter = new Date(Date.parse(reviewedAt) + 86_400_000);
    const readiness = readAllConceptReadiness(
      unaided,
      [stampedConceptId as string, `${PROVISIONAL_CONCEPT_KEY_PREFIX}:${CONCEPT_NAME}`],
      createFsrsScheduler(),
      dayAfter,
      projectInstrumentValidity(unaided),
    );
    expect(readiness.get(stampedConceptId as string)?.weakest).not.toBeNull();
    expect(readiness.get(`${PROVISIONAL_CONCEPT_KEY_PREFIX}:${CONCEPT_NAME}`)?.weakest).toBeNull();
  });

  it('a stand-in entry already in a vault is not rewritten and simply reads as unreviewed ([D-357], no bridge)', async () => {
    const vault = fixtureVault();
    const standIn = `${PROVISIONAL_CONCEPT_KEY_PREFIX}:${CONCEPT_NAME}`;
    const { instrumentId } = await composeOneItemSession(vault);
    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-09-20T10:00:00Z',
        instrumentId,
        instrumentType: 'qa',
        conceptIds: [standIn],
        rating: 'good',
        wasUnsure: false,
        durationMs: 1000,
        selectionContext: {
          dueState: 'new',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      },
      { deviceId: DEVICE, generateEventId: () => 'stand-in-1' },
    );
    const logPaths = (await vault.list()).filter((path) => path.startsWith('.olea/reviews/'));
    expect(logPaths).toHaveLength(1);
    const before = await vault.read(logPaths[0] as string);

    const records = await extractConceptsFromVault(vault, {});
    const permanentKey = records.find((r) => r.name === CONCEPT_NAME)?.key as string;
    const { entries } = await readReviewLogHistory(vault, {});
    const mastery = computeAllConceptMastery(entries, [permanentKey]);
    expect(mastery.get(permanentKey)?.evidence.scoredEventCount).toBe(0);
    // Nothing already written is rewritten.
    expect(await vault.read(logPaths[0] as string)).toBe(before);
  });
});
