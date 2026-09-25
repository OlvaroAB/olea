/**
 * M2 resolution evidence's real-open-path coverage (`ol-egov.141.89.6.35`,
 * discovered-from `ol-egov.141.89.6.32`/`ol-egov.141.89.6.19`):
 * `resolution-evidence.spec.ts` already proves `session.ts`'s `logAndAdvance`
 * wiring in isolation, against fake `MisconceptionLookupPort`/
 * `ResolutionEvidenceAppendPort` values. That suite deliberately does not
 * touch `open-session.ts` — its own module doc says the session-side wiring
 * is its only job. This file is the other half: does `openReviewSession`
 * itself build the REAL lookup (over the local misconception projection,
 * `../../src/misconception/store.js`'s `createVaultMisconceptionStore`) and
 * the REAL append port (`ports.ts`'s `createVaultResolutionEvidenceAppendPort`),
 * and wire them into the session it opens? Only a genuine (if in-memory)
 * vault read and write proves that, the same reasoning `open-session.spec.ts`'s
 * own module doc gives for using real ports throughout: "a test that stubbed
 * the write would be asserting the stub."
 */

import {
  appendMisconceptionEvent,
  buildObservationEvent,
  calendarDayFromLocalDate,
  createFsrsScheduler,
  enumerateVaultInstruments,
  MISCONCEPTION_LOG_FOLDER,
  parseMisconceptionLog,
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
import { createStudySessionHolder } from '../../src/session/holder.js';
import { memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');

const CONCEPT_NOTE = ['---', 'title: Alpha', 'course: TEST101', '---', '', 'A concept.', ''].join(
  '\n',
);

/** One concept, one qa instrument — small enough to key straight off `enumerateVaultInstruments`. */
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
  };
}

/** Appends one fresh, `active` Stream-A misconception event for `conceptId`, dated `NOW`'s calendar day. */
async function seedOpenMisconception(
  vault: ReturnType<typeof memoryVault>,
  conceptId: string,
): Promise<void> {
  const { event } = buildObservationEvent(
    {
      conceptId,
      confusedWithConceptId: null,
      statement: 'She believes the wrong thing.',
      correction: 'The right thing.',
      citation: { path: 'Courses/TEST101/Week one.md', blockIndex: 0 },
      originInstrumentId: 'inst-origin',
      originReviewEventId: null,
      timestamp: NOW.toISOString(),
    },
    { candidates: [] },
  );
  await appendMisconceptionEvent(vault, event, DEVICE);
}

async function sessionInputFor(
  vault: ReturnType<typeof memoryVault>,
  instrumentId: string,
): Promise<OpenReviewSessionInput> {
  const enumeration = await enumerateVaultInstruments(vault);
  const record = enumeration.records.find((r) => r.instrumentId === instrumentId);
  if (record === undefined) throw new Error(`no enumerated instrument "${instrumentId}"`);
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
          instrumentId: record.instrumentId,
          instrumentType: record.instrumentType,
          notePath: record.notePath,
          noteTitle: record.noteTitle,
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

/** Every `resolution-evidence` event across every device file under `.olea/misconceptions/`. */
async function readResolutionEvidenceEvents(
  vault: ReturnType<typeof memoryVault>,
): Promise<readonly unknown[]> {
  const path = `${MISCONCEPTION_LOG_FOLDER}/${calendarDayFromLocalDate(NOW)}.${DEVICE}.jsonl`;
  if (!(await vault.exists(path))) return [];
  const parsed = parseMisconceptionLog(await vault.read(path));
  return parsed.events.filter((event) => event.kind === 'resolution-evidence');
}

describe('openReviewSession — M2 resolution evidence over the real vault projection', () => {
  it('a good qa recall on a concept with an open misconception appends resolution evidence', async () => {
    const vault = qaVault();
    const enumeration = await enumerateVaultInstruments(vault);
    const qa = enumeration.records.find((r) => r.instrumentType === 'qa');
    if (qa === undefined) throw new Error('expected the fixture to enumerate one qa instrument');
    const conceptId = qa.conceptIds[0];
    if (conceptId === undefined) throw new Error('expected the qa instrument to carry a concept');

    await seedOpenMisconception(vault, conceptId);

    const outcome = await openReviewSession(await sessionInputFor(vault, qa.instrumentId));
    if (!outcome.ok) throw new Error('expected a composed session');

    await outcome.session.start();
    outcome.session.reveal();
    await outcome.session.rate('good');

    const events = await readResolutionEvidenceEvents(vault);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'resolution-evidence',
      conceptId,
      evidenceKind: 'recall',
    });
  });

  it('a good qa recall on a concept with no open misconception appends nothing', async () => {
    const vault = qaVault();
    const enumeration = await enumerateVaultInstruments(vault);
    const qa = enumeration.records.find((r) => r.instrumentType === 'qa');
    if (qa === undefined) throw new Error('expected the fixture to enumerate one qa instrument');

    // No `seedOpenMisconception` call: the projection is empty for this concept.
    const outcome = await openReviewSession(await sessionInputFor(vault, qa.instrumentId));
    if (!outcome.ok) throw new Error('expected a composed session');

    await outcome.session.start();
    outcome.session.reveal();
    await outcome.session.rate('good');

    const events = await readResolutionEvidenceEvents(vault);
    expect(events).toHaveLength(0);
  });
});
