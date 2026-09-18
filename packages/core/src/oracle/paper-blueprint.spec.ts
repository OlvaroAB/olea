import { describe, expect, it } from 'vitest';
import {
  buildPaperBlueprint,
  EMPHASIS_WEIGHT_BOOST_DECLARED,
  extentSlotCountTarget,
  isEligibleConcept,
  MAX_BLUEPRINT_SLOTS_DECLARED,
  matchesEmphasis,
  validatePaperScope,
} from './paper-blueprint.js';
import type {
  PaperFormatClass,
  PaperRecoveredStructure,
  PaperScopeConcept,
  PaperScopeOutcome,
} from './paper-types.js';

// Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper product scope", the
// steering and eligibility blocks, tagged `@auto:core/oracle/paper-blueprint.spec`.

function concept(
  overrides: Partial<PaperScopeConcept> & { conceptKey: string },
): PaperScopeConcept {
  return {
    conceptName: overrides.conceptKey,
    taughtSignal: 'yes',
    heldSources: [],
    masteryScore: null,
    ...overrides,
  };
}

const recallFormatClassOf = (): PaperFormatClass => 'recall-style';

describe('isEligibleConcept', () => {
  it('accepts yes/probable, rejects possible', () => {
    expect(isEligibleConcept(concept({ conceptKey: 'a', taughtSignal: 'yes' }))).toBe(true);
    expect(isEligibleConcept(concept({ conceptKey: 'b', taughtSignal: 'probable' }))).toBe(true);
    expect(isEligibleConcept(concept({ conceptKey: 'c', taughtSignal: 'possible' }))).toBe(false);
  });
});

describe('validatePaperScope', () => {
  it('throws on a past-paper held source (blinding rule)', () => {
    const withPastPaper = [
      concept({
        conceptKey: 'a',
        heldSources: [{ kind: 'past-paper', sourceId: 's1', chunks: ['x'] }],
      }),
    ];
    expect(() => validatePaperScope(withPastPaper)).toThrow(/never grounds/);
  });

  it('accepts every allowed kind', () => {
    const ok = [
      concept({
        conceptKey: 'a',
        heldSources: [{ kind: 'notes', sourceId: 's1', chunks: ['x'] }],
      }),
    ];
    expect(() => validatePaperScope(ok)).not.toThrow();
  });
});

describe('matchesEmphasis', () => {
  const outcomesById = new Map<string, PaperScopeOutcome>([
    ['o1', { outcomeId: 'o1', label: 'Explain cellular respiration', conceptKeys: [] }],
  ]);

  it('matches the concept name directly', () => {
    const c = concept({ conceptKey: 'a', conceptName: 'Krebs cycle' });
    expect(matchesEmphasis(c, 'krebs', outcomesById)).toBe(true);
  });

  it('matches via the parent outcome label when the concept name does not match', () => {
    const c = concept({ conceptKey: 'a', conceptName: 'ATP synthase', outcomeId: 'o1' });
    expect(matchesEmphasis(c, 'cellular respiration', outcomesById)).toBe(true);
  });

  it('is false with no emphasis, and never matches something unattested', () => {
    const c = concept({ conceptKey: 'a', conceptName: 'ATP synthase' });
    expect(matchesEmphasis(c, undefined, outcomesById)).toBe(false);
    expect(matchesEmphasis(c, 'photosynthesis', outcomesById)).toBe(false);
  });
});

describe('extentSlotCountTarget', () => {
  it('falls back to the declared table with no recovered structure', () => {
    expect(extentSlotCountTarget('shorter', null)).toBe(4);
    expect(extentSlotCountTarget('standard', null)).toBe(6);
    expect(extentSlotCountTarget('longer', null)).toBe(8);
  });

  it('derives from recovered sittings when available, clamped to the declared ceiling', () => {
    const structure: PaperRecoveredStructure = {
      sittingCount: 2,
      currentCount: 1,
      historicalCount: 1,
      sittings: [
        {
          regime: 'current',
          sections: [{ label: 'A', questionForm: 'MCQ', itemCount: 20, marks: 20 }],
        },
        {
          regime: 'historical',
          sections: [{ label: 'A', questionForm: 'MCQ', itemCount: 5, marks: 5 }],
        },
      ],
    };
    expect(extentSlotCountTarget('shorter', structure)).toBe(5);
    expect(extentSlotCountTarget('longer', structure)).toBe(MAX_BLUEPRINT_SLOTS_DECLARED); // 20 clamped to 8
  });
});

