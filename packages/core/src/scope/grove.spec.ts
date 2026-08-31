/**
 * `buildGroveModel` acceptance tests — F8.1 and F8.3's scenarios
 * (`features/F8-concepts-scope.md`, service repo), asserted directly against
 * the pure computation. F8.2's own per-cell scenarios are `./coverage.spec.ts`'s
 * job; this suite is about denominator assembly, the three-way course status,
 * and F8.3's no-scalar summary.
 *
 * Every concept name, course code and path below is invented, per INV-3.
 */
import { describe, expect, it } from 'vitest';
import type { ConceptRelation } from '../concept/relation.js';
import type { Provenance } from '../extract/types.js';
import type { ConceptMaterialPresence } from '../gap/build.js';
import type { ConceptMasteryEvidence, ConceptMasteryResult } from '../mastery/rollup.js';
import type { Source } from '../source/types.js';
import type { ConceptCitation } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildGroveModel } from './grove.js';

const COURSE = 'INVENTED101';

function concept(
  key: string,
  name: string,
  notePaths: readonly VaultPath[] = [`Notes/${key}.md` as VaultPath],
) {
  return {
    key,
    name,
    tier: 2 as const,
    courses: [COURSE],
    sourcePaths: notePaths,
  };
}

function presence(
  notePaths: readonly VaultPath[],
  instrumentCount: number,
): ConceptMaterialPresence {
  return { notePaths, instrumentCount };
}

const EVIDENCE: ConceptMasteryEvidence = {
  scoredEventCount: 0,
  explainBackAttempts: 0,
  tiersPracticed: { recognition: false, recall: false, explanation: false },
  recognitionOnly: false,
  recentWindowSize: 0,
  recentSuccessRate: null,
  recentDistinctDays: 0,
  recentRecallSuccess: false,
};

function mastery(conceptId: string, state: ConceptMasteryResult['state']): ConceptMasteryResult {
  return { conceptId, state, evidence: EVIDENCE };
}

function objectivesSource(path: VaultPath): Source {
  return { path, role: 'objectives', course: COURSE, kind: 'registered-file', format: null };
}

function pastPaperSource(path: VaultPath): Source {
  return { path, role: 'past-paper', course: COURSE, kind: 'registered-file', format: null };
}

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

// A part-of B: `from` is the finer/part side, `to` is the coarser/container
// side (`../session/containment.spec.ts`'s own convention).
function partOf(from: string, to: string): ConceptRelation {
  return {
    type: 'part-of',
    from,
    to,
    provenance: 'model-proposed',
    confidence: 0.9,
    introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
  };
}

function citation(
  conceptName: string,
  kind: ConceptCitation['kind'],
  sourcePath: VaultPath,
): ConceptCitation {
  return {
    conceptName,
    kind,
    sourcePath,
    course: COURSE,
    provenance: {
      location: { page: 1, charRange: { start: 0, end: 1 } },
    } as ConceptCitation['provenance'],
  };
}

