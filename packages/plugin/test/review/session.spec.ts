/**
 * `ReviewSession` behavioural coverage for F2.2, F2.4/F2.6-adjacent state
 * transitions, and F2.16's rating mapping as actually wired into a session.
 * Session-continuity-across-restarts (F2.2) and the dark-theme scenarios
 * (F2.4) stay `@manual` in `features/F2-review.md` — this file covers the
 * parts of those features that are pure state-machine logic, not the
 * cross-process or rendered-pixel parts.
 */
import { mapMcqRating } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ReviewSession, type ReviewSessionDeps } from '../../src/review/session.js';
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

describe('F2.2 — nothing due', () => {
  it('an empty queue from the start is the empty state, never session-complete', async () => {
    const session = new ReviewSession(baseDeps({ queue: [], nextDueLabel: 'tomorrow at 9am' }));
    await session.start();
    expect(session.getViewModel()).toEqual({ phase: 'empty', nextDueLabel: 'tomorrow at 9am' });
  });
});

describe('F2.2 — nothing is ratable before reveal, reveal unlocks all four', () => {
  it('a fresh Q&A card starts on the front, unrevealed', async () => {
    const item = queueItem(qaFixture());
    const session = new ReviewSession(baseDeps({ queue: [item] }));
    await session.start();

    const vm = session.getViewModel();
    expect(vm.phase).toBe('front');
  });

  it('rating before reveal is a no-op', async () => {
    const item = queueItem(qaFixture());
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: [item], reviewLog }));
    await session.start();

    await session.rate('good');

    expect(session.getViewModel().phase).toBe('front');
    expect(reviewLog.calls).toHaveLength(0);
  });

  it('reveal moves to the reveal phase with all four rating previews', async () => {
    const item = queueItem(qaFixture());
    const session = new ReviewSession(baseDeps({ queue: [item] }));
    await session.start();

    session.reveal();

    const vm = session.getViewModel();
    expect(vm.phase).toBe('reveal');
    if (vm.phase === 'reveal') {
      expect(vm.ratingPreviews.map((p) => p.rating)).toEqual(['again', 'hard', 'good', 'easy']);
    }
  });

  it('Space again (flip-back) returns to the front before rating', async () => {
    const item = queueItem(qaFixture());
    const session = new ReviewSession(baseDeps({ queue: [item] }));
    await session.start();
    session.reveal();
    session.flipBack();
    expect(session.getViewModel().phase).toBe('front');
  });
});

describe('F2.2 — advancing is immediate', () => {
  it('rating an item immediately presents the next one', async () => {
    const items = [
      queueItem(qaFixture({ instrumentId: 'a' })),
      queueItem(qaFixture({ instrumentId: 'b' })),
    ];
    const session = new ReviewSession(baseDeps({ queue: items }));
    await session.start();
    session.reveal();

    await session.rate('good');

    const vm = session.getViewModel();
    expect(vm.phase).toBe('front');
    if (vm.phase === 'front') expect(vm.instrument.instrumentId).toBe('b');
  });

  it('rating the last item reaches session-complete', async () => {
    const item = queueItem(qaFixture());
    const session = new ReviewSession(baseDeps({ queue: [item] }));
    await session.start();
    session.reveal();

    await session.rate('good');

    expect(session.getViewModel().phase).toBe('complete');
  });
});

describe('F2.16 — MCQ rating mapping, as wired through the session', () => {
  it('correct with no tap logs Good and never offers Easy', async () => {
    const item = queueItem(mcqFixture());
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: [item], reviewLog }));
    await session.start();

    await session.mcqAnswer(0); // the fixture's correct option
    await session.mcqNext();

    expect(reviewLog.calls).toHaveLength(1);
    expect(reviewLog.calls[0]?.rating).toBe('good');
    expect(reviewLog.calls[0]?.wasUnsure).toBe(false);
  });

  it('correct with "wasn\'t sure / guessed" logs Hard', async () => {
    const item = queueItem(mcqFixture());
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: [item], reviewLog }));
    await session.start();

    await session.mcqAnswer(0);
    session.mcqToggleGuessed();
    await session.mcqNext();

    expect(reviewLog.calls[0]?.rating).toBe('hard');
    expect(reviewLog.calls[0]?.wasUnsure).toBe(true);
  });

  it('a wrong answer logs Again regardless of the tap', async () => {
    const item = queueItem(mcqFixture());
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: [item], reviewLog }));
    await session.start();

    await session.mcqAnswer(1); // wrong option in the fixture
    session.mcqToggleGuessed();
    await session.mcqNext();

    expect(reviewLog.calls[0]?.rating).toBe('again');
  });

  it('the "wasn\'t sure" tap never blocks advancing — Space always advances once answered', async () => {
    const items = [
      queueItem(mcqFixture({ instrumentId: 'm1' })),
      queueItem(qaFixture({ instrumentId: 'q1' })),
    ];
    const session = new ReviewSession(baseDeps({ queue: items }));
    await session.start();

    await session.mcqAnswer(0);
    await session.mcqNext(); // no tap at all

    const vm = session.getViewModel();
    expect(vm.phase).toBe('front');
    if (vm.phase === 'front') expect(vm.instrument.instrumentId).toBe('q1');
  });
});

