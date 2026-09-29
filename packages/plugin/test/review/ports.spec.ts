/**
 * `createVaultNoteExistsPort` (`ol-t5lj`, F2.6) and `createVaultSuspendPort`
 * (`ol-xvmx`, F2.6's durable half, D-020).
 *
 * The point of the change both cover is that the port needs a `VaultSource`
 * and nothing else — so the test that proves it is one that drives it against
 * a plain fake with no Obsidian anywhere. If either port ever reaches for an
 * `App` again, this file stops compiling.
 */

import type { SelectionContextV4 } from 'olea-contracts';
import type { VaultSource } from 'olea-core';
import { calendarDayFromLocalDate, parseReviewLog, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  createVaultExplainBackOfferLogPort,
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
  isoWithLocalOffset,
} from '../../src/review/ports.js';
import type { ReviewInstrument } from '../../src/review/types.js';
import { memoryVault } from './memory-vault.js';

/** Only `exists` is reachable from this port; the rest throw so a widened implementation is caught rather than silently tolerated. */
function fakeVault(present: readonly string[]): { vault: VaultSource; asked: string[] } {
  const asked: string[] = [];
  const unreachable = (name: string) => () => {
    throw new Error(`createVaultNoteExistsPort must not call VaultSource.${name}`);
  };
  const vault = {
    exists: async (path: string) => {
      asked.push(path);
      return present.includes(path);
    },
    list: unreachable('list'),
    read: unreachable('read'),
    readBinary: unreachable('readBinary'),
    write: unreachable('write'),
    watch: unreachable('watch'),
  } as unknown as VaultSource;
  return { vault, asked };
}

describe('createVaultNoteExistsPort', () => {
  it('reports true for a path the vault has', async () => {
    const { vault } = fakeVault(['01 Courses/GEOL204/Synapses.md']);
    const port = createVaultNoteExistsPort(vault);
    await expect(port.exists('01 Courses/GEOL204/Synapses.md')).resolves.toBe(true);
  });

  it("reports false for a note that has been deleted since it was scheduled (F2.6's note-missing screen)", async () => {
    const { vault } = fakeVault(['01 Courses/GEOL204/Synapses.md']);
    const port = createVaultNoteExistsPort(vault);
    await expect(port.exists('01 Courses/GEOL204/Deleted.md')).resolves.toBe(false);
  });

  it('asks the vault for exactly the path it was given, unmodified', async () => {
    const { vault, asked } = fakeVault([]);
    const port = createVaultNoteExistsPort(vault);
    await port.exists('01 Courses/MUSTH104/Chorale No. 12/Aural notes.md');
    expect(asked).toEqual(['01 Courses/MUSTH104/Chorale No. 12/Aural notes.md']);
  });

  it('uses only VaultSource.exists — never another vault method', async () => {
    const { vault } = fakeVault(['a.md']);
    const port = createVaultNoteExistsPort(vault);
    await expect(port.exists('a.md')).resolves.toBe(true);
    await expect(port.exists('b.md')).resolves.toBe(false);
  });
});

