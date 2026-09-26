import type { ReviewLogRecord } from 'olea-contracts';
import { parseReviewLog, quarantinedGradeInstrumentIds, reviewLogPath } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  correctionLineFor,
  createVaultGradeContestPort,
  originalGradeEventIdFor,
  quarantineBadgeFor,
  resolveContestedGradeAndRegrade,
} from '../../src/review/contest.js';
import { CONTEST_QUARANTINE_BADGE } from '../../src/review/copy.js';
import { memoryVault } from './memory-vault.js';

// Synthetic fixtures only (INV-3).
const INSTRUMENT = 'instrument-1';
const CONCEPTS = ['concept-a'];

function portOver(vault: ReturnType<typeof memoryVault>, times: readonly string[]) {
  let index = 0;
  return createVaultGradeContestPort(vault, 'device-1', () => times[index++] ?? times[0] ?? '');
}

/** A minimal graded explain-back review event — the shape a corrected contest's `revisionOf` must name. */
function gradedExplainBackReview(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'eb-1',
    timestamp: '2026-08-20T09:00:00+02:00',
    instrumentId: INSTRUMENT,
    instrumentType: 'explain-back',
    conceptIds: CONCEPTS,
    rating: null,
    wasUnsure: false,
    durationMs: 4000,
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    explainBackGrade: {
      soloLevel: 'relational',
      correctness: 'incorrect',
      contentRef: 'content-ref-1',
      revisionOf: null,
      artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
    },
    ...overrides,
  } as ReviewLogRecord;
}

describe('the grade case — both endings exist, and both are recorded', () => {
  it('quarantines on contest, and the grade dims rather than disappearing', async () => {
    const vault = memoryVault();
    const port = portOver(vault, ['2026-08-21T09:00:00+02:00']);

    const record = await port.contestGrade({
      instrumentId: INSTRUMENT,
      conceptIds: CONCEPTS,
      evidenceBasis: 'mcq|instrument-1|2|false',
    });
    expect(record.effect).toBe('quarantined');

    const log = parseReviewLog(vault.contentOf(reviewLogPath('2026-08-21', 'device-1')) ?? '');
    expect(log.invalidLines).toEqual([]);
    expect(quarantinedGradeInstrumentIds(log.disputes)).toEqual([INSTRUMENT]);
    expect(quarantineBadgeFor(INSTRUMENT, log.disputes)).toBe(CONTEST_QUARANTINE_BADGE);
  });

  it('MOVES the state when the re-derivation finds the tool was wrong, naming her contest as its catalyst', async () => {
    const vault = memoryVault();
    const port = portOver(vault, ['2026-08-21T09:00:00+02:00', '2026-08-24T09:00:00+02:00']);

    const opening = await port.contestGrade({
      instrumentId: INSTRUMENT,
      conceptIds: CONCEPTS,
      evidenceBasis: 'mcq|instrument-1|2|false',
    });
    const resolution = await port.resolveContestedGrade({
      dispute: opening,
      outcome: 'corrected',
    });

    // The compensating event names her contest by event id — the proof the
    // channel works, written where she can see it.
    expect(resolution.resolves).toBe(opening.eventId);
    expect(correctionLineFor(resolution, opening)).toContain('2026-08-21');

    const disputes = [
      ...parseReviewLog(vault.contentOf(reviewLogPath('2026-08-21', 'device-1')) ?? '').disputes,
      ...parseReviewLog(vault.contentOf(reviewLogPath('2026-08-24', 'device-1')) ?? '').disputes,
    ];
    // Quarantine lifts once the re-derivation lands.
    expect(quarantinedGradeInstrumentIds(disputes)).toEqual([]);
    expect(quarantineBadgeFor(INSTRUMENT, disputes)).toBeNull();
  });

  it('HOLDS the state when the re-derivation upholds it, and records that too', async () => {
    const vault = memoryVault();
    const port = portOver(vault, ['2026-08-21T09:00:00+02:00', '2026-08-24T09:00:00+02:00']);

    const opening = await port.contestGrade({
      instrumentId: INSTRUMENT,
      conceptIds: CONCEPTS,
      evidenceBasis: 'mcq|instrument-1|2|false',
    });
    const resolution = await port.resolveContestedGrade({ dispute: opening, outcome: 'upheld' });

    expect(resolution.outcome).toBe('upheld');
    // Acknowledged once, then let rest — no second sentence on this surface.
    expect(correctionLineFor(resolution, opening)).toBeNull();

    const disputes = [
      ...parseReviewLog(vault.contentOf(reviewLogPath('2026-08-21', 'device-1')) ?? '').disputes,
      ...parseReviewLog(vault.contentOf(reviewLogPath('2026-08-24', 'device-1')) ?? '').disputes,
    ];
    // The dispute is still in her history — an upheld claim does not erase it.
    expect(disputes).toHaveLength(2);
  });

  it('records no reason, because the effect is fixed by what she touched', async () => {
    const vault = memoryVault();
    const port = portOver(vault, ['2026-08-21T09:00:00+02:00']);
    await port.contestGrade({
      instrumentId: INSTRUMENT,
      conceptIds: CONCEPTS,
      evidenceBasis: 'mcq|instrument-1|2|false',
    });
    const line = vault.contentOf(reviewLogPath('2026-08-21', 'device-1')) ?? '';
    expect(line).not.toContain('"reason"');
    expect(line).not.toContain('"text"');
  });
});