describe('F2.6 — suspend', () => {
  it('suspending the current item removes it from the rest of this session immediately', async () => {
    const items = [
      queueItem(qaFixture({ instrumentId: 'a' })),
      queueItem(qaFixture({ instrumentId: 'b' })),
      queueItem(qaFixture({ instrumentId: 'c' })),
    ];
    const suspendPort = fakeSuspendPort();
    const session = new ReviewSession(baseDeps({ queue: items, suspendPort }));
    await session.start(); // showing 'a'

    await session.suspend();

    // The concept set travels with the id (`ol-xvmx`) — it is not
    // reconstructible later if the instrument's note moves or is deleted.
    expect(suspendPort.calls).toEqual([{ instrumentId: 'a', conceptIds: ['concept-1'] }]);
    const vm = session.getViewModel();
    expect(vm.phase).toBe('front');
    if (vm.phase === 'front') expect(vm.instrument.instrumentId).toBe('b');
  });

  it('suspending does not touch the review log — no rating is recorded', async () => {
    const item = queueItem(qaFixture());
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: [item], reviewLog }));
    await session.start();

    await session.suspend();

    expect(reviewLog.calls).toHaveLength(0);
  });

  it('suspending the only remaining item reaches session-complete, not empty', async () => {
    const item = queueItem(qaFixture());
    const session = new ReviewSession(baseDeps({ queue: [item] }));
    await session.start();

    await session.suspend();

    expect(session.getViewModel().phase).toBe('complete');
  });

  it('progress total shrinks after a suspend (F2.2 progress reflects what is actually left)', async () => {
    const items = [
      queueItem(qaFixture({ instrumentId: 'a' })),
      queueItem(qaFixture({ instrumentId: 'b' })),
    ];
    const session = new ReviewSession(baseDeps({ queue: items }));
    await session.start();

    let vm = session.getViewModel();
    expect(vm.phase === 'front' && vm.progress).toEqual({ position: 1, total: 2 });

    await session.suspend();
    vm = session.getViewModel();
    expect(vm.phase === 'front' && vm.progress).toEqual({ position: 1, total: 1 });
  });

  it('edit calls the EditPort with the current instrument and does not advance', async () => {
    const item = queueItem(qaFixture());
    const editPort = fakeEditPort();
    const session = new ReviewSession(baseDeps({ queue: [item], editPort }));
    await session.start();

    await session.edit();

    expect(editPort.calls).toHaveLength(1);
    expect(session.getViewModel().phase).toBe('front');
  });
});

