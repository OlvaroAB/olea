/**
 * `heading-offer-wiring.ts` tests (F2.10 surface wiring, `ol-i19f`).
 *
 * Scenario: `features/F2-review.md`, F2.10's offer/toggle scenarios —
 * @auto:plugin/review/heading-offer-wiring.spec.
 *
 * INV-3: every note, heading, course and concept below is invented for this
 * suite — none copied from `docs/design/pass1/` or any real vault.
 *
 * Four things this file proves, one per `describe` block:
 * 1. **Detection reaches the real port**: a question-shaped, uncovered
 *    heading in the item's own note, with a unique concept on that note,
 *    produces a banner whose `accept`/`dismiss` call the real
 *    `HeadingOfferPort` with the resolved candidate and context.
 * 2. **Every conservative "offer nothing" path is honoured**: no candidate,
 *    an already-dismissed candidate, zero or ambiguous concept matches, a
 *    missing note, and the toggle off — all resolve to `null`, never a
 *    guess.
 * 3. **"Offer one"**: of several undismissed candidates in one note, only
 *    the first is ever offered.
 * 4. **The tracker** caches per note path, drops a superseded in-flight
 *    check, and clears its cache the moment she accepts or dismisses so the
 *    banner does not linger.
 */
import type { ConceptRecord, HeadingOfferCandidate } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import {
  createHeadingOfferPort,
  type HeadingOfferAcceptOutcome,
  type HeadingOfferPort,
} from '../../src/review/heading-offer.js';
import {
  createHeadingOfferBannerTracker,
  createHeadingOfferForItem,
  type HeadingOfferBannerState,
  type HeadingOfferForItem,
  type HeadingOfferWiringDeps,
} from '../../src/review/heading-offer-wiring.js';
import { MemoryVaultSource } from '../generation/fakes.js';

const NOTE_PATH = '01 Courses/COGS214/Week 2.md';
const OTHER_NOTE_PATH = '01 Courses/COGS214/Week 3.md';
const COURSE_CODE = 'COGS214';

const QUESTION_NOTE = [
  '# Week 2',
  '',
  '## Does chunking extend working memory capacity?',
  '',
  'Some prose about chunking.',
  '',
  '## Retrieval practice',
  '',
  'Not a question.',
  '',
].join('\n');

const TWO_QUESTIONS_NOTE = [
  '## Does chunking extend working memory capacity?',
  '',
  'Prose one.',
  '',
  '## Is spaced repetition more effective than massed practice?',
  '',
  'Prose two.',
  '',
].join('\n');

const COVERED_QUESTION_NOTE = [
  '## Does chunking extend working memory capacity?',
  '',
  'Does chunking extend working memory capacity?::Yes, by grouping items into fewer meaningful units.',
  '',
].join('\n');

function conceptFixture(overrides: Partial<ConceptRecord> = {}): ConceptRecord {
  return {
    key: 'concept-key-chunking',
    name: 'Chunking',
    tier: 1,
    courses: [COURSE_CODE],
    sourcePaths: [NOTE_PATH],
    ...overrides,
  };
}

function buildPort(): HeadingOfferPort {
  const cache = createVaultDraftCacheStore(new MemoryVaultSource());
  return createHeadingOfferPort({ cache, draftDeps: () => null });
}

function buildDeps(overrides: Partial<HeadingOfferWiringDeps> = {}): HeadingOfferWiringDeps {
  return {
    vault: new MemoryVaultSource({ [NOTE_PATH]: QUESTION_NOTE }),
    port: buildPort(),
    conceptRecords: () => [conceptFixture()],
    ...overrides,
  };
}

