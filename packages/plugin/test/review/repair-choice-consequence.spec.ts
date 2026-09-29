/**
 * Row 11 of David's 2026-09-29 rulings (`ol-v7r5.111`): the grouped choice's wording states what
 * "None of these." actually does, "established from the implementation". `repair-choice.spec.ts`
 * pins the strings; this file pins each claim those strings make, against the production open path
 * (`openReviewSession`) and the shared store, over a real (in-memory) vault:
 *
 *  - the card ends up WITHOUT A PASSAGE — nothing carries its id, so it is not served — and the
 *    answer writes nothing into a note she authored (INV-6);
 *  - she is NOT ASKED AGAIN — the record is saved `declined` and a later open neither proposes
 *    nor rewrites it, however the next walk pairs the id with candidates;
 *  - the PRACTICE HISTORY is untouched — the answer never writes to the review log;
 *  - the listed passages stay ordinary, separate cards with no history of the deleted one;
 *  - and, for the restraint the ruling asks of the history line: attaching a chosen passage does
 *    not compare its text with the deleted card's, so the wording must not say, or lead her to
 *    read, that the earlier practice vouches for it.
 *
 * Every fixture string is invented (INV-3). The wording itself is `./repair-choice.spec.ts`'s.
 */

import type { ComposedStudySession, VaultInstrumentRecord, VaultSource } from 'olea-core';
import {
  calendarDayFromLocalDate,
  createFsrsScheduler,
  enumerateVaultInstruments,
  readReviewLogHistory,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { writeBackRecoveredInstrumentId } from '../../src/instrument-stamping/repair-write-back.js';
import {
  applyConfirmedRepairChoice,
  listRepairChoiceConfirmationRecords,
  saveRepairChoiceAnswer,
} from '../../src/review/duplication-confirmation-store.js';
import {
  type EnumeratedInstrument,
  type OpenReviewSessionInput,
  openReviewSession,
} from '../../src/review/open-session.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
} from '../../src/review/ports.js';
import { digestOfInstrumentRecord } from '../../src/review/repair-choice.js';
import type { ReviewInstrument } from '../../src/review/types.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { type MemoryVault, memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');
const T_ANSWER = Date.parse('2026-08-11T18:00:00.000Z');
const DELETED_ID = 'mcq-deleted-1';
const NOTE = 'Notes/Candidates.md';
const NOTE_FRONTMATTER = ['---', 'topic: [Alpha]', 'course: TEST101', '---'].join('\n');

function mcqBlock(stem: string): string {
  return [
    '```olea-mcq',
    `stem: ${stem}`,
    'answer: The right one',
    'distractor: d1',
    'distractor: d2',
    'distractor: d3',
    'distractor: d4',
    'feedback: Because of the thing.',
    '```',
  ].join('\n');
}

function twoCandidateNote(): string {
  return [
    NOTE_FRONTMATTER,
    '## Q1',
    '',
    mcqBlock('Question A?'),
    '',
    '## Q2',
    '',
    mcqBlock('Question B?'),
    '',
  ].join('\n');
}

/** The deleted card as an earlier walk saw it — text that neither candidate carries. */
const PREVIOUS: readonly EnumeratedInstrument[] = [
  {
    instrumentId: DELETED_ID,
    raw: 'the text this card had before her edit',
    notePath: NOTE,
    instrumentType: 'mcq',
  },
];

const DELETED_CARD: ReviewInstrument = {
  instrumentId: DELETED_ID,
  conceptIds: ['concept-alpha'],
  courseCode: 'TEST101',
  noteTitle: 'Candidates',
  sourcePath: NOTE,
  blockId: null,
  draftId: null,
  type: 'qa',
  question: 'What did this card ask?',
  answer: 'What it answered.',
};