describe('createVaultSuspendPort', () => {
  const DEVICE = 'ports-spec-device';

  /** Where `appendSuspendRecord` lands a same-day event, exactly as `open-session.spec.ts`'s helper does. */
  function todaysLogPath(): string {
    return reviewLogPath(calendarDayFromLocalDate(new Date()), DEVICE);
  }

  it('writes a durable suspend record carrying the instrument id and its concept ids (ol-xvmx)', async () => {
    const vault = memoryVault();
    const port = createVaultSuspendPort(vault, DEVICE);

    await port.suspend('inst-1', ['concept-a', 'concept-b']);

    const logPath = todaysLogPath();
    const written = vault.contentOf(logPath);
    expect(
      written,
      `expected a log at ${logPath}, wrote: ${vault.writes.join(', ')}`,
    ).toBeDefined();

    const parsed = parseReviewLog(written ?? '');
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records).toHaveLength(1);
    const record = parsed.records[0];
    expect(record?.kind).toBe('suspend');
    if (record?.kind !== 'suspend') return;
    expect(record.instrumentId).toBe('inst-1');
    expect(record.conceptIds).toEqual(['concept-a', 'concept-b']);
  });

  it('copies conceptIds rather than holding the caller’s array (matches createVaultReviewLogPort)', async () => {
    const vault = memoryVault();
    const port = createVaultSuspendPort(vault, DEVICE);
    const conceptIds: string[] = ['concept-a'];

    await port.suspend('inst-1', conceptIds);
    // Mutating the caller's array after the write must not retroactively change
    // what was already persisted — proof that the port copied, not aliased.
    conceptIds.push('concept-b');

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    const record = parsed.records[0];
    expect(record?.kind).toBe('suspend');
    if (record?.kind !== 'suspend') return;
    expect(record.conceptIds).toEqual(['concept-a']);
  });

  it('rejects an empty concept list rather than writing an un-backfillable record', async () => {
    const vault = memoryVault();
    const port = createVaultSuspendPort(vault, DEVICE);

    await expect(port.suspend('inst-1', [])).rejects.toThrow();
    expect(vault.writes).toEqual([]);
  });

  it('a second suspend for the same instrument appends rather than replacing the first', async () => {
    const vault = memoryVault();
    const port = createVaultSuspendPort(vault, DEVICE);

    await port.suspend('inst-1', ['concept-a']);
    await port.suspend('inst-2', ['concept-b']);

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    // `[D-133]`'s `succession` kind and `[D-134]` Q5's three retrospective
    // offer kinds carry no `instrumentId` — narrowed away here even though
    // this suite never writes them, so the static type of `.records`, the
    // whole current-version union, still checks.
    const suspensions = parsed.records.filter(
      (
        r,
      ): r is Exclude<
        typeof r,
        | { kind: 'succession' }
        | { kind: 'retrospective-offered' }
        | { kind: 'retrospective-opened' }
        | { kind: 'retrospective-dismissed' }
        // `[D-226]` ruling 1: names a path, a role and a course — never an
        // instrument, the same reason `succession`/the retrospective-offer
        // trio are excluded above.
        | { kind: 'source-registered' }
        // ol-egov.141.89.6.37: a non-attempt names concepts, never an instrument.
        | { kind: 'non-attempt' }
      > =>
        r.kind !== 'succession' &&
        r.kind !== 'retrospective-offered' &&
        r.kind !== 'retrospective-opened' &&
        r.kind !== 'retrospective-dismissed' &&
        r.kind !== 'source-registered' &&
        r.kind !== 'non-attempt',
    );
    expect(suspensions.map((r) => r.instrumentId)).toEqual(['inst-1', 'inst-2']);
    expect(new Set(suspensions.map((r) => r.eventId)).size).toBe(2);
  });
});

