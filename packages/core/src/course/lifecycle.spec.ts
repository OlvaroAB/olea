import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectCourseProposals } from './lifecycle.js';

// features/F1-sources.md, C7.8 / `[D-098]` — @auto:core/course/lifecycle.spec
//
// Only the BEGINNING slice of C7.8 is persistence-free (see this module's own
// doc for why) — the scenarios below cover exactly that slice. Every other
// C7.8 scenario needs a persisted `CourseRecord` to read or write, which
// stops for David's ratification per `ol-0r92.7`'s brief; the `it.todo`
// entries at the bottom name each one rather than omitting it silently
// (`[D-072]`'s reachability clause applied to test coverage, not just code).

describe('detection proposes a course and never creates one', () => {
  it('proposes every course-shaped folder not already known, deriving nothing that courseFromPath would not', () => {
    const paths = [
      '01 Courses/COURSEA/WEEK 2/Lecture.md',
      '01 Courses/COURSEA/WEEK 3/Notes.md',
      '01 Courses/COURSEB/Some Set Text/Reading.md',
      '03 Research/Paper.md',
      '01 Courses/Loose note.md',
    ];

    const proposals = detectCourseProposals(paths, new Set());

    expect(proposals).toEqual([
      { code: 'COURSEA', rootPath: '01 Courses/COURSEA' },
      { code: 'COURSEB', rootPath: '01 Courses/COURSEB' },
    ]);
  });

  it('never proposes a code already in the known set — nothing is re-proposed once confirmed', () => {
    const paths = ['01 Courses/COURSEA/WEEK 2/Lecture.md', '01 Courses/COURSEB/Reading.md'];

    const proposals = detectCourseProposals(paths, new Set(['COURSEA']));

    expect(proposals).toEqual([{ code: 'COURSEB', rootPath: '01 Courses/COURSEB' }]);
  });

  it('proposes nothing, rather than guessing, when every course-shaped folder is already known', () => {
    const paths = ['01 Courses/COURSEA/WEEK 2/Lecture.md'];
    expect(detectCourseProposals(paths, new Set(['COURSEA']))).toEqual([]);
  });

  it('calling it twice with the same inputs changes nothing — a proposal is not a side effect', () => {
    const paths = ['01 Courses/COURSEA/WEEK 2/Lecture.md'];
    const known = new Set<string>();
    const first = detectCourseProposals(paths, known);
    const second = detectCourseProposals(paths, known);
    expect(first).toEqual(second);
    expect(known.size).toBe(0);
  });

  it('is not fooled by a note loose in the courses folder — a file is not a course code (F1.3)', () => {
    expect(detectCourseProposals(['01 Courses/Loose note.md'], new Set())).toEqual([]);
  });
});

describe('kinship is never inferred from names', () => {
  // A negative property: no function anywhere in this module compares course
  // names, codes or wording to produce a relationship between two courses.
  // Asserted against this file's own source text — comments included, since a
  // heuristic sketched in a comment and never wired is still evidence the
  // property was compromised, the same corpus discipline
  // `course-setup/kinship-copy.spec.ts` applies to forbidden words.
  const source = readFileSync(fileURLToPath(new URL('./lifecycle.ts', import.meta.url)), 'utf8');
  // Code only, prose stripped — this module's own doc discusses kinship at
  // length to explain its ABSENCE, so the corpus check has to read past
  // comments the same way `main-wiring.spec.ts`'s `codeOf` does, or the
  // explanation itself would fail the check it is arguing for.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('has no string-similarity, distance or fuzzy-matching machinery', () => {
    expect(code).not.toMatch(/similarity|levenshtein|fuzzy|distance\(|jaccard|soundex/i);
  });

  it('exports no function that takes two course identifiers and returns a link between them', () => {
    expect(code).not.toMatch(/kinship/i);
  });
});

describe.todo(
  'the running flip: a course set up paused/upcoming has the flip to running proposed, never applied — needs a persisted CourseRecord (blocked on the D-098 persistence seam, ol-0r92.7)',
);
describe.todo(
  'the archive is proposed at the natural moments and states the operational shift — needs a persisted CourseRecord (blocked on the D-098 persistence seam, ol-0r92.7)',
);
describe.todo(
  'residue is asked at archive time, with store as the default — needs a persisted CourseRecord (blocked on the D-098 persistence seam, ol-0r92.7)',
);
describe.todo(
  'a retake is always a new course record, and history never merges — needs a persisted CourseRecord (blocked on the D-098 persistence seam, ol-0r92.7)',
);
describe.todo(
  'kinship is asked exactly once, at the recognition moment — enforcing "once" needs a persisted kinship-answered flag on the course record (blocked on the D-098 persistence seam, ol-0r92.7)',
);
describe.todo(
  'the leaving-reason is one of exactly three, and archive is not a fourth — needs the CourseRecord schema itself (blocked on the D-098 persistence seam, ol-0r92.7)',
);
describe.todo(
  'completed is what makes a course a valid basis for a kinship proposal — needs a persisted CourseRecord (blocked on the D-098 persistence seam, ol-0r92.7)',
);
