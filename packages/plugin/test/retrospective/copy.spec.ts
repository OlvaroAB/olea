import type {
  RetrospectiveCarriesLine,
  RetrospectiveConceptLine,
  RetrospectiveReading,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  carriesLine,
  carriesRowDetail,
  carriesRowName,
  conceptLine,
  conceptRowDetail,
  conceptRowName,
  OWN_WORDS_PROMPT,
  OWN_WORDS_SECTION_HEADING,
  offerCardLine,
  scopeFactLine,
  scopeOriginLine,
  sectionCountLine,
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

  it('the two-column row split keeps both axes together (F2.11 co-presence, `[D-116]`)', () => {
    // The screen draws a concept as a name and a quiet detail column
    // (`docs/design/dsn2-retrospective/retrospective-surface.html:90-93`). The
    // split is the place co-presence could be lost silently: a detail column
    // carrying only the stage is indistinguishable from one carrying "holding",
    // and the drawing's own frame-04 note says the omission reads as the most
    // flattering of the three values.
    const line: RetrospectiveConceptLine = {
      conceptId: 'c1',
      conceptName: 'Concept one',
      stage: 'sapling',
      vitality: 'holding',
    };
    expect(conceptRowName(line)).toBe('Concept one');
    expect(conceptRowDetail(line)).toContain('sapling');
    expect(conceptRowDetail(line)).toContain('holding');
    // Nothing about the concept's identity leaks into the quiet column, and
    // nothing about its reading leaks into the name.
    expect(conceptRowDetail(line)).not.toContain('Concept one');
    expect(conceptRowName(line)).not.toContain('sapling');
  });

  it('the carries row split says where it carries, without re-asserting the name', () => {
    const line: RetrospectiveCarriesLine = {
      conceptId: 'c1',
      conceptName: 'Concept one',
      otherCourses: ['C2'],
      carriesToFinalAssessment: false,
    };
    expect(carriesRowName(line)).toBe('Concept one');
    expect(carriesRowDetail(line)).toContain('C2');
    expect(carriesRowDetail(line)).not.toContain('Concept one');
  });

  it('a section count is a count with its own denominator, never a ratio', () => {
    expect(sectionCountLine(1)).toBe('1 concept');
    expect(sectionCountLine(21)).toBe('21 concepts');
    expect(sectionCountLine(0)).toBe('0 concepts');
    for (const n of [0, 1, 21]) {
      expect(sectionCountLine(n)).not.toMatch(NO_SCORE_PATTERN);
      expect(sectionCountLine(n)).not.toContain(' of ');
    }
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

// F8.8 free text (`[D-190]`): the copy offered at the keep gesture states,
// plainly, that the line is optional and that nothing reads it back.
describe('the own-words prompt and heading (`[D-190]`)', () => {
  it('the prompt states the line is optional and names the "nothing reads it" guarantee', () => {
    expect(OWN_WORDS_PROMPT).toMatch(/\boptional\b|\bif you want\b/i);
    expect(OWN_WORDS_PROMPT).toMatch(/\bnothing\b.*\breads\b/i);
  });

  it('the prompt carries none of the banned score/verdict language either', () => {
    expect(OWN_WORDS_PROMPT).not.toMatch(NO_SCORE_PATTERN);
  });

  it('the section heading is a plain heading, not a registry-controlled term', () => {
    expect(OWN_WORDS_SECTION_HEADING).toBe('In your own words');
  });
});
