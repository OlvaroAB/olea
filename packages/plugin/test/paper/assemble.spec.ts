/**
 * `assemble.ts` tests — building F4.11's real-data-backed `PaperScopeConcept[]`/
 * `PaperAssessment[]` inputs from already-wired production readers (F4.11).
 *
 * Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice-paper command and view
 * surface [PAPER-8]", tagged `@auto:plugin/paper/provider.spec` (this module's behaviour is
 * exercised end to end through `provider.spec.ts`'s scenarios; these are the unit-level
 * complements).
 */
import type { ConceptRecord, VaultSource } from 'olea-core';
import { DEFAULT_PAPER_PURPOSE } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildAssessmentsForCourse,
  buildBlueprintInputForCourse,
  buildHeldSourceForConcept,
  buildScopeConceptsForCourse,
} from '../../src/paper/assemble.js';

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
});

describe('buildBlueprintInputForCourse', () => {
  it('declares the purpose explicitly as DEFAULT_PAPER_PURPOSE (ol-egov.141.6.17) — no clause names a choice surface, so the caller states the default rather than leaving it to buildPaperBlueprint', async () => {
    const vault = fakeVault({});
    const concepts = [concept({ key: 'k1', name: 'In course', definition: 'text' })];
    const input = await buildBlueprintInputForCourse(vault, concepts, [], 'COURSEA', '2026-09-25');
    expect(input.purpose).toBe(DEFAULT_PAPER_PURPOSE);
    expect(input.purpose).toBe('assessment-simulation');
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