describe('the plugin clock seam reaches every event-writing port (ol-3ux7.64.9 [WBX-8])', () => {
  // `main.ts`'s `this.now` (a bound function reading `this.clock` live) is
  // now the third argument every one of these three ports takes — grouped
  // here rather than one test per port, since the thing worth proving is the
  // SAME for all three: a stubbed clock reaches the written record's own
  // timestamp, and the calendar day the record's log path encodes moves with
  // it, not just the field's raw string.
  const DEVICE = 'ports-spec-clock-device';
  const STUBBED_NOW = new Date('2031-03-17T09:30:00.000Z');
  const stubClock = () => STUBBED_NOW;

  const INSTRUMENT: ReviewInstrument = {
    instrumentId: 'inst-clock-1',
    conceptIds: ['concept-clock'],
    courseCode: 'COGS214',
    noteTitle: 'Sample note',
    sourcePath: 'Courses/COGS214/Note.md',
    blockId: null,
    draftId: null,
    type: 'qa',
    question: 'What is it?',
    answer: 'It is this.',
  };

  const SELECTION_CONTEXT: SelectionContextV4 = {
    dueState: 'due',
    examProximity: null,
    yieldRank: null,
    instrumentTypesOffered: ['qa'],
    planVersion: null,
  };

  it('createVaultReviewLogPort stamps the stubbed instant, and the log path itself moves to that calendar day', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE, stubClock);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: SELECTION_CONTEXT,
    });

    const logPath = reviewLogPath(calendarDayFromLocalDate(STUBBED_NOW), DEVICE);
    const parsed = parseReviewLog(vault.contentOf(logPath) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(record.timestamp).toBe(isoWithLocalOffset(STUBBED_NOW));
  });

  it('createVaultSuspendPort stamps the stubbed instant', async () => {
    const vault = memoryVault();
    const port = createVaultSuspendPort(vault, DEVICE, stubClock);

    await port.suspend('inst-clock-1', ['concept-clock']);

    const logPath = reviewLogPath(calendarDayFromLocalDate(STUBBED_NOW), DEVICE);
    const parsed = parseReviewLog(vault.contentOf(logPath) ?? '');
    const record = parsed.records[0];
    expect(record?.kind).toBe('suspend');
    if (record?.kind !== 'suspend') return;
    expect(record.timestamp).toBe(isoWithLocalOffset(STUBBED_NOW));
  });

  it('createVaultExplainBackOfferLogPort stamps the stubbed instant on both the offer and the decline', async () => {
    const vault = memoryVault();
    const port = createVaultExplainBackOfferLogPort(vault, DEVICE, stubClock);

    const offerId = port.recordOffered({
      conceptIds: ['concept-clock'],
      trigger: 'repeated-failure',
    });
    // Fire-and-forget (`ports.ts`'s own doc): let the offer's write actually
    // land — both calls append to the SAME log path, so firing the decline
    // before the offer's read-modify-write completes would race it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    port.recordDeclined({
      conceptIds: ['concept-clock'],
      trigger: 'repeated-failure',
      answers: offerId,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const logPath = reviewLogPath(calendarDayFromLocalDate(STUBBED_NOW), DEVICE);
    const parsed = parseReviewLog(vault.contentOf(logPath) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    const timestamps = parsed.records
      .filter((r): r is Extract<typeof r, { timestamp: string }> => 'timestamp' in r)
      .map((r) => r.timestamp);
    expect(timestamps).toEqual([isoWithLocalOffset(STUBBED_NOW), isoWithLocalOffset(STUBBED_NOW)]);
  });

  it('omitted, every port still defaults to the real wall clock — unchanged from before this bead', async () => {
    const vault = memoryVault();
    const before = Date.now();
    await createVaultSuspendPort(vault, DEVICE).suspend('inst-real-1', ['concept-real']);
    const after = Date.now();

    const today = calendarDayFromLocalDate(new Date());
    const parsed = parseReviewLog(vault.contentOf(reviewLogPath(today, DEVICE)) ?? '');
    const record = parsed.records[0];
    expect(record?.kind).toBe('suspend');
    if (record?.kind !== 'suspend') return;
    const writtenMs = Date.parse(record.timestamp);
    expect(writtenMs).toBeGreaterThanOrEqual(before);
    expect(writtenMs).toBeLessThanOrEqual(after + 1000);
  });
});

describe('createVaultReviewLogPort — the supportLevel write seam (ol-95vv.4)', () => {
  const DEVICE = 'ports-spec-reviewlog-device';

  const INSTRUMENT: ReviewInstrument = {
    instrumentId: 'inst-support-1',
    conceptIds: ['concept-a'],
    courseCode: 'COGS214',
    noteTitle: 'Sample note',
    sourcePath: 'Courses/COGS214/Note.md',
    blockId: null,
    draftId: null,
    type: 'qa',
    question: 'What is it?',
    answer: 'It is this.',
  };

  const SELECTION_CONTEXT: SelectionContextV4 = {
    dueState: 'due',
    examProximity: null,
    yieldRank: null,
    instrumentTypesOffered: ['qa'],
    planVersion: null,
  };

  function todaysLogPath(): string {
    return reviewLogPath(calendarDayFromLocalDate(new Date()), DEVICE);
  }

  it("merges supportLevelShown from the caller's chooser decision — only `.level`, never `.provenance` (row 3.9, [SUPP-2])", async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: SELECTION_CONTEXT,
      supportLevel: { level: 'guided', provenance: 'self-requested' },
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(record.supportLevelShown).toBe('guided');
  });

  it('writes no supportLevelShown field at all when the caller passes no chooser decision, never a fabricated one', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: SELECTION_CONTEXT,
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(Object.hasOwn(record, 'supportLevelShown')).toBe(false);
  });
});

