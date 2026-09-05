// test/fixture-oracle-history-strong-recall.spec.ts — `ol-v7r5.41`: the "confirm
// with the real reader" half of the bead. `generate-fixture-oracle-history.mjs`'s
// `assertStrongRecallEligible` checks everything `computeConceptMastery` can see
// with no clock and no scheduler (stage, recognition mix, day count, depth
// evidence) at GENERATION time; it cannot check the `holding` vitality reading,
// which needs both. This file is that other half, run at TEST time, over the
// same generated output and through the SAME reader `open-session.ts` composes
// in production (`packages/plugin/src/review/strong-recall-wiring.ts`'s
// `createStrongRecallProposalReader`) — never a re-implementation of its
// arithmetic.
//
// Before this bead, no fixture concept could ever clear this predicate (see
// `ol-v7r5.41`'s own description, and `fixture-oracle-history.mjs`'s "THE FIFTH
// STORY" section): the four GEOL204 stories each fail for a different
// structural reason, and none of them is fixable by adding more MCQ events,
// because `mcq` is permanently excluded from the vitality fold
// (`packages/core/src/mastery/vitality.ts`'s `isRecallTier`). This is the
// regression for the fifth story, Appoggiatura, added to close that gap.

import type { ReviewLogRecord } from 'olea-contracts';
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createStrongRecallProposalReader } from '../../plugin/src/review/strong-recall-wiring.js';
import { FIXTURE_ORACLE_HISTORY } from '../src/oracle/fixture-oracle-history.js';

function isReview(entry: (typeof FIXTURE_ORACLE_HISTORY)[number]): entry is ReviewLogRecord {
  return entry.kind === 'review';
}

/** `ReviewLogEntry` is a kind union; only the `review` member carries `instrumentId`/`conceptIds`. */
const REVIEW_ENTRIES = FIXTURE_ORACLE_HISTORY.filter(isReview);

/**
 * The workbench's own fixed instant (`src/clock.ts`'s `WORKBENCH_NOW`) —
 * duplicated as a literal rather than imported, so this regression proves the
 * predicate holds at the SAME instant the `strong-recall-banner` scenario
 * actually runs at, without silently drifting if that constant ever moves
 * (a changed literal here would need a deliberate edit, not an accidental
 * import chain).
 */
const NOW = new Date('2027-01-15T09:15:00.000Z');

describe('F2.21 strong-recall proposal — the fixture history has a real eligible concept (ol-v7r5.41)', () => {
  it('fires for Appoggiatura, through the real reader, at the workbench’s own instant', () => {
    const appoggiaturaEntry = REVIEW_ENTRIES.find((entry) =>
      entry.instrumentId.startsWith('wb-fixture-oracle:appoggiatura'),
    );
    expect(appoggiaturaEntry).toBeDefined();
    const conceptId = appoggiaturaEntry?.conceptIds[0];
    expect(conceptId).toBeDefined();
    if (conceptId === undefined) return;

    const reader = createStrongRecallProposalReader({
      entries: FIXTURE_ORACLE_HISTORY,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    const decision = reader({ conceptIds: [conceptId] });

    expect(decision.shouldPropose).toBe(true);
    if (!decision.shouldPropose) return;
    expect(decision.reason.kind).toBe('strong-recall');
    expect(decision.reason.successfulScoredDays).toBeGreaterThanOrEqual(4);
  });

  it('does not fire for any of the four oracle-ranked concepts (the measurement ol-v7r5.41 is FOR)', () => {
    const reader = createStrongRecallProposalReader({
      entries: FIXTURE_ORACLE_HISTORY,
      scheduler: createFsrsScheduler(),
      now: NOW,
    });

    const rankedConceptIds = new Set(
      REVIEW_ENTRIES.filter(
        (entry) => !entry.instrumentId.startsWith('wb-fixture-oracle:appoggiatura'),
      ).flatMap((entry) => entry.conceptIds),
    );
    expect(rankedConceptIds.size).toBeGreaterThan(0);

    for (const conceptId of rankedConceptIds) {
      const decision = reader({ conceptIds: [conceptId] });
      expect(decision.shouldPropose, `conceptId ${conceptId}`).toBe(false);
    }
  });
});
