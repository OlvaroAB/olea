/**
 * M2 resolution evidence's first production caller (`ol-egov.141.89.6.32`,
 * discovered-from `ol-egov.141.89.6.19`): `logAndAdvance` asks a new
 * `MisconceptionLookupPort` whether the just-graded concept carries an open
 * misconception, runs `decideResolutionEvidence`
 * (`packages/core/src/misconception/resolution-evidence-decision.ts`), and on
 * a non-null verdict appends the event `olea-core`'s `buildResolutionEvidenceEvent`
 * builds through a new `ResolutionEvidenceAppendPort`. Coverage here is the
 * session-side wiring only — `decideResolutionEvidence`'s own decision table
 * (which ratings/verdicts count) is `resolution-evidence-decision.spec.ts`'s
 * job, not this file's.
 */
import type { MisconceptionResolutionEvidenceEvent } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ReviewSession, type ReviewSessionDeps } from '../../src/review/session.js';
import type { MisconceptionLookupPort, ResolutionEvidenceAppendPort } from '../../src/review/ports.js';
import {
  clozeFixture,
  fakeDraftAcceptPort,
  fakeEditPort,
  fakeNoteExists,
  fakeReviewLog,
  fakeScheduler,
  fakeSuspendPort,
  fixedClock,
  mcqFixture,
  qaFixture,
  queueItem,
} from './fixtures.js';

function baseDeps(overrides: Partial<ReviewSessionDeps> = {}): ReviewSessionDeps {
  return {
    queue: [],
    scheduler: fakeScheduler(),
    reviewLog: fakeReviewLog(),
    suspendPort: fakeSuspendPort(),
    editPort: fakeEditPort(),
    noteExists: fakeNoteExists(),
    clock: fixedClock('2026-08-10T09:00:00Z'),
    draftAcceptPort: fakeDraftAcceptPort(),
    ...overrides,
  };
}

/** Every concept named in `open` is answered "has an open misconception"; every other concept id is "no". */
function fakeMisconceptionLookup(
  open: readonly string[],
): MisconceptionLookupPort & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    hasOpenMisconceptionOnConcept: (conceptId: string) => {
      asked.push(conceptId);
      return open.includes(conceptId);
    },
  };
}

function fakeResolutionEvidenceAppend(): ResolutionEvidenceAppendPort & {
  readonly events: MisconceptionResolutionEvidenceEvent[];
} {
  const events: MisconceptionResolutionEvidenceEvent[] = [];
  return {
    events,
    appendResolutionEvidence: async (event) => {
      events.push(event);
    },
  };
}