describe('createVaultReviewLogPort — the compositionId write seam ([D-395], ol-egov.141.89.10.65)', () => {
  const DEVICE = 'ports-spec-composition-device';

  const INSTRUMENT: ReviewInstrument = {
    instrumentId: 'inst-composition-1',
    conceptIds: ['concept-a'],
    courseCode: 'COGS214',
    noteTitle: 'Sample note',
    sourcePath: 'Courses/COGS214/Note.md',
    blockId: null,
    draftId: null,
    type: 'qa',
    question: 'What is it?',
    answer: 'It is this.',
  };

  const SELECTION_CONTEXT: SelectionContextV4 = {
    dueState: 'due',
    examProximity: null,
    yieldRank: null,
    instrumentTypesOffered: ['qa'],
    planVersion: null,
  };

  function todaysLogPath(): string {
    return reviewLogPath(calendarDayFromLocalDate(new Date()), DEVICE);
  }

  it('merges compositionId verbatim when the caller (a review inside a composed session) supplies one', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: SELECTION_CONTEXT,
      compositionId: 'composition-key1:nonce-1',
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(record.compositionId).toBe('composition-key1:nonce-1');
  });

  it('writes no compositionId field at all when the caller passes none (a review outside a composed session) — never a time-joined or fabricated one', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: SELECTION_CONTEXT,
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(Object.hasOwn(record, 'compositionId')).toBe(false);
  });
});

describe('createVaultReviewLogPort — the scheduling-observation write seam ([D-185], ol-0r92.41)', () => {
  const DEVICE = 'ports-spec-scheduling-observation-device';

  const INSTRUMENT: ReviewInstrument = {
    instrumentId: 'inst-mcq-1',
    conceptIds: ['concept-a'],
    courseCode: 'COGS214',
    noteTitle: 'Sample note',
    sourcePath: 'Courses/COGS214/Note.md',
    blockId: null,
    draftId: null,
    type: 'mcq',
    stem: 'Which of these?',
    options: [
      { id: 'opt-1', label: 'This one', correct: true },
      { id: 'opt-2', label: 'Not this one', correct: false },
    ],
    feedback: 'Correct — this one.',
  };

  const SELECTION_CONTEXT: SelectionContextV4 = {
    dueState: 'due',
    examProximity: null,
    yieldRank: null,
    instrumentTypesOffered: ['mcq'],
    planVersion: null,
  };

  function todaysLogPath(): string {
    return reviewLogPath(calendarDayFromLocalDate(new Date()), DEVICE);
  }

  // [D-185] (`ol-0r92.41`) widened F5.3a/C5.11's scheduling observation from
  // explain-back-only to any instrument kind. This proves the write seam end
  // to end for an MCQ review — the type path this bead wires — even though no
  // production composer supplies `schedulingObservationInput` yet for any of
  // the three kinds `ReviewSession` owns (`session.ts`'s
  // `evaluateSchedulingObservationForGradeWrite` doc names that as a
  // follow-up, not this test's job).
  it('builds and merges schedulingObservation from the caller’s raw input, on a non-explain-back review', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: SELECTION_CONTEXT,
      schedulingObservationInput: {
        neighbourUseDemonstrated: true,
        neighbourConceptId: 'concept-neighbour',
      },
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(record.instrumentType).toBe('mcq');
    expect(record.schedulingObservation).toEqual({ neighbourConceptId: 'concept-neighbour' });
  });

  it('writes no schedulingObservation field when the caller’s input says nothing was demonstrated', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: SELECTION_CONTEXT,
      schedulingObservationInput: { neighbourUseDemonstrated: undefined },
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(Object.hasOwn(record, 'schedulingObservation')).toBe(false);
  });

  it('writes no schedulingObservation field at all when the caller passes no input, never a fabricated one', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: SELECTION_CONTEXT,
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(Object.hasOwn(record, 'schedulingObservation')).toBe(false);
  });
});

