/**
 * Scenario: "opening a review session with a pending card draft composes the session" —
 * @auto:plugin/review/open-session-card-draft.ol-egov.141.89.105.6.spec (F3.3, `[D-541]`).
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

const vault = () =>
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
    ].join('\n'),
    'Courses/TEST101/Week two.md': '# Week two\n\nHer prose.\n',
  });

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

async function composed(v: ReturnType<typeof vault>): Promise<ComposedStudySession> {
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

describe('opening a review session with a pending card draft', () => {
  it('opens, serving the due item first and the card draft after it', async () => {
    const v = vault();
    const cache = createVaultDraftCacheStore(v);
    await cache.put(CARD_DRAFT);
    const holder = createStudySessionHolder();
    holder.enter(NOW, await composed(v));
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
    expect(outcome.itemCount).toBe(2);
    expect(outcome.scheduledQueue.length).toBe(1);
    await outcome.session.start();
    const vm = outcome.session.getViewModel();
    expect(vm.phase).toBe('front');
    if (vm.phase !== 'front') return;
    expect(vm.instrument.draftId).toBeNull();
  });
});

describe('an accepted card carries the Olea-generated fact from its citation record ([D-555], ol-egov.141.89.105.19)', () => {
  async function openFirst(v: ReturnType<typeof vault>) {
    const holder = createStudySessionHolder();
    holder.enter(NOW, await composed(v));
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
    } as never);
    if (!outcome.ok) throw new Error(`the session failed to open: ${String(outcome.error)}`);
    const item = outcome.scheduledQueue[0];
    if (item === undefined) throw new Error('no scheduled item');
    return item.instrument;
  }

  it('marks a card that has a citation record', async () => {
    const v = vault();
    const [record] = (await enumerateVaultInstruments(v)).records;
    if (record === undefined) throw new Error('no record');
    await writeInstrumentCitation(v, record.instrumentId, {
      sourcePath: 'Courses/TEST101/Week one.md',
    });
    const instrument = await openFirst(v);
    expect(instrument.type).toBe('qa');
    expect(instrument.draftId).toBeNull();
    expect(instrument.oleaGenerated).toBe(true);
  });

  it('leaves a card she wrote, which has no record, unmarked', async () => {
    const instrument = await openFirst(vault());
    expect(instrument.type).toBe('qa');
    expect(instrument.oleaGenerated).toBeUndefined();
  });
});
