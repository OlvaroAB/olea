import type { GapCourseView, GapRow, SourceCoverage, VaultPath } from 'olea-core';
import { summariseCoverageScope } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  abstainedCourseSentence,
  affordanceLabel,
  allGapStrings,
  coverageClosingLine,
  coverageScopeStatement,
  coverageScreenCopy,
  FULL_SYLLABUS_ADVICE,
  gapRowLine,
  rankedCourseFraming,
  rankingAttribution,
  readinessNote,
  readStateLabel,
  scopeSourceLine,
} from '../../src/gap/copy.js';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

function coverageRow(overrides: Partial<SourceCoverage> & { sourcePath: string }): SourceCoverage {
  return {
    sourcePath: overrides.sourcePath as VaultPath,
    kinds: overrides.kinds ?? ['registered-file'],
    role: overrides.role ?? 'past-paper',
    format: overrides.format ?? 'pdf',
    duplicateSourcePaths: [],
    courses: ['CRS101'],
    outcome: overrides.outcome ?? 'extracted',
    pages: overrides.pages ?? 2,
    units: overrides.units ?? 6,
    citations: overrides.citations ?? 2,
    limitations: overrides.limitations ?? [],
  };
}

const READ = coverageRow({ sourcePath: '03 Research/paper-2024.pdf' });
const READ_2 = coverageRow({ sourcePath: '03 Research/paper-2025.pdf' });
const ZERO_YIELD = coverageRow({
  sourcePath: '03 Research/paper-2023.pdf',
  outcome: 'empty-document',
  units: 0,
  citations: 0,
});
const UNREADABLE = coverageRow({
  sourcePath: '03 Research/paper-scan.pdf',
  outcome: 'no-pages-found',
  units: 0,
  citations: 0,
});
const NOT_ATTEMPTED = coverageRow({
  sourcePath: '01 Courses/CRS101/week-1.md',
  format: null,
  role: 'course-material',
  outcome: null,
  units: 1,
  citations: 0,
  limitations: ['no-tier3-reader-for-role'],
});

function row(overrides: Partial<GapRow> = {}): GapRow {
  const citation = {
    sourcePath: '03 Research/paper-2024.pdf' as VaultPath,
    questionLabel: 'Q1',
    questionText: 'A question.',
    provenance: { location: { page: 1, charRange: { start: 0, end: 4 } } },
  } as GapRow['citations'][number];
  return {
    conceptName: 'Alpha',
    conceptKey: 'Alpha', // `ol-63e1`: this suite is about copy, not the name/key split.
    course: 'CRS101',
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
    targetAssessmentPath: '02 Assessments/final.md' as VaultPath,
    assessmentFormat: 'unknown',
    citations: [citation],
    distinctSourceCount: 1,
    reasoning: 'Cited in one past paper.',
    notePaths: ['05 Zettelkasten/Alpha.md' as VaultPath],
    instrumentCount: 2,
    affordances: ['open-concept', 'build-session'],
    ...overrides,
  };
}

/** Every string this module can put in front of her, across representative models. */
function everyProducibleString(): readonly string[] {
  const rows = [
    row(),
    row({ gapClass: 'coverage-gap', distinctSourceCount: 1, instrumentCount: 0 }),
    row({ gapClass: 'material-gap', distinctSourceCount: 3, notePaths: [], instrumentCount: 0 }),
    row({
      readiness: {
        assessmentFormat: 'mcq',
        recognitionEvidence: true,
        recognitionOnly: true,
        applied: true,
        weight: 0.6,
      },
    }),
  ];
  const scopes = [
    summariseCoverageScope([READ, READ_2]),
    summariseCoverageScope([READ, ZERO_YIELD]),
    summariseCoverageScope([READ, UNREADABLE]),
    summariseCoverageScope([READ, NOT_ATTEMPTED]),
    summariseCoverageScope([UNREADABLE]),
    summariseCoverageScope([]),
  ];
  const abstained: GapCourseView = {
    course: 'CRS202',
    status: 'abstained',
    reason: 'no-evidence',
    detail: 'No evidence.',
    assessmentPaths: ['02 Assessments/a.md' as VaultPath],
  };
  const abstainedMany: GapCourseView = {
    ...abstained,
    assessmentPaths: ['02 Assessments/a.md' as VaultPath, '02 Assessments/b.md' as VaultPath],
  };

  return [
    ...allGapStrings(),
    ...rankedCourseFraming(rows),
    ...rankedCourseFraming([]),
    ...rows.map(gapRowLine),
    ...rows.map(readinessNote).filter((s): s is string => s !== null),
    ...rows.flatMap((r) => r.affordances.map(affordanceLabel)),
    abstainedCourseSentence(abstained),
    abstainedCourseSentence(abstainedMany),
    ...scopes.flatMap((scope) => [
      ...coverageScopeStatement(scope),
      ...coverageScreenCopy({ scope, gapRowCount: 0 }),
      ...coverageScreenCopy({ scope, gapRowCount: 2 }),
      ...scope.sources.map(scopeSourceLine),
    ]),
  ];
}