describe('buildGroveModel — F8.1 denominator, read from registered sources', () => {
  it('the denominator is exactly the concepts registered sources declare, never anything Olea inferred alone', () => {
    const objectivesPath = '03 Research/objectives.md' as VaultPath;
    const conceptA = concept('key-a', 'Invented Concept A');
    const conceptC = concept('key-c', 'Invented Concept C'); // her own, never cited by a registered source

    const { model } = buildGroveModel({
      course: COURSE,
      concepts: [conceptA, conceptC],
      sources: [objectivesSource(objectivesPath)],
      citations: [
        citation('Invented Concept A', 'objectives', objectivesPath),
        // Olea's own reading of her generated content — never a denominator member.
        citation('Invented Concept C', 'generated-content', objectivesPath),
      ],
      materialPresence: new Map([
        ['key-a', presence(conceptA.sourcePaths, 1)],
        ['key-c', presence(conceptC.sourcePaths, 1)],
      ]),
      mastery: new Map([
        ['key-a', mastery('key-a', 'seed')],
        ['key-c', mastery('key-c', 'seed')],
      ]),
    });

    if (model.status !== 'declared') throw new Error(`expected declared, got ${model.status}`);
    expect(model.cells.map((c) => c.conceptName)).toEqual(['Invented Concept A']);
    expect(model.summary.denominatorCount).toBe(1);
    // Concept C is real (her own material) but never counted — it is a volunteer.
    expect(model.volunteers.map((v) => v.conceptName)).toEqual(['Invented Concept C']);
  });

  it('a course with no registered source and no material of her own gets the designed empty state, never an empty grove', () => {
    const { model } = buildGroveModel({
      course: COURSE,
      concepts: [],
      sources: [],
      citations: [],
      materialPresence: new Map(),
      mastery: new Map(),
    });
    expect(model).toEqual({ status: 'no-registered-source', course: COURSE });
  });

  it('a grove Olea alone inferred is labelled an inference, and its label/denominator are withheld', () => {
    const conceptA = concept('key-a', 'Invented Concept A');
    const { model } = buildGroveModel({
      course: COURSE,
      concepts: [conceptA],
      sources: [], // no registered objectives/past-paper source at all
      citations: [],
      materialPresence: new Map([['key-a', presence(conceptA.sourcePaths, 0)]]),
      mastery: new Map(),
    });
    expect(model.status).toBe('inferred');
    if (model.status !== 'inferred') throw new Error('unreachable');
    // No `cells`, no `summary`, no denominator claim anywhere on this shape —
    // the TYPE itself withholds them, not just the copy layer.
    expect(model).not.toHaveProperty('summary');
    expect(model).not.toHaveProperty('cells');
    expect(model.concepts.map((c) => c.conceptName)).toEqual(['Invented Concept A']);
  });

  it('a past paper registered mid-course grows the denominator, and nothing already counted is lost', () => {
    const objectivesPath = '03 Research/objectives.md' as VaultPath;
    const pastPaperPath = '03 Research/past-paper-2.md' as VaultPath;
    const conceptA = concept('key-a', 'Invented Concept A');
    const conceptB = concept('key-b', 'Invented Concept B');
    const materialPresence = new Map([
      ['key-a', presence(conceptA.sourcePaths, 1)],
      ['key-b', presence(conceptB.sourcePaths, 1)],
    ]);
    const masteryMap = new Map([
      ['key-a', mastery('key-a', 'seed')],
      ['key-b', mastery('key-b', 'seed')],
    ]);

    const before = buildGroveModel({
      course: COURSE,
      concepts: [conceptA, conceptB],
      sources: [objectivesSource(objectivesPath)],
      citations: [citation('Invented Concept A', 'objectives', objectivesPath)],
      materialPresence,
      mastery: masteryMap,
    }).model;
    if (before.status !== 'declared') throw new Error('expected declared');
    expect(before.summary.denominatorCount).toBe(1);

    // Week seven: a past paper is registered and cites a second concept.
    const after = buildGroveModel({
      course: COURSE,
      concepts: [conceptA, conceptB],
      sources: [objectivesSource(objectivesPath), pastPaperSource(pastPaperPath)],
      citations: [
        citation('Invented Concept A', 'objectives', objectivesPath),
        citation('Invented Concept B', 'past-paper', pastPaperPath),
      ],
      materialPresence,
      mastery: masteryMap,
    }).model;
    if (after.status !== 'declared') throw new Error('expected declared');
    expect(after.summary.denominatorCount).toBe(2);
    // Concept A's own reading is unchanged — growth never reads as loss.
    expect(after.cells.find((c) => c.conceptName === 'Invented Concept A')).toEqual(
      before.cells.find((c) => c.conceptName === 'Invented Concept A'),
    );
  });
});

describe('buildGroveModel — F8.2 material gaps inside a declared scope', () => {
  it('an examiner-declared concept with no material reads as a material gap, never as a cell', () => {
    const objectivesPath = '03 Research/objectives.md' as VaultPath;
    const { model } = buildGroveModel({
      course: COURSE,
      concepts: [], // nothing of hers extracted for the name below
      sources: [objectivesSource(objectivesPath)],
      citations: [citation('Invented Concept Unwritten', 'objectives', objectivesPath)],
      materialPresence: new Map(),
      mastery: new Map(),
    });
    if (model.status !== 'declared') throw new Error('expected declared');
    expect(model.cells).toEqual([]);
    expect(model.materialGaps).toEqual([{ conceptName: 'Invented Concept Unwritten' }]);
    expect(model.summary.denominatorCount).toBe(1);
  });
});

describe('buildGroveModel — F8.3 no coverage scalar', () => {
  it('carries the count and the denominator source separately; no ratio field exists anywhere on the shape', () => {
    const objectivesPath = '03 Research/objectives.md' as VaultPath;
    const conceptA = concept('key-a', 'Invented Concept A'); // ground — no instrument
    const conceptB = concept('key-b', 'Invented Concept B'); // built
    const { model } = buildGroveModel({
      course: COURSE,
      concepts: [conceptA, conceptB],
      sources: [objectivesSource(objectivesPath)],
      citations: [
        citation('Invented Concept A', 'objectives', objectivesPath),
        citation('Invented Concept B', 'objectives', objectivesPath),
      ],
      materialPresence: new Map([
        ['key-a', presence(conceptA.sourcePaths, 0)],
        ['key-b', presence(conceptB.sourcePaths, 1)],
      ]),
      mastery: new Map([['key-b', mastery('key-b', 'sprout')]]),
    });
    if (model.status !== 'declared') throw new Error('expected declared');
    expect(model.summary).toEqual({
      builtCount: 1,
      denominatorCount: 2,
      denominatorSourcePaths: [objectivesPath],
    });
    for (const key of Object.keys(model.summary)) {
      expect(key.toLowerCase()).not.toMatch(/ratio|percent|quotient|completion/);
    }
  });
});

