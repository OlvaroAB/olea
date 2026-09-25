/**
 * Investigation for `ol-egov.141.89.10.59` (service repo, discovered from
 * `ol-egov.141.89.10.52` item 5): does a real review's `ReviewLogEntry
 * .conceptIds` carry the same key shape the stamped consumers read?
 *
 * `session/enumerate.ts` (the walk behind `buildReviewSession`, and so behind
 * every real review this suite's sibling `open-session.spec.ts` drives) mints
 * `conceptIds` from `extractConcepts` with `stampConceptKeys` OMITTED —
 * `open-session.ts`'s own `buildReviewSession` call never sets it, and
 * neither does any of the six vault-walking call sites this file measures
 * against. `extract.ts#keyFor`'s doc: omitted means `options.stampConceptKeys
 * !== true`, which falls back to `provisionalConceptKey` — a pure,
 * content-derived stand-in (`concept-prov1:...`), never the persisted,
 * opaque `mintOpaqueConceptKey` output (`concept-key1:...`) `extract.ts`
 * mints when a caller explicitly opts in.
 *
 * `packages/plugin/src/concept/wiring.ts#extractConceptsFromVault` flips that
 * default: `stampConceptKeys: true` unless a caller opts OUT. Four production
 * readers call it this way — `retrospective/provider.ts:253`,
 * `generation/wiring.ts:87`, `plan/provider.ts:231`,
 * `course-setup/recognition-source.ts:91` — and `today/data-source.ts`'s
 * `createVaultTrendsSource` (used by `loadTodayPanel`'s F6.2 mastery
 * overview / F6.5 insights fold) is a fifth, direct call at line 744. Every
 * one of them reads a `ConceptRecord.key` that is the OPAQUE persisted key,
 * never the provisional one a real review-log record actually carries.
 *
 * **This is not a fresh finding — it is the measured state
 * `ol-egov.141.89.9.26` already pinned**, in
 * `packages/plugin/test/today/concept-key-agreement.spec.ts`'s second
 * describe block, for the Today reader specifically, and left unfixed on
 * purpose: reverting `createVaultTrendsSource` to unstamped regresses
 * `ol-2zfj.50`'s own scenario (`production-callers.spec.ts`) that this exact
 * call site stamp. This file's job is narrower and complementary — drive a
 * REAL review through `openReviewSession` (this package's own composition,
 * not a hand-built `ReviewLogEntry`) and show the identical mismatch reaches
 * two of the five stamped readers the bead names, plus the shared
 * `computeAllConceptMastery`/`readAllConceptReadiness` fold `oracle/
 * compose.ts:340-350` puts behind attainment, readiness and (via `plan/
 * build.ts:176`'s `conceptId: entry.conceptKey`) the plan join — all three
 * key their `conceptKeys` off the identical opaque `extractConceptsFromVault`
 * output this file measures directly.
 *
 * **Where the bead's own framing over-reached, corrected here:** the
 * registry is NOT a sixth stamped reader. `registry/provider.ts:595` calls
 * `enumerateVaultInstruments(deps.vault)` with no `concepts` option at all —
 * the identical unstamped walk `buildReviewSession` uses — so the registry's
 * own join stays internally consistent with a real review-log record. Traced
 * and reported, not asserted here (this file owns one new spec, not a
 * registry-owned regression suite).
 *
 * Join table (file:line), traced for this report:
 *  - `session/enumerate.ts:357-365` mints `conceptIds` from `ordered.map(c =>
 *    c.key)`, `c.key` from `extract.ts#keyFor` with `stampConceptKeys`
 *    unset -> provisional. `open-session.ts:396`'s `buildReviewSession` call
 *    never sets it either. MISMATCH SOURCE.
 *  - `today/data-source.ts:744` (`createVaultTrendsSource#listConceptCourses`)
 *    -> `extractConceptsFromVault`, stamped by default -> opaque. Folded
 *    against `entries` (provisional) inside `loadTodayPanel`'s F6.2 mastery
 *    overview. MISMATCH.
 *  - `oracle/compose.ts:340-350` (`composeOracleRanking`, behind attainment
 *    (`computeAllConceptMastery`), readiness (`readAllConceptReadiness`,
 *    `ol-v7r5.54`'s wiring) and, through `plan/build.ts:176`, the plan join)
 *    takes `conceptKeys` from `edges.edges.map(e => e.conceptKey)`, and
 *    `evidence-edge/build.ts:267`'s `conceptKeyByName` is built from
 *    `options.concepts` — `plan/provider.ts:231` supplies that via
 *    `extractConceptsFromVault`, stamped -> opaque. MISMATCH.
 *  - `registry/provider.ts:595` -> `enumerateVaultInstruments`, unstamped ->
 *    provisional, matching a real review-log record. NOT a mismatch — the
 *    bead's framing named it as one; this trace does not bear that out.
 *
 * Every course code and concept name below is invented (INV-3).
 */