// --------------------------------------------------------------------------
// ol-cvsc — the surface may not claim more than it read
// --------------------------------------------------------------------------

describe('ol-cvsc — "read and found nothing" is not "could not read"', () => {
  it('produces different text for a zero-yield source than for an unreadable one', () => {
    const zeroYield = coverageScopeStatement(summariseCoverageScope([READ, ZERO_YIELD]));
    const unreadable = coverageScopeStatement(summariseCoverageScope([READ, UNREADABLE]));
    // Identical in every respect but the one that matters.
    expect(zeroYield).not.toEqual(unreadable);
    expect(zeroYield.join(' ')).toContain('nothing in it to read');
    expect(unreadable.join(' ')).toContain('could not be read');
  });

  it('gives each read state its own word on its own row', () => {
    const labels = new Set(
      (['read', 'read-yielded-nothing', 'unreadable', 'not-attempted'] as const).map(
        readStateLabel,
      ),
    );
    expect(labels.size).toBe(4);
  });

  it('names a source that was not read on this pass, rather than omitting it', () => {
    const scope = summariseCoverageScope([READ, NOT_ATTEMPTED]);
    const lines = coverageScopeStatement(scope).join(' ');
    expect(lines).toContain('not read on this pass');
    expect(scope.sources.map(scopeSourceLine).join(' ')).toContain('01 Courses/CRS101/week-1.md');
  });
});

describe('ol-cvsc — the exhaustiveness claim', () => {
  it('is produced only when the scope grants it', () => {
    expect(coverageClosingLine(summariseCoverageScope([READ, READ_2]))).toBe(
      'Nothing else in the 2 past papers we could read is missing from your materials.',
    );
    expect(coverageClosingLine(summariseCoverageScope([READ, ZERO_YIELD]))).toBeNull();
    expect(coverageClosingLine(summariseCoverageScope([READ, UNREADABLE]))).toBeNull();
    expect(coverageClosingLine(summariseCoverageScope([READ, NOT_ATTEMPTED]))).toBeNull();
    expect(coverageClosingLine(summariseCoverageScope([]))).toBeNull();
  });

  it('names sources rather than calling an objectives document a past paper', () => {
    const objectives = coverageRow({
      sourcePath: '03 Research/objectives.pdf',
      role: 'objectives',
    });
    expect(coverageClosingLine(summariseCoverageScope([READ, objectives]))).toBe(
      'Nothing else in the 2 sources we could read is missing from your materials.',
    );
  });

  it('carries no second sentence arguing for its own honesty', () => {
    const line = coverageClosingLine(summariseCoverageScope([READ, READ_2])) ?? '';
    // The ratified copy drops it: a line that argues it is honest is the tell.
    expect(line).not.toContain('honest');
    expect(line).not.toContain('truncated');
    expect(line.split('.').filter((s) => s.trim() !== '')).toHaveLength(1);
  });
});

describe('ol-cvsc — a bare "no gaps found" is unreachable', () => {
  it('never renders the exhaustiveness sentence when a source was not read', () => {
    const scope = summariseCoverageScope([READ, UNREADABLE]);
    const copy = coverageScreenCopy({ scope, gapRowCount: 0 });
    const joined = copy.join(' ');
    expect(joined).not.toContain('Nothing else in');
    expect(joined).toContain('could not read all of it');
    expect(joined).toContain('could not be read');
  });

  it('says which of the two things happened, in both directions', () => {
    const complete = coverageScreenCopy({
      scope: summariseCoverageScope([READ, READ_2]),
      gapRowCount: 0,
    });
    const incomplete = coverageScreenCopy({
      scope: summariseCoverageScope([READ, UNREADABLE]),
      gapRowCount: 0,
    });
    // The whole bead in one assertion: the screen must not render identically
    // whether it found no gaps or found nothing because it read nothing.
    expect(complete).not.toEqual(incomplete);
  });

  it('always states the scope, gaps or no gaps', () => {
    for (const gapRowCount of [0, 1, 7]) {
      const copy = coverageScreenCopy({
        scope: summariseCoverageScope([READ, UNREADABLE]),
        gapRowCount,
      });
      expect(copy.join(' ')).toContain('could not be read');
    }
  });

  it('says nothing was read when nothing was read', () => {
    const copy = coverageScreenCopy({ scope: summariseCoverageScope([]), gapRowCount: 0 });
    expect(copy.join(' ')).toContain('read none of your sources');
    expect(copy.join(' ')).not.toContain('Nothing else in');
  });

  it('reports no result at all when there was no search — three states, not two', () => {
    // Nothing readable, no rows. "No gaps found", however hedged, reports the
    // result of a search that did not happen.
    for (const scope of [summariseCoverageScope([]), summariseCoverageScope([UNREADABLE])]) {
      const copy = coverageScreenCopy({ scope, gapRowCount: 0 });
      expect(copy.join(' ')).not.toContain('No gaps found');
      expect(copy.join(' ')).toContain('Nothing below is a finding about your notes');
    }
    // And the distinction survives: with something read, the line comes back.
    expect(
      coverageScreenCopy({
        scope: summariseCoverageScope([READ, UNREADABLE]),
        gapRowCount: 0,
      }).join(' '),
    ).toContain('No gaps found');
  });
});

