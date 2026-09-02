/**
 * Synthetic review-view fixtures (INV-3: invented content only — never
 * copied from `docs/design/pass1/`'s mocks or any real vault). Course
 * codes, note titles and question text below are fabricated for this test
 * suite and share nothing with the design system's sample copy.
 */
import type { Rating } from 'olea-contracts';
import type { RetrievabilityInput, ScheduleInput, Scheduler } from 'olea-core';
import { vi } from 'vitest';
import type { DraftAcceptPort } from '../../src/generation/accept.js';
import type {
  EditPort,
  ExplainBackOfferLogPort,
  ExplainBackOfferWriteInput,
  NoteExistsPort,
  RecordReviewInput,
  ReviewLogPort,
  SuspendPort,
} from '../../src/review/ports.js';
import type { ClozeCard, McqItem, QaCard, ReviewQueueItem } from '../../src/review/types.js';

export function qaFixture(overrides: Partial<QaCard> = {}): QaCard {
  return {
    type: 'qa',
    instrumentId: 'inst-qa-1',
    conceptIds: ['concept-1'],
    courseCode: 'PSYC210',
    noteTitle: 'Articulatory rehearsal limits',
    sourcePath: 'Courses/PSYC210/articulatory-rehearsal.md',
    blockId: 'blk-1',
    draftId: null,
    question: 'What limits the capacity of articulatory rehearsal?',
    answer: 'Chunking and rehearsal trade off against a small fixed slot count.',
    ...overrides,
  };
}

export function clozeFixture(overrides: Partial<ClozeCard> = {}): ClozeCard {
  return {
    type: 'cloze',
    instrumentId: 'inst-cloze-1',
    conceptIds: ['concept-2'],
    courseCode: 'PSYC210',
    noteTitle: 'Encoding specificity',
    sourcePath: 'Courses/PSYC210/encoding.md',
    blockId: 'blk-2',
    draftId: null,
    before: 'Recall is best when the ',
    clozeText: 'retrieval context',
    after: ' matches the context at encoding.',
    noteContext: null,
    ...overrides,
  };
}

export function mcqFixture(overrides: Partial<McqItem> = {}): McqItem {
  return {
    type: 'mcq',
    instrumentId: 'inst-mcq-1',
    conceptIds: ['concept-3'],
    courseCode: 'HIST150',
    noteTitle: 'Primary vs secondary sources',
    sourcePath: 'Courses/HIST150/sources.md',
    blockId: null,
    draftId: null,
    stem: 'Which of these is a primary source?',
    options: [
      { id: 'a', label: 'A letter written by a participant', correct: true },
      { id: 'b', label: 'A textbook summarising the event', correct: false },
      { id: 'c', label: 'A documentary made decades later', correct: false },
    ],
    feedback: 'Primary sources are produced by someone with direct, first-hand involvement.',
    ...overrides,
  };
}

export function queueItem(
  instrument: QaCard | ClozeCard | McqItem,
  overrides: Partial<Pick<ReviewQueueItem, 'priorState' | 'selectionContext'>> = {},
): ReviewQueueItem {
  return {
    instrument,
    priorState: null,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [instrument.type],
      planVersion: null,
    },
    ...overrides,
  };
}

const INTERVAL_BY_RATING: Readonly<Record<Rating, number>> = {
  again: 0,
  hard: 2,
  good: 6,
  easy: 14,
};

/**
 * Distinct, deterministic intervals per rating so tests can assert on which
 * one fired. `lapses` defaults to `0` (unchanged from every existing caller);
 * pass a number, or a function of the rating just applied, for F2.12
 * (`ol-h2bx`) tests that need `SchedulerState.lapses` to cross the
 * confusion-routing threshold.
 */
