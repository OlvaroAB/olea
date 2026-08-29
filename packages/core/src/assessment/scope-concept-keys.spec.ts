/**
 * `resolveAssessmentGroupingContext` (`ol-v7r5.11`, F2.19) — F1.7's free-text
 * scope resolved to `conceptKey`s, and F4.7's due day, for the within-block
 * grouping seam. See the module doc for the comma-split/exact-normalized-
 * match convention and why fuzzy matching is deliberately out
 * (`ol-2zfj.27`).
 *
 * INV-3: every concept name, course code and assessment path below is coined
 * for the test. None is drawn from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { ConceptRecord } from '../concept/types.js';
import type { VaultPath } from '../vault/types.js';
import { resolveAssessmentGroupingContext } from './scope-concept-keys.js';
import type { AssessmentRecord } from './types.js';

function concept(
  name: string,
  key: string,
  courses: readonly string[] = ['CRS101'],
): ConceptRecord {
  return { key, name, tier: 1, courses, sourcePaths: [] };
}

function assessment(
  overrides: Partial<AssessmentRecord> & { readonly path: VaultPath },
): AssessmentRecord {
  return {
    course: 'CRS101',
    type: 'Test',
    weight: 40,
    weightRaw: '40',
    due: '2026-09-01',
    status: 'todo',
    ...overrides,
  };
}

describe('resolveAssessmentGroupingContext', () => {
  it('splits stated scope on commas and exact-matches each segment against a same-course concept name', () => {
    const concepts = [concept('Photosynthesis', 'key-photo'), concept('Respiration', 'key-resp')];
    const path = '05 Assessments/Quiz.md' as VaultPath;
    const result = resolveAssessmentGroupingContext(
      [assessment({ path, scope: 'Photosynthesis, Respiration' })],
      concepts,
    );

    expect(result.unresolvedScopeSegmentCount).toBe(0);
    expect(result.assessmentContext.get(path)).toEqual({
      dueDay: '2026-09-01',
      scopeConceptKeys: new Set(['key-photo', 'key-resp']),
    });
  });

  it('drops a segment matching no concept, but COUNTS it rather than absorbing it silently', () => {
    const path = '05 Assessments/Quiz.md' as VaultPath;
    const result = resolveAssessmentGroupingContext(
      [assessment({ path, scope: 'Photosynthesis, Nonexistent Topic' })],
      [concept('Photosynthesis', 'key-photo')],
    );

    expect(result.unresolvedScopeSegmentCount).toBe(1);
    expect(result.assessmentContext.get(path)?.scopeConceptKeys).toEqual(new Set(['key-photo']));
  });

  it('is course-scoped: a same-named concept in a different course is never pulled in, and counts as unresolved', () => {
    const path = '05 Assessments/Quiz.md' as VaultPath;
    const result = resolveAssessmentGroupingContext(
      [assessment({ path, course: 'CRS101', scope: 'Photosynthesis' })],
      [concept('Photosynthesis', 'key-photo', ['CRS202'])],
    );

    expect(result.unresolvedScopeSegmentCount).toBe(1);
    expect(result.assessmentContext.get(path)?.scopeConceptKeys.size ?? 0).toBe(0);
  });

  it('an assessment with no known course matches nothing — every segment counts as unresolved rather than searching every course', () => {
    const path = '05 Assessments/Quiz.md' as VaultPath;
    const result = resolveAssessmentGroupingContext(
      [assessment({ path, course: undefined, due: undefined, scope: 'Photosynthesis' })],
      [concept('Photosynthesis', 'key-photo')],
    );

    expect(result.unresolvedScopeSegmentCount).toBe(1);
    // No dueDay AND no matched scope key: a no-op entry, correctly omitted.
    expect(result.assessmentContext.has(path)).toBe(false);
  });

  it('matches case- and whitespace-normalized, exact string equality only — never substring or similarity', () => {
    const path = '05 Assessments/Quiz.md' as VaultPath;
    const result = resolveAssessmentGroupingContext(
      [assessment({ path, scope: '  photosynthesis  ,   RESPIRATION RATES  ' })],
      [concept('Photosynthesis', 'key-photo'), concept('Respiration', 'key-resp')],
    );

    // 'photosynthesis' normalizes to an exact match on 'Photosynthesis'.
    // 'RESPIRATION RATES' does NOT exact-match 'Respiration' — a fuzzy or
    // substring matcher would find it; this resolver must not.
    expect(result.assessmentContext.get(path)?.scopeConceptKeys).toEqual(new Set(['key-photo']));
    expect(result.unresolvedScopeSegmentCount).toBe(1);
  });

  it('due is read as dueDay only when it is already a well-formed calendar day; absent or unparseable both read as null, never fabricated', () => {
    const pathA = '05 Assessments/A.md' as VaultPath;
    const pathB = '05 Assessments/B.md' as VaultPath;
    const result = resolveAssessmentGroupingContext(
      [
        assessment({ path: pathA, due: undefined, scope: 'Photosynthesis' }),
        assessment({ path: pathB, due: 'next Tuesday', scope: 'Photosynthesis' }),
      ],
      [concept('Photosynthesis', 'key-photo')],
    );

    expect(result.assessmentContext.get(pathA)?.dueDay).toBeNull();
    expect(result.assessmentContext.get(pathB)?.dueDay).toBeNull();
  });

  it('an assessment contributing neither a known due day nor any matched scope key is omitted from the map entirely', () => {
    const path = '05 Assessments/Quiz.md' as VaultPath;
    const result = resolveAssessmentGroupingContext(
      [assessment({ path, due: undefined, scope: 'Nonexistent Topic' })],
      [concept('Photosynthesis', 'key-photo')],
    );

    expect(result.assessmentContext.has(path)).toBe(false);
    expect(result.unresolvedScopeSegmentCount).toBe(1);
  });

  it('an assessment with a known due day but no stated scope still gets an entry (empty scopeConceptKeys)', () => {
    const path = '05 Assessments/Quiz.md' as VaultPath;
    const result = resolveAssessmentGroupingContext([assessment({ path, scope: undefined })], []);

    expect(result.assessmentContext.get(path)).toEqual({
      dueDay: '2026-09-01',
      scopeConceptKeys: new Set(),
    });
    expect(result.unresolvedScopeSegmentCount).toBe(0);
  });

  it("keys the result map by each assessment record's own path, independently", () => {
    const pathA = '05 Assessments/A.md' as VaultPath;
    const pathB = '05 Assessments/B.md' as VaultPath;
    const result = resolveAssessmentGroupingContext(
      [
        assessment({ path: pathA, due: '2026-09-01', scope: 'Photosynthesis' }),
        assessment({ path: pathB, due: '2026-10-15', scope: 'Respiration' }),
      ],
      [concept('Photosynthesis', 'key-photo'), concept('Respiration', 'key-resp')],
    );

    expect(result.assessmentContext.get(pathA)?.scopeConceptKeys).toEqual(new Set(['key-photo']));
    expect(result.assessmentContext.get(pathB)?.scopeConceptKeys).toEqual(new Set(['key-resp']));
  });
});
