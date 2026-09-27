/**
 * `ol-egov.141.89.4.21` (`[D-402]`): `buildGroveModel` hands `containerNamesToFold` the keys of
 * this course's own declared concepts, so a `part-of` edge carrying its own endpoint keys is
 * judged by key rather than by wording. A split wording — the same pair of words naming another
 * identity's part-of pair — no longer drops this course's container by name match.
 *
 * INV-3: every concept name, course code and path below is invented.
 */
import { describe, expect, it } from 'vitest';
import type { RelationWithEndpointKeys } from '../concept/related-concept-keys.js';
import type { Provenance } from '../extract/types.js';
import type { ConceptMaterialPresence } from '../gap/build.js';
import type { ConceptMasteryEvidence, ConceptMasteryResult } from '../mastery/rollup.js';
import type { Source } from '../source/types.js';
import type { ConceptCitation } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildGroveModel } from './grove.js';

const COURSE = 'INVENTED101';
const OBJECTIVES = '03 Research/objectives.md' as VaultPath;

function concept(key: string, name: string) {
  return {
    key,
    name,
    tier: 2 as const,
    courses: [COURSE],
    sourcePaths: [`Notes/${key}.md` as VaultPath],
  };
}

const EVIDENCE: ConceptMasteryEvidence = {
  scoredEventCount: 0,
  scoredSuccessCount: 0,
  explainBackAttempts: 0,
  tiersPracticed: { recognition: false, recall: false, explanation: false },
  gradedExplainBackCount: 0,
  recognitionOnly: false,
  successfulScoredDays: 0,
  deepestSoloLevel: null,
  depthGateCleared: false,
  topStageQualified: false,
};

function mastery(conceptId: string): ConceptMasteryResult {
  return { conceptId, state: 'seed', evidence: EVIDENCE };
}

function presence(notePaths: readonly VaultPath[]): ConceptMaterialPresence {
  return { notePaths, instrumentCount: 1 };
}

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

function partOf(
  from: string,
  to: string,
  keys?: { readonly fromKey: string; readonly toKey: string },
): RelationWithEndpointKeys {
  return {
    type: 'part-of',
    from,
    to,
    provenance: 'model-proposed',
    confidence: 0.9,
    introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
    ...keys,
  };
}

function citation(conceptName: string): ConceptCitation {
  return {
    conceptName,
    kind: 'objectives',
    sourcePath: OBJECTIVES,
    course: COURSE,
    provenance: {
      location: { page: 1, charRange: { start: 0, end: 1 } },
    } as ConceptCitation['provenance'],
  };
}

const objectivesSource: Source = {
  path: OBJECTIVES,
  role: 'objectives',
  course: COURSE,
  kind: 'registered-file',
  format: null,
};

function groveWith(relations: readonly RelationWithEndpointKeys[]) {
  const part = concept('part-key-A', 'Invented Part');
  const broad = concept('broad-key-A', 'Invented Broad Area');
  const { model } = buildGroveModel({
    course: COURSE,
    concepts: [part, broad],
    sources: [objectivesSource],
    citations: [citation('Invented Part'), citation('Invented Broad Area')],
    materialPresence: new Map([
      ['part-key-A', presence(part.sourcePaths)],
      ['broad-key-A', presence(broad.sourcePaths)],
    ]),
    mastery: new Map([
      ['part-key-A', mastery('part-key-A')],
      ['broad-key-A', mastery('broad-key-A')],
    ]),
    relations,
  });
  if (model.status !== 'declared') throw new Error('expected declared');
  return model;
}

describe('buildGroveModel passes declared concept keys to the part-of fold (`ol-egov.141.89.4.21`, `[D-402]`)', () => {
  it("split wording: another identity's keyed part-of pair with the same words does not drop this course's container", () => {
    const model = groveWith([
      partOf('Invented Part', 'Invented Broad Area', {
        fromKey: 'part-key-B',
        toKey: 'broad-key-B',
      }),
    ]);
    expect(model.cells.map((c) => c.conceptName)).toEqual(['Invented Broad Area', 'Invented Part']);
    expect(model.summary.denominatorCount).toBe(2);
  });

  it("this course's own keyed part-of pair still folds the container", () => {
    const model = groveWith([
      partOf('Invented Part', 'Invented Broad Area', {
        fromKey: 'part-key-A',
        toKey: 'broad-key-A',
      }),
    ]);
    expect(model.cells.map((c) => c.conceptName)).toEqual(['Invented Part']);
    expect(model.summary.denominatorCount).toBe(1);
  });

  it('an edge with no endpoint keys still folds by name, unchanged', () => {
    const model = groveWith([partOf('Invented Part', 'Invented Broad Area')]);
    expect(model.cells.map((c) => c.conceptName)).toEqual(['Invented Part']);
    expect(model.summary.denominatorCount).toBe(1);
  });
});
