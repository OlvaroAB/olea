/**
 * `buildInsights` carries her composition records through to the effort reading unchanged
 * (`ol-egov.141.89.11.20`), and the barrel re-exports the effort types a caller needs to hand them
 * in and read the fourth status. The reading itself is `./effort.spec.ts`'s; this file only pins
 * the pass-through, so a panel that supplies records gets a comparison and one that does not gets
 * the withheld state, never a comparison against anything else.
 *
 * Course and concept ids are invented letters.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  buildInsights,
  detectEffortImbalance,
  type EffortComposition,
  type EffortStatus,
  type InsightsInput,
} from './index.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-01-05T09:00:00Z');

/** Four twelve-review sessions, one a day, alternating courses A and B, each with its own record. */
function world(): { entries: ReviewLogEntry[]; compositions: EffortComposition[] } {
  const entries: ReviewLogEntry[] = [];
  const compositions: EffortComposition[] = [];
  let index = 0;
  for (let s = 0; s < 4; s += 1) {
    const course = s % 2 === 0 ? 'A' : 'B';
    const compositionId = `composition-${s}`;
    compositions.push({
      compositionId,
      course,
      planAllocation: [
        { courseId: 'A', contributions: [{ name: 'floor', value: 0.3 }] },
        { courseId: 'B', contributions: [{ name: 'floor', value: 0.3 }] },
      ],
    });
    for (let r = 0; r < 12; r += 1) {
      entries.push({
        schemaVersion: 6,
        kind: 'review',
        eventId: `e${index}`,
        timestamp: new Date(START + s * DAY + r * MINUTE).toISOString(),
        instrumentId: `qa:${course}:${index}`,
        instrumentType: 'qa',
        conceptIds: [`${course.toLowerCase()}-1`],
        rating: 'good',
        wasUnsure: false,
        durationMs: MINUTE,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
        compositionId,
      });
      index += 1;
    }
  }
  return { entries, compositions };
}

const CONCEPTS: InsightsInput['concepts'] = [
  { conceptId: 'a-1', courses: ['A'] },
  { conceptId: 'b-1', courses: ['B'] },
];

describe('buildInsights carries composition records to the effort reading (ol-egov.141.89.11.20)', () => {
  it('reads exactly what detectEffortImbalance reads from the same records', () => {
    const { entries, compositions } = world();
    const summary = buildInsights({ entries, concepts: CONCEPTS, compositions });
    expect(summary.effort).toEqual(
      detectEffortImbalance({ entries, concepts: CONCEPTS, compositions }),
    );
    // A balanced window over two recorded courses is compared, not withheld.
    expect(summary.effort.status).toBe('not-observed');
    expect(summary.effort.measured?.windowCompositions.map((c) => c.compositionId)).toEqual([
      'composition-0',
      'composition-1',
      'composition-2',
      'composition-3',
    ]);
  });

  it('no records handed in: the comparison is withheld, never computed from the deprecated floor shares', () => {
    const { entries } = world();
    const status: EffortStatus = buildInsights({
      entries,
      concepts: CONCEPTS,
      floorShares: [
        { course: 'A', floorShare: 0.3 },
        { course: 'B', floorShare: 0.3 },
      ],
    }).effort.status;
    expect(status).toBe('comparison-unavailable');
  });
});