describe('M2 resolution evidence — recall reviews', () => {
  it('a good recall on a concept with an open misconception appends one resolution-evidence event', async () => {
    const misconceptionLookup = fakeMisconceptionLookup(['concept-1']);
    const resolutionEvidenceAppend = fakeResolutionEvidenceAppend();
    const item = queueItem(qaFixture({ conceptIds: ['concept-1'] }));
    const session = new ReviewSession(
      baseDeps({ queue: [item], misconceptionLookup, resolutionEvidenceAppend }),
    );
    await session.start();
    session.reveal();

    await session.rate('good');

    expect(misconceptionLookup.asked).toEqual(['concept-1']);
    expect(resolutionEvidenceAppend.events).toHaveLength(1);
    expect(resolutionEvidenceAppend.events[0]).toMatchObject({
      kind: 'resolution-evidence',
      conceptId: 'concept-1',
      evidenceKind: 'recall',
      originInstrumentId: 'inst-qa-1',
      originReviewEventId: null,
    });
  });

  it('a hard or easy recall on a concept with an open misconception also appends (any of the three passing ratings)', async () => {
    const misconceptionLookup = fakeMisconceptionLookup(['concept-2']);
    const resolutionEvidenceAppend = fakeResolutionEvidenceAppend();
    const item = queueItem(clozeFixture({ conceptIds: ['concept-2'] }));
    const session = new ReviewSession(
      baseDeps({ queue: [item], misconceptionLookup, resolutionEvidenceAppend }),
    );
    await session.start();
    session.reveal();

    await session.rate('easy');

    expect(resolutionEvidenceAppend.events).toHaveLength(1);
    expect(resolutionEvidenceAppend.events[0]).toMatchObject({
      evidenceKind: 'recall',
      conceptId: 'concept-2',
    });
  });

  it('a failed ("again") recall never appends, even with an open misconception', async () => {
    const misconceptionLookup = fakeMisconceptionLookup(['concept-1']);
    const resolutionEvidenceAppend = fakeResolutionEvidenceAppend();
    const item = queueItem(qaFixture({ conceptIds: ['concept-1'] }));
    const session = new ReviewSession(
      baseDeps({ queue: [item], misconceptionLookup, resolutionEvidenceAppend }),
    );
    await session.start();
    session.reveal();

    await session.rate('again');

    expect(misconceptionLookup.asked).toEqual(['concept-1']);
    expect(resolutionEvidenceAppend.events).toHaveLength(0);
  });

  it('a good recall on a concept with no open misconception never appends', async () => {
    const misconceptionLookup = fakeMisconceptionLookup([]);
    const resolutionEvidenceAppend = fakeResolutionEvidenceAppend();
    const item = queueItem(qaFixture({ conceptIds: ['concept-1'] }));
    const session = new ReviewSession(
      baseDeps({ queue: [item], misconceptionLookup, resolutionEvidenceAppend }),
    );
    await session.start();
    session.reveal();

    await session.rate('good');

    expect(resolutionEvidenceAppend.events).toHaveLength(0);
  });

  it('a correct MCQ pick never appends, even on a concept with an open misconception (recognition never counts)', async () => {
    const misconceptionLookup = fakeMisconceptionLookup(['concept-3']);
    const resolutionEvidenceAppend = fakeResolutionEvidenceAppend();
    const item = queueItem(mcqFixture({ conceptIds: ['concept-3'] }));
    const session = new ReviewSession(
      baseDeps({ queue: [item], misconceptionLookup, resolutionEvidenceAppend }),
    );
    await session.start();

    await session.mcqAnswer(0); // index 0 is the correct option in mcqFixture
    await session.mcqNext();

    expect(misconceptionLookup.asked).toEqual([]);
    expect(resolutionEvidenceAppend.events).toHaveLength(0);
  });

  it('an incorrect MCQ pick never appends either', async () => {
    const misconceptionLookup = fakeMisconceptionLookup(['concept-3']);
    const resolutionEvidenceAppend = fakeResolutionEvidenceAppend();
    const item = queueItem(mcqFixture({ conceptIds: ['concept-3'] }));
    const session = new ReviewSession(
      baseDeps({ queue: [item], misconceptionLookup, resolutionEvidenceAppend }),
    );
    await session.start();

    await session.mcqAnswer(1); // a wrong option
    await session.mcqNext();

    expect(misconceptionLookup.asked).toEqual([]);
    expect(resolutionEvidenceAppend.events).toHaveLength(0);
  });

  it('no port supplied changes nothing — a good recall on an open misconception is a silent no-op', async () => {
    const item = queueItem(qaFixture({ conceptIds: ['concept-1'] }));
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: [item], reviewLog }));
    await session.start();
    session.reveal();

    await session.rate('good');

    // The ordinary review-log write still happened — this bead adds a new,
    // independent write path, never gates the existing one.
    expect(reviewLog.calls).toHaveLength(1);
    expect(session.getViewModel().phase).toBe('complete');
  });

  it('a lookup port with no append port never throws and appends nothing', async () => {
    const misconceptionLookup = fakeMisconceptionLookup(['concept-1']);
    const item = queueItem(qaFixture({ conceptIds: ['concept-1'] }));
    const session = new ReviewSession(baseDeps({ queue: [item], misconceptionLookup }));
    await session.start();
    session.reveal();

    await session.rate('good');

    expect(misconceptionLookup.asked).toEqual(['concept-1']);
    expect(session.getViewModel().phase).toBe('complete');
  });
});