function emptyComposition(): ComposedStudySession {
  return {
    model: {
      asOf: calendarDayFromLocalDate(NOW),
      budgetMinutes: 20,
      budgetSeconds: 1200,
      plannedSeconds: 0,
      items: [],
      leftOut: [],
      leftOutInstrumentCount: 0,
      consideredRowCount: 0,
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
  };
}

function openInput(
  vault: VaultSource,
  previousInstrumentEnumeration: readonly EnumeratedInstrument[],
): OpenReviewSessionInput {
  return {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    probeDays: 30,
    studySessionHolder: createStudySessionHolder(),
    composeDefaultStudySession: async () => emptyComposition(),
    previousInstrumentEnumeration,
    ports: {
      reviewLog: createVaultReviewLogPort(vault, DEVICE),
      suspendPort: createVaultSuspendPort(vault, DEVICE),
      editPort: { async edit() {} },
      noteExists: createVaultNoteExistsPort(vault),
      clock: { now: () => NOW },
      draftAcceptPort: {
        accept() {
          throw new Error('no draft item in this suite');
        },
        reject() {
          throw new Error('no draft item in this suite');
        },
      },
    },
  };
}

async function open(vault: VaultSource, previous: readonly EnumeratedInstrument[]) {
  const outcome = await openReviewSession(openInput(vault, previous));
  if (!outcome.ok) throw new Error(`expected a composed session: ${String(outcome.error)}`);
  return outcome;
}

async function walk(vault: VaultSource): Promise<readonly VaultInstrumentRecord[]> {
  return (await enumerateVaultInstruments(vault)).records;
}

/** A vault holding the deleted card's practice history and the two passages that could carry it. */
async function world(): Promise<{
  readonly vault: MemoryVault;
  readonly noteBefore: string;
}> {
  const vault = memoryVault({
    'Concepts/Alpha.md': [
      '---',
      'title: Alpha',
      'course: TEST101',
      '---',
      '',
      'A concept.',
      '',
    ].join('\n'),
    [NOTE]: twoCandidateNote(),
  });
  const log = createVaultReviewLogPort(vault, DEVICE);
  for (const rating of ['good', 'hard'] as const) {
    await log.recordReview({
      instrument: DELETED_CARD,
      rating,
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['qa'],
        planVersion: null,
      },
    });
  }
  return { vault, noteBefore: twoCandidateNote() };
}

async function historyOf(vault: VaultSource, instrumentId: string) {
  const { entries } = await readReviewLogHistory(vault, {});
  return entries.filter((entry) => entry.kind === 'review' && entry.instrumentId === instrumentId);
}

describe('"None of these." — what the implementation produces (row 11, ol-v7r5.111)', () => {
  it('while the choice is open, nothing carries the deleted id: it is not among the passages a walk finds', async () => {
    const { vault } = await world();

    const outcome = await open(vault, PREVIOUS);

    const records = await listRepairChoiceConfirmationRecords(vault);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.status).toBe('proposed');
    expect(records[0]?.record.candidates).toHaveLength(2);
    expect(outcome.instrumentEnumeration.map((r) => r.instrumentId)).not.toContain(DELETED_ID);
  });

  it('answering it closes the choice as declined, writes nothing into her notes, and leaves the card without a passage', async () => {
    const { vault, noteBefore } = await world();
    await open(vault, PREVIOUS);
    const writesBefore = vault.writes.length;

    const saved = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED_ID,
      answer: { kind: 'none-of-these' },
      currentRecords: await walk(vault),
      now: T_ANSWER,
    });

    expect(saved.kind).toBe('saved');
    if (saved.kind !== 'saved') return;
    expect(saved.stored.record.status).toBe('declined');
    expect(saved.stored.record.declinedAt).toBe(new Date(T_ANSWER).toISOString());
    expect(saved.stored.record.resolvedNotePath).toBeUndefined();
    // Only the confirmation record is written, under its own dot folder; her note is untouched.
    const newWrites = vault.writes.slice(writesBefore);
    expect(newWrites).toHaveLength(1);
    expect(newWrites.every((path) => path.startsWith('.olea/'))).toBe(true);
    expect(vault.contentOf(NOTE)).toBe(noteBefore);
    // Still no block carries the id, so a walk finds nothing to serve under it.
    expect((await walk(vault)).map((r) => r.instrumentId)).not.toContain(DELETED_ID);
  });

  it('she is not asked again: a later open neither proposes it anew nor rewrites the answer', async () => {
    const { vault } = await world();
    const first = await open(vault, PREVIOUS);
    await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED_ID,
      answer: { kind: 'none-of-these' },
      currentRecords: await walk(vault),
      now: T_ANSWER,
    });
    const [answered] = await listRepairChoiceConfirmationRecords(vault);
    if (answered === undefined) throw new Error('fixture expected the declined record');
    const asWritten = vault.contentOf(answered.path);

    // The natural next open: its previous walk is the last one's, which no longer holds the id.
    await open(vault, first.instrumentEnumeration);
    // Even a walk that still pairs the id with the same candidates finds the answer closed.
    await open(vault, PREVIOUS);

    const after = await listRepairChoiceConfirmationRecords(vault);
    expect(after).toHaveLength(1);
    expect(after[0]?.record.status).toBe('declined');
    expect(vault.contentOf(answered.path)).toBe(asWritten);
    // And the answer itself is saved once: a second answer to the same choice is refused.
    const again = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED_ID,
      answer: { kind: 'none-of-these' },
      currentRecords: await walk(vault),
      now: T_ANSWER + 1,
    });
    expect(again.kind).toBe('already-resolved');
    expect(vault.contentOf(answered.path)).toBe(asWritten);
  });

  it('the practice history is untouched: the answer never writes to the review log', async () => {
    const { vault } = await world();
    const before = await historyOf(vault, DELETED_ID);
    expect(before).toHaveLength(2);
    const isLogWrite = (path: string) => path.startsWith('.olea/reviews/');
    const logWritesBefore = vault.writes.filter(isLogWrite).length;
    expect(logWritesBefore).toBe(2);
    await open(vault, PREVIOUS);

    await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED_ID,
      answer: { kind: 'none-of-these' },
      currentRecords: await walk(vault),
      now: T_ANSWER,
    });
    await open(vault, PREVIOUS);

    expect(await historyOf(vault, DELETED_ID)).toEqual(before);
    expect(vault.writes.filter(isLogWrite)).toHaveLength(logWritesBefore);
  });

  it('the listed passages stay ordinary, separate cards with none of the deleted card’s history', async () => {
    const { vault } = await world();
    await open(vault, PREVIOUS);
    await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED_ID,
      answer: { kind: 'none-of-these' },
      currentRecords: await walk(vault),
      now: T_ANSWER,
    });

    const records = (await walk(vault)).filter((r) => r.notePath === NOTE);
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.instrumentId).not.toBe(DELETED_ID);
      expect(await historyOf(vault, record.instrumentId)).toEqual([]);
    }
  });
});

