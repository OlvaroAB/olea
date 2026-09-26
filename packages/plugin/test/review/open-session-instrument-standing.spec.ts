/**
 * `[D-323]`'s real instrument-standing reader, over the real (in-memory)
 * review log (`ol-egov.141.89.6.4`, `ol-egov.141.89.10.45`) — `session.spec.ts`
 * already proves `logAndAdvance`'s WIRING against a hand-built
 * `resolveInstrumentStanding`/`evaluateInstrumentStanding` pair; this file is
 * the other half: does `openReviewSession` itself build a REAL reader from
 * the whole review log it already holds, and reach `pendingConfusionOffer`/
 * `pendingItemRepairReferral` through the composed session it opens? Only a
 * genuine (if in-memory) review-log write proves that — the same reasoning
 * `open-session.spec.ts`'s own module doc gives for real ports throughout.
 *
 * Two of D-323's six named concerns have a real, wired reader today
 * (`open-session.ts`'s own `readInstrumentStanding`): `contested` (an open,
 * unresolved grade dispute) and `rejected` (a `rejected` verdict, or a grade
 * dispute resolved `corrected` — folded onto the same concern; see that
 * function's doc for why). The suite below proves both, plus the clean case.
 *
 * **`pending-revalidation` is deliberately not exercised here.** `[D-351]`'s
 * fact lives only in `ObsidianCitationHashStore`
 * (`ingestion/materiality/citation-hash-store.ts`), behind an
 * `ObsidianDataHost` this Obsidian-free module has no port for and no
 * production caller threads in yet (`readInstrumentStanding`'s own doc names
 * the exact `main.ts` gap). Faking that port here, with nothing real behind
 * it, would be exactly the fabrication this bead's brief forbids
 * ("never generate one"); the last test below instead proves the honest
 * negative — an instrument with no wired concern against it reads clear, not
 * because the four unreachable concerns were silently assumed clear, but
 * because this reader has nothing checkable to say about them at all (see
 * `readInstrumentStanding`'s own doc for the four, one by one, and the
 * follow-up each needs).
 */

import {
  appendDisputeRecord,
  appendVerdictRecord,
  calendarDayFromLocalDate,
  createFsrsScheduler,
  enumerateVaultInstruments,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type OpenReviewSessionInput,
  openReviewSession,
  type ReviewSessionPorts,
} from '../../src/review/open-session.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
} from '../../src/review/ports.js';
import type { ReviewSession } from '../../src/review/session.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');

const CONCEPT_NOTE = ['---', 'title: Alpha', 'course: TEST101', '---', '', 'A concept.', ''].join(
  '\n',
);

/** One concept, one `qa` instrument — repeated-failure routing only ever fires on the `'front'`-phase recall-tier types, and `qa` is the simplest of those. */
function qaVault() {
  return memoryVault({
    'Concepts/Alpha.md': CONCEPT_NOTE,
    'Courses/TEST101/Week one.md': [
      '---',
      'topic: [Alpha]',
      'course: TEST101',
      '---',
      '## A question?',
      '',
      'The front::The back ^blk1',
      '',
    ].join('\n'),
  });
}

/** Forces F2.12's own gate open on every rating, so this suite exercises `[D-323]`'s standing check in isolation from F2.12's own repeated-failure detection (that gate is `confusion-routing.spec.ts`'s job, not this file's). */
function ports(vault: ReturnType<typeof memoryVault>): ReviewSessionPorts {
  return {
    reviewLog: createVaultReviewLogPort(vault, DEVICE),
    suspendPort: createVaultSuspendPort(vault, DEVICE),
    editPort: { async edit() {} },
    noteExists: createVaultNoteExistsPort(vault),
    clock: { now: () => NOW },
    draftAcceptPort: {
      accept() {
        throw new Error('unused in this suite');
      },
      reject() {
        throw new Error('unused in this suite');
      },
    },
    evaluateConfusionRouting: () => ({
      shouldOffer: true,
      lapses: 4,
      promptText: 'offer text',
    }),
  };
}