describe('createVaultReviewLogPort — the [D-205 / SIG-2] correctness write seam (ol-yj0k, ol-egov.96)', () => {
  const DEVICE = 'ports-spec-correctness-device';

  const INSTRUMENT: ReviewInstrument = {
    instrumentId: 'inst-mcq-2',
    conceptIds: ['concept-b'],
    courseCode: 'COGS214',
    noteTitle: 'Sample note',
    sourcePath: 'Courses/COGS214/Note.md',
    blockId: null,
    draftId: null,
    type: 'mcq',
    stem: 'Which of these?',
    options: [
      { id: 'opt-1', label: 'Not this one', correct: false },
      { id: 'opt-2', label: 'This one', correct: true },
    ],
    feedback: 'Correct — this one.',
  };

  const SELECTION_CONTEXT: SelectionContextV4 = {
    dueState: 'due',
    examProximity: null,
    yieldRank: null,
    instrumentTypesOffered: ['mcq'],
    planVersion: null,
  };

  function todaysLogPath(): string {
    return reviewLogPath(calendarDayFromLocalDate(new Date()), DEVICE);
  }

  it('merges the caller’s correctness verbatim — index and matched-key boolean, no transformation', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 800,
      selectionContext: SELECTION_CONTEXT,
      correctness: { chosenIndex: 1, matchedKey: true },
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(record.correctness).toEqual({ chosenIndex: 1, matchedKey: true });
  });

  it('writes no correctness field at all when the caller passes none — never a fabricated one', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 800,
      selectionContext: SELECTION_CONTEXT,
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    const record = parsed.records[0];
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(Object.hasOwn(record, 'correctness')).toBe(false);
  });
});

describe('createVaultReviewLogPort — the [D-202] misconception-observed write seam (ol-egov.92, ol-0r92.44)', () => {
  const DEVICE = 'ports-spec-misconception-device';

  const INSTRUMENT: ReviewInstrument = {
    instrumentId: 'inst-mcq-3',
    conceptIds: ['concept-c'],
    courseCode: 'COGS214',
    noteTitle: 'Sample note',
    sourcePath: 'Courses/COGS214/Note.md',
    blockId: null,
    draftId: null,
    type: 'mcq',
    stem: 'Which of these?',
    options: [
      { id: 'opt-1', label: 'Not this one', correct: false },
      { id: 'opt-2', label: 'This one', correct: true },
    ],
    feedback: 'Correct — this one.',
  };

  const SELECTION_CONTEXT: SelectionContextV4 = {
    dueState: 'due',
    examProximity: null,
    yieldRank: null,
    instrumentTypesOffered: ['mcq'],
    planVersion: null,
  };

  const DISTRACTOR = {
    text: 'Not this one',
    believes: 'a wrong belief this distractor encodes',
    source_says: 'what the source material actually says instead',
  };

  function todaysLogPath(): string {
    return reviewLogPath(calendarDayFromLocalDate(new Date()), DEVICE);
  }

  it('appends a SEPARATE misconception-observed event, never a field on the review record', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'again',
      wasUnsure: false,
      durationMs: 800,
      selectionContext: SELECTION_CONTEXT,
      correctness: { chosenIndex: 0, matchedKey: false },
      misconceptionDistractor: DISTRACTOR,
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records.map((r) => r.kind)).toEqual(['review', 'misconception-observed']);

    const [review, observed] = parsed.records;
    if (review?.kind !== 'review') throw new Error('expected a review record first');
    if (observed?.kind !== 'misconception-observed') {
      throw new Error('expected a misconception-observed record second');
    }
    expect(Object.hasOwn(review, 'misconceptionDistractor')).toBe(false);
    expect(observed.reviewEventId).toBe(review.eventId);
    expect(observed.distractor).toEqual(DISTRACTOR);
    expect(observed.conceptIds).toEqual(['concept-c']);
    expect(observed.misconceptionId.length).toBeGreaterThan(0);
  });

  it('appends nothing extra when the caller passes no misconceptionDistractor — a right pick', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'good',
      wasUnsure: false,
      durationMs: 800,
      selectionContext: SELECTION_CONTEXT,
      correctness: { chosenIndex: 1, matchedKey: true },
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.records.map((r) => r.kind)).toEqual(['review']);
  });

  it('two wrong picks of the same distractor mint two DIFFERENT misconceptionIds — never matched at write time', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'again',
      wasUnsure: false,
      durationMs: 800,
      selectionContext: SELECTION_CONTEXT,
      correctness: { chosenIndex: 0, matchedKey: false },
      misconceptionDistractor: DISTRACTOR,
    });
    await port.recordReview({
      instrument: INSTRUMENT,
      rating: 'again',
      wasUnsure: false,
      durationMs: 800,
      selectionContext: SELECTION_CONTEXT,
      correctness: { chosenIndex: 0, matchedKey: false },
      misconceptionDistractor: DISTRACTOR,
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    const observed = parsed.records.filter((r) => r.kind === 'misconception-observed');
    expect(observed).toHaveLength(2);
    if (
      observed[0]?.kind !== 'misconception-observed' ||
      observed[1]?.kind !== 'misconception-observed'
    ) {
      throw new Error('expected two misconception-observed records');
    }
    expect(observed[0].misconceptionId).not.toBe(observed[1].misconceptionId);
  });
});

