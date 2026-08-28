import type {
  RetrospectiveCarriesLine,
  RetrospectiveConceptLine,
  RetrospectiveReading,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  carriesLine,
  conceptLine,
  offerCardLine,
  scopeFactLine,
  scopeOriginLine,
  tooEarlyCountLine,
  vitalityLabel,
} from '../../src/retrospective/copy.js';

function reading(overrides: Partial<RetrospectiveReading> = {}): RetrospectiveReading {
  return {
    assessmentPath: 'Courses/C1/Final.md',
    course: 'C1',
    scopeOrigin: 'evidenced',
    scopeCount: 10,
    held: [],
    faded: [],
    tooEarlyCount: 0,
    carries: [],
    ...overrides,
  };
}

const NO_SCORE_PATTERN = /%|\bpercent\b|\bscore\b|\bgrade\b|\bready\b.*\d/i;

describe('retrospective copy — no score, no percentage, no verdict', () => {
  it('the scope fact line names a count and its source, never a computed ratio', () => {
    const line = scopeFactLine(reading());
    expect(line).not.toMatch(NO_SCORE_PATTERN);
    expect(line).toContain('10');
    expect(line).toMatch(/nothing about the assessment itself/);
  });

  it('the too-early line is a stated count, never a ratio, and null when zero', () => {
    expect(tooEarlyCountLine(reading({ tooEarlyCount: 0 }))).toBeNull();
    const line = tooEarlyCountLine(reading({ tooEarlyCount: 3, scopeCount: 10 }));
    expect(line).not.toMatch(/%|\d+\/\d+/);
    expect(line).toContain('3');
    expect(line).toContain('10');
    expect(line).toMatch(/too early to say/);
  });

  it('vitality labels are the registry’s exact display words', () => {
    expect(vitalityLabel('holding')).toBe('holding');
    expect(vitalityLabel('tending')).toBe('needs tending');
    expect(vitalityLabel('early')).toBe('too early to say');
  });

  it('a concept line carries both stage and vitality, never one alone (F2.11 co-presence)', () => {
    const line: RetrospectiveConceptLine = {
      conceptId: 'c1',
      conceptName: 'Concept one',
      stage: 'sapling',
      vitality: 'holding',
    };
    const text = conceptLine(line);
    expect(text).toContain('sapling');
    expect(text).toContain('holding');
  });

  it('a carries line never fabricates a single "the" other course', () => {
    const line: RetrospectiveCarriesLine = {
      conceptId: 'c1',
      conceptName: 'Concept one',
      otherCourses: ['C2', 'C3'],
      carriesToFinalAssessment: false,
    };
    expect(carriesLine(line)).toContain('C2, C3');
  });

  it('a same-course-fallback carries line never claims another course', () => {
    const line: RetrospectiveCarriesLine = {
      conceptId: 'c1',
      conceptName: 'Concept one',
      otherCourses: [],
      carriesToFinalAssessment: true,
    };
    expect(carriesLine(line)).not.toMatch(/also in scope for/);
  });

  it('scope-origin copy states which of the two D-134 Q6 paths produced the scope', () => {
    expect(scopeOriginLine('assessment-stated')).toMatch(/assessment/i);
    expect(scopeOriginLine('evidenced')).toMatch(/review history/i);
  });

  it('the offer card is null unless the status is exactly "offered" — no card once opened or dismissed', () => {
    expect(offerCardLine('not-yet-eligible', 'C1')).toBeNull();
    expect(offerCardLine('opened', 'C1')).toBeNull();
    expect(offerCardLine('dismissed', 'C1')).toBeNull();
    expect(offerCardLine('offered', 'C1')).toContain('C1');
  });
});
