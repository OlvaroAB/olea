/**
 * `assemble.ts` tests — building F4.11's real-data-backed `PaperScopeConcept[]`/
 * `PaperAssessment[]` inputs from already-wired production readers (F4.11).
 *
 * Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice-paper command and view
 * surface [PAPER-8]", tagged `@auto:plugin/paper/provider.spec` (this module's behaviour is
 * exercised end to end through `provider.spec.ts`'s scenarios; these are the unit-level
 * complements).
 */
import type { ConceptRecord, OutcomeRecord, VaultSource } from 'olea-core';
import { buildPaperBlueprint, DEFAULT_PAPER_PURPOSE } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildAssessmentsForCourse,
  buildBlueprintInputForCourse,
  buildHeldSourceForConcept,
  buildScopeConceptsForCourse,
  buildScopeOutcomesForCourse,
} from '../../src/paper/assemble.js';

function outcome(overrides: Partial<OutcomeRecord> & { id: string }): OutcomeRecord {
  return {
    courses: ['COURSEA'],
    source: { path: 'Objectives.md', blockIndex: 0 },
    label: 'x',
    conceptKeys: [],
    status: 'active',
    provenance: { promptVersion: 'v1', modelVersion: 'model-a' },
    mintedAt: '2026-09-16',
    schemaVersion: 1,
    ...overrides,
  };
}

function concept(
  overrides: Partial<ConceptRecord> & Pick<ConceptRecord, 'key' | 'name'>,
): ConceptRecord {
  return {
    tier: 1,
    courses: ['COURSEA'],
    sourcePaths: [],
    ...overrides,
  };
}

function fakeVault(files: Record<string, string>): VaultSource {
  return {
    async list() {
      return Object.keys(files).sort();
    },
    async read(path: string) {
      const content = files[path];
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
    readBinary: () => {
      throw new Error('not used by this test');
    },
    write: () => {
      throw new Error('not used by this test');
    },
    async exists(path: string) {
      return Object.hasOwn(files, path);
    },
  } as unknown as VaultSource;
}

describe('buildHeldSourceForConcept', () => {
  it('uses the concept’s own definition, verbatim, as the one chunk', async () => {
    const vault = fakeVault({});
    const held = await buildHeldSourceForConcept(
      vault,
      concept({
        key: 'k1',
        name: 'Krebs cycle',
        definition: 'her own words',
        boundNotePath: '01 Courses/A/Krebs cycle.md',
      }),
    );
    expect(held).toEqual({
      kind: 'notes',
      sourceId: '01 Courses/A/Krebs cycle.md',
      chunks: ['her own words'],
    });
  });

  it('falls back to reading the first sourcePaths entry when there is no definition', async () => {
    const vault = fakeVault({ '01 Courses/A/week1.md': 'real note text' });
    const held = await buildHeldSourceForConcept(
      vault,
      concept({ key: 'k1', name: 'Krebs cycle', sourcePaths: ['01 Courses/A/week1.md'] }),
    );
    expect(held).toEqual({
      kind: 'notes',
      sourceId: '01 Courses/A/week1.md',
      chunks: ['real note text'],
    });
  });

  it('is undefined when neither a definition nor a readable sourcePaths entry exists — never invented (F4.10)', async () => {
    const vault = fakeVault({});
    const held = await buildHeldSourceForConcept(
      vault,
      concept({ key: 'k1', name: 'Krebs cycle' }),
    );
    expect(held).toBeUndefined();
  });

  it('is undefined, never thrown, when a listed sourcePaths file cannot actually be read', async () => {
    const vault = fakeVault({});
    const held = await buildHeldSourceForConcept(
      vault,
      concept({ key: 'k1', name: 'Krebs cycle', sourcePaths: ['01 Courses/A/gone.md'] }),
    );
    expect(held).toBeUndefined();
  });
});

describe('buildScopeConceptsForCourse', () => {
  it('filters to the named course only', async () => {
    const vault = fakeVault({});
    const concepts = [
      concept({ key: 'k1', name: 'In course', courses: ['COURSEA'], definition: 'text' }),
      concept({ key: 'k2', name: 'Other course', courses: ['COURSEB'], definition: 'text' }),
    ];
    const scope = await buildScopeConceptsForCourse(vault, concepts, 'COURSEA');
    expect(scope.map((c) => c.conceptKey)).toEqual(['k1']);
  });

  it('reads every in-course concept as taughtSignal yes — the top of F8.2’s chain, since a real note already evidences it', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'In course', definition: 'text' })];
    const scope = await buildScopeConceptsForCourse(vault, concepts, 'COURSEA');
    expect(scope[0]?.taughtSignal).toBe('yes');
  });

  it('leaves heldSources empty, never invented, for a concept with no real chunk to ground in', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'No material' })];
    const scope = await buildScopeConceptsForCourse(vault, concepts, 'COURSEA');
    expect(scope[0]?.heldSources).toEqual([]);
  });

  it('always reports masteryScore null — no mastery reader is wired here (see this module’s doc)', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'In course', definition: 'text' })];
    const scope = await buildScopeConceptsForCourse(vault, concepts, 'COURSEA');
    expect(scope[0]?.masteryScore).toBeNull();
  });

  it('sets outcomeId from the outcome→concept containment edge, for an active course Outcome that attaches the concept (ol-2zfj.172, F4.11 ruling 3)', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'Krebs cycle', definition: 'text' })];
    const outcomes = [outcome({ id: 'out-1', label: 'Cellular respiration', conceptKeys: ['k1'] })];
    const scope = await buildScopeConceptsForCourse(vault, concepts, 'COURSEA', outcomes);
    expect(scope[0]?.outcomeId).toBe('out-1');
  });

  it('leaves outcomeId undefined when no active Outcome attaches the concept', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'Krebs cycle', definition: 'text' })];
    const outcomes = [
      outcome({ id: 'out-1', label: 'Cellular respiration', conceptKeys: ['other-key'] }),
    ];
    const scope = await buildScopeConceptsForCourse(vault, concepts, 'COURSEA', outcomes);
    expect(scope[0]?.outcomeId).toBeUndefined();
  });

  it('ignores a retired Outcome’s containment edge — only active Outcomes attach', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'Krebs cycle', definition: 'text' })];
    const outcomes = [
      outcome({
        id: 'out-1',
        label: 'Cellular respiration',
        conceptKeys: ['k1'],
        status: 'retired',
      }),
    ];
    const scope = await buildScopeConceptsForCourse(vault, concepts, 'COURSEA', outcomes);
    expect(scope[0]?.outcomeId).toBeUndefined();
  });

  it('ignores an Outcome attached to a different course, even if it names the same concept key', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'Krebs cycle', definition: 'text' })];
    const outcomes = [
      outcome({
        id: 'out-1',
        courses: ['COURSEB'],
        label: 'Cellular respiration',
        conceptKeys: ['k1'],
      }),
    ];
    const scope = await buildScopeConceptsForCourse(vault, concepts, 'COURSEA', outcomes);
    expect(scope[0]?.outcomeId).toBeUndefined();
  });
});