describe('buildPaperBlueprint', () => {
  const baseInput = {
    course: 'COURSEA',
    asOf: '2026-09-16',
    assessments: [{ type: 'exam', due: '2026-09-30' }],
    structure: null,
    alpha: 0.5 as const,
    formatClassOf: recallFormatClassOf,
  };

  it('excludes possible-only concepts and concepts with no held source (F4.10)', () => {
    const blueprint = buildPaperBlueprint({
      ...baseInput,
      concepts: [
        concept({
          conceptKey: 'a',
          taughtSignal: 'possible',
          heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
        }),
        concept({ conceptKey: 'b', taughtSignal: 'yes', heldSources: [] }),
        concept({
          conceptKey: 'c',
          taughtSignal: 'yes',
          heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
        }),
      ],
    });
    expect(blueprint.slots.map((s) => s.conceptKey)).toEqual(['c']);
    expect(blueprint.emptySlots.map((s) => s.conceptKey)).toEqual(['b']);
    expect(blueprint.emptySlots[0]?.reasonCode).toBe('no-held-source');
    expect(blueprint.eligibleCount).toBe(2); // b and c are eligible; a is not (possible)
  });

  describe('[D-258] — slot-cap-excluded concepts named as empty slots', () => {
    // 6 eligible concepts, slot cap 4 (extent 'shorter' with no recovered structure), alpha 0.25
    // so weight = 0.25*coverageScore + 0.75*masteryScore. Ranked descending:
    //   holdA (held, mastery 0.9) -> 0.925   \
    //   holdB (held, mastery 0.7) -> 0.775    | inside the cap (4 slots)
    //   noHeld (NO held source, mastery 0.9) -> 0.675
    //   holdC (held, mastery 0.5) -> 0.625   /
    //   holdD (held, mastery 0.3) -> 0.475   \ rank-excluded — each still HAS a held source,
    //   holdE (held, mastery 0.1) -> 0.325   / proving rank-excluded is distinct from no-held-source
    const heldSources = [{ kind: 'notes', sourceId: 's', chunks: ['x'] }] as const;
    const rankExcludedInput = {
      ...baseInput,
      alpha: 0.25 as const,
      steering: { extent: 'shorter' as const },
      concepts: [
        concept({ conceptKey: 'holdA', heldSources: [...heldSources], masteryScore: 0.9 }),
        concept({ conceptKey: 'holdB', heldSources: [...heldSources], masteryScore: 0.7 }),
        concept({ conceptKey: 'noHeld', heldSources: [], masteryScore: 0.9 }),
        concept({ conceptKey: 'holdC', heldSources: [...heldSources], masteryScore: 0.5 }),
        concept({ conceptKey: 'holdD', heldSources: [...heldSources], masteryScore: 0.3 }),
        concept({ conceptKey: 'holdE', heldSources: [...heldSources], masteryScore: 0.1 }),
      ],
    };

    it('names every concept ranked below the cap as empty with reasonCode rank-excluded, and none as filled', () => {
      const blueprint = buildPaperBlueprint(rankExcludedInput);
      expect(extentSlotCountTarget('shorter', null)).toBe(4);
      expect(blueprint.slots.map((s) => s.conceptKey)).toEqual(['holdA', 'holdB', 'holdC']);
      const rankExcluded = blueprint.emptySlots.filter((s) => s.reasonCode === 'rank-excluded');
      expect(rankExcluded.map((s) => s.conceptKey).sort()).toEqual(['holdD', 'holdE']);
      for (const key of ['holdD', 'holdE']) {
        expect(blueprint.slots.some((s) => s.conceptKey === key)).toBe(false);
      }
    });

    it('filled slots plus empty slots always equal the eligible count', () => {
      const blueprint = buildPaperBlueprint(rankExcludedInput);
      expect(blueprint.eligibleCount).toBe(6);
      expect(blueprint.slots.length + blueprint.emptySlots.length).toBe(blueprint.eligibleCount);

      // Also holds when eligibleCount <= slotCap (nothing to exclude by rank at all).
      const smallBlueprint = buildPaperBlueprint({
        ...baseInput,
        concepts: [
          concept({
            conceptKey: 'a',
            heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
          }),
        ],
      });
      expect(smallBlueprint.slots.length + smallBlueprint.emptySlots.length).toBe(
        smallBlueprint.eligibleCount,
      );
    });

    it('a no-held-source concept inside the cap is unchanged by the cap fix, and the two reason codes never cross', () => {
      const blueprint = buildPaperBlueprint(rankExcludedInput);
      const noHeld = blueprint.emptySlots.find((s) => s.conceptKey === 'noHeld');
      expect(noHeld?.reasonCode).toBe('no-held-source');

      // A concept excluded by rank never receives no-held-source, and vice versa.
      for (const empty of blueprint.emptySlots) {
        if (empty.conceptKey === 'noHeld') {
          expect(empty.reasonCode).not.toBe('rank-excluded');
        } else {
          expect(empty.reasonCode).not.toBe('no-held-source');
        }
      }
    });
  });

  it('labels grounding by held-source kind (notes vs. everything else)', () => {
    const blueprint = buildPaperBlueprint({
      ...baseInput,
      concepts: [
        concept({
          conceptKey: 'a',
          heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
        }),
        concept({
          conceptKey: 'b',
          heldSources: [{ kind: 'textbook', sourceId: 's', chunks: ['x'] }],
        }),
      ],
    });
    const byKey = new Map(blueprint.slots.map((s) => [s.conceptKey, s]));
    expect(byKey.get('a')?.groundingLabel).toBe('covered-by-her-material');
    expect(byKey.get('b')?.groundingLabel).toBe('course-scope-only');
  });

  it('emphasis reweights only already-eligible concepts, never adds one', () => {
    const blueprint = buildPaperBlueprint({
      ...baseInput,
      concepts: [
        concept({
          conceptKey: 'a',
          conceptName: 'Krebs cycle',
          heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
          masteryScore: 0.5,
        }),
        concept({
          conceptKey: 'b',
          conceptName: 'Glycolysis',
          heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
          masteryScore: 0.5,
        }),
      ],
      steering: { emphasis: 'krebs' },
    });
    const a = blueprint.slots.find((s) => s.conceptKey === 'a');
    const b = blueprint.slots.find((s) => s.conceptKey === 'b');
    expect(a?.emphasised).toBe(true);
    expect(b?.emphasised).toBe(false);
    expect(a?.weight).toBeCloseTo((0.5 * 1 + 0.5 * 0.5) * EMPHASIS_WEIGHT_BOOST_DECLARED);
    // The emphasis boost never adds a concept the examiner does not attest — both concepts here
    // are already eligible; a third, ineligible concept is asserted absent from the slots.
    expect(blueprint.slots.map((s) => s.conceptKey).sort()).toEqual(['a', 'b']);
  });

  it('format class is derived from assessments and never steerable', () => {
    const blueprint = buildPaperBlueprint({
      ...baseInput,
      concepts: [
        concept({
          conceptKey: 'a',
          heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
        }),
      ],
      // steering carries no formatClass field at all — TypeScript itself refuses one; this
      // assertion is the runtime half of that same guarantee.
      steering: { extent: 'longer' },
    });
    expect(blueprint.formatClass).toBe('recall-style');
    expect(blueprint.slots[0]?.taskId).toBe('quiz.generate.v1');
  });
});