async function sessionInputFor(
  vault: ReturnType<typeof memoryVault>,
): Promise<OpenReviewSessionInput> {
  const enumeration = await enumerateVaultInstruments(vault);
  const qa = enumeration.records.find((r) => r.instrumentType === 'qa');
  if (qa === undefined) throw new Error('expected the fixture to enumerate one qa instrument');
  const conceptId = qa.conceptIds[0];
  if (conceptId === undefined) throw new Error('expected the qa instrument to carry a concept');

  const holder = createStudySessionHolder();
  holder.enter(NOW, {
    model: {
      asOf: calendarDayFromLocalDate(NOW),
      budgetMinutes: 20,
      budgetSeconds: 1200,
      plannedSeconds: 60,
      items: [
        {
          position: 1,
          instrumentId: qa.instrumentId,
          instrumentType: qa.instrumentType,
          notePath: qa.notePath,
          noteTitle: qa.noteTitle,
          conceptName: 'Alpha',
          course: 'TEST101',
          gapClass: 'coverage-gap',
          gapRank: 1,
          gapScore: 1,
          estimatedSeconds: 60,
          durationSource: 'assumed',
          formatMatch: 'no-preference',
        },
      ],
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
  });
  return {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: ports(vault),
    probeDays: 30,
    studySessionHolder: holder,
    composeDefaultStudySession: () => {
      throw new Error('sessionInputFor: holder is pre-seeded active; should not be reached');
    },
  };
}

/** Rates the current `qa` item `'good'` — the one action that reaches `logAndAdvance`'s `[D-323]` call site. */
async function rateCurrentItem(session: ReviewSession): Promise<void> {
  session.reveal();
  await session.rate('good');
}

describe('openReviewSession — [D-323] instrument standing over the real review log (ol-egov.141.89.6.4, ol-egov.141.89.10.45)', () => {
  it('an instrument with an open, unresolved grade dispute reads suspect and routes to item repair, not the ordinary offer', async () => {
    const vault = qaVault();
    const enumeration = await enumerateVaultInstruments(vault);
    const qa = enumeration.records.find((r) => r.instrumentType === 'qa');
    if (qa === undefined) throw new Error('expected one qa instrument');
    const conceptId = qa.conceptIds[0];
    if (conceptId === undefined) throw new Error('expected a concept');

    await appendDisputeRecord(
      vault,
      {
        timestamp: NOW.toISOString(),
        claimKind: 'grade',
        claimRendering: 'explain-back-grade',
        conceptIds: [conceptId],
        instrumentId: qa.instrumentId,
        evidenceBasis: 'fp-1',
        effect: 'quarantined',
        // No `resolves`/`outcome`: this is the OPENING dispute, still unresolved.
      },
      { deviceId: DEVICE },
    );

    const outcome = await openReviewSession(await sessionInputFor(vault));
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();
    await rateCurrentItem(outcome.session);

    expect(outcome.session.getConfusionRoutingOffer()).toBeNull();
    expect(outcome.session.getPendingItemRepairReferral()).toEqual({
      instrumentId: qa.instrumentId,
      concerns: ['contested'],
    });
  });

  it('an instrument with a rejected verdict reads suspect and routes to item repair', async () => {
    const vault = qaVault();
    const enumeration = await enumerateVaultInstruments(vault);
    const qa = enumeration.records.find((r) => r.instrumentType === 'qa');
    if (qa === undefined) throw new Error('expected one qa instrument');
    const conceptId = qa.conceptIds[0];
    if (conceptId === undefined) throw new Error('expected a concept');

    await appendVerdictRecord(
      vault,
      {
        timestamp: NOW.toISOString(),
        instrumentId: qa.instrumentId,
        instrumentType: 'qa',
        conceptIds: [conceptId],
        verdict: 'rejected',
        artifactProvenance: {
          taskId: 'task-1',
          promptVersion: '1.0.0',
          modelId: 'model-1',
        },
      },
      { deviceId: DEVICE },
    );

    const outcome = await openReviewSession(await sessionInputFor(vault));
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();
    await rateCurrentItem(outcome.session);

    expect(outcome.session.getConfusionRoutingOffer()).toBeNull();
    expect(outcome.session.getPendingItemRepairReferral()).toEqual({
      instrumentId: qa.instrumentId,
      concerns: ['rejected'],
    });
  });

  it("a grade dispute resolved 'corrected' also reads suspect, folded onto the same 'rejected' concern (Class B — see readInstrumentStanding's doc)", async () => {
    const vault = qaVault();
    const enumeration = await enumerateVaultInstruments(vault);
    const qa = enumeration.records.find((r) => r.instrumentType === 'qa');
    if (qa === undefined) throw new Error('expected one qa instrument');
    const conceptId = qa.conceptIds[0];
    if (conceptId === undefined) throw new Error('expected a concept');

    const opened = await appendDisputeRecord(
      vault,
      {
        timestamp: NOW.toISOString(),
        claimKind: 'grade',
        claimRendering: 'explain-back-grade',
        conceptIds: [conceptId],
        instrumentId: qa.instrumentId,
        evidenceBasis: 'fp-1',
        effect: 'quarantined',
      },
      { deviceId: DEVICE },
    );
    await appendDisputeRecord(
      vault,
      {
        timestamp: NOW.toISOString(),
        claimKind: 'grade',
        claimRendering: 'explain-back-grade',
        conceptIds: [conceptId],
        instrumentId: qa.instrumentId,
        evidenceBasis: 'fp-1',
        effect: 'quarantined',
        resolves: opened.record.eventId,
        outcome: 'corrected',
      },
      { deviceId: DEVICE },
    );

    const outcome = await openReviewSession(await sessionInputFor(vault));
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();
    await rateCurrentItem(outcome.session);

    expect(outcome.session.getConfusionRoutingOffer()).toBeNull();
    expect(outcome.session.getPendingItemRepairReferral()).toEqual({
      instrumentId: qa.instrumentId,
      concerns: ['rejected'],
    });
  });

  it('an instrument with no recorded standing reads clear and the ordinary offer stands — never guessed toward suspect from an unreachable concern', async () => {
    const vault = qaVault();
    // No dispute, no verdict: nothing to find for `contested`/`rejected`, and
    // `flagged`/`changed-source-passage`/`pending-revalidation`/
    // `safety-information-unavailable` have no reader at all in this module
    // (see `readInstrumentStanding`'s doc) — none of the six is fabricated
    // suspect, so the ordinary F2.12 offer this suite's `evaluateConfusionRouting`
    // already decided to show must stand, unchanged.
    const outcome = await openReviewSession(await sessionInputFor(vault));
    if (!outcome.ok) throw new Error('expected a composed session');
    await outcome.session.start();
    await rateCurrentItem(outcome.session);

    expect(outcome.session.getConfusionRoutingOffer()?.promptText).toBe('offer text');
    expect(outcome.session.getPendingItemRepairReferral()).toBeNull();
  });
});
