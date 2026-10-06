import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/types.js';
import {
  type OutcomePageState,
  type OutcomeRevisionPages,
  outcomeDeliveryStanding,
  outcomePagesReadInFull,
  outcomeRevisionReadInFull,
  outcomesToRetireOnRevision,
  planOutcomeDelivery,
} from './retire-on-revision.js';
import type { OutcomeRecord } from './types.js';

// Scenarios: olea-service/features/F4-oracle.md, F4.1 — "a version counts as read in full only when
// every expected page is settled" and the four after it, tagged
// `@auto:core/outcome/retire-on-revision.spec` (ol-egov.141.89.7.68, [D-531]). Synthetic values only.

const PATH = '03 Courses/SYNTH101/Objectives.pdf' as VaultPath;
const OTHER_PATH = '03 Courses/SYNTH101/Other.pdf' as VaultPath;

function extracted(page: number): OutcomePageState {
  return { page, reading: 'read', outcomesExtracted: true };
}
function readOnly(page: number): OutcomePageState {
  return { page, reading: 'read', outcomesExtracted: false };
}
function empty(page: number): OutcomePageState {
  return { page, reading: 'nothing-to-read', outcomesExtracted: false };
}
function notRead(page: number): OutcomePageState {
  return { page, reading: 'not-read', outcomesExtracted: false };
}

function revision(overrides: Partial<OutcomeRevisionPages> = {}): OutcomeRevisionPages {
  return {
    sourcePath: PATH,
    revisionDigest: 'rev-2',
    expectedPages: [1, 2, 3],
    history: [],
    knownRevisions: ['rev-1', 'rev-2'],
    ...overrides,
  };
}

function statesOf(...states: OutcomePageState[]): ReadonlyMap<number, OutcomePageState> {
  return new Map(states.map((state) => [state.page, state]));
}

