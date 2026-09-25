// Scenarios: olea-service/features/F3-learn-from-anything.md, "Feature: C5.3 /
// `[D-090]` — Duplicate item-ids, and when a repair may be silent" — the THREE
// scenarios tagged `@auto:core/instrument/repair.spec` (the bead that filed this
// spec named two; the file carries three — see this repo's lane report, DF-20:
// every tagged scenario is built, not just the ones named at filing time):
//   - "a deleted id is repaired silently only at near-certainty"
//   - "a candidate id that is currently claimed is a duplication case, not a repair"
//   - "anything short of near-certainty is surfaced, never guessed"
// Plus a negative case exercising each disjunct of the third scenario's "Given"
// (text changed / moved to another file) on its own.
import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/types.js';
import {
  type DeletedInstrumentRecord,
  type RepairCandidate,
  resolveInstrumentRepair,
} from './repair.js';

const NOW = new Date('2026-09-25T12:00:00Z').getTime();

const NOTE_PATH = 'Courses/GEO/glaciers.md' as VaultPath;
const OTHER_NOTE_PATH = 'Courses/GEO/moved-elsewhere.md' as VaultPath;
const RAW = 'What carves a fjord?::Glacial erosion.';
const CHANGED_RAW = 'What carves a fjord now?::Glacial erosion.';

function deletedId(overrides: Partial<DeletedInstrumentRecord> = {}): DeletedInstrumentRecord {
  return {
    instrumentId: 'deleted-1',
    raw: RAW,
    notePath: NOTE_PATH,
    ...overrides,
  };
}

function candidate(overrides: Partial<RepairCandidate> = {}): RepairCandidate {
  return {
    raw: RAW,
    notePath: NOTE_PATH,
    candidateIdClaimedElsewhere: false,
    ...overrides,
  };
}

describe('a deleted id is repaired silently only at near-certainty', () => {
  it('restores the id silently when text is byte-identical, the file is the same, and the id is unclaimed', () => {
    const outcome = resolveInstrumentRepair({
      deletedId: deletedId(),
      candidate: candidate(),
      now: NOW,
    });

    expect(outcome.kind).toBe('repaired');
    if (outcome.kind !== 'repaired') throw new Error('unreachable');
    expect(outcome.instrumentId).toBe('deleted-1');
    expect(outcome.notePath).toBe(NOTE_PATH);
  });
});

describe('a candidate id that is currently claimed is a duplication case, not a repair', () => {
  it('routes as a duplication, not a repair, when the id is already claimed elsewhere', () => {
    const outcome = resolveInstrumentRepair({
      deletedId: deletedId(),
      candidate: candidate({ candidateIdClaimedElsewhere: true }),
      now: NOW,
    });

    expect(outcome.kind).toBe('duplication');
    if (outcome.kind !== 'duplication') throw new Error('unreachable');
    expect(outcome.entry.instrumentId).toBe('deleted-1');
    expect(outcome.entry.status).toBe('proposed');
    expect(outcome.entry.reason).toBe('candidate-id-claimed');
    expect(outcome.entry.proposedAt).toBe(NOW);
  });
});

describe('anything short of near-certainty is surfaced, never guessed', () => {
  it('surfaces to the confirmation queue when the text has changed', () => {
    const outcome = resolveInstrumentRepair({
      deletedId: deletedId(),
      candidate: candidate({ raw: CHANGED_RAW }),
      now: NOW,
    });

    expect(outcome.kind).toBe('surfaced');
    if (outcome.kind !== 'surfaced') throw new Error('unreachable');
    expect(outcome.entry.instrumentId).toBe('deleted-1');
    expect(outcome.entry.status).toBe('proposed');
    expect(outcome.entry.reason).toBe('repair-uncertain');
  });

  it('surfaces to the confirmation queue when the item moved to another file', () => {
    const outcome = resolveInstrumentRepair({
      deletedId: deletedId(),
      candidate: candidate({ notePath: OTHER_NOTE_PATH }),
      now: NOW,
    });

    expect(outcome.kind).toBe('surfaced');
    if (outcome.kind !== 'surfaced') throw new Error('unreachable');
    expect(outcome.entry.reason).toBe('repair-uncertain');
    expect(outcome.entry.notePath).toBe(OTHER_NOTE_PATH);
  });

  it('surfaces (never routes as a duplication) when both text and file differ, even with the id claimed elsewhere', () => {
    // Negative case: near-certainty requires ALL three conditions. Text changed AND moved AND
    // claimed must still surface, not silently repair and not misroute as a duplication — the
    // duplication route is reserved for the one case where the only failing dial is "claimed".
    const outcome = resolveInstrumentRepair({
      deletedId: deletedId(),
      candidate: candidate({
        raw: CHANGED_RAW,
        notePath: OTHER_NOTE_PATH,
        candidateIdClaimedElsewhere: true,
      }),
      now: NOW,
    });

    expect(outcome.kind).toBe('surfaced');
    if (outcome.kind !== 'surfaced') throw new Error('unreachable');
    expect(outcome.entry.reason).toBe('repair-uncertain');
  });
});