describe('buildGroveModel — ground-streak plumbing (F4.5)', () => {
  it('hands back an incremented streak for a concept read ground, for the caller to persist and replay', () => {
    const objectivesPath = '03 Research/objectives.md' as VaultPath;
    const conceptA = concept('key-a', 'Invented Concept A');
    const first = buildGroveModel({
      course: COURSE,
      concepts: [conceptA],
      sources: [objectivesSource(objectivesPath)],
      citations: [citation('Invented Concept A', 'objectives', objectivesPath)],
      materialPresence: new Map([['key-a', presence(conceptA.sourcePaths, 0)]]),
      mastery: new Map(),
    });
    expect(first.nextGroundStreaks.get('key-a')).toBe(1);
    if (first.model.status !== 'declared') throw new Error('expected declared');
    expect(first.model.cells[0]).toMatchObject({ state: 'ground', stall: false });

    const second = buildGroveModel({
      course: COURSE,
      concepts: [conceptA],
      sources: [objectivesSource(objectivesPath)],
      citations: [citation('Invented Concept A', 'objectives', objectivesPath)],
      materialPresence: new Map([['key-a', presence(conceptA.sourcePaths, 0)]]),
      mastery: new Map(),
      priorGroundStreaks: first.nextGroundStreaks,
    });
    if (second.model.status !== 'declared') throw new Error('expected declared');
    expect(second.model.cells[0]).toMatchObject({ state: 'ground', stall: true });
  });
});

describe('buildGroveModel — C7.9 part-of fold (`ol-5phn`), relations input', () => {
  it('a broad area and its own declared part are never counted as separate peers against the denominator', () => {
    const objectivesPath = '03 Research/objectives.md' as VaultPath;
    const part = concept('key-part', 'Invented Part');
    const broadArea = concept('key-broad', 'Invented Broad Area');
    const { model } = buildGroveModel({
      course: COURSE,
      concepts: [part, broadArea],
      sources: [objectivesSource(objectivesPath)],
      citations: [
        citation('Invented Part', 'objectives', objectivesPath),
        citation('Invented Broad Area', 'objectives', objectivesPath),
      ],
      materialPresence: new Map([
        ['key-part', presence(part.sourcePaths, 1)],
        ['key-broad', presence(broadArea.sourcePaths, 1)],
      ]),
      mastery: new Map([
        ['key-part', mastery('key-part', 'seed')],
        ['key-broad', mastery('key-broad', 'seed')],
      ]),
      relations: [partOf('Invented Part', 'Invented Broad Area')],
    });

    if (model.status !== 'declared') throw new Error('expected declared');
    // The container yields — its own denominator entry drops, the part's stays.
    expect(model.cells.map((c) => c.conceptName)).toEqual(['Invented Part']);
    expect(model.summary.denominatorCount).toBe(1);
  });

  it("absent `relations` runs no fold — today's behaviour, unchanged, for every caller that predates this field", () => {
    const objectivesPath = '03 Research/objectives.md' as VaultPath;
    const part = concept('key-part', 'Invented Part');
    const broadArea = concept('key-broad', 'Invented Broad Area');
    const { model } = buildGroveModel({
      course: COURSE,
      concepts: [part, broadArea],
      sources: [objectivesSource(objectivesPath)],
      citations: [
        citation('Invented Part', 'objectives', objectivesPath),
        citation('Invented Broad Area', 'objectives', objectivesPath),
      ],
      materialPresence: new Map([
        ['key-part', presence(part.sourcePaths, 1)],
        ['key-broad', presence(broadArea.sourcePaths, 1)],
      ]),
      mastery: new Map([
        ['key-part', mastery('key-part', 'seed')],
        ['key-broad', mastery('key-broad', 'seed')],
      ]),
      // No `relations` field at all.
    });

    if (model.status !== 'declared') throw new Error('expected declared');
    expect(model.summary.denominatorCount).toBe(2);
  });

  it('a container declared with no part present is not folded — the fold needs both sides', () => {
    const objectivesPath = '03 Research/objectives.md' as VaultPath;
    const broadArea = concept('key-broad', 'Invented Broad Area');
    const { model } = buildGroveModel({
      course: COURSE,
      concepts: [broadArea],
      sources: [objectivesSource(objectivesPath)],
      citations: [citation('Invented Broad Area', 'objectives', objectivesPath)],
      materialPresence: new Map([['key-broad', presence(broadArea.sourcePaths, 1)]]),
      mastery: new Map([['key-broad', mastery('key-broad', 'seed')]]),
      // The part named on this edge is never declared in this course's citations.
      relations: [partOf('Invented Part', 'Invented Broad Area')],
    });

    if (model.status !== 'declared') throw new Error('expected declared');
    expect(model.cells.map((c) => c.conceptName)).toEqual(['Invented Broad Area']);
    expect(model.summary.denominatorCount).toBe(1);
  });
});
