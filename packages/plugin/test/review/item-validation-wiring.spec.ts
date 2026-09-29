/**
 * F2.23's mismatch trigger (`[D-265]` ruling 3), joined to a real review
 * session — `ol-egov.141.53.1` [INTERV-11]'s own reachability half. See
 * `../../src/review/item-validation-wiring.ts`'s module doc for "THE
 * CLASSIFICATION" this suite is proving: R7 depth order narrowed to the two
 * FSRS-scheduled tiers for harder/easier, F2.16's `rating` for a day's
 * outcome, and `citation-store.ts`'s passage identity for same claim.
 *
 * Concept and instrument ids below are structural placeholders, never
 * fixture vocabulary — INV-3.
 */

import type { InstrumentType, Rating, ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import type { ItemValidationJudgePort, ItemValidationJudgeVerdict } from 'olea-core';
import { writeInstrumentCitation } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  ITEM_VALIDATION_CONFIRMATION_REASON,
  listItemValidationConfirmationRecords,
} from '../../src/review/duplication-confirmation-store.js';
import {
  createItemValidationProposalReader,
  dayOutcomesForConcept,
  resolveSameClaimMismatch,
} from '../../src/review/item-validation-wiring.js';
import { memoryVault } from './memory-vault.js';

function fakeClock(nowMs: number) {
  return { now: () => nowMs };
}

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: `r-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-01-10T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

const DAY1_LOCAL_NOON = new Date('2026-01-10T12:00:00-04:00');

function justGraded(overrides: {
  readonly instrumentId: string;
  readonly instrumentType: InstrumentType;
  readonly conceptIds?: readonly string[];
  readonly rating: Rating | null;
  readonly now?: Date;
}) {
  return {
    conceptIds: ['concept-a'],
    now: DAY1_LOCAL_NOON,
    ...overrides,
  };
}

describe('dayOutcomesForConcept', () => {
  it('maps a rating of again to failed and every other rating to strong', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'hard' }),
      review({ instrumentId: 'qa-2', instrumentType: 'qa', rating: 'good' }),
      review({ instrumentId: 'qa-3', instrumentType: 'qa', rating: 'easy' }),
    ];
    const outcomes = dayOutcomesForConcept(entries, 'concept-a', '2026-01-10');
    expect(outcomes.get('mcq-1')?.outcome).toBe('failed');
    expect(outcomes.get('qa-1')?.outcome).toBe('strong');
    expect(outcomes.get('qa-2')?.outcome).toBe('strong');
    expect(outcomes.get('qa-3')?.outcome).toBe('strong');
  });

  it('never reads an explain-back review (unrated, never FSRS-scheduled)', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'eb-1', instrumentType: 'explain-back', rating: null }),
    ];
    expect(dayOutcomesForConcept(entries, 'concept-a', '2026-01-10').size).toBe(0);
  });

  it('excludes a different day and a different concept', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', timestamp: '2026-01-09T09:00:00-04:00' }),
      review({ instrumentId: 'qa-2', conceptIds: ['concept-b'] }),
    ];
    expect(dayOutcomesForConcept(entries, 'concept-a', '2026-01-10').size).toBe(0);
  });

  it('the latest rating on the day wins over an earlier restudy', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({
        instrumentId: 'qa-1',
        rating: 'good',
        timestamp: '2026-01-10T08:00:00-04:00',
        eventId: 'e1',
      }),
      review({
        instrumentId: 'qa-1',
        rating: 'again',
        timestamp: '2026-01-10T20:00:00-04:00',
        eventId: 'e2',
      }),
    ];
    expect(dayOutcomesForConcept(entries, 'concept-a', '2026-01-10').get('qa-1')?.outcome).toBe(
      'failed',
    );
  });

  // `ol-egov.141.89.9.73` (`[D-419]`, `[D-423]`): a day's outcome for a concept is read from the
  // reviews that scored it (the first id of their own list), never from ones that only name it.
  it('reads a review for its scored concept only, never one it lists after it ([D-423])', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', conceptIds: ['concept-a', 'concept-b'] }),
    ];
    expect(dayOutcomesForConcept(entries, 'concept-a', '2026-01-10').has('qa-1')).toBe(true);
    expect(dayOutcomesForConcept(entries, 'concept-b', '2026-01-10').size).toBe(0);
  });
});

describe('resolveSameClaimMismatch', () => {
  it('finds the mismatch when a harder qa instrument stayed strong the same day an easier, same-claim mcq failed', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    await writeInstrumentCitation(vault, 'mcq-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'good' }),
    ];

    const mismatch = await resolveSameClaimMismatch(
      { entries, vault },
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );

    expect(mismatch).toEqual({
      harderInstrumentId: 'qa-1',
      harderOutcome: 'strong',
      easierInstrumentId: 'mcq-1',
      easierOutcome: 'failed',
      sameDay: true,
      sameClaim: true,
    });
  });

  it('finds the mismatch from the harder side too (order-independent)', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    await writeInstrumentCitation(vault, 'mcq-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    ];

    const mismatch = await resolveSameClaimMismatch(
      { entries, vault },
      justGraded({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'good' }),
    );

    expect(mismatch?.harderInstrumentId).toBe('qa-1');
    expect(mismatch?.easierInstrumentId).toBe('mcq-1');
  });

  it('an ordinary lapse with no candidate at the other tier is no mismatch', async () => {
    const vault = memoryVault();
    const mismatch = await resolveSameClaimMismatch(
      { entries: [], vault },
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );
    expect(mismatch).toBeUndefined();
  });

  it('never fires when neither instrument carries a citation record', async () => {
    const vault = memoryVault();
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'good' }),
    ];
    const mismatch = await resolveSameClaimMismatch(
      { entries, vault },
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );
    expect(mismatch).toBeUndefined();
  });

  it('never fires when the two instruments cite different sources (different claim)', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    await writeInstrumentCitation(vault, 'mcq-1', { sourcePath: 'Courses/A/notes.md', page: 9 });
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'good' }),
    ];
    const mismatch = await resolveSameClaimMismatch(
      { entries, vault },
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );
    expect(mismatch).toBeUndefined();
  });

  it('a matching passageDigest establishes same claim even when sourcePath/page differ', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', {
      sourcePath: 'Courses/A/notes.md',
      page: 3,
      passageDigest: 'digest-x',
    });
    await writeInstrumentCitation(vault, 'mcq-1', {
      sourcePath: 'Courses/A/handout.md',
      page: 9,
      passageDigest: 'digest-x',
    });
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'good' }),
    ];
    const mismatch = await resolveSameClaimMismatch(
      { entries, vault },
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );
    expect(mismatch?.sameClaim).toBe(true);
  });

  it('a mismatched passageDigest never falls back to a sourcePath/page match', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', {
      sourcePath: 'Courses/A/notes.md',
      page: 3,
      passageDigest: 'digest-x',
    });
    await writeInstrumentCitation(vault, 'mcq-1', {
      sourcePath: 'Courses/A/notes.md',
      page: 3,
      passageDigest: 'digest-y',
    });
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'good' }),
    ];
    const mismatch = await resolveSameClaimMismatch(
      { entries, vault },
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );
    expect(mismatch).toBeUndefined();
  });

  it('two recall-tier instruments (qa beside cloze) are never a harder/easier pair', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    await writeInstrumentCitation(vault, 'cloze-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'good' }),
    ];
    const mismatch = await resolveSameClaimMismatch(
      { entries, vault },
      justGraded({ instrumentId: 'cloze-1', instrumentType: 'cloze', rating: 'again' }),
    );
    expect(mismatch).toBeUndefined();
  });

  it('the reverse direction (harder failed, easier strong) is never treated as the mismatch', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    await writeInstrumentCitation(vault, 'mcq-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'again' }),
    ];
    const mismatch = await resolveSameClaimMismatch(
      { entries, vault },
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'good' }),
    );
    expect(mismatch).toBeUndefined();
  });

  it('a strong rating on a different day never completes the mismatch', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    await writeInstrumentCitation(vault, 'mcq-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    const entries: readonly ReviewLogEntry[] = [
      review({
        instrumentId: 'qa-1',
        instrumentType: 'qa',
        rating: 'good',
        timestamp: '2026-01-09T09:00:00-04:00',
      }),
    ];
    const mismatch = await resolveSameClaimMismatch(
      { entries, vault },
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );
    expect(mismatch).toBeUndefined();
  });

  // `ol-egov.141.89.9.73` (`[D-419]`, `[D-423]`): "same concept" is the concept each instrument
  // scored, so a topic only one of them names as context never pairs them.
  describe('same concept means the scored concept ([D-423])', () => {
    async function citedVault() {
      const vault = memoryVault();
      await writeInstrumentCitation(vault, 'qa-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
      await writeInstrumentCitation(vault, 'mcq-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
      return vault;
    }

    it('pairs two instruments that scored one concept, whatever else either names', async () => {
      const vault = await citedVault();
      const entries: readonly ReviewLogEntry[] = [
        review({ instrumentId: 'qa-1', conceptIds: ['concept-a', 'concept-b'], rating: 'good' }),
      ];
      const mismatch = await resolveSameClaimMismatch(
        { entries, vault },
        justGraded({
          instrumentId: 'mcq-1',
          instrumentType: 'mcq',
          conceptIds: ['concept-a', 'concept-c'],
          rating: 'again',
        }),
      );
      expect(mismatch?.harderInstrumentId).toBe('qa-1');
    });

    it('never pairs them through a concept the just-graded instrument names only as context', async () => {
      const vault = await citedVault();
      const entries: readonly ReviewLogEntry[] = [
        review({ instrumentId: 'qa-1', conceptIds: ['concept-b'], rating: 'good' }),
      ];
      const mismatch = await resolveSameClaimMismatch(
        { entries, vault },
        justGraded({
          instrumentId: 'mcq-1',
          instrumentType: 'mcq',
          conceptIds: ['concept-a', 'concept-b'],
          rating: 'again',
        }),
      );
      expect(mismatch).toBeUndefined();
    });

    it('never pairs them through a concept the other instrument names only as context', async () => {
      const vault = await citedVault();
      const entries: readonly ReviewLogEntry[] = [
        review({ instrumentId: 'qa-1', conceptIds: ['concept-b', 'concept-a'], rating: 'good' }),
      ];
      const mismatch = await resolveSameClaimMismatch(
        { entries, vault },
        justGraded({
          instrumentId: 'mcq-1',
          instrumentType: 'mcq',
          conceptIds: ['concept-a'],
          rating: 'again',
        }),
      );
      expect(mismatch).toBeUndefined();
    });
  });
});

describe('createItemValidationProposalReader', () => {
  it('reports no-trigger for an ordinary lapse with no wired judge', async () => {
    const vault = memoryVault();
    const reader = createItemValidationProposalReader({
      entries: [],
      vault,
      clock: fakeClock(0),
      judge: null,
    });
    const outcome = await reader(
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );
    expect(outcome).toEqual({ kind: 'no-trigger' });
  });

  it('reports judge-unavailable for a warranted check when no judge is wired — never fabricated as no-trigger', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    await writeInstrumentCitation(vault, 'mcq-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'good' }),
    ];
    const reader = createItemValidationProposalReader({
      entries,
      vault,
      clock: fakeClock(0),
      judge: null,
    });
    const outcome = await reader(
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );
    expect(outcome).toEqual({ kind: 'judge-unavailable' });
  });

  it('on a proposed outcome from a real judge, persists it to the shared confirmation folder', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    await writeInstrumentCitation(vault, 'mcq-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'good' }),
    ];
    const verdict: ItemValidationJudgeVerdict = {
      suspected: true,
      kind: 'key-conflicts-with-source',
      reason: 'cited key mismatch',
    };
    const judge: ItemValidationJudgePort = { judge: vi.fn().mockResolvedValue(verdict) };
    const reader = createItemValidationProposalReader({
      entries,
      vault,
      clock: fakeClock(1_768_000_000_000),
      judge,
    });

    const outcome = await reader(
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );

    expect(outcome.kind).toBe('proposed');
    const records = await listItemValidationConfirmationRecords(vault);
    expect(records).toHaveLength(1);
    expect(records[0]?.record).toMatchObject({
      instrumentId: 'mcq-1',
      kind: 'key-conflicts-with-source',
      reason: 'cited key mismatch',
      status: 'proposed',
      reasonKind: ITEM_VALIDATION_CONFIRMATION_REASON,
    });
  });

  it('a not-suspected verdict is never persisted', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    await writeInstrumentCitation(vault, 'mcq-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'good' }),
    ];
    const judge: ItemValidationJudgePort = {
      judge: vi.fn().mockResolvedValue({ suspected: false }),
    };
    const reader = createItemValidationProposalReader({
      entries,
      vault,
      clock: fakeClock(0),
      judge,
    });

    const outcome = await reader(
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );

    expect(outcome).toEqual({ kind: 'not-suspected' });
    expect(await listItemValidationConfirmationRecords(vault)).toEqual([]);
  });

  it('never throws when a judge call rejects — reports no-trigger and leaves the store untouched', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'qa-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    await writeInstrumentCitation(vault, 'mcq-1', { sourcePath: 'Courses/A/notes.md', page: 3 });
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa-1', instrumentType: 'qa', rating: 'good' }),
    ];
    const judge: ItemValidationJudgePort = {
      judge: vi.fn().mockRejectedValue(new Error('network drop')),
    };
    const reader = createItemValidationProposalReader({
      entries,
      vault,
      clock: fakeClock(0),
      judge,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const outcome = await reader(
      justGraded({ instrumentId: 'mcq-1', instrumentType: 'mcq', rating: 'again' }),
    );

    expect(outcome).toEqual({ kind: 'no-trigger' });
    expect(await listItemValidationConfirmationRecords(vault)).toEqual([]);
    consoleError.mockRestore();
  });
});