describe('F2.6 — source note deleted since scheduling', () => {
  it('an item whose note is gone presents note-missing instead of crashing', async () => {
    const item = queueItem(qaFixture({ sourcePath: 'Courses/PSYC210/gone.md' }));
    const session = new ReviewSession(
      baseDeps({ queue: [item], noteExists: fakeNoteExists(['Courses/PSYC210/gone.md']) }),
    );
    await session.start();

    expect(session.getViewModel().phase).toBe('note-missing');
  });

  it('skipping a missing note moves to the next item without logging anything', async () => {
    const items = [
      queueItem(qaFixture({ instrumentId: 'gone', sourcePath: 'Courses/PSYC210/gone.md' })),
      queueItem(qaFixture({ instrumentId: 'ok' })),
    ];
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(
      baseDeps({
        queue: items,
        reviewLog,
        noteExists: fakeNoteExists(['Courses/PSYC210/gone.md']),
      }),
    );
    await session.start();

    await session.skipMissingNote();

    const vm = session.getViewModel();
    expect(vm.phase).toBe('front');
    if (vm.phase === 'front') expect(vm.instrument.instrumentId).toBe('ok');
    expect(reviewLog.calls).toHaveLength(0);
  });

  it('removing a missing note also advances, and shrinks total the same way suspend does', async () => {
    const items = [
      queueItem(qaFixture({ instrumentId: 'gone', sourcePath: 'Courses/PSYC210/gone.md' })),
      queueItem(qaFixture({ instrumentId: 'ok' })),
    ];
    const session = new ReviewSession(
      baseDeps({ queue: items, noteExists: fakeNoteExists(['Courses/PSYC210/gone.md']) }),
    );
    await session.start();

    await session.removeMissingNote();

    const vm = session.getViewModel();
    expect(vm.phase === 'front' && vm.progress.total).toBe(1);
  });
});

describe('session-complete summary', () => {
  it('counts reviewed items, distinct course codes, and items due today/tomorrow — no rating tally (rejected at DP-1)', async () => {
    const items = [
      queueItem(qaFixture({ instrumentId: 'a', courseCode: 'PSYC210' })),
      queueItem(clozeFixture({ instrumentId: 'b', courseCode: 'PSYC210' })),
      queueItem(qaFixture({ instrumentId: 'c', courseCode: 'HIST150' })),
    ];
    const session = new ReviewSession(baseDeps({ queue: items }));
    await session.start();

    session.reveal();
    await session.rate('again'); // interval 0 -> due today, counts as "due soon"
    session.reveal();
    await session.rate('easy'); // interval 14 -> not due soon
    session.reveal();
    await session.rate('hard'); // interval 2 -> not due soon

    const vm = session.getViewModel();
    expect(vm.phase).toBe('complete');
    if (vm.phase === 'complete') {
      expect(vm.summary).toEqual({
        reviewedCount: 3,
        courseCodes: ['HIST150', 'PSYC210'],
        dueSoonCount: 1,
      });
      // The DP-1-rejected element was a per-rating tally (Again/Hard/Good/Easy counts)
      // badged "Speculative". Nothing in this shape carries a per-rating breakdown.
      expect(Object.keys(vm.summary).sort()).toEqual([
        'courseCodes',
        'dueSoonCount',
        'reviewedCount',
      ]);
    }
  });

  it('a suspended item contributes nothing to the summary', async () => {
    const items = [
      queueItem(qaFixture({ instrumentId: 'a' })),
      queueItem(qaFixture({ instrumentId: 'b' })),
    ];
    const session = new ReviewSession(baseDeps({ queue: items }));
    await session.start();

    await session.suspend(); // 'a' suspended
    session.reveal();
    await session.rate('good'); // 'b' reviewed

    const vm = session.getViewModel();
    if (vm.phase === 'complete') expect(vm.summary.reviewedCount).toBe(1);
  });
});

