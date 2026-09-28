/**
 * F4.11's remaining write-seam edit (`ol-0r92.135`): `createVaultReviewLogPort`
 * (`../../src/review/ports.ts`) reads a handed-off MCQ item's own
 * `paper-origin:` block field back — `readPaperOriginField`,
 * `../../src/instrument-blocks/paper-origin.ts` — and hands
 * `'practice-paper'` to `appendReviewLogRecord` as the RAW *candidate* on
 * every review, not only the first.
 *
 * `[D-391]`'s first-only rule lives entirely in `olea-core`'s writer
 * (`hasEarlierReviewForInstrument`, `packages/core/src/review-log/write.ts`),
 * not in this port — so this suite proves the three cases that rule creates
 * for THIS caller: the first ordinary review of a handed-off item keeps the
 * label, a second review of the same item does not, and an item that was
 * never handed off never gets one. It does not re-prove the writer's own
 * first-only mechanics; `write.ts`'s own spec already does that.
 */

import type { SelectionContextV4 } from 'olea-contracts';
import { calendarDayFromLocalDate, MCQ_FENCE_INFO, parseReviewLog, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultReviewLogPort } from '../../src/review/ports.js';
import type { ReviewInstrument } from '../../src/review/types.js';
import { memoryVault } from './memory-vault.js';

const DEVICE = 'paper-origin-write-seam-device';
const NOTE_PATH = 'Courses/COGS214/Practice paper hand-off.md';

const SELECTION_CONTEXT: SelectionContextV4 = {
  dueState: 'due',
  examProximity: null,
  yieldRank: null,
  instrumentTypesOffered: ['mcq'],
  planVersion: null,
};

/** A minimal, valid `olea-mcq` block — built rather than pasted, same discipline `mcq-format.spec.ts` uses. */
function mcqBlock(id: string, extraLines: readonly string[] = []): string {
  return [
    `\`\`\`${MCQ_FENCE_INFO}`,
    'stem: which one is it?',
    'answer: the right one',
    'distractor: a distractor',
    'distractor: another distractor',
    `id: ${id}`,
    ...extraLines,
    '```',
    '',
  ].join('\n');
}

function mcqInstrument(instrumentId: string): ReviewInstrument {
  return {
    instrumentId,
    conceptIds: ['concept-a'],
    courseCode: 'COGS214',
    noteTitle: 'Sample note',
    sourcePath: NOTE_PATH,
    blockId: null,
    draftId: null,
    type: 'mcq',
    stem: 'which one is it?',
    options: [
      { id: 'opt-1', label: 'the right one', correct: true },
      { id: 'opt-2', label: 'a distractor', correct: false },
    ],
    feedback: 'Correct — this one.',
  };
}

function todaysLogPath(): string {
  return reviewLogPath(calendarDayFromLocalDate(new Date()), DEVICE);
}

function reviewOrigins(rawLog: string | undefined): readonly (string | undefined)[] {
  const parsed = parseReviewLog(rawLog ?? '');
  expect(parsed.invalidLines).toEqual([]);
  return parsed.records
    .filter((r): r is Extract<typeof r, { kind: 'review' }> => r.kind === 'review')
    .map((r) => r.origin);
}

describe('createVaultReviewLogPort — the practice-paper origin read-back (F4.11, [D-367]/[D-391]/[D-407])', () => {
  it("the FIRST ordinary review of a handed-off item's own quiz block records origin 'practice-paper'", async () => {
    const vault = memoryVault({
      [NOTE_PATH]: mcqBlock('mcq-handoff-1', ['paper-origin: paper-key1 slot-3']),
    });
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: mcqInstrument('mcq-handoff-1'),
      rating: 'good',
      wasUnsure: false,
      durationMs: 1000,
      selectionContext: SELECTION_CONTEXT,
    });

    expect(reviewOrigins(vault.contentOf(todaysLogPath()))).toEqual(['practice-paper']);
  });

  it('a SECOND review of the same handed-off item does not record the origin again', async () => {
    const vault = memoryVault({
      [NOTE_PATH]: mcqBlock('mcq-handoff-2', ['paper-origin: paper-key1 slot-4']),
    });
    const port = createVaultReviewLogPort(vault, DEVICE);
    const instrument = mcqInstrument('mcq-handoff-2');

    await port.recordReview({
      instrument,
      rating: 'good',
      wasUnsure: false,
      durationMs: 1000,
      selectionContext: SELECTION_CONTEXT,
    });
    await port.recordReview({
      instrument,
      rating: 'good',
      wasUnsure: false,
      durationMs: 900,
      selectionContext: SELECTION_CONTEXT,
    });

    expect(reviewOrigins(vault.contentOf(todaysLogPath()))).toEqual(['practice-paper', undefined]);
  });

  it('an ordinary MCQ item, never handed off, never records an origin', async () => {
    const vault = memoryVault({
      [NOTE_PATH]: mcqBlock('mcq-ordinary-1'),
    });
    const port = createVaultReviewLogPort(vault, DEVICE);

    await port.recordReview({
      instrument: mcqInstrument('mcq-ordinary-1'),
      rating: 'good',
      wasUnsure: false,
      durationMs: 1000,
      selectionContext: SELECTION_CONTEXT,
    });

    const [record] = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '').records;
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(Object.hasOwn(record, 'origin')).toBe(false);
  });

  it('a non-MCQ review never records an origin, even when the block ever wrote one would be unreachable for it', async () => {
    const vault = memoryVault();
    const port = createVaultReviewLogPort(vault, DEVICE);

    const qaInstrument: ReviewInstrument = {
      instrumentId: 'qa-1',
      conceptIds: ['concept-a'],
      courseCode: 'COGS214',
      noteTitle: 'Sample note',
      sourcePath: NOTE_PATH,
      blockId: null,
      draftId: null,
      type: 'qa',
      question: 'What is it?',
      answer: 'It is this.',
    };

    await port.recordReview({
      instrument: qaInstrument,
      rating: 'good',
      wasUnsure: false,
      durationMs: 1000,
      selectionContext: SELECTION_CONTEXT,
    });

    const [record] = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '').records;
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(Object.hasOwn(record, 'origin')).toBe(false);
  });

  it('a handed-off item whose source note has since been deleted records no origin — never thrown, never fabricated', async () => {
    const vault = memoryVault(); // NOTE_PATH deliberately absent
    const port = createVaultReviewLogPort(vault, DEVICE);

    await expect(
      port.recordReview({
        instrument: mcqInstrument('mcq-handoff-3'),
        rating: 'good',
        wasUnsure: false,
        durationMs: 1000,
        selectionContext: SELECTION_CONTEXT,
      }),
    ).resolves.toBeUndefined();

    const [record] = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '').records;
    expect(record?.kind).toBe('review');
    if (record?.kind !== 'review') return;
    expect(Object.hasOwn(record, 'origin')).toBe(false);
  });
});