describe('originalGradeEventIdFor — the revisionOf target for a corrected contest', () => {
  it('names the standing graded explain-back event for the disputed instrument', () => {
    const records = [gradedExplainBackReview()];
    expect(originalGradeEventIdFor(INSTRUMENT, records)).toBe('eb-1');
  });

  it('is null when the instrument has no graded explain-back event on the log', () => {
    expect(originalGradeEventIdFor(INSTRUMENT, [])).toBeNull();
    expect(
      originalGradeEventIdFor('some-other-instrument', [gradedExplainBackReview()]),
    ).toBeNull();
  });

  it('names the MOST RECENT grade when the instrument has been re-graded before', () => {
    const records = [
      gradedExplainBackReview({ eventId: 'eb-1', timestamp: '2026-08-20T09:00:00+02:00' }),
      gradedExplainBackReview({ eventId: 'eb-2', timestamp: '2026-08-22T09:00:00+02:00' }),
    ];
    expect(originalGradeEventIdFor(INSTRUMENT, records)).toBe('eb-2');
  });
});

describe('resolveContestedGradeAndRegrade — the production path this bead builds', () => {
  it('upheld: resolves the contest and appends no re-grade', async () => {
    const vault = memoryVault();
    const port = portOver(vault, ['2026-08-21T09:00:00+02:00', '2026-08-24T09:00:00+02:00']);
    const opening = await port.contestGrade({
      instrumentId: INSTRUMENT,
      conceptIds: CONCEPTS,
      evidenceBasis: 'mcq|instrument-1|2|false',
    });
    const appendCorrectiveRegrade = vi.fn(async () => undefined);

    const result = await resolveContestedGradeAndRegrade({
      port,
      dispute: opening,
      outcome: 'upheld',
      records: [gradedExplainBackReview()],
      appendCorrectiveRegrade,
    });

    expect(result.resolution.outcome).toBe('upheld');
    expect(result.revisionOf).toBeNull();
    expect(appendCorrectiveRegrade).not.toHaveBeenCalled();
  });

  it('corrected: resolves the contest AND appends a re-grade naming the original grade event', async () => {
    const vault = memoryVault();
    const port = portOver(vault, ['2026-08-21T09:00:00+02:00', '2026-08-24T09:00:00+02:00']);
    const opening = await port.contestGrade({
      instrumentId: INSTRUMENT,
      conceptIds: CONCEPTS,
      evidenceBasis: 'mcq|instrument-1|2|false',
    });
    const appendCorrectiveRegrade = vi.fn(async () => undefined);

    const result = await resolveContestedGradeAndRegrade({
      port,
      dispute: opening,
      outcome: 'corrected',
      records: [gradedExplainBackReview({ eventId: 'eb-1' })],
      appendCorrectiveRegrade,
    });

    expect(result.resolution.outcome).toBe('corrected');
    expect(result.resolution.resolves).toBe(opening.eventId);
    expect(result.revisionOf).toBe('eb-1');
    expect(appendCorrectiveRegrade).toHaveBeenCalledExactlyOnceWith('eb-1');
  });

  it('corrected but no standing grade found: resolves, appends nothing rather than guessing', async () => {
    const vault = memoryVault();
    const port = portOver(vault, ['2026-08-21T09:00:00+02:00', '2026-08-24T09:00:00+02:00']);
    const opening = await port.contestGrade({
      instrumentId: INSTRUMENT,
      conceptIds: CONCEPTS,
      evidenceBasis: 'mcq|instrument-1|2|false',
    });
    const appendCorrectiveRegrade = vi.fn(async () => undefined);

    const result = await resolveContestedGradeAndRegrade({
      port,
      dispute: opening,
      outcome: 'corrected',
      records: [],
      appendCorrectiveRegrade,
    });

    expect(result.resolution.outcome).toBe('corrected');
    expect(result.revisionOf).toBeNull();
    expect(appendCorrectiveRegrade).not.toHaveBeenCalled();
  });
});