describe('review-log write shape (D7.1, F2.14)', () => {
  it("passes the queue item's own selectionContext straight through, untouched", async () => {
    const selectionContext = {
      dueState: 'overdue' as const,
      examProximity: 3,
      yieldRank: null,
      instrumentTypesOffered: ['qa' as const],
      planVersion: null,
    };
    const item = queueItem(qaFixture(), { selectionContext });
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: [item], reviewLog }));
    await session.start();
    session.reveal();
    await session.rate('good');

    expect(reviewLog.calls[0]?.selectionContext).toEqual(selectionContext);
  });

  it('records a non-negative durationMs measured from presentation to rating', async () => {
    const item = queueItem(qaFixture());
    const reviewLog = fakeReviewLog();
    const clock = fixedClock('2026-08-10T09:00:00Z');
    const session = new ReviewSession(baseDeps({ queue: [item], reviewLog, clock }));
    await session.start();
    session.reveal();
    clock.advance(4200);
    await session.rate('good');

    expect(reviewLog.calls[0]?.durationMs).toBe(4200);
  });

  // [SUPP-3] (`ol-lpl4`): `queue-adapter.ts` computes `instrument.supportLevel`
  // at adaptation time; this is the write-seam half — `logAndAdvance` must
  // carry it straight into `RecordReviewInput.supportLevel` unchanged, the
  // same seam `ports.ts` already merges into `supportLevelShown` ([SUPP-2]).
  it('carries the instrument’s chooser decision into RecordReviewInput.supportLevel', async () => {
    const item = queueItem(
      qaFixture({ supportLevel: { level: 'guided', provenance: 'evidence-thin' } }),
    );
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: [item], reviewLog }));
    await session.start();
    session.reveal();
    await session.rate('good');

    expect(reviewLog.calls[0]?.supportLevel).toEqual({
      level: 'guided',
      provenance: 'evidence-thin',
    });
  });

  it('an instrument with no chooser decision writes no supportLevel field at all', async () => {
    const item = queueItem(qaFixture());
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: [item], reviewLog }));
    await session.start();
    session.reveal();
    await session.rate('good');

    expect(Object.hasOwn(reviewLog.calls[0] ?? {}, 'supportLevel')).toBe(false);
  });

  it('an MCQ item (no ladder tier, [D-094]) writes no supportLevel field either', async () => {
    const item = queueItem(mcqFixture());
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: [item], reviewLog }));
    await session.start();
    await session.mcqAnswer(0);
    await session.mcqNext();

    expect(Object.hasOwn(reviewLog.calls[0] ?? {}, 'supportLevel')).toBe(false);
  });
});

describe('F2.16 — the session maps through core, and holds no mapping of its own', () => {
  // Scenario: features/F2-review.md, "F2.16 — One rating mapping, not two".
  // The three cases below are also asserted individually above; what this adds
  // is that the recorded rating is *the same value* `olea-core`'s mapper
  // produces for the same facts, computed here rather than re-typed. A plugin
  // that quietly reintroduced its own mapping would have to agree with core on
  // every one of these to stay green — which is the only guarantee worth
  // having, since a copy that agrees today is a copy that drifts tomorrow.
  // `rating-source.spec.ts` is the other half: no copy exists to drift.
  it.each([
    { correct: true, wasUnsure: false },
    { correct: true, wasUnsure: true },
    { correct: false, wasUnsure: false },
    { correct: false, wasUnsure: true },
  ])('correct=$correct wasUnsure=$wasUnsure logs core’s rating', async (outcome) => {
    const instrument = mcqFixture();
    const correctIndex = instrument.options.findIndex((o) => o.correct);
    const wrongIndex = instrument.options.findIndex((o) => !o.correct);
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: [queueItem(instrument)], reviewLog }));
    await session.start();

    await session.mcqAnswer(outcome.correct ? correctIndex : wrongIndex);
    if (outcome.wasUnsure) session.mcqToggleGuessed();
    await session.mcqNext();

    expect(reviewLog.calls[0]?.rating).toBe(mapMcqRating({ type: 'mcq', ...outcome }));
    expect(reviewLog.calls[0]?.wasUnsure).toBe(outcome.wasUnsure);
  });

  it('Easy is unreachable from an MCQ, whatever she taps', async () => {
    const instrument = mcqFixture();
    for (const [index] of instrument.options.entries()) {
      for (const unsure of [false, true]) {
        const reviewLog = fakeReviewLog();
        const session = new ReviewSession(baseDeps({ queue: [queueItem(instrument)], reviewLog }));
        await session.start();
        await session.mcqAnswer(index);
        if (unsure) session.mcqToggleGuessed();
        await session.mcqNext();
        expect(reviewLog.calls[0]?.rating).not.toBe('easy');
      }
    }
  });
});