describe('choosing a passage — why the history line says nothing about the passage (row 11)', () => {
  it('attaching does not compare the chosen passage with the deleted card: unrelated text still receives the id, and no evidence is written', async () => {
    const { vault } = await world();
    await open(vault, PREVIOUS);
    const current = await walk(vault);
    const chosen = current.find((r) => r.notePath === NOTE && r.headingPath?.[0] === 'Q2');
    if (chosen === undefined) throw new Error('fixture expected the second passage');
    const digest = await digestOfInstrumentRecord(chosen);
    if (digest === undefined) throw new Error('fixture expected a digest');
    const historyBefore = await historyOf(vault, DELETED_ID);

    const saved = await saveRepairChoiceAnswer(vault, {
      instrumentId: DELETED_ID,
      answer: { kind: 'candidate', notePath: NOTE, digest },
      currentRecords: current,
      now: T_ANSWER,
    });
    expect(saved.kind).toBe('saved');
    const applied = await applyConfirmedRepairChoice(vault, {
      instrumentId: DELETED_ID,
      currentRecords: current,
    });
    if (applied.kind !== 'apply') throw new Error(`expected apply: ${applied.kind}`);
    // The write-back is handed the chosen block's own text and nothing of the deleted card's.
    const written = await writeBackRecoveredInstrumentId(vault, {
      resolution: applied.resolution,
      recoveredInstrumentType: 'mcq',
      candidateRaw: applied.candidateRaw,
      currentRecords: current,
    });

    expect(written).toEqual({ kind: 'written', instrumentId: DELETED_ID, notePath: NOTE });
    // The passage now carries the card's id, so the card's earlier practice sits under it ...
    expect((await walk(vault)).find((r) => r.instrumentId === DELETED_ID)?.headingPath).toEqual([
      'Q2',
    ]);
    // ... yet nothing was checked or recorded about whether that practice fits this passage.
    expect(await historyOf(vault, DELETED_ID)).toEqual(historyBefore);
    expect(PREVIOUS[0]?.raw).not.toBe(applied.candidateRaw);
  });
});
