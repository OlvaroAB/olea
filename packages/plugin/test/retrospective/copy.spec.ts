import type { RetrospectiveConceptLine, RetrospectiveReading } from 'olea-core';
// Same deep import `copy.ts` itself uses — `RetrospectiveCarriesEntry` (olea
// 612d2c7) is not yet re-exported from `olea-core`'s root barrel.
import type { RetrospectiveCarriesEntry } from 'olea-core/src/retrospective/types.js';
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
  practiceByDateBasisLine,
  practiceByDateLine,
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

/** `[D-388]`'s carries entry — practised, one destination, declared scope, unless overridden. */
function carriesEntry(
  overrides: Partial<RetrospectiveCarriesEntry> & { conceptId: string; conceptName: string },
): RetrospectiveCarriesEntry {
  return {
    otherCourses: [],
    carriesToFinalAssessment: false,
    destinations: [],
    finalAssessmentBasis: null,
    hasQualifyingPractice: true,
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
    const line = carriesEntry({
      conceptId: 'c1',
      conceptName: 'Concept one',
      otherCourses: ['C2'],
      destinations: [{ course: 'C2', basis: 'declared-scope' }],
    });
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

  // `[D-388]` condition 1, ratified by David 2026-09-28 in chat from
  // `docs/design/copy-pass-2026-09/retrospective-what-carries.md` candidate
  // (a)A / (b)A / (c)A. Exact strings, practised vs. not.
  describe('the carries line — practised vs. no qualifying practice history (`[D-388]` condition 1)', () => {
    it('a practised concept states only the destination and its basis — no practice disclosure', () => {
      const line = carriesEntry({
        conceptId: 'c1',
        conceptName: 'Concept one',
        otherCourses: ['C2'],
        destinations: [{ course: 'C2', basis: 'declared-scope' }],
        hasQualifyingPractice: true,
      });
      expect(carriesLine(line)).toBe("Concept one — also in scope for C2 (C2's declared scope)");
      expect(carriesLine(line)).not.toMatch(/no qualifying practice/);
    });

    it('a not-yet-practised concept states plainly that no qualifying practice history exists, never "not practised"', () => {
      const line = carriesEntry({
        conceptId: 'c1',
        conceptName: 'Concept one',
        otherCourses: ['C2'],
        destinations: [{ course: 'C2', basis: 'declared-scope' }],
        hasQualifyingPractice: false,
      });
      expect(carriesLine(line)).toBe(
        "Concept one — no qualifying practice history yet; also in scope for C2 (C2's declared scope)",
      );
      // Registry §22 / condition 2: never a deficit word for this case.
      expect(carriesLine(line)).not.toMatch(/\b(weak|struggling|behind|faded|forgotten)\b/i);
      expect(carriesLine(line)).not.toMatch(/not practised/i);
    });
  });

  // `[D-388]` condition 3: the basis is named, visibly distinct from
  // examiner authority, whichever practice state it is paired with.
  describe("the carries line — declared scope vs. Olea's reading (`[D-388]` condition 3)", () => {
    it("names the later course's declared scope when the basis is declared-scope", () => {
      const line = carriesEntry({
        conceptId: 'c1',
        conceptName: 'Concept one',
        otherCourses: ['C2'],
        destinations: [{ course: 'C2', basis: 'declared-scope' }],
      });
      expect(carriesLine(line)).toContain("(C2's declared scope)");
      expect(carriesLine(line)).not.toContain("Olea's reading");
    });

    it("names Olea's reading, explicitly distinct from the course's declared scope, when the basis is olea-reading", () => {
      const line = carriesEntry({
        conceptId: 'c1',
        conceptName: 'Concept one',
        otherCourses: ['C2'],
        destinations: [{ course: 'C2', basis: 'olea-reading' }],
      });
      expect(carriesLine(line)).toBe(
        "Concept one — also in scope for C2 (Olea's reading, not C2's declared scope)",
      );
    });

    it('the same-course fallback names its own basis the same way, replacing the course with "this course"', () => {
      const declared = carriesEntry({
        conceptId: 'c1',
        conceptName: 'Concept one',
        carriesToFinalAssessment: true,
        finalAssessmentBasis: 'declared-scope',
      });
      expect(carriesLine(declared)).toBe(
        "Concept one — carries into this course's own remaining assessment (this course's declared scope)",
      );
      const reading = carriesEntry({
        conceptId: 'c1',
        conceptName: 'Concept one',
        carriesToFinalAssessment: true,
        finalAssessmentBasis: 'olea-reading',
      });
      expect(carriesLine(reading)).toBe(
        "Concept one — carries into this course's own remaining assessment (Olea's reading, not this course's declared scope)",
      );
      expect(carriesLine(reading)).not.toMatch(/also in scope for/);
    });
  });

  // The draft's own open question, settled by this bead as a Class B
  // default: one clause per destination, each stating its own basis, joined
  // the same way `otherCourses` was already joined (comma, no "and").
  it('several destinations with mixed bases each carry their own clause (Class B default)', () => {
    const line = carriesEntry({
      conceptId: 'c1',
      conceptName: 'Concept one',
      otherCourses: ['C2', 'C3'],
      destinations: [
        { course: 'C2', basis: 'declared-scope' },
        { course: 'C3', basis: 'olea-reading' },
      ],
    });
    expect(carriesLine(line)).toBe(
      "Concept one — also in scope for C2 (C2's declared scope), C3 (Olea's reading, not C3's declared scope)",
    );
  });

  it('several destinations sharing the same basis each still name it, per destination', () => {
    const line = carriesEntry({
      conceptId: 'c1',
      conceptName: 'Concept one',
      otherCourses: ['C2', 'C3'],
      destinations: [
        { course: 'C2', basis: 'declared-scope' },
        { course: 'C3', basis: 'declared-scope' },
      ],
      hasQualifyingPractice: false,
    });
    expect(carriesLine(line)).toBe(
      "Concept one — no qualifying practice history yet; also in scope for C2 (C2's declared scope), C3 (C3's declared scope)",
    );
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

describe('practiceByDateLine (D-469, F8.8 "What she had practised by the date")', () => {
  it('uses the ruled words verbatim, with the three counts filled', () => {
    expect(
      practiceByDateLine({
        kind: 'counts',
        practised: 4,
        scopeSize: 9,
        explained: 2,
        basis: 'assessment-stated',
      }),
    ).toBe(
      'Before the assessment date, you had practised 4 of the 9 concepts linked to this assessment in Olea. By then, your recorded practice showed explanation-level evidence for 2 of those concepts.',
    );
  });

  it('names the scope basis for each origin, and none for a limitation', () => {
    const counts = { kind: 'counts', practised: 1, scopeSize: 2, explained: 0 } as const;
    expect(practiceByDateBasisLine({ ...counts, basis: 'assessment-stated' })).toMatch(
      /recorded scope.*later edit/i,
    );
    expect(practiceByDateBasisLine({ ...counts, basis: 'evidenced' })).toMatch(/review history/i);
    expect(practiceByDateBasisLine({ kind: 'unavailable', reason: 'scope' })).toBeNull();
  });

  it('each unavailable case states its limitation and holds no number', () => {
    const scope = practiceByDateLine({ kind: 'unavailable', reason: 'scope' });
    const history = practiceByDateLine({ kind: 'unavailable', reason: 'history' });
    expect(scope).toMatch(/no stated scope is recorded for this assessment/);
    expect(history).toMatch(/not available/);
    expect(scope).not.toBe(history);
    expect(scope).not.toMatch(/\d/);
    expect(history).not.toMatch(/\d/);
  });

  it('never implies readiness or an outcome', () => {
    const lines = [
      practiceByDateLine({
        kind: 'counts',
        practised: 1,
        scopeSize: 1,
        explained: 1,
        basis: 'evidenced',
      }),
      practiceByDateLine({ kind: 'unavailable', reason: 'history' }),
    ].join(' ');
    expect(lines).not.toMatch(/ready|prepared|passed|score|grade|result/i);
  });
});