describe('F2.12 — confusion routing wired into the review flow (ol-h2bx)', () => {
  it('with no evaluator wired, no offer is ever produced (same "simply cannot offer it" posture as explainWhyPort)', async () => {
    const item = queueItem(qaFixture());
    const session = new ReviewSession(baseDeps({ queue: [item], scheduler: fakeScheduler(4) }));
    await session.start();
    session.reveal();

    await session.rate('again');

    expect(session.getConfusionRoutingOffer()).toBeNull();
  });

  it('offers, for the instrument just rated, using the SAME Scheduler.schedule call the interval preview already made', async () => {
    const instrument = qaFixture();
    const item = queueItem(instrument);
    const scheduler = fakeScheduler(4);
    const calls: unknown[] = [];
    const session = new ReviewSession(
      baseDeps({
        queue: [item],
        scheduler,
        evaluateConfusionRouting: (input) => {
          calls.push(input);
          return { shouldOffer: true, lapses: input.lapses, promptText: 'offer text' };
        },
      }),
    );
    await session.start();
    session.reveal();

    await session.rate('again');

    expect(calls).toEqual([{ rating: 'again', lapses: 4 }]);
    // One `schedule` call for THIS rating — not a second one made just to
    // read `lapses` back out.
    expect(
      (scheduler.schedule as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ).toHaveLength(1);
    expect(session.getConfusionRoutingOffer()).toEqual({
      instrument,
      promptText: 'offer text',
    });
  });

  it('never offers when the evaluator says not to (below threshold, or not an Again)', async () => {
    const item = queueItem(qaFixture());
    const session = new ReviewSession(
      baseDeps({
        queue: [item],
        scheduler: fakeScheduler(1),
        evaluateConfusionRouting: () => ({ shouldOffer: false }),
      }),
    );
    await session.start();
    session.reveal();

    await session.rate('again');

    expect(session.getConfusionRoutingOffer()).toBeNull();
  });

  it('a later graded review clears a stale offer that was never accepted (no nagging)', async () => {
    const items = [
      queueItem(qaFixture({ instrumentId: 'a' })),
      queueItem(qaFixture({ instrumentId: 'b' })),
    ];
    const session = new ReviewSession(
      baseDeps({
        queue: items,
        scheduler: fakeScheduler((rating) => (rating === 'again' ? 4 : 0)),
        evaluateConfusionRouting: (input) =>
          input.rating === 'again' && input.lapses >= 4
            ? { shouldOffer: true, lapses: input.lapses, promptText: 'offer text' }
            : { shouldOffer: false },
      }),
    );
    await session.start();
    session.reveal();
    await session.rate('again');
    expect(session.getConfusionRoutingOffer()).not.toBeNull();

    session.reveal();
    await session.rate('good');

    expect(session.getConfusionRoutingOffer()).toBeNull();
  });

  it("accepting the offer requests the SAME on-demand explanation F2.7's requestExplainWhy uses, and clears the offer", async () => {
    const instrument = qaFixture();
    const item = queueItem(instrument);
    const calls: unknown[] = [];
    const explainWhyPort = {
      explainWhy: async (request: unknown) => {
        calls.push(request);
        return { refused: false as const, text: 'Because...', citedChunkIndex: 1 };
      },
    };
    const session = new ReviewSession(
      baseDeps({
        queue: [item],
        scheduler: fakeScheduler(4),
        explainWhyPort,
        evaluateConfusionRouting: (input) => ({
          shouldOffer: true,
          lapses: input.lapses,
          promptText: 'offer text',
        }),
      }),
    );
    await session.start();
    session.reveal();
    await session.rate('again');
    expect(session.getConfusionRoutingOffer()).not.toBeNull();

    const outcome = await session.acceptConfusionRoutingOffer(['a source passage']);

    expect(outcome).toEqual({ refused: false, text: 'Because...', citedChunkIndex: 1 });
    expect(calls).toEqual([
      {
        courseCode: instrument.courseCode,
        question: instrument.question,
        studentAnswer: '',
        correctAnswer: instrument.answer,
        sourceChunks: ['a source passage'],
      },
    ]);
    expect(session.getConfusionRoutingOffer()).toBeNull();
  });

  it('accepting with no explainWhyPort wired returns null and still clears the offer (F7.8)', async () => {
    const session = new ReviewSession(
      baseDeps({
        queue: [queueItem(qaFixture())],
        scheduler: fakeScheduler(4),
        evaluateConfusionRouting: (input) => ({
          shouldOffer: true,
          lapses: input.lapses,
          promptText: 'offer text',
        }),
      }),
    );
    await session.start();
    session.reveal();
    await session.rate('again');

    const outcome = await session.acceptConfusionRoutingOffer([]);

    expect(outcome).toBeNull();
    expect(session.getConfusionRoutingOffer()).toBeNull();
  });

  it('accepting with nothing pending is a no-op, never throws', async () => {
    const session = new ReviewSession(baseDeps({ queue: [queueItem(qaFixture())] }));
    await session.start();

    const outcome = await session.acceptConfusionRoutingOffer([]);

    expect(outcome).toBeNull();
  });
});