describe('createHeadingOfferForItem — the real destination is reached', () => {
  it('offers the uncovered question-shaped heading against its unique concept', async () => {
    const port = buildPort();
    const detect = createHeadingOfferForItem(
      buildDeps({ port, conceptRecords: () => [conceptFixture()] }),
    );

    const state = await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE });

    expect(state).not.toBeNull();
    expect(state?.promptText).toBe('This looks like a question but has no card yet.');
  });

  it('accept() calls the real port with the detected candidate and the resolved concept/course/note', async () => {
    const port = buildPort();
    const acceptSpy = vi.spyOn(port, 'accept');
    const detect = createHeadingOfferForItem(buildDeps({ port }));

    const state = await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE });
    await state?.accept();

    expect(acceptSpy).toHaveBeenCalledTimes(1);
    const [candidate, context] = acceptSpy.mock.calls[0] as [HeadingOfferCandidate, unknown];
    expect(candidate.headingText).toBe('Does chunking extend working memory capacity?');
    expect(context).toEqual({
      courseCode: COURSE_CODE,
      concept: conceptFixture(),
      sourcePath: NOTE_PATH,
    });
  });

  it('accept() also dismisses, so the same candidate is never offered again this session', async () => {
    const port = buildPort();
    const detect = createHeadingOfferForItem(buildDeps({ port }));

    const first = await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE });
    await first?.accept();
    const second = await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE });

    expect(second).toBeNull();
  });

  it('dismiss() calls the real port and suppresses the same candidate on the next check', async () => {
    const port = buildPort();
    const dismissSpy = vi.spyOn(port, 'dismiss');
    const detect = createHeadingOfferForItem(buildDeps({ port }));

    const first = await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE });
    first?.dismiss();
    const second = await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE });

    expect(dismissSpy).toHaveBeenCalledTimes(1);
    expect(second).toBeNull();
  });

  it('dismiss() writes nothing to the vault (D7.1 — F2.10 dismiss is honestly in-memory only)', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: QUESTION_NOTE });
    const writeSpy = vi.spyOn(vault, 'write');
    const detect = createHeadingOfferForItem(buildDeps({ vault }));

    const state = await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE });
    state?.dismiss();

    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('createHeadingOfferForItem — every conservative "offer nothing" path', () => {
  it('returns null when no heading in the note is question-shaped or all are covered', async () => {
    const detect = createHeadingOfferForItem(
      buildDeps({ vault: new MemoryVaultSource({ [NOTE_PATH]: COVERED_QUESTION_NOTE }) }),
    );
    expect(await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE })).toBeNull();
  });

  it('returns null when the note does not exist', async () => {
    const detect = createHeadingOfferForItem(buildDeps({ vault: new MemoryVaultSource({}) }));
    expect(await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE })).toBeNull();
  });

  it('returns null when no concept names this note (zero matches — never guessed)', async () => {
    const detect = createHeadingOfferForItem(buildDeps({ conceptRecords: () => [] }));
    expect(await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE })).toBeNull();
  });

  it('returns null when more than one concept names this note (ambiguous — never guessed)', async () => {
    const detect = createHeadingOfferForItem(
      buildDeps({
        conceptRecords: () => [
          conceptFixture({ key: 'a', name: 'Chunking' }),
          conceptFixture({ key: 'b', name: 'Working memory' }),
        ],
      }),
    );
    expect(await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE })).toBeNull();
  });

  it('returns null when concept records have not folded yet (conceptRecords() === null)', async () => {
    const detect = createHeadingOfferForItem(buildDeps({ conceptRecords: () => null }));
    expect(await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE })).toBeNull();
  });

  it('returns null when the toggle is off', async () => {
    const detect = createHeadingOfferForItem(buildDeps({ enabled: () => false }));
    expect(await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE })).toBeNull();
  });

  it('returns a banner when the toggle is explicitly on, or omitted entirely', async () => {
    const on = createHeadingOfferForItem(buildDeps({ enabled: () => true }));
    const omitted = createHeadingOfferForItem(buildDeps());
    expect(await on({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE })).not.toBeNull();
    expect(await omitted({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE })).not.toBeNull();
  });
});

describe('createHeadingOfferForItem — "offer one" (F2.10\'s own phrase)', () => {
  it('offers only the first undismissed candidate when the note has several', async () => {
    const port = buildPort();
    const vault = new MemoryVaultSource({ [NOTE_PATH]: TWO_QUESTIONS_NOTE });
    const detect = createHeadingOfferForItem(buildDeps({ vault, port }));

    const first = await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE });
    expect(first?.promptText).toBe('This looks like a question but has no card yet.');

    // Dismissing the first reveals the second — still one at a time, never both.
    first?.dismiss();
    const second = await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE });
    expect(second).not.toBeNull();

    second?.dismiss();
    const third = await detect({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE });
    expect(third).toBeNull();
  });
});