describe('buildScopeOutcomesForCourse', () => {
  it('restates each active, course-attached Outcome at the field grain emphasis matching needs', () => {
    const outcomes = [
      outcome({ id: 'out-1', label: 'Cellular respiration', conceptKeys: ['k1', 'k2'] }),
      outcome({ id: 'out-2', courses: ['COURSEB'], label: 'Not this course', conceptKeys: ['k3'] }),
      outcome({ id: 'out-3', label: 'Retired one', conceptKeys: ['k4'], status: 'retired' }),
    ];
    const scoped = buildScopeOutcomesForCourse(outcomes, 'COURSEA');
    expect(scoped).toEqual([
      { outcomeId: 'out-1', label: 'Cellular respiration', conceptKeys: ['k1', 'k2'] },
    ]);
  });

  it('is empty for a course with no Outcomes — reproduces the pre-wiring degraded behaviour', () => {
    expect(buildScopeOutcomesForCourse([], 'COURSEA')).toEqual([]);
  });
});

describe('buildBlueprintInputForCourse', () => {
  it('declares the purpose explicitly as DEFAULT_PAPER_PURPOSE (ol-egov.141.6.17) — no clause names a choice surface, so the caller states the default rather than leaving it to buildPaperBlueprint', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'In course', definition: 'text' })];
    const input = await buildBlueprintInputForCourse(vault, concepts, [], 'COURSEA', '2026-09-25');
    expect(input.purpose).toBe(DEFAULT_PAPER_PURPOSE);
    expect(input.purpose).toBe('assessment-simulation');
  });

  it('omits no outcomes field (empty array) when no Outcomes were passed — old degraded behaviour reproduced exactly', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'In course', definition: 'text' })];
    const input = await buildBlueprintInputForCourse(vault, concepts, [], 'COURSEA', '2026-09-25');
    expect(input.outcomes).toEqual([]);
    expect(input.concepts[0]?.outcomeId).toBeUndefined();
  });

  it('carries real Outcome labels into the outcomes field and sets each attached concept’s outcomeId (ol-2zfj.172)', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'Krebs cycle', definition: 'text' })];
    const outcomes = [outcome({ id: 'out-1', label: 'Cellular respiration', conceptKeys: ['k1'] })];
    const input = await buildBlueprintInputForCourse(
      vault,
      concepts,
      [],
      'COURSEA',
      '2026-09-25',
      outcomes,
    );
    expect(input.outcomes).toEqual([
      { outcomeId: 'out-1', label: 'Cellular respiration', conceptKeys: ['k1'] },
    ]);
    expect(input.concepts[0]?.outcomeId).toBe('out-1');
  });

  it('an Outcome-label emphasis match fires end to end through buildPaperBlueprint — the concept’s own name does not contain the emphasis string, only its Outcome’s label does (F4.11 ruling 3)', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'Krebs cycle', definition: 'text' })];
    const outcomes = [
      outcome({ id: 'out-1', label: 'Cellular respiration pathways', conceptKeys: ['k1'] }),
    ];
    const input = await buildBlueprintInputForCourse(
      vault,
      concepts,
      [],
      'COURSEA',
      '2026-09-25',
      outcomes,
    );
    const blueprint = buildPaperBlueprint({
      ...input,
      steering: { emphasis: 'cellular respiration' },
    });
    const slot = blueprint.slots.find((s) => s.conceptKey === 'k1');
    expect(slot?.emphasised).toBe(true);
  });
});

describe('buildAssessmentsForCourse', () => {
  it('keeps only records for the named course with both type and due present', () => {
    const records = [
      { course: 'COURSEA', type: 'exam', due: '2026-11-01' },
      { course: 'COURSEB', type: 'exam', due: '2026-11-01' },
      { course: 'COURSEA', type: undefined, due: '2026-11-01' },
      { course: 'COURSEA', type: 'test', due: undefined },
    ];
    const assessments = buildAssessmentsForCourse(records, 'COURSEA');
    expect(assessments).toEqual([{ type: 'exam', due: '2026-11-01' }]);
  });
});