describe('createVaultReviewLogPort — the named-review-id write seam (row 48, ol-egov.141.89.9.74)', () => {
  const DEVICE = 'ports-spec-named-review-device';

  const INSTRUMENT: ReviewInstrument = {
    instrumentId: 'inst-mcq-named-1',
    conceptIds: ['concept-d'],
    courseCode: 'COGS214',
    noteTitle: 'Sample note',
    sourcePath: 'Courses/COGS214/Note.md',
    blockId: null,
    draftId: null,
    type: 'mcq',
    stem: 'Which of these?',
    options: [
      { id: 'opt-1', label: 'Not this one', correct: false },
      { id: 'opt-2', label: 'This one', correct: true },
    ],
    feedback: 'Correct — this one.',
  };

  const SELECTION_CONTEXT: SelectionContextV4 = {
    dueState: 'due',
    examProximity: null,
    yieldRank: null,
    instrumentTypesOffered: ['mcq'],
    planVersion: null,
  };

  const BASE = {
    instrument: INSTRUMENT,
    rating: 'again',
    wasUnsure: false,
    durationMs: 800,
    selectionContext: SELECTION_CONTEXT,
    correctness: { chosenIndex: 0, matchedKey: false },
  } as const;

  function todaysLogPath(): string {
    return reviewLogPath(calendarDayFromLocalDate(new Date()), DEVICE);
  }

  it('writes the record under the id the caller named, verbatim', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({ ...BASE, reviewEventId: 'named-review-event-1' });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.kind).toBe('review');
    expect(parsed.records[0]?.eventId).toBe('named-review-event-1');
  });

  it('mints its own id when none is named, a fresh one per write, exactly as before', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview(BASE);
    await port.recordReview(BASE);

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    const ids = parsed.records.map((record) => record.eventId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('changes nothing but the id: a named write is the record an unnamed write would have been', async () => {
    const namedVault = memoryVault();
    const plainVault = memoryVault();
    const at = () => new Date('2026-08-21T09:05:00+02:00');
    await createVaultReviewLogPort(namedVault, DEVICE, at).recordReview({
      ...BASE,
      reviewEventId: 'named-review-event-2',
    });
    await createVaultReviewLogPort(plainVault, DEVICE, at).recordReview(BASE);

    const day = '2026-08-21';
    const named = parseReviewLog(namedVault.contentOf(reviewLogPath(day, DEVICE)) ?? '');
    const plain = parseReviewLog(plainVault.contentOf(reviewLogPath(day, DEVICE)) ?? '');
    const { eventId: namedId, ...namedRest } = named.records[0] as Record<string, unknown>;
    const { eventId: plainId, ...plainRest } = plain.records[0] as Record<string, unknown>;
    expect(namedRest).toEqual(plainRest);
    expect(namedId).toBe('named-review-event-2');
    expect(plainId).not.toBe('named-review-event-2');
  });

  it('the misconception-observed event follows the named id, so it names the record that carries that id', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      ...BASE,
      reviewEventId: 'named-review-event-3',
      misconceptionDistractor: {
        text: 'Not this one',
        believes: 'a wrong belief this distractor encodes',
        source_says: 'what the source material actually says instead',
      },
    });

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.records.map((record) => record.kind)).toEqual([
      'review',
      'misconception-observed',
    ]);
    const [review, observed] = parsed.records;
    if (observed?.kind !== 'misconception-observed') throw new Error('expected an observation');
    expect(review?.eventId).toBe('named-review-event-3');
    expect(observed.reviewEventId).toBe('named-review-event-3');
    // Only the review took the named id; the observation is its own event.
    expect(observed.eventId).not.toBe('named-review-event-3');
  });
});
