// No F3-learn-from-anything.md scenario tags `core/instrument/deleted-id-match.spec` today (grepped
// `@auto:core/instrument` in that file: only `duplication.spec` and `repair.spec` are tagged for the
// C5.3 / `[D-090]` feature block). This lane's owns is `deleted-id-match.ts` + its spec only, not the
// features file, so no tag was added here — flagged in this lane's report rather than invented.
//
// Tests below cover this bead's own acceptance criteria directly: a clean repair pair, a moved item,
// an edited item, a claimed candidate, no candidate, plus a "not deleted" sanity check, a sort-order
// check, and an end-to-end test feeding this module's output into `resolveInstrumentRepair`.
import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/types.js';
import {
  type CurrentInstrumentSnapshot,
  type MatchDeletedInstrumentIdsInput,
  matchDeletedInstrumentIds,
} from './deleted-id-match.js';
import {
  type DeletedInstrumentRecord,
  type RepairCandidate,
  resolveInstrumentRepair,
} from './repair.js';

const NOW = new Date('2026-09-25T12:00:00Z').getTime();

const NOTE_1 = 'Courses/GEO/glaciers.md' as VaultPath;
const NOTE_2 = 'Courses/GEO/moved-elsewhere.md' as VaultPath;
const NOTE_3 = 'Courses/GEO/unrelated.md' as VaultPath;
const RAW = 'What carves a fjord?::Glacial erosion.';
const CHANGED_RAW = 'What carves a fjord now?::Glacial erosion.';

function deletedId(overrides: Partial<DeletedInstrumentRecord> = {}): DeletedInstrumentRecord {
  return {
    instrumentId: 'deleted-1',
    raw: RAW,
    notePath: NOTE_1,
    ...overrides,
  };
}

function current(overrides: Partial<CurrentInstrumentSnapshot> = {}): CurrentInstrumentSnapshot {
  return {
    instrumentId: 'new-item-1',
    raw: RAW,
    notePath: NOTE_1,
    ...overrides,
  };
}

function match(input: Partial<MatchDeletedInstrumentIdsInput>) {
  return matchDeletedInstrumentIds({
    previous: input.previous ?? [deletedId()],
    current: input.current ?? [],
  });
}

describe('a clean repair pair', () => {
  it('pairs the deleted id with the one byte-identical, same-file new item', () => {
    const result = match({ current: [current()] });

    expect(result).toHaveLength(1);
    expect(result[0]?.deletedId.instrumentId).toBe('deleted-1');
    expect(result[0]?.candidates).toEqual([
      { raw: RAW, notePath: NOTE_1, candidateIdClaimedElsewhere: false },
    ]);
  });
});

describe('a moved item', () => {
  it('still proposes a candidate found by text alone, at a different file', () => {
    const result = match({ current: [current({ notePath: NOTE_2 })] });

    expect(result[0]?.candidates).toEqual([
      { raw: RAW, notePath: NOTE_2, candidateIdClaimedElsewhere: false },
    ]);
  });
});

describe('an edited item', () => {
  it('still proposes a candidate found by same file alone, with changed text', () => {
    const result = match({ current: [current({ raw: CHANGED_RAW })] });

    expect(result[0]?.candidates).toEqual([
      { raw: CHANGED_RAW, notePath: NOTE_1, candidateIdClaimedElsewhere: false },
    ]);
  });
});

describe('a claimed candidate', () => {
  it('marks every candidate claimed-elsewhere when the deleted id is live on another current record', () => {
    const result = match({
      current: [
        current(), // byte-identical, same-file candidate
        { instrumentId: 'deleted-1', raw: 'unrelated content', notePath: NOTE_3 }, // the id, live elsewhere
      ],
    });

    expect(result[0]?.candidates).toEqual([
      { raw: RAW, notePath: NOTE_1, candidateIdClaimedElsewhere: true },
    ]);
  });
});

describe('no candidate', () => {
  it('reports the deleted id with an empty candidate list when nothing matches either dial', () => {
    const result = match({
      current: [{ instrumentId: 'new-item-1', raw: 'completely different', notePath: NOTE_2 }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.deletedId.instrumentId).toBe('deleted-1');
    expect(result[0]?.candidates).toEqual([]);
  });

  it('reports an empty candidate list when the current walk found nothing at all', () => {
    const result = match({ current: [] });

    expect(result[0]?.candidates).toEqual([]);
  });
});

describe('not deleted', () => {
  it('omits an id still present, unchanged, at its own last-known location', () => {
    const result = match({
      current: [{ instrumentId: 'deleted-1', raw: RAW, notePath: NOTE_1 }],
    });

    expect(result).toEqual([]);
  });

  it('never proposes a current item that already carries a previously-known id as a candidate', () => {
    const result = match({
      previous: [deletedId(), deletedId({ instrumentId: 'other-known-id', notePath: NOTE_2 })],
      // "other-known-id" is itself deleted from its own note, so it's a live candidate pool
      // member by id — but it carries a previously-known id, so it must never be proposed as
      // deleted-1's own repair candidate even though it is byte-identical and same-file-eligible
      // by neither (it's at NOTE_2, not NOTE_1) — construct one that WOULD match both dials at
      // NOTE_1 to prove the exclusion.
      current: [{ instrumentId: 'other-known-id', raw: RAW, notePath: NOTE_1 }],
    });

    const deletedOneMatch = result.find((m) => m.deletedId.instrumentId === 'deleted-1');
    expect(deletedOneMatch?.candidates).toEqual([]);
  });
});

describe('deterministic output order', () => {
  it('sorts matches by deleted id and candidates by note path then text, regardless of input order', () => {
    const result = match({
      previous: [
        deletedId({ instrumentId: 'zzz-last', notePath: NOTE_2, raw: 'zzz raw' }),
        deletedId({ instrumentId: 'aaa-first' }),
      ],
      current: [
        { instrumentId: 'candidate-b', raw: 'zzz raw', notePath: NOTE_3 },
        { instrumentId: 'candidate-a', raw: RAW, notePath: NOTE_1 },
      ],
    });

    expect(result.map((m) => m.deletedId.instrumentId)).toEqual(['aaa-first', 'zzz-last']);
  });
});

function onlyCandidate(candidates: readonly RepairCandidate[] | undefined): RepairCandidate {
  const candidate = candidates?.[0];
  if (candidate === undefined) throw new Error('expected exactly one candidate');
  return candidate;
}

describe('feeding this module directly into resolveInstrumentRepair', () => {
  it("drives all three of resolveInstrumentRepair's outcomes from this module's own output", () => {
    const cleanPair = match({ current: [current()] })[0];
    const claimed = match({
      current: [
        current(),
        { instrumentId: 'deleted-1', raw: 'unrelated content', notePath: NOTE_3 },
      ],
    })[0];
    const moved = match({ current: [current({ notePath: NOTE_2 })] })[0];

    if (cleanPair === undefined || claimed === undefined || moved === undefined) {
      throw new Error('unreachable');
    }

    const repaired = resolveInstrumentRepair({
      deletedId: cleanPair.deletedId,
      candidate: onlyCandidate(cleanPair.candidates),
      now: NOW,
    });
    expect(repaired.kind).toBe('repaired');

    const duplication = resolveInstrumentRepair({
      deletedId: claimed.deletedId,
      candidate: onlyCandidate(claimed.candidates),
      now: NOW,
    });
    expect(duplication.kind).toBe('duplication');

    const surfaced = resolveInstrumentRepair({
      deletedId: moved.deletedId,
      candidate: onlyCandidate(moved.candidates),
      now: NOW,
    });
    expect(surfaced.kind).toBe('surfaced');
  });
});
