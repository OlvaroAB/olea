/**
 * Scenario: "due instruments are served ahead of any number of pending drafts" —
 * @auto:plugin/review/open-session-instruments-before-drafts.ol-egov.141.89.10.130.spec (F2, `[D-568]`).
 * Synthetic fixtures only. Real `openReviewSession`, real in-memory vault and cache.
 */
import type { ComposedStudySession, RandomSource } from 'olea-core';
import {
  calendarDayFromLocalDate,
  createFsrsScheduler,
  enumerateVaultInstruments,
  writeInstrumentCitation,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { openReviewSession } from '../../src/review/open-session.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
} from '../../src/review/ports.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');
const fixedRandom: RandomSource = { next: () => 0.42 };

const CARD_DRAFT: DraftRecord = {
  draftId: 'card-draft-1',
  status: 'pending',
  courseCode: 'TEST101',
  conceptName: 'Alpha',
  conceptIds: ['concept-key-alpha'],
  sourcePath: 'Courses/TEST101/Week two.md',
  createdAt: '2026-08-09T09:00:00-04:00',
  instrumentType: 'qa',
  card: { front: 'Synthetic front?', back: 'Synthetic back.' },
  provenance: { taskId: 'cards.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
  firstServedAt: null,
};

const vault2 = () =>
  memoryVault({
    'Courses/TEST101/Week one.md': [
      '---',
      'topic: [Alpha]',
      'course: TEST101',
      '---',
      '## A question?',
      '',
      'The front::The back ^blk1',
      '',
      '## Another question?',
      '',
      'Second front::Second back ^blk2',
      '',
    ].join('\n'),
    'Courses/TEST101/Week two.md': '# Week two\n\nHer prose.\n',
  });

async function composedFor(v: ReturnType<typeof vault2>): Promise<ComposedStudySession> {
  const enumeration = await enumerateVaultInstruments(v);
  const items = enumeration.records.map((record, index) => ({
    position: index + 1,
    instrumentId: record.instrumentId,
    instrumentType: record.instrumentType,
    notePath: record.notePath,
    noteTitle: record.noteTitle,
    conceptName: 'Alpha',
    course: 'TEST101',
    gapClass: 'coverage-gap',
    gapRank: index + 1,
    gapScore: 1,
    estimatedSeconds: 60,
    durationSource: 'assumed',
    formatMatch: 'no-preference',
  }));
  return {
    model: {
      asOf: calendarDayFromLocalDate(NOW),
      budgetMinutes: 20,
      budgetSeconds: 1200,
      plannedSeconds: items.length * 60,
      items,
      leftOut: [],
      leftOutInstrumentCount: 0,
      consideredRowCount: items.length,
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
  } as never;
}

function draft(n: number): DraftRecord {
  return { ...CARD_DRAFT, draftId: `card-draft-${String(n).padStart(3, '0')}` };
}

async function open(v: ReturnType<typeof vault2>, drafts: number, chosen: boolean) {
  const cache = createVaultDraftCacheStore(v);
  for (let n = 0; n < drafts; n++) await cache.put(draft(n));
  const holder = createStudySessionHolder();
  const session = await composedFor(v);
  if (!chosen) (session.model as unknown as { items: unknown[] }).items = [];
  holder.enter(NOW, session);
  const outcome = await openReviewSession({
    vault: v,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: {
      reviewLog: createVaultReviewLogPort(v, DEVICE),
      suspendPort: createVaultSuspendPort(v, DEVICE),
      editPort: { async edit() {} },
      noteExists: createVaultNoteExistsPort(v),
      clock: { now: () => NOW },
      draftAcceptPort: {
        accept: () => Promise.reject(new Error('unused')),
        reject: () => Promise.reject(new Error('unused')),
      },
    },
    random: fixedRandom,
    probeDays: 30,
    studySessionHolder: holder,
    composeDefaultStudySession: () => Promise.reject(new Error('unreachable')),
    draftCache: cache,
  } as never);
  if (!outcome.ok) throw new Error(`the session failed to open: ${String(outcome.error)}`);
  return outcome;
}

async function firstServed(outcome: Awaited<ReturnType<typeof open>>, count: number) {
  await outcome.session.start();
  return outcome.session.queueSnapshot.slice(0, count).map((item) => item.instrument.draftId);
}

describe("a session serves the builder's instruments before pending drafts ([D-568])", () => {
  it('serves two due instruments ahead of 400 pending drafts, all drafts kept in order', async () => {
    const outcome = await open(vault2(), 400, true);
    expect(outcome.scheduledQueue.length).toBe(2);
    expect(outcome.itemCount).toBe(402);
    const served = await firstServed(outcome, 4);
    expect(served[0]).toBeNull();
    expect(served[1]).toBeNull();
    const all = outcome.session.queueSnapshot.map((item) => item.instrument.draftId);
    expect(all.slice(2).length).toBe(400);
    expect(all.slice(2)).toEqual(all.slice(2).slice().sort());
    expect(served[2]).toBe('card-draft-000');
    expect(served[3]).toBe('card-draft-001');
  });

  it('a session with only pending drafts shows them in their existing order', async () => {
    const outcome = await open(vault2(), 3, false);
    expect(outcome.itemCount).toBe(3);
    const served = await firstServed(outcome, 2);
    expect(served).toEqual(['card-draft-000', 'card-draft-001']);
  });

  it("a session with only the builder's instruments is unchanged by the draft merge", async () => {
    const outcome = await open(vault2(), 0, true);
    expect(outcome.itemCount).toBe(2);
    expect(outcome.scheduledQueue.length).toBe(2);
  });
});
