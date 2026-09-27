// `ol-egov.141.89.10.74` (`[D-399]`, F4.2): a concept ranked only by an
// assessment brief reaches the gap view with an empty `citations` array, the
// same shape an objectives-only row has. Given the edges' bases, the
// attribution names the brief and never objectives.
//
// INV-3: every course code, concept name and path below is invented.
import type { ConceptAssessmentEdge, GapRow, VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE,
  ASSESSMENT_BRIEF_ATTRIBUTION_SENTENCE,
  gapRowEvidenceBases,
  OBJECTIVES_ATTRIBUTION_CLAUSE,
  OBJECTIVES_ATTRIBUTION_SENTENCE,
  rankedCourseFraming,
  rankingAttribution,
} from '../../src/gap/copy.js';

const COURSE = 'CRS101';
const PAPER = '03 Research/paper-2024.pdf' as VaultPath;
const BRIEF = '02 Assessments/assignment-1.md' as VaultPath;

function row(conceptKey: string, citations: GapRow['citations']): GapRow {
  return {
    conceptName: conceptKey,
    conceptKey,
    course: COURSE,
    gapClass: 'mastery-gap',
    rank: 1,
    oracleRank: 1,
    priorityScore: 1,
    gapScore: 1,
    readiness: {
      assessmentFormat: 'unknown',
      recognitionEvidence: false,
      recognitionOnly: false,
      applied: false,
      weight: 1,
    },
    masteryState: 'sprout',
    targetAssessmentPath: BRIEF,
    assessmentFormat: 'unknown',
    citations,
    distinctSourceCount: citations.length === 0 ? 0 : 1,
    reasoning: 'Invented.',
    notePaths: [`05 Zettelkasten/${conceptKey}.md` as VaultPath],
    instrumentCount: 1,
    affordances: ['open-concept'],
  };
}

const paperCitation = {
  sourcePath: PAPER,
  questionLabel: 'Q1',
  questionText: 'An invented question.',
  provenance: { location: { page: 1, charRange: { start: 0, end: 4 } } },
} as GapRow['citations'][number];

function edge(conceptKey: string, basis: ConceptAssessmentEdge['basis']): ConceptAssessmentEdge {
  return {
    conceptName: conceptKey,
    conceptKey,
    assessmentPath: BRIEF,
    course: COURSE,
    yieldRank: 1,
    confidence: 0.5,
    citations: basis === undefined || basis === 'past-paper' ? [paperCitation] : [],
    ...(basis === undefined ? {} : { basis }),
  } as ConceptAssessmentEdge;
}

describe('gap attribution names the brief basis for a brief-only row (`ol-egov.141.89.10.74`, `[D-399]`)', () => {
  it('a brief-only row names the brief, never objectives', () => {
    const rows = [row('Invented Brief Concept', [])];
    const bases = gapRowEvidenceBases([edge('Invented Brief Concept', 'assessment-brief')]);
    const sentence = rankingAttribution(rows, bases);
    expect(sentence).toBe(ASSESSMENT_BRIEF_ATTRIBUTION_SENTENCE);
    expect(sentence.toLowerCase()).toContain('brief');
    expect(sentence.toLowerCase()).not.toContain('objective');
    // F4.2: a brief never wears a past paper's clothes — no frequency framing.
    expect(sentence).not.toContain('past paper');
    expect(sentence.toLowerCase()).not.toMatch(/\basked\b/);
    expect(rankedCourseFraming(rows, bases)[0]).toBe(ASSESSMENT_BRIEF_ATTRIBUTION_SENTENCE);
  });

  it('an objectives-only row still reads as objectives when its bases are supplied', () => {
    const rows = [row('Invented Objective Concept', [])];
    const bases = gapRowEvidenceBases([edge('Invented Objective Concept', 'objectives')]);
    expect(rankingAttribution(rows, bases)).toBe(OBJECTIVES_ATTRIBUTION_SENTENCE);
  });

  it('objectives and brief rows together state each basis for what it is', () => {
    const rows = [row('Invented Objective Concept', []), row('Invented Brief Concept', [])];
    const bases = gapRowEvidenceBases([
      edge('Invented Objective Concept', 'objectives'),
      edge('Invented Brief Concept', 'assessment-brief'),
    ]);
    expect(rankingAttribution(rows, bases)).toBe(
      `${OBJECTIVES_ATTRIBUTION_SENTENCE} ${ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE}`,
    );
  });

  it('past papers plus a brief-only row: the past-paper sentence, then the brief clause, and no objectives clause', () => {
    const rows = [
      row('Invented Paper Concept', [paperCitation]),
      row('Invented Brief Concept', []),
    ];
    const bases = gapRowEvidenceBases([
      edge('Invented Paper Concept', undefined), // no basis reads as past-paper
      edge('Invented Brief Concept', 'assessment-brief'),
    ]);
    const sentence = rankingAttribution(rows, bases);
    expect(sentence).toBe(
      `Ranked by what 1 past paper of yours has asked. ${ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE}`,
    );
    expect(sentence).not.toContain(OBJECTIVES_ATTRIBUTION_CLAUSE);
  });

  it('without bases, the empty-citations inference is unchanged', () => {
    expect(rankingAttribution([row('Invented Concept', [])])).toBe(OBJECTIVES_ATTRIBUTION_SENTENCE);
  });

  it('the new sentences imply nothing about the assessment ahead', () => {
    for (const s of [ASSESSMENT_BRIEF_ATTRIBUTION_SENTENCE, ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE]) {
      const lower = s.toLowerCase();
      for (const phrase of ['will be asked', 'will ask', 'will come up', 'is going to be on']) {
        expect(lower).not.toContain(phrase);
      }
    }
  });
});