// --------------------------------------------------------------------------
// F4.9 — ol-f49h, both halves
// --------------------------------------------------------------------------

describe('F4.9 — never implies knowledge of a real paper', () => {
  // Half one: the kit said "ranked by what this paper has actually asked",
  // where "this paper" is the assessment ahead, which has asked nothing.
  const FORBIDDEN = [
    'this paper has actually asked',
    'this paper has asked',
    'will be asked',
    'will ask',
    'will come up',
    'this will come up',
    'is going to be on',
  ];

  it('produces no string implying the assessment ahead has asked or will ask anything', () => {
    const strings = everyProducibleString();
    // Guard against the audit passing because the enumeration is empty — the
    // inventory-is-not-an-audit failure ol-f49h itself records.
    expect(strings.length).toBeGreaterThan(25);
    for (const phrase of FORBIDDEN) {
      const offenders = strings.filter((s) => s.toLowerCase().includes(phrase));
      expect(offenders, `forbidden phrase "${phrase}"`).toEqual([]);
    }
  });

  it('attributes the asking to the past papers actually cited, and counts them', () => {
    expect(rankingAttribution([row()])).toBe('Ranked by what 1 past paper of yours has asked.');
    const twoSources = [
      row(),
      row({
        citations: [
          {
            sourcePath: '03 Research/paper-2025.pdf' as VaultPath,
            questionLabel: 'Q2',
            questionText: 'Another.',
            provenance: { location: { page: 1, charRange: { start: 0, end: 4 } } },
          } as GapRow['citations'][number],
        ],
      }),
    ];
    expect(rankingAttribution(twoSources)).toBe(
      'Ranked by what 2 past papers of yours have asked.',
    );
  });

  it('claims no past paper when none is cited', () => {
    expect(rankingAttribution([row({ citations: [] })])).not.toContain('past paper of yours');
    expect(rankingAttribution([])).toContain('no past paper is cited');
  });
});

describe('F4.9 — always advises covering the full syllabus', () => {
  it('emits the advice from the ranked state, for any number of rows', () => {
    for (const rows of [[], [row()], [row(), row({ conceptName: 'Beta' })]]) {
      expect(rankedCourseFraming(rows)).toContain(FULL_SYLLABUS_ADVICE);
    }
  });

  it('advises covering the syllabus and refuses prophecy in the same string', () => {
    expect(FULL_SYLLABUS_ADVICE.toLowerCase()).toContain('syllabus');
    expect(FULL_SYLLABUS_ADVICE.toLowerCase()).toContain('not where the exam will go');
  });

  it('does not produce the ranked framing for an abstained course', () => {
    const abstained: GapCourseView = {
      course: 'CRS202',
      status: 'abstained',
      reason: 'no-evidence',
      detail: 'No evidence.',
      assessmentPaths: ['02 Assessments/a.md' as VaultPath],
    };
    const sentence = abstainedCourseSentence(abstained);
    expect(sentence).toContain('Not enough evidence to rank this course');
    // States its own scope inside its own sentence.
    expect(sentence).toContain('no past paper or objective we have');
    expect(() =>
      abstainedCourseSentence({ course: 'CRS101', status: 'ranked', rows: [] }),
    ).toThrow();
  });
});

// --------------------------------------------------------------------------
// Rows and the readiness note
// --------------------------------------------------------------------------

describe('row copy', () => {
  it('states a material gap as a fact about what was ingested', () => {
    expect(gapRowLine(row({ gapClass: 'material-gap', distinctSourceCount: 3 }))).toBe(
      "Appears in 3 past papers; it isn't in your materials.",
    );
  });

  it('states a coverage gap as notes-without-cards', () => {
    expect(gapRowLine(row({ gapClass: 'coverage-gap', distinctSourceCount: 1 }))).toBe(
      'Appears in 1 past paper; you have notes on it but no cards yet.',
    );
  });

  it('shows the oracle reasoning verbatim on a mastery gap', () => {
    expect(gapRowLine(row({ reasoning: 'Cited in one past paper.' }))).toBe(
      'Cited in one past paper.',
    );
  });

  it('labels every affordance core can actually offer, and no commissioning affordance exists to label', () => {
    expect(affordanceLabel('open-concept')).toBe('Open the concept');
    expect(affordanceLabel('build-session')).toBe('Build a session from this');
    expect(affordanceLabel('find-source')).toBe('Find the source');
  });
});

describe('the readiness note (R7 framing)', () => {
  it('is offered only when the weighting actually fired', () => {
    expect(readinessNote(row())).toBeNull();
    const applied = readinessNote(
      row({
        readiness: {
          assessmentFormat: 'mcq',
          recognitionEvidence: true,
          recognitionOnly: true,
          applied: true,
          weight: 0.6,
        },
      }),
    );
    expect(applied).not.toBeNull();
    // R7's framing clause, both ways: never "MCQs don't count", and never
    // "MCQs are enough" either.
    expect(applied?.toLowerCase()).not.toContain("don't count");
    expect(applied).toContain('Your mastery reading is unchanged.');
  });
});
