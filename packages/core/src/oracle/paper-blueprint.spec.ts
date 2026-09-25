import { describe, expect, it } from 'vitest';
import {
  buildPaperBlueprint,
  conceptWeight,
  DEFAULT_PAPER_PURPOSE,
  demandServedByGenerator,
  dominantDemand,
  EMPHASIS_WEIGHT_BOOST_DECLARED,
  extentSlotCountTarget,
  flattenDemandReadings,
  focusedPracticeWeight,
  isEligibleConcept,
  MAX_BLUEPRINT_SLOTS_DECLARED,
  matchesEmphasis,
  PAPER_GENERATOR_DECLARED_DEMANDS,
  significantDemands,
  slotWeightForPurpose,
  validatePaperScope,
} from './paper-blueprint.js';
import type {
  PaperDemand,
  PaperFormatClass,
  PaperPurpose,
  PaperRecoveredStructure,
  PaperScopeConcept,
  PaperScopeOutcome,
} from './paper-types.js';

// Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper product scope" and
// "F4.11 — Assessment demand and the gap it admits [D-262]", tagged
// `@auto:core/oracle/paper-blueprint.spec`.

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
    // 6 eligible concepts, slot cap 4 (extent 'shorter' with no recovered structure), alpha 0.25.
    // Focused practice favours WEAKNESS (ol-egov.141.6.17): weight = 0.25*coverageScore +
    // 0.75*(1 - masteryScore), so a LOW masteryScore (a demonstrated weakness) ranks higher.
    // Ranked descending:
    //   holdA (held, mastery 0.1 — weak) -> 0.925   \
    //   holdB (held, mastery 0.3 — weak) -> 0.775    | inside the cap (4 slots)
    //   noHeld (NO held source, mastery 0.1 — weak) -> 0.675
    //   holdC (held, mastery 0.5) -> 0.625   /
    //   holdD (held, mastery 0.7 — strong) -> 0.475   \ rank-excluded — each still HAS a held
    //   holdE (held, mastery 0.9 — strong) -> 0.325   / source, proving rank-excluded is distinct
    //                                                    from no-held-source
    const heldSources = [{ kind: 'notes', sourceId: 's', chunks: ['x'] }] as const;
    const rankExcludedInput = {
      ...baseInput,
      // [D-277]/ruling (i): this scenario's whole point is masteryScore differentiating rank, so
      // it must now explicitly declare the one purpose that reads masteryScore at all — see the
      // new "purpose [D-277]" describe block below for `'assessment-simulation'` never doing so.
      purpose: 'focused-practice' as const,
      alpha: 0.25 as const,
      steering: { extent: 'shorter' as const },
      concepts: [
        concept({ conceptKey: 'holdA', heldSources: [...heldSources], masteryScore: 0.1 }),
        concept({ conceptKey: 'holdB', heldSources: [...heldSources], masteryScore: 0.3 }),
        concept({ conceptKey: 'noHeld', heldSources: [], masteryScore: 0.1 }),
        concept({ conceptKey: 'holdC', heldSources: [...heldSources], masteryScore: 0.5 }),
        concept({ conceptKey: 'holdD', heldSources: [...heldSources], masteryScore: 0.7 }),
        concept({ conceptKey: 'holdE', heldSources: [...heldSources], masteryScore: 0.9 }),
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
      // Focused practice, so the asserted weight below (which reads masteryScore) is meaningful —
      // see the "purpose [D-277]" describe block for the emphasis boost applying identically to
      // assessment-simulation's coverage-only weight.
      purpose: 'focused-practice',
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

// Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper purpose [D-277]",
// tagged `@auto:core/oracle/paper-blueprint.spec`. `[D-277]` / ol-egov.141.87 ruling (i),
// TARGET-4 / ol-v7r5.58: the paper declares its purpose, frozen with the paper, governing
// composition. Two modes; blends deferred.
describe('purpose [D-277]', () => {
  const baseInput = {
    course: 'COURSEA',
    asOf: '2026-09-16',
    assessments: [{ type: 'exam', due: '2026-09-30' }],
    structure: null,
    alpha: 0.5 as const,
    formatClassOf: recallFormatClassOf,
  };

  describe('declared, defaulted, and frozen onto the blueprint', () => {
    it('defaults to assessment-simulation — the never-weakness mode — when no purpose is declared', () => {
      const blueprint = buildPaperBlueprint({
        ...baseInput,
        concepts: [
          concept({
            conceptKey: 'a',
            heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
          }),
        ],
      });
      expect(blueprint.purpose).toBe('assessment-simulation');
      expect(blueprint.purpose).toBe(DEFAULT_PAPER_PURPOSE);
    });

    it('records whichever purpose the caller declares', () => {
      const concepts = [
        concept({
          conceptKey: 'a',
          heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
        }),
      ];
      const simulation = buildPaperBlueprint({
        ...baseInput,
        purpose: 'assessment-simulation',
        concepts,
      });
      const focused = buildPaperBlueprint({ ...baseInput, purpose: 'focused-practice', concepts });
      expect(simulation.purpose).toBe('assessment-simulation');
      expect(focused.purpose).toBe('focused-practice');
    });
  });

  describe('slotWeightForPurpose — the one mechanism purpose governs', () => {
    it('assessment simulation never reads masteryScore: two concepts differing only by a real, demonstrated mastery reading weigh identically', () => {
      const heldSources = [{ kind: 'notes' as const, sourceId: 's', chunks: ['x'] }];
      const wellMastered = concept({ conceptKey: 'a', heldSources, masteryScore: 0.9 });
      const demonstrablyWeak = concept({ conceptKey: 'b', heldSources, masteryScore: 0.1 });
      const wA = slotWeightForPurpose(wellMastered, 0.5, 'assessment-simulation');
      const wB = slotWeightForPurpose(demonstrablyWeak, 0.5, 'assessment-simulation');
      expect(wA.weight).toBe(wB.weight);
      expect(wA.weight).toBe(1); // coverage alone, exactly `conceptCoverageScore`
      expect(wA.masteryFallback).toBe(true);
      expect(wB.masteryFallback).toBe(true); // never merely down-weighted — never read at all
    });

    it('focused practice reads masteryScore favouring WEAKNESS (ol-egov.141.6.17) — a demonstrably weak concept outranks a well-mastered one at equal coverage', () => {
      // Regression: the pre-fix code called the unmodified `conceptWeight` here, whose blend
      // gives a HIGHER weight to a HIGHER masteryScore (weight = alpha*coverage +
      // (1-alpha)*mastery). At alpha 0.5 that put the well-mastered concept (0.9) at weight
      // 0.95 and the demonstrably weak one (0.1) at weight 0.55 — `wHigh.weight > wLow.weight`,
      // exactly backwards for "evidence gaps and demonstrated weakness" (D-277 ruling (i)). The
      // failing assertion this test would have made against that code:
      //   expect(conceptWeight(high, 0.5).weight).toBeLessThan(conceptWeight(low, 0.5).weight)
      //   // conceptWeight(high).weight === 0.95, conceptWeight(low).weight === 0.55 — FAILS.
      const heldSources = [{ kind: 'notes' as const, sourceId: 's', chunks: ['x'] }];
      const wellMastered = concept({ conceptKey: 'a', heldSources, masteryScore: 0.9 });
      const demonstrablyWeak = concept({ conceptKey: 'b', heldSources, masteryScore: 0.1 });
      const wHigh = slotWeightForPurpose(wellMastered, 0.5, 'focused-practice');
      const wLow = slotWeightForPurpose(demonstrablyWeak, 0.5, 'focused-practice');
      expect(wHigh).toEqual(focusedPracticeWeight(wellMastered, 0.5));
      expect(wLow).toEqual(focusedPracticeWeight(demonstrablyWeak, 0.5));
      expect(wLow.weight).toBeGreaterThan(wHigh.weight); // weaker concept ranks higher
      expect(wHigh.weight).not.toBe(wLow.weight); // a real reading makes a real difference
      expect(wHigh.masteryFallback).toBe(false);
    });

    it('conceptWeight itself is unchanged — the general coverage/mastery blend still favours higher mastery, and stays the public paperConceptWeight export', () => {
      const heldSources = [{ kind: 'notes' as const, sourceId: 's', chunks: ['x'] }];
      const high = concept({ conceptKey: 'a', heldSources, masteryScore: 0.9 });
      const low = concept({ conceptKey: 'b', heldSources, masteryScore: 0.1 });
      expect(conceptWeight(high, 0.5).weight).toBeGreaterThan(conceptWeight(low, 0.5).weight);
    });

    it('never turns thin evidence into a weakness claim: a null masteryScore never scores as though a real, low reading had been read', () => {
      const heldSources = [{ kind: 'notes' as const, sourceId: 's', chunks: ['x'] }];
      const noEvidence = concept({ conceptKey: 'a', heldSources, masteryScore: null });
      const demonstrablyWeak = concept({ conceptKey: 'b', heldSources, masteryScore: 0.1 });
      const wNoEvidence = slotWeightForPurpose(noEvidence, 0.5, 'focused-practice');
      const wWeak = slotWeightForPurpose(demonstrablyWeak, 0.5, 'focused-practice');
      // Thin evidence falls back to the undiscounted coverage-only weight (masteryFallback: true)
      // — never the high figure a genuine weak reading produces under the weakness-favouring
      // blend (0.5*1 + 0.5*(1-0.1) = 0.95).
      expect(wNoEvidence.masteryFallback).toBe(true);
      expect(wNoEvidence.weight).toBe(1);
      expect(wWeak.weight).toBe(0.95);
      expect(wNoEvidence.weight).not.toBe(wWeak.weight);
    });
  });

  describe('purpose changes which asks are selected and in what proportions, and nothing else', () => {
    function sittingOf(itemCount: number): PaperRecoveredStructure {
      return {
        sittingCount: 1,
        currentCount: 1,
        historicalCount: 0,
        sittings: [
          {
            regime: 'current',
            sections: [{ label: 'A', questionForm: 'x', itemCount, marks: itemCount }],
          },
        ],
      };
    }
    const heldSources = [{ kind: 'notes' as const, sourceId: 's', chunks: ['x'] }];

    describe('never widens the taught boundary, and never supplies missing source support', () => {
      // Cap == eligible count (3), so every eligible concept becomes a live candidate under
      // EITHER purpose — ranking order cannot itself exclude one, isolating exactly the two
      // invariants under test from the (separately tested) rank-exclusion mechanism.
      const scopeInput = {
        ...baseInput,
        alpha: 0.25 as const,
        structure: sittingOf(3),
        concepts: [
          concept({
            conceptKey: 'ghost',
            conceptName: 'Ghost',
            taughtSignal: 'possible' as const,
            heldSources,
          }),
          concept({
            conceptKey: 'noSource',
            conceptName: 'No Source',
            heldSources: [],
            masteryScore: 0.95,
          }),
          concept({ conceptKey: 'heldA', conceptName: 'Held A', heldSources, masteryScore: 0.5 }),
          concept({ conceptKey: 'heldB', conceptName: 'Held B', heldSources, masteryScore: 0.5 }),
        ],
      };

      it.each(['assessment-simulation', 'focused-practice'] as const)(
        'under %s: the ineligible concept never appears, and the no-held-source concept is always empty, never filled',
        (purpose) => {
          const blueprint = buildPaperBlueprint({ ...scopeInput, purpose });
          expect(blueprint.eligibleCount).toBe(3); // every concept but 'ghost'
          expect(blueprint.slots.some((s) => s.conceptKey === 'ghost')).toBe(false);
          expect(blueprint.emptySlots.some((s) => s.conceptKey === 'ghost')).toBe(false);

          expect(blueprint.slots.some((s) => s.conceptKey === 'noSource')).toBe(false);
          expect(blueprint.emptySlots.find((s) => s.conceptKey === 'noSource')?.reasonCode).toBe(
            'no-held-source',
          );
          expect(blueprint.slots.map((s) => s.conceptKey).sort()).toEqual(['heldA', 'heldB']);
        },
      );
    });

    describe('purpose alone decides which held-source concept fills a capped slot', () => {
      // Three held-source concepts, cap 2 (one sitting, itemCount 2). Alphabetical name order
      // (Aardvark < Mango < Zebra) is deliberately the OPPOSITE of mastery order (Aardvark best
      // mastered, Zebra weakest), so assessment-simulation's coverage-only/alphabetical-tiebreak
      // selection and focused-practice's weakness-favouring selection (ol-egov.141.6.17) provably
      // differ rather than coinciding by accident.
      const scopeInput = {
        ...baseInput,
        alpha: 0.25 as const,
        structure: sittingOf(2),
        concepts: [
          concept({
            conceptKey: 'aardvark',
            conceptName: 'Aardvark',
            heldSources,
            masteryScore: 0.9,
          }),
          concept({ conceptKey: 'mango', conceptName: 'Mango', heldSources, masteryScore: 0.5 }),
          concept({ conceptKey: 'zebra', conceptName: 'Zebra', heldSources, masteryScore: 0.1 }),
        ],
      };

      function buildFor(purpose: PaperPurpose) {
        return buildPaperBlueprint({ ...scopeInput, purpose });
      }

      it('assessment simulation ties all three at coverage-only weight and fills the cap alphabetically, ignoring masteryScore', () => {
        const blueprint = buildFor('assessment-simulation');
        expect(blueprint.slots.map((s) => s.conceptKey).sort()).toEqual(['aardvark', 'mango']);
        expect(blueprint.emptySlots.map((s) => s.conceptKey)).toEqual(['zebra']);
        expect(blueprint.emptySlots[0]?.reasonCode).toBe('rank-excluded');
      });

      it('focused practice ranks by the weakness-favouring blend and fills the cap with the weaker concepts (ol-egov.141.6.17)', () => {
        const blueprint = buildFor('focused-practice');
        // alpha 0.25: weight = 0.25*1 + 0.75*(1-masteryScore) -> aardvark (mastery 0.9) 0.325,
        // mango (0.5) 0.625, zebra (0.1, weakest) 0.925 — the demonstrably weak concept ranks
        // first, and the well-mastered one is excluded.
        expect(blueprint.slots.map((s) => s.conceptKey).sort()).toEqual(['mango', 'zebra']);
        expect(blueprint.emptySlots.map((s) => s.conceptKey)).toEqual(['aardvark']);
      });

      it('the two purposes disagree on which concept is excluded — direct, decisive proof that purpose governs selection', () => {
        const simulation = buildFor('assessment-simulation');
        const focused = buildFor('focused-practice');
        expect(simulation.slots.map((s) => s.conceptKey).sort()).not.toEqual(
          focused.slots.map((s) => s.conceptKey).sort(),
        );
      });
    });
  });
});

// Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Assessment demand and the gap it
// admits [D-262]", tagged `@auto:core/oracle/paper-blueprint.spec`.
describe('demand vocabulary [D-262]', () => {
  function structureWithDemands(
    demands: readonly PaperDemand[],
    sourceRef = 'past-paper-1',
  ): PaperRecoveredStructure {
    return {
      sittingCount: 1,
      currentCount: 1,
      historicalCount: 0,
      sittings: [
        {
          regime: 'current',
          sourceRef,
          sections: [
            { label: 'Section A', questionForm: 'short-answer', itemCount: 5, marks: 20, demands },
          ],
        },
      ],
    };
  }

  describe('flattenDemandReadings', () => {
    it('reads a demand paired with its sitting’s sourceRef', () => {
      const structure = structureWithDemands(['calculate'], 'paper-2024');
      expect(flattenDemandReadings(structure)).toEqual([
        { demand: 'calculate', sourceRef: 'paper-2024' },
      ]);
    });

    it('skips a section’s demands when its sitting carries no sourceRef — never a guessed source', () => {
      const noSource: PaperRecoveredStructure = {
        sittingCount: 1,
        currentCount: 1,
        historicalCount: 0,
        sittings: [
          {
            regime: 'current',
            sections: [
              { label: 'A', questionForm: 'x', itemCount: 1, marks: 1, demands: ['calculate'] },
            ],
          },
        ],
      };
      expect(flattenDemandReadings(noSource)).toEqual([]);
    });

    it('returns [] for null structure', () => {
      expect(flattenDemandReadings(null)).toEqual([]);
    });
  });

  describe('dominantDemand', () => {
    it('defaults to recall-a-fact with no structure or no recovered readings (backward compatible)', () => {
      expect(dominantDemand(null)).toBe('recall-a-fact');
      expect(
        dominantDemand({ sittingCount: 1, currentCount: 1, historicalCount: 0, sittings: [] }),
      ).toBe('recall-a-fact');
    });

    it('picks the highest mark-share demand across recovered sections', () => {
      const structure: PaperRecoveredStructure = {
        sittingCount: 1,
        currentCount: 1,
        historicalCount: 0,
        sittings: [
          {
            regime: 'current',
            sourceRef: 'paper-A',
            sections: [
              {
                label: 'A',
                questionForm: 'x',
                itemCount: 2,
                marks: 10,
                demands: ['interpret-printed-result', 'interpret-printed-result'],
              },
              { label: 'B', questionForm: 'y', itemCount: 1, marks: 5, demands: ['recall-a-fact'] },
            ],
          },
        ],
      };
      expect(dominantDemand(structure)).toBe('interpret-printed-result');
    });

    // `[DEMAND-7]` (ol-egov.141.6.11): the tally unit is marks, not question count — a section
    // with fewer questions but more marks wins over one with more questions but fewer marks. This
    // is the discriminating case a pure-frequency tally would get backwards.
    it('weighs by marks, not by question count — a mark-heavy minority section outranks a larger, lighter one', () => {
      const structure: PaperRecoveredStructure = {
        sittingCount: 1,
        currentCount: 1,
        historicalCount: 0,
        sittings: [
          {
            regime: 'current',
            sourceRef: 'paper-A',
            sections: [
              {
                label: 'Many short recall questions',
                questionForm: 'short-answer',
                itemCount: 10,
                marks: 10,
                demands: Array(10).fill('recall-a-fact'),
              },
              {
                label: 'One mark-heavy question',
                questionForm: 'essay',
                itemCount: 1,
                marks: 15,
                demands: ['interpret-printed-result'],
              },
            ],
          },
        ],
      };
      // By question count, recall-a-fact wins 10 to 1. By marks, interpret-printed-result wins 15
      // to 10 — proving the tally actually switched units rather than coincidentally agreeing.
      expect(dominantDemand(structure)).toBe('interpret-printed-result');
    });
  });

  describe('significantDemands [DEMAND-7]', () => {
    it('returns [] with no recovered evidence', () => {
      expect(significantDemands(null)).toEqual([]);
      expect(
        significantDemands({ sittingCount: 1, currentCount: 1, historicalCount: 0, sittings: [] }),
      ).toEqual([]);
    });

    it('names every demand at or above the declared mark-share bar, ranked highest-share first', () => {
      const structure: PaperRecoveredStructure = {
        sittingCount: 1,
        currentCount: 1,
        historicalCount: 0,
        sittings: [
          {
            regime: 'current',
            sourceRef: 'paper-A',
            sections: [
              {
                label: 'Recall section',
                questionForm: 'multiple-choice',
                itemCount: 20,
                marks: 60,
                demands: Array(20).fill('recall-a-fact'),
              },
              {
                label: 'Apply section',
                questionForm: 'essay',
                itemCount: 2,
                marks: 20,
                demands: Array(2).fill('apply-to-unfamiliar-case'),
              },
              {
                label: 'Compare section — below the bar',
                questionForm: 'short-answer',
                itemCount: 1,
                marks: 1,
                demands: ['compare-or-choose'],
              },
            ],
          },
        ],
      };
      // Shares: recall 60/81 ≈ 74.1%, apply 20/81 ≈ 24.7%, compare 1/81 ≈ 1.2%. Only the first
      // two clear `SIGNIFIANT_DEMAND_MARK_SHARE_DECLARED` (0.2).
      expect(significantDemands(structure)).toEqual(['recall-a-fact', 'apply-to-unfamiliar-case']);
    });

    it('a higher minShare excludes a demand a lower one would have named', () => {
      const structure: PaperRecoveredStructure = {
        sittingCount: 1,
        currentCount: 1,
        historicalCount: 0,
        sittings: [
          {
            regime: 'current',
            sourceRef: 'paper-A',
            sections: [
              {
                label: 'A',
                questionForm: 'x',
                itemCount: 3,
                marks: 75,
                demands: Array(3).fill('recall-a-fact'),
              },
              {
                label: 'B',
                questionForm: 'y',
                itemCount: 1,
                marks: 25,
                demands: ['apply-to-unfamiliar-case'],
              },
            ],
          },
        ],
      };
      expect(significantDemands(structure, 0.2)).toEqual([
        'recall-a-fact',
        'apply-to-unfamiliar-case',
      ]);
      expect(significantDemands(structure, 0.3)).toEqual(['recall-a-fact']);
    });

    it('a section only partially read for demand splits marks by its own itemCount, never by how many demands were recovered — the known items are not inflated', () => {
      const structure: PaperRecoveredStructure = {
        sittingCount: 1,
        currentCount: 1,
        historicalCount: 0,
        sittings: [
          {
            regime: 'current',
            sourceRef: 'paper-A',
            sections: [
              // 10 items, 100 marks, but only 1 item's demand was actually recovered.
              {
                label: 'Partially read',
                questionForm: 'short-answer',
                itemCount: 10,
                marks: 100,
                demands: ['recall-a-fact'],
              },
              {
                label: 'Fully read',
                questionForm: 'y',
                itemCount: 1,
                marks: 10,
                demands: ['calculate'],
              },
            ],
          },
        ],
      };
      // Per-item mark for the partially-read section is 100/10 = 10 (its own itemCount), not
      // 100/1 = 100 (its recovered demands' length) — so the one known recall item contributes 10
      // marks, not 100, and the two demands end up evenly matched (50/50) rather than recall
      // swamping calculate down below the significance bar (which the wrong denominator would do:
      // 100/(100+10) ≈ 90.9% recall vs 9.1% calculate).
      const named = significantDemands(structure);
      expect(named).toHaveLength(2);
      expect(named).toEqual(expect.arrayContaining(['recall-a-fact', 'calculate']));
    });
  });

  describe('PAPER_GENERATOR_DECLARED_DEMANDS / demandServedByGenerator', () => {
    it('both existing generators declare only recall-a-fact today — confirmed against the measured course-E mismatch', () => {
      expect(PAPER_GENERATOR_DECLARED_DEMANDS['cards.generate.v1']).toEqual(['recall-a-fact']);
      expect(PAPER_GENERATOR_DECLARED_DEMANDS['quiz.generate.v1']).toEqual(['recall-a-fact']);
      expect(demandServedByGenerator('quiz.generate.v1', 'recall-a-fact')).toBe(true);
      expect(demandServedByGenerator('cards.generate.v1', 'calculate')).toBe(false);
      expect(demandServedByGenerator('quiz.generate.v1', 'interpret-printed-result')).toBe(false);
    });
  });

  describe('buildPaperBlueprint — demand recorded on the slot, routed against the declaration', () => {
    const baseInput = {
      course: 'COURSEA',
      asOf: '2026-09-16',
      assessments: [{ type: 'exam', due: '2026-09-30' }],
      alpha: 0.5 as const,
      formatClassOf: recallFormatClassOf,
    };

    it('a blueprint slot carries the demand it intends, read from input (b) rather than only the default', () => {
      const structure = structureWithDemands(['recall-a-fact'], 'paper-9');
      const blueprint = buildPaperBlueprint({
        ...baseInput,
        structure,
        concepts: [
          concept({
            conceptKey: 'a',
            heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
          }),
        ],
      });
      expect(blueprint.intendedDemand).toBe('recall-a-fact');
      expect(blueprint.slots[0]?.intendedDemand).toBe('recall-a-fact');
      expect(blueprint.partial).toBe(false);
      expect(blueprint.unbuiltDemand).toBeNull();
    });

    it('demand-unsupported is checked before the held-source check — fires even where a source exists, and even where none does', () => {
      const structure = structureWithDemands(['calculate'], 'src-1');
      const blueprint = buildPaperBlueprint({
        ...baseInput,
        structure,
        concepts: [
          concept({
            conceptKey: 'held',
            heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
          }),
          concept({ conceptKey: 'unheld', heldSources: [] }),
        ],
      });
      expect(blueprint.slots).toEqual([]);
      for (const empty of blueprint.emptySlots) {
        expect(empty.reasonCode).toBe('demand-unsupported');
      }
    });
  });

  describe('[D-262] ruling 8 — the ship-blocking test', () => {
    it('a course whose evidence shows an undeclared demand produces a paper labelled partial, with the gap named and pointed, never an unqualified one', () => {
      const baseInput = {
        course: 'COURSEA',
        asOf: '2026-09-16',
        assessments: [{ type: 'exam', due: '2026-09-30' }],
        alpha: 0.5 as const,
        formatClassOf: recallFormatClassOf,
      };
      const structure = structureWithDemands(
        ['interpret-printed-result'],
        'docs/handoff/past-papers/COURSEA/paper-2024.pdf',
      );

      const blueprint = buildPaperBlueprint({
        ...baseInput,
        structure,
        concepts: [
          concept({
            conceptKey: 'a',
            heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
          }),
          concept({
            conceptKey: 'b',
            heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
          }),
        ],
      });

      // Never an unqualified paper: no item is generated for either otherwise-eligible,
      // otherwise-held concept — the gap is honest, not papered over.
      expect(blueprint.slots).toEqual([]);
      expect(blueprint.emptySlots.map((s) => s.conceptKey).sort()).toEqual(['a', 'b']);
      expect(blueprint.emptySlots.every((s) => s.reasonCode === 'demand-unsupported')).toBe(true);

      // Labelled partial, the gap named...
      expect(blueprint.partial).toBe(true);
      expect(blueprint.unbuiltDemand?.demand).toBe('interpret-printed-result');
      // ...and pointed: at the held, non-sealed past paper that asks it.
      expect(blueprint.unbuiltDemand?.pointerSourceRefs).toEqual([
        'docs/handoff/past-papers/COURSEA/paper-2024.pdf',
      ]);
    });

    it('a course with every demand served carries no partial statement', () => {
      const baseInput = {
        course: 'COURSEA',
        asOf: '2026-09-16',
        assessments: [{ type: 'exam', due: '2026-09-30' }],
        alpha: 0.5 as const,
        formatClassOf: recallFormatClassOf,
      };
      const structure = structureWithDemands(['recall-a-fact'], 'paper-ok');
      const blueprint = buildPaperBlueprint({
        ...baseInput,
        structure,
        concepts: [
          concept({
            conceptKey: 'a',
            heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
          }),
        ],
      });
      expect(blueprint.partial).toBe(false);
      expect(blueprint.unbuiltDemand).toBeNull();
      expect(blueprint.slots).toHaveLength(1);
    });
  });

  // [DEMAND-7] (ol-egov.141.6.11): [DEMAND-6] measured a real course where the dominant demand
  // (by EITHER question count or marks) is recall-a-fact and IS served, while a substantial
  // minority demand — a section worth a quarter of the sitting's marks but only a couple of
  // questions — is not served and, under the old per-dominant-demand-only check, never surfaced.
  // Numbers below are synthetic (round, invented), not the real course's own figures — see
  // `SIGNIFICANT_DEMAND_MARK_SHARE_DECLARED`'s doc for the sensitivity check against the real
  // five-course sample this bead measured.
  describe('[DEMAND-7] — a served dominant demand does not mask a substantial served-elsewhere gap', () => {
    const baseInput = {
      course: 'COURSEA',
      asOf: '2026-09-16',
      assessments: [{ type: 'exam', due: '2026-09-30' }],
      alpha: 0.5 as const,
      formatClassOf: recallFormatClassOf,
    };

    function twoSectionStructure(sourceRef: string): PaperRecoveredStructure {
      return {
        sittingCount: 1,
        currentCount: 1,
        historicalCount: 0,
        sittings: [
          {
            regime: 'current',
            sourceRef,
            sections: [
              {
                label: 'Many short recall questions',
                questionForm: 'multiple-choice',
                itemCount: 20,
                marks: 60,
                demands: Array(20).fill('recall-a-fact'),
              },
              {
                label: 'A mark-heavy minority section',
                questionForm: 'essay',
                itemCount: 2,
                marks: 20,
                demands: Array(2).fill('apply-to-unfamiliar-case'),
              },
            ],
          },
        ],
      };
    }

    it('the paper is built (recall slots fill normally) AND marked partial, naming the unserved minority demand', () => {
      const structure = twoSectionStructure('paper-mixed');
      const blueprint = buildPaperBlueprint({
        ...baseInput,
        structure,
        concepts: [
          concept({
            conceptKey: 'a',
            heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
          }),
        ],
      });

      // The dominant demand (recall-a-fact, 60/80 = 75% of marks) IS served, so this is a
      // PARTIAL paper, never an empty one — the fix must not stop the paper from building.
      expect(blueprint.intendedDemand).toBe('recall-a-fact');
      expect(blueprint.slots).toHaveLength(1);
      expect(blueprint.slots[0]?.intendedDemand).toBe('recall-a-fact');
      expect(blueprint.emptySlots).toEqual([]);

      // ...but the substantial (25%-of-marks) apply-to-unfamiliar-case minority is named, not
      // silently dropped — this is the actual gap [DEMAND-6] measured as invisible.
      expect(blueprint.partial).toBe(true);
      expect(blueprint.unbuiltDemand?.demand).toBe('apply-to-unfamiliar-case');
      expect(blueprint.unbuiltDemand?.pointerSourceRefs).toEqual(['paper-mixed']);
    });

    it('a minority demand BELOW the significance bar does not false-fire a gap', () => {
      const structure: PaperRecoveredStructure = {
        sittingCount: 1,
        currentCount: 1,
        historicalCount: 0,
        sittings: [
          {
            regime: 'current',
            sourceRef: 'paper-small-minority',
            sections: [
              {
                label: 'Recall',
                questionForm: 'multiple-choice',
                itemCount: 19,
                marks: 95,
                demands: Array(19).fill('recall-a-fact'),
              },
              {
                // 5/100 = 5% of the sitting's marks — well under
                // SIGNIFICANT_DEMAND_MARK_SHARE_DECLARED (0.2) — unsupported, but not substantial
                // enough to be a claim the paper is making.
                label: 'One small unsupported question',
                questionForm: 'short-answer',
                itemCount: 1,
                marks: 5,
                demands: ['calculate'],
              },
            ],
          },
        ],
      };
      const blueprint = buildPaperBlueprint({
        ...baseInput,
        structure,
        concepts: [
          concept({
            conceptKey: 'a',
            heldSources: [{ kind: 'notes', sourceId: 's', chunks: ['x'] }],
          }),
        ],
      });
      expect(blueprint.partial).toBe(false);
      expect(blueprint.unbuiltDemand).toBeNull();
      expect(blueprint.slots).toHaveLength(1);
    });
  });
});
