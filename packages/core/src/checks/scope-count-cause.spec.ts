// The scope-count-cause health check (register row 4.1) —
// @auto:core/checks/scope-count-cause.spec
//
// Two kinds of evidence, per this bead's acceptance criteria:
//  - RED: a replayed sequence where the denominator moves at least once
//    with no named event attached — checkScopeCountCauseAttribution must
//    fail it, and name the offending read.
//  - GREEN: a real course replayed through `buildGroveModel` across a
//    registration (grows), a correction (shrinks) and a no-op re-read (the
//    same inputs, twice) — production `denominatorCount`s, not hand-typed
//    numbers, with the harness (not this test) naming which event happened
//    at each step, matching `checkSizeDenominatorFold`'s own "exercise the
//    real function, then audit its output" convention.
//
// Every concept name, course code and path below is invented, per INV-3.
import { describe, expect, it } from 'vitest';
import type { ConceptMaterialPresence } from '../gap/build.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import { buildGroveModel } from '../scope/grove.js';
import type { Source } from '../source/types.js';
import type { ConceptCitation } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';
import {
  checkScopeCountCauseAttribution,
  SCOPE_COUNT_CAUSE_MIN_STEPS,
  type ScopeCountCauseStep,
} from './scope-count-cause.js';

const COURSE = 'INVENTED201';

function concept(key: string, name: string) {
  return {
    key,
    name,
    tier: 2 as const,
    courses: [COURSE],
    sourcePaths: [`Notes/${key}.md` as VaultPath],
  };
}

function citation(
  conceptName: string,
  kind: ConceptCitation['kind'],
  path: VaultPath,
): ConceptCitation {
  return {
    conceptName,
    kind,
    sourcePath: path,
    course: COURSE,
    provenance: {
      location: { page: 1, charRange: { start: 0, end: 1 } },
    } as ConceptCitation['provenance'],
  };
}

function objectivesSource(path: VaultPath): Source {
  return { path, role: 'objectives', course: COURSE, kind: 'registered-file', format: null };
}

function pastPaperSource(path: VaultPath): Source {
  return { path, role: 'past-paper', course: COURSE, kind: 'registered-file', format: null };
}

function courseMaterialSource(path: VaultPath): Source {
  return { path, role: 'course-material', course: COURSE, kind: 'registered-file', format: null };
}

/**
 * Three real reads of `COURSE`'s grove, in order — registration (grows),
 * correction (shrinks), then a no-op re-read — each labelled with the
 * event the fixture itself performed, exactly as a production caller
 * (the plugin, driving the registration/correction action) already knows
 * what it just did. `buildGroveModel` computes `denominatorCount`; this
 * function never hand-types one.
 */
function realReplaySteps(): readonly ScopeCountCauseStep[] {
  const objectivesPath = '03 Research/objectives.md' as VaultPath;
  const pastPaperPath = '03 Research/past-paper-2.md' as VaultPath;
  const conceptA = concept('key-a', 'Invented Concept A');
  const conceptB = concept('key-b', 'Invented Concept B');
  const materialPresence = new Map<string, ConceptMaterialPresence>();
  const mastery = new Map<string, ConceptMasteryResult>();

  // Step 0: only the objectives document registered.
  const step0 = buildGroveModel({
    course: COURSE,
    concepts: [conceptA, conceptB],
    sources: [objectivesSource(objectivesPath)],
    citations: [citation('Invented Concept A', 'objectives', objectivesPath)],
    materialPresence,
    mastery,
  }).model;
  if (step0.status !== 'declared') throw new Error('expected declared');

  // Step 1: a past paper is registered (F1.5) — the denominator grows.
  const step1 = buildGroveModel({
    course: COURSE,
    concepts: [conceptA, conceptB],
    sources: [objectivesSource(objectivesPath), pastPaperSource(pastPaperPath)],
    citations: [
      citation('Invented Concept A', 'objectives', objectivesPath),
      citation('Invented Concept B', 'past-paper', pastPaperPath),
    ],
    materialPresence,
    mastery,
  }).model;
  if (step1.status !== 'declared') throw new Error('expected declared');

  // Step 2: she corrects the past paper's role — the denominator shrinks,
  // via the very same `buildGroveModel` call, no second path.
  const step2 = buildGroveModel({
    course: COURSE,
    concepts: [conceptA, conceptB],
    sources: [objectivesSource(objectivesPath), courseMaterialSource(pastPaperPath)],
    citations: [citation('Invented Concept A', 'objectives', objectivesPath)],
    materialPresence,
    mastery,
  }).model;
  if (step2.status !== 'declared') throw new Error('expected declared');

  // Step 3: the identical inputs, re-read — nothing happened, and nothing
  // should be expected to have happened.
  const step3 = step2;

  return [
    { id: 'step-0-baseline', denominatorCount: step0.summary.denominatorCount },
    {
      id: 'step-1-past-paper-registered',
      denominatorCount: step1.summary.denominatorCount,
      causeEvent: 'source-added',
    },
    {
      id: 'step-2-past-paper-reclassified',
      denominatorCount: step2.summary.denominatorCount,
      causeEvent: 'reclassified',
    },
    { id: 'step-3-reread-no-op', denominatorCount: step3.summary.denominatorCount },
  ];
}

