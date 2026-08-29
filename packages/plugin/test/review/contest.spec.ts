import { parseReviewLog, quarantinedGradeInstrumentIds, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  correctionLineFor,
  createVaultGradeContestPort,
  quarantineBadgeFor,
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