export function fakeScheduler(
  lapses: number | ((rating: ScheduleInput['rating']) => number) = 0,
): Scheduler {
  return {
    schedule: vi.fn(({ instrumentId, rating, now }: ScheduleInput) => {
      const intervalDays = INTERVAL_BY_RATING[rating];
      return {
        instrumentId,
        intervalDays,
        state: {
          schemaVersion: 1 as const,
          due: now.toISOString(),
          stability: 1,
          difficulty: 1,
          scheduledDays: intervalDays,
          learningStepIndex: 0,
          reps: 1,
          lapses: typeof lapses === 'function' ? lapses(rating) : lapses,
          learningState: 'review' as const,
          lastReview: now.toISOString(),
        },
      };
    }),
    // The recall-probability half of the port (`VIT-1`). Deliberately not real
    // FSRS arithmetic — a decaying stand-in whose only contracted properties
    // are the ones a caller may legitimately rely on: it starts at 1 the
    // instant of the review, never increases as time passes, and stays inside
    // [0, 1]. A fake returning a constant would let a consumer that ignores
    // `now` pass, which is the one mistake worth catching here.
    retrievability: vi.fn(({ instrumentId, state, now }: RetrievabilityInput) => {
      const elapsedDays = Math.max(
        0,
        (now.getTime() - new Date(state.lastReview).getTime()) / 86_400_000,
      );
      return {
        instrumentId,
        recallProbability: 1 / (1 + elapsedDays / Math.max(state.stability, 0.1)),
      };
    }),
  };
}

export function fakeReviewLog(): ReviewLogPort & { readonly calls: RecordReviewInput[] } {
  const calls: RecordReviewInput[] = [];
  return {
    calls,
    recordReview: vi.fn(async (input) => {
      calls.push(input);
    }),
  };
}

export interface FakeSuspendCall {
  readonly instrumentId: string;
  readonly conceptIds: readonly string[];
}

export function fakeSuspendPort(): SuspendPort & { readonly calls: FakeSuspendCall[] } {
  const calls: FakeSuspendCall[] = [];
  return {
    calls,
    suspend: vi.fn(async (instrumentId: string, conceptIds: readonly string[]) => {
      calls.push({ instrumentId, conceptIds });
    }),
  };
}

/**
 * Fake `ExplainBackOfferLogPort` (`[D-178 / LOG-3]` item 2, `ol-0r92.28`).
 * `recordOffered` mints a deterministic, incrementing event id — same
 * "distinct so tests can assert on which one fired" reasoning
 * `fakeScheduler`'s per-rating intervals use — so a test can assert a
 * decline's `answers` names the SAME id its paired offer produced, without
 * either call being awaited (the real port's whole point, per its own doc).
 */
export function fakeExplainBackOfferLog(): ExplainBackOfferLogPort & {
  readonly offered: (ExplainBackOfferWriteInput & { readonly eventId: string })[];
  readonly declined: (ExplainBackOfferWriteInput & { readonly answers: string })[];
} {
  const offered: (ExplainBackOfferWriteInput & { readonly eventId: string })[] = [];
  const declined: (ExplainBackOfferWriteInput & { readonly answers: string })[] = [];
  let nextEventId = 0;
  return {
    offered,
    declined,
    recordOffered: vi.fn((input: ExplainBackOfferWriteInput) => {
      nextEventId += 1;
      const eventId = `explain-back-offer-event-${nextEventId}`;
      offered.push({ ...input, eventId });
      return eventId;
    }),
    recordDeclined: vi.fn((input: ExplainBackOfferWriteInput & { readonly answers: string }) => {
      declined.push({ ...input });
    }),
  };
}

export function fakeEditPort(): EditPort & { readonly calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    edit: vi.fn(async (instrument) => {
      calls.push(instrument);
    }),
  };
}

/** Every note exists by default; pass `missing` to simulate F2.6's deleted-note scenario for specific paths. */
export function fakeNoteExists(missing: readonly string[] = []): NoteExistsPort {
  return {
    exists: vi.fn(async (path: string) => !missing.includes(path)),
  };
}

export interface FakeDraftAcceptCall {
  readonly kind: 'accept' | 'reject';
  readonly draftId: string;
  readonly verdict?: 'accepted' | 'edited';
}

/**
 * `ol-p3t07a`: `accept` mints a deterministic, distinguishable-from-the-draft-id
 * instrument id by default (`resolved:<draftId>`) — tests that care about the
 * exact value override `instrumentId`.
 */
export function fakeDraftAcceptPort(
  instrumentId: (draftId: string) => string = (draftId) => `resolved:${draftId}`,
): DraftAcceptPort & { readonly calls: FakeDraftAcceptCall[] } {
  const calls: FakeDraftAcceptCall[] = [];
  return {
    calls,
    accept: vi.fn(async (draftId: string, verdict: 'accepted' | 'edited') => {
      calls.push({ kind: 'accept', draftId, verdict });
      return { instrumentId: instrumentId(draftId) };
    }),
    reject: vi.fn(async (draftId: string) => {
      calls.push({ kind: 'reject', draftId });
    }),
  };
}

export function fixedClock(startIso: string) {
  let current = new Date(startIso).getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}