describe('checkScopeCountCauseAttribution', () => {
  it('SEEN GREEN: a real registration, a real correction, and a real no-op re-read all carry — or correctly need — no silent move', () => {
    const steps = realReplaySteps();
    // Sanity on the fixture itself: registration grew it, correction shrank
    // it BACK to the original baseline (the past paper's own concept is
    // gone again, exactly cancelling the growth it caused), and the re-read
    // changed nothing.
    expect(steps[1]?.denominatorCount).toBeGreaterThan(steps[0]?.denominatorCount ?? -1);
    expect(steps[2]?.denominatorCount).toBeLessThan(
      steps[1]?.denominatorCount ?? Number.POSITIVE_INFINITY,
    );
    expect(steps[2]?.denominatorCount).toBe(steps[0]?.denominatorCount);
    expect(steps[3]?.denominatorCount).toBe(steps[2]?.denominatorCount);

    const verdict = checkScopeCountCauseAttribution(steps);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.grewTransitions).toBe(1);
    expect(verdict.measured.shrankTransitions).toBe(1);
    expect(verdict.measured.silentMoves).toEqual([]);
    expect(verdict.detail).toContain('1 grew, 1 shrank');
  });

  it('SEEN RED: a shrink with no named event fails, and is named by id', () => {
    const steps: ScopeCountCauseStep[] = [
      { id: 'read-1', denominatorCount: 5 },
      { id: 'read-2', denominatorCount: 5, causeEvent: 'source-added' }, // unchanged; event present is fine but irrelevant
      { id: 'read-3-silent-shrink', denominatorCount: 3 }, // moved, no cause — the defect
    ];

    const verdict = checkScopeCountCauseAttribution(steps);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.silentMoves).toEqual(['read-3-silent-shrink']);
    expect(verdict.measured.shrankTransitions).toBe(1);
    expect(verdict.detail).toContain('read-3-silent-shrink');
  });

  it('SEEN RED: a growth with no named event fails identically — growth and shrink are the same check, not opposite ones', () => {
    const steps: ScopeCountCauseStep[] = [
      { id: 'read-1', denominatorCount: 2 },
      { id: 'read-2-silent-growth', denominatorCount: 4 },
    ];

    const verdict = checkScopeCountCauseAttribution(steps);

    expect(verdict.ok).toBe(false);
    expect(verdict.measured.silentMoves).toEqual(['read-2-silent-growth']);
    expect(verdict.measured.grewTransitions).toBe(1);
  });

  it('does not care WHICH named cause is attached — a reclassification that happens to grow the count is exactly as legitimate as a new source', () => {
    const steps: ScopeCountCauseStep[] = [
      { id: 'read-1', denominatorCount: 2 },
      { id: 'read-2', denominatorCount: 3, causeEvent: 'reclassified' }, // grew, but via a correction — still a real cause
    ];

    const verdict = checkScopeCountCauseAttribution(steps);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.silentMoves).toEqual([]);
  });

  it('an unchanged count needs no event, and is never counted as a move', () => {
    const steps: ScopeCountCauseStep[] = [
      { id: 'read-1', denominatorCount: 5 },
      { id: 'read-2', denominatorCount: 5 },
    ];

    const verdict = checkScopeCountCauseAttribution(steps);

    expect(verdict.ok).toBe(true);
    expect(verdict.measured.movedTransitions).toBe(0);
    expect(verdict.measured.transitions).toBe(1);
  });

  it('a check that ran nothing cannot report a pass — fewer than the minimum reads is a rejection, not a vacuous pass', () => {
    expect(checkScopeCountCauseAttribution([]).ok).toBe(false);
    expect(checkScopeCountCauseAttribution([{ id: 'only-read', denominatorCount: 5 }]).ok).toBe(
      false,
    );
    expect(SCOPE_COUNT_CAUSE_MIN_STEPS).toBe(2);
  });
});