describe('createHeadingOfferBannerTracker', () => {
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  function fakeState(promptText = 'offer'): HeadingOfferBannerState {
    return {
      promptText,
      accept: async (): Promise<HeadingOfferAcceptOutcome> => ({
        kind: 'drafted',
        draftIds: ['d1'],
      }),
      dismiss: () => {},
    };
  }

  it('returns null synchronously and calls onUpdate once the background check resolves', async () => {
    const { promise, resolve } = deferred<HeadingOfferBannerState | null>();
    const detect: HeadingOfferForItem = vi.fn(() => promise);
    const onUpdate = vi.fn();
    const tracker = createHeadingOfferBannerTracker(detect);

    const initial = tracker.bannerFor({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE }, onUpdate);
    expect(initial).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();

    resolve(fakeState());
    await promise;
    await Promise.resolve();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const after = tracker.bannerFor({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE }, onUpdate);
    expect(after?.promptText).toBe('offer');
  });

  it('does not re-check the same note path on a repeat call', async () => {
    const detect: HeadingOfferForItem = vi.fn(async () => fakeState());
    const tracker = createHeadingOfferBannerTracker(detect);
    const onUpdate = vi.fn();

    tracker.bannerFor({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE }, onUpdate);
    await Promise.resolve();
    await Promise.resolve();
    tracker.bannerFor({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE }, onUpdate);
    tracker.bannerFor({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE }, onUpdate);

    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('drops a superseded check when the item changes before it resolves', async () => {
    const first = deferred<HeadingOfferBannerState | null>();
    const detect: HeadingOfferForItem = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(fakeState('second-note-offer'));
    const onUpdate = vi.fn();
    const tracker = createHeadingOfferBannerTracker(detect);

    tracker.bannerFor({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE }, onUpdate);
    tracker.bannerFor({ sourcePath: OTHER_NOTE_PATH, courseCode: COURSE_CODE }, onUpdate);
    await Promise.resolve();
    await Promise.resolve();

    // The second (current) path's check already resolved and won.
    const currentForSecond = tracker.bannerFor(
      { sourcePath: OTHER_NOTE_PATH, courseCode: COURSE_CODE },
      onUpdate,
    );
    expect(currentForSecond?.promptText).toBe('second-note-offer');

    // The stale first path's check resolving now must not overwrite it.
    first.resolve(fakeState('stale-first-note-offer'));
    await first.promise;
    await Promise.resolve();

    const stillSecond = tracker.bannerFor(
      { sourcePath: OTHER_NOTE_PATH, courseCode: COURSE_CODE },
      onUpdate,
    );
    expect(stillSecond?.promptText).toBe('second-note-offer');
  });

  it('clears the cached banner as soon as she accepts or dismisses, so it does not linger', async () => {
    const detect: HeadingOfferForItem = vi.fn(async () => fakeState());
    const onUpdate = vi.fn();
    const tracker = createHeadingOfferBannerTracker(detect);

    tracker.bannerFor({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE }, onUpdate);
    await Promise.resolve();
    await Promise.resolve();

    const shown = tracker.bannerFor({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE }, onUpdate);
    expect(shown).not.toBeNull();

    await shown?.accept();
    const afterAccept = tracker.bannerFor(
      { sourcePath: NOTE_PATH, courseCode: COURSE_CODE },
      onUpdate,
    );
    expect(afterAccept).toBeNull();
    // Still the same note path, so no second background check was started.
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('resets on a null item (no current instrument) and re-checks when one reappears', () => {
    const detect: HeadingOfferForItem = vi.fn(async () => fakeState());
    const tracker = createHeadingOfferBannerTracker(detect);
    const onUpdate = vi.fn();

    tracker.bannerFor(null, onUpdate);
    tracker.bannerFor({ sourcePath: NOTE_PATH, courseCode: COURSE_CODE }, onUpdate);

    expect(detect).toHaveBeenCalledTimes(1);
  });
});
