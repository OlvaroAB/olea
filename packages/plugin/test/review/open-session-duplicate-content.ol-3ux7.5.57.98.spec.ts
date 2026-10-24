/**
 * `[D-627]` (`ol-3ux7.5.57.98`): the production open path serves exact duplicate content once.
 * Scenarios: "two concepts' pending drafts with identical cards are served once", "setting a copy
 * aside preserves both drafts' provenance and concept bindings", "answering the kept copy credits
 * only its own concept" and "a due instrument wins over a pending draft with the same content" —
 * @auto:plugin/review/open-session-duplicate-content.ol-3ux7.5.57.98.spec (F2). Synthetic fixtures
 * only. Real `openReviewSession`, real in-memory vault and draft cache.
 */
import type { ComposedStudySession, RandomSource } from 'olea-core';
import {
  calendarDayFromLocalDate,
  createFsrsScheduler,
  enumerateVaultInstruments,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { openReviewSession } from '../../src/review/open-session.js';
import type { RecordReviewInput } from '../../src/review/ports.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
} from '../../src/review/ports.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { currentInputNotes } from '../generation/input-notes-fixture.js';
import { memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');
const fixedRandom: RandomSource = { next: () => 0.42 };

const DRAFT_ALPHA: DraftRecord = {
  draftId: 'draft-alpha',
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

const DRAFT_BETA: DraftRecord = {
  ...DRAFT_ALPHA,
  draftId: 'draft-beta',
  conceptName: 'Beta',
  conceptIds: ['concept-key-beta'],
  createdAt: '2026-08-09T09:05:00-04:00',
};

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

async function composedFor(v: ReturnType<typeof vault>): Promise<ComposedStudySession> {
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

interface Opened {
  readonly outcome: Extract<Awaited<ReturnType<typeof openReviewSession>>, { ok: true }>;
  readonly cache: ReturnType<typeof createVaultDraftCacheStore>;
  readonly reviews: RecordReviewInput[];
  readonly accepted: string[];
  readonly rejected: string[];
}

async function open(
  v: ReturnType<typeof vault>,
  drafts: readonly DraftRecord[],
  chosen: boolean,
): Promise<Opened> {
  const cache = createVaultDraftCacheStore(v);
  // `ol-egov.141.89.2.39` ([D-628]): each draft records the note it was drawn from, as one drafted
  // today does; unchanged here, so it is presented.
  const inputNotes = await currentInputNotes(v, 'Courses/TEST101/Week two.md');
  for (const record of drafts) await cache.put({ ...record, inputNotes });
  const holder = createStudySessionHolder();
  const session = await composedFor(v);
  if (!chosen) (session.model as unknown as { items: unknown[] }).items = [];
  holder.enter(NOW, session);
  const reviews: RecordReviewInput[] = [];
  const accepted: string[] = [];
  const rejected: string[] = [];
  const vaultLog = createVaultReviewLogPort(v, DEVICE);
  const outcome = await openReviewSession({
    vault: v,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: {
      reviewLog: {
        async recordReview(input: RecordReviewInput) {
          reviews.push(input);
          await vaultLog.recordReview(input);
        },
      },
      suspendPort: createVaultSuspendPort(v, DEVICE),
      editPort: { async edit() {} },
      noteExists: createVaultNoteExistsPort(v),
      clock: { now: () => NOW },
      draftAcceptPort: {
        async accept(draftId: string) {
          accepted.push(draftId);
          return { instrumentId: `accepted-${draftId}` };
        },
        async reject(draftId: string) {
          rejected.push(draftId);
        },
      },
    },
    random: fixedRandom,
    probeDays: 30,
    studySessionHolder: holder,
    composeDefaultStudySession: () => Promise.reject(new Error('unreachable')),
    draftCache: cache,
  } as never);
  if (!outcome.ok) throw new Error(`the session failed to open: ${String(outcome.error)}`);
  return { outcome, cache, reviews, accepted, rejected };
}

describe("two concepts' pending drafts with identical cards are served once ([D-627])", () => {
  it('serves the first draft and records the second as set aside, naming both copies', async () => {
    const { outcome } = await open(vault(), [DRAFT_ALPHA, DRAFT_BETA], false);
    await outcome.session.start();
    const served = outcome.session.queueSnapshot.map((item) => item.instrument.draftId);
    expect(served).toEqual(['draft-alpha']);
    expect(outcome.itemCount).toBe(1);
    expect(outcome.duplicateContentSetAside).toEqual([
      {
        reason: 'duplicate-content',
        instrumentId: 'draft-beta',
        draftId: 'draft-beta',
        conceptIds: ['concept-key-beta'],
        duplicateOf: {
          instrumentId: 'draft-alpha',
          draftId: 'draft-alpha',
          conceptIds: ['concept-key-alpha'],
        },
      },
    ]);
  });

  it('serves both when the cards differ, and records nothing', async () => {
    const other = { ...DRAFT_BETA, card: { front: 'Another front?', back: 'Synthetic back.' } };
    const { outcome } = await open(vault(), [DRAFT_ALPHA, other], false);
    expect(outcome.itemCount).toBe(2);
    expect(outcome.duplicateContentSetAside).toEqual([]);
  });
});

describe("setting a copy aside preserves both drafts' provenance and concept bindings ([D-627])", () => {
  it('leaves both drafts pending as stored, and the served copy carries only its own concepts', async () => {
    const { outcome, cache } = await open(vault(), [DRAFT_ALPHA, DRAFT_BETA], false);
    await outcome.session.start();
    const pending = await cache.listPending();
    const byId = new Map(pending.map((record) => [record.draftId, record]));
    expect([...byId.keys()].sort()).toEqual(['draft-alpha', 'draft-beta']);
    for (const original of [DRAFT_ALPHA, DRAFT_BETA]) {
      const stored = byId.get(original.draftId);
      expect(stored?.status).toBe('pending');
      expect(stored?.conceptIds).toEqual(original.conceptIds);
      expect(stored?.sourcePath).toBe(original.sourcePath);
      expect(stored?.provenance).toEqual(original.provenance);
    }
    const servedConcepts = outcome.session.queueSnapshot.flatMap(
      (item) => item.instrument.conceptIds,
    );
    expect(servedConcepts).toEqual(['concept-key-alpha']);
  });
});

describe('answering the kept copy credits only its own concept ([D-627])', () => {
  it('accepts only the kept draft, and the review names only its concepts', async () => {
    const opened = await open(vault(), [DRAFT_ALPHA, DRAFT_BETA], false);
    const { outcome } = opened;
    await outcome.session.start();
    outcome.session.reveal();
    await outcome.session.rate('good');
    expect(opened.accepted).toEqual(['draft-alpha']);
    expect(opened.rejected).toEqual([]);
    expect(opened.reviews.length).toBe(1);
    expect(opened.reviews[0]?.instrument.conceptIds).toEqual(['concept-key-alpha']);
    expect(
      opened.reviews.some((review) => review.instrument.conceptIds.includes('concept-key-beta')),
    ).toBe(false);
    const beta = (await opened.cache.listPending()).find(
      (record) => record.draftId === 'draft-beta',
    );
    expect(beta?.status).toBe('pending');
  });
});

describe('a due instrument wins over a pending draft with the same content ([D-627])', () => {
  it('serves the instrument and sets the draft aside, naming the instrument as the kept copy', async () => {
    const twin = { ...DRAFT_ALPHA, card: { front: 'The front', back: 'The back' } };
    const { outcome } = await open(vault(), [twin], true);
    await outcome.session.start();
    const served = outcome.session.queueSnapshot.map((item) => item.instrument.draftId);
    expect(served).toEqual([null]);
    expect(outcome.scheduledQueue.length).toBe(1);
    expect(outcome.duplicateContentSetAside.length).toBe(1);
    const [entry] = outcome.duplicateContentSetAside;
    expect(entry?.draftId).toBe('draft-alpha');
    expect(entry?.duplicateOf.draftId).toBeNull();
    expect(entry?.duplicateOf.instrumentId).toBe(
      outcome.scheduledQueue[0]?.instrument.instrumentId,
    );
  });
});