function record(overrides: Partial<OutcomeRecord> & { id: string }): OutcomeRecord {
  return {
    courses: ['SYNTH101'],
    source: { path: PATH, blockIndex: 0 },
    label: `Synthetic outcome ${overrides.id}`,
    conceptKeys: [],
    status: 'active',
    provenance: { promptVersion: 'p1', modelVersion: 'm1' },
    mintedAt: '2026-10-06',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('outcomePagesReadInFull — the completeness rule ([D-531])', () => {
  it('is true when every expected page is extracted, or held no text', () => {
    expect(outcomePagesReadInFull([1, 2, 3], statesOf(extracted(1), empty(2), extracted(3)))).toBe(
      true,
    );
  });

  it('a page with no state yet blocks: the expected list is explicit, never inferred from silence', () => {
    expect(outcomePagesReadInFull([1, 2, 3], statesOf(extracted(1), extracted(3)))).toBe(false);
  });

  it('a page read but not yet extracted blocks', () => {
    expect(
      outcomePagesReadInFull([1, 2, 3], statesOf(extracted(1), readOnly(2), extracted(3))),
    ).toBe(false);
  });

  it('a failed, unavailable, partial or not-legible page (not-read) blocks, marked or not', () => {
    expect(
      outcomePagesReadInFull([1, 2, 3], statesOf(extracted(1), notRead(2), extracted(3))),
    ).toBe(false);
    // A partly read page may carry text that was extracted; its uncovered part still never
    // establishes absence.
    expect(
      outcomePagesReadInFull(
        [1, 2, 3],
        statesOf(
          extracted(1),
          { page: 2, reading: 'not-read', outcomesExtracted: true },
          extracted(3),
        ),
      ),
    ).toBe(false);
  });

  it('a page named by a state but missing from the expected list is still required', () => {
    expect(outcomePagesReadInFull([1, 2], statesOf(extracted(1), extracted(2), readOnly(4)))).toBe(
      false,
    );
  });

  it('an empty expected list, or a version whose every page held no text, is never read in full', () => {
    expect(outcomePagesReadInFull([], statesOf())).toBe(false);
    expect(outcomePagesReadInFull([1, 2], statesOf(empty(1), empty(2)))).toBe(false);
  });
});

describe('outcomeRevisionReadInFull — once read in full, stays read in full', () => {
  it('is false until the last required page settles, then true', () => {
    const partway = revision({ history: [extracted(1), empty(2)] });
    expect(outcomeRevisionReadInFull(partway)).toBe(false);
    const whole = revision({ history: [extracted(1), empty(2), extracted(3)] });
    expect(outcomeRevisionReadInFull(whole)).toBe(true);
  });

  it('a later change to a page (read again, then failed) does not reopen the version', () => {
    const reopenedLater = revision({
      history: [extracted(1), empty(2), extracted(3), notRead(3), readOnly(1)],
    });
    expect(outcomeRevisionReadInFull(reopenedLater)).toBe(true);
  });

  it('a page extracted and then changed before the others settle does not count', () => {
    // Page 1 was extracted, then its reading changed (the mark reset) before page 3 settled.
    const reset = revision({ history: [extracted(1), empty(2), readOnly(1), extracted(3)] });
    expect(outcomeRevisionReadInFull(reset)).toBe(false);
  });

  it('a stray page named later in the history is required from the start', () => {
    const stray = revision({
      expectedPages: [1],
      history: [extracted(1), readOnly(2), extracted(2)],
    });
    // Required pages are 1 and 2; the version settles only at the third state.
    expect(outcomeRevisionReadInFull(stray)).toBe(true);
    expect(outcomeRevisionReadInFull({ ...stray, history: stray.history.slice(0, 2) })).toBe(false);
  });

  it('depends on the stored history alone: the same history read in two sessions gives one answer', () => {
    const history = [extracted(1), empty(2), extracted(3)];
    expect(outcomeRevisionReadInFull(revision({ history }))).toBe(
      outcomeRevisionReadInFull(revision({ history: [...history] })),
    );
  });
});

describe('outcomeDeliveryStanding — placing a delivery against the current version', () => {
  it('open while the current version is not yet read in full', () => {
    expect(outcomeDeliveryStanding(revision({ history: [extracted(1)] }), 'rev-2')).toBe('open');
  });

  it('a reread once it is', () => {
    const whole = revision({ history: [extracted(1), empty(2), extracted(3)] });
    expect(outcomeDeliveryStanding(whole, 'rev-2')).toBe('reread');
  });

  it('late when the digest names any other version', () => {
    expect(outcomeDeliveryStanding(revision(), 'rev-1')).toBe('late');
    expect(outcomeDeliveryStanding(revision(), 'rev-never-listed')).toBe('late');
  });

  it('unplaced when the delivery has no digest or there is no current version', () => {
    expect(outcomeDeliveryStanding(revision(), undefined)).toBe('unplaced');
    expect(outcomeDeliveryStanding(undefined, 'rev-2')).toBe('unplaced');
  });
});

describe('planOutcomeDelivery — what each standing may write', () => {
  it('open: resolve, restate matched records and reinstate, mark the pages', () => {
    const plan = planOutcomeDelivery(revision({ history: [extracted(1)] }), 'rev-2');
    expect(plan).toEqual({
      standing: 'open',
      resolve: true,
      revision: { digest: 'rev-2', restates: true },
      markPages: true,
    });
  });

  it('reread: resolve, leave matched records as they are, mark the pages', () => {
    const whole = revision({ history: [extracted(1), empty(2), extracted(3)] });
    expect(planOutcomeDelivery(whole, 'rev-2')).toEqual({
      standing: 'reread',
      resolve: true,
      revision: { digest: 'rev-2', restates: false },
      markPages: true,
    });
  });

  it('late: nothing is resolved, minted, stamped or marked', () => {
    expect(planOutcomeDelivery(revision(), 'rev-1')).toEqual({
      standing: 'late',
      resolve: false,
      markPages: false,
    });
  });

  it('unplaced with a digest: mint stamped with it, matched records untouched, no page marked', () => {
    expect(planOutcomeDelivery(undefined, 'rev-2')).toEqual({
      standing: 'unplaced',
      resolve: true,
      revision: { digest: 'rev-2', restates: false },
      markPages: false,
    });
  });

  it('unplaced with no digest: resolved as before this rule, with no stamp', () => {
    expect(planOutcomeDelivery(revision(), undefined)).toEqual({
      standing: 'unplaced',
      resolve: true,
      markPages: false,
    });
  });
});

describe('outcomesToRetireOnRevision — which outcomes a version read in full retires', () => {
  const whole = revision({ history: [extracted(1), empty(2), extracted(3)] });

  it('retires each active outcome on the document stamped with an earlier known version', () => {
    const records = [
      record({ id: 'a', statedInRevision: 'rev-1' }),
      record({ id: 'b', statedInRevision: 'rev-2' }),
    ];
    expect(outcomesToRetireOnRevision(records, whole)).toEqual(['a']);
  });

  it('leaves outcomes with no stamp, or stamped with a version the page record never listed', () => {
    const records = [
      record({ id: 'unstamped' }),
      record({ id: 'unknown', statedInRevision: 'rev-from-elsewhere' }),
    ];
    expect(outcomesToRetireOnRevision(records, whole)).toEqual([]);
  });

  it('leaves outcomes on other documents, and outcomes already retired', () => {
    const records = [
      record({
        id: 'elsewhere',
        source: { path: OTHER_PATH, blockIndex: 0 },
        statedInRevision: 'rev-1',
      }),
      record({ id: 'gone', status: 'retired', statedInRevision: 'rev-1' }),
    ];
    expect(outcomesToRetireOnRevision(records, whole)).toEqual([]);
  });

  it('retires nothing while the version is not read in full', () => {
    const partway = revision({ history: [extracted(1), empty(2)] });
    expect(
      outcomesToRetireOnRevision([record({ id: 'a', statedInRevision: 'rev-1' })], partway),
    ).toEqual([]);
  });

  it('returns ids in a fixed order however the records were listed', () => {
    const records = [
      record({ id: 'c', statedInRevision: 'rev-1' }),
      record({ id: 'a', statedInRevision: 'rev-1' }),
    ];
    expect(outcomesToRetireOnRevision(records, whole)).toEqual(['a', 'c']);
  });
});