import type { Rating } from 'olea-contracts';
import type { ComposedStudySession, StudySessionItem } from 'olea-core';
import {
  computeAllConceptMastery,
  createFsrsScheduler,
  enumerateVaultInstruments,
  OPAQUE_CONCEPT_KEY_PREFIX,
  PROVISIONAL_CONCEPT_KEY_PREFIX,
  projectInstrumentValidity,
  provisionalConceptKey,
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

describe('a real review, read back through the provisional key it was actually logged under', () => {
  it('precondition: the review-log record names the provisional key session/enumerate.ts mints, not the opaque one (confirms the fixture, not the bug)', async () => {
    const vault = fixtureVault();
    await openAndRateOneItem(vault);

    const { entries } = await readReviewLogHistory(vault, {});
    const reviewEntries = entries.filter((entry) => entry.kind === 'review');
    expect(reviewEntries).toHaveLength(1);
    const loggedConceptId = reviewEntries[0]?.conceptIds[0];
    expect(loggedConceptId).toBeDefined();
    expect(loggedConceptId?.startsWith(`${PROVISIONAL_CONCEPT_KEY_PREFIX}:`)).toBe(true);

    // The write path itself is sound: folding the log against the SAME
    // provisional key it was written under finds the review — isolates the
    // bug below to the key SHAPE mismatch, not to a broken append or a
    // broken fold.
    const provisionalKey = provisionalConceptKey({ name: CONCEPT_NAME, boundNotePath: null });
    expect(loggedConceptId).toBe(provisionalKey);
    const mastery = computeAllConceptMastery(entries, [provisionalKey]);
    expect(mastery.get(provisionalKey)?.evidence.scoredEventCount).toBe(1);
  });

  it.fails("REGRESSION (traced, not owned by this bead — see ol-egov.141.89.10.59 report): Today's mastery-overview reader finds the review it just logged", async () => {
    const vault = fixtureVault();
    await openAndRateOneItem(vault);
    const { entries } = await readReviewLogHistory(vault, {});

    // `today/data-source.ts:744` — the exact call `loadTodayPanel`'s F6.2
    // mastery overview / F6.5 insights fold uses.
    const trends = createVaultTrendsSource({ vault });
    const concepts = await trends.listConceptCourses();
    if (concepts === null) throw new Error('fixture vault should enumerate cleanly');
    const stampedConceptId = concepts.find((c) => c.displayName === CONCEPT_NAME)?.conceptId;
    expect(stampedConceptId).toBeDefined();
    expect(stampedConceptId?.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);

    // Same fold `buildTodayPanel`'s mastery overview runs, keyed by the
    // stamped id Today actually reads. Today the review is invisible here:
    // `scoredEventCount` reads 0, not 1 — this assertion states what SHOULD
    // be true once the key shapes agree, so it documents the gap rather than
    // asserting today's broken behaviour as correct.
    const mastery = computeAllConceptMastery(entries, [stampedConceptId as string]);
    expect(mastery.get(stampedConceptId as string)?.evidence.scoredEventCount).toBe(1);
  });

  it.fails('REGRESSION (traced, not owned by this bead — see ol-egov.141.89.10.59 report): the attainment/readiness fold behind oracle/compose.ts finds the review it just logged', async () => {
    const vault = fixtureVault();
    await openAndRateOneItem(vault);
    const { entries } = await readReviewLogHistory(vault, {});

    // `plan/provider.ts:231` (and `generation/wiring.ts:87`,
    // `course-setup/recognition-source.ts:91`, `retrospective/provider.ts:253`)
    // all source their `concepts` this exact way, which is what
    // `oracle/compose.ts:343`'s `conceptKeys` (attainment's
    // `computeAllConceptMastery` input and readiness's
    // `readAllConceptReadiness` input alike) is built from.
    const records = await extractConceptsFromVault(vault, {});
    const stampedConceptId = records.find((r) => r.name === CONCEPT_NAME)?.key;
    expect(stampedConceptId).toBeDefined();
    expect(stampedConceptId?.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);

    const mastery = computeAllConceptMastery(entries, [stampedConceptId as string]);
    expect(mastery.get(stampedConceptId as string)?.evidence.scoredEventCount).toBe(1);

    const scheduler = createFsrsScheduler();
    const validity = projectInstrumentValidity(entries);
    const readiness = readAllConceptReadiness(
      entries,
      [stampedConceptId as string],
      scheduler,
      NOW,
      validity,
    );
    // Readiness should see the same review's instrument as eligible evidence;
    // it does not, for the identical key-shape reason.
    expect(readiness.get(stampedConceptId as string)?.weakest).not.toBeNull();
  });
});
